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
}
