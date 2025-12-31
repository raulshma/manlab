namespace ManLab.Shared.Dtos;

/// <summary>
/// Constants for command types sent from server to agent.
/// </summary>
public static class CommandTypes
{
    // Docker commands
    public const string DockerList = "docker.list";
    public const string DockerRestart = "docker.restart";
    public const string DockerStop = "docker.stop";
    public const string DockerStart = "docker.start";

    // System commands  
    public const string SystemUpdate = "system.update";
    public const string SystemShutdown = "system.shutdown";
    public const string SystemRestart = "system.restart";

    // Agent lifecycle / management commands
    public const string AgentShutdown = "agent.shutdown";
    public const string AgentEnableTask = "agent.enabletask";
    public const string AgentDisableTask = "agent.disabletask";
    public const string AgentUninstall = "agent.uninstall";

    // Shell command (use with extreme care; payload is validated + bounded)
    public const string ShellExec = "shell.exec";

    // Service monitoring
    public const string ServiceStatus = "service.status";
    public const string ServiceRestart = "service.restart";

    // SMART
    public const string SmartScan = "smart.scan";

    // Remote tools
    public const string ScriptRun = "script.run";
    public const string LogRead = "log.read";
    public const string LogTail = "log.tail";

    // Terminal
    public const string TerminalOpen = "terminal.open";
    public const string TerminalClose = "terminal.close";
    public const string TerminalInput = "terminal.input";

    // File browser (remote tools)
    public const string FileList = "file.list";
    public const string FileRead = "file.read";
    public const string FileZip = "file.zip";
    public const string FileStream = "file.stream";

    // Command lifecycle
    public const string CommandCancel = "command.cancel";

    // Agent configuration
    public const string ConfigUpdate = "config.update";

    /// <summary>
    /// Authoritative set of command type strings used end-to-end (API → DB → Hub → Agent).
    /// </summary>
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        DockerList,
        DockerRestart,
        DockerStop,
        DockerStart,
        SystemUpdate,
        SystemShutdown,
        SystemRestart,
        AgentShutdown,
        AgentEnableTask,
        AgentDisableTask,
        AgentUninstall,
        ShellExec,

        ServiceStatus,
        ServiceRestart,

        SmartScan,

        ScriptRun,
        LogRead,
        LogTail,

        TerminalOpen,
        TerminalClose,
        TerminalInput,

        FileList,
        FileRead,
        FileZip,
        FileStream,

        CommandCancel,
        ConfigUpdate
    };

    /// <summary>
    /// Payload for system.shutdown and system.restart commands.
    /// </summary>
    public record SystemPowerPayload
    {
        /// <summary>
        /// Delay in seconds before shutdown/restart (0 = immediate).
        /// </summary>
        public int DelaySeconds { get; init; } = 0;
    }
}

/// <summary>
/// Payload for file.list command.
/// Virtual paths use forward slashes. Windows drive roots are represented as "/C", "/D", etc.
/// </summary>
public sealed record FileListPayload
{
    /// <summary>The virtual path to list ("/" for roots).</summary>
    public string Path { get; init; } = "/";

    /// <summary>
    /// Optional maximum number of entries to return.
    /// The agent may return fewer entries to keep the response bounded.
    /// </summary>
    public int? MaxEntries { get; init; }
}

/// <summary>
/// Result returned by file.list.
/// </summary>
public sealed record FileListResult
{
    public IReadOnlyList<FileBrowserEntry> Entries { get; init; } = Array.Empty<FileBrowserEntry>();

    /// <summary>
    /// True if the directory contains more entries than returned (bounded for safety/performance).
    /// </summary>
    public bool Truncated { get; init; }
}

/// <summary>
/// Payload for file.read command.
/// The agent returns content as Base64 (bounded by MaxBytes).
/// </summary>
public sealed record FileReadPayload
{
    /// <summary>The virtual file path to read.</summary>
    public string Path { get; init; } = string.Empty;

    /// <summary>Maximum bytes to read from the file (server + agent enforce bounds).</summary>
    public int? MaxBytes { get; init; }

    /// <summary>
    /// Optional byte offset to start reading from. Defaults to 0.
    /// Used for chunked downloads.
    /// </summary>
    public long? Offset { get; init; }
}

/// <summary>
/// A file/directory entry returned by file.list.
/// </summary>
public sealed record FileBrowserEntry
{
    public string Name { get; init; } = string.Empty;
    public bool IsDirectory { get; init; }
    public string Path { get; init; } = string.Empty;
    public string? UpdatedAt { get; init; }
    public long? Size { get; init; }
}

