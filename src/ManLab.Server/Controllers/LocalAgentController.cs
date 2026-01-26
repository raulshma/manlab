using ManLab.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Controllers;

/// <summary>
/// Controller for managing the local agent installation on the server machine.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public sealed class LocalAgentController : ControllerBase
{
    private readonly LocalAgentInstallationService _installService;
    private readonly ILogger<LocalAgentController> _logger;

    public LocalAgentController(
        LocalAgentInstallationService installService,
        ILogger<LocalAgentController> logger)
    {
        _installService = installService;
        _logger = logger;
    }

    /// <summary>
    /// Gets the current status of the local agent installation.
    /// </summary>
    [HttpGet("status")]
    public ActionResult<LocalAgentStatusResponse> GetStatus()
    {
        var status = _installService.GetStatus();
        return Ok(new LocalAgentStatusResponse(
            status.IsSupported,
            status.IsInstalled,
            status.IsRunning,
            status.LinkedNodeId,
            status.AgentVersion,
            status.Status,
            status.CurrentOperation,
            status.InstallMode,
            status.HasSystemFiles,
            status.HasUserFiles,
            status.HasSystemTask,
            status.HasUserTask,
            status.OrphanedResources is not null
                ? new OrphanedResourcesResponse(
                    status.OrphanedResources.SystemDirectory is not null
                        ? new FileDirectoryResponse(
                            status.OrphanedResources.SystemDirectory.Path,
                            status.OrphanedResources.SystemDirectory.TotalSizeBytes,
                            status.OrphanedResources.SystemDirectory.FileCount,
                            status.OrphanedResources.SystemDirectory.Files)
                        : null,
                    status.OrphanedResources.UserDirectory is not null
                        ? new FileDirectoryResponse(
                            status.OrphanedResources.UserDirectory.Path,
                            status.OrphanedResources.UserDirectory.TotalSizeBytes,
                            status.OrphanedResources.UserDirectory.FileCount,
                            status.OrphanedResources.UserDirectory.Files)
                        : null,
                    status.OrphanedResources.SystemTask is not null
                        ? new TaskResponse(
                            status.OrphanedResources.SystemTask.Name,
                            status.OrphanedResources.SystemTask.State,
                            status.OrphanedResources.SystemTask.LastRunTime,
                            status.OrphanedResources.SystemTask.NextRunTime)
                        : null,
                    status.OrphanedResources.UserTask is not null
                        ? new TaskResponse(
                            status.OrphanedResources.UserTask.Name,
                            status.OrphanedResources.UserTask.State,
                            status.OrphanedResources.UserTask.LastRunTime,
                            status.OrphanedResources.UserTask.NextRunTime)
                        : null)
                : null));
    }

    /// <summary>
    /// Gets the default agent configuration values.
    /// </summary>
    [HttpGet("default-config")]
    public ActionResult<AgentConfigurationResponse> GetDefaultConfig()
    {
        // Return default values aligned with ManLab.Agent.Configuration.AgentConfiguration.
        // NOTE: The server does not reference the agent project directly, so defaults are mirrored here.
        return Ok(new AgentConfigurationResponse(
            HeartbeatIntervalSeconds: 15,
            MaxReconnectDelaySeconds: 60,
            TelemetryCacheSeconds: 30,
            PrimaryInterfaceName: null,
            EnableNetworkTelemetry: true,
            EnablePingTelemetry: true,
            EnableGpuTelemetry: true,
            EnableUpsTelemetry: true,
            PingTarget: null,
            PingTimeoutMs: 800,
            PingWindowSize: 10,
            EnableLogViewer: false,
            EnableScripts: false,
            EnableTerminal: false,
            EnableFileBrowser: false,
            LogMaxBytes: 64 * 1024,
            LogMinSecondsBetweenRequests: 1,
            ScriptMaxOutputBytes: 64 * 1024,
            ScriptMaxDurationSeconds: 60,
            ScriptMinSecondsBetweenRuns: 1,
            TerminalMaxOutputBytes: 64 * 1024,
            TerminalMaxDurationSeconds: 10 * 60,
            FileBrowserMaxBytes: 2 * 1024 * 1024,
            AgentLogFilePath: null,
            AgentLogFileMaxBytes: 5 * 1024 * 1024,
            AgentLogFileRetainedFiles: 3));
    }

    /// <summary>
    /// Triggers installation of the local agent on the server machine.
    /// </summary>
    [HttpPost("install")]
    public ActionResult<LocalAgentInstallResponse> Install([FromBody] LocalAgentInstallRequest request)
    {
        var status = _installService.GetStatus();

        if (!status.IsSupported)
        {
            return BadRequest(new LocalAgentInstallResponse(
                Started: false,
                Error: "Local agent installation is only supported on Windows."));
        }

        if (_installService.IsRunning)
        {
            return Conflict(new LocalAgentInstallResponse(
                Started: false,
                Error: "An operation is already in progress."));
        }

        if (status.IsInstalled && !request.Force)
        {
            return Conflict(new LocalAgentInstallResponse(
                Started: false,
                Error: "Local agent is already installed. Use force=true to reinstall."));
        }

        // Build server base URL from request
        var serverBaseUrl = $"{Request.Scheme}://{Request.Host}";

        // Map request config to service options
        AgentConfigOptions? configOptions = request.AgentConfig is not null
            ? new AgentConfigOptions(
                request.AgentConfig.HeartbeatIntervalSeconds,
                request.AgentConfig.MaxReconnectDelaySeconds)
            : null;

        var started = _installService.TryStartInstall(serverBaseUrl, request.Force, request.UserMode, configOptions);

        if (!started)
        {
            return Conflict(new LocalAgentInstallResponse(
                Started: false,
                Error: "Failed to start installation."));
        }

        var modeLabel = request.UserMode ? "user" : "system";
        _logger.LogInformation("Local agent installation started ({Mode} mode)", modeLabel);
        return Accepted(new LocalAgentInstallResponse(Started: true, Error: null));
    }

    /// <summary>
    /// Triggers uninstallation of the local agent from the server machine.
    /// </summary>
    [HttpPost("uninstall")]
    public ActionResult<LocalAgentInstallResponse> Uninstall([FromBody] LocalAgentUninstallRequest? request = null)
    {
        var userMode = request?.UserMode ?? false;
        var status = _installService.GetStatus();

        if (!status.IsSupported)
        {
            return BadRequest(new LocalAgentInstallResponse(
                Started: false,
                Error: "Local agent installation is only supported on Windows."));
        }

        if (_installService.IsRunning)
        {
            return Conflict(new LocalAgentInstallResponse(
                Started: false,
                Error: "An operation is already in progress."));
        }

        if (!status.IsInstalled)
        {
            return BadRequest(new LocalAgentInstallResponse(
                Started: false,
                Error: "Local agent is not installed."));
        }

        // Use the detected install mode if not explicitly specified
        if (status.InstallMode is not null)
        {
            userMode = status.InstallMode == "User";
        }

        var started = _installService.TryStartUninstall(userMode);

        if (!started)
        {
            return Conflict(new LocalAgentInstallResponse(
                Started: false,
                Error: "Failed to start uninstallation."));
        }

        var modeLabel = userMode ? "user" : "system";
        _logger.LogInformation("Local agent uninstallation started ({Mode} mode)", modeLabel);
        return Accepted(new LocalAgentInstallResponse(Started: true, Error: null));
    }

    /// <summary>
    /// Clears leftover agent files from the server machine.
    /// </summary>
    [HttpPost("clear-files")]
    public ActionResult<LocalAgentInstallResponse> ClearFiles([FromBody] LocalAgentClearFilesRequest? request = null)
    {
        var clearSystem = request?.ClearSystem ?? true;
        var clearUser = request?.ClearUser ?? true;
        var status = _installService.GetStatus();

        if (!status.IsSupported)
        {
            return BadRequest(new LocalAgentInstallResponse(
                Started: false,
                Error: "Local agent operations are only supported on Windows."));
        }

        if (_installService.IsRunning)
        {
            return Conflict(new LocalAgentInstallResponse(
                Started: false,
                Error: "An operation is already in progress."));
        }

        if (!status.HasSystemFiles && !status.HasUserFiles)
        {
            return BadRequest(new LocalAgentInstallResponse(
                Started: false,
                Error: "No agent files found to clear."));
        }

        var started = _installService.TryStartClearFiles(clearSystem && status.HasSystemFiles, clearUser && status.HasUserFiles);

        if (!started)
        {
            return Conflict(new LocalAgentInstallResponse(
                Started: false,
                Error: "Failed to start file cleanup."));
        }

        _logger.LogInformation("Local agent file cleanup started (system={ClearSystem}, user={ClearUser})", clearSystem, clearUser);
        return Accepted(new LocalAgentInstallResponse(Started: true, Error: null));
    }

    public sealed record LocalAgentStatusResponse(
        bool IsSupported,
        bool IsInstalled,
        bool IsRunning,
        Guid? LinkedNodeId,
        string? AgentVersion,
        string Status,
        string? CurrentOperation,
        string? InstallMode,
        bool HasSystemFiles,
        bool HasUserFiles,
        bool HasSystemTask,
        bool HasUserTask,
        OrphanedResourcesResponse? OrphanedResources);

    public sealed record OrphanedResourcesResponse(
        FileDirectoryResponse? SystemDirectory,
        FileDirectoryResponse? UserDirectory,
        TaskResponse? SystemTask,
        TaskResponse? UserTask);

    public sealed record FileDirectoryResponse(
        string Path,
        long TotalSizeBytes,
        int FileCount,
        string[] Files);

    public sealed record TaskResponse(
        string Name,
        string State,
        string? LastRunTime,
        string? NextRunTime);

    public sealed record LocalAgentInstallRequest(
        bool Force = false, 
        bool UserMode = false,
        AgentConfigurationRequest? AgentConfig = null);

    public sealed record LocalAgentUninstallRequest(bool UserMode = false);

    public sealed record LocalAgentClearFilesRequest(bool ClearSystem = true, bool ClearUser = true);

    public sealed record LocalAgentInstallResponse(bool Started, string? Error);

    /// <summary>
    /// Optional agent configuration settings for installation.
    /// When null, defaults from appsettings.json are used.
    /// </summary>
    public sealed record AgentConfigurationRequest(
        int? HeartbeatIntervalSeconds = null,
        int? MaxReconnectDelaySeconds = null);

    /// <summary>
    /// Default agent configuration values.
    /// </summary>
    public sealed record AgentConfigurationResponse(
        int HeartbeatIntervalSeconds,
        int MaxReconnectDelaySeconds,
        int TelemetryCacheSeconds,
        string? PrimaryInterfaceName,
        bool EnableNetworkTelemetry,
        bool EnablePingTelemetry,
        bool EnableGpuTelemetry,
        bool EnableUpsTelemetry,
        string? PingTarget,
        int PingTimeoutMs,
        int PingWindowSize,
        bool EnableLogViewer,
        bool EnableScripts,
        bool EnableTerminal,
        bool EnableFileBrowser,
        int LogMaxBytes,
        int LogMinSecondsBetweenRequests,
        int ScriptMaxOutputBytes,
        int ScriptMaxDurationSeconds,
        int ScriptMinSecondsBetweenRuns,
        int TerminalMaxOutputBytes,
        int TerminalMaxDurationSeconds,
        int FileBrowserMaxBytes,
        string? AgentLogFilePath,
        int AgentLogFileMaxBytes,
        int AgentLogFileRetainedFiles);
}
