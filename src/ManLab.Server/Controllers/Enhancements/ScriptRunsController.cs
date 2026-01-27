using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Enhancements;
using ManLab.Shared.Dtos;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Controllers;

/// <summary>
/// Script run management endpoints.
/// Server-side authorization checks are performed before dispatching script.run commands.
/// </summary>
[ApiController]
[Route("api/devices/{nodeId:guid}/script-runs")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.ScriptsView)]
public sealed class ScriptRunsController : ControllerBase
{
    private readonly DataContext _db;
    private readonly RemoteToolsAuthorizationService _authorization;
    private readonly ILogger<ScriptRunsController> _logger;

    public ScriptRunsController(
        DataContext db,
        RemoteToolsAuthorizationService authorization,
        ILogger<ScriptRunsController> logger)
    {
        _db = db;
        _authorization = authorization;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ScriptRunDto>>> List(Guid nodeId, [FromQuery] int count = 50)
    {
        if (count <= 0) count = 50;
        count = Math.Min(count, 200);

        var nodeExists = await _db.Nodes.AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound();
        }

        var runs = await _db.ScriptRuns
            .AsNoTracking()
            .Where(r => r.NodeId == nodeId)
            .OrderByDescending(r => r.CreatedAt)
            .Take(count)
            .Select(r => new ScriptRunDto(
                r.Id,
                r.NodeId,
                r.ScriptId,
                r.RequestedBy,
                r.Status.ToString(),
                r.CreatedAt,
                r.StartedAt,
                r.FinishedAt,
                r.StdoutTail,
                r.StderrTail))
            .ToListAsync();

        return Ok(runs);
    }

    [HttpPost]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.ScriptsRun)]
    public async Task<ActionResult<CreateScriptRunResponse>> Create(Guid nodeId, [FromBody] CreateScriptRunRequest request)
    {
        var nodeExists = await _db.Nodes.AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound();
        }

        // Authorization check: verify script execution is enabled on this node
        var (allowed, error) = await _authorization.AuthorizeScriptsAsync(nodeId);
        if (!allowed)
        {
            return BadRequest(error);
        }

        if (request.ScriptId == Guid.Empty)
        {
            return BadRequest("scriptId is required");
        }

        var script = await _db.Scripts.AsNoTracking().FirstOrDefaultAsync(s => s.Id == request.ScriptId);
        if (script is null)
        {
            return BadRequest("Script not found");
        }

        if (script.IsReadOnly)
        {
            return BadRequest("This script is read-only and cannot be executed.");
        }

        var now = DateTime.UtcNow;
        var run = new ScriptRun
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            ScriptId = script.Id,
            RequestedBy = User?.Identity?.Name,
            Status = ScriptRunStatus.Queued,
            CreatedAt = now
        };

        // Command payload contains IDs only. Agent can fetch script content (future) or server can embed.
        var payloadJson = JsonSerializer.Serialize(new
        {
            scriptId = script.Id,
            runId = run.Id
        });

        var command = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            CommandType = CommandType.ScriptRun,
            Payload = payloadJson,
            Status = CommandStatus.Queued,
            CreatedAt = now
        };

        _db.ScriptRuns.Add(run);
        _db.CommandQueue.Add(command);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Queued script.run command {CommandId} for node {NodeId} script {ScriptId} run {RunId}", command.Id, nodeId, script.Id, run.Id);

        return Accepted(new CreateScriptRunResponse(
            RunId: run.Id,
            CommandId: command.Id));
    }

    [HttpGet("/api/script-runs/{runId:guid}")]
    public async Task<ActionResult<ScriptRunDto>> GetById(Guid runId)
    {
        var run = await _db.ScriptRuns
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == runId);

        if (run is null)
        {
            return NotFound();
        }

        return Ok(new ScriptRunDto(
            run.Id,
            run.NodeId,
            run.ScriptId,
            run.RequestedBy,
            run.Status.ToString(),
            run.CreatedAt,
            run.StartedAt,
            run.FinishedAt,
            run.StdoutTail,
            run.StderrTail));
    }

    /// <summary>
    /// Cancels a running script by queuing a command.cancel to the agent.
    /// </summary>
    [HttpPost("/api/script-runs/{runId:guid}/cancel")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.ScriptsRun)]
    public async Task<ActionResult<CancelScriptRunResponse>> Cancel(Guid runId)
    {
        var run = await _db.ScriptRuns
            .Include(r => r.Node)
            .FirstOrDefaultAsync(r => r.Id == runId);

        if (run is null)
        {
            return NotFound();
        }

        // Only running scripts can be cancelled
        if (run.Status != ScriptRunStatus.InProgress && run.Status != ScriptRunStatus.Sent && run.Status != ScriptRunStatus.Queued)
        {
            return BadRequest("Script is not running.");
        }

        // Find the original script.run command
        var originalCommand = await _db.CommandQueue
            .Where(c => c.NodeId == run.NodeId)
            .Where(c => c.CommandType == CommandType.ScriptRun)
            .Where(c => c.Payload != null && c.Payload.Contains(runId.ToString()))
            .FirstOrDefaultAsync();

        if (originalCommand is null)
        {
            // Mark as cancelled even without command
            run.Status = ScriptRunStatus.Cancelled;
            run.FinishedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return Ok(new CancelScriptRunResponse(null, "Script marked as cancelled."));
        }

        // Queue cancel command to agent
        var cancelPayloadJson = JsonSerializer.Serialize(new
        {
            targetCommandId = originalCommand.Id
        });

        var cancelCommand = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = run.NodeId,
            CommandType = CommandType.CommandCancel,
            Payload = cancelPayloadJson,
            Status = CommandStatus.Queued,
            CreatedAt = DateTime.UtcNow
        };

        _db.CommandQueue.Add(cancelCommand);

        // Mark run as cancelled
        run.Status = ScriptRunStatus.Cancelled;
        run.FinishedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Queued command.cancel {CancelCommandId} for script run {RunId} (original command {OriginalCommandId})",
            cancelCommand.Id, runId, originalCommand.Id);

        return Ok(new CancelScriptRunResponse(cancelCommand.Id, "Cancellation requested."));
    }

    public sealed record CreateScriptRunRequest(Guid ScriptId);

    public sealed record CreateScriptRunResponse(Guid RunId, Guid CommandId);

    public sealed record CancelScriptRunResponse(Guid? CommandId, string Message);

    public sealed record ScriptRunDto(
        Guid Id,
        Guid NodeId,
        Guid ScriptId,
        string? RequestedBy,
        string Status,
        DateTime CreatedAt,
        DateTime? StartedAt,
        DateTime? FinishedAt,
        string? StdoutTail,
        string? StderrTail);
}
