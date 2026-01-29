using ManLab.Server.Services;
using ManLab.Server.Services.Monitoring;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.SettingsManage)]
public class ProcessMonitoringController : ControllerBase
{
    private readonly IProcessMonitoringConfigurationService _configService;
    private readonly ILogger<ProcessMonitoringController> _logger;

    public ProcessMonitoringController(
        IProcessMonitoringConfigurationService configService,
        ILogger<ProcessMonitoringController> logger)
    {
        _configService = configService;
        _logger = logger;
    }

    /// <summary>
    /// Gets the global process monitoring configuration.
    /// </summary>
    [HttpGet("global")]
    public async Task<ActionResult<ProcessMonitoringConfig>> GetGlobalConfig()
    {
        try
        {
            var config = await _configService.GetGlobalConfigAsync();
            return Ok(config);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get global process monitoring configuration");
            return StatusCode(500, new { error = "Failed to retrieve global configuration" });
        }
    }

    /// <summary>
    /// Updates the global process monitoring configuration.
    /// </summary>
    [HttpPut("global")]
    public async Task<ActionResult> UpdateGlobalConfig([FromBody] ProcessMonitoringConfig config)
    {
        try
        {
            await _configService.SetGlobalConfigAsync(config);
            _logger.LogInformation("Global process monitoring configuration updated");
            return Ok();
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid global process monitoring configuration");
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update global process monitoring configuration");
            return StatusCode(500, new { error = "Failed to update global configuration" });
        }
    }

    /// <summary>
    /// Gets the process monitoring configuration for a specific node.
    /// </summary>
    [HttpGet("node/{nodeId}")]
    public async Task<ActionResult<ProcessMonitoringConfig>> GetNodeConfig(Guid nodeId)
    {
        try
        {
            var config = await _configService.GetNodeConfigAsync(nodeId);
            return Ok(config);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get process monitoring configuration for node {NodeId}", nodeId);
            return StatusCode(500, new { error = "Failed to retrieve node configuration" });
        }
    }

    /// <summary>
    /// Sets or overrides the process monitoring configuration for a specific node.
    /// </summary>
    [HttpPut("node/{nodeId}")]
    public async Task<ActionResult> SetNodeConfig(Guid nodeId, [FromBody] ProcessMonitoringConfig config)
    {
        try
        {
            await _configService.SetNodeConfigAsync(nodeId, config);
            _logger.LogInformation("Process monitoring configuration updated for node {NodeId}", nodeId);
            return Ok();
        }
        catch (ArgumentException ex)
        {
            _logger.LogWarning(ex, "Invalid process monitoring configuration for node {NodeId}", nodeId);
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update process monitoring configuration for node {NodeId}", nodeId);
            return StatusCode(500, new { error = "Failed to update node configuration" });
        }
    }

    /// <summary>
    /// Resets the process monitoring configuration for a specific node to global defaults.
    /// </summary>
    [HttpDelete("node/{nodeId}")]
    public async Task<ActionResult> ResetNodeConfig(Guid nodeId)
    {
        try
        {
            await _configService.ResetNodeConfigAsync(nodeId);
            _logger.LogInformation("Process monitoring configuration reset to defaults for node {NodeId}", nodeId);
            return Ok();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to reset process monitoring configuration for node {NodeId}", nodeId);
            return StatusCode(500, new { error = "Failed to reset node configuration" });
        }
    }
}
