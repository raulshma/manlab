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
            status.Status,
            status.CurrentOperation));
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

        var started = _installService.TryStartInstall(serverBaseUrl, request.Force);

        if (!started)
        {
            return Conflict(new LocalAgentInstallResponse(
                Started: false,
                Error: "Failed to start installation."));
        }

        _logger.LogInformation("Local agent installation started");
        return Accepted(new LocalAgentInstallResponse(Started: true, Error: null));
    }

    /// <summary>
    /// Triggers uninstallation of the local agent from the server machine.
    /// </summary>
    [HttpPost("uninstall")]
    public ActionResult<LocalAgentInstallResponse> Uninstall()
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

        if (!status.IsInstalled)
        {
            return BadRequest(new LocalAgentInstallResponse(
                Started: false,
                Error: "Local agent is not installed."));
        }

        var started = _installService.TryStartUninstall();

        if (!started)
        {
            return Conflict(new LocalAgentInstallResponse(
                Started: false,
                Error: "Failed to start uninstallation."));
        }

        _logger.LogInformation("Local agent uninstallation started");
        return Accepted(new LocalAgentInstallResponse(Started: true, Error: null));
    }

    public sealed record LocalAgentStatusResponse(
        bool IsSupported,
        bool IsInstalled,
        bool IsRunning,
        Guid? LinkedNodeId,
        string Status,
        string? CurrentOperation);

    public sealed record LocalAgentInstallRequest(bool Force = false);

    public sealed record LocalAgentInstallResponse(bool Started, string? Error);
}
