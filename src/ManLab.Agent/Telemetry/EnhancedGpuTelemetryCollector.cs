using System.Globalization;
using System.Runtime.InteropServices;
using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Enhanced GPU telemetry collector with detailed metrics including
/// power consumption, temperature details, clocks, and process-level usage.
/// </summary>
internal sealed class EnhancedGpuTelemetryCollector
{
    private const int DefaultTimeoutMs = 2000;
    private const int MaxGpuEntries = 16;
    private const int MaxProcessEntries = 20;

    private readonly ILogger _logger;
    private readonly AgentConfiguration _config;

    private DateTime _lastSampleAtUtc;
    private List<EnhancedGpuTelemetry>? _cached;

    public EnhancedGpuTelemetryCollector(ILogger logger, AgentConfiguration config)
    {
        _logger = logger;
        _config = config;
    }

    public List<EnhancedGpuTelemetry>? Collect()
    {
        if (!_config.EnableGpuTelemetry)
        {
            return null;
        }

        var cacheSeconds = Math.Max(1, _config.TelemetryCacheSeconds);
        if (_cached is not null && _lastSampleAtUtc != default &&
            (DateTime.UtcNow - _lastSampleAtUtc).TotalSeconds < cacheSeconds)
        {
            return _cached;
        }

        try
        {
            var gpus = new List<EnhancedGpuTelemetry>(capacity: 4);

            // NVIDIA GPUs via nvidia-smi
            var nvidiaGpus = CollectNvidiaGpus();
            if (nvidiaGpus.Count > 0)
            {
                gpus.AddRange(nvidiaGpus);
            }

            // AMD GPUs on Linux via sysfs/rocm-smi
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                var amdGpus = CollectAmdGpusLinux();
                gpus.AddRange(amdGpus);
            }

            // Intel GPUs on Linux via sysfs
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                var intelGpus = CollectIntelGpusLinux();
                gpus.AddRange(intelGpus);
            }

