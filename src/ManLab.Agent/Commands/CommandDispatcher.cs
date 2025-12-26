using Microsoft.Extensions.Logging;
using System.Text.RegularExpressions;
using System.Text.Json;

namespace ManLab.Agent.Commands;

/// <summary>
/// Dispatches commands received from the server to appropriate handlers.
/// </summary>
public class CommandDispatcher
{
    private const int MaxPayloadChars = 32_768; // hard limit to reduce abuse/memory pressure
    private static readonly Regex ContainerIdOrNameRegex = new(
        "^[a-zA-Z0-9_.-]{1,128}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

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

            var normalizedType = (type ?? string.Empty).Trim().ToLowerInvariant();

            // Strict JSON boundary: if payload is supplied, it must be valid JSON.
            // We no longer accept non-JSON strings and try to "guess" what they mean.
            JsonDocument? payloadDoc = null;
            JsonElement? payloadRoot = null;
            try
            {
                if (!string.IsNullOrWhiteSpace(payload))
                {
                    if (payload.Length > MaxPayloadChars)
                    {
                        throw new ArgumentException($"Command payload too large (max {MaxPayloadChars} characters).", nameof(payload));
                    }

                    try
                    {
                        payloadDoc = JsonDocument.Parse(payload);
                        payloadRoot = payloadDoc.RootElement;
                    }
                    catch (JsonException ex)
                    {
                        throw new ArgumentException("Command payload must be valid JSON.", nameof(payload), ex);
                    }
                }

                var result = normalizedType switch
                {
                    "docker.list" => await HandleDockerListAsync(cancellationToken),
                    "docker.restart" => await HandleDockerRestartAsync(payloadRoot, cancellationToken),
                    "docker.stop" => await HandleDockerStopAsync(payloadRoot, cancellationToken),
                    "docker.start" => await HandleDockerStartAsync(payloadRoot, cancellationToken),
                    "system.update" => await HandleSystemUpdateAsync(commandId, cancellationToken),
                    _ => throw new NotSupportedException($"Unknown command type: {type}")
                };

                // For non-streaming commands, send the final status
                if (!normalizedType.Equals("system.update", StringComparison.OrdinalIgnoreCase))
                {
                    await _updateStatusCallback(commandId, "Success", result);
                }
            }
            finally
            {
                payloadDoc?.Dispose();
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

    private async Task<string> HandleDockerRestartAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        var containerId = ExtractContainerIdStrict(payloadRoot);
        return await _dockerManager.RestartContainerAsync(containerId, cancellationToken);
    }

    private async Task<string> HandleDockerStopAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        var containerId = ExtractContainerIdStrict(payloadRoot);
        return await _dockerManager.StopContainerAsync(containerId, cancellationToken);
    }

    private async Task<string> HandleDockerStartAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        var containerId = ExtractContainerIdStrict(payloadRoot);
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

    private static string ExtractContainerIdStrict(JsonElement? payloadRoot)
    {
        if (payloadRoot is null)
        {
            throw new ArgumentException("Command payload is required and must be a JSON object with a 'containerId' property.");
        }

        var root = payloadRoot.Value;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Command payload must be a JSON object.");
        }

        string? containerId = null;
        if (root.TryGetProperty("containerId", out var containerIdElement))
        {
            containerId = containerIdElement.GetString();
        }
        else if (root.TryGetProperty("ContainerId", out var containerIdCapElement))
        {
            containerId = containerIdCapElement.GetString();
        }

        containerId = containerId?.Trim();
        if (string.IsNullOrWhiteSpace(containerId))
        {
            throw new ArgumentException("Command payload must include a non-empty 'containerId'.");
        }

        if (!ContainerIdOrNameRegex.IsMatch(containerId))
        {
            throw new ArgumentException("Invalid containerId format.");
        }

        return containerId;
    }

    public void Dispose()
    {
        _dockerManager.Dispose();
    }
}
