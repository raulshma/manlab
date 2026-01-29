using ManLab.Server.Constants;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// Configuration for process monitoring with hierarchical settings.
/// </summary>
public class ProcessMonitoringConfig
{
    public bool Enabled { get; set; } = true;
    public int TopCpuCount { get; set; } = 10;
    public int TopMemoryCount { get; set; } = 10;
    public int RefreshIntervalSeconds { get; set; } = 5;
    public double CpuAlertThreshold { get; set; } = 80.0;
    public double MemoryAlertThreshold { get; set; } = 80.0;
    public string[] ExcludePatterns { get; set; } = Array.Empty<string>();
}

public interface IProcessMonitoringConfigurationService
{
    Task<ProcessMonitoringConfig> GetGlobalConfigAsync();
    Task SetGlobalConfigAsync(ProcessMonitoringConfig config);
    Task<ProcessMonitoringConfig> GetNodeConfigAsync(Guid nodeId);
    Task SetNodeConfigAsync(Guid nodeId, ProcessMonitoringConfig config);
    Task ResetNodeConfigAsync(Guid nodeId);
}

/// <summary>
/// Service for managing hierarchical process monitoring configuration.
/// Fallback: Node-specific → Global default → Hardcoded default
/// </summary>
public class ProcessMonitoringConfigurationService : IProcessMonitoringConfigurationService
{
    private readonly ISettingsService _settings;
    private readonly ProcessMonitoringOptions _options;
    private readonly ILogger<ProcessMonitoringConfigurationService> _logger;

