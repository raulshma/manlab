using ManLab.Server.Services;
using Microsoft.AspNetCore.Authorization;
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
[AllowAnonymous]
public sealed partial class BinariesController : ControllerBase
{
    private static readonly Regex AllowedRidRegex = AllowedRidRegexFactory();

    private readonly IWebHostEnvironment _env;
    private readonly ILogger<BinariesController> _logger;
    private readonly IOptions<BinaryDistributionOptions> _options;
    private readonly ISettingsService _settingsService;
    private readonly IHttpClientFactory _httpClientFactory;

    public BinariesController(
        IWebHostEnvironment env,
        ILogger<BinariesController> logger,
        IOptions<BinaryDistributionOptions> options,
        ISettingsService settingsService,
        IHttpClientFactory httpClientFactory)
    {
        _env = env;
        _logger = logger;
        _options = options;
        _settingsService = settingsService;
        _httpClientFactory = httpClientFactory;
    }

    /// <summary>
    /// Returns a combined catalog of locally staged/versioned agent builds and available GitHub release tags.
    /// </summary>
    /// <remarks>
    /// - Local versions are inferred from the distribution folder structure.
    ///   Supported layouts:
    ///     1) {DistributionRoot}/agent/{channel}/{rid}/...            (treated as version "staged")
    ///     2) {DistributionRoot}/agent/{channel}/{version}/{rid}/...  (versioned folders)
    /// - GitHub release tags are returned when GitHub download settings are configured.
    /// </remarks>
    [HttpGet("agent/release-catalog")]
    public async Task<ActionResult<AgentReleaseCatalogResponse>> GetAgentReleaseCatalog([FromQuery] string? channel = null)
    {
        var resolvedChannel = ResolveChannel(channel);

        // Local releases
        var local = GetLocalAgentReleases(resolvedChannel);

        // GitHub releases (best-effort)
        var githubEnabled = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.EnableGitHubDownload, false);
        var githubBaseUrl = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.ReleaseBaseUrl);
        var githubLatest = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.LatestVersion);

        IReadOnlyList<AgentGitHubReleaseItem> githubReleases = Array.Empty<AgentGitHubReleaseItem>();
        string? githubRepo = null;
        string? githubError = null;

        if (githubEnabled && TryParseGitHubRepoFromReleaseBaseUrl(githubBaseUrl, out var repo))
        {
            githubRepo = repo;
            try
            {
                githubReleases = await FetchGitHubReleasesAsync(repo, max: 50);
            }
            catch (Exception ex)
            {
                // Best-effort: do not fail the request if GitHub API is unavailable.
                githubError = ex.Message;
            }
        }

        return Ok(new AgentReleaseCatalogResponse(
            Channel: resolvedChannel,
            Local: local,
            GitHub: new AgentGitHubReleaseCatalog(
                Enabled: githubEnabled,
                ReleaseBaseUrl: string.IsNullOrWhiteSpace(githubBaseUrl) ? null : githubBaseUrl,
                ConfiguredLatestVersion: string.IsNullOrWhiteSpace(githubLatest) ? null : githubLatest,
                Repo: githubRepo,
                Releases: githubReleases,
                Error: githubError)));
    }

    private IReadOnlyList<AgentLocalReleaseItem> GetLocalAgentReleases(string channel)
    {
        // NOTE: this is file-system based and intended for "local" distribution staging.
        // It is safe because we only enumerate under DistributionRoot and apply simple name filtering.
        var baseRoot = GetAgentRootBase();
        var channelRoot = Path.Combine(baseRoot, channel);

        var releases = new List<AgentLocalReleaseItem>();

        // Layout 1 (legacy / default): {baseRoot}/{rid}
        // Layout 1b (channel): {baseRoot}/{channel}/{rid}
        // We treat these as a single implicit version "staged".
        var stagedRoot = ResolveAgentRootForRead(channel);
        if (Directory.Exists(stagedRoot))
        {
            var stagedRids = Directory.GetDirectories(stagedRoot)
                .Select(Path.GetFileName)
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Select(n => n!)
                .Where(IsRidSafe)
                .OrderBy(n => n)
                .ToArray();

            if (stagedRids.Length > 0)
            {
                var lastWrite = GetMaxBinaryLastWriteTimeUtc(stagedRoot, stagedRids);
                releases.Add(new AgentLocalReleaseItem(
                    Version: "staged",
                    Rids: stagedRids,
                    BinaryLastWriteTimeUtc: lastWrite));
            }
        }

        // Layout 2: {baseRoot}/{channel}/{version}/{rid}
        // Only attempt this when the channel directory exists.
        if (Directory.Exists(channelRoot))
        {
            foreach (var versionDir in Directory.GetDirectories(channelRoot))
            {
                var version = Path.GetFileName(versionDir);
                if (string.IsNullOrWhiteSpace(version))
                {
                    continue;
                }

                // Skip if it looks like a RID (that would be layout 1).
                if (IsRidSafe(version))
                {
                    continue;
                }

                // Keep version names bounded; ignore weird paths.
                version = version.Trim();
                if (version.Length > 128)
                {
                    continue;
                }

                var rids = Directory.GetDirectories(versionDir)
                    .Select(Path.GetFileName)
                    .Where(n => !string.IsNullOrWhiteSpace(n))
                    .Select(n => n!)
                    .Where(IsRidSafe)
                    .OrderBy(n => n)
                    .ToArray();

                if (rids.Length == 0)
                {
                    continue;
                }

                var lastWrite = GetMaxBinaryLastWriteTimeUtc(versionDir, rids);
                releases.Add(new AgentLocalReleaseItem(
                    Version: version,
                    Rids: rids,
                    BinaryLastWriteTimeUtc: lastWrite));
            }
        }

        // Ensure deterministic ordering: staged first, then version desc-ish.
        return releases
            .OrderByDescending(r => string.Equals(r.Version, "staged", StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(r => r.BinaryLastWriteTimeUtc ?? DateTime.MinValue)
            .ThenBy(r => r.Version, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static DateTime? GetMaxBinaryLastWriteTimeUtc(string root, IReadOnlyList<string> rids)
    {
        DateTime? max = null;
        foreach (var rid in rids)
        {
            var fileName = GetAgentBinaryFileName(rid);
            var path = Path.Combine(root, rid, fileName);
            if (!System.IO.File.Exists(path))
            {
                continue;
            }

            var info = new FileInfo(path);
            if (max is null || info.LastWriteTimeUtc > max.Value)
            {
                max = info.LastWriteTimeUtc;
            }
        }

        return max;
    }

    private static bool TryParseGitHubRepoFromReleaseBaseUrl(string? baseUrl, out string repo)
    {
        // Expected: https://github.com/{owner}/{repo}/releases/download
        repo = string.Empty;
        if (string.IsNullOrWhiteSpace(baseUrl)) return false;

        if (!Uri.TryCreate(baseUrl.Trim(), UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (!string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var segments = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 4) return false;
        if (!string.Equals(segments[2], "releases", StringComparison.OrdinalIgnoreCase)) return false;
        if (!string.Equals(segments[3], "download", StringComparison.OrdinalIgnoreCase)) return false;

        var owner = segments[0];
        var name = segments[1];
        if (string.IsNullOrWhiteSpace(owner) || string.IsNullOrWhiteSpace(name)) return false;

        repo = $"{owner}/{name}";
        return true;
    }

    private async Task<IReadOnlyList<AgentGitHubReleaseItem>> FetchGitHubReleasesAsync(string repo, int max)
    {
        // GitHub API: https://api.github.com/repos/{owner}/{repo}/releases
        // Requires a User-Agent header.
        var client = _httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("ManLab/1.0");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

        var url = $"https://api.github.com/repos/{repo}/releases?per_page={Math.Clamp(max, 1, 100)}";
        using var response = await client.GetAsync(url);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync();
        var doc = await JsonDocument.ParseAsync(stream);
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AgentGitHubReleaseItem>();
        }

        var list = new List<AgentGitHubReleaseItem>();
        foreach (var el in doc.RootElement.EnumerateArray())
        {
            if (el.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var tag = el.TryGetProperty("tag_name", out var tagEl) && tagEl.ValueKind == JsonValueKind.String
                ? tagEl.GetString()
                : null;
            if (string.IsNullOrWhiteSpace(tag))
            {
                continue;
            }

            var name = el.TryGetProperty("name", out var nameEl) && nameEl.ValueKind == JsonValueKind.String
                ? nameEl.GetString()
                : null;
            var prerelease = el.TryGetProperty("prerelease", out var preEl) && preEl.ValueKind == JsonValueKind.True;
            var draft = el.TryGetProperty("draft", out var draftEl) && draftEl.ValueKind == JsonValueKind.True;
            DateTime? publishedAtUtc = null;
            if (el.TryGetProperty("published_at", out var pubEl) && pubEl.ValueKind == JsonValueKind.String)
            {
                if (DateTime.TryParse(pubEl.GetString(), out var dt))
                {
                    publishedAtUtc = DateTime.SpecifyKind(dt, DateTimeKind.Utc);
                }
            }

            list.Add(new AgentGitHubReleaseItem(
                Tag: tag,
                Name: string.IsNullOrWhiteSpace(name) ? null : name,
                PublishedAtUtc: publishedAtUtc,
                Prerelease: prerelease,
                Draft: draft));
        }

        // Most-recent first (PublishedAt can be null for drafts).
        return list
            .OrderByDescending(r => r.PublishedAtUtc ?? DateTime.MinValue)
            .ThenByDescending(r => r.Tag, StringComparer.OrdinalIgnoreCase)
            .ToArray();
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
    public ActionResult<AgentManifestResponse> GetAgentManifest([FromQuery] string? channel = null, [FromQuery] string? version = null)
    {
        var resolvedChannel = ResolveChannel(channel);
        var agentRoot = ResolveAgentRootForRead(resolvedChannel, version);
        if (!Directory.Exists(agentRoot))
        {
            return Ok(new AgentManifestResponse(
                Channel: resolvedChannel,
                GeneratedAtUtc: DateTime.UtcNow,
                Version: NormalizeVersionOrNull(version),
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
            Version: NormalizeVersionOrNull(version),
            Rids: items));
    }

    /// <summary>
    /// Downloads the staged ManLab.Agent native binary for a runtime identifier.
    /// Expected layout: {DistributionRoot}/agent/{channel}/{rid}/manlab-agent[.exe]
    /// </summary>
    [HttpGet("agent/{rid}")]
    public IActionResult DownloadAgentBinary([FromRoute] string rid, [FromQuery] string? channel = null, [FromQuery] string? version = null)
    {
        if (!IsRidSafe(rid))
        {
            return BadRequest("Invalid rid.");
        }

        var resolvedChannel = ResolveChannel(channel);
        var resolvedVersion = NormalizeVersionOrNull(version);
        var fileName = GetAgentBinaryFileName(rid);
        var filePath = ResolveAgentFilePath(resolvedChannel, resolvedVersion, rid, fileName);

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
    public async Task<IActionResult> DownloadAgentAppSettings([FromRoute] string rid, [FromQuery] string? channel = null, [FromQuery] string? version = null)
    {
        if (!IsRidSafe(rid))
        {
            return BadRequest("Invalid rid.");
        }

        var resolvedChannel = ResolveChannel(channel);
        var resolvedVersion = NormalizeVersionOrNull(version);
        var filePath = ResolveAgentFilePath(resolvedChannel, resolvedVersion, rid, "appsettings.json");
        var hasStagedTemplate = System.IO.File.Exists(filePath);

        // Merge system settings (Agent defaults) into the staged template.
        // This keeps the distribution folder as a baseline while letting the dashboard control
        // feature toggles like EnableTerminal for new installs.
        JsonNode? root;

        if (hasStagedTemplate)
        {
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
        }
        else
        {
            // No staged template is available for this RID (common in dev setups).
            // Instead of returning 404 (which forces installers to fall back to minimal config),
            // generate a safe template on-the-fly so new installs pick up current Agent Defaults.
            root = new JsonObject
            {
                ["Agent"] = new JsonObject
                {
                    // Keep these explicit even though installers typically inject secrets via env vars.
                    ["AuthToken"] = string.Empty,
                    ["HeartbeatIntervalSeconds"] = 15,
                    ["MaxReconnectDelaySeconds"] = 60,
                    ["TelemetryCacheSeconds"] = 30,
                    ["PrimaryInterfaceName"] = string.Empty,
                    ["EnableNetworkTelemetry"] = true,
                    ["EnablePingTelemetry"] = true,
                    ["EnableGpuTelemetry"] = true,
                    ["EnableUpsTelemetry"] = true,
                    ["EnableEnhancedNetworkTelemetry"] = true,
                    ["EnableEnhancedGpuTelemetry"] = true,
                    ["EnableApmTelemetry"] = false,
                    ["ApmHealthCheckEndpoints"] = new JsonArray(),
                    ["ApmDatabaseEndpoints"] = new JsonArray(),
                    ["EnableLogViewer"] = false,
                    ["EnableScripts"] = false,
                    ["EnableTerminal"] = false,
                    ["EnableFileBrowser"] = false,
                    ["PingTarget"] = string.Empty,
                    ["PingTimeoutMs"] = 800,
                    ["PingWindowSize"] = 10,
                    ["LogMaxBytes"] = 64 * 1024,
                    ["LogMinSecondsBetweenRequests"] = 1,
                    ["ScriptMaxOutputBytes"] = 64 * 1024,
                    ["ScriptMaxDurationSeconds"] = 60,
                    ["ScriptMinSecondsBetweenRuns"] = 1,
                    ["TerminalMaxOutputBytes"] = 64 * 1024,
                    ["TerminalMaxDurationSeconds"] = 10 * 60,
                    ["FileBrowserMaxBytes"] = 2 * 1024 * 1024,
                    ["FileZipMaxUncompressedBytes"] = 1024 * 1024 * 1024,
                    ["FileZipMaxFileCount"] = 10_000,
                    ["AgentLogFilePath"] = string.Empty,
                    ["AgentLogFileMaxBytes"] = 5 * 1024 * 1024,
                    ["AgentLogFileRetainedFiles"] = 3
                }
            };
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
        agent["FileZipMaxUncompressedBytes"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.FileZipMaxUncompressedBytes, GetInt(agent, "FileZipMaxUncompressedBytes", 1024 * 1024 * 1024));
        agent["FileZipMaxFileCount"] = await _settingsService.GetValueAsync(Constants.SettingKeys.Agent.FileZipMaxFileCount, GetInt(agent, "FileZipMaxFileCount", 10_000));

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

    private string ResolveAgentRootForRead(string? channel, string? version = null)
    {
        var baseRoot = GetAgentRootBase();
        var resolvedChannel = ResolveChannel(channel);
        var channelRoot = Path.Combine(baseRoot, resolvedChannel);

        var resolvedVersion = NormalizeVersionOrNull(version);
        if (!string.IsNullOrWhiteSpace(resolvedVersion))
        {
            // Versioned layout: {DistributionRoot}/agent/{channel}/{version}/{rid}/...
            var versionRoot = Path.Combine(channelRoot, resolvedVersion);
            if (Directory.Exists(versionRoot))
            {
                return versionRoot;
            }
        }

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

    private string ResolveAgentFilePath(string channel, string? version, string rid, string fileName)
    {
        var baseRoot = GetAgentRootBase();
        var channelRoot = Path.Combine(baseRoot, channel);

        // Versioned layout: {DistributionRoot}/agent/{channel}/{version}/{rid}/...
        if (!string.IsNullOrWhiteSpace(version))
        {
            var versioned = Path.Combine(channelRoot, version, rid, fileName);
            if (System.IO.File.Exists(versioned))
            {
                return versioned;
            }
        }

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

    private static string? NormalizeVersionOrNull(string? version)
    {
        if (string.IsNullOrWhiteSpace(version))
        {
            return null;
        }

        version = version.Trim();
        if (version.Length == 0)
        {
            return null;
        }

        // Treat the implicit staging layout as no explicit version.
        if (string.Equals(version, "staged", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        // Basic hardening: keep the version a single path segment.
        if (version.Contains('/') || version.Contains('\\'))
        {
            return null;
        }

        if (version.Length > 128)
        {
            return null;
        }

        return version;
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
        string? Version,
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

    public sealed record AgentReleaseCatalogResponse(
        string Channel,
        IReadOnlyList<AgentLocalReleaseItem> Local,
        AgentGitHubReleaseCatalog GitHub);

    public sealed record AgentLocalReleaseItem(
        string Version,
        IReadOnlyList<string> Rids,
        DateTime? BinaryLastWriteTimeUtc);

    public sealed record AgentGitHubReleaseCatalog(
        bool Enabled,
        string? ReleaseBaseUrl,
        string? ConfiguredLatestVersion,
        string? Repo,
        IReadOnlyList<AgentGitHubReleaseItem> Releases,
        string? Error);

    public sealed record AgentGitHubReleaseItem(
        string Tag,
        string? Name,
        DateTime? PublishedAtUtc,
        bool Prerelease,
        bool Draft);

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
