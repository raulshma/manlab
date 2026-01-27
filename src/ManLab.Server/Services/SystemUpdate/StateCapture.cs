using Renci.SshNet;
using System.Text;
using System.Text.Json;

namespace ManLab.Server.Services.SystemUpdate;

/// <summary>
/// Captures system state before and after updates.
/// </summary>
public static class StateCapture
{
    /// <summary>
    /// Maximum size of captured state output in bytes.
    /// </summary>
    private const int MaxStateOutputBytes = 500_000;

    /// <summary>
    /// Captures the system state before an update.
    /// </summary>
    public static async Task<SystemState> CapturePreUpdateStateAsync(
        SshClient client,
        string osType,
        string? packageManager = null,
        CancellationToken cancellationToken = default)
    {
        var state = new SystemState { CaptureTimestamp = DateTime.UtcNow };

        try
        {
            // Get basic system info
            state.OsVersion = await ExecuteCommandAsync(client, "uname -a", cancellationToken);
            state.KernelVersion = await ExecuteCommandAsync(client, "uname -r", cancellationToken);

            // Get disk usage
            var diskUsage = await ExecuteCommandAsync(client, "df -h / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%'", cancellationToken);
            if (int.TryParse(diskUsage, out var usage))
            {
                state.DiskUsagePercent = usage;
            }

            // Get installed packages based on platform
            var pkgCommand = GetPackageListCommand(osType, packageManager);
            var packagesJson = await ExecuteCommandAsync(client, pkgCommand, cancellationToken);
            state.InstalledPackages = ParsePackagesJson(packagesJson);

            // Get pending updates
            var checkCommand = PlatformCommandBuilder.BuildCheckCommand(osType, packageManager);
            var pendingOutput = await ExecuteCommandAsync(client, checkCommand, cancellationToken);
            state.PendingUpdates = PlatformCommandBuilder.ParseUpdateList(pendingOutput, osType);

            // Get system info
            state.SystemInfo = await ExecuteCommandAsync(client, "uptime 2>/dev/null && echo '' && free -h 2>/dev/null", cancellationToken);
        }
        catch (Exception ex)
        {
            state.ErrorMessage = $"Failed to capture pre-update state: {ex.Message}";
        }

        return state;
    }

    /// <summary>
    /// Captures the system state after an update.
    /// </summary>
    public static async Task<SystemState> CapturePostUpdateStateAsync(
        SshClient client,
        string osType,
        string? packageManager = null,
        CancellationToken cancellationToken = default)
    {
        var state = new SystemState { CaptureTimestamp = DateTime.UtcNow };

        try
        {
            // Get basic system info
            state.OsVersion = await ExecuteCommandAsync(client, "uname -a", cancellationToken);
            state.KernelVersion = await ExecuteCommandAsync(client, "uname -r", cancellationToken);

            // Get disk usage
            var diskUsage = await ExecuteCommandAsync(client, "df -h / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%'", cancellationToken);
            if (int.TryParse(diskUsage, out var usage))
            {
                state.DiskUsagePercent = usage;
            }

            // Get installed packages
            var pkgCommand = GetPackageListCommand(osType, packageManager);
            var packagesJson = await ExecuteCommandAsync(client, pkgCommand, cancellationToken);
            state.InstalledPackages = ParsePackagesJson(packagesJson);

            // Check if reboot is required
            var rebootCommand = PlatformCommandBuilder.BuildRebootCheckCommand(osType, packageManager);
            var rebootOutput = await ExecuteCommandAsync(client, rebootCommand, cancellationToken);
            state.RebootRequired = rebootOutput.Contains("REBOOT_REQUIRED", StringComparison.OrdinalIgnoreCase);

            // Get system info
            state.SystemInfo = await ExecuteCommandAsync(client, "uptime 2>/dev/null && echo '' && free -h 2>/dev/null", cancellationToken);
        }
        catch (Exception ex)
        {
            state.ErrorMessage = $"Failed to capture post-update state: {ex.Message}";
        }

        return state;
    }

