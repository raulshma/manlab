export const SettingKeys = {
  Agent: {
    // Connection settings
    HeartbeatIntervalSeconds: "Agent.HeartbeatIntervalSeconds",
    MaxReconnectDelaySeconds: "Agent.MaxReconnectDelaySeconds",
    // Telemetry settings
    TelemetryCacheSeconds: "Agent.TelemetryCacheSeconds",
    PrimaryInterfaceName: "Agent.PrimaryInterfaceName",
    EnableNetworkTelemetry: "Agent.EnableNetworkTelemetry",
    EnablePingTelemetry: "Agent.EnablePingTelemetry",
    EnableGpuTelemetry: "Agent.EnableGpuTelemetry",
    EnableUpsTelemetry: "Agent.EnableUpsTelemetry",
    // Remote tools (security-sensitive)
    EnableLogViewer: "Agent.EnableLogViewer",
    EnableScripts: "Agent.EnableScripts",
    EnableTerminal: "Agent.EnableTerminal",
    // Ping settings
    PingTarget: "Agent.PingTarget",
    PingTimeoutMs: "Agent.PingTimeoutMs",
    PingWindowSize: "Agent.PingWindowSize",
    // Rate limits and bounds
    LogMaxBytes: "Agent.LogMaxBytes",
    LogMinSecondsBetweenRequests: "Agent.LogMinSecondsBetweenRequests",
    ScriptMaxOutputBytes: "Agent.ScriptMaxOutputBytes",
    ScriptMaxDurationSeconds: "Agent.ScriptMaxDurationSeconds",
    ScriptMinSecondsBetweenRuns: "Agent.ScriptMinSecondsBetweenRuns",
    TerminalMaxOutputBytes: "Agent.TerminalMaxOutputBytes",
    TerminalMaxDurationSeconds: "Agent.TerminalMaxDurationSeconds",
    // Agent self-logging settings
    AgentLogFilePath: "Agent.AgentLogFilePath",
    AgentLogFileMaxBytes: "Agent.AgentLogFileMaxBytes",
    AgentLogFileRetainedFiles: "Agent.AgentLogFileRetainedFiles",
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
