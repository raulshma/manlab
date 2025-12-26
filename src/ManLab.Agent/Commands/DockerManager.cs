using Docker.DotNet;
using Docker.DotNet.Models;
using Microsoft.Extensions.Logging;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace ManLab.Agent.Commands;

/// <summary>
/// Manages Docker container operations via Docker.DotNet.
/// Uses platform-specific socket/pipe connections.
/// </summary>
public sealed class DockerManager : IDisposable
{
    private readonly ILogger<DockerManager> _logger;
    private readonly DockerClient? _client;
    private readonly bool _isAvailable;

    public DockerManager(ILogger<DockerManager> logger)
    {
        _logger = logger;

        try
        {
            var dockerUri = GetDockerUri();
            _client = new DockerClientConfiguration(dockerUri).CreateClient();
            _isAvailable = true;
            _logger.LogInformation("Docker client initialized: {Uri}", dockerUri);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Docker is not available on this system");
            _isAvailable = false;
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
        if (!_isAvailable || _client == null)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            var containers = await _client.Containers.ListContainersAsync(
                new ContainersListParameters { All = true },
                cancellationToken).ConfigureAwait(false);

            var result = containers.Select(c => new ContainerInfo(
                Id: c.ID[..12], // Short ID
                Names: c.Names,
                Image: c.Image,
                State: c.State,
                Status: c.Status,
                Created: c.Created
            )).ToList();

            _logger.LogInformation("Listed {Count} containers", result.Count);
            return JsonSerializer.Serialize(result, DockerJsonContext.Default.ListContainerInfo);
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
        if (!_isAvailable || _client == null)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            _logger.LogInformation("Restarting container: {ContainerId}", containerId);
            
            await _client.Containers.RestartContainerAsync(
                containerId,
                new ContainerRestartParameters { WaitBeforeKillSeconds = 10 },
                cancellationToken).ConfigureAwait(false);

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
        if (!_isAvailable || _client == null)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            _logger.LogInformation("Stopping container: {ContainerId}", containerId);
            
            await _client.Containers.StopContainerAsync(
                containerId,
                new ContainerStopParameters { WaitBeforeKillSeconds = 10 },
                cancellationToken).ConfigureAwait(false);

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
        if (!_isAvailable || _client == null)
        {
            return JsonSerializer.Serialize(
                new DockerErrorResponse("Docker is not available"),
                DockerJsonContext.Default.DockerErrorResponse);
        }

        try
        {
            _logger.LogInformation("Starting container: {ContainerId}", containerId);
            
            await _client.Containers.StartContainerAsync(
                containerId,
                new ContainerStartParameters(),
                cancellationToken).ConfigureAwait(false);

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

    private static Uri GetDockerUri()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return new Uri("npipe://./pipe/docker_engine");
        }
        else
        {
            return new Uri("unix:///var/run/docker.sock");
        }
    }

    public void Dispose()
    {
        _client?.Dispose();
    }
}
