namespace ManLab.Server.Constants;

public static class SettingKeys
{
    public static class Agent
    {
        // Connection settings
        public const string HeartbeatIntervalSeconds = "Agent.HeartbeatIntervalSeconds";
        public const string MaxReconnectDelaySeconds = "Agent.MaxReconnectDelaySeconds";

        // Telemetry settings
        public const string TelemetryCacheSeconds = "Agent.TelemetryCacheSeconds";
        public const string PrimaryInterfaceName = "Agent.PrimaryInterfaceName";
        public const string EnableNetworkTelemetry = "Agent.EnableNetworkTelemetry";
        public const string EnablePingTelemetry = "Agent.EnablePingTelemetry";
        public const string EnableGpuTelemetry = "Agent.EnableGpuTelemetry";
        public const string EnableUpsTelemetry = "Agent.EnableUpsTelemetry";

        // Remote tools (security-sensitive)
        public const string EnableLogViewer = "Agent.EnableLogViewer";
        public const string EnableScripts = "Agent.EnableScripts";
        public const string EnableTerminal = "Agent.EnableTerminal";
        public const string EnableFileBrowser = "Agent.EnableFileBrowser";

        // Ping settings
        public const string PingTarget = "Agent.PingTarget";
        public const string PingTimeoutMs = "Agent.PingTimeoutMs";
        public const string PingWindowSize = "Agent.PingWindowSize";

        // Rate limits and bounds
        public const string LogMaxBytes = "Agent.LogMaxBytes";
        public const string LogMinSecondsBetweenRequests = "Agent.LogMinSecondsBetweenRequests";
        public const string ScriptMaxOutputBytes = "Agent.ScriptMaxOutputBytes";
        public const string ScriptMaxDurationSeconds = "Agent.ScriptMaxDurationSeconds";
        public const string ScriptMinSecondsBetweenRuns = "Agent.ScriptMinSecondsBetweenRuns";
        public const string TerminalMaxOutputBytes = "Agent.TerminalMaxOutputBytes";
        public const string TerminalMaxDurationSeconds = "Agent.TerminalMaxDurationSeconds";
        public const string FileBrowserMaxBytes = "Agent.FileBrowserMaxBytes";

        // Agent self-logging settings
        public const string AgentLogFilePath = "Agent.AgentLogFilePath";
        public const string AgentLogFileMaxBytes = "Agent.AgentLogFileMaxBytes";
        public const string AgentLogFileRetainedFiles = "Agent.AgentLogFileRetainedFiles";
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
