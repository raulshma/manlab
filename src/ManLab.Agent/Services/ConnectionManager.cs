using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using ManLab.Agent.Networking;


namespace ManLab.Agent.Services;

/// <summary>
/// Manages the SignalR connection to the ManLab server with exponential backoff reconnection.
/// </summary>
public sealed class ConnectionManager : IAsyncDisposable
{
    // Keep outbound chunks comfortably below server HubOptions.MaximumReceiveMessageSize (128KB).
    private const int MaxOutboundTextChunkChars = 16 * 1024;
    private readonly ILogger<ConnectionManager> _logger;
    private readonly AgentConfiguration _config;
    private readonly HubConnection _connection;
    private readonly HeartbeatRetryManager _heartbeatRetryManager;

    private Guid _nodeId;
    private int _reconnectAttempt;
    private bool _isConnected;
    private bool _isRegistered;
    private NodeMetadata? _cachedMetadata;

    // Prevent concurrent (re)registration attempts during reconnects.
    private readonly SemaphoreSlim _registerGate = new(1, 1);
    private CancellationTokenSource? _registrationLoopCts;
    private Task? _registrationLoopTask;

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
    public bool IsConnected => _isConnected && _isRegistered;

    /// <summary>
    /// Gets whether the SignalR transport is currently connected (may not be registered yet).
    /// </summary>
    public bool IsTransportConnected => _isConnected;

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
        Log.ConnectionStarting(_logger, _config.ServerUrl);

        await ConnectWithRetryAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task ConnectWithRetryAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            // Check if we've hit a fatal error state and should stop retrying
            if (_heartbeatRetryManager.IsFatallyErrored)
            {
                _logger.LogError(
                    "Agent is in fatal error state (code: {ErrorCode}, message: {ErrorMessage}). " +
                    "Not retrying. Restart agent or wait for admin reset.",
                    _heartbeatRetryManager.ErrorCode,
                    _heartbeatRetryManager.ErrorMessage);
                return;
            }

