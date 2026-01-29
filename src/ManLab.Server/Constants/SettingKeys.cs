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

        // Update settings
        public const string UpdateChannel = "Agent.Update.Channel";
    }

    public static class AutoUpdate
    {
        /// <summary>
        /// Whether automatic updates are enabled for this node.
        /// </summary>
        public const string Enabled = "AutoUpdate.Enabled";

        /// <summary>
        /// The update channel to use (stable, beta, etc.).
        /// </summary>
        public const string Channel = "AutoUpdate.Channel";

        /// <summary>
        /// Maintenance window for auto-updates (format: "HH:MM-HH:MM" in UTC).
        /// </summary>
        public const string MaintenanceWindow = "AutoUpdate.MaintenanceWindow";

        /// <summary>
        /// Approval mode: "automatic" or "manual".
        /// </summary>
        public const string ApprovalMode = "AutoUpdate.ApprovalMode";

        /// <summary>
        /// Timestamp of the last auto-update check attempt.
        /// </summary>
        public const string LastCheckAt = "AutoUpdate.LastCheckAt";

        /// <summary>
        /// Timestamp of the last successful auto-update.
        /// </summary>
        public const string LastUpdateAt = "AutoUpdate.LastUpdateAt";

        /// <summary>
        /// Number of consecutive auto-update failures.
        /// </summary>
        public const string FailureCount = "AutoUpdate.FailureCount";

        /// <summary>
        /// Pending update version awaiting manual approval (if any).
        /// </summary>
        public const string PendingVersion = "AutoUpdate.PendingVersion";

        /// <summary>
        /// Last error message from a failed auto-update attempt.
        /// </summary>
        public const string LastError = "AutoUpdate.LastError";

        /// <summary>
        /// Global setting: Whether the auto-update job is enabled (system-wide).
        /// </summary>
        public const string JobEnabled = "AutoUpdate.Job.Enabled";

        /// <summary>
        /// Global setting: Cron expression for the auto-update job schedule.
        /// </summary>
        public const string JobSchedule = "AutoUpdate.Job.Schedule";

        /// <summary>
        /// Global setting: Approval mode for the auto-update job ("automatic" or "manual").
        /// </summary>
        public const string JobApprovalMode = "AutoUpdate.Job.ApprovalMode";
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

        /// <summary>
        /// GitHub repository in format "owner/repo" (e.g., "manlab/agent").
        /// Used for fetching releases via GitHub API.
        /// </summary>
        public const string Repository = "GitHub.Repository";

        /// <summary>
        /// Version selection strategy: "latest-stable", "latest-prerelease", "manual".
        /// - latest-stable: Automatically use the latest non-prerelease semantic version
        /// - latest-prerelease: Include prereleases when finding the latest version
        /// - manual: Use the version specified in GitHub.LatestVersion
        /// </summary>
        public const string VersionStrategy = "GitHub.VersionStrategy";

        /// <summary>
        /// Whether to prefer GitHub releases over local binaries for auto-updates.
        /// When true, auto-update will check GitHub first, then fall back to local.
        /// When false, auto-update will check local first, then fall back to GitHub.
        /// </summary>
        public const string PreferGitHubForUpdates = "GitHub.PreferGitHubForUpdates";
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

    public static class SystemUpdate
    {
        /// <summary>
        /// Whether system updates are enabled for this node.
        /// </summary>
        public const string Enabled = "SystemUpdate.Enabled";

        /// <summary>
        /// Maintenance window for system updates (format: "HH:MM-HH:MM" in UTC).
        /// </summary>
        public const string MaintenanceWindow = "SystemUpdate.MaintenanceWindow";

        /// <summary>
        /// Day of week for scheduled updates (0-6, where 0=Monday, or null for any day).
        /// </summary>
        public const string ScheduledDayOfWeek = "SystemUpdate.ScheduledDayOfWeek";

        /// <summary>
        /// Auto-check interval in minutes (default: 360 = 6 hours).
        /// </summary>
        public const string CheckIntervalMinutes = "SystemUpdate.CheckIntervalMinutes";

        /// <summary>
        /// Whether to include security updates automatically.
        /// </summary>
        public const string IncludeSecurityUpdates = "SystemUpdate.IncludeSecurityUpdates";

        /// <summary>
        /// Whether to include feature updates.
        /// </summary>
        public const string IncludeFeatureUpdates = "SystemUpdate.IncludeFeatureUpdates";

        /// <summary>
        /// Whether to include driver updates.
        /// </summary>
        public const string IncludeDriverUpdates = "SystemUpdate.IncludeDriverUpdates";

        /// <summary>
        /// Whether to auto-approve updates (default: false for manual approval).
        /// </summary>
        public const string AutoApproveUpdates = "SystemUpdate.AutoApproveUpdates";

        /// <summary>
        /// Whether to auto-reboot after updates if needed (default: false).
        /// </summary>
        public const string AutoRebootIfNeeded = "SystemUpdate.AutoRebootIfNeeded";

        /// <summary>
        /// Timestamp of the last system update check.
        /// </summary>
        public const string LastCheckAt = "SystemUpdate.LastCheckAt";

        /// <summary>
        /// Timestamp of the last successful system update.
        /// </summary>
        public const string LastUpdateAt = "SystemUpdate.LastUpdateAt";

        /// <summary>
        /// Number of consecutive system update failures.
        /// </summary>
        public const string FailureCount = "SystemUpdate.FailureCount";

        /// <summary>
        /// Current pending system update ID awaiting approval.
        /// </summary>
        public const string PendingUpdateId = "SystemUpdate.PendingUpdateId";

        /// <summary>
        /// Package manager to use (auto-detect if empty: apt, yum, dnf, pacman, zypper, windows-update).
        /// </summary>
        public const string PackageManager = "SystemUpdate.PackageManager";

        /// <summary>
        /// Global setting: Whether the system update job is enabled (system-wide).
        /// </summary>
        public const string JobEnabled = "SystemUpdate.Job.Enabled";

        /// <summary>
        /// Global setting: Cron expression for the system update job schedule.
        /// </summary>
        public const string JobSchedule = "SystemUpdate.Job.Schedule";

        /// <summary>
        /// Global setting: Whether to auto-approve system updates at the job level.
        /// </summary>
        public const string JobAutoApprove = "SystemUpdate.Job.AutoApprove";
    }

    public static class ProcessMonitoring
    {
        // Global settings
        public const string Enabled = "ProcessMonitoring.Enabled";
        public const string DefaultTopCpuCount = "ProcessMonitoring.DefaultTopCpuCount";
        public const string DefaultTopMemoryCount = "ProcessMonitoring.DefaultTopMemoryCount";
        public const string DefaultRefreshIntervalSeconds = "ProcessMonitoring.DefaultRefreshIntervalSeconds";
        public const string DefaultCpuAlertThreshold = "ProcessMonitoring.DefaultCpuAlertThreshold";
        public const string DefaultMemoryAlertThreshold = "ProcessMonitoring.DefaultMemoryAlertThreshold";
        public const string DefaultExcludePatterns = "ProcessMonitoring.DefaultExcludePatterns";
        public const string AlertCooldownMinutes = "ProcessMonitoring.AlertCooldownMinutes";

        // Per-node settings (prefix with node ID)
        public const string NodeTopCpuCountPrefix = "ProcessMonitoring.Node.TopCpuCount.";
        public const string NodeTopMemoryCountPrefix = "ProcessMonitoring.Node.TopMemoryCount.";
        public const string NodeRefreshIntervalSecondsPrefix = "ProcessMonitoring.Node.RefreshIntervalSeconds.";
        public const string NodeCpuAlertThresholdPrefix = "ProcessMonitoring.Node.CpuAlertThreshold.";
        public const string NodeMemoryAlertThresholdPrefix = "ProcessMonitoring.Node.MemoryAlertThreshold.";
        public const string NodeExcludePatternsPrefix = "ProcessMonitoring.Node.ExcludePatterns.";
    }
}
