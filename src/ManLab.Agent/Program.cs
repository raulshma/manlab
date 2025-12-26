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
    loggerFactory.CreateLogger<ConnectionManager>(),
    agentConfig);

// Create telemetry service
await using var telemetryService = new TelemetryService(
    loggerFactory,
    agentConfig,
    async data => await connectionManager.SendHeartbeatAsync(data));

// Handle command execution (placeholder for future implementation)
connectionManager.OnCommandReceived += async (commandId, type, payload) =>
{
    logger.LogInformation("Received command {CommandId}: {Type}", commandId, type);
    // TODO: Implement command execution in phase 2.3
    await connectionManager.UpdateCommandStatusAsync(commandId, "Success", "Command received (placeholder)");
};

// Handle telemetry requests from server
connectionManager.OnTelemetryRequested += async () =>
{
    logger.LogDebug("Telemetry requested by server");
    var data = telemetryService.CollectNow();
    await connectionManager.SendHeartbeatAsync(data);
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
