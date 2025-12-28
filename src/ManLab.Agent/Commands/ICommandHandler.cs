namespace ManLab.Agent.Commands;

using System.Text.Json;

/// <summary>
/// Interface for command handlers.
/// </summary>
public interface ICommandHandler
{
    /// <summary>
    /// Gets the command type this handler processes.
    /// </summary>
    string CommandType { get; }

    /// <summary>
    /// Executes the command.
    /// </summary>
    /// <param name="context">Execution context containing command ID, payload, and callbacks.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Result string to send back to the server.</returns>
    Task<string> ExecuteAsync(CommandContext context, CancellationToken cancellationToken);
}

/// <summary>
/// Context passed to command handlers during execution.
/// </summary>
public sealed class CommandContext
{
    public required Guid CommandId { get; init; }
    public JsonElement? PayloadRoot { get; init; }
    public required Func<Guid, string, string?, Task> UpdateStatusCallback { get; init; }
}
