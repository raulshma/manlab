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
    private readonly CancellationTokenSource _cts = new();
    
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

    public ConnectionManager(ILogger<ConnectionManager> logger, AgentConfiguration config)
    {
        _logger = logger;
        _config = config;

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
                    options.Headers.Add("Authorization", $"Bearer {_config.AuthToken}");
                }
            })
            .WithAutomaticReconnect(new ExponentialBackoffRetryPolicy(_config.MaxReconnectDelaySeconds));

        _connection = builder.Build();

        // Register event handlers for server-to-agent methods
        _connection.On<Guid, string, string>("ExecuteCommand", HandleExecuteCommand);
        _connection.On("RequestTelemetry", HandleRequestTelemetry);

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
    /// </summary>
    public async Task SendHeartbeatAsync(TelemetryData data)
    {
        if (!_isConnected || _nodeId == Guid.Empty)
        {
            _logger.LogWarning("Cannot send heartbeat: not connected or not registered");
            return;
        }

        try
        {
            await _connection.InvokeAsync("SendHeartbeat", _nodeId, data).ConfigureAwait(false);
            _logger.LogDebug("Heartbeat sent successfully");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send heartbeat");
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
        await _cts.CancelAsync().ConfigureAwait(false);
        await _connection.DisposeAsync().ConfigureAwait(false);
        _cts.Dispose();
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
