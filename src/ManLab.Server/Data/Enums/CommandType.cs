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
    Shell
}
