using Microsoft.Extensions.Logging;
using System.Diagnostics;
using System.Text.Json;

namespace ManLab.Agent.Commands;

/// <summary>
/// Manages Docker container operations via Docker CLI.
/// Uses CLI commands instead of Docker.DotNet for Native AOT compatibility.
/// </summary>
public sealed class DockerManager : IDisposable
{
    private readonly ILogger<DockerManager> _logger;
    private readonly bool _isAvailable;

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
