using ManLab.Server.Data.Entities;
using ManLab.Server.Services;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Quartz;
using System.Net.Http.Headers;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.SettingsManage)]
public class SettingsController : ControllerBase
{
    private readonly ISettingsService _settingsService;
    private readonly ILogger<SettingsController> _logger;
    private readonly DiscordWebhookNotificationService _discordService; // Direct dependency for testing, ideally use interface/event
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly AutoUpdateScheduler _autoUpdateScheduler;
    private readonly SystemUpdateScheduler _systemUpdateScheduler;

    public SettingsController(
        ISettingsService settingsService,
        ILogger<SettingsController> logger,
        // Using concrete type here to access the test method we'll add,
        // or we could add SendTestMessage to INotificationService
        DiscordWebhookNotificationService discordService,
        IHttpClientFactory httpClientFactory,
        AutoUpdateScheduler autoUpdateScheduler,
        SystemUpdateScheduler systemUpdateScheduler)
    {
        _settingsService = settingsService;
        _logger = logger;
        _discordService = discordService;
        _httpClientFactory = httpClientFactory;
        _autoUpdateScheduler = autoUpdateScheduler;
        _systemUpdateScheduler = systemUpdateScheduler;
    }

    [HttpGet]
    public async Task<ActionResult<List<SystemSetting>>> GetAllSettings()
    {
        return await _settingsService.GetAllAsync();
    }

    [HttpPost]
    public async Task<ActionResult> UpdateSettings([FromBody] List<SystemSetting> settings)
    {
        foreach (var setting in settings)
        {
            await _settingsService.SetValueAsync(setting.Key, setting.Value, setting.Category, setting.Description);
        }
        return Ok();
    }

    [HttpPost("test-discord")]
    public async Task<ActionResult> TestDiscord([FromBody] string webhookUrl)
    {
        if (string.IsNullOrWhiteSpace(webhookUrl))
        {
            return BadRequest("Webhook URL is required.");
        }

        try
        {
            await _discordService.SendTestMessageAsync(webhookUrl);
            return Ok();
        }
        catch (Exception ex)
        {
            return BadRequest($"Failed to send test message: {ex.Message}");
        }
    }