            _cached = gpus.Count > 0 ? gpus.Take(MaxGpuEntries).ToList() : null;
            _lastSampleAtUtc = DateTime.UtcNow;
            return _cached;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Enhanced GPU telemetry collection failed");
            _cached = null;
            _lastSampleAtUtc = DateTime.UtcNow;
            return null;
        }
    }

    private List<EnhancedGpuTelemetry> CollectNvidiaGpus()
    {
        var gpus = new List<EnhancedGpuTelemetry>();

        // Query comprehensive GPU info
        var queryFields = string.Join(",", new[]
        {
            "index", "name", "uuid", "pci.bus_id", "driver_version",
            "utilization.gpu", "utilization.memory", "utilization.encoder", "utilization.decoder",
            "memory.used", "memory.total", "memory.free",
            "temperature.gpu", "temperature.memory",
            "power.draw", "power.limit", "power.default_limit", "power.max_limit",
            "clocks.current.graphics", "clocks.current.memory", "clocks.max.graphics", "clocks.max.memory",
            "fan.speed", "pstate",
            "clocks_throttle_reasons.active"
        });

        if (!ExternalToolRunner.TryRun("nvidia-smi",
            $"--query-gpu={queryFields} --format=csv,noheader,nounits",
            DefaultTimeoutMs, out var output, out _))
        {
            return gpus;
        }

        var lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        foreach (var line in lines)
        {
            try
            {
                var gpu = ParseNvidiaGpuLine(line);
                if (gpu != null)
                {
                    // Collect process info for this GPU
                    gpu.Processes = CollectNvidiaProcesses(gpu.Index);
                    gpus.Add(gpu);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to parse NVIDIA GPU line: {Line}", line);
            }
        }

        return gpus;
    }

    private static EnhancedGpuTelemetry? ParseNvidiaGpuLine(string line)
    {
        var parts = line.Split(',').Select(p => p.Trim()).ToArray();
        if (parts.Length < 10)
        {
            return null;
        }

        var gpu = new EnhancedGpuTelemetry
        {
            Vendor = "nvidia",
            Index = TryParseInt(parts, 0) ?? 0,
            Name = GetStringOrNull(parts, 1),
            Uuid = GetStringOrNull(parts, 2),
            PciBusId = GetStringOrNull(parts, 3),
            DriverVersion = GetStringOrNull(parts, 4),
            UtilizationPercent = TryParseFloat(parts, 5),
            MemoryUtilizationPercent = TryParseFloat(parts, 6),
            EncoderUtilizationPercent = TryParseFloat(parts, 7),
            DecoderUtilizationPercent = TryParseFloat(parts, 8),
            MemoryUsedBytes = TryParseLong(parts, 9) * 1024 * 1024, // MiB to bytes
            MemoryTotalBytes = TryParseLong(parts, 10) * 1024 * 1024,
            MemoryFreeBytes = TryParseLong(parts, 11) * 1024 * 1024,
            TemperatureC = TryParseFloat(parts, 12),
            MemoryTemperatureC = TryParseFloat(parts, 13),
            PowerDrawWatts = TryParseFloat(parts, 14),
            PowerLimitWatts = TryParseFloat(parts, 15),
            DefaultPowerLimitWatts = TryParseFloat(parts, 16),
            MaxPowerLimitWatts = TryParseFloat(parts, 17),
            GraphicsClockMhz = TryParseInt(parts, 18),
            MemoryClockMhz = TryParseInt(parts, 19),
            MaxGraphicsClockMhz = TryParseInt(parts, 20),
            MaxMemoryClockMhz = TryParseInt(parts, 21),
            FanSpeedPercent = TryParseFloat(parts, 22),
            PerformanceState = GetStringOrNull(parts, 23)
        };

        // Parse throttle reasons
        var throttleReasons = GetStringOrNull(parts, 24);
        if (!string.IsNullOrEmpty(throttleReasons) && throttleReasons != "Not Active")
        {
            gpu.IsThrottling = true;
            gpu.ThrottleReasons = throttleReasons.Split('|').Select(r => r.Trim()).ToList();
        }
        else
        {
            gpu.IsThrottling = false;
        }

        return gpu;
    }

    private List<GpuProcessInfo> CollectNvidiaProcesses(int gpuIndex)
    {
        var processes = new List<GpuProcessInfo>();

        if (!ExternalToolRunner.TryRun("nvidia-smi",
            $"--query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits -i {gpuIndex}",
            DefaultTimeoutMs, out var computeOutput, out _))
        {
            return processes;
        }

        // Parse compute processes
        foreach (var line in computeOutput.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = line.Split(',').Select(p => p.Trim()).ToArray();
            if (parts.Length >= 3)
            {
                processes.Add(new GpuProcessInfo
                {
                    ProcessId = TryParseInt(parts, 0) ?? 0,
                    ProcessName = GetStringOrNull(parts, 1),
                    MemoryUsedBytes = TryParseLong(parts, 2) * 1024 * 1024,
                    UsageType = "Compute"
                });
            }
        }

        // Also query graphics processes
        if (ExternalToolRunner.TryRun("nvidia-smi",
            $"--query-accounted-apps=pid,gpu_util --format=csv,noheader,nounits -i {gpuIndex}",
            DefaultTimeoutMs, out var graphicsOutput, out _))
        {
            foreach (var line in graphicsOutput.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = line.Split(',').Select(p => p.Trim()).ToArray();
                if (parts.Length >= 2)
                {
                    var pid = TryParseInt(parts, 0) ?? 0;
                    var existing = processes.FirstOrDefault(p => p.ProcessId == pid);
                    if (existing != null)
                    {
                        existing.UtilizationPercent = TryParseFloat(parts, 1);
                    }
                    else
                    {
                        processes.Add(new GpuProcessInfo
                        {
                            ProcessId = pid,
                            UtilizationPercent = TryParseFloat(parts, 1),
                            UsageType = "Graphics"
                        });
                    }
                }
            }
        }

        return processes.Take(MaxProcessEntries).ToList();
    }


    private List<EnhancedGpuTelemetry> CollectAmdGpusLinux()
    {
        var gpus = new List<EnhancedGpuTelemetry>();

        // Try rocm-smi first
        if (ExternalToolRunner.TryRun("rocm-smi", "--showallinfo --json", DefaultTimeoutMs, out var rocmOutput, out _))
        {
            gpus.AddRange(ParseRocmSmiOutput(rocmOutput));
            if (gpus.Count > 0)
            {
                return gpus;
            }
        }

        // Fallback to sysfs
        try
        {
            var drmPath = "/sys/class/drm";
            if (!Directory.Exists(drmPath))
            {
                return gpus;
            }

            var cardDirs = Directory.GetDirectories(drmPath, "card*")
                .Where(d => !d.Contains("-"))
                .OrderBy(d => d);

            var index = 0;
            foreach (var cardDir in cardDirs)
            {
                var devicePath = Path.Combine(cardDir, "device");
                if (!Directory.Exists(devicePath))
                {
                    continue;
                }

                // Check if it's an AMD GPU
                var vendorPath = Path.Combine(devicePath, "vendor");
                if (!File.Exists(vendorPath))
                {
                    continue;
                }

                var vendor = File.ReadAllText(vendorPath).Trim();
                if (vendor != "0x1002") // AMD vendor ID
                {
                    continue;
                }

                var gpu = new EnhancedGpuTelemetry
                {
                    Vendor = "amd",
                    Index = index++,
                    Name = TryReadSysfsString(Path.Combine(devicePath, "product_name"))
                };

                // GPU utilization
                gpu.UtilizationPercent = TryReadSysfsFloat(Path.Combine(devicePath, "gpu_busy_percent"));

                // Memory
                var memUsed = TryReadSysfsLong(Path.Combine(devicePath, "mem_info_vram_used"));
                var memTotal = TryReadSysfsLong(Path.Combine(devicePath, "mem_info_vram_total"));
                gpu.MemoryUsedBytes = memUsed;
                gpu.MemoryTotalBytes = memTotal;
                if (memUsed.HasValue && memTotal.HasValue)
                {
                    gpu.MemoryFreeBytes = memTotal - memUsed;
                }

                // Temperature
                var hwmonPath = Directory.GetDirectories(Path.Combine(devicePath, "hwmon"), "hwmon*").FirstOrDefault();
                if (hwmonPath != null)
                {
                    var tempInput = TryReadSysfsLong(Path.Combine(hwmonPath, "temp1_input"));
                    if (tempInput.HasValue)
                    {
                        gpu.TemperatureC = tempInput.Value / 1000f;
                    }

                    // Power
                    var powerInput = TryReadSysfsLong(Path.Combine(hwmonPath, "power1_average"));
                    if (powerInput.HasValue)
                    {
                        gpu.PowerDrawWatts = powerInput.Value / 1000000f;
                    }

                    // Fan
                    var fanInput = TryReadSysfsLong(Path.Combine(hwmonPath, "pwm1"));
                    var fanMax = TryReadSysfsLong(Path.Combine(hwmonPath, "pwm1_max")) ?? 255;
                    if (fanInput.HasValue)
                    {
                        gpu.FanSpeedPercent = (fanInput.Value * 100f) / fanMax;
                    }
                }

                // Clocks
                gpu.GraphicsClockMhz = (int?)(TryReadSysfsLong(Path.Combine(devicePath, "pp_dpm_sclk_current")) / 1000000);
                gpu.MemoryClockMhz = (int?)(TryReadSysfsLong(Path.Combine(devicePath, "pp_dpm_mclk_current")) / 1000000);

                gpus.Add(gpu);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to collect AMD GPU info from sysfs");
        }

        return gpus;
    }

    private List<EnhancedGpuTelemetry> ParseRocmSmiOutput(string output)
    {
        // Simplified rocm-smi JSON parsing
        var gpus = new List<EnhancedGpuTelemetry>();
        // Note: Full JSON parsing would require System.Text.Json
        // This is a simplified implementation
        return gpus;
    }

    private List<EnhancedGpuTelemetry> CollectIntelGpusLinux()
    {
        var gpus = new List<EnhancedGpuTelemetry>();

        try
        {
            var drmPath = "/sys/class/drm";
            if (!Directory.Exists(drmPath))
            {
                return gpus;
            }

            var cardDirs = Directory.GetDirectories(drmPath, "card*")
                .Where(d => !d.Contains("-"))
                .OrderBy(d => d);

            var index = 0;
            foreach (var cardDir in cardDirs)
            {
                var devicePath = Path.Combine(cardDir, "device");
                if (!Directory.Exists(devicePath))
                {
                    continue;
                }

                var vendorPath = Path.Combine(devicePath, "vendor");
                if (!File.Exists(vendorPath))
                {
                    continue;
                }

                var vendor = File.ReadAllText(vendorPath).Trim();
                if (vendor != "0x8086") // Intel vendor ID
                {
                    continue;
                }

                var gpu = new EnhancedGpuTelemetry
                {
                    Vendor = "intel",
                    Index = index++
                };

                // Try to get GPU name from i915 driver
                var i915Path = Path.Combine(devicePath, "drm", Path.GetFileName(cardDir));
                gpu.Name = TryReadSysfsString(Path.Combine(i915Path, "gt", "gt0", "name")) ?? "Intel GPU";

                // Intel GPU frequency
                var freqPath = Path.Combine(devicePath, "drm", Path.GetFileName(cardDir), "gt_cur_freq_mhz");
                gpu.GraphicsClockMhz = (int?)TryReadSysfsLong(freqPath);

                var maxFreqPath = Path.Combine(devicePath, "drm", Path.GetFileName(cardDir), "gt_max_freq_mhz");
                gpu.MaxGraphicsClockMhz = (int?)TryReadSysfsLong(maxFreqPath);

                gpus.Add(gpu);
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to collect Intel GPU info from sysfs");
        }

        return gpus;
    }

    private static string? TryReadSysfsString(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                return File.ReadAllText(path).Trim();
            }
        }
        catch { }
        return null;
    }

    private static long? TryReadSysfsLong(string path)
    {
        var str = TryReadSysfsString(path);
        if (str != null && long.TryParse(str, out var value))
        {
            return value;
        }
        return null;
    }

    private static float? TryReadSysfsFloat(string path)
    {
        var str = TryReadSysfsString(path);
        if (str != null && float.TryParse(str, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
        {
            return value;
        }
        return null;
    }

    private static int? TryParseInt(string[] parts, int index)
    {
        if (index < parts.Length && int.TryParse(parts[index], out var value))
        {
            return value;
        }
        return null;
    }

    private static long? TryParseLong(string[] parts, int index)
    {
        if (index < parts.Length && long.TryParse(parts[index], out var value))
        {
            return value;
        }
        return null;
    }

    private static float? TryParseFloat(string[] parts, int index)
    {
        if (index < parts.Length && float.TryParse(parts[index], NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
        {
            return value;
        }
        return null;
    }

    private static string? GetStringOrNull(string[] parts, int index)
    {
        if (index < parts.Length)
        {
            var value = parts[index].Trim();
            return string.IsNullOrEmpty(value) || value == "[N/A]" || value == "N/A" ? null : value;
        }
        return null;
    }
}
