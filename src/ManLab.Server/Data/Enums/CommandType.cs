namespace ManLab.Server.Data.Enums;

/// <summary>
/// Represents the type of command that can be sent to an agent.
/// </summary>
public enum CommandType
{
    /// <summary>System update command (apt-get upgrade, etc.).</summary>
    Update,

    /// <summary>Docker container restart command.</summary>
    DockerRestart,

    /// <summary>Generic shell command execution.</summary>
    Shell,

    /// <summary>List Docker containers on the node.</summary>
    DockerList,

    /// <summary>Gracefully shutdown the agent process.</summary>
    Shutdown,

    /// <summary>Enable the agent's scheduled task (start agent).</summary>
    EnableTask,

    /// <summary>Disable the agent's scheduled task (stop agent).</summary>
    DisableTask,

    /// <summary>Uninstall the agent from the machine.</summary>
    Uninstall,

    // --- Enhancements (append-only to preserve persisted numeric values) ---

    /// <summary>Request service status snapshots.</summary>
    ServiceStatus,

    /// <summary>Restart a service.</summary>
    ServiceRestart,

    /// <summary>Request a SMART scan.</summary>
    SmartScan,

    /// <summary>Execute a server-defined script.</summary>
    ScriptRun,

    /// <summary>Read a bounded log file chunk.</summary>
    LogRead,

    /// <summary>Tail a log file stream.</summary>
    LogTail,

    /// <summary>Open a restricted terminal session.</summary>
    TerminalOpen,

    /// <summary>Close a restricted terminal session.</summary>
    TerminalClose,

    /// <summary>Send terminal input.</summary>
    TerminalInput,

    /// <summary>Cancel a running command by ID.</summary>
    CommandCancel,

    /// <summary>Update agent configuration at runtime.</summary>
    ConfigUpdate,

    /// <summary>List a directory (file browser).</summary>
    FileList,

    /// <summary>Read a bounded file (file browser).</summary>
    FileRead,

    /// <summary>Create a zip archive from multiple files/folders (file browser).</summary>
    FileZip,

    // --- Docker management (append-only) ---

    /// <summary>Start a Docker container.</summary>
    DockerStart,

    /// <summary>Stop a Docker container.</summary>
    DockerStop,

    /// <summary>Inspect a Docker container.</summary>
    DockerInspect,

    /// <summary>Read Docker container logs.</summary>
    DockerLogs,

    /// <summary>Read Docker container stats.</summary>
    DockerStats,

    /// <summary>Execute a command in a container.</summary>
    DockerExec,

    /// <summary>Remove a Docker container.</summary>
    DockerRemove,

    /// <summary>List Docker compose stacks.</summary>
    ComposeList,

    /// <summary>Bring up a Docker compose stack.</summary>
    ComposeUp,

    /// <summary>Bring down a Docker compose stack.</summary>
    ComposeDown
}
