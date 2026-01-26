using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Agents;
using ManLab.Shared.Dtos;
using ManLab.Server.Services.Audit;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Services.Commands;

/// <summary>
/// Background worker that dispatches queued commands to connected agents.
/// </summary>
public sealed class CommandDispatchService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(2);
    // This service is on the hot path for interactive features (terminal/log viewer/file browser).
    // If we back off too far while idle, synchronous endpoints that poll for completion can time out
    // before the dispatcher wakes up. Keep the worst-case wake-up latency low.
    private static readonly TimeSpan IdleMaxInterval = TimeSpan.FromSeconds(5);
    private const int BatchSize = 25;

    private const int MaxDispatchAttempts = 5;
    private static readonly TimeSpan SentTimeout = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan MaxQueueAge = TimeSpan.FromHours(24);

    private readonly ILogger<CommandDispatchService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<AgentHub> _hubContext;
    private readonly AgentConnectionRegistry _registry;
    private readonly IAuditLog _audit;

    public CommandDispatchService(
        ILogger<CommandDispatchService> logger,
        IServiceScopeFactory scopeFactory,
        IHubContext<AgentHub> hubContext,
        AgentConnectionRegistry registry,
        IAuditLog audit)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _hubContext = hubContext;
        _registry = registry;
        _audit = audit;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("CommandDispatchService started. Interval={IntervalSeconds}s BatchSize={BatchSize}",
            Interval.TotalSeconds,
            BatchSize);

        // Small initial delay so the host can fully start up.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        var currentInterval = Interval;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var dispatchedAny = await DispatchQueuedCommandsAsync(stoppingToken);

                // Adaptive backoff:
                // - If we dispatched something, stay responsive.
                // - If nothing was dispatched (or no connections), back off to reduce DB polling.
                currentInterval = dispatchedAny
                    ? Interval
                    : TimeSpan.FromSeconds(Math.Min(IdleMaxInterval.TotalSeconds, Math.Max(Interval.TotalSeconds, currentInterval.TotalSeconds * 2)));
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Command dispatch loop failed");
            }

            try
            {
                await Task.Delay(currentInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("CommandDispatchService stopped");
    }

    private async Task<bool> DispatchQueuedCommandsAsync(CancellationToken cancellationToken)
    {
        // Early exit if no agents are connected - avoids unnecessary database queries
        if (!_registry.HasConnections())
        {
            return false;
        }

        var connectedNodeIds = _registry.GetConnectedNodeIdsSnapshot();
        if (connectedNodeIds.Length == 0)
        {
            return false;
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        // 1) Re-queue (or fail) commands that were Sent but never transitioned to InProgress.
        //    This can happen if the connection drops right after sending.
        var now = DateTime.UtcNow;
        var stuckSent = await db.CommandQueue
            .Where(c => c.Status == CommandStatus.Sent)
            .Where(c => c.SentAt != null && c.SentAt < now - SentTimeout)
            .OrderBy(c => c.SentAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        foreach (var cmd in stuckSent)
        {
            if (cmd.DispatchAttempts >= MaxDispatchAttempts)
            {
                cmd.Status = CommandStatus.Failed;
                cmd.ExecutedAt = now;
                if (ShouldAppendOperationalLogs(cmd.CommandType))
                {
                    cmd.OutputLog = AppendLog(cmd.OutputLog, $"Dispatch failed: exceeded max attempts ({MaxDispatchAttempts}).");
                }
                _audit.TryEnqueue(new AuditEvent
                {
                    Kind = "audit",
                    EventName = "command.dispatch.failed",
                    Category = "commands",
                    Source = "system",
                    ActorType = "system",
                    ActorName = nameof(CommandDispatchService),
                    NodeId = cmd.NodeId,
                    CommandId = cmd.Id,
                    Success = false,
                    Message = "Dispatch exceeded max attempts",
                    DataJson = JsonSerializer.Serialize(new { attempts = cmd.DispatchAttempts })
                });
            }
            else
            {
                cmd.Status = CommandStatus.Queued;
                if (ShouldAppendOperationalLogs(cmd.CommandType))
                {
                    cmd.OutputLog = AppendLog(cmd.OutputLog, $"Re-queued after Sent timeout ({SentTimeout.TotalSeconds:0}s).");
                }
            }
        }

        if (stuckSent.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        // 2) Fail commands that have been queued too long (agent offline / never connected).
        var tooOldQueued = await db.CommandQueue
            .Where(c => c.Status == CommandStatus.Queued)
            .Where(c => c.CreatedAt < now - MaxQueueAge)
            .OrderBy(c => c.CreatedAt)
            .Take(10)
            .ToListAsync(cancellationToken);

        foreach (var cmd in tooOldQueued)
        {
            cmd.Status = CommandStatus.Failed;
            cmd.ExecutedAt = now;
                        _audit.TryEnqueue(new AuditEvent
                        {
                            Kind = "audit",
                            EventName = "command.dispatch.failed",
                            Category = "commands",
                            Source = "system",
                            ActorType = "system",
                            ActorName = nameof(CommandDispatchService),
                            NodeId = cmd.NodeId,
                            CommandId = cmd.Id,
                            Success = false,
                            Message = "Command expired in queue",
                            DataJson = JsonSerializer.Serialize(new { maxQueueAgeHours = MaxQueueAge.TotalHours })
                        });
            if (ShouldAppendOperationalLogs(cmd.CommandType))
            {
                cmd.OutputLog = AppendLog(cmd.OutputLog, $"Dispatch failed: command expired in queue after {MaxQueueAge.TotalHours:0}h.");
            }

            if (cmd.CommandType == CommandType.ScriptRun)
            {
                await TryMarkScriptRunAsync(db, cmd, ScriptRunStatus.Failed, startedAt: null, finishedAt: now, cancellationToken).ConfigureAwait(false);
            }
        }

        if (tooOldQueued.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        // Pull a small batch of queued commands for currently connected nodes.
        // This avoids scanning/returning commands for offline nodes and avoids an eager JOIN.
        var queued = await db.CommandQueue
            .Where(c => c.Status == CommandStatus.Queued && connectedNodeIds.Contains(c.NodeId))
            .OrderBy(c => c.CreatedAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        if (queued.Count == 0)
        {
            return false;
        }

        var dispatchedAny = false;

        foreach (var cmd in queued)
        {
            if (!_registry.TryGet(cmd.NodeId, out var connectionId))
            {
                continue;
            }

            var (agentType, payload, supported) = MapToAgentCommand(cmd.CommandType, cmd.Payload);
            if (!supported)
            {
                cmd.Status = CommandStatus.Failed;
                cmd.ExecutedAt = DateTime.UtcNow;
                                _audit.TryEnqueue(new AuditEvent
                                {
                                    Kind = "audit",
                                    EventName = "command.dispatch.unsupported",
                                    Category = "commands",
                                    Source = "system",
                                    ActorType = "system",
                                    ActorName = nameof(CommandDispatchService),
                                    NodeId = cmd.NodeId,
                                    CommandId = cmd.Id,
                                    Success = false,
                                    Message = "Server cannot dispatch command type",
                                    DataJson = JsonSerializer.Serialize(new { commandType = cmd.CommandType.ToString() })
                                });
                cmd.OutputLog = AppendLog(cmd.OutputLog,
                    $"Server cannot dispatch command type '{cmd.CommandType}'. (Not supported yet)");

                if (cmd.CommandType == CommandType.ScriptRun)
                {
                    await TryMarkScriptRunAsync(db, cmd, ScriptRunStatus.Failed, startedAt: null, finishedAt: DateTime.UtcNow, cancellationToken).ConfigureAwait(false);
                }

                await db.SaveChangesAsync(cancellationToken);

                await _hubContext.Clients.All.SendAsync(
                    "CommandUpdated",
                    cmd.NodeId,
                    cmd.Id,
                    cmd.Status.ToString(),
                    cancellationToken);

                continue;
            }

            // Mark as Sent before sending to the agent.
            // The agent will transition it to InProgress via UpdateCommandStatus once it begins execution.
            cmd.DispatchAttempts += 1;
            cmd.LastDispatchAttemptAt = now;
            cmd.Status = CommandStatus.Sent;
            cmd.SentAt = now;
            if (ShouldAppendOperationalLogs(cmd.CommandType))
            {
                cmd.OutputLog = AppendLog(cmd.OutputLog, $"Sent to agent at {now:o} (attempt={cmd.DispatchAttempts}, connectionId={connectionId}).");
            }

            if (cmd.CommandType == CommandType.ScriptRun)
            {
                await TryMarkScriptRunAsync(db, cmd, ScriptRunStatus.Sent, startedAt: null, finishedAt: null, cancellationToken).ConfigureAwait(false);
            }
            await db.SaveChangesAsync(cancellationToken);

            _audit.TryEnqueue(new AuditEvent
            {
                Kind = "activity",
                EventName = "command.dispatched",
                Category = "commands",
                Source = "system",
                ActorType = "system",
                ActorName = nameof(CommandDispatchService),
                NodeId = cmd.NodeId,
                CommandId = cmd.Id,
                Success = true,
                Message = "Command sent to agent",
                // Avoid storing payload or connectionId (sensitive); keep minimal.
                DataJson = JsonSerializer.Serialize(new { commandType = cmd.CommandType.ToString(), attempt = cmd.DispatchAttempts })
            });

            dispatchedAny = true;

            await _hubContext.Clients.Client(connectionId)
                .SendAsync("ExecuteCommand", cmd.Id, agentType, payload, cancellationToken);

            await _hubContext.Clients.All.SendAsync(
                "CommandUpdated",
                cmd.NodeId,
                cmd.Id,
                cmd.Status.ToString(),
                cancellationToken);
        }

        return dispatchedAny;
    }

    private static async Task TryMarkScriptRunAsync(
        DataContext db,
        CommandQueueItem cmd,
        ScriptRunStatus status,
        DateTime? startedAt,
        DateTime? finishedAt,
        CancellationToken cancellationToken)
    {
        var runId = TryExtractGuidFromPayload(cmd.Payload, "runId");
        if (runId == Guid.Empty)
        {
            return;
        }

        var run = await db.ScriptRuns.FirstOrDefaultAsync(r => r.Id == runId, cancellationToken).ConfigureAwait(false);
        if (run is null)
        {
            return;
        }

        if (run.NodeId != cmd.NodeId)
        {
            return;
        }

        run.Status = status;
        if (startedAt is not null)
        {
            run.StartedAt ??= startedAt;
        }

        if (finishedAt is not null)
        {
            run.FinishedAt ??= finishedAt;
        }
    }

    private static Guid TryExtractGuidFromPayload(string? payloadJson, string propertyName)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return Guid.Empty;
        }

        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return Guid.Empty;
            }

            if (!root.TryGetProperty(propertyName, out var el))
            {
                return Guid.Empty;
            }

            if (el.ValueKind == JsonValueKind.String && Guid.TryParse(el.GetString(), out var g))
            {
                return g;
            }
        }
        catch
        {
            // ignore
        }

        return Guid.Empty;
    }

    private static bool ShouldAppendOperationalLogs(CommandType type)
    {
        // For log viewer commands, OutputLog is used to carry the file content/chunks.
        // Avoid polluting it with server operational notes.
        // For file browser commands, OutputLog carries JSON that must remain parseable.
        return type is not (
            CommandType.LogRead
            or CommandType.LogTail
            or CommandType.FileList
            or CommandType.FileRead
            or CommandType.DockerList
            or CommandType.DockerInspect
            or CommandType.DockerLogs
            or CommandType.DockerStats
            or CommandType.ComposeList);
    }

    private static (string agentType, string payload, bool supported) MapToAgentCommand(CommandType type, string? payload)
    {
        // Agent currently supports string-based command types.
        // We keep the REST/DB enum stable and translate here.
        return type switch
        {
            CommandType.Update => (CommandTypes.SystemUpdate, payload ?? string.Empty, true),
            CommandType.DockerRestart => (CommandTypes.DockerRestart, payload ?? string.Empty, true),
            CommandType.DockerList => (CommandTypes.DockerList, payload ?? string.Empty, true),
            CommandType.DockerStart => (CommandTypes.DockerStart, payload ?? string.Empty, true),
            CommandType.DockerStop => (CommandTypes.DockerStop, payload ?? string.Empty, true),
            CommandType.DockerInspect => (CommandTypes.DockerInspect, payload ?? string.Empty, true),
            CommandType.DockerLogs => (CommandTypes.DockerLogs, payload ?? string.Empty, true),
            CommandType.DockerStats => (CommandTypes.DockerStats, payload ?? string.Empty, true),
            CommandType.DockerExec => (CommandTypes.DockerExec, payload ?? string.Empty, true),
            CommandType.DockerRemove => (CommandTypes.DockerRemove, payload ?? string.Empty, true),
            CommandType.ComposeList => (CommandTypes.ComposeList, payload ?? string.Empty, true),
            CommandType.ComposeUp => (CommandTypes.ComposeUp, payload ?? string.Empty, true),
            CommandType.ComposeDown => (CommandTypes.ComposeDown, payload ?? string.Empty, true),
            CommandType.Shutdown => (CommandTypes.AgentShutdown, payload ?? string.Empty, true),
            CommandType.EnableTask => (CommandTypes.AgentEnableTask, payload ?? string.Empty, true),
            CommandType.DisableTask => (CommandTypes.AgentDisableTask, payload ?? string.Empty, true),
            CommandType.Uninstall => (CommandTypes.AgentUninstall, payload ?? string.Empty, true),
            CommandType.Shell => (CommandTypes.ShellExec, payload ?? string.Empty, true),
            CommandType.ServiceStatus => (CommandTypes.ServiceStatus, payload ?? string.Empty, true),
            CommandType.ServiceRestart => (CommandTypes.ServiceRestart, payload ?? string.Empty, true),
            CommandType.SmartScan => (CommandTypes.SmartScan, payload ?? string.Empty, true),
            CommandType.ScriptRun => (CommandTypes.ScriptRun, payload ?? string.Empty, true),
            CommandType.LogRead => (CommandTypes.LogRead, payload ?? string.Empty, true),
            CommandType.LogTail => (CommandTypes.LogTail, payload ?? string.Empty, true),
            CommandType.TerminalOpen => (CommandTypes.TerminalOpen, payload ?? string.Empty, true),
            CommandType.TerminalClose => (CommandTypes.TerminalClose, payload ?? string.Empty, true),
            CommandType.TerminalInput => (CommandTypes.TerminalInput, payload ?? string.Empty, true),
            CommandType.CommandCancel => (CommandTypes.CommandCancel, payload ?? string.Empty, true),
            CommandType.ConfigUpdate => (CommandTypes.ConfigUpdate, payload ?? string.Empty, true),

            CommandType.FileList => (CommandTypes.FileList, payload ?? string.Empty, true),
            CommandType.FileRead => (CommandTypes.FileRead, payload ?? string.Empty, true),
            _ => (type.ToString(), payload ?? string.Empty, false)
        };
    }

    private static string AppendLog(string? existing, string line)
    {
        if (string.IsNullOrWhiteSpace(existing))
        {
            return line;
        }

        return existing + "\n" + line;
    }
}
