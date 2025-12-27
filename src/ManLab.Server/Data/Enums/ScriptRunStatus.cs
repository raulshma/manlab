namespace ManLab.Server.Data.Enums;

/// <summary>
/// Represents the execution status of a script run.
/// </summary>
public enum ScriptRunStatus
{
    Queued,
    Sent,
    InProgress,
    Success,
    Failed,
    Cancelled
}
