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
    Uninstall
}