    /// <summary>
    /// Compares two system states and returns a summary of changes.
    /// </summary>
    public static SystemStateComparison CompareStates(SystemState before, SystemState after)
    {
        var comparison = new SystemStateComparison
        {
            BeforeTimestamp = before.CaptureTimestamp,
            AfterTimestamp = after.CaptureTimestamp
        };

        // Find new or updated packages
        var beforePackages = before.InstalledPackages;
        var afterPackages = after.InstalledPackages;

        foreach (var afterPkg in afterPackages)
        {
            if (!beforePackages.TryGetValue(afterPkg.Key, out var beforeVersion))
            {
                comparison.NewPackages.Add(afterPkg.Key, afterPkg.Value);
            }
            else if (beforeVersion != afterPkg.Value)
            {
                comparison.UpdatedPackages.Add(afterPkg.Key, new PackageChange
                {
                    FromVersion = beforeVersion,
                    ToVersion = afterPkg.Value
                });
            }
        }

        // Find removed packages
        foreach (var beforePkg in beforePackages)
        {
            if (!afterPackages.ContainsKey(beforePkg.Key))
            {
                comparison.RemovedPackages.Add(beforePkg.Key, beforePkg.Value);
            }
        }

        // Check for changes
        comparison.DiskUsageChanged = before.DiskUsagePercent != after.DiskUsagePercent;
        comparison.DiskUsageBefore = before.DiskUsagePercent;
        comparison.DiskUsageAfter = after.DiskUsagePercent;

        comparison.RebootRequired = after.RebootRequired;
        comparison.KernelChanged = before.KernelVersion != after.KernelVersion;

        return comparison;
    }

    /// <summary>
    /// Serializes a system state to JSON.
    /// </summary>
    public static string SerializeState(SystemState state)
    {
        var options = new JsonSerializerOptions
        {
            WriteIndented = false,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        };

        return JsonSerializer.Serialize(state, options);
    }

    /// <summary>
    /// Deserializes a system state from JSON.
    /// </summary>
    public static SystemState? DeserializeState(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<SystemState>(json);
        }
        catch
        {
            return null;
        }
    }

    #region Private Helpers

    private static async Task<string> ExecuteCommandAsync(
        SshClient client,
        string command,
        CancellationToken cancellationToken)
    {
        var cmd = client.CreateCommand(command);
        var asyncExecute = cmd.BeginExecute();

        // Create a task to wait for completion
        var outputTask = Task.Run(async () =>
        {
            var output = new StringBuilder();
            var buffer = new byte[8192];
            var stream = cmd.OutputStream;

            while (!asyncExecute.IsCompleted && !cancellationToken.IsCancellationRequested)
            {
                var read = await stream.ReadAsync(buffer, 0, buffer.Length, cancellationToken);
                if (read == 0)
                {
                    await Task.Delay(100, cancellationToken);
                    continue;
                }

                var text = Encoding.UTF8.GetString(buffer, 0, read);
                output.Append(text);

                if (output.Length >= MaxStateOutputBytes)
                {
                    output.AppendLine("\n... [truncated]");
                    cmd.CancelAsync();
                    break;
                }
            }

            cmd.EndExecute(asyncExecute);
            return output.ToString();
        }, cancellationToken);

        return await outputTask;
    }

    private static string GetPackageListCommand(string osType, string? packageManager)
    {
        return (osType.ToLowerInvariant(), packageManager?.ToLowerInvariant()) switch
        {
            ("linux", "apt") or ("linux", null) => "dpkg -l 2>/dev/null | tail -n +6 | awk '{print $2 \"\\t\" $3}' | head -1000",
            ("linux", "yum") or ("linux", "dnf") => "rpm -qa 2>/dev/null | sort | head -1000",
            ("linux", "pacman") => "pacman -Q 2>/dev/null | head -1000",
            ("linux", "zypper") => "zypper search --installed-only 2>/dev/null | tail -n +4 | awk '{print $3 \"\\t\" $5}' | head -1000",
            ("windows", _) => "Get-WmiObject -Class Win32_Product | Select-Object Name,Version | ConvertTo-Json",
            ("macos", _) or ("darwin", _) => "pkgutil --pkgs 2>/dev/null | head -100 | while read pkg; do pkgutil --pkg-info \"$pkg\" 2>/dev/null | grep -E 'version:|pkgid:' | tr '\\n' ' '; echo ''; done",
            _ => "echo '{}'"
        };
    }

    private static Dictionary<string, string> ParsePackagesJson(string output)
    {
        var packages = new Dictionary<string, string>();

        if (string.IsNullOrWhiteSpace(output))
        {
            return packages;
        }

        var lines = output.Split('\n');
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (string.IsNullOrWhiteSpace(trimmed))
            {
                continue;
            }

            var parts = trimmed.Split(['\t', ' '], StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 2)
            {
                packages[parts[0]] = parts[1];
            }
            else if (parts.Length == 1)
            {
                packages[parts[0]] = "unknown";
            }
        }

        return packages;
    }

    #endregion
}