    public ProcessMonitoringConfigurationService(
        ISettingsService settings,
        IOptions<ProcessMonitoringOptions> options,
        ILogger<ProcessMonitoringConfigurationService> logger)
    {
        _settings = settings;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<ProcessMonitoringConfig> GetGlobalConfigAsync()
    {
        return new ProcessMonitoringConfig
        {
            Enabled = await _settings.GetValueAsync(
                SettingKeys.ProcessMonitoring.Enabled,
                _options.Enabled),

            TopCpuCount = await _settings.GetValueAsync(
                SettingKeys.ProcessMonitoring.DefaultTopCpuCount,
                _options.DefaultTopCpuCount),

            TopMemoryCount = await _settings.GetValueAsync(
                SettingKeys.ProcessMonitoring.DefaultTopMemoryCount,
                _options.DefaultTopMemoryCount),

            RefreshIntervalSeconds = await _settings.GetValueAsync(
                SettingKeys.ProcessMonitoring.DefaultRefreshIntervalSeconds,
                _options.DefaultRefreshIntervalSeconds),

            CpuAlertThreshold = await _settings.GetValueAsync(
                SettingKeys.ProcessMonitoring.DefaultCpuAlertThreshold,
                _options.DefaultCpuAlertThreshold),

            MemoryAlertThreshold = await _settings.GetValueAsync(
                SettingKeys.ProcessMonitoring.DefaultMemoryAlertThreshold,
                _options.DefaultMemoryAlertThreshold),

            ExcludePatterns = ParsePatterns(await _settings.GetValueAsync(
                SettingKeys.ProcessMonitoring.DefaultExcludePatterns,
                _options.DefaultExcludePatterns))
        };
    }

    public async Task SetGlobalConfigAsync(ProcessMonitoringConfig config)
    {
        ValidateConfig(config);

        await _settings.SetValueAsync(
            SettingKeys.ProcessMonitoring.Enabled,
            config.Enabled.ToString().ToLowerInvariant(),
            "ProcessMonitoring",
            "Whether process monitoring is enabled globally");

        await _settings.SetValueAsync(
            SettingKeys.ProcessMonitoring.DefaultTopCpuCount,
            config.TopCpuCount.ToString(),
            "ProcessMonitoring",
            "Default number of top CPU-consuming processes to collect");

        await _settings.SetValueAsync(
            SettingKeys.ProcessMonitoring.DefaultTopMemoryCount,
            config.TopMemoryCount.ToString(),
            "ProcessMonitoring",
            "Default number of top memory-consuming processes to collect");

        await _settings.SetValueAsync(
            SettingKeys.ProcessMonitoring.DefaultRefreshIntervalSeconds,
            config.RefreshIntervalSeconds.ToString(),
            "ProcessMonitoring",
            "Default refresh interval for process telemetry in seconds");

        await _settings.SetValueAsync(
            SettingKeys.ProcessMonitoring.DefaultCpuAlertThreshold,
            config.CpuAlertThreshold.ToString(),
            "ProcessMonitoring",
            "Default CPU usage threshold for alerts (percentage)");

        await _settings.SetValueAsync(
            SettingKeys.ProcessMonitoring.DefaultMemoryAlertThreshold,
            config.MemoryAlertThreshold.ToString(),
            "ProcessMonitoring",
            "Default memory usage threshold for alerts (percentage)");

        await _settings.SetValueAsync(
            SettingKeys.ProcessMonitoring.DefaultExcludePatterns,
            string.Join(",", config.ExcludePatterns),
            "ProcessMonitoring",
            "Default comma-separated wildcard patterns for excluding processes");
    }

    public async Task<ProcessMonitoringConfig> GetNodeConfigAsync(Guid nodeId)
    {
        var globalConfig = await GetGlobalConfigAsync();
        var nodePrefix = $"ProcessMonitoring.Node.";

        return new ProcessMonitoringConfig
        {
            Enabled = await _settings.GetValueAsync(
                $"{nodePrefix}Enabled.{nodeId}",
                globalConfig.Enabled),

            TopCpuCount = await _settings.GetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeTopCpuCountPrefix}{nodeId}",
                globalConfig.TopCpuCount),

            TopMemoryCount = await _settings.GetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeTopMemoryCountPrefix}{nodeId}",
                globalConfig.TopMemoryCount),

            RefreshIntervalSeconds = await _settings.GetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeRefreshIntervalSecondsPrefix}{nodeId}",
                globalConfig.RefreshIntervalSeconds),

            CpuAlertThreshold = await _settings.GetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeCpuAlertThresholdPrefix}{nodeId}",
                globalConfig.CpuAlertThreshold),

            MemoryAlertThreshold = await _settings.GetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeMemoryAlertThresholdPrefix}{nodeId}",
                globalConfig.MemoryAlertThreshold),

            ExcludePatterns = ParsePatterns(await _settings.GetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeExcludePatternsPrefix}{nodeId}",
                string.Join(",", globalConfig.ExcludePatterns)))
        };
    }

    public async Task SetNodeConfigAsync(Guid nodeId, ProcessMonitoringConfig config)
    {
        ValidateConfig(config);

        var nodePrefix = $"ProcessMonitoring.Node.";

        // Only set properties that differ from global defaults
        var globalConfig = await GetGlobalConfigAsync();

        if (config.Enabled != globalConfig.Enabled)
        {
            await _settings.SetValueAsync(
                $"{nodePrefix}Enabled.{nodeId}",
                config.Enabled.ToString().ToLowerInvariant(),
                "ProcessMonitoring",
                $"Node-specific override for process monitoring enabled flag");
        }

        if (config.TopCpuCount != globalConfig.TopCpuCount)
        {
            await _settings.SetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeTopCpuCountPrefix}{nodeId}",
                config.TopCpuCount.ToString(),
                "ProcessMonitoring",
                $"Node-specific top CPU process count override");
        }

        if (config.TopMemoryCount != globalConfig.TopMemoryCount)
        {
            await _settings.SetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeTopMemoryCountPrefix}{nodeId}",
                config.TopMemoryCount.ToString(),
                "ProcessMonitoring",
                $"Node-specific top memory process count override");
        }

        if (config.RefreshIntervalSeconds != globalConfig.RefreshIntervalSeconds)
        {
            await _settings.SetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeRefreshIntervalSecondsPrefix}{nodeId}",
                config.RefreshIntervalSeconds.ToString(),
                "ProcessMonitoring",
                $"Node-specific refresh interval override");
        }

        if (config.CpuAlertThreshold != globalConfig.CpuAlertThreshold)
        {
            await _settings.SetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeCpuAlertThresholdPrefix}{nodeId}",
                config.CpuAlertThreshold.ToString(),
                "ProcessMonitoring",
                $"Node-specific CPU alert threshold override");
        }

        if (config.MemoryAlertThreshold != globalConfig.MemoryAlertThreshold)
        {
            await _settings.SetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeMemoryAlertThresholdPrefix}{nodeId}",
                config.MemoryAlertThreshold.ToString(),
                "ProcessMonitoring",
                $"Node-specific memory alert threshold override");
        }

        var patternsStr = string.Join(",", config.ExcludePatterns);
        var globalPatternsStr = string.Join(",", globalConfig.ExcludePatterns);
        if (patternsStr != globalPatternsStr)
        {
            await _settings.SetValueAsync(
                $"{SettingKeys.ProcessMonitoring.NodeExcludePatternsPrefix}{nodeId}",
                patternsStr,
                "ProcessMonitoring",
                $"Node-specific exclusion patterns override");
        }
    }

    public async Task ResetNodeConfigAsync(Guid nodeId)
    {
        var nodePrefix = $"ProcessMonitoring.Node.";
        var keys = new[]
        {
            $"{nodePrefix}Enabled.{nodeId}",
            $"{SettingKeys.ProcessMonitoring.NodeTopCpuCountPrefix}{nodeId}",
            $"{SettingKeys.ProcessMonitoring.NodeTopMemoryCountPrefix}{nodeId}",
            $"{SettingKeys.ProcessMonitoring.NodeRefreshIntervalSecondsPrefix}{nodeId}",
            $"{SettingKeys.ProcessMonitoring.NodeCpuAlertThresholdPrefix}{nodeId}",
            $"{SettingKeys.ProcessMonitoring.NodeMemoryAlertThresholdPrefix}{nodeId}",
            $"{SettingKeys.ProcessMonitoring.NodeExcludePatternsPrefix}{nodeId}"
        };

        // Delete all node-specific settings to fall back to global defaults
        foreach (var key in keys)
        {
            try
            {
                // Set to null to clear the setting
                await _settings.SetValueAsync(key, null, "ProcessMonitoring");
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to clear node setting {Key}", key);
            }
        }
    }

    private static string[] ParsePatterns(string patterns)
    {
        if (string.IsNullOrWhiteSpace(patterns))
        {
            return Array.Empty<string>();
        }

        return patterns.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    private void ValidateConfig(ProcessMonitoringConfig config)
    {
        if (config.TopCpuCount < 1 || config.TopCpuCount > 100)
        {
            throw new ArgumentException("TopCpuCount must be between 1 and 100", nameof(config));
        }

        if (config.TopMemoryCount < 1 || config.TopMemoryCount > 100)
        {
            throw new ArgumentException("TopMemoryCount must be between 1 and 100", nameof(config));
        }

        if (config.RefreshIntervalSeconds < 2 || config.RefreshIntervalSeconds > 300)
        {
            throw new ArgumentException("RefreshIntervalSeconds must be between 2 and 300", nameof(config));
        }

        if (config.CpuAlertThreshold < 0 || config.CpuAlertThreshold > 100)
        {
            throw new ArgumentException("CpuAlertThreshold must be between 0 and 100", nameof(config));
        }

        if (config.MemoryAlertThreshold < 0 || config.MemoryAlertThreshold > 100)
        {
            throw new ArgumentException("MemoryAlertThreshold must be between 0 and 100", nameof(config));
        }

        if (config.ExcludePatterns == null)
        {
            config.ExcludePatterns = Array.Empty<string>();
        }
    }
}
