using Microsoft.Extensions.Logging;
using System.Text.RegularExpressions;
using System.Text.Json;

namespace ManLab.Agent.Commands;

/// <summary>
/// Dispatches commands received from the server to appropriate handlers.
/// </summary>
public sealed class CommandDispatcher : IDisposable
{
    private const int MaxPayloadChars = 32_768; // hard limit to reduce abuse/memory pressure
    private static readonly Regex ContainerIdOrNameRegex = new(
        "^[a-zA-Z0-9_.-]{1,128}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly ILoggerFactory _loggerFactory;
    private readonly ILogger<CommandDispatcher> _logger;
    private readonly Func<Guid, string, string?, Task> _updateStatusCallback;
    private readonly Action? _shutdownCallback;
    private readonly DockerManager _dockerManager;

    public CommandDispatcher(
        ILoggerFactory loggerFactory, 
        Func<Guid, string, string?, Task> updateStatusCallback,
        Action? shutdownCallback = null)
    {
        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<CommandDispatcher>();
        _updateStatusCallback = updateStatusCallback;
        _shutdownCallback = shutdownCallback;
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
            await _updateStatusCallback(commandId, "InProgress", $"Executing command: {type}").ConfigureAwait(false);

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
                    "docker.list" => await HandleDockerListAsync(cancellationToken).ConfigureAwait(false),
                    "docker.restart" => await HandleDockerRestartAsync(payloadRoot, cancellationToken).ConfigureAwait(false),
                    "docker.stop" => await HandleDockerStopAsync(payloadRoot, cancellationToken).ConfigureAwait(false),
                    "docker.start" => await HandleDockerStartAsync(payloadRoot, cancellationToken).ConfigureAwait(false),
                    "system.update" => await HandleSystemUpdateAsync(commandId, cancellationToken).ConfigureAwait(false),
                    "agent.shutdown" => HandleAgentShutdown(),
                    "agent.enabletask" => await HandleTaskControlAsync(enable: true, cancellationToken).ConfigureAwait(false),
                    "agent.disabletask" => await HandleTaskControlAsync(enable: false, cancellationToken).ConfigureAwait(false),
                    "agent.uninstall" => await HandleAgentUninstallAsync(cancellationToken).ConfigureAwait(false),
                    _ => throw new NotSupportedException($"Unknown command type: {type}")
                };

                // For non-streaming commands, send the final status
                if (!normalizedType.Equals("system.update", StringComparison.OrdinalIgnoreCase))
                {
                    await _updateStatusCallback(commandId, "Success", result).ConfigureAwait(false);
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
            await _updateStatusCallback(commandId, "Failed", $"Unknown command type: {type}").ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Command execution failed: {CommandId}", commandId);
            await _updateStatusCallback(commandId, "Failed", $"Error: {ex.Message}").ConfigureAwait(false);
        }
    }

    private async Task<string> HandleDockerListAsync(CancellationToken cancellationToken)
    {
        return await _dockerManager.ListContainersAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<string> HandleDockerRestartAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        var containerId = ExtractContainerIdStrict(payloadRoot);
        return await _dockerManager.RestartContainerAsync(containerId, cancellationToken).ConfigureAwait(false);
    }