#region Public Data Types

/// <summary>
/// Represents the state of a system at a point in time.
/// </summary>
public sealed class SystemState
{
    public DateTime CaptureTimestamp { get; set; } = DateTime.UtcNow;
    public string OsVersion { get; set; } = string.Empty;
    public string KernelVersion { get; set; } = string.Empty;
    public Dictionary<string, string> InstalledPackages { get; set; } = new();
    public List<SystemPackage> PendingUpdates { get; set; } = new();
    public int DiskUsagePercent { get; set; }
    public string? SystemInfo { get; set; }
    public bool RebootRequired { get; set; }
    public string? ErrorMessage { get; set; }
}

/// <summary>
/// Represents the comparison between two system states.
/// </summary>
public sealed class SystemStateComparison
{
    public DateTime BeforeTimestamp { get; set; }
    public DateTime AfterTimestamp { get; set; }

    public Dictionary<string, string> NewPackages { get; set; } = new();
    public Dictionary<string, string> RemovedPackages { get; set; } = new();

    /// <summary>
    /// Key: package name, Value: {FromVersion, ToVersion}
    /// </summary>
    public Dictionary<string, PackageChange> UpdatedPackages { get; set; } = new();

    public bool DiskUsageChanged { get; set; }
    public int DiskUsageBefore { get; set; }
    public int DiskUsageAfter { get; set; }

    public bool RebootRequired { get; set; }
    public bool KernelChanged { get; set; }

    /// <summary>
    /// Summary message describing the changes.
    /// </summary>
    public string GetSummary()
    {
        var sb = new StringBuilder();

        if (UpdatedPackages.Count > 0)
        {
            sb.AppendLine($"Updated {UpdatedPackages.Count} package(s):");
            foreach (var (name, change) in UpdatedPackages.Take(10))
            {
                sb.AppendLine($"  - {name}: {change.FromVersion} → {change.ToVersion}");
            }
            if (UpdatedPackages.Count > 10)
            {
                sb.AppendLine($"  ... and {UpdatedPackages.Count - 10} more");
            }
        }

        if (NewPackages.Count > 0)
        {
            sb.AppendLine($"Installed {NewPackages.Count} new package(s).");
        }

        if (RemovedPackages.Count > 0)
        {
            sb.AppendLine($"Removed {RemovedPackages.Count} package(s).");
        }

        if (KernelChanged)
        {
            sb.AppendLine("Kernel was updated.");
        }

        if (RebootRequired)
        {
            sb.AppendLine("System reboot is required.");
        }

        return sb.ToString();
    }
}

/// <summary>
/// Represents a package version change.
/// </summary>
public sealed class PackageChange
{
    public required string FromVersion { get; set; }
    public required string ToVersion { get; set; }
}

#endregion
