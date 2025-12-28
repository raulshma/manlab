namespace ManLab.Server.Data.Enums;

/// <summary>
/// Represents the current status of an agent node.
/// </summary>
public enum NodeStatus
{
    /// <summary>Node is connected and actively reporting.</summary>
    Online,
    
    /// <summary>Node has not reported recently and is considered offline.</summary>
    Offline,
    
    /// <summary>Node is in maintenance mode.</summary>
    Maintenance,
    
    /// <summary>Node has encountered a non-transient error requiring admin attention.</summary>
    Error
}
