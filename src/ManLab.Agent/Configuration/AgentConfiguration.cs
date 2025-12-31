using ManLab.Agent.Telemetry;

namespace ManLab.Agent.Configuration;

/// <summary>
/// Configuration settings for the ManLab agent.
/// </summary>
public class AgentConfiguration
{
    /// <summary>
    /// The URL of the ManLab server hub (e.g., "http://localhost:5000/hubs/agent").
    /// </summary>
    public string ServerUrl { get; set; } = "http://localhost:5000/hubs/agent";

    /// <summary>
    /// Authentication token for authenticating with the server.
    /// </summary>
    public string? AuthToken { get; set; }

    /// <summary>
    /// Interval in seconds between telemetry heartbeats. Default is 15 seconds.
    /// </summary>
    public int HeartbeatIntervalSeconds { get; set; } = 15;

    /// <summary>
    /// Maximum reconnection delay in seconds. Default is 60 seconds.
    /// </summary>
    public int MaxReconnectDelaySeconds { get; set; } = 60;

    /// <summary>
    /// How long to cache drive/disk information in seconds. Default is 30 seconds.
    /// This reduces I/O overhead since drives rarely change at runtime.
    /// </summary>
    public int TelemetryCacheSeconds { get; set; } = 30;

    /// <summary>
    /// Optional override for the primary network interface name the agent should report
    /// during registration (e.g. "eth0" / "Ethernet").
    /// If null/empty, the agent will attempt to auto-detect a reasonable default.
    /// </summary>
    public string? PrimaryInterfaceName { get; set; }

    /// <summary>
    /// Enable network throughput telemetry (NetRxBytesPerSec/NetTxBytesPerSec).
    /// Default is true.
    /// </summary>
    public bool EnableNetworkTelemetry { get; set; } = true;

    /// <summary>
    /// Enable ping-based connectivity telemetry (PingTarget/PingRttMs/PingPacketLossPercent).
    /// Default is true.
    /// </summary>
    public bool EnablePingTelemetry { get; set; } = true;

    /// <summary>
    /// Enable GPU telemetry (TelemetryData.Gpus).
    /// Default is true.
    /// </summary>
    public bool EnableGpuTelemetry { get; set; } = true;

    /// <summary>
    /// Enable UPS telemetry (TelemetryData.Ups).
    /// Default is true.
    /// </summary>
    public bool EnableUpsTelemetry { get; set; } = true;

    /// <summary>
    /// Enable enhanced network telemetry with per-interface stats, connections, and device discovery.
    /// Default is true.
    /// </summary>
    public bool EnableEnhancedNetworkTelemetry { get; set; } = true;

    /// <summary>
    /// Enable enhanced GPU telemetry with power, clocks, and process-level usage.
    /// Default is true.
    /// </summary>
    public bool EnableEnhancedGpuTelemetry { get; set; } = true;

    /// <summary>
    /// Enable Application Performance Monitoring (APM) telemetry.
    /// Default is false (opt-in).
    /// </summary>
    public bool EnableApmTelemetry { get; set; } = false;

    /// <summary>
    /// List of health check endpoint URLs for APM monitoring.
    /// </summary>
    public List<string> ApmHealthCheckEndpoints { get; set; } = [];

    /// <summary>
    /// List of database endpoints to monitor for APM.
    /// </summary>
    public List<DatabaseEndpointConfig> ApmDatabaseEndpoints { get; set; } = [];

    /// <summary>
    /// Optional ping target override (hostname or IP).
    /// If null/empty, the agent will attempt to use the primary interface's default gateway,
    /// else falls back to 1.1.1.1.
    /// </summary>
    public string? PingTarget { get; set; }

    /// <summary>
    /// Ping timeout in milliseconds.
    /// Default is 800ms.
    /// </summary>
    public int PingTimeoutMs { get; set; } = 800;

    /// <summary>
    /// Rolling window size (number of samples) used to compute packet loss and average RTT.
    /// Default is 10 samples.
    /// </summary>
    public int PingWindowSize { get; set; } = 10;

