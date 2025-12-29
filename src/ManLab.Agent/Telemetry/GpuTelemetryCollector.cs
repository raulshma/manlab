using System.Globalization;
using System.Runtime.InteropServices;
using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Best-effort GPU telemetry collector.
///
/// Strategies:
/// - Nvidia: nvidia-smi (Windows/Linux)
/// - Intel/AMD on Linux: /sys/class/drm
///
/// All fields are optional; failures must not break the heartbeat.
/// </summary>
internal sealed class GpuTelemetryCollector
{
    private const int DefaultTimeoutMs = 1200;
    private const int MaxGpuEntries = 16;

    private readonly ILogger _logger;
    private readonly AgentConfiguration _config;

    private DateTime _lastSampleAtUtc;
    private List<GpuTelemetry>? _cached;

    public GpuTelemetryCollector(ILogger logger, AgentConfiguration config)
    {
        _logger = logger;
        _config = config;
    }

    public List<GpuTelemetry>? Collect()
    {
        if (!_config.EnableGpuTelemetry)
        {
            return null;
        }

        var cacheSeconds = Math.Max(1, _config.TelemetryCacheSeconds);
        if (_cached is not null && _lastSampleAtUtc != default && (DateTime.UtcNow - _lastSampleAtUtc).TotalSeconds < cacheSeconds)
        {
            return _cached;
        }

        try
        {
            var gpus = new List<GpuTelemetry>(capacity: 4);

            var nvidia = TryCollectNvidiaSmi(out var nvidiaList) ? nvidiaList : null;
            if (nvidia is { Count: > 0 })
            {
                gpus.AddRange(nvidia);
            }

            // Windows: best-effort adapter enumeration (helps when nvidia-smi is unavailable
            // and enables listing non-NVIDIA GPUs on mixed systems).
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                foreach (var gpu in WindowsDxgiGpuEnumerator.EnumerateGpus())
                {
                    // Avoid duplicating NVIDIA entries when nvidia-smi is available.
                    if (nvidia is { Count: > 0 } && gpu.Vendor.Equals("nvidia", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    gpus.Add(gpu);
                    if (gpus.Count >= MaxGpuEntries)
                    {
                        break;
                    }
                }
            }

            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                foreach (var gpu in CollectLinuxSysfsGpus())
                {
                    // Avoid duplicating Nvidia entries when nvidia-smi is available.
                    if (nvidia is { Count: > 0 } && gpu.Vendor.Equals("nvidia", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    gpus.Add(gpu);
                    if (gpus.Count >= MaxGpuEntries)
                    {
                        break;
                    }
                }
            }

            // Normalize: return null if nothing is available.
            _cached = gpus.Count > 0 ? gpus.Take(MaxGpuEntries).ToList() : null;
            _lastSampleAtUtc = DateTime.UtcNow;

            return _cached;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "GPU telemetry collection failed");
            _cached = null;
            _lastSampleAtUtc = DateTime.UtcNow;
            return null;
        }
    }

    private bool TryCollectNvidiaSmi(out List<GpuTelemetry> gpus)
    {
        gpus = [];

        // CSV is easiest to parse without JSON deps.
        // nounits avoids "MiB"/"%" suffixes.
        const string args = "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits";

        if (!ExternalToolRunner.TryRun("nvidia-smi", args, DefaultTimeoutMs, out var stdout, out _))
        {
            return false;
        }

        gpus = ParseNvidiaSmiCsv(stdout);
        return gpus.Count > 0;
    }

    public static List<GpuTelemetry> ParseNvidiaSmiCsv(string? stdout)
    {
        var result = new List<GpuTelemetry>();

        if (string.IsNullOrWhiteSpace(stdout))
        {
            return result;
        }

        var lines = stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var line in lines)
        {
            // Expected 6 columns, but GPU names can theoretically contain commas.
            var cols = line.Split(',', StringSplitOptions.TrimEntries);
            if (cols.Length < 6)
            {
                continue;
            }

            // index | name... | util | memUsed | memTotal | temp
            var indexText = cols[0];
            var tempText = cols[^1];
            var memTotalText = cols[^2];
            var memUsedText = cols[^3];
            var utilText = cols[^4];

            var nameParts = cols.Skip(1).Take(cols.Length - 5);
            var nameText = string.Join(", ", nameParts);

            if (!int.TryParse(indexText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var index))
            {
                continue;
            }

            var gpu = new GpuTelemetry
            {
                Vendor = "nvidia",
                Index = index,
                Name = string.IsNullOrWhiteSpace(nameText) ? null : nameText
            };

            if (float.TryParse(utilText, NumberStyles.Float, CultureInfo.InvariantCulture, out var util))
            {
                gpu.UtilizationPercent = util;
            }

            // nvidia-smi reports MiB when using nounits
            if (long.TryParse(memUsedText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var memUsedMiB))
            {
                gpu.MemoryUsedBytes = memUsedMiB * 1024L * 1024L;
            }

            if (long.TryParse(memTotalText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var memTotalMiB))
            {
                gpu.MemoryTotalBytes = memTotalMiB * 1024L * 1024L;
            }

            if (float.TryParse(tempText, NumberStyles.Float, CultureInfo.InvariantCulture, out var tempC))
            {
                gpu.TemperatureC = tempC;
            }

            result.Add(gpu);
            if (result.Count >= MaxGpuEntries)
            {
                break;
            }
        }

        return result;
    }

