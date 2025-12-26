namespace ManLab.Server.Data.Enums;

/// <summary>
/// Represents the execution status of a command in the queue.
/// </summary>
public enum CommandStatus
{
    /// <summary>Command is waiting to be sent to the agent.</summary>
    Queued,
    
    /// <summary>Command has been sent to the agent.</summary>
    Sent,
    
    /// <summary>Command is currently being executed by the agent.</summary>
    InProgress,
    
    /// <summary>Command completed successfully.</summary>
    Success,
    
    /// <summary>Command execution failed.</summary>
    Failed
}