    /// <summary>
    /// Enable remote log viewer commands (log.read/log.tail).
    /// Default is false (default-deny).
    /// </summary>
    public bool EnableLogViewer { get; set; } = false;

    /// <summary>
    /// Enable remote script execution (script.run).
    /// Default is false (default-deny).
    /// </summary>
    public bool EnableScripts { get; set; } = false;

    /// <summary>
    /// Enable remote terminal commands (terminal.*).
    /// Default is false (default-deny).
    /// </summary>
    public bool EnableTerminal { get; set; } = false;

    /// <summary>
    /// Enable remote file browser commands (file.list/file.read).
    /// Default is false (default-deny).
    /// </summary>
    public bool EnableFileBrowser { get; set; } = false;

    /// <summary>
    /// Hard upper bound for log reads/tails produced by the agent (bytes).
    /// This is a defense-in-depth limit; the server also enforces bounds.
    /// </summary>
    public int LogMaxBytes { get; set; } = 64 * 1024;

    /// <summary>
    /// Minimum seconds between log read/tail operations (rate limit).
    /// </summary>
    public int LogMinSecondsBetweenRequests { get; set; } = 1;

    /// <summary>
    /// Hard upper bound for script output captured/streamed by the agent (bytes).
    /// </summary>
    public int ScriptMaxOutputBytes { get; set; } = 64 * 1024;

    /// <summary>
    /// Maximum script runtime in seconds.
    /// </summary>
    public int ScriptMaxDurationSeconds { get; set; } = 60;

    /// <summary>
    /// Minimum seconds between script runs (rate limit).
    /// </summary>
    public int ScriptMinSecondsBetweenRuns { get; set; } = 1;

    /// <summary>
    /// Hard upper bound for terminal output produced by the agent (bytes).
    /// </summary>
    public int TerminalMaxOutputBytes { get; set; } = 64 * 1024;

    /// <summary>
    /// Maximum terminal session duration in seconds.
    /// </summary>
    public int TerminalMaxDurationSeconds { get; set; } = 10 * 60;

    /// <summary>
    /// Hard upper bound for bytes read by file.read.
    /// This is defense-in-depth; the server also enforces bounds.
    /// </summary>
    public int FileBrowserMaxBytes { get; set; } = 2 * 1024 * 1024;

    /// <summary>
    /// Maximum total uncompressed size for zip archives (bytes).
    /// Default is 1GB.
    /// </summary>
    public long FileZipMaxUncompressedBytes { get; set; } = 1024 * 1024 * 1024;

    /// <summary>
    /// Maximum number of files to include in a zip archive.
    /// Default is 10,000.
    /// </summary>
    public int FileZipMaxFileCount { get; set; } = 10_000;

    /// <summary>
    /// Optional file path where the agent writes its own logs.
    /// If empty, the agent chooses an OS-appropriate default.
    /// </summary>
    public string? AgentLogFilePath { get; set; }

    /// <summary>
    /// Maximum size of the agent self-log file before rotation (bytes).
    /// </summary>
    public int AgentLogFileMaxBytes { get; set; } = 5 * 1024 * 1024;

    /// <summary>
    /// Number of rotated agent self-log files to keep.
    /// </summary>
    public int AgentLogFileRetainedFiles { get; set; } = 3;

    public string GetEffectiveAgentLogFilePath()
    {
        if (!string.IsNullOrWhiteSpace(AgentLogFilePath))
        {
            return AgentLogFilePath.Trim();
        }

        // Default locations chosen to be user-writable and predictable.
        // Windows: %LocalAppData%\ManLab\Logs\manlab-agent.log
        // Linux/macOS: ~/.local/share/ManLab/Logs/manlab-agent.log (via LocalApplicationData)
        var baseDir = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(baseDir))
        {
            // Very defensive fallback (should be rare).
            baseDir = Path.GetTempPath();
        }

        // Use a consistent casing on disk.
        var logDir = Path.Combine(baseDir, "ManLab", "Logs");
        return Path.Combine(logDir, "manlab-agent.log");
    }
}
