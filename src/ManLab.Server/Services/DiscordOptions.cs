namespace ManLab.Server.Services;

public sealed class DiscordOptions
{
    public const string SectionName = "Discord";

    /// <summary>
    /// Discord webhook URL. Prefer setting this via environment variable: Discord__WebhookUrl
    /// </summary>
    public string? WebhookUrl { get; set; }
}
