namespace ManLab.Server.Constants;

public static class SettingKeys
{
    public static class Agent
    {
        public const string HeartbeatIntervalSeconds = "Agent.HeartbeatIntervalSeconds";
        public const string MaxReconnectDelaySeconds = "Agent.MaxReconnectDelaySeconds";
    }

    public static class Discord
    {
        public const string WebhookUrl = "Discord.WebhookUrl";
    }

    public static class GitHub
    {
        /// <summary>
        /// Base URL for GitHub releases (e.g., https://github.com/owner/repo/releases/download)
        /// </summary>
        public const string ReleaseBaseUrl = "GitHub.ReleaseBaseUrl";

        /// <summary>
        /// Whether to enable downloading agent binaries from GitHub releases.
        /// When enabled, install scripts will try GitHub first and fall back to server API.
        /// </summary>
        public const string EnableGitHubDownload = "GitHub.EnableGitHubDownload";

        /// <summary>
        /// The latest release version tag (e.g., v1.0.0). Used for constructing download URLs.
        /// </summary>
        public const string LatestVersion = "GitHub.LatestVersion";
    }
}
