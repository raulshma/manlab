namespace ManLab.Shared.Dtos;

/// <summary>
/// Status update for a command execution.
/// </summary>
public class CommandStatusUpdate
{
    /// <summary>The command ID being updated.</summary>
    public Guid CommandId { get; set; }

    /// <summary>New status of the command (InProgress, Success, Failed).</summary>
    public string Status { get; set; } = string.Empty;

    /// <summary>Output/logs from command execution.</summary>
    public string? Logs { get; set; }
}
