using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;


namespace ManLab.Agent.Services;

/// <summary>
/// Manages the SignalR connection to the ManLab server with exponential backoff reconnection.
/// </summary>
public sealed class ConnectionManager : IAsyncDisposable
{
    private readonly ILogger<ConnectionManager> _logger;
    private readonly AgentConfiguration _config;
    private readonly HubConnection _connection;
    private readonly HeartbeatRetryManager _heartbeatRetryManager;

    private Guid _nodeId;
    private int _reconnectAttempt;
    private bool _isConnected;
    private NodeMetadata? _cachedMetadata;

    /// <summary>
    /// Event raised when a command is received from the server.
    /// </summary>
    public event Func<Guid, string, string, Task>? OnCommandReceived;

    /// <summary>
    /// Event raised when the server requests telemetry.
    /// </summary>
    public event Func<Task>? OnTelemetryRequested;

    /// <summary>
    /// Gets whether the connection is currently established.
    /// </summary>
    public bool IsConnected => _isConnected;

    /// <summary>
    /// Gets the node ID assigned by the server after registration.
    /// </summary>
    public Guid NodeId => _nodeId;

    /// <summary>
    /// Gets the heartbeat retry manager for monitoring backoff state.
    /// </summary>
    public HeartbeatRetryManager HeartbeatRetryManager => _heartbeatRetryManager;

    public ConnectionManager(ILoggerFactory loggerFactory, AgentConfiguration config)
    {
        _logger = loggerFactory.CreateLogger<ConnectionManager>();
        _config = config;
        _heartbeatRetryManager = new HeartbeatRetryManager(
            loggerFactory.CreateLogger<HeartbeatRetryManager>(),
            baseDelaySeconds: 2,
            maxDelaySeconds: config.MaxReconnectDelaySeconds);

        var builder = new HubConnectionBuilder()
            .AddJsonProtocol(options =>
            {
                // NativeAOT: reflection-based serialization is disabled.
                // Provide source-generated type metadata for hub payloads.
                options.PayloadSerializerOptions.TypeInfoResolver = ManLabJsonContext.Default;
            })
            .WithUrl(_config.ServerUrl, options =>
            {
                if (!string.IsNullOrEmpty(_config.AuthToken))
                {
                    // Use the standard SignalR token mechanism.
                    // Server supports both Authorization header and access_token query string.
                    options.AccessTokenProvider = () => Task.FromResult(_config.AuthToken)!;
                }
            })
            .WithAutomaticReconnect(new ExponentialBackoffRetryPolicy(_config.MaxReconnectDelaySeconds));

        _connection = builder.Build();

        // Make timeouts explicit and aligned with typical SignalR guidance.
        // These values should be >= server KeepAliveInterval and client timeout should be ~2x.
        _connection.KeepAliveInterval = TimeSpan.FromSeconds(15);
        _connection.ServerTimeout = TimeSpan.FromSeconds(30);

        // Register event handlers for server-to-agent methods
        _connection.On<Guid, string, string>("ExecuteCommand", HandleExecuteCommand);
        _connection.On("RequestTelemetry", HandleRequestTelemetry);
        _connection.On("RequestPing", HandleRequestPing);

        // Handle connection state changes
        _connection.Closed += OnConnectionClosed;
        _connection.Reconnecting += OnReconnecting;
        _connection.Reconnected += OnReconnected;
    }

    /// <summary>
    /// Starts the connection and registers with the server.
    /// </summary>
    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting connection to server: {ServerUrl}", _config.ServerUrl);

        await ConnectWithRetryAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task ConnectWithRetryAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await _connection.StartAsync(cancellationToken).ConfigureAwait(false);
                _isConnected = true;
                _reconnectAttempt = 0;
                _logger.LogInformation("Connected to server successfully");

