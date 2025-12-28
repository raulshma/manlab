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

        CommandCancel,
        ConfigUpdate
    };
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
}