    private async Task<string> HandleDockerStopAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        var containerId = ExtractContainerIdStrict(payloadRoot);
        return await _dockerManager.StopContainerAsync(containerId, cancellationToken).ConfigureAwait(false);
    }

    private async Task<string> HandleDockerStartAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        var containerId = ExtractContainerIdStrict(payloadRoot);
        return await _dockerManager.StartContainerAsync(containerId, cancellationToken).ConfigureAwait(false);
    }

    private async Task<string> HandleSystemUpdateAsync(Guid commandId, CancellationToken cancellationToken)
    {
        var executor = new UpdateExecutor(
            _loggerFactory.CreateLogger<UpdateExecutor>(),
            async (status, logs) => await _updateStatusCallback(commandId, status, logs).ConfigureAwait(false));

        var (success, output) = await executor.ExecuteUpdateAsync(cancellationToken).ConfigureAwait(false);
        
        // Status is already updated by the executor, just return the result
        return output;
    }

    private string HandleAgentShutdown()
    {
        _logger.LogInformation("Agent shutdown requested by server");
        
        if (_shutdownCallback is null)
        {
            throw new InvalidOperationException("Shutdown callback not configured.");
        }

        // Schedule shutdown after sending response
        Task.Run(async () =>
        {
            await Task.Delay(500).ConfigureAwait(false); // Give time for status to be sent
            _shutdownCallback();
        });

        return "Agent shutdown initiated. The agent will restart via scheduled task.";
    }

    private async Task<string> HandleTaskControlAsync(bool enable, CancellationToken cancellationToken)
    {
        var action = enable ? "enable" : "disable";
        _logger.LogInformation("Agent task {Action} requested by server", action);

        // Try both task names (system and user mode)
        var taskNames = new[] { "ManLab Agent", "ManLab Agent User" };
        var successResults = new List<string>();
        var errorResults = new List<string>();

        foreach (var taskName in taskNames)
        {
            var command = enable 
                ? $"schtasks /Change /TN \"{taskName}\" /ENABLE"
                : $"schtasks /Change /TN \"{taskName}\" /DISABLE";

            try
            {
                using var process = new System.Diagnostics.Process();
                process.StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "schtasks",
                    Arguments = $"/Change /TN \"{taskName}\" /{(enable ? "ENABLE" : "DISABLE")}",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                process.Start();
                var output = await process.StandardOutput.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
                var error = await process.StandardError.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
                await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);

                if (process.ExitCode == 0)
                {
                    successResults.Add($"{taskName}: {action}d successfully");
                    _logger.LogInformation("Task {TaskName} {Action}d successfully", taskName, action);
                }
                else
                {
                    // Task might not exist (e.g., wrong install mode)
                    _logger.LogDebug("Task {TaskName} not found or failed: {Error}", taskName, error.Trim());
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to {Action} task {TaskName}", action, taskName);
            }
        }

        if (successResults.Count > 0)
        {
            return string.Join("; ", successResults);
        }

        return $"No scheduled tasks found to {action}. The agent may be running in a different mode.";
    }

    private async Task<string> HandleAgentUninstallAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Agent uninstall requested by server");

        var results = new List<string>();

        // Step 1: Delete scheduled tasks
        var taskNames = new[] { "ManLab Agent", "ManLab Agent User" };
        foreach (var taskName in taskNames)
        {
            try
            {
                using var process = new System.Diagnostics.Process();
                process.StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "schtasks",
                    Arguments = $"/Delete /TN \"{taskName}\" /F",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                process.Start();
                await process.StandardOutput.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
                await process.StandardError.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
                await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);

                if (process.ExitCode == 0)
                {
                    results.Add($"Deleted task: {taskName}");
                    _logger.LogInformation("Deleted scheduled task: {TaskName}", taskName);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to delete task {TaskName}", taskName);
            }
        }

        // Step 2: Schedule self-deletion script
        // Create a batch script that waits for the process to exit, then deletes the agent directory
        var agentDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var cleanupScript = Path.Combine(Path.GetTempPath(), $"manlab_cleanup_{Guid.NewGuid():N}.cmd");

        var scriptContent = $@"@echo off
timeout /t 3 /nobreak > nul
rd /s /q ""{agentDir}""
del ""%~f0""
";
        await File.WriteAllTextAsync(cleanupScript, scriptContent, cancellationToken).ConfigureAwait(false);

        // Start cleanup script
        try
        {
            using var cleanupProcess = new System.Diagnostics.Process();
            cleanupProcess.StartInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"{cleanupScript}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = System.Diagnostics.ProcessWindowStyle.Hidden
            };
            cleanupProcess.Start();
            results.Add("Cleanup script scheduled");
            _logger.LogInformation("Cleanup script started: {Script}", cleanupScript);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to start cleanup script");
            results.Add($"Warning: Failed to schedule file cleanup: {ex.Message}");
        }

        // Step 3: Schedule shutdown after response
        if (_shutdownCallback is not null)
        {
            Task.Run(async () =>
            {
                await Task.Delay(1000).ConfigureAwait(false); // Give time for response
                _shutdownCallback();
            });
            results.Add("Agent shutdown scheduled");
        }

        return string.Join("; ", results);
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
