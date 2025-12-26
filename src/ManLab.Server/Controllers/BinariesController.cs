using ManLab.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Text.RegularExpressions;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed partial class BinariesController : ControllerBase
{
    private static readonly Regex AllowedRidRegex = AllowedRidRegexFactory();

    private readonly IWebHostEnvironment _env;
    private readonly ILogger<BinariesController> _logger;
    private readonly IOptions<BinaryDistributionOptions> _options;

    public BinariesController(
        IWebHostEnvironment env,
        ILogger<BinariesController> logger,
        IOptions<BinaryDistributionOptions> options)
    {
        _env = env;
        _logger = logger;
        _options = options;
    }

    [HttpGet("agent")]
    public ActionResult<IEnumerable<string>> ListAgentRids()
    {
        var agentRoot = GetAgentRoot();
        if (!Directory.Exists(agentRoot))
        {
            return Ok(Array.Empty<string>());
        }

        var rids = Directory.GetDirectories(agentRoot)
            .Select(Path.GetFileName)
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => n!)
            .OrderBy(n => n)
            .ToArray();

        return Ok(rids);
    }

    /// <summary>
    /// Downloads the staged ManLab.Agent native binary for a runtime identifier.
    /// Expected layout: {DistributionRoot}/agent/{rid}/manlab-agent[.exe]
    /// </summary>
    [HttpGet("agent/{rid}")]
    public IActionResult DownloadAgentBinary([FromRoute] string rid)
    {
        if (!IsRidSafe(rid))
        {
            return BadRequest("Invalid rid.");
        }

        var fileName = GetAgentBinaryFileName(rid);
        var filePath = Path.Combine(GetAgentRoot(), rid, fileName);

        if (!System.IO.File.Exists(filePath))
        {
            _logger.LogWarning("Agent binary not found for rid {Rid} at {Path}", rid, filePath);
            return NotFound();
        }

        return PhysicalFile(
            filePath,
            contentType: "application/octet-stream",
            fileDownloadName: fileName,
            enableRangeProcessing: true);
    }

    /// <summary>
    /// Downloads a staged appsettings.json for a runtime identifier.
    /// Expected layout: {DistributionRoot}/agent/{rid}/appsettings.json
    /// </summary>
    [HttpGet("agent/{rid}/appsettings.json")]
    public IActionResult DownloadAgentAppSettings([FromRoute] string rid)
    {
        if (!IsRidSafe(rid))
        {
            return BadRequest("Invalid rid.");
        }

        var filePath = Path.Combine(GetAgentRoot(), rid, "appsettings.json");
        if (!System.IO.File.Exists(filePath))
        {
            return NotFound();
        }

        // JSON content type helps browsers/tools handle it nicely.
        return PhysicalFile(
            filePath,
            contentType: "application/json",
            fileDownloadName: "appsettings.json",
            enableRangeProcessing: true);
    }

    private string GetDistributionRoot()
    {
        var configured = _options.Value.RootPath;
        var root = string.IsNullOrWhiteSpace(configured)
            ? Path.Combine(_env.ContentRootPath, "Distribution")
            : configured;

        // Normalize to a full path.
        if (!Path.IsPathRooted(root))
        {
            root = Path.Combine(_env.ContentRootPath, root);
        }

        return Path.GetFullPath(root);
    }

    private string GetAgentRoot() => Path.Combine(GetDistributionRoot(), "agent");

    private static bool IsRidSafe(string rid)
        => !string.IsNullOrWhiteSpace(rid) && AllowedRidRegex.IsMatch(rid);

    private static string GetAgentBinaryFileName(string rid)
        => rid.StartsWith("win-", StringComparison.OrdinalIgnoreCase)
            ? "manlab-agent.exe"
            : "manlab-agent";

    [GeneratedRegex("^[a-z0-9][a-z0-9\\-]*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AllowedRidRegexFactory();
}
