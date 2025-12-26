using Microsoft.Extensions.Logging;
using System.Text.Json;

namespace ManLab.Agent.Commands;

/// <summary>
/// Dispatches commands received from the server to appropriate handlers.
/// </summary>
public class CommandDispatcher
{
    private readonly ILoggerFactory _loggerFactory;
    private readonly ILogger<CommandDispatcher> _logger;
    private readonly Func<Guid, string, string?, Task> _updateStatusCallback;
    private readonly DockerManager _dockerManager;

    public CommandDispatcher(
        ILoggerFactory loggerFactory, 
        Func<Guid, string, string?, Task> updateStatusCallback)
    {
        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<CommandDispatcher>();
        _updateStatusCallback = updateStatusCallback;
        _dockerManager = new DockerManager(loggerFactory.CreateLogger<DockerManager>());
    }

    /// <summary>
    /// Dispatches a command to the appropriate handler based on type.
    /// </summary>
    /// <param name="commandId">The command ID for tracking.</param>
    /// <param name="type">The command type (e.g., "docker.list", "system.update").</param>
    /// <param name="payload">JSON payload with command-specific parameters.</param>
    public async Task DispatchAsync(Guid commandId, string type, string payload, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Dispatching command {CommandId}: {Type}", commandId, type);

        try
        {
            await _updateStatusCallback(commandId, "InProgress", $"Executing command: {type}");

            var result = type.ToLowerInvariant() switch
            {
                "docker.list" => await HandleDockerListAsync(cancellationToken),
                "docker.restart" => await HandleDockerRestartAsync(payload, cancellationToken),
                "docker.stop" => await HandleDockerStopAsync(payload, cancellationToken),
                "docker.start" => await HandleDockerStartAsync(payload, cancellationToken),
                "system.update" => await HandleSystemUpdateAsync(commandId, cancellationToken),
                _ => throw new NotSupportedException($"Unknown command type: {type}")
            };

            // For non-streaming commands, send the final status
            if (!type.Equals("system.update", StringComparison.OrdinalIgnoreCase))
            {
                await _updateStatusCallback(commandId, "Success", result);
            }
        }
        catch (NotSupportedException ex)
        {
            _logger.LogWarning(ex, "Unknown command type: {Type}", type);
            await _updateStatusCallback(commandId, "Failed", $"Unknown command type: {type}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Command execution failed: {CommandId}", commandId);
            await _updateStatusCallback(commandId, "Failed", $"Error: {ex.Message}");
        }
    }

    private async Task<string> HandleDockerListAsync(CancellationToken cancellationToken)
    {
        return await _dockerManager.ListContainersAsync(cancellationToken);
    }

    private async Task<string> HandleDockerRestartAsync(string payload, CancellationToken cancellationToken)
    {
        var containerId = ExtractContainerId(payload);
        if (string.IsNullOrEmpty(containerId))
        {
            return JsonSerializer.Serialize(new { error = "Container ID is required" });
        }
        return await _dockerManager.RestartContainerAsync(containerId, cancellationToken);
    }

    private async Task<string> HandleDockerStopAsync(string payload, CancellationToken cancellationToken)
    {
        var containerId = ExtractContainerId(payload);
        if (string.IsNullOrEmpty(containerId))
        {
            return JsonSerializer.Serialize(new { error = "Container ID is required" });
        }
        return await _dockerManager.StopContainerAsync(containerId, cancellationToken);
    }

    private async Task<string> HandleDockerStartAsync(string payload, CancellationToken cancellationToken)
    {
        var containerId = ExtractContainerId(payload);
        if (string.IsNullOrEmpty(containerId))
        {
            return JsonSerializer.Serialize(new { error = "Container ID is required" });
        }
        return await _dockerManager.StartContainerAsync(containerId, cancellationToken);
    }

    private async Task<string> HandleSystemUpdateAsync(Guid commandId, CancellationToken cancellationToken)
    {
        var executor = new UpdateExecutor(
            _loggerFactory.CreateLogger<UpdateExecutor>(),
            async (status, logs) => await _updateStatusCallback(commandId, status, logs));

        var (success, output) = await executor.ExecuteUpdateAsync(cancellationToken);
        
        // Status is already updated by the executor, just return the result
        return output;
    }

    private static string? ExtractContainerId(string payload)
    {
        if (string.IsNullOrWhiteSpace(payload))
            return null;

        try
        {
            using var doc = JsonDocument.Parse(payload);
            if (doc.RootElement.TryGetProperty("containerId", out var containerIdElement))
            {
                return containerIdElement.GetString();
            }
            if (doc.RootElement.TryGetProperty("ContainerId", out var containerIdCapElement))
            {
                return containerIdCapElement.GetString();
            }
        }
        catch (JsonException)
        {
            // If payload is not JSON, treat it as the container ID directly
            return payload.Trim();
        }

        return null;
    }

    public void Dispose()
    {
        _dockerManager.Dispose();
    }
}
