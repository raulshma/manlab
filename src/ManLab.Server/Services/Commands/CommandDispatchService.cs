using ManLab.Server.Data;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Agents;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services.Commands;

/// <summary>
/// Background worker that dispatches queued commands to connected agents.
/// </summary>
public sealed class CommandDispatchService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(2);
    private const int BatchSize = 25;

    private readonly ILogger<CommandDispatchService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<AgentHub> _hubContext;
    private readonly AgentConnectionRegistry _registry;

    public CommandDispatchService(
        ILogger<CommandDispatchService> logger,
        IServiceScopeFactory scopeFactory,
        IHubContext<AgentHub> hubContext,
        AgentConnectionRegistry registry)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _hubContext = hubContext;
        _registry = registry;
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

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await DispatchQueuedCommandsAsync(stoppingToken);
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
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("CommandDispatchService stopped");
    }

    private async Task DispatchQueuedCommandsAsync(CancellationToken cancellationToken)
    {
        // Early exit if no agents are connected - avoids unnecessary database queries
        if (!_registry.HasConnections())
        {
            return;
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Pull a small batch of queued commands.
        var queued = await db.CommandQueue
            .Include(c => c.Node)
            .Where(c => c.Status == CommandStatus.Queued)
            .OrderBy(c => c.CreatedAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        if (queued.Count == 0)
        {
            return;
        }

        foreach (var cmd in queued)
        {
            // Only dispatch to online nodes.
            if (cmd.Node.Status != NodeStatus.Online)
            {
                continue;
            }

            if (!_registry.TryGet(cmd.NodeId, out var connectionId))
            {
                continue;
            }

            var (agentType, payload, supported) = MapToAgentCommand(cmd.CommandType, cmd.Payload);
            if (!supported)
            {
                cmd.Status = CommandStatus.Failed;
                cmd.ExecutedAt = DateTime.UtcNow;
                cmd.OutputLog = AppendLog(cmd.OutputLog,
                    $"Server cannot dispatch command type '{cmd.CommandType}'. (Not supported yet)");

                await db.SaveChangesAsync(cancellationToken);

                await _hubContext.Clients.All.SendAsync(
                    "CommandUpdated",
                    cmd.NodeId,
                    cmd.Id,
                    cmd.Status.ToString(),
                    cancellationToken);

                continue;
            }

            // Mark as in progress before sending to the agent.
            cmd.Status = CommandStatus.InProgress;
            cmd.OutputLog = AppendLog(cmd.OutputLog, $"Dispatched to agent at {DateTime.UtcNow:o} (connectionId={connectionId}).");
            await db.SaveChangesAsync(cancellationToken);

            await _hubContext.Clients.Client(connectionId)
                .SendAsync("ExecuteCommand", cmd.Id, agentType, payload, cancellationToken);

            await _hubContext.Clients.All.SendAsync(
                "CommandUpdated",
                cmd.NodeId,
                cmd.Id,
                cmd.Status.ToString(),
                cancellationToken);
        }
    }

    private static (string agentType, string payload, bool supported) MapToAgentCommand(CommandType type, string? payload)
    {
        // Agent currently supports string-based command types.
        // We keep the REST/DB enum stable and translate here.
        return type switch
        {
            CommandType.Update => ("system.update", payload ?? string.Empty, true),
            CommandType.DockerRestart => ("docker.restart", payload ?? string.Empty, true),
            CommandType.DockerList => ("docker.list", payload ?? string.Empty, true),
            CommandType.Shutdown => ("agent.shutdown", payload ?? string.Empty, true),
            CommandType.EnableTask => ("agent.enabletask", payload ?? string.Empty, true),
            CommandType.DisableTask => ("agent.disabletask", payload ?? string.Empty, true),
            CommandType.Uninstall => ("agent.uninstall", payload ?? string.Empty, true),
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
