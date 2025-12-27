using ManLab.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Security.Cryptography;
using System.Text;
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
    public ActionResult<IEnumerable<string>> ListAgentRids([FromQuery] string? channel = null)
    {
        var agentRoot = ResolveAgentRootForRead(channel);
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
    /// Returns a manifest describing the currently staged agent binaries for a channel.
    /// Expected layout: {DistributionRoot}/agent/{channel}/{rid}/manlab-agent[.exe]
    /// </summary>
    [HttpGet("agent/manifest")]
    public ActionResult<AgentManifestResponse> GetAgentManifest([FromQuery] string? channel = null)
    {
        var resolvedChannel = ResolveChannel(channel);
        var agentRoot = ResolveAgentRootForRead(resolvedChannel);
        if (!Directory.Exists(agentRoot))
        {
            return Ok(new AgentManifestResponse(
                Channel: resolvedChannel,
                GeneratedAtUtc: DateTime.UtcNow,
                Rids: Array.Empty<AgentRidManifestItem>()));
        }

        var ridDirs = Directory.GetDirectories(agentRoot)
            .Select(Path.GetFileName)
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => n!)
            .Where(IsRidSafe)
            .OrderBy(n => n)
            .ToArray();

        var items = new List<AgentRidManifestItem>(ridDirs.Length);
        foreach (var rid in ridDirs)
        {
            var fileName = GetAgentBinaryFileName(rid);
            var binaryPath = Path.Combine(agentRoot, rid, fileName);
            if (!System.IO.File.Exists(binaryPath))
            {
                // Skip incomplete staging.
                continue;
            }

            var binaryInfo = new FileInfo(binaryPath);
            var binarySha256 = ComputeSha256Hex(binaryPath);

            var appSettingsPath = Path.Combine(agentRoot, rid, "appsettings.json");
            bool hasAppSettings = System.IO.File.Exists(appSettingsPath);
            long? appSettingsSize = null;
            string? appSettingsSha256 = null;
            if (hasAppSettings)
            {
                var appInfo = new FileInfo(appSettingsPath);
                appSettingsSize = appInfo.Length;
                appSettingsSha256 = ComputeSha256Hex(appSettingsPath);
            }

            items.Add(new AgentRidManifestItem(
                Rid: rid,
                BinaryFileName: fileName,
                BinarySizeBytes: binaryInfo.Length,
                BinaryLastWriteTimeUtc: binaryInfo.LastWriteTimeUtc,
                BinarySha256: binarySha256,
                HasAppSettings: hasAppSettings,
                AppSettingsSizeBytes: appSettingsSize,
                AppSettingsSha256: appSettingsSha256));
        }

        return Ok(new AgentManifestResponse(
            Channel: resolvedChannel,
            GeneratedAtUtc: DateTime.UtcNow,
            Rids: items));
    }

    /// <summary>
    /// Downloads the staged ManLab.Agent native binary for a runtime identifier.
    /// Expected layout: {DistributionRoot}/agent/{channel}/{rid}/manlab-agent[.exe]
    /// </summary>
    [HttpGet("agent/{rid}")]
    public IActionResult DownloadAgentBinary([FromRoute] string rid, [FromQuery] string? channel = null)
    {
        if (!IsRidSafe(rid))
        {
            return BadRequest("Invalid rid.");
        }

        var resolvedChannel = ResolveChannel(channel);
        var fileName = GetAgentBinaryFileName(rid);
        var filePath = ResolveAgentFilePath(resolvedChannel, rid, fileName);

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
    /// Expected layout: {DistributionRoot}/agent/{channel}/{rid}/appsettings.json
    /// </summary>
    [HttpGet("agent/{rid}/appsettings.json")]
    public IActionResult DownloadAgentAppSettings([FromRoute] string rid, [FromQuery] string? channel = null)
    {
        if (!IsRidSafe(rid))
        {
            return BadRequest("Invalid rid.");
        }

        var resolvedChannel = ResolveChannel(channel);
        var filePath = ResolveAgentFilePath(resolvedChannel, rid, "appsettings.json");
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

    private string GetAgentRootBase() => Path.Combine(GetDistributionRoot(), "agent");

    private string ResolveChannel(string? channel)
    {
        var ch = (channel ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(ch))
        {
            ch = (_options.Value.DefaultChannel ?? string.Empty).Trim();
        }

        return string.IsNullOrWhiteSpace(ch) ? "stable" : ch;
    }

    private string ResolveAgentRootForRead(string? channel)
    {
        var baseRoot = GetAgentRootBase();
        var resolvedChannel = ResolveChannel(channel);
        var channelRoot = Path.Combine(baseRoot, resolvedChannel);

        if (Directory.Exists(channelRoot))
        {
            return channelRoot;
        }

        // Legacy fallback: {DistributionRoot}/agent/{rid}/...
        if (_options.Value.EnableLegacyFallback && Directory.Exists(baseRoot))
        {
            return baseRoot;
        }

        return channelRoot;
    }

    private string ResolveAgentFilePath(string channel, string rid, string fileName)
    {
        var baseRoot = GetAgentRootBase();
        var channelRoot = Path.Combine(baseRoot, channel);
        var candidate = Path.Combine(channelRoot, rid, fileName);
        if (System.IO.File.Exists(candidate))
        {
            return candidate;
        }

        if (_options.Value.EnableLegacyFallback)
        {
            var legacy = Path.Combine(baseRoot, rid, fileName);
            return legacy;
        }

        return candidate;
    }

    private static bool IsRidSafe(string rid)
        => !string.IsNullOrWhiteSpace(rid) && AllowedRidRegex.IsMatch(rid);

    private static string GetAgentBinaryFileName(string rid)
        => rid.StartsWith("win-", StringComparison.OrdinalIgnoreCase)
            ? "manlab-agent.exe"
            : "manlab-agent";

    private static string ComputeSha256Hex(string filePath)
    {
        using var sha = SHA256.Create();
        using var stream = System.IO.File.OpenRead(filePath);
        var hash = sha.ComputeHash(stream);
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash)
        {
            sb.AppendFormat("{0:x2}", b);
        }
        return sb.ToString();
    }

    public sealed record AgentManifestResponse(
        string Channel,
        DateTime GeneratedAtUtc,
        IReadOnlyList<AgentRidManifestItem> Rids);

    public sealed record AgentRidManifestItem(
        string Rid,
        string BinaryFileName,
        long BinarySizeBytes,
        DateTime BinaryLastWriteTimeUtc,
        string BinarySha256,
        bool HasAppSettings,
        long? AppSettingsSizeBytes,
        string? AppSettingsSha256);

    [GeneratedRegex("^[a-z0-9][a-z0-9\\-]*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AllowedRidRegexFactory();
}
