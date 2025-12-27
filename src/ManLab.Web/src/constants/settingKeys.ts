export const SettingKeys = {
  Agent: {
    HeartbeatIntervalSeconds: "Agent.HeartbeatIntervalSeconds",
    MaxReconnectDelaySeconds: "Agent.MaxReconnectDelaySeconds",
  },
  Discord: {
    WebhookUrl: "Discord.WebhookUrl",
  },
} as const;