    private static IEnumerable<GpuTelemetry> CollectLinuxSysfsGpus()
    {
        const string drmPath = "/sys/class/drm";
        if (!Directory.Exists(drmPath))
        {
            yield break;
        }

        string[] cardDirs;
        try
        {
            cardDirs = Directory.GetDirectories(drmPath, "card*");
        }
        catch
        {
            yield break;
        }

        foreach (var cardDir in cardDirs)
        {
            var name = Path.GetFileName(cardDir);
            if (!name.StartsWith("card", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!TryParseCardIndex(name, out var cardIndex))
            {
                continue;
            }

            var deviceDir = Path.Combine(cardDir, "device");
            if (!Directory.Exists(deviceDir))
            {
                continue;
            }

            var vendor = ReadLinuxPciVendor(deviceDir);

            var gpu = new GpuTelemetry
            {
                Vendor = vendor,
                Index = cardIndex,
                Name = BuildLinuxGpuName(deviceDir, vendor)
            };

            // Utilization: AMD has gpu_busy_percent; Intel i915 may expose gt_busy_percent.
            if (TryReadFloat(Path.Combine(deviceDir, "gpu_busy_percent"), out var amdBusy))
            {
                gpu.UtilizationPercent = amdBusy;
            }
            else
            {
                var gtBusyPath = TryFindGtBusyPercent(cardDir, deviceDir);
                if (gtBusyPath is not null && TryReadFloat(gtBusyPath, out var gtBusy))
                {
                    gpu.UtilizationPercent = gtBusy;
                }
            }

            // Memory (AMD best-effort)
            if (TryReadLong(Path.Combine(deviceDir, "mem_info_vram_used"), out var vramUsed))
            {
                gpu.MemoryUsedBytes = vramUsed;
            }
            if (TryReadLong(Path.Combine(deviceDir, "mem_info_vram_total"), out var vramTotal))
            {
                gpu.MemoryTotalBytes = vramTotal;
            }

            // Temperature via hwmon temp1_input (millidegrees C)
            var tempPath = TryFindHwmonTempMilliC(deviceDir);
            if (tempPath is not null && TryReadFloat(tempPath, out var tempMilliC))
            {
                gpu.TemperatureC = tempMilliC / 1000f;
            }

            yield return gpu;
        }
    }

    private static bool TryParseCardIndex(string cardName, out int index)
    {
        index = 0;
        if (cardName.Length <= 4)
        {
            return false;
        }

        return int.TryParse(cardName.AsSpan(4), NumberStyles.Integer, CultureInfo.InvariantCulture, out index);
    }

    private static string ReadLinuxPciVendor(string deviceDir)
    {
        try
        {
            var vendorPath = Path.Combine(deviceDir, "vendor");
            if (!File.Exists(vendorPath))
            {
                return "unknown";
            }

            var txt = File.ReadAllText(vendorPath).Trim();
            // values like 0x10de
            if (txt.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                txt = txt[2..];
            }

            if (!int.TryParse(txt, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var vendorId))
            {
                return "unknown";
            }

            return vendorId switch
            {
                0x10DE => "nvidia",
                0x1002 => "amd",
                0x8086 => "intel",
                _ => "unknown"
            };
        }
        catch
        {
            return "unknown";
        }
    }

    private static string? BuildLinuxGpuName(string deviceDir, string vendor)
    {
        // Very best-effort: build a readable identifier from uevent and PCI IDs.
        try
        {
            var ueventPath = Path.Combine(deviceDir, "uevent");
            if (!File.Exists(ueventPath))
            {
                return vendor;
            }

            string? driver = null;
            string? pciId = null;

            foreach (var line in File.ReadLines(ueventPath))
            {
                if (line.StartsWith("DRIVER=", StringComparison.OrdinalIgnoreCase))
                {
                    driver = line[7..].Trim();
                }
                else if (line.StartsWith("PCI_ID=", StringComparison.OrdinalIgnoreCase))
                {
                    pciId = line[7..].Trim();
                }
            }

            var parts = new List<string>(capacity: 3);
            if (!string.IsNullOrWhiteSpace(vendor)) parts.Add(vendor);
            if (!string.IsNullOrWhiteSpace(driver)) parts.Add(driver);
            if (!string.IsNullOrWhiteSpace(pciId)) parts.Add(pciId);

            var combined = string.Join(' ', parts);
            return string.IsNullOrWhiteSpace(combined) ? vendor : combined;
        }
        catch
        {
            return vendor;
        }
    }

    private static string? TryFindGtBusyPercent(string cardDir, string deviceDir)
    {
        // Intel i915/xe sysfs layouts have evolved over kernel versions.
        // Prefer known direct paths first, then probe common subfolders.

        // Direct candidates.
        var directCandidates = new[]
        {
            Path.Combine(cardDir, "gt_busy_percent"),
            Path.Combine(deviceDir, "gt_busy_percent"),
            Path.Combine(deviceDir, "drm", Path.GetFileName(cardDir) ?? string.Empty, "gt_busy_percent")
        };

        foreach (var c in directCandidates)
        {
            if (!string.IsNullOrWhiteSpace(c) && File.Exists(c))
            {
                return c;
            }
        }

        // Newer kernels often place busy stats under gt/gt*/gt_busy_percent.
        // Probe a few bounded patterns (avoid unbounded recursion on huge sysfs trees).
        var boundedRoots = new[]
        {
            Path.Combine(deviceDir, "gt"),
            Path.Combine(deviceDir, "drm", Path.GetFileName(cardDir) ?? string.Empty, "gt"),
            Path.Combine(cardDir, "gt")
        };

        foreach (var root in boundedRoots)
        {
            var found = TryFindFirstFile(root, "gt_busy_percent", maxDepth: 3);
            if (found is not null)
            {
                return found;
            }
        }

        return null;
    }

    internal static string? TryFindFirstFile(string rootDir, string fileName, int maxDepth)
    {
        if (string.IsNullOrWhiteSpace(rootDir) || maxDepth < 0)
        {
            return null;
        }

        try
        {
            if (!Directory.Exists(rootDir))
            {
                return null;
            }

            var direct = Path.Combine(rootDir, fileName);
            if (File.Exists(direct))
            {
                return direct;
            }

            if (maxDepth == 0)
            {
                return null;
            }

            foreach (var dir in Directory.EnumerateDirectories(rootDir))
            {
                var found = TryFindFirstFile(dir, fileName, maxDepth - 1);
                if (found is not null)
                {
                    return found;
                }
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private static string? TryFindHwmonTempMilliC(string deviceDir)
    {
        try
        {
            var hwmonDir = Path.Combine(deviceDir, "hwmon");
            if (!Directory.Exists(hwmonDir))
            {
                return null;
            }

            foreach (var d in Directory.GetDirectories(hwmonDir, "hwmon*"))
            {
                var tempPath = Path.Combine(d, "temp1_input");
                if (File.Exists(tempPath))
                {
                    return tempPath;
                }
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private static bool TryReadLong(string path, out long value)
    {
        value = 0;
        try
        {
            if (!File.Exists(path))
            {
                return false;
            }

            var txt = File.ReadAllText(path).Trim();
            return long.TryParse(txt, NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
        }
        catch
        {
            return false;
        }
    }

    private static bool TryReadFloat(string path, out float value)
    {
        value = 0;
        try
        {
            if (!File.Exists(path))
            {
                return false;
            }

            var txt = File.ReadAllText(path).Trim();
            return float.TryParse(txt, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
        }
        catch
        {
            return false;
        }
    }
}
