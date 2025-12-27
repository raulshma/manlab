using System.Globalization;
using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Best-effort UPS telemetry collector.
///
/// Strategies:
/// - NUT: upsc (preferred when available)
/// - apcupsd: apcaccess
///
/// All fields are optional; failures must not break the heartbeat.
/// </summary>
internal sealed class UpsTelemetryCollector
{
    private const int DefaultTimeoutMs = 1500;

    private readonly ILogger _logger;
    private readonly AgentConfiguration _config;

    private DateTime _lastSampleAtUtc;
    private UpsTelemetry? _cached;

    public UpsTelemetryCollector(ILogger logger, AgentConfiguration config)
    {
        _logger = logger;
        _config = config;
    }

    public UpsTelemetry? Collect()
    {
        if (!_config.EnableUpsTelemetry)
        {
            return null;
        }

        var cacheSeconds = Math.Max(1, _config.TelemetryCacheSeconds);
        if (_lastSampleAtUtc != default && (DateTime.UtcNow - _lastSampleAtUtc).TotalSeconds < cacheSeconds)
        {
            return _cached;
        }

        try
        {
            if (TryCollectUpsc(out var nut))
            {
                _cached = nut;
                _lastSampleAtUtc = DateTime.UtcNow;
                return _cached;
            }

            if (TryCollectApcaccess(out var apc))
            {
                _cached = apc;
                _lastSampleAtUtc = DateTime.UtcNow;
                return _cached;
            }

            _cached = null;
            _lastSampleAtUtc = DateTime.UtcNow;
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "UPS telemetry collection failed");
            _cached = null;
            _lastSampleAtUtc = DateTime.UtcNow;
            return null;
        }
    }

    private static bool TryCollectUpsc(out UpsTelemetry telemetry)
    {
        telemetry = null!;

        if (!ExternalToolRunner.TryRun("upsc", "-l", DefaultTimeoutMs, out var listOut, out _))
        {
            return false;
        }

        var device = ParseFirstUpscDeviceList(listOut);
        if (string.IsNullOrWhiteSpace(device))
        {
            return false;
        }

        if (!ExternalToolRunner.TryRun("upsc", device, DefaultTimeoutMs, out var statusOut, out _))
        {
            return false;
        }

        telemetry = ParseUpscOutput(statusOut) ?? new UpsTelemetry { Backend = "nut" };
        telemetry.Backend = "nut";
        return true;
    }

    private static bool TryCollectApcaccess(out UpsTelemetry telemetry)
    {
        telemetry = null!;

        if (!ExternalToolRunner.TryRun("apcaccess", "status", DefaultTimeoutMs, out var stdout, out _))
        {
            return false;
        }

        var parsed = ParseApcaccessStatus(stdout);
        if (parsed is null)
        {
            return false;
        }

        parsed.Backend = "apcupsd";
        telemetry = parsed;
        return true;
    }

    public static string? ParseFirstUpscDeviceList(string? stdout)
    {
        if (string.IsNullOrWhiteSpace(stdout))
        {
            return null;
        }

        foreach (var line in stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!string.IsNullOrWhiteSpace(line))
            {
                return line.Trim();
            }
        }

        return null;
    }

    public static UpsTelemetry? ParseUpscOutput(string? stdout)
    {
        if (string.IsNullOrWhiteSpace(stdout))
        {
            return null;
        }

        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = line.IndexOf(':');
            if (idx <= 0)
            {
                continue;
            }

            var key = line[..idx].Trim();
            var value = line[(idx + 1)..].Trim();
            if (key.Length == 0)
            {
                continue;
            }

            dict[key] = value;
        }

        var t = new UpsTelemetry { Backend = "nut" };

        if (TryGetFloat(dict, "battery.charge", out var batt))
        {
            t.BatteryPercent = batt;
        }

        if (TryGetFloat(dict, "ups.load", out var load))
        {
            t.LoadPercent = load;
        }

        if (dict.TryGetValue("ups.status", out var status))
        {
            // Typical: "OL" (online), "OB" (on battery). Can be composite.
            if (status.Contains("OB", StringComparison.OrdinalIgnoreCase))
            {
                t.OnBattery = true;
            }
            else if (status.Contains("OL", StringComparison.OrdinalIgnoreCase))
            {
                t.OnBattery = false;
            }
        }

        if (TryGetInt(dict, "battery.runtime", out var runtimeSeconds))
        {
            t.EstimatedRuntimeSeconds = runtimeSeconds;
        }
        else if (TryGetInt(dict, "ups.runtime", out var upsRuntimeSeconds))
        {
            t.EstimatedRuntimeSeconds = upsRuntimeSeconds;
        }

        // If no useful fields were parsed, treat as absent.
        if (t.BatteryPercent is null && t.LoadPercent is null && t.OnBattery is null && t.EstimatedRuntimeSeconds is null)
        {
            return null;
        }

        return t;
    }

    public static UpsTelemetry? ParseApcaccessStatus(string? stdout)
    {
        if (string.IsNullOrWhiteSpace(stdout))
        {
            return null;
        }

        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var line in stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = line.IndexOf(':');
            if (idx <= 0)
            {
                continue;
            }

            var key = line[..idx].Trim();
            var value = line[(idx + 1)..].Trim();
            if (key.Length == 0)
            {
                continue;
            }

            dict[key] = value;
        }

        var t = new UpsTelemetry { Backend = "apcupsd" };

        if (TryGetFloat(dict, "BCHARGE", out var batt))
        {
            t.BatteryPercent = batt;
        }

        if (TryGetFloat(dict, "LOADPCT", out var load))
        {
            t.LoadPercent = load;
        }

        if (dict.TryGetValue("STATUS", out var status))
        {
            if (status.Contains("ONBATT", StringComparison.OrdinalIgnoreCase))
            {
                t.OnBattery = true;
            }
            else if (status.Contains("ONLINE", StringComparison.OrdinalIgnoreCase))
            {
                t.OnBattery = false;
            }
        }

        // TIMELEFT is usually "X.Y Minutes"
        if (dict.TryGetValue("TIMELEFT", out var timeLeftRaw))
        {
            // keep just the numeric prefix
            var numeric = timeLeftRaw.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
            if (float.TryParse(numeric, NumberStyles.Float, CultureInfo.InvariantCulture, out var minutes))
            {
                t.EstimatedRuntimeSeconds = (int)Math.Round(minutes * 60f);
            }
        }

        if (t.BatteryPercent is null && t.LoadPercent is null && t.OnBattery is null && t.EstimatedRuntimeSeconds is null)
        {
            return null;
        }

        return t;
    }

    private static bool TryGetFloat(Dictionary<string, string> dict, string key, out float value)
    {
        value = 0;
        if (!dict.TryGetValue(key, out var raw))
        {
            return false;
        }

        // raw may include suffixes like "Percent".
        var token = raw.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
        return float.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }

    private static bool TryGetInt(Dictionary<string, string> dict, string key, out int value)
    {
        value = 0;
        if (!dict.TryGetValue(key, out var raw))
        {
            return false;
        }

        var token = raw.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
        return int.TryParse(token, NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
    }
}