                // Register with the server. If registration fails, stop the connection
                // so the next retry can start cleanly.
                try
                {
                    await RegisterAsync().ConfigureAwait(false);
                    return;
                }
                catch
                {
                    _isConnected = false;
                    try
                    {
                        await _connection.StopAsync(cancellationToken).ConfigureAwait(false);
                    }
                    catch
                    {
                        // ignore stop failures; we'll retry
                    }
                    throw;
                }
            }
            catch (Exception ex)
            {
                _isConnected = false;
                _reconnectAttempt++;
                var delay = CalculateBackoffDelay();

                _logger.LogWarning(ex, "Failed to connect to server (attempt {Attempt}). Retrying in {Delay}s...",
                    _reconnectAttempt, delay.TotalSeconds);

                try
                {
                    await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }

    private async Task RegisterAsync()
    {
        // Cache metadata - hostname/IP/OS don't change during runtime
        _cachedMetadata ??= new NodeMetadata
        {
            Hostname = Environment.MachineName,
            IpAddress = GetLocalIpAddress(),
            OS = Environment.OSVersion.ToString(),
            AgentVersion = GetAgentVersion()
        };

        _logger.LogInformation("Registering with server as {Hostname}", _cachedMetadata.Hostname);

        try
        {
            _nodeId = await _connection.InvokeAsync<Guid>("Register", _cachedMetadata).ConfigureAwait(false);
            _logger.LogInformation("Registered successfully. Node ID: {NodeId}", _nodeId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to register with server");
            throw;
        }
    }

    /// <summary>
    /// Sends a heartbeat with telemetry data to the server.
    /// Respects exponential backoff if previous heartbeats have failed.
    /// </summary>
    /// <param name="data">Telemetry data to send.</param>
    /// <param name="bypassBackoff">If true, ignores backoff timing (used for admin-triggered pings).</param>
    public async Task SendHeartbeatAsync(TelemetryData data, bool bypassBackoff = false)
    {
        if (!_isConnected || _nodeId == Guid.Empty)
        {
            _logger.LogWarning("Cannot send heartbeat: not connected or not registered");
            return;
        }

        // Check if we should skip due to backoff (unless bypassed for admin pings)
        if (!bypassBackoff && !_heartbeatRetryManager.ShouldAttemptHeartbeat())
        {
            var (failures, nextRetry) = _heartbeatRetryManager.GetStatus();
            _logger.LogDebug(
                "Skipping heartbeat due to backoff (failures: {Failures}, next retry: {NextRetry:O})",
                failures, nextRetry);
            return;
        }

        try
        {
            await _connection.InvokeAsync("SendHeartbeat", _nodeId, data).ConfigureAwait(false);
            _logger.LogDebug("Heartbeat sent successfully");
            _heartbeatRetryManager.RecordSuccess();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send heartbeat");
            var nextRetryTime = _heartbeatRetryManager.RecordFailure();

            // Notify server about backoff status so UI can display it
            await NotifyBackoffStatusAsync(nextRetryTime).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Notifies the server about the current backoff status.
    /// </summary>
    private async Task NotifyBackoffStatusAsync(DateTime nextRetryTime)
    {
        if (!_isConnected || _nodeId == Guid.Empty)
        {
            return;
        }

        try
        {
            var (failures, _) = _heartbeatRetryManager.GetStatus();
            await _connection.InvokeAsync(
                "ReportBackoffStatus",
                _nodeId,
                failures,
                nextRetryTime).ConfigureAwait(false);
            _logger.LogDebug("Backoff status reported: failures={Failures}, nextRetry={NextRetry:O}",
                failures, nextRetryTime);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to report backoff status (non-critical)");
        }
    }

    /// <summary>
    /// Updates the status of a command execution.
    /// </summary>
    public async Task UpdateCommandStatusAsync(Guid commandId, string status, string? logs = null)
    {
        if (!_isConnected)
        {
            _logger.LogWarning("Cannot update command status: not connected");
            return;
        }

        try
        {
            await _connection.InvokeAsync("UpdateCommandStatus", commandId, status, logs).ConfigureAwait(false);
            _logger.LogDebug("Command status updated: {CommandId} -> {Status}", commandId, status);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to update command status");
        }
    }

    private async Task HandleExecuteCommand(Guid commandId, string type, string payload)
    {
        _logger.LogInformation("Received command: {CommandId}, Type: {Type}", commandId, type);

        if (OnCommandReceived != null)
        {
            await OnCommandReceived(commandId, type, payload).ConfigureAwait(false);
        }
    }

    private async Task HandleRequestTelemetry()
    {
        _logger.LogDebug("Server requested telemetry");

        if (OnTelemetryRequested != null)
        {
            await OnTelemetryRequested().ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Handles admin-initiated ping request from server.
    /// Bypasses backoff and resets it on success.
    /// </summary>
    private async Task HandleRequestPing()
    {
        _logger.LogInformation("Admin ping request received");

        if (!_isConnected || _nodeId == Guid.Empty)
        {
            _logger.LogWarning("Cannot respond to ping: not connected or not registered");
            return;
        }

        try
        {
            // Collect and send telemetry immediately, bypassing backoff
            if (OnTelemetryRequested != null)
            {
                await OnTelemetryRequested().ConfigureAwait(false);
            }

            // Reset backoff on successful admin ping
            _heartbeatRetryManager.Reset();

            // Notify server of ping success
            await _connection.InvokeAsync("PingResponse", _nodeId, true, (DateTime?)null)
                .ConfigureAwait(false);
            
            _logger.LogInformation("Admin ping response sent successfully, backoff reset");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to respond to admin ping");

            try
            {
                // Notify server of ping failure with current backoff status
                var (failures, nextRetry) = _heartbeatRetryManager.GetStatus();
                await _connection.InvokeAsync("PingResponse", _nodeId, false, nextRetry)
                    .ConfigureAwait(false);
            }
            catch
            {
                // Ignore nested failures
            }
        }
    }

    private Task OnConnectionClosed(Exception? exception)
    {
        _isConnected = false;

        if (exception != null)
        {
            _logger.LogWarning(exception, "Connection closed unexpectedly");
        }
        else
        {
            _logger.LogInformation("Connection closed");
        }

        return Task.CompletedTask;
    }

    private Task OnReconnecting(Exception? exception)
    {
        _isConnected = false;
        _logger.LogWarning("Connection lost. Attempting to reconnect...");
        return Task.CompletedTask;
    }

    private async Task OnReconnected(string? connectionId)
    {
        _isConnected = true;
        _reconnectAttempt = 0;
        _logger.LogInformation("Reconnected to server. Connection ID: {ConnectionId}", connectionId);

        // Re-register after reconnection
        await RegisterAsync().ConfigureAwait(false);
    }

    private TimeSpan CalculateBackoffDelay()
    {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (capped)
        var delaySeconds = Math.Min(Math.Pow(2, _reconnectAttempt - 1), _config.MaxReconnectDelaySeconds);
        return TimeSpan.FromSeconds(delaySeconds);
    }

    private static string? GetLocalIpAddress()
    {
        try
        {
            var hostName = System.Net.Dns.GetHostName();
            var addresses = System.Net.Dns.GetHostAddresses(hostName);
            
            foreach (var address in addresses)
            {
                if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                {
                    return address.ToString();
                }
            }
        }
        catch
        {
            // Ignore errors getting IP
        }

        return null;
    }

    private static string GetAgentVersion()
    {
        return typeof(ConnectionManager).Assembly.GetName().Version?.ToString() ?? "1.0.0";
    }

    public async ValueTask DisposeAsync()
    {
        await _connection.DisposeAsync().ConfigureAwait(false);
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// Retry policy that implements exponential backoff for SignalR reconnection.
/// </summary>
internal class ExponentialBackoffRetryPolicy : IRetryPolicy
{
    private readonly int _maxDelaySeconds;

    public ExponentialBackoffRetryPolicy(int maxDelaySeconds)
    {
        _maxDelaySeconds = maxDelaySeconds;
    }

    public TimeSpan? NextRetryDelay(RetryContext retryContext)
    {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s... capped at max
        var delaySeconds = Math.Min(Math.Pow(2, retryContext.PreviousRetryCount), _maxDelaySeconds);
        return TimeSpan.FromSeconds(delaySeconds);
    }
}
