namespace ManLab.Shared.Dtos;

/// <summary>
/// Enhanced GPU telemetry with additional metrics.
/// </summary>
public sealed class EnhancedGpuTelemetry
{
    /// <summary>Vendor identifier (e.g. "nvidia", "intel", "amd").</summary>
    public string Vendor { get; set; } = "unknown";

    /// <summary>GPU index (0-based).</summary>
    public int Index { get; set; }

    /// <summary>GPU name/model.</summary>
    public string? Name { get; set; }

    /// <summary>Driver version.</summary>
    public string? DriverVersion { get; set; }

    /// <summary>GPU UUID (unique identifier).</summary>
    public string? Uuid { get; set; }

    /// <summary>PCI bus ID.</summary>
    public string? PciBusId { get; set; }

    // --- Utilization ---

    /// <summary>GPU core utilization percentage (0-100).</summary>
    public float? UtilizationPercent { get; set; }

    /// <summary>Memory controller utilization percentage (0-100).</summary>
    public float? MemoryUtilizationPercent { get; set; }

    /// <summary>Encoder utilization percentage (0-100).</summary>
    public float? EncoderUtilizationPercent { get; set; }

    /// <summary>Decoder utilization percentage (0-100).</summary>
    public float? DecoderUtilizationPercent { get; set; }

    // --- Memory ---

    /// <summary>GPU memory used in bytes.</summary>
    public long? MemoryUsedBytes { get; set; }

    /// <summary>GPU memory total in bytes.</summary>
    public long? MemoryTotalBytes { get; set; }

    /// <summary>GPU memory free in bytes.</summary>
    public long? MemoryFreeBytes { get; set; }

    // --- Temperature ---

    /// <summary>GPU core temperature in Celsius.</summary>
    public float? TemperatureC { get; set; }

    /// <summary>GPU memory temperature in Celsius (if available).</summary>
    public float? MemoryTemperatureC { get; set; }

    /// <summary>GPU hotspot temperature in Celsius (if available).</summary>
    public float? HotspotTemperatureC { get; set; }

    /// <summary>Temperature throttle threshold in Celsius.</summary>
    public float? ThrottleTemperatureC { get; set; }

    // --- Power ---

    /// <summary>Current power draw in watts.</summary>
    public float? PowerDrawWatts { get; set; }

    /// <summary>Power limit in watts.</summary>
    public float? PowerLimitWatts { get; set; }

    /// <summary>Default power limit in watts.</summary>
    public float? DefaultPowerLimitWatts { get; set; }

    /// <summary>Maximum power limit in watts.</summary>
    public float? MaxPowerLimitWatts { get; set; }

    // --- Clocks ---

    /// <summary>Current graphics clock in MHz.</summary>
    public int? GraphicsClockMhz { get; set; }

    /// <summary>Current memory clock in MHz.</summary>
    public int? MemoryClockMhz { get; set; }

    /// <summary>Maximum graphics clock in MHz.</summary>
    public int? MaxGraphicsClockMhz { get; set; }

    /// <summary>Maximum memory clock in MHz.</summary>
    public int? MaxMemoryClockMhz { get; set; }

    // --- Fan ---

    /// <summary>Fan speed percentage (0-100).</summary>
    public float? FanSpeedPercent { get; set; }

    // --- Performance State ---

    /// <summary>Current performance state (e.g., "P0", "P8").</summary>
    public string? PerformanceState { get; set; }

    /// <summary>Whether the GPU is currently throttling.</summary>
    public bool? IsThrottling { get; set; }

    /// <summary>Throttle reasons (if throttling).</summary>
    public List<string>? ThrottleReasons { get; set; }

    // --- Process-level usage ---

    /// <summary>Processes using this GPU.</summary>
    public List<GpuProcessInfo>? Processes { get; set; }
}

/// <summary>
/// Information about a process using GPU resources.
/// </summary>
public sealed class GpuProcessInfo
{
    /// <summary>Process ID.</summary>
    public int ProcessId { get; set; }

    /// <summary>Process name.</summary>
    public string? ProcessName { get; set; }

    /// <summary>GPU memory used by this process in bytes.</summary>
    public long? MemoryUsedBytes { get; set; }

    /// <summary>GPU utilization by this process (0-100, if available).</summary>
    public float? UtilizationPercent { get; set; }

    /// <summary>Type of GPU usage (e.g., "Graphics", "Compute", "Video").</summary>
    public string? UsageType { get; set; }
}