/// <summary>
/// Result returned by file.read.
/// </summary>
public sealed record FileReadResult
{
    public string Path { get; init; } = string.Empty;
    public string ContentBase64 { get; init; } = string.Empty;
    public bool Truncated { get; init; }
    public long BytesRead { get; init; }

    /// <summary>Byte offset for this chunk.</summary>
    public long Offset { get; init; }

    /// <summary>Total file length in bytes (best-effort).</summary>
    public long TotalBytes { get; init; }
}

/// <summary>
/// Payload for Docker container commands.
/// </summary>
public record DockerCommandPayload
{
    /// <summary>
    /// The container ID to operate on.
    /// </summary>
    public string ContainerId { get; init; } = string.Empty;
}

/// <summary>
/// Payload for shell.exec command.
/// </summary>
public record ShellCommandPayload
{
    /// <summary>
    /// The shell command to execute.
    /// </summary>
    public string Command { get; init; } = string.Empty;
}

/// <summary>
/// Container information returned from docker.list command.
/// </summary>
public record ContainerInfo
{
    /// <summary>Short container ID.</summary>
    public string Id { get; init; } = string.Empty;

    /// <summary>Container names.</summary>
    public IList<string> Names { get; init; } = [];

    /// <summary>Image name.</summary>
    public string Image { get; init; } = string.Empty;

    /// <summary>Container state (running, exited, etc.).</summary>
    public string State { get; init; } = string.Empty;

    /// <summary>Human-readable status.</summary>
    public string Status { get; init; } = string.Empty;

    /// <summary>Creation timestamp.</summary>
    public DateTime Created { get; init; }
}

/// <summary>
/// Payload for terminal.open command.
/// </summary>
public record TerminalOpenPayload
{
    /// <summary>
    /// The session ID to associate with this terminal.
    /// </summary>
    public Guid SessionId { get; init; }
}

/// <summary>
/// Payload for terminal.input command.
/// </summary>
public record TerminalInputPayload
{
    /// <summary>
    /// The session ID of the terminal.
    /// </summary>
    public Guid SessionId { get; init; }

    /// <summary>
    /// The input to send to the terminal stdin.
    /// </summary>
    public string Input { get; init; } = string.Empty;
}

/// <summary>
/// Payload for terminal.close command.
/// </summary>
public record TerminalClosePayload
{
    /// <summary>
    /// The session ID of the terminal to close.
    /// </summary>
    public Guid SessionId { get; init; }
}

/// <summary>
/// Payload for command.cancel command.
/// </summary>
public record CancelCommandPayload
{
    /// <summary>
    /// The command ID to cancel.
    /// </summary>
    public Guid TargetCommandId { get; init; }
}

/// <summary>
/// Payload for config.update command.
/// Updates the agent's runtime configuration and persists to appsettings.json.
/// </summary>
public record ConfigUpdatePayload
{
    /// <summary>Interval in seconds between telemetry heartbeats.</summary>
    public int? HeartbeatIntervalSeconds { get; init; }

    /// <summary>Maximum reconnection delay in seconds.</summary>
    public int? MaxReconnectDelaySeconds { get; init; }

    /// <summary>How long to cache drive/disk information in seconds.</summary>
    public int? TelemetryCacheSeconds { get; init; }

    /// <summary>Override for the primary network interface name.</summary>
    public string? PrimaryInterfaceName { get; init; }

    /// <summary>Enable network throughput telemetry.</summary>
    public bool? EnableNetworkTelemetry { get; init; }

    /// <summary>Enable ping-based connectivity telemetry.</summary>
    public bool? EnablePingTelemetry { get; init; }

    /// <summary>Enable GPU telemetry.</summary>
    public bool? EnableGpuTelemetry { get; init; }

    /// <summary>Enable UPS telemetry.</summary>
    public bool? EnableUpsTelemetry { get; init; }

    /// <summary>Enable remote log viewer commands.</summary>
    public bool? EnableLogViewer { get; init; }

    /// <summary>Enable remote script execution.</summary>
    public bool? EnableScripts { get; init; }

    /// <summary>Enable remote terminal commands.</summary>
    public bool? EnableTerminal { get; init; }

    /// <summary>Enable remote file browser commands (file.list/file.read).</summary>
    public bool? EnableFileBrowser { get; init; }

    /// <summary>Ping target override (hostname or IP).</summary>
    public string? PingTarget { get; init; }

