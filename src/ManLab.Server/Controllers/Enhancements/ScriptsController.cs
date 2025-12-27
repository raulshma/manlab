using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Data.Enums;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/scripts")]
public sealed class ScriptsController : ControllerBase
{
    private const int MaxNameChars = 255;
    private const int MaxDescriptionChars = 2048;

    private readonly DataContext _db;

    public ScriptsController(DataContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ScriptSummaryDto>>> List()
    {
        var scripts = await _db.Scripts
            .AsNoTracking()
            .OrderBy(s => s.Name)
            .Select(s => new ScriptSummaryDto(
                s.Id,
                s.Name,
                s.Description,
                s.Shell.ToString(),
                s.IsReadOnly,
                s.CreatedAt,
                s.UpdatedAt))
            .ToListAsync();

        return Ok(scripts);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ScriptDto>> Get(Guid id)
    {
        var script = await _db.Scripts
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == id);

        if (script is null)
        {
            return NotFound();
        }

        return Ok(new ScriptDto(
            script.Id,
            script.Name,
            script.Description,
            script.Shell.ToString(),
            script.Content,
            script.IsReadOnly,
            script.CreatedAt,
            script.UpdatedAt));
    }

    [HttpPost]
    public async Task<ActionResult<ScriptDto>> Create([FromBody] UpsertScriptRequest request)
    {
        var name = (request.Name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            return BadRequest("name is required");
        }

        if (name.Length > MaxNameChars)
        {
            return BadRequest($"name too long (max {MaxNameChars})");
        }

        var description = request.Description?.Trim();
        if (description is not null && description.Length > MaxDescriptionChars)
        {
            return BadRequest($"description too long (max {MaxDescriptionChars})");
        }

        if (!Enum.TryParse<ScriptShell>(request.Shell, ignoreCase: true, out var shell))
        {
            return BadRequest("shell must be 'Bash' or 'PowerShell'");
        }

        var content = request.Content ?? string.Empty;
        if (string.IsNullOrWhiteSpace(content))
        {
            return BadRequest("content is required");
        }

        if (content.Length > Script.MaxContentChars)
        {
            return BadRequest($"content too long (max {Script.MaxContentChars})");
        }

        var exists = await _db.Scripts.AnyAsync(s => s.Name == name);
        if (exists)
        {
            return Conflict(new { message = "A script with this name already exists." });
        }

        var now = DateTime.UtcNow;
        var script = new Script
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = description,
            Shell = shell,
            Content = content,
            IsReadOnly = request.IsReadOnly ?? false,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.Scripts.Add(script);
        await _db.SaveChangesAsync();

        return CreatedAtAction(nameof(Get), new { id = script.Id }, new ScriptDto(
            script.Id,
            script.Name,
            script.Description,
            script.Shell.ToString(),
            script.Content,
            script.IsReadOnly,
            script.CreatedAt,
            script.UpdatedAt));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ScriptDto>> Update(Guid id, [FromBody] UpsertScriptRequest request)
    {
        var script = await _db.Scripts.FirstOrDefaultAsync(s => s.Id == id);
        if (script is null)
        {
            return NotFound();
        }

        if (script.IsReadOnly)
        {
            return BadRequest("This script is read-only.");
        }

        if (request.Name is not null)
        {
            var name = request.Name.Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                return BadRequest("name cannot be empty");
            }

            if (name.Length > MaxNameChars)
            {
                return BadRequest($"name too long (max {MaxNameChars})");
            }

            if (!string.Equals(script.Name, name, StringComparison.Ordinal))
            {
                var conflict = await _db.Scripts.AnyAsync(s => s.Name == name && s.Id != script.Id);
                if (conflict)
                {
                    return Conflict(new { message = "A script with this name already exists." });
                }

                script.Name = name;
            }
        }

        if (request.Description is not null)
        {
            var description = request.Description.Trim();
            if (description.Length > MaxDescriptionChars)
            {
                return BadRequest($"description too long (max {MaxDescriptionChars})");
            }

            script.Description = string.IsNullOrWhiteSpace(description) ? null : description;
        }

        if (request.Shell is not null)
        {
            if (!Enum.TryParse<ScriptShell>(request.Shell, ignoreCase: true, out var shell))
            {
                return BadRequest("shell must be 'Bash' or 'PowerShell'");
            }

            script.Shell = shell;
        }

        if (request.Content is not null)
        {
            if (string.IsNullOrWhiteSpace(request.Content))
            {
                return BadRequest("content cannot be empty");
            }

            if (request.Content.Length > Script.MaxContentChars)
            {
                return BadRequest($"content too long (max {Script.MaxContentChars})");
            }

            script.Content = request.Content;
        }

        if (request.IsReadOnly.HasValue)
        {
            script.IsReadOnly = request.IsReadOnly.Value;
        }

        script.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new ScriptDto(
            script.Id,
            script.Name,
            script.Description,
            script.Shell.ToString(),
            script.Content,
            script.IsReadOnly,
            script.CreatedAt,
            script.UpdatedAt));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var script = await _db.Scripts.FirstOrDefaultAsync(s => s.Id == id);
        if (script is null)
        {
            return NotFound();
        }

        if (script.IsReadOnly)
        {
            return BadRequest("This script is read-only.");
        }

        _db.Scripts.Remove(script);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    public sealed record ScriptSummaryDto(
        Guid Id,
        string Name,
        string? Description,
        string Shell,
        bool IsReadOnly,
        DateTime CreatedAt,
        DateTime UpdatedAt);

    public sealed record ScriptDto(
        Guid Id,
        string Name,
        string? Description,
        string Shell,
        string Content,
        bool IsReadOnly,
        DateTime CreatedAt,
        DateTime UpdatedAt);

    public sealed record UpsertScriptRequest(
        string? Name,
        string? Description,
        string? Shell,
        string? Content,
        bool? IsReadOnly);
}
