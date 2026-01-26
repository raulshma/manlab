using Microsoft.Extensions.Logging;
using System.Diagnostics;
using System.Text.Json;
using System.IO;

namespace ManLab.Agent.Commands;

/// <summary>
/// Manages Docker container operations via Docker CLI.
/// Uses CLI commands instead of Docker.DotNet for Native AOT compatibility.
/// </summary>
public sealed class DockerManager : IDisposable
{
    private readonly ILogger<DockerManager> _logger;
    private readonly bool _isAvailable;
    private const int DefaultMaxLogBytes = 128 * 1024;
    private const int MaxLogBytes = 512 * 1024;

    public DockerManager(ILogger<DockerManager> logger)
    {
        _logger = logger;
        _isAvailable = CheckDockerAvailable();
        
        if (_isAvailable)
        {
            _logger.LogInformation("Docker CLI is available");
        }
        else
        {
            _logger.LogWarning("Docker CLI is not available on this system");
        }
    }

    /// <summary>
    /// Gets whether Docker is available on this system.
    /// </summary>
    public bool IsAvailable => _isAvailable;

    /// <summary>
    /// Lists all containers (running and stopped).
    /// </summary>
    public async Task<string> ListContainersAsync(CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            // Use docker ps with JSON format
            var (exitCode, output, error) = await RunDockerCommandAsync(
                "ps -a --format \"{{json .}}\"",
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker ps failed with exit code {ExitCode}: {Error}", exitCode, error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(string.IsNullOrEmpty(error) ? $"Docker command failed with exit code {exitCode}" : error),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            var containers = ParseContainerList(output);
            _logger.LogInformation("Listed {Count} containers", containers.Count);
            return JsonSerializer.Serialize(containers, DockerJsonContext.Default.ListContainerInfo);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to list containers");
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Restarts a container by ID.
    /// </summary>
    public async Task<string> RestartContainerAsync(string containerId, CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            _logger.LogInformation("Restarting container: {ContainerId}", containerId);
            
            var (exitCode, _, error) = await RunDockerCommandAsync(
                $"restart {containerId}",
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker restart failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error, containerId),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            _logger.LogInformation("Container restarted: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerActionResponse(true, containerId, "restart"),
                DockerJsonContext.Default.DockerActionResponse);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to restart container: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, containerId),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Stops a container by ID.
    /// </summary>
    public async Task<string> StopContainerAsync(string containerId, CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            _logger.LogInformation("Stopping container: {ContainerId}", containerId);
            
            var (exitCode, _, error) = await RunDockerCommandAsync(
                $"stop {containerId}",
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker stop failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error, containerId),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            _logger.LogInformation("Container stopped: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerActionResponse(true, containerId, "stop"),
                DockerJsonContext.Default.DockerActionResponse);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to stop container: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, containerId),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Starts a container by ID.
    /// </summary>
    public async Task<string> StartContainerAsync(string containerId, CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            _logger.LogInformation("Starting container: {ContainerId}", containerId);
            
            var (exitCode, _, error) = await RunDockerCommandAsync(
                $"start {containerId}",
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker start failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error, containerId),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            _logger.LogInformation("Container started: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerActionResponse(true, containerId, "start"),
                DockerJsonContext.Default.DockerActionResponse);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start container: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, containerId),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Inspects a container and returns raw JSON from docker inspect.
    /// </summary>
    public async Task<string> InspectContainerAsync(string containerId, CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            _logger.LogInformation("Inspecting container: {ContainerId}", containerId);

            var (exitCode, output, error) = await RunDockerCommandAsync(
                new[] { "inspect", containerId },
                env: null,
                workingDirectory: null,
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker inspect failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error, containerId),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            return output;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to inspect container: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, containerId),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Returns logs for a container with bounded output.
    /// </summary>
    public async Task<string> GetContainerLogsAsync(
        string containerId,
        int? tail,
        string? since,
        bool timestamps,
        int? maxBytes,
        CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            var args = new List<string> { "logs" };

            if (timestamps)
            {
                args.Add("--timestamps");
            }

            if (!string.IsNullOrWhiteSpace(since))
            {
                args.Add("--since");
                args.Add(since);
            }

            var tailLines = tail ?? 200;
            tailLines = Math.Clamp(tailLines, 0, 5000);
            args.Add("--tail");
            args.Add(tailLines.ToString());

            args.Add(containerId);

            var (exitCode, output, error) = await RunDockerCommandAsync(
                args,
                env: null,
                workingDirectory: null,
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker logs failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error, containerId),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            var max = maxBytes ?? DefaultMaxLogBytes;
            max = Math.Clamp(max, 1024, MaxLogBytes);

            var truncated = false;
            if (output.Length > max)
            {
                truncated = true;
                output = output[^max..];
            }

            var result = new DockerLogsResult(containerId, output, truncated, tailLines, since, timestamps);
            return JsonSerializer.Serialize(result, DockerJsonContext.Default.DockerLogsResult);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get logs for container: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, containerId),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Returns one-shot container stats (no-stream).
    /// </summary>
    public async Task<string> GetContainerStatsAsync(string? containerId, CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            var args = new List<string> { "stats", "--no-stream", "--format", "{{json .}}" };
            if (!string.IsNullOrWhiteSpace(containerId))
            {
                args.Add(containerId);
            }

            var (exitCode, output, error) = await RunDockerCommandAsync(
                args,
                env: null,
                workingDirectory: null,
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker stats failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error, containerId),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            var stats = ParseContainerStats(output);
            return JsonSerializer.Serialize(stats, DockerJsonContext.Default.ListDockerStatsInfo);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get container stats");
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, containerId),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Executes a command inside a container.
    /// </summary>
    public async Task<string> ExecContainerAsync(
        string containerId,
        IReadOnlyList<string> command,
        string? workingDir,
        string? user,
        IReadOnlyDictionary<string, string?>? environment,
        CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            var args = new List<string> { "exec" };

            if (!string.IsNullOrWhiteSpace(user))
            {
                args.Add("--user");
                args.Add(user);
            }

            if (!string.IsNullOrWhiteSpace(workingDir))
            {
                args.Add("--workdir");
                args.Add(workingDir);
            }

            if (environment is not null)
            {
                foreach (var kvp in environment)
                {
                    if (string.IsNullOrWhiteSpace(kvp.Key))
                    {
                        continue;
                    }

                    var value = kvp.Value ?? string.Empty;
                    args.Add("--env");
                    args.Add($"{kvp.Key}={value}");
                }
            }

            args.Add(containerId);
            args.AddRange(command);

            var (exitCode, output, error) = await RunDockerCommandAsync(
                args,
                env: null,
                workingDirectory: null,
                cancellationToken).ConfigureAwait(false);

            var result = new DockerExecResult(containerId, exitCode, output, error, exitCode == 0);
            return JsonSerializer.Serialize(result, DockerJsonContext.Default.DockerExecResult);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to exec in container: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, containerId),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Removes a container by ID.
    /// </summary>
    public async Task<string> RemoveContainerAsync(
        string containerId,
        bool force,
        bool removeVolumes,
        CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            var args = new List<string> { "rm" };
            if (force) args.Add("-f");
            if (removeVolumes) args.Add("-v");
            args.Add(containerId);

            var (exitCode, _, error) = await RunDockerCommandAsync(
                args,
                env: null,
                workingDirectory: null,
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker rm failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error, containerId),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            return JsonSerializer.Serialize(
                new DockerActionResponse(true, containerId, "remove"),
                DockerJsonContext.Default.DockerActionResponse);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to remove container: {ContainerId}", containerId);
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, containerId),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Lists Docker compose stacks.
    /// </summary>
    public async Task<string> ListComposeStacksAsync(CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            var (exitCode, output, error) = await RunDockerCommandAsync(
                new[] { "compose", "ls", "--format", "json" },
                env: null,
                workingDirectory: null,
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker compose ls failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            return output;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to list compose stacks");
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message),
                DockerJsonContext.Default.DockerErrorResponse);
        }
    }

