using ManLab.Server.Data.Enums;
using ManLab.Shared.Dtos;

namespace ManLab.Server.Services.Commands;

/// <summary>
/// Maps between the server's persisted <see cref="CommandType"/> enum and the canonical string command types
/// used over the wire (API → Hub → Agent).
///
/// We keep the DB enum stable for migrations and querying, while making the external API consistent
/// with the agent dispatcher.
/// </summary>
public static class CommandTypeMapper
{
    /// <summary>
    /// Attempts to parse an external command type string.
    ///
    /// Supports both canonical strings (e.g. "docker.restart") and legacy enum names (e.g. "DockerRestart").
    /// </summary>
    public static bool TryParseExternal(string? externalType, out CommandType commandType)
    {
        commandType = default;

        var raw = (externalType ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        // Canonical wire names (preferred)
        var canonical = raw.ToLowerInvariant();
        switch (canonical)
        {
            case CommandTypes.SystemUpdate:
                commandType = CommandType.Update;
                return true;
            case CommandTypes.DockerRestart:
                commandType = CommandType.DockerRestart;
                return true;
            case CommandTypes.DockerList:
                commandType = CommandType.DockerList;
                return true;
            case CommandTypes.DockerStart:
                commandType = CommandType.DockerStart;
                return true;
            case CommandTypes.DockerStop:
                commandType = CommandType.DockerStop;
                return true;
            case CommandTypes.DockerInspect:
                commandType = CommandType.DockerInspect;
                return true;
            case CommandTypes.DockerLogs:
                commandType = CommandType.DockerLogs;
                return true;
            case CommandTypes.DockerStats:
                commandType = CommandType.DockerStats;
                return true;
            case CommandTypes.DockerExec:
                commandType = CommandType.DockerExec;
                return true;
            case CommandTypes.DockerRemove:
                commandType = CommandType.DockerRemove;
                return true;
            case CommandTypes.ComposeList:
                commandType = CommandType.ComposeList;
                return true;
            case CommandTypes.ComposeUp:
                commandType = CommandType.ComposeUp;
                return true;
            case CommandTypes.ComposeDown:
                commandType = CommandType.ComposeDown;
                return true;
            case CommandTypes.AgentShutdown:
                commandType = CommandType.Shutdown;
                return true;
            case CommandTypes.AgentEnableTask:
                commandType = CommandType.EnableTask;
                return true;
            case CommandTypes.AgentDisableTask:
                commandType = CommandType.DisableTask;
                return true;
            case CommandTypes.AgentUninstall:
                commandType = CommandType.Uninstall;
                return true;
            case CommandTypes.ShellExec:
                commandType = CommandType.Shell;
                return true;

            // Enhancements
            case CommandTypes.ServiceStatus:
                commandType = CommandType.ServiceStatus;
                return true;
            case CommandTypes.ServiceRestart:
                commandType = CommandType.ServiceRestart;
                return true;
            case CommandTypes.SmartScan:
                commandType = CommandType.SmartScan;
                return true;
            case CommandTypes.ScriptRun:
                commandType = CommandType.ScriptRun;
                return true;
            case CommandTypes.LogRead:
                commandType = CommandType.LogRead;
                return true;
            case CommandTypes.LogTail:
                commandType = CommandType.LogTail;
                return true;
            case CommandTypes.TerminalOpen:
                commandType = CommandType.TerminalOpen;
                return true;
            case CommandTypes.TerminalClose:
                commandType = CommandType.TerminalClose;
                return true;
            case CommandTypes.TerminalInput:
                commandType = CommandType.TerminalInput;
                return true;
            case CommandTypes.CommandCancel:
                commandType = CommandType.CommandCancel;
                return true;
            case CommandTypes.ConfigUpdate:
                commandType = CommandType.ConfigUpdate;
                return true;

            case CommandTypes.FileList:
                commandType = CommandType.FileList;
                return true;
            case CommandTypes.FileRead:
                commandType = CommandType.FileRead;
                return true;
        }

        // Legacy: enum names coming from older dashboards/clients.
        return Enum.TryParse(raw, ignoreCase: true, out commandType);
    }

    /// <summary>
    /// Converts a persisted enum value to the canonical external string.
    /// </summary>
    public static string ToExternal(CommandType type) => type switch
    {
        CommandType.Update => CommandTypes.SystemUpdate,
        CommandType.DockerRestart => CommandTypes.DockerRestart,
        CommandType.DockerList => CommandTypes.DockerList,
        CommandType.DockerStart => CommandTypes.DockerStart,
        CommandType.DockerStop => CommandTypes.DockerStop,
        CommandType.DockerInspect => CommandTypes.DockerInspect,
        CommandType.DockerLogs => CommandTypes.DockerLogs,
        CommandType.DockerStats => CommandTypes.DockerStats,
        CommandType.DockerExec => CommandTypes.DockerExec,
        CommandType.DockerRemove => CommandTypes.DockerRemove,
        CommandType.ComposeList => CommandTypes.ComposeList,
        CommandType.ComposeUp => CommandTypes.ComposeUp,
        CommandType.ComposeDown => CommandTypes.ComposeDown,
        CommandType.Shutdown => CommandTypes.AgentShutdown,
        CommandType.EnableTask => CommandTypes.AgentEnableTask,
        CommandType.DisableTask => CommandTypes.AgentDisableTask,
        CommandType.Uninstall => CommandTypes.AgentUninstall,
        CommandType.Shell => CommandTypes.ShellExec,
        CommandType.ServiceStatus => CommandTypes.ServiceStatus,
        CommandType.ServiceRestart => CommandTypes.ServiceRestart,
        CommandType.SmartScan => CommandTypes.SmartScan,
        CommandType.ScriptRun => CommandTypes.ScriptRun,
        CommandType.LogRead => CommandTypes.LogRead,
        CommandType.LogTail => CommandTypes.LogTail,
        CommandType.TerminalOpen => CommandTypes.TerminalOpen,
        CommandType.TerminalClose => CommandTypes.TerminalClose,
        CommandType.TerminalInput => CommandTypes.TerminalInput,
        CommandType.CommandCancel => CommandTypes.CommandCancel,
        CommandType.ConfigUpdate => CommandTypes.ConfigUpdate,
        CommandType.FileList => CommandTypes.FileList,
        CommandType.FileRead => CommandTypes.FileRead,
        _ => type.ToString()
    };
}
