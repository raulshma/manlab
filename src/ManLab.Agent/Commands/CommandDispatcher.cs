using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Text.Json.Nodes;
using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using System.Runtime.InteropServices;

namespace ManLab.Agent.Commands;

/// <summary>
/// Dispatches commands received from the server to appropriate handlers.
/// </summary>
public sealed class CommandDispatcher : IDisposable
{
    private const int MaxPayloadChars = 32_768; // hard limit to reduce abuse/memory pressure
    private const int MaxShellCommandChars = 1_024;
    private const int MaxShellOutputChars = 16_384;
    private static readonly TimeSpan ShellTimeout = TimeSpan.FromSeconds(30);
    private static readonly Regex ContainerIdOrNameRegex = new(
        "^[a-zA-Z0-9_.-]{1,128}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    // Service identifiers are used in OS-specific commands.
    // Keep these intentionally strict to reduce injection risk.
    private static readonly Regex LinuxServiceNameRegex = new(
        "^[a-zA-Z0-9@_.:-]{1,256}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    // Windows service *names* typically do not include spaces, but users often paste display names.
    // Allow a conservative superset that still excludes shell metacharacters like &|<>"'`.
    private static readonly Regex WindowsServiceNameRegex = new(
        "^[a-zA-Z0-9 _().:-]{1,256}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex ScStateRegex = new(
        @"STATE\s*:\s*\d+\s+(\w+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private readonly ILoggerFactory _loggerFactory;
    private readonly ILogger<CommandDispatcher> _logger;
    private readonly Func<Guid, string, string?, Task> _updateStatusCallback;
    private readonly Func<IReadOnlyList<ServiceStatusSnapshotIngest>, Task>? _sendServiceSnapshots;
    private readonly Func<IReadOnlyList<SmartDriveSnapshotIngest>, Task>? _sendSmartSnapshots;
    private readonly Action? _shutdownCallback;
    private readonly DockerManager _dockerManager;
    private readonly AgentConfiguration _config;
    private readonly TerminalSessionHandler? _terminalHandler;

    // Simple in-process rate limit for log operations.
    private readonly object _logRateLock = new();
    private DateTime _lastLogOpUtc = DateTime.MinValue;

    // Simple in-process rate limit for script runs.
    private readonly object _scriptRateLock = new();
    private DateTime _lastScriptRunUtc = DateTime.MinValue;

    // Track running commands for cancellation support.
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _runningCommands = new();

    public CommandDispatcher(
        ILoggerFactory loggerFactory, 
        Func<Guid, string, string?, Task> updateStatusCallback,
        Func<IReadOnlyList<ServiceStatusSnapshotIngest>, Task>? sendServiceSnapshots = null,
        Func<IReadOnlyList<SmartDriveSnapshotIngest>, Task>? sendSmartSnapshots = null,
        Action? shutdownCallback = null,
        AgentConfiguration? config = null,
        TerminalSessionHandler? terminalHandler = null)
    {
        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<CommandDispatcher>();
        _updateStatusCallback = updateStatusCallback;
        _sendServiceSnapshots = sendServiceSnapshots;
        _sendSmartSnapshots = sendSmartSnapshots;
        _shutdownCallback = shutdownCallback;
        _dockerManager = new DockerManager(loggerFactory.CreateLogger<DockerManager>());
        _config = config ?? new AgentConfiguration();
        _terminalHandler = terminalHandler;
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
            // Handle command.cancel specially - it doesn't follow the normal lifecycle.
            var normalizedType = (type ?? string.Empty).Trim().ToLowerInvariant();
            if (normalizedType == CommandTypes.CommandCancel)
            {
                var result = await HandleCommandCancelAsync(payload).ConfigureAwait(false);
                await _updateStatusCallback(commandId, "Success", result).ConfigureAwait(false);
                return;
            }

            // Create a linked cancellation token for this command.
            using var commandCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            _runningCommands[commandId] = commandCts;

            try
            {
                // Mark as started, but avoid injecting a generic log line. Many commands (including log.read)
                // treat returned output as the "real" content.
                await _updateStatusCallback(commandId, "InProgress", null).ConfigureAwait(false);

                // Default-deny remote tools unless explicitly enabled.
                if (IsRemoteToolCommand(normalizedType) && !IsRemoteToolEnabled(normalizedType))
                {
                    throw new InvalidOperationException($"Command '{normalizedType}' is disabled by agent configuration.");
                }

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
                    var t when t == CommandTypes.DockerList => await HandleDockerListAsync(commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.DockerRestart => await HandleDockerRestartAsync(payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.DockerStop => await HandleDockerStopAsync(payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.DockerStart => await HandleDockerStartAsync(payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.SystemUpdate => await HandleSystemUpdateAsync(commandId, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.AgentShutdown => HandleAgentShutdown(),
                    var t when t == CommandTypes.AgentEnableTask => await HandleTaskControlAsync(enable: true, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.AgentDisableTask => await HandleTaskControlAsync(enable: false, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.AgentUninstall => await HandleAgentUninstallAsync(commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.ShellExec => await HandleShellExecAsync(payloadRoot, commandCts.Token).ConfigureAwait(false),

                    var t when t == CommandTypes.ServiceStatus => await HandleServiceStatusAsync(commandId, payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.ServiceRestart => await HandleServiceRestartAsync(commandId, payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.SmartScan => await HandleSmartScanAsync(commandId, payloadRoot, commandCts.Token).ConfigureAwait(false),

                    // Remote tools
                    var t when t == CommandTypes.LogRead => await HandleLogReadAsync(payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.LogTail => await HandleLogTailAsync(commandId, payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.ScriptRun => await HandleScriptRunAsync(commandId, payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.TerminalOpen => await HandleTerminalOpenAsync(payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.TerminalClose => await HandleTerminalCloseAsync(payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.TerminalInput => await HandleTerminalInputAsync(payloadRoot, commandCts.Token).ConfigureAwait(false),
                    var t when t == CommandTypes.ConfigUpdate => HandleConfigUpdate(payloadRoot),
                    _ => throw new NotSupportedException($"Unknown command type: {type}")
                };

                // For non-streaming commands, send the final status
                if (!normalizedType.Equals(CommandTypes.SystemUpdate, StringComparison.OrdinalIgnoreCase))
                {
                    await _updateStatusCallback(commandId, "Success", result).ConfigureAwait(false);
                }
            }
            finally
            {
                payloadDoc?.Dispose();
            }
            }
            finally
            {
                _runningCommands.TryRemove(commandId, out _);
            }

        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Command cancelled: {CommandId}", commandId);
            await _updateStatusCallback(commandId, "Failed", "Command was cancelled.").ConfigureAwait(false);
        }
        catch (NotSupportedException ex)
        {
            // NotSupportedException can come from unknown command types *or* from handlers.
            // Preserve the actual message so the server/dashboard can show a useful reason.
            _logger.LogWarning(ex, "Command not supported: {Type}", type);
            await _updateStatusCallback(commandId, "Failed", $"Not supported: {ex.Message}").ConfigureAwait(false);
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

    private Task<string> HandleCommandCancelAsync(string payload)
    {
        // Parse the target command ID from payload.
        if (string.IsNullOrWhiteSpace(payload))
        {
            throw new ArgumentException("command.cancel requires a JSON payload with 'targetCommandId'.");
        }

        Guid targetCommandId;
        try
        {
            using var doc = JsonDocument.Parse(payload);
            var root = doc.RootElement;

            if (!root.TryGetProperty("targetCommandId", out var idEl) && !root.TryGetProperty("TargetCommandId", out idEl))
            {
                throw new ArgumentException("Payload must include 'targetCommandId'.");
            }

            if (idEl.ValueKind != JsonValueKind.String || !Guid.TryParse(idEl.GetString(), out targetCommandId))
            {
                throw new ArgumentException("'targetCommandId' must be a valid GUID.");
            }
        }
        catch (JsonException ex)
        {
            throw new ArgumentException("command.cancel payload must be valid JSON.", ex);
        }

        if (targetCommandId == Guid.Empty)
        {
            throw new ArgumentException("'targetCommandId' cannot be empty.");
        }

        // Try to cancel the running command.
        if (_runningCommands.TryGetValue(targetCommandId, out var cts))
        {
            try
            {
                cts.Cancel();
                _logger.LogInformation("Cancelled running command {TargetCommandId}", targetCommandId);
                return Task.FromResult($"Command {targetCommandId} cancellation requested.");
            }
            catch (ObjectDisposedException)
            {
                // Command already completed.
                return Task.FromResult($"Command {targetCommandId} already completed.");
            }
        }

        return Task.FromResult($"Command {targetCommandId} not found or not running.");
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

    private async Task<string> HandleScriptRunAsync(Guid commandId, JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        EnforceScriptRateLimit();

        if (payloadRoot is null || payloadRoot.Value.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("script.run requires a JSON object payload.");
        }

        // Payload schema (preferred from server): { scriptId, runId }
        // Optional inline schema (useful for tests / local usage): { shell, content, runId? }
        var root = payloadRoot.Value;

        var runId = TryGetGuid(root, "runId") ?? Guid.Empty;
        var scriptId = TryGetGuid(root, "scriptId") ?? Guid.Empty;

        var inlineShell = TryGetString(root, "shell");
        var inlineContent = TryGetString(root, "content");

        if (string.IsNullOrWhiteSpace(inlineContent))
        {
            if (scriptId == Guid.Empty)
            {
                throw new ArgumentException("scriptId is required when content is not provided.");
            }

            var fetched = await ScriptRunner.FetchScriptAsync(
                logger: _loggerFactory.CreateLogger("ManLab.Agent.Commands.ScriptRunner"),
                config: _config,
                scriptId: scriptId,
                cancellationToken: cancellationToken).ConfigureAwait(false);

            inlineShell = fetched.Shell;
            inlineContent = fetched.Content;
        }

        if (string.IsNullOrWhiteSpace(inlineShell))
        {
            throw new ArgumentException("shell is required.");
        }

        if (inlineContent is null)
        {
            throw new ArgumentException("content is required.");
        }

        var runner = new ScriptRunner(
            loggerFactory: _loggerFactory,
            config: _config,
            updateStatusCallback: _updateStatusCallback);

        return await runner.ExecuteAsync(
            commandId: commandId,
            runId: runId,
            scriptId: scriptId,
            shell: inlineShell,
            content: inlineContent,
            cancellationToken: cancellationToken).ConfigureAwait(false);
    }

    private void EnforceScriptRateLimit()
    {
        var minDelay = TimeSpan.FromSeconds(Math.Max(0, _config.ScriptMinSecondsBetweenRuns));
        if (minDelay <= TimeSpan.Zero)
        {
            return;
        }

        lock (_scriptRateLock)
        {
            var now = DateTime.UtcNow;
            var nextOk = _lastScriptRunUtc + minDelay;
            if (now < nextOk)
            {
                throw new InvalidOperationException($"Script runs are rate-limited. Try again in {(nextOk - now).TotalSeconds:0.0}s.");
            }

            _lastScriptRunUtc = now;
        }
    }

    private static Guid? TryGetGuid(JsonElement obj, string propertyName)
    {
        if (!obj.TryGetProperty(propertyName, out var el))
        {
            return null;
        }

        if (el.ValueKind == JsonValueKind.String && Guid.TryParse(el.GetString(), out var g))
        {
            return g;
        }

        if (el.ValueKind == JsonValueKind.Undefined || el.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return null;
    }

    private static string? TryGetString(JsonElement obj, string propertyName)
    {
        if (!obj.TryGetProperty(propertyName, out var el))
        {
            return null;
        }

        return el.ValueKind == JsonValueKind.String ? el.GetString() : null;
    }

    private string HandleConfigUpdate(JsonElement? payloadRoot)
    {
        _logger.LogInformation("Config update requested by server");

        if (payloadRoot is null || payloadRoot.Value.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("config.update requires a JSON object payload.");
        }

        // Read existing appsettings.json
        var appSettingsPath = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        Dictionary<string, object>? root = null;
        Dictionary<string, object?>? agentSection = null;

        if (File.Exists(appSettingsPath))
        {
            try
            {
                var content = File.ReadAllText(appSettingsPath);
                root = JsonSerializer.Deserialize(content, ManLabJsonContext.Default.DictionaryStringObject);
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "Existing appsettings.json is invalid, creating new one");
            }
        }

        root ??= new Dictionary<string, object>();
        if (root.TryGetValue("Agent", out var existingAgent) && existingAgent is JsonElement agentEl)
        {
            agentSection = JsonSerializer.Deserialize(agentEl.GetRawText(), ManLabJsonContext.Default.DictionaryStringObject);
        }
        agentSection ??= new Dictionary<string, object?>();

        var payload = payloadRoot.Value;
        var updatedFields = new List<string>();

        // Apply updates from payload
        void ApplyIfPresent<T>(string jsonProp, string configKey, Func<JsonElement, T> extractor)
        {
            if (payload.TryGetProperty(jsonProp, out var el) || payload.TryGetProperty(ToPascalCase(jsonProp), out el))
            {
                if (el.ValueKind != JsonValueKind.Null && el.ValueKind != JsonValueKind.Undefined)
                {
                    agentSection[configKey] = extractor(el);
                    updatedFields.Add(configKey);
                }
            }
        }

        static string ToPascalCase(string s) => string.IsNullOrEmpty(s) ? s : char.ToUpperInvariant(s[0]) + s[1..];

        // Connection settings
        ApplyIfPresent("heartbeatIntervalSeconds", "HeartbeatIntervalSeconds", e => e.GetInt32());
        ApplyIfPresent("maxReconnectDelaySeconds", "MaxReconnectDelaySeconds", e => e.GetInt32());

        // Telemetry settings
        ApplyIfPresent("telemetryCacheSeconds", "TelemetryCacheSeconds", e => e.GetInt32());
        ApplyIfPresent("primaryInterfaceName", "PrimaryInterfaceName", e => e.GetString());
        ApplyIfPresent("enableNetworkTelemetry", "EnableNetworkTelemetry", e => e.GetBoolean());
        ApplyIfPresent("enablePingTelemetry", "EnablePingTelemetry", e => e.GetBoolean());
        ApplyIfPresent("enableGpuTelemetry", "EnableGpuTelemetry", e => e.GetBoolean());
        ApplyIfPresent("enableUpsTelemetry", "EnableUpsTelemetry", e => e.GetBoolean());

        // Remote tools
        ApplyIfPresent("enableLogViewer", "EnableLogViewer", e => e.GetBoolean());
        ApplyIfPresent("enableScripts", "EnableScripts", e => e.GetBoolean());
        ApplyIfPresent("enableTerminal", "EnableTerminal", e => e.GetBoolean());

        // Ping settings
        ApplyIfPresent("pingTarget", "PingTarget", e => e.GetString());
        ApplyIfPresent("pingTimeoutMs", "PingTimeoutMs", e => e.GetInt32());
        ApplyIfPresent("pingWindowSize", "PingWindowSize", e => e.GetInt32());

        // Rate limits
        ApplyIfPresent("logMaxBytes", "LogMaxBytes", e => e.GetInt32());
        ApplyIfPresent("logMinSecondsBetweenRequests", "LogMinSecondsBetweenRequests", e => e.GetInt32());
        ApplyIfPresent("scriptMaxOutputBytes", "ScriptMaxOutputBytes", e => e.GetInt32());
        ApplyIfPresent("scriptMaxDurationSeconds", "ScriptMaxDurationSeconds", e => e.GetInt32());
        ApplyIfPresent("scriptMinSecondsBetweenRuns", "ScriptMinSecondsBetweenRuns", e => e.GetInt32());
        ApplyIfPresent("terminalMaxOutputBytes", "TerminalMaxOutputBytes", e => e.GetInt32());
        ApplyIfPresent("terminalMaxDurationSeconds", "TerminalMaxDurationSeconds", e => e.GetInt32());

        if (updatedFields.Count == 0)
        {
            return "No configuration changes detected.";
        }

        // Write updated config
        root["Agent"] = agentSection;
        // Use source generation for AOT compatibility
        var json = JsonSerializer.Serialize(root, ManLabJsonContext.Default.DictionaryStringObject);
        
        // Format with indentation using JsonNode (AOT-compatible)
        var formatted = JsonNode.Parse(json)?.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(appSettingsPath, formatted ?? json);

        _logger.LogInformation("Updated appsettings.json with {Count} fields: {Fields}", updatedFields.Count, string.Join(", ", updatedFields));

        // Schedule restart to apply new config
        if (_shutdownCallback is not null)
        {
            Task.Run(async () =>
            {
                await Task.Delay(1000).ConfigureAwait(false); // Give time for status response
                _shutdownCallback();
            });

            return $"Configuration updated ({string.Join(", ", updatedFields)}). Agent will restart to apply changes.";
        }

        return $"Configuration updated ({string.Join(", ", updatedFields)}). Restart agent manually to apply changes.";
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
            _ = Task.Run(async () =>
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

    private static string ExtractShellCommandStrict(JsonElement? payloadRoot)
    {
        if (payloadRoot is null)
        {
            throw new ArgumentException("Command payload is required and must be a JSON object with a 'command' property.");
        }

        var root = payloadRoot.Value;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Command payload must be a JSON object.");
        }

        string? command = null;
        if (root.TryGetProperty("command", out var commandEl))
        {
            command = commandEl.GetString();
        }
        else if (root.TryGetProperty("Command", out var commandCapEl))
        {
            command = commandCapEl.GetString();
        }

        command = command?.Trim();
        if (string.IsNullOrWhiteSpace(command))
        {
            throw new ArgumentException("Command payload must include a non-empty 'command'.");
        }

        return command;
    }

    private async Task<string> HandleShellExecAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        var command = ExtractShellCommandStrict(payloadRoot);
        if (command.Length > MaxShellCommandChars)
        {
            throw new ArgumentException($"Shell command too long (max {MaxShellCommandChars} characters).", nameof(payloadRoot));
        }

        return await ShellExecutor.ExecuteAsync(
            command,
            ShellTimeout,
            MaxShellOutputChars,
            _loggerFactory.CreateLogger("ManLab.Agent.Commands.ShellExecutor"),
            cancellationToken).ConfigureAwait(false);
    }

    private static bool IsLinux() => RuntimeInformation.IsOSPlatform(OSPlatform.Linux);

    private static bool IsWindows() => RuntimeInformation.IsOSPlatform(OSPlatform.Windows);

    private static bool IsValidServiceIdentifier(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var s = value.Trim();
        if (IsWindows())
        {
            return WindowsServiceNameRegex.IsMatch(s);
        }

        // Default to Linux rules.
        return LinuxServiceNameRegex.IsMatch(s);
    }

    private void EnforceLogRateLimit()
    {
        var minSeconds = Math.Max(0, _config.LogMinSecondsBetweenRequests);
        if (minSeconds == 0)
        {
            return;
        }

        lock (_logRateLock)
        {
            var now = DateTime.UtcNow;
            var delta = now - _lastLogOpUtc;
            if (delta < TimeSpan.FromSeconds(minSeconds))
            {
                throw new InvalidOperationException($"Log operation rate-limited (min {minSeconds}s between requests)." );
            }

            _lastLogOpUtc = now;
        }
    }

    private sealed record LogReadPayload(string Path, int? MaxBytes, long? OffsetBytes);

    private static LogReadPayload ParseLogReadPayloadStrict(JsonElement? payloadRoot)
    {
        if (payloadRoot is null)
        {
            throw new ArgumentException("Command payload is required.");
        }

        var root = payloadRoot.Value;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Command payload must be a JSON object.");
        }

        string? path = null;
        if (root.TryGetProperty("path", out var pathEl) || root.TryGetProperty("Path", out pathEl))
        {
            path = pathEl.GetString();
        }

        path = path?.Trim();
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new ArgumentException("Payload must include a non-empty 'path'.");
        }

        int? maxBytes = null;
        if (root.TryGetProperty("maxBytes", out var maxEl) || root.TryGetProperty("MaxBytes", out maxEl))
        {
            if (maxEl.ValueKind == JsonValueKind.Number && maxEl.TryGetInt32(out var mb))
            {
                maxBytes = mb;
            }
        }

        long? offsetBytes = null;
        if (root.TryGetProperty("offsetBytes", out var offEl) || root.TryGetProperty("OffsetBytes", out offEl))
        {
            if (offEl.ValueKind == JsonValueKind.Number && offEl.TryGetInt64(out var ob))
            {
                offsetBytes = ob;
            }
        }

        return new LogReadPayload(path, maxBytes, offsetBytes);
    }

    private static int CoercePositiveIntOrNull(int? value)
    {
        if (value is null) return 0;
        return value.Value;
    }

    private async Task<string> HandleLogReadAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        EnforceLogRateLimit();

        var payload = ParseLogReadPayloadStrict(payloadRoot);

        var requestedMax = payload.MaxBytes ?? _config.LogMaxBytes;
        if (requestedMax <= 0)
        {
            throw new ArgumentException("maxBytes must be positive.");
        }

        var maxBytes = Math.Min(requestedMax, Math.Max(1, _config.LogMaxBytes));

        var offsetBytes = payload.OffsetBytes;
        if (offsetBytes is not null && offsetBytes.Value < 0)
        {
            throw new ArgumentException("offsetBytes must be >= 0.");
        }

        // Use FileShare.ReadWrite to allow reading active log files.
        if (!File.Exists(payload.Path))
        {
            throw new FileNotFoundException("Log file not found.", payload.Path);
        }

        await using var fs = new FileStream(payload.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        var length = fs.Length;

        long start = 0;
        if (offsetBytes is not null)
        {
            start = Math.Min(offsetBytes.Value, length);
        }
        else
        {
            // Default: tail the file.
            start = Math.Max(0, length - maxBytes);
        }

        fs.Seek(start, SeekOrigin.Begin);

        var remaining = length - start;
        var toRead = (int)Math.Min(maxBytes, remaining);
        if (toRead <= 0)
        {
            return string.Empty;
        }

        var buffer = new byte[toRead];
        var read = 0;
        while (read < toRead)
        {
            var r = await fs.ReadAsync(buffer.AsMemory(read, toRead - read), cancellationToken).ConfigureAwait(false);
            if (r <= 0) break;
            read += r;
        }

        if (read <= 0)
        {
            return string.Empty;
        }

        return System.Text.Encoding.UTF8.GetString(buffer, 0, read);
    }

    private sealed record LogTailPayload(string Path, int? MaxBytes, int? DurationSeconds, int? PollMs, int? ChunkBytes);

    private static LogTailPayload ParseLogTailPayloadStrict(JsonElement? payloadRoot)
    {
        if (payloadRoot is null)
        {
            throw new ArgumentException("Command payload is required.");
        }

        var root = payloadRoot.Value;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Command payload must be a JSON object.");
        }

        string? path = null;
        if (root.TryGetProperty("path", out var pathEl) || root.TryGetProperty("Path", out pathEl))
        {
            path = pathEl.GetString();
        }
        path = path?.Trim();
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new ArgumentException("Payload must include a non-empty 'path'.");
        }

        int? maxBytes = null;
        if (root.TryGetProperty("maxBytes", out var maxEl) || root.TryGetProperty("MaxBytes", out maxEl))
        {
            if (maxEl.ValueKind == JsonValueKind.Number && maxEl.TryGetInt32(out var mb))
            {
                maxBytes = mb;
            }
        }

        int? durationSeconds = null;
        if (root.TryGetProperty("durationSeconds", out var durEl) || root.TryGetProperty("DurationSeconds", out durEl))
        {
            if (durEl.ValueKind == JsonValueKind.Number && durEl.TryGetInt32(out var ds))
            {
                durationSeconds = ds;
            }
        }

        int? pollMs = null;
        if (root.TryGetProperty("pollMs", out var pollEl) || root.TryGetProperty("PollMs", out pollEl))
        {
            if (pollEl.ValueKind == JsonValueKind.Number && pollEl.TryGetInt32(out var p))
            {
                pollMs = p;
            }
        }

        int? chunkBytes = null;
        if (root.TryGetProperty("chunkBytes", out var chunkEl) || root.TryGetProperty("ChunkBytes", out chunkEl))
        {
            if (chunkEl.ValueKind == JsonValueKind.Number && chunkEl.TryGetInt32(out var cb))
            {
                chunkBytes = cb;
            }
        }

        return new LogTailPayload(path, maxBytes, durationSeconds, pollMs, chunkBytes);
    }

    private async Task<string> HandleLogTailAsync(Guid commandId, JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        EnforceLogRateLimit();

        var payload = ParseLogTailPayloadStrict(payloadRoot);

        if (!File.Exists(payload.Path))
        {
            throw new FileNotFoundException("Log file not found.", payload.Path);
        }

        var requestedMax = payload.MaxBytes ?? _config.LogMaxBytes;
        if (requestedMax <= 0)
        {
            throw new ArgumentException("maxBytes must be positive.");
        }

        var maxBytes = Math.Min(requestedMax, Math.Max(1, _config.LogMaxBytes));

        var durationSeconds = payload.DurationSeconds ?? 10;
        if (durationSeconds <= 0)
        {
            throw new ArgumentException("durationSeconds must be positive.");
        }
        durationSeconds = Math.Min(durationSeconds, 60);

        var pollMs = payload.PollMs ?? 250;
        pollMs = Math.Clamp(pollMs, 50, 2000);

        var chunkBytes = payload.ChunkBytes ?? 4096;
        chunkBytes = Math.Clamp(chunkBytes, 256, 16 * 1024);

        // Read initial tail.
        await using var fs = new FileStream(payload.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        var length = fs.Length;
        var start = Math.Max(0, length - maxBytes);
        fs.Seek(start, SeekOrigin.Begin);
        var remaining = length - start;
        var initialToRead = (int)Math.Min(maxBytes, remaining);
        var sent = 0;

        if (initialToRead > 0)
        {
            var buffer = new byte[initialToRead];
            var read = 0;
            while (read < initialToRead)
            {
                var r = await fs.ReadAsync(buffer.AsMemory(read, initialToRead - read), cancellationToken).ConfigureAwait(false);
                if (r <= 0) break;
                read += r;
            }

            if (read > 0)
            {
                var text = System.Text.Encoding.UTF8.GetString(buffer, 0, read);
                // Stream as an in-progress chunk.
                await _updateStatusCallback(commandId, "InProgress", text).ConfigureAwait(false);
                sent += read;
            }
        }

        // Follow for a bounded duration.
        var deadline = DateTime.UtcNow.AddSeconds(durationSeconds);
        while (DateTime.UtcNow < deadline && sent < maxBytes)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // Check if the file grew; if so, read incrementally.
            var newLen = fs.Length;
            if (newLen > length)
            {
                var growth = newLen - length;
                var allow = Math.Min((int)Math.Min(growth, maxBytes - sent), chunkBytes);
                if (allow > 0)
                {
                    var buffer = new byte[allow];
                    var read = 0;
                    while (read < allow)
                    {
                        var r = await fs.ReadAsync(buffer.AsMemory(read, allow - read), cancellationToken).ConfigureAwait(false);
                        if (r <= 0) break;
                        read += r;
                    }

                    if (read > 0)
                    {
                        var text = System.Text.Encoding.UTF8.GetString(buffer, 0, read);
                        await _updateStatusCallback(commandId, "InProgress", text).ConfigureAwait(false);
                        sent += read;
                    }

                    length = newLen;
                }
            }

            await Task.Delay(pollMs, cancellationToken).ConfigureAwait(false);
        }

        return $"Tail complete. Bytes streamed={sent}.";
    }

    private static List<string> ExtractServiceNamesStrict(JsonElement? payloadRoot)
    {
        if (payloadRoot is null)
        {
            throw new ArgumentException("Command payload is required.");
        }

        var root = payloadRoot.Value;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Command payload must be a JSON object.");
        }

        var services = new List<string>();

        if (root.TryGetProperty("services", out var servicesEl) || root.TryGetProperty("Services", out servicesEl))
        {
            if (servicesEl.ValueKind != JsonValueKind.Array)
            {
                throw new ArgumentException("'services' must be a JSON array of strings.");
            }

            foreach (var el in servicesEl.EnumerateArray())
            {
                var s = el.GetString()?.Trim();
                if (string.IsNullOrWhiteSpace(s)) continue;
                services.Add(s);
            }
        }
        else
        {
            string? single = null;
            if (root.TryGetProperty("service", out var serviceEl) || root.TryGetProperty("Service", out serviceEl))
            {
                single = serviceEl.GetString();
            }
            else if (root.TryGetProperty("serviceName", out var serviceNameEl) || root.TryGetProperty("ServiceName", out serviceNameEl))
            {
                single = serviceNameEl.GetString();
            }

            single = single?.Trim();
            if (!string.IsNullOrWhiteSpace(single))
            {
                services.Add(single);
            }
        }

        if (services.Count == 0)
        {
            throw new ArgumentException("Payload must include 'services' (array) or 'service' (string)." );
        }

        // De-dupe and validate
        var normalized = services
            .Select(s => s.Trim())
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var s in normalized)
        {
            if (!IsValidServiceIdentifier(s))
            {
                throw new ArgumentException($"Invalid service name: '{s}'.");
            }
        }

        // Hard bound
        if (normalized.Count > 64)
        {
            normalized = normalized.Take(64).ToList();
        }

        return normalized;
    }

    private static string MapWindowsServiceState(string scOutput)
    {
        // Basic heuristics first
        if (string.IsNullOrWhiteSpace(scOutput))
        {
            return "unknown";
        }

        var lower = scOutput.ToLowerInvariant();
        if (lower.Contains("failed", StringComparison.OrdinalIgnoreCase) && lower.Contains("openservice", StringComparison.OrdinalIgnoreCase))
        {
            // e.g. "OpenService FAILED 1060" (service does not exist)
            return "failed";
        }

        var m = ScStateRegex.Match(scOutput);
        if (!m.Success)
        {
            return "unknown";
        }

        var state = (m.Groups[1].Value ?? string.Empty).Trim().ToUpperInvariant();
        return state switch
        {
            "RUNNING" => "active",
            "STOPPED" => "inactive",
            "PAUSED" => "inactive",
            "START_PENDING" => "unknown",
            "STOP_PENDING" => "unknown",
            "CONTINUE_PENDING" => "unknown",
            "PAUSE_PENDING" => "unknown",
            _ => "unknown"
        };
    }

    private static async Task<(int exitCode, string output)> ExecuteProcessDirectAsync(
        string fileName,
        string arguments,
        TimeSpan timeout,
        int maxOutputChars,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        using var process = new System.Diagnostics.Process();
        process.StartInfo = new System.Diagnostics.ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        logger.LogInformation("Executing process: {FileName} {Arguments}", fileName, arguments);

        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Failed to start process '{fileName}'.", ex);
        }

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        var outputBuilder = new System.Text.StringBuilder(capacity: Math.Min(maxOutputChars, 4_096));

        static async Task ReadBoundedAsync(System.IO.StreamReader reader, System.Text.StringBuilder buffer, int maxChars, CancellationToken ct)
        {
            var charBuffer = new char[1024];
            while (true)
            {
                var read = await reader.ReadAsync(charBuffer.AsMemory(0, charBuffer.Length), ct).ConfigureAwait(false);
                if (read <= 0) break;

                lock (buffer)
                {
                    var remaining = maxChars - buffer.Length;
                    if (remaining <= 0)
                    {
                        continue;
                    }

                    var toAppend = Math.Min(remaining, read);
                    buffer.Append(charBuffer, 0, toAppend);
                }

                if (buffer.Length >= maxChars)
                {
                    return;
                }
            }
        }

        try
        {
            var stdoutTask = ReadBoundedAsync(process.StandardOutput, outputBuilder, maxOutputChars, timeoutCts.Token);
            var stderrTask = ReadBoundedAsync(process.StandardError, outputBuilder, maxOutputChars, timeoutCts.Token);
            await Task.WhenAll(stdoutTask, stderrTask).ConfigureAwait(false);
            await process.WaitForExitAsync(timeoutCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                }
            }
            catch
            {
                // Best-effort kill.
            }

            throw new TimeoutException($"Process timed out after {timeout.TotalSeconds:0}s: {fileName} {arguments}");
        }

        return (process.ExitCode, outputBuilder.ToString().Trim());
    }

    private async Task<string> HandleServiceStatusAsync(Guid commandId, JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        if (_sendServiceSnapshots is null)
        {
            throw new InvalidOperationException("Service snapshot sender is not configured.");
        }

        var services = ExtractServiceNamesStrict(payloadRoot);
        var snapshots = new List<ServiceStatusSnapshotIngest>(services.Count);

        var logger = _loggerFactory.CreateLogger("ManLab.Agent.Commands.ServiceStatus");

        for (var i = 0; i < services.Count; i++)
        {
            var svc = services[i];
            await _updateStatusCallback(commandId, "InProgress", $"Checking service {i + 1}/{services.Count}: {svc}").ConfigureAwait(false);

            if (IsLinux())
            {
                // systemctl output is bounded; we only need small bits.
                var isActive = await ShellExecutor.ExecuteAsync(
                    $"systemctl is-active {svc}",
                    TimeSpan.FromSeconds(10),
                    512,
                    logger,
                    cancellationToken).ConfigureAwait(false);

                var show = await ShellExecutor.ExecuteAsync(
                    $"systemctl show {svc} --no-page --property=Id,Description,LoadState,ActiveState,SubState,UnitFileState",
                    TimeSpan.FromSeconds(10),
                    4096,
                    logger,
                    cancellationToken).ConfigureAwait(false);

                var state = (isActive ?? string.Empty).Trim().ToLowerInvariant();
                if (state is not ("active" or "inactive" or "failed"))
                {
                    state = "unknown";
                }

                snapshots.Add(new ServiceStatusSnapshotIngest
                {
                    Timestamp = DateTime.UtcNow,
                    ServiceName = svc,
                    State = state,
                    Detail = show
                });
            }
            else if (IsWindows())
            {
                // Use sc.exe directly (not via cmd.exe) to avoid shell parsing/injection.
                var (exitCodeQuery, queryOut) = await ExecuteProcessDirectAsync(
                    "sc.exe",
                    $"query \"{svc}\"",
                    TimeSpan.FromSeconds(10),
                    8_192,
                    logger,
                    cancellationToken).ConfigureAwait(false);

                var (exitCodeQc, qcOut) = await ExecuteProcessDirectAsync(
                    "sc.exe",
                    $"qc \"{svc}\"",
                    TimeSpan.FromSeconds(10),
                    8_192,
                    logger,
                    cancellationToken).ConfigureAwait(false);

                var combined = $"ExitCode(query)={exitCodeQuery}\n{queryOut}\n\nExitCode(qc)={exitCodeQc}\n{qcOut}".Trim();
                var state = MapWindowsServiceState(combined);

                snapshots.Add(new ServiceStatusSnapshotIngest
                {
                    Timestamp = DateTime.UtcNow,
                    ServiceName = svc,
                    State = state,
                    Detail = combined
                });
            }
            else
            {
                throw new NotSupportedException("service.status is supported on Linux and Windows agents only.");
            }
        }

        await _sendServiceSnapshots(snapshots).ConfigureAwait(false);
        return $"Service snapshots sent: {snapshots.Count}.";
    }

    private async Task<string> HandleServiceRestartAsync(Guid commandId, JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        if (_sendServiceSnapshots is null)
        {
            throw new InvalidOperationException("Service snapshot sender is not configured.");
        }

        var services = ExtractServiceNamesStrict(payloadRoot);
        if (services.Count != 1)
        {
            throw new ArgumentException("service.restart expects exactly one service name (use 'service').");
        }

        var svc = services[0];
        var logger = _loggerFactory.CreateLogger("ManLab.Agent.Commands.ServiceRestart");

        await _updateStatusCallback(commandId, "InProgress", $"Restarting service: {svc}").ConfigureAwait(false);

        string detail;
        string state;
        string? restartOutput;

        if (IsLinux())
        {
            restartOutput = await ShellExecutor.ExecuteAsync(
                $"systemctl restart {svc}",
                TimeSpan.FromSeconds(20),
                4096,
                logger,
                cancellationToken).ConfigureAwait(false);

            // Capture post-restart status snapshot
            var isActive = await ShellExecutor.ExecuteAsync(
                $"systemctl is-active {svc}",
                TimeSpan.FromSeconds(10),
                512,
                logger,
                cancellationToken).ConfigureAwait(false);

            var show = await ShellExecutor.ExecuteAsync(
                $"systemctl show {svc} --no-page --property=Id,Description,LoadState,ActiveState,SubState,UnitFileState",
                TimeSpan.FromSeconds(10),
                4096,
                logger,
                cancellationToken).ConfigureAwait(false);

            state = (isActive ?? string.Empty).Trim().ToLowerInvariant();
            if (state is not ("active" or "inactive" or "failed"))
            {
                state = "unknown";
            }

            detail = show;
        }
        else if (IsWindows())
        {
            // Windows restart = stop then start.
            var (exitStop, stopOut) = await ExecuteProcessDirectAsync(
                "sc.exe",
                $"stop \"{svc}\"",
                TimeSpan.FromSeconds(20),
                8_192,
                logger,
                cancellationToken).ConfigureAwait(false);

            // Give SCM a short window to transition.
            await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken).ConfigureAwait(false);

            var (exitStart, startOut) = await ExecuteProcessDirectAsync(
                "sc.exe",
                $"start \"{svc}\"",
                TimeSpan.FromSeconds(20),
                8_192,
                logger,
                cancellationToken).ConfigureAwait(false);

            var (exitQuery, queryOut) = await ExecuteProcessDirectAsync(
                "sc.exe",
                $"query \"{svc}\"",
                TimeSpan.FromSeconds(10),
                8_192,
                logger,
                cancellationToken).ConfigureAwait(false);

            restartOutput = $"ExitCode(stop)={exitStop}\n{stopOut}\n\nExitCode(start)={exitStart}\n{startOut}".Trim();
            detail = $"{restartOutput}\n\nExitCode(query)={exitQuery}\n{queryOut}".Trim();
            state = MapWindowsServiceState(detail);
        }
        else
        {
            throw new NotSupportedException("service.restart is supported on Linux and Windows agents only.");
        }

        await _sendServiceSnapshots(new List<ServiceStatusSnapshotIngest>
        {
            new()
            {
                Timestamp = DateTime.UtcNow,
                ServiceName = svc,
                State = state,
                Detail = detail
            }
        }).ConfigureAwait(false);

        return string.IsNullOrWhiteSpace(restartOutput)
            ? $"Service '{svc}' restarted. State={state}."
            : $"Service '{svc}' restarted. State={state}.\n{restartOutput}";
    }

    private static List<string> ExtractSmartDevicesOptional(JsonElement? payloadRoot)
    {
        if (payloadRoot is null)
        {
            return [];
        }

        var root = payloadRoot.Value;
        if (root.ValueKind != JsonValueKind.Object)
        {
            return [];
        }

        if (!root.TryGetProperty("devices", out var devicesEl) && !root.TryGetProperty("Devices", out devicesEl))
        {
            return [];
        }

        if (devicesEl.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var devices = new List<string>();
        foreach (var el in devicesEl.EnumerateArray())
        {
            var s = el.GetString()?.Trim();
            if (!string.IsNullOrWhiteSpace(s))
            {
                devices.Add(s);
            }
        }

        return devices;
    }

    private async Task<string> HandleSmartScanAsync(Guid commandId, JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        if (!IsLinux())
        {
            throw new NotSupportedException("smart.scan is supported on Linux agents only.");
        }

        if (_sendSmartSnapshots is null)
        {
            throw new InvalidOperationException("SMART snapshot sender is not configured.");
        }

        var logger = _loggerFactory.CreateLogger("ManLab.Agent.Commands.SmartScan");

        var requestedDevices = ExtractSmartDevicesOptional(payloadRoot);
        var devices = requestedDevices.Count > 0 ? requestedDevices : await DetectSmartDevicesAsync(logger, cancellationToken).ConfigureAwait(false);

        if (devices.Count == 0)
        {
            return "No SMART-capable devices detected.";
        }

        if (devices.Count > 16)
        {
            devices = devices.Take(16).ToList();
        }

        var snapshots = new List<SmartDriveSnapshotIngest>(devices.Count);

        for (var i = 0; i < devices.Count; i++)
        {
            var dev = devices[i];
            await _updateStatusCallback(commandId, "InProgress", $"SMART scan {i + 1}/{devices.Count}: {dev}").ConfigureAwait(false);

            var raw = await ShellExecutor.ExecuteAsync(
                $"smartctl -a -j {dev}",
                TimeSpan.FromSeconds(30),
                70_000,
                logger,
                cancellationToken).ConfigureAwait(false);

            var (health, tempC, powerOnHours) = TryParseSmartctlJson(raw);

            snapshots.Add(new SmartDriveSnapshotIngest
            {
                Timestamp = DateTime.UtcNow,
                Device = dev,
                Health = health,
                TemperatureC = tempC,
                PowerOnHours = powerOnHours,
                RawJson = raw
            });
        }

        await _sendSmartSnapshots(snapshots).ConfigureAwait(false);
        return $"SMART snapshots sent: {snapshots.Count}.";
    }

    private async Task<List<string>> DetectSmartDevicesAsync(ILogger logger, CancellationToken cancellationToken)
    {
        var scanJson = await ShellExecutor.ExecuteAsync(
            "smartctl --scan-open -j",
            TimeSpan.FromSeconds(15),
            32_768,
            logger,
            cancellationToken).ConfigureAwait(false);

        var devices = new List<string>();

        try
        {
            using var doc = JsonDocument.Parse(scanJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return devices;
            }

            if (!root.TryGetProperty("devices", out var devs) || devs.ValueKind != JsonValueKind.Array)
            {
                return devices;
            }

            foreach (var dev in devs.EnumerateArray())
            {
                if (dev.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                if (dev.TryGetProperty("name", out var nameEl))
                {
                    var name = nameEl.GetString()?.Trim();
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        devices.Add(name);
                    }
                }
            }
        }
        catch
        {
            // If parsing fails, treat as no devices.
        }

        return devices.Distinct(StringComparer.Ordinal).ToList();
    }

    private static (string health, float? tempC, int? powerOnHours) TryParseSmartctlJson(string? rawJson)
    {
        if (string.IsNullOrWhiteSpace(rawJson))
        {
            return ("unknown", null, null);
        }

        try
        {
            using var doc = JsonDocument.Parse(rawJson);
            var root = doc.RootElement;

            // Health
            var health = "unknown";
            if (root.TryGetProperty("smart_status", out var smartStatus)
                && smartStatus.ValueKind == JsonValueKind.Object
                && smartStatus.TryGetProperty("passed", out var passedEl)
                && passedEl.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                health = passedEl.GetBoolean() ? "pass" : "fail";
            }

            // Temperature: try a few common shapes.
            float? tempC = null;
            if (root.TryGetProperty("temperature", out var temperatureObj)
                && temperatureObj.ValueKind == JsonValueKind.Object
                && temperatureObj.TryGetProperty("current", out var currentEl)
                && currentEl.TryGetSingle(out var t1))
            {
                tempC = t1;
            }
            else if (root.TryGetProperty("nvme_smart_health_information_log", out var nvme)
                && nvme.ValueKind == JsonValueKind.Object
                && nvme.TryGetProperty("temperature", out var nvmeTemp)
                && nvmeTemp.TryGetSingle(out var t2))
            {
                // NVMe reports Kelvin in some outputs; smartctl JSON typically reports Celsius.
                tempC = t2;
            }

            // Power-on hours
            int? poh = null;
            if (root.TryGetProperty("power_on_time", out var pot)
                && pot.ValueKind == JsonValueKind.Object
                && pot.TryGetProperty("hours", out var hoursEl)
                && hoursEl.TryGetInt32(out var hours))
            {
                poh = hours;
            }

            return (health, tempC, poh);
        }
        catch
        {
            return ("unknown", null, null);
        }
    }

    #region Terminal Handlers

    private async Task<string> HandleTerminalOpenAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        if (_terminalHandler is null)
        {
            throw new InvalidOperationException("Terminal handler is not configured.");
        }

        var sessionId = ExtractSessionIdStrict(payloadRoot);
        return await _terminalHandler.OpenAsync(sessionId, cancellationToken).ConfigureAwait(false);
    }

    private async Task<string> HandleTerminalInputAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        if (_terminalHandler is null)
        {
            throw new InvalidOperationException("Terminal handler is not configured.");
        }

        var (sessionId, input) = ExtractTerminalInputStrict(payloadRoot);
        return await _terminalHandler.SendInputAsync(sessionId, input).ConfigureAwait(false);
    }

    private async Task<string> HandleTerminalCloseAsync(JsonElement? payloadRoot, CancellationToken cancellationToken)
    {
        if (_terminalHandler is null)
        {
            throw new InvalidOperationException("Terminal handler is not configured.");
        }

        var sessionId = ExtractSessionIdStrict(payloadRoot);
        return await _terminalHandler.CloseAsync(sessionId).ConfigureAwait(false);
    }

    private static Guid ExtractSessionIdStrict(JsonElement? payloadRoot)
    {
        if (payloadRoot is null)
        {
            throw new ArgumentException("Command payload is required with a 'sessionId' property.");
        }

        var root = payloadRoot.Value;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Command payload must be a JSON object.");
        }

        Guid? sessionId = null;
        if (root.TryGetProperty("sessionId", out var el) || root.TryGetProperty("SessionId", out el))
        {
            if (el.ValueKind == JsonValueKind.String && Guid.TryParse(el.GetString(), out var g))
            {
                sessionId = g;
            }
        }

        if (sessionId is null || sessionId == Guid.Empty)
        {
            throw new ArgumentException("Command payload must include a valid 'sessionId'.");
        }

        return sessionId.Value;
    }

    private static (Guid SessionId, string Input) ExtractTerminalInputStrict(JsonElement? payloadRoot)
    {
        if (payloadRoot is null)
        {
            throw new ArgumentException("Command payload is required with 'sessionId' and 'input' properties.");
        }

        var root = payloadRoot.Value;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Command payload must be a JSON object.");
        }

        var sessionId = ExtractSessionIdStrict(payloadRoot);

        string? input = null;
        if (root.TryGetProperty("input", out var inputEl) || root.TryGetProperty("Input", out inputEl))
        {
            input = inputEl.GetString();
        }

        if (string.IsNullOrEmpty(input))
        {
            throw new ArgumentException("Command payload must include non-empty 'input'.");
        }

        return (sessionId, input);
    }

    #endregion

    public void Dispose()
    {
        _dockerManager.Dispose();
        _terminalHandler?.Dispose();
    }

    private static bool IsRemoteToolCommand(string normalizedType)
    {
        return normalizedType == CommandTypes.LogRead
            || normalizedType == CommandTypes.LogTail
            || normalizedType == CommandTypes.ScriptRun
            || normalizedType == CommandTypes.TerminalOpen
            || normalizedType == CommandTypes.TerminalClose
            || normalizedType == CommandTypes.TerminalInput;
    }

    private bool IsRemoteToolEnabled(string normalizedType)
    {
        if (normalizedType == CommandTypes.LogRead || normalizedType == CommandTypes.LogTail)
        {
            return _config.EnableLogViewer;
        }

        if (normalizedType == CommandTypes.ScriptRun)
        {
            return _config.EnableScripts;
        }

        if (normalizedType == CommandTypes.TerminalOpen || normalizedType == CommandTypes.TerminalClose || normalizedType == CommandTypes.TerminalInput)
        {
            return _config.EnableTerminal;
        }

        return true;
    }
}
