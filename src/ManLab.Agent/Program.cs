using ManLab.Agent.Configuration;
using ManLab.Agent.Services;
using ManLab.Agent.Telemetry;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

// Build configuration
var configuration = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: true)
    .AddEnvironmentVariables("MANLAB_")
    .Build();

// Configure logging
using var loggerFactory = LoggerFactory.Create(builder =>
{
    builder
        .AddConfiguration(configuration.GetSection("Logging"))
        .AddConsole();
});

var logger = loggerFactory.CreateLogger<Program>();

logger.LogInformation("ManLab Agent starting...");

// Load agent configuration
var agentConfig = new AgentConfiguration();
configuration.GetSection("Agent").Bind(agentConfig);

// Override with environment variables if present
if (Environment.GetEnvironmentVariable("MANLAB_SERVER_URL") is string serverUrl)
{
    agentConfig.ServerUrl = serverUrl;
}
if (Environment.GetEnvironmentVariable("MANLAB_AUTH_TOKEN") is string authToken)
{
    agentConfig.AuthToken = authToken;
}
if (Environment.GetEnvironmentVariable("MANLAB_HEARTBEAT_INTERVAL_SECONDS") is string heartbeatStr 
    && int.TryParse(heartbeatStr, out var heartbeatSeconds))
{
    agentConfig.HeartbeatIntervalSeconds = heartbeatSeconds;
}
if (Environment.GetEnvironmentVariable("MANLAB_MAX_RECONNECT_DELAY_SECONDS") is string reconnectStr 
    && int.TryParse(reconnectStr, out var reconnectSeconds))
{
    agentConfig.MaxReconnectDelaySeconds = reconnectSeconds;
}

if (Environment.GetEnvironmentVariable("MANLAB_PRIMARY_INTERFACE_NAME") is string primaryIf)
{
    agentConfig.PrimaryInterfaceName = primaryIf;
}

if (Environment.GetEnvironmentVariable("MANLAB_ENABLE_NETWORK_TELEMETRY") is string enableNetStr
    && bool.TryParse(enableNetStr, out var enableNet))
{
    agentConfig.EnableNetworkTelemetry = enableNet;
}

if (Environment.GetEnvironmentVariable("MANLAB_ENABLE_PING_TELEMETRY") is string enablePingStr
    && bool.TryParse(enablePingStr, out var enablePing))
{
    agentConfig.EnablePingTelemetry = enablePing;
}

if (Environment.GetEnvironmentVariable("MANLAB_ENABLE_GPU_TELEMETRY") is string enableGpuStr
    && bool.TryParse(enableGpuStr, out var enableGpu))
{
    agentConfig.EnableGpuTelemetry = enableGpu;
}

if (Environment.GetEnvironmentVariable("MANLAB_ENABLE_UPS_TELEMETRY") is string enableUpsStr
    && bool.TryParse(enableUpsStr, out var enableUps))
{
    agentConfig.EnableUpsTelemetry = enableUps;
}

if (Environment.GetEnvironmentVariable("MANLAB_PING_TARGET") is string pingTarget)
{
    agentConfig.PingTarget = pingTarget;
}

if (Environment.GetEnvironmentVariable("MANLAB_PING_TIMEOUT_MS") is string pingTimeoutStr
    && int.TryParse(pingTimeoutStr, out var pingTimeoutMs))
{
    agentConfig.PingTimeoutMs = pingTimeoutMs;
}

if (Environment.GetEnvironmentVariable("MANLAB_PING_WINDOW_SIZE") is string pingWindowStr
    && int.TryParse(pingWindowStr, out var pingWindowSize))
{
    agentConfig.PingWindowSize = pingWindowSize;
}

if (Environment.GetEnvironmentVariable("MANLAB_ENABLE_LOG_VIEWER") is string enableLogsStr
    && bool.TryParse(enableLogsStr, out var enableLogs))
{
    agentConfig.EnableLogViewer = enableLogs;
}

if (Environment.GetEnvironmentVariable("MANLAB_ENABLE_SCRIPTS") is string enableScriptsStr
    && bool.TryParse(enableScriptsStr, out var enableScripts))
{
    agentConfig.EnableScripts = enableScripts;
}

if (Environment.GetEnvironmentVariable("MANLAB_ENABLE_TERMINAL") is string enableTerminalStr
    && bool.TryParse(enableTerminalStr, out var enableTerminal))
{
    agentConfig.EnableTerminal = enableTerminal;
}

logger.LogInformation("Connecting to server: {ServerUrl}", agentConfig.ServerUrl);

// Create cancellation token for graceful shutdown
using var cts = new CancellationTokenSource();

Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    logger.LogInformation("Shutdown requested...");
    cts.Cancel();
};

// Create and start connection manager
await using var connectionManager = new ConnectionManager(
    loggerFactory,
    agentConfig);

// Create telemetry service
await using var telemetryService = new TelemetryService(
    loggerFactory,
    agentConfig,
    async data => await connectionManager.SendHeartbeatAsync(data).ConfigureAwait(false),
    shouldSendTelemetry: () => connectionManager.IsConnected && connectionManager.NodeId != Guid.Empty);

// Create terminal session handler (for restricted terminal feature)
using var terminalHandler = new ManLab.Agent.Commands.TerminalSessionHandler(
    loggerFactory.CreateLogger<ManLab.Agent.Commands.TerminalSessionHandler>(),
    agentConfig,
    async (sessionId, output, isClosed) => await connectionManager.SendTerminalOutputAsync(sessionId, output, isClosed).ConfigureAwait(false));

// Create command dispatcher for handling server commands
using var commandDispatcher = new ManLab.Agent.Commands.CommandDispatcher(
    loggerFactory,
    async (commandId, status, logs) => await connectionManager.UpdateCommandStatusAsync(commandId, status, logs).ConfigureAwait(false),
    async snapshots => await connectionManager.SendServiceStatusSnapshotsAsync(snapshots).ConfigureAwait(false),
    async snapshots => await connectionManager.SendSmartDriveSnapshotsAsync(snapshots).ConfigureAwait(false),
    () => cts.Cancel(),
    agentConfig, // Feature toggles
    terminalHandler); // Terminal session handler

// Handle command execution via dispatcher
connectionManager.OnCommandReceived += async (commandId, type, payload) =>
{
    logger.LogInformation("Received command {CommandId}: {Type}", commandId, type);
    await commandDispatcher.DispatchAsync(commandId, type, payload).ConfigureAwait(false);
};

// Handle telemetry requests from server
connectionManager.OnTelemetryRequested += async () =>
{
    logger.LogDebug("Telemetry requested by server");
    var data = telemetryService.CollectNow();
    await connectionManager.SendHeartbeatAsync(data).ConfigureAwait(false);
};

try
{
    // Start the connection
    await connectionManager.StartAsync(cts.Token);

    // Start telemetry collection loop
    telemetryService.Start();

    // Keep running until cancelled
    logger.LogInformation("Agent running. Press Ctrl+C to stop.");

    try
    {
        await Task.Delay(Timeout.Infinite, cts.Token);
    }
    catch (OperationCanceledException)
    {
        // Expected on shutdown
    }
}
catch (Exception ex)
{
    logger.LogError(ex, "Fatal error in agent");
    return 1;
}

logger.LogInformation("ManLab Agent stopped.");
return 0;
