namespace ManLab.Server.Constants;

public static class SettingKeys
{
    public static class Auth
    {
        /// <summary>
        /// Whether dashboard/API authentication is required.
        /// </summary>
        public const string Enabled = "Auth.Enabled";

        /// <summary>
        /// Whether to bypass authentication for local network clients.
        /// </summary>
        public const string LocalBypassEnabled = "Auth.LocalBypassEnabled";

        /// <summary>
        /// Comma-separated list of CIDR ranges allowed to bypass auth.
        /// When empty, defaults to RFC1918 + loopback + link-local ranges.
        /// </summary>
        public const string LocalBypassCidrs = "Auth.LocalBypassCidrs";

        /// <summary>
        /// Stored admin password hash (PBKDF2/PasswordHasher format).
        /// </summary>
        public const string AdminPasswordHash = "Auth.AdminPasswordHash";
    }

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

        // Enhanced telemetry + APM (also used by the agent config and Web UI)
        public const string EnableEnhancedNetworkTelemetry = "Agent.EnableEnhancedNetworkTelemetry";
        public const string EnableEnhancedGpuTelemetry = "Agent.EnableEnhancedGpuTelemetry";
        public const string EnableApmTelemetry = "Agent.EnableApmTelemetry";
        public const string ApmHealthCheckEndpoints = "Agent.ApmHealthCheckEndpoints";
        public const string ApmDatabaseEndpoints = "Agent.ApmDatabaseEndpoints";

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
        public const string FileZipMaxUncompressedBytes = "Agent.FileZipMaxUncompressedBytes";
        public const string FileZipMaxFileCount = "Agent.FileZipMaxFileCount";

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

    public static class Network
    {
        public const string RealtimeEnabled = "Network.RealtimeEnabled";
        public const string NotificationsEnabled = "Network.NotificationsEnabled";
        public const string PingHost = "Network.PingHost";
        public const string PingTimeout = "Network.PingTimeout";
        public const string SubnetLast = "Network.SubnetLast";
        public const string SubnetConcurrency = "Network.SubnetConcurrency";
        public const string SubnetTimeout = "Network.SubnetTimeout";
        public const string PortHost = "Network.PortHost";
        public const string PortConcurrency = "Network.PortConcurrency";
        public const string PortTimeout = "Network.PortTimeout";
        public const string TracerouteHost = "Network.TracerouteHost";
        public const string TracerouteMaxHops = "Network.TracerouteMaxHops";
        public const string TracerouteTimeout = "Network.TracerouteTimeout";
        public const string DiscoveryDuration = "Network.DiscoveryDuration";
        public const string DiscoveryMode = "Network.DiscoveryMode";
        public const string WifiAdapter = "Network.WifiAdapter";
        public const string WifiBand = "Network.WifiBand";
        public const string WifiSecurity = "Network.WifiSecurity";
        public const string WolMac = "Network.WolMac";
        public const string WolBroadcast = "Network.WolBroadcast";
        public const string WolPort = "Network.WolPort";
        public const string SpeedtestDownloadMb = "Network.SpeedtestDownloadMb";
        public const string SpeedtestUploadMb = "Network.SpeedtestUploadMb";
        public const string SpeedtestLatencySamples = "Network.SpeedtestLatencySamples";
        public const string TopologyCidr = "Network.TopologyCidr";
        public const string TopologyConcurrency = "Network.TopologyConcurrency";
        public const string TopologyTimeout = "Network.TopologyTimeout";
        public const string TopologyIncludeDiscovery = "Network.TopologyIncludeDiscovery";
        public const string TopologyDiscoveryDuration = "Network.TopologyDiscoveryDuration";
    }
}
