export const SettingKeys = {
  Agent: {
    HeartbeatIntervalSeconds: "Agent.HeartbeatIntervalSeconds",
    MaxReconnectDelaySeconds: "Agent.MaxReconnectDelaySeconds",
  },
  Discord: {
    WebhookUrl: "Discord.WebhookUrl",
  },
  GitHub: {
    EnableGitHubDownload: "GitHub.EnableGitHubDownload",
    ReleaseBaseUrl: "GitHub.ReleaseBaseUrl",
    LatestVersion: "GitHub.LatestVersion",
  },
} as const;