    /// <summary>Ping timeout in milliseconds.</summary>
    public int? PingTimeoutMs { get; init; }

    /// <summary>Rolling window size for ping samples.</summary>
    public int? PingWindowSize { get; init; }

    /// <summary>Hard upper bound for log reads (bytes).</summary>
    public int? LogMaxBytes { get; init; }

    /// <summary>Minimum seconds between log operations.</summary>
    public int? LogMinSecondsBetweenRequests { get; init; }

    /// <summary>Hard upper bound for script output (bytes).</summary>
    public int? ScriptMaxOutputBytes { get; init; }

    /// <summary>Maximum script runtime in seconds.</summary>
    public int? ScriptMaxDurationSeconds { get; init; }

    /// <summary>Minimum seconds between script runs.</summary>
    public int? ScriptMinSecondsBetweenRuns { get; init; }

    /// <summary>Hard upper bound for terminal output (bytes).</summary>
    public int? TerminalMaxOutputBytes { get; init; }

    /// <summary>Maximum terminal session duration in seconds.</summary>
    public int? TerminalMaxDurationSeconds { get; init; }

    /// <summary>Hard upper bound for file reads returned by the agent (bytes).</summary>
    public int? FileBrowserMaxBytes { get; init; }
}

/// <summary>
/// Payload for file.zip command.
/// Creates a zip archive from the specified paths.
/// </summary>
public sealed record FileZipPayload
{
    /// <summary>Unique identifier for tracking download progress.</summary>
    public Guid DownloadId { get; init; }

    /// <summary>Virtual paths to include in the zip archive.</summary>
    public string[] Paths { get; init; } = [];

    /// <summary>Maximum total uncompressed size in bytes (default 1GB).</summary>
    public long MaxUncompressedBytes { get; init; } = 1024 * 1024 * 1024;

    /// <summary>Maximum number of files to include (default 10,000).</summary>
    public int MaxFileCount { get; init; } = 10_000;
}

/// <summary>
/// Result returned by file.zip command.
/// </summary>
public sealed record FileZipResult
{
    /// <summary>Path to the temporary zip file on the agent.</summary>
    public string TempFilePath { get; init; } = string.Empty;

    /// <summary>Total size of the zip archive in bytes.</summary>
    public long ArchiveBytes { get; init; }

    /// <summary>Number of files included in the archive.</summary>
    public int FileCount { get; init; }

    /// <summary>Number of directories included in the archive.</summary>
    public int DirectoryCount { get; init; }

    /// <summary>Paths that were skipped due to access errors.</summary>
    public string[] SkippedPaths { get; init; } = [];
}

/// <summary>
/// Payload for file.stream command.
/// Initiates streaming download of a file directly via SignalR (bypasses command queue).
/// </summary>
public sealed record FileStreamPayload
{
    /// <summary>Unique identifier for the download session.</summary>
    public Guid DownloadId { get; init; }

    /// <summary>Path to the file to stream (can be virtual path or direct temp file path).</summary>
    public string Path { get; init; } = string.Empty;

    /// <summary>Chunk size in bytes (default 256KB).</summary>
    public int ChunkSize { get; init; } = 256 * 1024;
}

/// <summary>
/// Progress update for file downloads sent via SignalR.
/// </summary>
public sealed record DownloadProgressUpdate
{
    /// <summary>Unique identifier for the download session.</summary>
    public Guid DownloadId { get; init; }

    /// <summary>Number of bytes transferred so far.</summary>
    public long BytesTransferred { get; init; }

    /// <summary>Total number of bytes to transfer (if known).</summary>
    public long TotalBytes { get; init; }

    /// <summary>Current transfer speed in bytes per second.</summary>
    public double SpeedBytesPerSec { get; init; }

    /// <summary>Estimated seconds remaining (null if unknown).</summary>
    public int? EstimatedSecondsRemaining { get; init; }

    /// <summary>Progress message from agent (e.g., "Compressing: 50% (5/10 files)").</summary>
    public string? Message { get; init; }

    /// <summary>Percentage complete for zip creation (0-100).</summary>
    public int? PercentComplete { get; init; }
}

/// <summary>
/// Status change event for downloads sent via SignalR.
/// </summary>
public sealed record DownloadStatusChangedEvent
{
    /// <summary>Unique identifier for the download session.</summary>
    public Guid DownloadId { get; init; }

    /// <summary>New status of the download.</summary>
    public string Status { get; init; } = string.Empty;

    /// <summary>Error message if the download failed.</summary>
    public string? Error { get; init; }
}
