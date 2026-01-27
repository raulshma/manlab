using ManLab.Server.Data.Entities;
using ManLab.Server.Services;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.SettingsManage)]
public class SettingsController : ControllerBase
{
    private readonly ISettingsService _settingsService;
    private readonly ILogger<SettingsController> _logger;
    private readonly DiscordWebhookNotificationService _discordService; // Direct dependency for testing, ideally use interface/event

    public SettingsController(
        ISettingsService settingsService,
        ILogger<SettingsController> logger,
        // Using concrete type here to access the test method we'll add, 
        // or we could add SendTestMessage to INotificationService
        DiscordWebhookNotificationService discordService) 
    {
        _settingsService = settingsService;
        _logger = logger;
        _discordService = discordService;
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
}
