using ManLab.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed partial class BinariesController : ControllerBase
{
    private static readonly Regex AllowedRidRegex = AllowedRidRegexFactory();

    private readonly IWebHostEnvironment _env;
    private readonly ILogger<BinariesController> _logger;
    private readonly IOptions<BinaryDistributionOptions> _options;
    private readonly ISettingsService _settingsService;

    public BinariesController(
        IWebHostEnvironment env,
        ILogger<BinariesController> logger,
        IOptions<BinaryDistributionOptions> options,
        ISettingsService settingsService)
    {
        _env = env;
        _logger = logger;
        _options = options;
        _settingsService = settingsService;
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
    public async Task<IActionResult> DownloadAgentAppSettings([FromRoute] string rid, [FromQuery] string? channel = null)
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

        // Merge system settings (Agent defaults) into the staged template.
        // This keeps the distribution folder as a baseline while letting the dashboard control
        // feature toggles like EnableTerminal for new installs.
        JsonNode? root;
        try
        {
            var raw = await System.IO.File.ReadAllTextAsync(filePath, Encoding.UTF8);
            root = JsonNode.Parse(raw);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse staged agent appsettings.json at {Path}", filePath);
            // Fall back to serving the raw file if parsing fails.
            return PhysicalFile(
                filePath,
                contentType: "application/json",
                fileDownloadName: "appsettings.json",
                enableRangeProcessing: true);
        }

        if (root is not JsonObject rootObj)
        {
            // Unexpected shape; fall back to raw file.
            return PhysicalFile(
                filePath,
                contentType: "application/json",
                fileDownloadName: "appsettings.json",
                enableRangeProcessing: true);
        }

        var agent = rootObj["Agent"] as JsonObject ?? new JsonObject();
        rootObj["Agent"] = agent;

        // Always prefer the currently-served origin as the default ServerUrl.
        // Installers may still overwrite this, but it makes manual downloads safer.
        agent["ServerUrl"] = $"{Request.Scheme}://{Request.Host}/hubs/agent";

        await ApplyAgentDefaultsFromSystemSettingsAsync(agent);

        var json = rootObj.ToJsonString(new JsonSerializerOptions
        {
            WriteIndented = true
        });

        return Content(json, "application/json", Encoding.UTF8);
    }

    private async Task ApplyAgentDefaultsFromSystemSettingsAsync(JsonObject agent)
    {
        // Use existing template values as the fallback defaults.
        // This makes the endpoint resilient if new keys are added to the template.
        static int GetInt(JsonObject obj, string name, int fallback)
            => obj[name]?.GetValue<int?>() ?? fallback;

        static bool GetBool(JsonObject obj, string name, bool fallback)
            => obj[name]?.GetValue<bool?>() ?? fallback;

        static string? GetString(JsonObject obj, string name, string? fallback)
            => obj[name]?.GetValue<string?>() ?? fallback;

        static JsonNode? GetJsonNode(JsonObject obj, string name)
            => obj[name];

        static JsonNode? TryParseJson(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return null;
            }

            try
            {
                return JsonNode.Parse(raw);
            }
            catch
            {
                return null;
            }
        }

        // Connection
        agent["HeartbeatIntervalSeconds"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.HeartbeatIntervalSeconds, GetInt(agent, "HeartbeatIntervalSeconds", 15));
        agent["MaxReconnectDelaySeconds"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.MaxReconnectDelaySeconds, GetInt(agent, "MaxReconnectDelaySeconds", 60));

        // Telemetry
        agent["TelemetryCacheSeconds"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.TelemetryCacheSeconds, GetInt(agent, "TelemetryCacheSeconds", 30));
        agent["PrimaryInterfaceName"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.PrimaryInterfaceName, GetString(agent, "PrimaryInterfaceName", string.Empty) ?? string.Empty);
        agent["EnableNetworkTelemetry"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableNetworkTelemetry, GetBool(agent, "EnableNetworkTelemetry", true));
        agent["EnablePingTelemetry"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnablePingTelemetry, GetBool(agent, "EnablePingTelemetry", true));
        agent["EnableGpuTelemetry"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableGpuTelemetry, GetBool(agent, "EnableGpuTelemetry", true));
        agent["EnableUpsTelemetry"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableUpsTelemetry, GetBool(agent, "EnableUpsTelemetry", true));

        // Enhanced telemetry + APM
        agent["EnableEnhancedNetworkTelemetry"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableEnhancedNetworkTelemetry, GetBool(agent, "EnableEnhancedNetworkTelemetry", true));
        agent["EnableEnhancedGpuTelemetry"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableEnhancedGpuTelemetry, GetBool(agent, "EnableEnhancedGpuTelemetry", true));
        agent["EnableApmTelemetry"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableApmTelemetry, GetBool(agent, "EnableApmTelemetry", false));

        // Endpoints are JSON arrays stored as strings in SystemSettings.
        // Keep template defaults if setting is missing/invalid.
        var apmHealthRaw = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.ApmHealthCheckEndpoints);
        var apmHealthNode = TryParseJson(apmHealthRaw);
        if (apmHealthNode is JsonArray)
        {
            agent["ApmHealthCheckEndpoints"] = apmHealthNode;
        }
        else
        {
            agent["ApmHealthCheckEndpoints"] = GetJsonNode(agent, "ApmHealthCheckEndpoints") ?? new JsonArray();
        }

        var apmDbRaw = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.ApmDatabaseEndpoints);
        var apmDbNode = TryParseJson(apmDbRaw);
        if (apmDbNode is JsonArray)
        {
            agent["ApmDatabaseEndpoints"] = apmDbNode;
        }
        else
        {
            agent["ApmDatabaseEndpoints"] = GetJsonNode(agent, "ApmDatabaseEndpoints") ?? new JsonArray();
        }

        // Remote tools (security-sensitive)
        agent["EnableLogViewer"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableLogViewer, GetBool(agent, "EnableLogViewer", false));
        agent["EnableScripts"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableScripts, GetBool(agent, "EnableScripts", false));
        agent["EnableTerminal"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableTerminal, GetBool(agent, "EnableTerminal", false));
        agent["EnableFileBrowser"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.EnableFileBrowser, GetBool(agent, "EnableFileBrowser", false));

        // Ping
        agent["PingTarget"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.PingTarget, GetString(agent, "PingTarget", string.Empty) ?? string.Empty);
        agent["PingTimeoutMs"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.PingTimeoutMs, GetInt(agent, "PingTimeoutMs", 800));
        agent["PingWindowSize"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.PingWindowSize, GetInt(agent, "PingWindowSize", 10));

        // Rate limits + bounds
        agent["LogMaxBytes"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.LogMaxBytes, GetInt(agent, "LogMaxBytes", 64 * 1024));
        agent["LogMinSecondsBetweenRequests"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.LogMinSecondsBetweenRequests, GetInt(agent, "LogMinSecondsBetweenRequests", 1));
        agent["ScriptMaxOutputBytes"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.ScriptMaxOutputBytes, GetInt(agent, "ScriptMaxOutputBytes", 64 * 1024));
        agent["ScriptMaxDurationSeconds"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.ScriptMaxDurationSeconds, GetInt(agent, "ScriptMaxDurationSeconds", 60));
        agent["ScriptMinSecondsBetweenRuns"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.ScriptMinSecondsBetweenRuns, GetInt(agent, "ScriptMinSecondsBetweenRuns", 1));
        agent["TerminalMaxOutputBytes"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.TerminalMaxOutputBytes, GetInt(agent, "TerminalMaxOutputBytes", 64 * 1024));
        agent["TerminalMaxDurationSeconds"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.TerminalMaxDurationSeconds, GetInt(agent, "TerminalMaxDurationSeconds", 10 * 60));
        agent["FileBrowserMaxBytes"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.FileBrowserMaxBytes, GetInt(agent, "FileBrowserMaxBytes", 2 * 1024 * 1024));

        // Agent self-logging
        agent["AgentLogFilePath"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.AgentLogFilePath, GetString(agent, "AgentLogFilePath", string.Empty) ?? string.Empty);
        agent["AgentLogFileMaxBytes"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.AgentLogFileMaxBytes, GetInt(agent, "AgentLogFileMaxBytes", 5 * 1024 * 1024));
        agent["AgentLogFileRetainedFiles"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.AgentLogFileRetainedFiles, GetInt(agent, "AgentLogFileRetainedFiles", 3));
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

    /// <summary>
    /// Information about GitHub release downloads for agent binaries.
    /// </summary>
    /// <param name="Enabled">Whether GitHub release downloads are enabled.</param>
    /// <param name="ReleaseBaseUrl">Base URL for GitHub releases (e.g., https://github.com/owner/repo/releases/download).</param>
    /// <param name="LatestVersion">Latest release version tag (e.g., v1.0.0).</param>
    /// <param name="DownloadUrls">Pre-constructed download URLs for each RID.</param>
    public sealed record GitHubReleaseInfo(
        bool Enabled,
        string? ReleaseBaseUrl,
        string? LatestVersion,
        IReadOnlyDictionary<string, GitHubReleaseDownloadUrl>? DownloadUrls);

    /// <summary>
    /// Download URLs for a specific RID.
    /// </summary>
    /// <param name="Rid">Runtime identifier (e.g., win-x64, linux-arm64).</param>
    /// <param name="ArchiveUrl">URL to the compressed archive (.zip for Windows, .tar.gz for Linux/macOS).</param>
    /// <param name="BinaryUrl">URL to download (same as ArchiveUrl since GitHub releases only have archives).</param>
    /// <param name="BinaryName">Name of the binary file inside the archive (e.g., manlab-agent.exe or manlab-agent).</param>
    public sealed record GitHubReleaseDownloadUrl(
        string Rid,
        string ArchiveUrl,
        string BinaryUrl,
        string BinaryName);

    /// <summary>
    /// Returns GitHub release information for agent downloads.
    /// Install scripts can use this to download from GitHub releases instead of the server API.
    /// </summary>
    [HttpGet("agent/github-release-info")]
    public async Task<ActionResult<GitHubReleaseInfo>> GetGitHubReleaseInfo()
    {
        var enabled = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.EnableGitHubDownload, false);
        var baseUrl = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.ReleaseBaseUrl);
        var version = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.LatestVersion);

        if (!enabled || string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(version))
        {
            return Ok(new GitHubReleaseInfo(
                Enabled: false,
                ReleaseBaseUrl: null,
                LatestVersion: null,
                DownloadUrls: null));
        }

        // Construct download URLs for each supported RID
        var rids = new[] { "win-x64", "win-arm64", "linux-x64", "linux-arm64", "osx-x64", "osx-arm64" };
        var downloadUrls = new Dictionary<string, GitHubReleaseDownloadUrl>();

        foreach (var rid in rids)
        {
            var isWindows = rid.StartsWith("win-", StringComparison.OrdinalIgnoreCase);
            var archiveExt = isWindows ? ".zip" : ".tar.gz";
            var binaryName = isWindows ? "manlab-agent.exe" : "manlab-agent";

            var archiveUrl = $"{baseUrl.TrimEnd('/')}/{version}/manlab-agent-{rid}{archiveExt}";
            // GitHub releases only contain archives, so binaryUrl points to the same archive.
            // Install scripts should download the archive and extract the binary.
            downloadUrls[rid] = new GitHubReleaseDownloadUrl(rid, archiveUrl, archiveUrl, binaryName);
        }

        return Ok(new GitHubReleaseInfo(
            Enabled: true,
            ReleaseBaseUrl: baseUrl,
            LatestVersion: version,
            DownloadUrls: downloadUrls));
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9\\-]*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AllowedRidRegexFactory();
}