    /// <summary>
    /// Brings up a compose stack from YAML content.
    /// </summary>
    public async Task<string> ComposeUpAsync(
        string projectName,
        string composeYaml,
        IReadOnlyDictionary<string, string?>? environment,
        bool detach,
        bool removeOrphans,
        IReadOnlyList<string>? profiles,
        CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        var tempDir = Path.Combine(Path.GetTempPath(), $"manlab-compose-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        var filePath = Path.Combine(tempDir, "compose.yaml");

        try
        {
            await File.WriteAllTextAsync(filePath, composeYaml, cancellationToken).ConfigureAwait(false);

            var args = new List<string> { "compose", "-f", filePath, "-p", projectName, "up" };
            if (detach)
            {
                args.Add("-d");
            }

            if (removeOrphans)
            {
                args.Add("--remove-orphans");
            }

            if (profiles is not null)
            {
                foreach (var profile in profiles)
                {
                    if (string.IsNullOrWhiteSpace(profile))
                    {
                        continue;
                    }

                    args.Add("--profile");
                    args.Add(profile.Trim());
                }
            }

            var (exitCode, output, error) = await RunDockerCommandAsync(
                args,
                env: environment,
                workingDirectory: tempDir,
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker compose up failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error, projectName),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            var result = new DockerComposeActionResponse(true, projectName, "up", output);
            return JsonSerializer.Serialize(result, DockerJsonContext.Default.DockerComposeActionResponse);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to compose up: {ProjectName}", projectName);
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, projectName),
                DockerJsonContext.Default.DockerErrorResponse);
        }
        finally
        {
            try { Directory.Delete(tempDir, recursive: true); } catch { /* ignore cleanup errors */ }
        }
    }

    /// <summary>
    /// Tears down a compose stack from YAML content.
    /// </summary>
    public async Task<string> ComposeDownAsync(
        string projectName,
        string composeYaml,
        IReadOnlyDictionary<string, string?>? environment,
        bool removeOrphans,
        bool removeVolumes,
        bool removeImages,
        CancellationToken cancellationToken = default)
    {
        if (!_isAvailable)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        var tempDir = Path.Combine(Path.GetTempPath(), $"manlab-compose-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        var filePath = Path.Combine(tempDir, "compose.yaml");

        try
        {
            await File.WriteAllTextAsync(filePath, composeYaml, cancellationToken).ConfigureAwait(false);

            var args = new List<string> { "compose", "-f", filePath, "-p", projectName, "down" };

            if (removeOrphans)
            {
                args.Add("--remove-orphans");
            }

            if (removeVolumes)
            {
                args.Add("--volumes");
            }

            if (removeImages)
            {
                args.Add("--rmi");
                args.Add("all");
            }

            var (exitCode, output, error) = await RunDockerCommandAsync(
                args,
                env: environment,
                workingDirectory: tempDir,
                cancellationToken).ConfigureAwait(false);

            if (exitCode != 0)
            {
                _logger.LogError("Docker compose down failed: {Error}", error);
                return JsonSerializer.Serialize(
                    new DockerErrorResponse(error, projectName),
                    DockerJsonContext.Default.DockerErrorResponse);
            }

            var result = new DockerComposeActionResponse(true, projectName, "down", output);
            return JsonSerializer.Serialize(result, DockerJsonContext.Default.DockerComposeActionResponse);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to compose down: {ProjectName}", projectName);
            return JsonSerializer.Serialize(
                new DockerErrorResponse(ex.Message, projectName),
                DockerJsonContext.Default.DockerErrorResponse);
        }
        finally
        {
            try { Directory.Delete(tempDir, recursive: true); } catch { /* ignore cleanup errors */ }
        }
    }

    private static bool CheckDockerAvailable()
    {
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "docker",
                    Arguments = "--version",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            
            process.Start();
            process.WaitForExit(5000);
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private static async Task<(int ExitCode, string Output, string Error)> RunDockerCommandAsync(
        string arguments,
        CancellationToken cancellationToken)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "docker",
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        process.Start();

        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);

        await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);

        var output = await outputTask.ConfigureAwait(false);
        var error = await errorTask.ConfigureAwait(false);

        return (process.ExitCode, output.Trim(), error.Trim());
    }

    private static async Task<(int ExitCode, string Output, string Error)> RunDockerCommandAsync(
        IReadOnlyList<string> arguments,
        IReadOnlyDictionary<string, string?>? env,
        string? workingDirectory,
        CancellationToken cancellationToken)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "docker",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        foreach (var arg in arguments)
        {
            process.StartInfo.ArgumentList.Add(arg);
        }

        if (!string.IsNullOrWhiteSpace(workingDirectory))
        {
            process.StartInfo.WorkingDirectory = workingDirectory;
        }

        if (env is not null)
        {
            foreach (var kvp in env)
            {
                if (string.IsNullOrWhiteSpace(kvp.Key))
                {
                    continue;
                }

                process.StartInfo.Environment[kvp.Key] = kvp.Value ?? string.Empty;
            }
        }

        process.Start();

        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);

        await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);

        var output = await outputTask.ConfigureAwait(false);
        var error = await errorTask.ConfigureAwait(false);

        return (process.ExitCode, output.Trim(), error.Trim());
    }

    private List<ContainerInfo> ParseContainerList(string output)
    {
        var containers = new List<ContainerInfo>();
        
        if (string.IsNullOrWhiteSpace(output))
        {
            return containers;
        }

        // Each line is a JSON object from docker ps --format "{{json .}}"
        foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var dockerContainer = JsonSerializer.Deserialize(line.Trim(), DockerCliJsonContext.Default.DockerPsOutput);
                if (dockerContainer != null)
                {
                    containers.Add(new ContainerInfo(
                        Id: dockerContainer.ID ?? "",
                        Names: [dockerContainer.Names ?? ""],
                        Image: dockerContainer.Image ?? "",
                        State: dockerContainer.State?.ToLowerInvariant() ?? "unknown",
                        Status: dockerContainer.Status ?? "",
                        Created: ParseCreatedAt(dockerContainer.CreatedAt)
                    ));
                }
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "Failed to parse container JSON line: {Line}", line);
            }
        }

        return containers;
    }

    private List<DockerStatsInfo> ParseContainerStats(string output)
    {
        var stats = new List<DockerStatsInfo>();

        if (string.IsNullOrWhiteSpace(output))
        {
            return stats;
        }

        foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var stat = JsonSerializer.Deserialize(line.Trim(), DockerCliJsonContext.Default.DockerStatsOutput);
                if (stat != null)
                {
                    stats.Add(new DockerStatsInfo(
                        Id: stat.ID ?? string.Empty,
                        Name: stat.Name ?? string.Empty,
                        CpuPercent: stat.CPUPerc ?? string.Empty,
                        MemUsage: stat.MemUsage ?? string.Empty,
                        MemPercent: stat.MemPerc ?? string.Empty,
                        NetIO: stat.NetIO ?? string.Empty,
                        BlockIO: stat.BlockIO ?? string.Empty,
                        Pids: stat.PIDs ?? string.Empty
                    ));
                }
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "Failed to parse docker stats JSON line: {Line}", line);
            }
        }

        return stats;
    }

    private static DateTime ParseCreatedAt(string? createdAt)
    {
        if (string.IsNullOrEmpty(createdAt))
        {
            return DateTime.MinValue;
        }

        // Docker returns format like "2024-01-15 10:30:00 +0000 UTC"
        // Try to parse it, fall back to MinValue
        if (DateTime.TryParse(createdAt.Replace(" UTC", "").Replace(" +0000", ""), out var result))
        {
            return result;
        }

        return DateTime.MinValue;
    }

    public void Dispose()
    {
        // No resources to dispose when using CLI
    }
}