            try
            {
                await _connection.StartAsync(cancellationToken).ConfigureAwait(false);
                _isConnected = true;
                _isRegistered = false;
                _reconnectAttempt = 0;
                Log.ConnectionEstablished(_logger);

                // Register with the server. If registration fails, stop the connection
                // so the next retry can start cleanly.
                try
                {
                    await RegisterAsync().ConfigureAwait(false);
                    _isRegistered = true;
                    return;
                }
                catch (Exception regEx)
                {
                    _isConnected = false;
                    _isRegistered = false;
                    try
                    {
                        await _connection.StopAsync(cancellationToken).ConfigureAwait(false);
                    }
                    catch
                    {
                        // ignore stop failures; we'll retry
                    }

                    // Check if this is a non-transient error
                    if (TryExtractNonTransientError(regEx, out var errorCode, out var errorMessage))
                    {
                        var shouldStop = _heartbeatRetryManager.RecordNonTransientFailure(errorCode, errorMessage);
                        if (shouldStop)
                        {
                            // Report error to server and stop retrying
                            await ReportErrorStatusAsync(errorCode, errorMessage).ConfigureAwait(false);
                            return;
                        }
                        // Wait for backoff before retrying
                        var nextRetry = _heartbeatRetryManager.NextRetryTimeUtc;
                        if (nextRetry.HasValue)
                        {
                            var backoffDelay = nextRetry.Value - DateTime.UtcNow;
                            if (backoffDelay > TimeSpan.Zero)
                            {
                                try
                                {
                                    await Task.Delay(backoffDelay, cancellationToken).ConfigureAwait(false);
                                }
                                catch (OperationCanceledException)
                                {
                                    return;
                                }
                            }
                        }
                        continue;
                    }

                    throw;
                }
            }
            catch (Exception ex)
            {
                _isConnected = false;
                _isRegistered = false;

                // Check if this is a non-transient error (e.g., 401 during connection)
                if (TryExtractNonTransientError(ex, out var errorCode, out var errorMessage))
                {
                    var shouldStop = _heartbeatRetryManager.RecordNonTransientFailure(errorCode, errorMessage);
                    if (shouldStop)
                    {
                        // Report error to server and stop retrying
                        await ReportErrorStatusAsync(errorCode, errorMessage).ConfigureAwait(false);
                        return;
                    }
                    // Wait for backoff before retrying
                    var nextRetry = _heartbeatRetryManager.NextRetryTimeUtc;
                    if (nextRetry.HasValue)
                    {
                        var backoffDelay = nextRetry.Value - DateTime.UtcNow;
                        if (backoffDelay > TimeSpan.Zero)
                        {
                            try
                            {
                                await Task.Delay(backoffDelay, cancellationToken).ConfigureAwait(false);
                            }
                            catch (OperationCanceledException)
                            {
                                return;
                            }
                        }
                    }
                    continue;
                }

                // Regular transient error - use standard backoff
                _reconnectAttempt++;
                var delay = CalculateBackoffDelay();

                Log.ConnectionRetrying(_logger, ex, _reconnectAttempt, delay.TotalSeconds);

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
        // Cache metadata - but refresh fields that can change (IP/interface) on every (re)register.
        var primaryInterfaceName = SelectPrimaryInterfaceName();
        var primaryNic = NetworkInterfaceSelector.TryGetInterfaceByName(primaryInterfaceName);
        
        _cachedMetadata ??= new NodeMetadata
        {
            Hostname = Environment.MachineName,
            IpAddress = null,
            OS = Environment.OSVersion.ToString(),
            AgentVersion = null,
            CapabilitiesJson = BuildCapabilitiesJson(),
            PrimaryInterface = primaryInterfaceName,
            MacAddress = NetworkInterfaceSelector.TryGetMacAddress(primaryNic)
        };

        // Defensive: if config changed between runs and we already cached metadata,
        // ensure we at least populate missing optional fields.
        _cachedMetadata.CapabilitiesJson ??= BuildCapabilitiesJson();
        _cachedMetadata.PrimaryInterface = primaryInterfaceName;
        _cachedMetadata.MacAddress = NetworkInterfaceSelector.TryGetMacAddress(primaryNic);

        // Refresh dynamic values.
        _cachedMetadata.IpAddress = GetLocalIpAddress(primaryNic);
        _cachedMetadata.AgentVersion = GetAgentVersion();

        _logger.LogInformation("Registering with server as {Hostname}", _cachedMetadata.Hostname);

        try
        {
            _nodeId = await _connection.InvokeAsync<Guid>("Register", _cachedMetadata).ConfigureAwait(false);
            Log.RegistrationComplete(_logger, _nodeId);
        }
        catch (Exception ex)
        {
            Log.RegistrationFailed(_logger, ex);
            throw;
        }
    }

    private void StartRegistrationLoopIfNeeded()
    {
        // If already registered, nothing to do.
        if (_isRegistered)
        {
            return;
        }

        // If a loop is already running, keep it.
        if (_registrationLoopTask is { IsCompleted: false })
        {
            return;
        }

        _registrationLoopCts?.Cancel();
        _registrationLoopCts?.Dispose();
        _registrationLoopCts = new CancellationTokenSource();

        _registrationLoopTask = Task.Run(
            () => RegistrationLoopAsync(_registrationLoopCts.Token),
            CancellationToken.None);
    }