    /// <summary>
    /// Gets GitHub update configuration.
    /// </summary>
    [HttpGet("github-update")]
    public async Task<ActionResult<GitHubUpdateConfigDto>> GetGitHubUpdateConfig()
    {
        var enabled = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.EnableGitHubDownload, false);
        var baseUrl = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.ReleaseBaseUrl);
        var repository = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.Repository);
        var versionStrategy = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.VersionStrategy, "latest-stable");
        var manualVersion = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.LatestVersion);
        var preferGitHub = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.PreferGitHubForUpdates, false);

        return Ok(new GitHubUpdateConfigDto
        {
            Enabled = enabled,
            ReleaseBaseUrl = baseUrl,
            Repository = repository,
            VersionStrategy = versionStrategy,
            ManualVersion = manualVersion,
            PreferGitHubForUpdates = preferGitHub
        });
    }

    /// <summary>
    /// Updates GitHub update configuration.
    /// </summary>
    [HttpPut("github-update")]
    public async Task<ActionResult> UpdateGitHubUpdateConfig([FromBody] UpdateGitHubUpdateConfigRequest request)
    {
        // Validate version strategy
        var validStrategies = new[] { "latest-stable", "latest-prerelease", "manual" };
        if (!validStrategies.Contains(request.VersionStrategy, StringComparer.OrdinalIgnoreCase))
        {
            return BadRequest($"Version strategy must be one of: {string.Join(", ", validStrategies)}");
        }

        // Validate repository format if provided
        if (!string.IsNullOrWhiteSpace(request.Repository))
        {
            var parts = request.Repository.Split('/');
            if (parts.Length != 2 || string.IsNullOrWhiteSpace(parts[0]) || string.IsNullOrWhiteSpace(parts[1]))
            {
                return BadRequest("Repository must be in format 'owner/repo'");
            }
        }

        // Validate base URL if provided
        if (!string.IsNullOrWhiteSpace(request.ReleaseBaseUrl))
        {
            if (!Uri.TryCreate(request.ReleaseBaseUrl, UriKind.Absolute, out var uri) ||
                !string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest("Release base URL must be a valid GitHub URL");
            }
        }

        // Update settings
        await _settingsService.SetValueAsync(
            Constants.SettingKeys.GitHub.EnableGitHubDownload,
            request.Enabled.ToString(),
            "GitHub",
            "Enable downloading agent binaries from GitHub releases");

        await _settingsService.SetValueAsync(
            Constants.SettingKeys.GitHub.ReleaseBaseUrl,
            request.ReleaseBaseUrl,
            "GitHub",
            "Base URL for GitHub releases (e.g., https://github.com/owner/repo/releases/download)");

        await _settingsService.SetValueAsync(
            Constants.SettingKeys.GitHub.Repository,
            request.Repository,
            "GitHub",
            "GitHub repository in format 'owner/repo'");

        await _settingsService.SetValueAsync(
            Constants.SettingKeys.GitHub.VersionStrategy,
            request.VersionStrategy,
            "GitHub",
            "Version selection strategy: latest-stable, latest-prerelease, or manual");

        await _settingsService.SetValueAsync(
            Constants.SettingKeys.GitHub.LatestVersion,
            request.ManualVersion,
            "GitHub",
            "Manually specified version (used when strategy is 'manual')");

        await _settingsService.SetValueAsync(
            Constants.SettingKeys.GitHub.PreferGitHubForUpdates,
            request.PreferGitHubForUpdates.ToString(),
            "GitHub",
            "Prefer GitHub releases over local binaries for auto-updates");

        return NoContent();
    }

    /// <summary>
    /// Gets update job configuration.
    /// </summary>
    [HttpGet("update-jobs")]
    public async Task<ActionResult<UpdateJobsConfigDto>> GetUpdateJobsConfig()
    {
        // Agent update job settings
        var agentJobEnabled = await _settingsService.GetValueAsync(Constants.SettingKeys.AutoUpdate.JobEnabled, true);
        var agentJobSchedule = await _settingsService.GetValueAsync(Constants.SettingKeys.AutoUpdate.JobSchedule, "0 */15 * * * ?");
        var agentJobApprovalMode = await _settingsService.GetValueAsync(Constants.SettingKeys.AutoUpdate.JobApprovalMode, "manual");
        var agentJobSendDiscord = await _settingsService.GetValueAsync(Constants.SettingKeys.AutoUpdate.JobSendDiscordNotification, false);

        // System update job settings
        var systemJobEnabled = await _settingsService.GetValueAsync(Constants.SettingKeys.SystemUpdate.JobEnabled, true);
        var systemJobSchedule = await _settingsService.GetValueAsync(Constants.SettingKeys.SystemUpdate.JobSchedule, "0 0 */6 * * ?");
        var systemJobAutoApprove = await _settingsService.GetValueAsync(Constants.SettingKeys.SystemUpdate.JobAutoApprove, false);
        var systemJobSendDiscord = await _settingsService.GetValueAsync(Constants.SettingKeys.SystemUpdate.JobSendDiscordNotification, false);

        return Ok(new UpdateJobsConfigDto
        {
            AgentUpdate = new AgentUpdateJobConfigDto
            {
                Enabled = agentJobEnabled,
                Schedule = agentJobSchedule,
                ApprovalMode = agentJobApprovalMode,
                SendDiscordNotification = agentJobSendDiscord
            },
            SystemUpdate = new SystemUpdateJobConfigDto
            {
                Enabled = systemJobEnabled,
                Schedule = systemJobSchedule,
                AutoApprove = systemJobAutoApprove,
                SendDiscordNotification = systemJobSendDiscord
            }
        });
    }

    /// <summary>
    /// Updates update job configuration.
    /// </summary>
    [HttpPut("update-jobs")]
    public async Task<ActionResult> UpdateUpdateJobsConfig([FromBody] UpdateUpdateJobsConfigRequest request, CancellationToken ct)
    {
        // Validate cron expressions
        if (!string.IsNullOrWhiteSpace(request.AgentUpdate?.Schedule) &&
            !Quartz.CronExpression.IsValidExpression(request.AgentUpdate.Schedule))
        {
            return BadRequest(new { error = "Invalid agent update job schedule (invalid cron expression)" });
        }

        if (!string.IsNullOrWhiteSpace(request.SystemUpdate?.Schedule) &&
            !Quartz.CronExpression.IsValidExpression(request.SystemUpdate.Schedule))
        {
            return BadRequest(new { error = "Invalid system update job schedule (invalid cron expression)" });
        }

        // Validate approval mode
        if (request.AgentUpdate != null &&
            request.AgentUpdate.ApprovalMode != "automatic" &&
            request.AgentUpdate.ApprovalMode != "manual")
        {
            return BadRequest(new { error = "Agent update approval mode must be 'automatic' or 'manual'" });
        }

        // Update agent update job settings
        if (request.AgentUpdate != null)
        {
            await _settingsService.SetValueAsync(
                Constants.SettingKeys.AutoUpdate.JobEnabled,
                request.AgentUpdate.Enabled.ToString().ToLowerInvariant(),
                "AutoUpdate",
                "Whether the agent update job is enabled");

            await _settingsService.SetValueAsync(
                Constants.SettingKeys.AutoUpdate.JobSchedule,
                request.AgentUpdate.Schedule ?? "0 */15 * * * ?",
                "AutoUpdate",
                "Cron expression for the agent update job schedule");

            await _settingsService.SetValueAsync(
                Constants.SettingKeys.AutoUpdate.JobApprovalMode,
                request.AgentUpdate.ApprovalMode ?? "manual",
                "AutoUpdate",
                "Job-level approval mode for agent updates ('automatic' or 'manual')");

            await _settingsService.SetValueAsync(
                Constants.SettingKeys.AutoUpdate.JobSendDiscordNotification,
                request.AgentUpdate.SendDiscordNotification.ToString().ToLowerInvariant(),
                "AutoUpdate",
                "Whether to send Discord notifications for agent updates");

            // Sync scheduler
            if (request.AgentUpdate.Enabled)
            {
                await _autoUpdateScheduler.ScheduleGlobalAutoUpdateJobAsync(request.AgentUpdate.Schedule, ct);
            }
            else
            {
                await _autoUpdateScheduler.RemoveGlobalAutoUpdateJobAsync(ct);
            }
        }

        // Update system update job settings
        if (request.SystemUpdate != null)
        {
            await _settingsService.SetValueAsync(
                Constants.SettingKeys.SystemUpdate.JobEnabled,
                request.SystemUpdate.Enabled.ToString().ToLowerInvariant(),
                "SystemUpdate",
                "Whether the system update job is enabled");

            await _settingsService.SetValueAsync(
                Constants.SettingKeys.SystemUpdate.JobSchedule,
                request.SystemUpdate.Schedule ?? "0 0 */6 * * ?",
                "SystemUpdate",
                "Cron expression for the system update job schedule");

            await _settingsService.SetValueAsync(
                Constants.SettingKeys.SystemUpdate.JobAutoApprove,
                request.SystemUpdate.AutoApprove.ToString().ToLowerInvariant(),
                "SystemUpdate",
                "Job-level auto-approve setting for system updates");

            await _settingsService.SetValueAsync(
                Constants.SettingKeys.SystemUpdate.JobSendDiscordNotification,
                request.SystemUpdate.SendDiscordNotification.ToString().ToLowerInvariant(),
                "SystemUpdate",
                "Whether to send Discord notifications for system updates");

            // Sync scheduler
            if (request.SystemUpdate.Enabled)
            {
                await _systemUpdateScheduler.ScheduleGlobalSystemUpdateJobAsync(request.SystemUpdate.Schedule, ct);
            }
            else
            {
                await _systemUpdateScheduler.RemoveGlobalSystemUpdateJobAsync(ct);
            }
        }

        return NoContent();
    }

    /// <summary>
    /// Tests GitHub API connectivity and fetches available releases.
    /// </summary>
    [HttpPost("github-update/test")]
    public async Task<ActionResult<GitHubTestResultDto>> TestGitHubConnection([FromBody] TestGitHubConnectionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Repository))
        {
            return BadRequest("Repository is required");
        }

        var parts = request.Repository.Split('/');
        if (parts.Length != 2)
        {
            return BadRequest("Repository must be in format 'owner/repo'");
        }

        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("ManLab/1.0");
            httpClient.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

            var url = $"https://api.github.com/repos/{request.Repository}/releases?per_page=10";
            var response = await httpClient.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                return BadRequest(new GitHubTestResultDto
                {
                    Success = false,
                    Error = $"GitHub API returned {response.StatusCode}: {response.ReasonPhrase}",
                    Releases = Array.Empty<string>()
                });
            }

            await using var stream = await response.Content.ReadAsStreamAsync();
            var doc = await System.Text.Json.JsonDocument.ParseAsync(stream);

            var releases = new List<string>();
            if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array)
            {
                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    if (el.TryGetProperty("tag_name", out var tagEl) &&
                        tagEl.ValueKind == System.Text.Json.JsonValueKind.String)
                    {
                        var tag = tagEl.GetString();
                        if (!string.IsNullOrWhiteSpace(tag))
                        {
                            releases.Add(tag);
                        }
                    }
                }
            }

            return Ok(new GitHubTestResultDto
            {
                Success = true,
                Error = null,
                Releases = releases.ToArray()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to test GitHub connection for repository {Repository}", request.Repository);
            return BadRequest(new GitHubTestResultDto
            {
                Success = false,
                Error = ex.Message,
                Releases = Array.Empty<string>()
            });
        }
    }
}