    private async Task RegistrationLoopAsync(CancellationToken cancellationToken)
    {
        // Best-effort: attempt to (re)register until success or we detect a non-transient error.
        // This avoids a race where the transport reconnects but the hub context isn't rebound yet.

        var attempt = 0;

        while (!cancellationToken.IsCancellationRequested)
        {
            if (!_isConnected)
            {
                return;
            }

            if (_heartbeatRetryManager.IsFatallyErrored)
            {
                return;
            }

            if (_isRegistered)
            {
                return;
            }

            attempt++;

            try
            {
                await _registerGate.WaitAsync(cancellationToken).ConfigureAwait(false);
                try
                {
                    // Another attempt may have completed while we were waiting.
                    if (_isRegistered)
                    {
                        return;
                    }

                    await RegisterAsync().ConfigureAwait(false);
                    _isRegistered = true;
                    _heartbeatRetryManager.RecordSuccess();
                    _logger.LogInformation("Registration complete after reconnect (attempt {Attempt})", attempt);
                    return;
                }
                finally
                {
                    _registerGate.Release();
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                // If this looks like an auth/non-transient issue, stop retrying and enter fatal state.
                if (TryExtractNonTransientError(ex, out var errorCode, out var errorMessage))
                {
                    var shouldStop = _heartbeatRetryManager.RecordNonTransientFailure(errorCode, errorMessage);
                    if (shouldStop)
                    {
                        _logger.LogError(ex, "Registration failed with non-transient error; entering fatal state");
                        return;
                    }
                }

                // Transient failure: retry with bounded exponential backoff.
                var backoffSeconds = Math.Min(Math.Pow(2, Math.Min(attempt, 10) - 1), _config.MaxReconnectDelaySeconds);
                var jitter = Random.Shared.NextDouble() * 0.2 - 0.1;
                backoffSeconds *= (1 + jitter);
                var delay = TimeSpan.FromSeconds(Math.Max(1, backoffSeconds));

                _logger.LogWarning(ex, "Registration retry scheduled in {DelaySeconds:F1}s (attempt {Attempt})", delay.TotalSeconds, attempt);

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

    /// <summary>
    /// Sends a heartbeat with telemetry data to the server.
    /// Respects exponential backoff if previous heartbeats have failed.
    /// </summary>
    /// <param name="data">Telemetry data to send.</param>
    /// <param name="bypassBackoff">If true, ignores backoff timing (used for admin-triggered pings).</param>
    public async Task SendHeartbeatAsync(TelemetryData data, bool bypassBackoff = false)
    {
        if (!_isConnected || !_isRegistered || _nodeId == Guid.Empty)
        {
            _logger.LogWarning("Cannot send heartbeat: not connected or not registered");
            return;
        }

        // Check if we should skip due to backoff (unless bypassed for admin pings)
        if (!bypassBackoff && !_heartbeatRetryManager.ShouldAttemptHeartbeat())
        {
            var (failures, nextRetry) = _heartbeatRetryManager.GetStatus();
            Log.HeartbeatSkippedBackoff(_logger, failures, nextRetry);
            return;
        }

        try
        {
            await _connection.InvokeAsync("SendHeartbeat", _nodeId, data).ConfigureAwait(false);
            Log.HeartbeatSent(_logger);
            _heartbeatRetryManager.RecordSuccess();
        }
        catch (Exception ex)
        {
            Log.HeartbeatFailed(_logger, ex);
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
        if (!_isConnected || !_isRegistered)
        {
            _logger.LogWarning("Cannot update command status: not connected");
            return;
        }

        try
        {
            if (string.IsNullOrEmpty(logs) || logs.Length <= MaxOutboundTextChunkChars)
            {
                await _connection.InvokeAsync("UpdateCommandStatus", commandId, status, logs).ConfigureAwait(false);
            }
            else
            {
                // Chunk large logs into multiple hub invocations.
                //
                // Special handling for file browser structured JSON results: if we send status=Success for the first chunk,
                // the server may pick up a terminal state and attempt to deserialize partial JSON.
                // We send status=InProgress for intermediate chunks and only send the original status for the final chunk.
                var isStructuredFileBrowserJson = LooksLikeFileBrowserStructuredJson(logs);
                var intermediateStatus = isStructuredFileBrowserJson
                    ? "InProgress"
                    : status;

                for (var i = 0; i < logs.Length; i += MaxOutboundTextChunkChars)
                {
                    var len = Math.Min(MaxOutboundTextChunkChars, logs.Length - i);
                    var chunk = logs.Substring(i, len);
                    var isLast = (i + len) >= logs.Length;

                    var chunkStatus = isStructuredFileBrowserJson
                        ? (isLast ? status : intermediateStatus)
                        : status;

                    await _connection.InvokeAsync("UpdateCommandStatus", commandId, chunkStatus, chunk).ConfigureAwait(false);
                }
            }
            _logger.LogDebug("Command status updated: {CommandId} -> {Status}", commandId, status);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to update command status");
        }
    }

    private static bool LooksLikeFileBrowserStructuredJson(string logs)
    {
        // We only want to apply the intermediate InProgress chunking trick for the structured JSON outputs
        // used by file.list and file.read.
        //
        // Heuristic: must start like JSON and contain expected keys.
        if (string.IsNullOrWhiteSpace(logs))
        {
            return false;
        }

        var trimmed = logs.TrimStart();
        if (!(trimmed.StartsWith('{') || trimmed.StartsWith('[')))
        {
            return false;
        }

        // file.read: contentBase64, bytesRead, totalBytes
        // file.list: entries, truncated
        return trimmed.Contains("\"contentBase64\"", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("\"bytesRead\"", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("\"totalBytes\"", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("\"entries\"", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Sends service status snapshots to the server for persistence.
    /// </summary>
    public async Task SendServiceStatusSnapshotsAsync(IReadOnlyList<ServiceStatusSnapshotIngest> snapshots)
    {
        if (!_isConnected || !_isRegistered || _nodeId == Guid.Empty)
        {
            _logger.LogWarning("Cannot send service status snapshots: not connected or not registered");
            return;
        }

        if (snapshots is null || snapshots.Count == 0)
        {
            return;
        }

        try
        {
            await _connection.InvokeAsync("SendServiceStatusSnapshots", _nodeId, snapshots.ToList()).ConfigureAwait(false);
            _logger.LogDebug("Service status snapshots sent: {Count}", snapshots.Count);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send service status snapshots");
        }
    }

    /// <summary>
    /// Sends SMART drive snapshots to the server for persistence.
    /// </summary>
    public async Task SendSmartDriveSnapshotsAsync(IReadOnlyList<SmartDriveSnapshotIngest> snapshots)
    {
        if (!_isConnected || !_isRegistered || _nodeId == Guid.Empty)
        {
            _logger.LogWarning("Cannot send SMART drive snapshots: not connected or not registered");
            return;
        }

        if (snapshots is null || snapshots.Count == 0)
        {
            return;
        }

        try
        {
            await _connection.InvokeAsync("SendSmartDriveSnapshots", _nodeId, snapshots.ToList()).ConfigureAwait(false);
            _logger.LogDebug("SMART drive snapshots sent: {Count}", snapshots.Count);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send SMART drive snapshots");
        }
    }

    /// <summary>
    /// Sends terminal output to the server for streaming to dashboard clients.
    /// </summary>
    /// <param name="sessionId">The terminal session ID.</param>
    /// <param name="output">The output chunk to send.</param>
    /// <param name="isClosed">True if the session has ended.</param>
    public async Task SendTerminalOutputAsync(Guid sessionId, string output, bool isClosed)
    {
        if (!_isConnected || !_isRegistered)
        {
            _logger.LogWarning("Cannot send terminal output: not connected");
            return;
        }

        try
        {
                output ??= string.Empty;
                if (output.Length <= MaxOutboundTextChunkChars)
                {
                    await _connection.InvokeAsync("SendTerminalOutput", sessionId, output, isClosed).ConfigureAwait(false);
                }
                else
                {
                    // Send all but last chunk with isClosed=false, then final chunk carries isClosed.
                    var offset = 0;
                    while (offset < output.Length)
                    {
                        var len = Math.Min(MaxOutboundTextChunkChars, output.Length - offset);
                        var chunk = output.Substring(offset, len);
                        offset += len;

                        var closedFlag = isClosed && offset >= output.Length;
                        await _connection.InvokeAsync("SendTerminalOutput", sessionId, chunk, closedFlag).ConfigureAwait(false);
                    }
                }

                _logger.LogDebug("Terminal output sent for session {SessionId}: {Length} chars, closed={IsClosed}", 
                    sessionId, output.Length, isClosed);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send terminal output for session {SessionId}", sessionId);
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

        if (!_isConnected || !_isRegistered || _nodeId == Guid.Empty)
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
        _isRegistered = false;

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
        _isRegistered = false;
        _logger.LogWarning("Connection lost. Attempting to reconnect...");
        return Task.CompletedTask;
    }

    private async Task OnReconnected(string? connectionId)
    {
        _isConnected = true;
        _isRegistered = false;
        _reconnectAttempt = 0;
        _logger.LogInformation("Reconnected to server. Connection ID: {ConnectionId}", connectionId);

        // Re-register after reconnection (in a loop to handle transient failures).
        StartRegistrationLoopIfNeeded();

        // Await the current loop once so that callers can observe readiness shortly after reconnect.
        // If the loop fails, we remain unregistered and telemetry will be gated.
        var loop = _registrationLoopTask;
        if (loop is not null)
        {
            try
            {
                await loop.ConfigureAwait(false);
            }
            catch
            {
                // Swallow: registration loop logs failures and may intentionally stop on fatal auth errors.
            }
        }
    }

    private TimeSpan CalculateBackoffDelay()
    {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (capped)
        var delaySeconds = Math.Min(Math.Pow(2, _reconnectAttempt - 1), _config.MaxReconnectDelaySeconds);
        return TimeSpan.FromSeconds(delaySeconds);
    }

    /// <summary>
    /// Checks if an exception represents a non-transient error that should not be retried indefinitely.
    /// Non-transient errors include: 401 Unauthorized, 403 Forbidden, and SignalR HubExceptions with auth messages.
    /// </summary>
    private static bool TryExtractNonTransientError(Exception ex, out int errorCode, out string errorMessage)
    {
        errorCode = 0;
        errorMessage = string.Empty;

        // Check for HTTP status codes in the exception message or inner exceptions
        var current = ex;
        while (current != null)
        {
            // SignalR HubException with auth-related message
            if (current is Microsoft.AspNetCore.SignalR.HubException hubEx)
            {
                var msg = hubEx.Message ?? string.Empty;
                if (msg.Contains("Unauthorized", StringComparison.OrdinalIgnoreCase) ||
                    msg.Contains("401", StringComparison.OrdinalIgnoreCase))
                {
                    errorCode = 401;
                    errorMessage = msg;
                    return true;
                }
                if (msg.Contains("Forbidden", StringComparison.OrdinalIgnoreCase) ||
                    msg.Contains("403", StringComparison.OrdinalIgnoreCase))
                {
                    errorCode = 403;
                    errorMessage = msg;
                    return true;
                }
                if (msg.Contains("invalid", StringComparison.OrdinalIgnoreCase) &&
                    msg.Contains("token", StringComparison.OrdinalIgnoreCase))
                {
                    errorCode = 401;
                    errorMessage = msg;
                    return true;
                }
            }

            // Check for HttpRequestException with status code
            if (current is System.Net.Http.HttpRequestException httpEx)
            {
                if (httpEx.StatusCode.HasValue)
                {
                    var statusCode = (int)httpEx.StatusCode.Value;
                    // 401, 403 are definitely non-transient
                    // 400 series (except 408 timeout, 429 rate limit) are generally non-transient
                    if (statusCode == 401 || statusCode == 403)
                    {
                        errorCode = statusCode;
                        errorMessage = httpEx.Message;
                        return true;
                    }
                }
            }

            // Check message for HTTP status patterns
            var message = current.Message ?? string.Empty;
            if (message.Contains("401", StringComparison.OrdinalIgnoreCase) ||
                message.Contains("Unauthorized", StringComparison.OrdinalIgnoreCase))
            {
                errorCode = 401;
                errorMessage = message;
                return true;
            }
            if (message.Contains("403", StringComparison.OrdinalIgnoreCase) ||
                message.Contains("Forbidden", StringComparison.OrdinalIgnoreCase))
            {
                errorCode = 403;
                errorMessage = message;
                return true;
            }

            current = current.InnerException;
        }

        return false;
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            _registrationLoopCts?.Cancel();
        }
        catch
        {
            // ignore
        }

        try
        {
            if (_registrationLoopTask is not null)
            {
                await _registrationLoopTask.ConfigureAwait(false);
            }
        }
        catch
        {
            // ignore
        }

        _registrationLoopCts?.Dispose();
        _registerGate.Dispose();

        try
        {
            await _connection.DisposeAsync().ConfigureAwait(false);
        }
        catch
        {
            // ignore
        }

        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Reports the fatal error status to the server so it can display in the UI.
    /// This is best-effort; if the connection is down, it will be logged locally.
    /// </summary>
    private async Task ReportErrorStatusAsync(int errorCode, string errorMessage)
    {
        _logger.LogWarning(
            "Reporting fatal error to server: code={ErrorCode}, message={ErrorMessage}",
            errorCode, errorMessage);

        // If we have a valid node ID and can reach the server, report the error
        if (_nodeId != Guid.Empty && _connection.State == HubConnectionState.Connected)
        {
            try
            {
                await _connection.InvokeAsync("ReportErrorStatus", _nodeId, errorCode, errorMessage)
                    .ConfigureAwait(false);
                _logger.LogInformation("Error status reported to server successfully");
            }
            catch (Exception ex)
            {
                // Can't report to server - just log locally
                _logger.LogWarning(ex, "Failed to report error status to server (will retry on next connection)");
            }
        }
        else
        {
            _logger.LogWarning(
                "Cannot report error to server: nodeId={NodeId}, connectionState={ConnectionState}",
                _nodeId, _connection.State);
        }
    }


    private static string? GetLocalIpAddress(NetworkInterface? primaryNic)
    {
        try
        {
            // Prefer the selected primary NIC if we have one.
            if (primaryNic is not null)
            {
                var props = primaryNic.GetIPProperties();
                var ip = props.UnicastAddresses
                    .Select(a => a.Address)
                    .FirstOrDefault(a =>
                        a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork &&
                        !System.Net.IPAddress.IsLoopback(a) &&
                        !a.Equals(System.Net.IPAddress.Any) &&
                        !a.Equals(System.Net.IPAddress.None) &&
                        !a.ToString().StartsWith("169.254.", StringComparison.Ordinal));

                if (ip is not null)
                {
                    return ip.ToString();
                }
            }

            // Fallback: pick a NIC that looks like it has a default gateway.
            var candidates = NetworkInterface.GetAllNetworkInterfaces()
                .Where(nic => nic.OperationalStatus == OperationalStatus.Up)
                .Where(nic => nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .Where(nic => nic.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .Select(nic => new { Nic = nic, Props = nic.GetIPProperties() })
                .ToList();

            foreach (var c in candidates.OrderByDescending(c => c.Props.GatewayAddresses.Count))
            {
                var ip = c.Props.UnicastAddresses
                    .Select(a => a.Address)
                    .FirstOrDefault(a =>
                        a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork &&
                        !System.Net.IPAddress.IsLoopback(a) &&
                        !a.ToString().StartsWith("169.254.", StringComparison.Ordinal));

                if (ip is not null)
                {
                    return ip.ToString();
                }
            }

            // Last resort: DNS host addresses.
            var hostName = System.Net.Dns.GetHostName();
            var addresses = System.Net.Dns.GetHostAddresses(hostName);

            foreach (var address in addresses)
            {
                if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork &&
                    !System.Net.IPAddress.IsLoopback(address) &&
                    !address.ToString().StartsWith("169.254.", StringComparison.Ordinal))
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
        // Allow explicit override (useful for installer/build pipelines).
        var fromEnv = Environment.GetEnvironmentVariable("MANLAB_AGENT_VERSION");
        var normalized = NormalizeVersionString(fromEnv);
        if (!string.IsNullOrWhiteSpace(normalized))
        {
            return normalized;
        }

        // Prefer informational version if present (often includes prerelease/build metadata).
        try
        {
            var asm = typeof(ConnectionManager).Assembly;
            var info = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
            normalized = NormalizeVersionString(info);
            if (!string.IsNullOrWhiteSpace(normalized))
            {
                return normalized;
            }
        }
        catch
        {
            // ignore
        }

        // Next best: file version (Windows), if available.
        try
        {
            var path = Environment.ProcessPath;
            if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
            {
                var fvi = FileVersionInfo.GetVersionInfo(path);
                normalized = NormalizeVersionString(fvi.ProductVersion) ?? NormalizeVersionString(fvi.FileVersion);
                if (!string.IsNullOrWhiteSpace(normalized))
                {
                    return normalized;
                }
            }
        }
        catch
        {
            // ignore
        }

        return typeof(ConnectionManager).Assembly.GetName().Version?.ToString() ?? "1.0.0";
    }

    private static string? NormalizeVersionString(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        raw = raw.Trim();

        // Strip common prefix.
        if (raw.StartsWith("v", StringComparison.OrdinalIgnoreCase) && raw.Length > 1)
        {
            raw = raw.Substring(1);
        }

        // Keep display stable: strip build metadata (e.g. "+abcdef") but keep prerelease.
        var plus = raw.IndexOf('+');
        if (plus > 0)
        {
            raw = raw.Substring(0, plus);
        }

        return raw;
    }

    private string? SelectPrimaryInterfaceName()
    {
        return NetworkInterfaceSelector.SelectPrimaryInterfaceName(_config.PrimaryInterfaceName, _logger);
    }

    private string? BuildCapabilitiesJson()
    {
        try
        {
            var capabilities = new AgentCapabilities
            {
                Tools = new AgentToolCapabilities
                {
                    Smartctl = HasToolOnPath("smartctl"),
                    NvidiaSmi = HasToolOnPath("nvidia-smi"),
                    Upsc = HasToolOnPath("upsc"),
                    Apcaccess = HasToolOnPath("apcaccess")
                },
                Features = new AgentFeatureCapabilities
                {
                    LogViewer = _config.EnableLogViewer,
                    Scripts = _config.EnableScripts,
                    Terminal = _config.EnableTerminal,
                    FileBrowser = _config.EnableFileBrowser
                }
            };

            // NativeAOT-safe: serialize using source-generated type metadata.
            return JsonSerializer.Serialize(capabilities, ManLabJsonContext.Default.AgentCapabilities);
        }
        catch (Exception ex)
        {
            // Capabilities are optional; never fail registration due to detection/serialization.
            _logger.LogDebug(ex, "Failed to build capabilities JSON");
            return null;
        }
    }

    private static bool HasToolOnPath(string baseName)
    {
        // Note: we intentionally do *not* execute these tools; presence is enough.
        // Keep logic AOT-friendly (no reflection, no P/Invokes).

        var isWindows = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);
        var fileNames = isWindows
            ? new[] { baseName + ".exe", baseName + ".cmd", baseName + ".bat", baseName }
            : new[] { baseName };

        // PATH lookup
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        var separators = isWindows ? new[] { ';' } : new[] { ':' };
        var pathEntries = path.Split(separators, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var entry in pathEntries)
        {
            foreach (var fileName in fileNames)
            {
                try
                {
                    var candidate = Path.Combine(entry, fileName);
                    if (File.Exists(candidate))
                    {
                        return true;
                    }
                }
                catch
                {
                    // ignore malformed paths
                }
            }
        }

        // Common non-PATH locations on Linux
        if (!isWindows)
        {
            var common = new[] { "/usr/sbin", "/sbin", "/usr/local/sbin", "/usr/bin", "/bin" };
            foreach (var dir in common)
            {
                try
                {
                    var candidate = Path.Combine(dir, baseName);
                    if (File.Exists(candidate))
                    {
                        return true;
                    }
                }
                catch
                {
                    // ignore
                }
            }
        }

        return false;
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