/// <summary>
/// DTO for GitHub update configuration.
/// </summary>
public record GitHubUpdateConfigDto
{
    public bool Enabled { get; init; }
    public string? ReleaseBaseUrl { get; init; }
    public string? Repository { get; init; }
    public string VersionStrategy { get; init; } = "latest-stable";
    public string? ManualVersion { get; init; }
    public bool PreferGitHubForUpdates { get; init; }
}

/// <summary>
/// Request DTO for updating GitHub update configuration.
/// </summary>
public record UpdateGitHubUpdateConfigRequest
{
    public bool Enabled { get; init; }
    public string? ReleaseBaseUrl { get; init; }
    public string? Repository { get; init; }
    public string VersionStrategy { get; init; } = "latest-stable";
    public string? ManualVersion { get; init; }
    public bool PreferGitHubForUpdates { get; init; }
}

/// <summary>
/// Request DTO for testing GitHub connection.
/// </summary>
public record TestGitHubConnectionRequest
{
    public string Repository { get; init; } = string.Empty;
}

/// <summary>
/// Result DTO for GitHub connection test.
/// </summary>
public record GitHubTestResultDto
{
    public bool Success { get; init; }
    public string? Error { get; init; }
    public string[] Releases { get; init; } = Array.Empty<string>();
}

/// <summary>
/// DTO for update jobs configuration.
/// </summary>
public record UpdateJobsConfigDto
{
    public AgentUpdateJobConfigDto AgentUpdate { get; init; } = new();
    public SystemUpdateJobConfigDto SystemUpdate { get; init; } = new();
}

/// <summary>
/// DTO for agent update job configuration.
/// </summary>
public record AgentUpdateJobConfigDto
{
    public bool Enabled { get; init; }
    public string Schedule { get; init; } = "0 */15 * * * ?";
    public string ApprovalMode { get; init; } = "manual";
    public bool SendDiscordNotification { get; init; }
}

/// <summary>
/// DTO for system update job configuration.
/// </summary>
public record SystemUpdateJobConfigDto
{
    public bool Enabled { get; init; }
    public string Schedule { get; init; } = "0 0 */6 * * ?";
    public bool AutoApprove { get; init; }
    public bool SendDiscordNotification { get; init; }
}

/// <summary>
/// Request DTO for updating update jobs configuration.
/// </summary>
public record UpdateUpdateJobsConfigRequest
{
    public AgentUpdateJobConfigDto? AgentUpdate { get; init; }
    public SystemUpdateJobConfigDto? SystemUpdate { get; init; }
}
