using System.Text.Json;
using System.Text.RegularExpressions;

namespace ManLab.Server.Services.SystemUpdate;

/// <summary>
/// Builds platform-specific commands for system updates.
/// </summary>
public static partial class PlatformCommandBuilder
{
    /// <summary>
    /// Builds a command to check for available updates.
    /// </summary>
    public static string BuildCheckCommand(string osType, string? packageManager = null)
    {
        return (osType.ToLowerInvariant(), packageManager?.ToLowerInvariant()) switch
        {
            // Linux package managers
            ("linux", "apt") or ("linux", null) when IsAptAvailable() => "apt list --upgradable 2>/dev/null",
            ("linux", "yum") => "yum check-update --assumeno 2>/dev/null || yum check-update 2>/dev/null",
            ("linux", "dnf") => "dnf check-update --assumeno 2>/dev/null || dnf check-update 2>/dev/null",
            ("linux", "pacman") => "sudo pacman -Sy 2>/dev/null && pacman -Qu 2>/dev/null",
            ("linux", "zypper") => "zypper list-updates --type patch 2>/dev/null",
            ("linux", _) when !string.IsNullOrEmpty(packageManager) => $"{packageManager} check-update 2>/dev/null",

            // Windows
            ("windows", _) or ("windows", null) => BuildWindowsCheckCommand(),

            // macOS
            ("macos", _) or ("darwin", _) => "softwareupdate -l",

            // Default: try to detect
            _ => throw new PlatformNotSupportedException($"Unsupported OS type: {osType} or package manager: {packageManager}")
        };
    }

    /// <summary>
    /// Builds a command to list available updates in detail.
    /// </summary>
    public static string BuildListCommand(string osType, string? packageManager = null)
    {
        return (osType.ToLowerInvariant(), packageManager?.ToLowerInvariant()) switch
        {
            // Linux package managers
            ("linux", "apt") or ("linux", null) when IsAptAvailable() =>
                "apt-get -qq --print-uris upgrade 2>/dev/null | awk '{print $2}' | xargs -r apt-cache policy 2>/dev/null || " +
                "apt list --upgradable 2>/dev/null",
            ("linux", "yum") => "yum updateinfo list available 2>/dev/null && yum check-update 2>/dev/null",
            ("linux", "dnf") => "dnf updateinfo list available 2>/dev/null && dnf check-update 2>/dev/null",
            ("linux", "pacman") => "pacman -Qu 2>/dev/null",
            ("linux", "zypper") => "zypper list-updates --all 2>/dev/null",
            ("linux", _) when !string.IsNullOrEmpty(packageManager) => $"{packageManager} list --upgradable 2>/dev/null",

            // Windows
            ("windows", _) or ("windows", null) => "Get-WindowsUpdate | Select-Object Title,KB,KBNumber,Size | ConvertTo-Json",

            // macOS
            ("macos", _) or ("darwin", _) => "softwareupdate -l",

            _ => throw new PlatformNotSupportedException($"Unsupported OS type: {osType}")
        };
    }

    /// <summary>
    /// Builds a command to perform system updates.
    /// </summary>
    public static string BuildUpdateCommand(
        string osType,
        SystemUpdateOptions options,
        string? packageManager = null)
    {
        var includeSecurity = options.IncludeSecurityUpdates;
        var includeFeature = options.IncludeFeatureUpdates;
        var includeDriver = options.IncludeDriverUpdates;

        return (osType.ToLowerInvariant(), packageManager?.ToLowerInvariant()) switch
        {
            // Linux package managers
            ("linux", "apt") or ("linux", null) when IsAptAvailable() => BuildAptUpdateCommand(options),
            ("linux", "yum") => BuildYumUpdateCommand(options),
            ("linux", "dnf") => BuildDnfUpdateCommand(options),
            ("linux", "pacman") => BuildPacmanUpdateCommand(options),
            ("linux", "zypper") => BuildZypperUpdateCommand(options),
            ("linux", _) when !string.IsNullOrEmpty(packageManager) =>
                $"sudo {packageManager} upgrade -y 2>/dev/null",

            // Windows
            ("windows", _) or ("windows", null) => BuildWindowsUpdateCommand(options),

            // macOS
            ("macos", _) or ("darwin", _) => BuildMacosUpdateCommand(options),

            _ => throw new PlatformNotSupportedException($"Unsupported OS type: {osType}")
        };
    }

    /// <summary>
    /// Builds a command to capture current system state.
    /// </summary>
    public static string BuildGetStateCommand(string osType, string? packageManager = null)
    {
        return (osType.ToLowerInvariant(), packageManager?.ToLowerInvariant()) switch
        {
            // Linux
            ("linux", "apt") or ("linux", null) when IsAptAvailable() =>
                "echo '===OS===' && uname -a && " +
                "echo '===KERNEL===' && uname -r && " +
                "echo '===PACKAGES===' && dpkg -l 2>/dev/null | tail -n +6 | awk '{print $2 \"\\t\" $3}'",

            ("linux", "yum") or ("linux", "dnf") =>
                "echo '===OS===' && uname -a && " +
                "echo '===KERNEL===' && uname -r && " +
                "echo '===PACKAGES===' && rpm -qa 2>/dev/null | sort",

            ("linux", "pacman") =>
                "echo '===OS===' && uname -a && " +
                "echo '===KERNEL===' && uname -r && " +
                "echo '===PACKAGES===' && pacman -Q 2>/dev/null",

            ("linux", "zypper") =>
                "echo '===OS===' && uname -a && " +
                "echo '===KERNEL===' && uname -r && " +
                "echo '===PACKAGES===' && zypper search --installed-only 2>/dev/null | tail -n +4",

            ("linux", _) when !string.IsNullOrEmpty(packageManager) =>
                "echo '===OS===' && uname -a && echo '===KERNEL===' && uname -r",

            // Windows
            ("windows", _) or ("windows", null) =>
                "Write-Output '===OS==='; Get-ComputerInfo | Select-Object OsName,WindowsVersion,BiosSerialNumber | ConvertTo-Json; " +
                "Write-Output '===PACKAGES==='; Get-WmiObject -Class Win32_Product | Select-Object Name,Version | ConvertTo-Json",

            // macOS
            ("macos", _) or ("darwin", _) =>
                "echo '===OS===' && sw_vers && " +
                "echo '===KERNEL===' && uname -r && " +
                "echo '===PACKAGES===' && pkgutil --pkgs 2>/dev/null | while read pkg; do pkgutil --pkg-info \"$pkg\" 2>/dev/null | grep -E 'version:|pkgid:'; done",

            _ => throw new PlatformNotSupportedException($"Unsupported OS type: {osType}")
        };
    }

    /// <summary>
    /// Builds a command to check if a reboot is required.
    /// </summary>
    public static string BuildRebootCheckCommand(string osType, string? packageManager = null)
    {
        return (osType.ToLowerInvariant(), packageManager?.ToLowerInvariant()) switch
        {
            ("linux", "apt") or ("linux", null) when IsAptAvailable() =>
                "[ -f /var/run/reboot-required ] && echo 'REBOOT_REQUIRED' || echo 'NO_REBOOT'",

            ("linux", "yum") or ("linux", "dnf") =>
                "[ -f /var/run/reboot-requiredpkgs ] && echo 'REBOOT_REQUIRED' || echo 'NO_REBOOT'",

            ("linux", _) =>
                "[ -f /var/run/reboot-required ] && echo 'REBOOT_REQUIRED' || echo 'NO_REBOOT'",

            ("windows", _) or ("windows", null) =>
                "if (Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\PendingFileRenameOperations') { " +
                "Write-Output 'REBOOT_REQUIRED' } else { " +
                "$pending = Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending' -ErrorAction SilentlyContinue; " +
                "if ($pending) { Write-Output 'REBOOT_REQUIRED' } else { Write-Output 'NO_REBOOT' } }",

            ("macos", _) or ("darwin", _) =>
                "if [ -f /var/run/reboot-required ]; then echo 'REBOOT_REQUIRED'; else echo 'NO_REBOOT'; fi",

            _ => "echo 'NO_REBOOT'"
        };
    }

    /// <summary>
    /// Parses the output of a check command to extract available updates.
    /// </summary>
    public static List<SystemPackage> ParseUpdateList(string output, string osType)
    {
        var packages = new List<SystemPackage>();

        try
        {
            if (string.IsNullOrWhiteSpace(output))
            {
                return packages;
            }

            // Parse based on OS type
            var lines = output.Split('\n', '\r');
            foreach (var line in lines)
            {
                var trimmed = line.Trim();
                if (string.IsNullOrWhiteSpace(trimmed) || trimmed.StartsWith("Listing") || trimmed.StartsWith("Loading"))
                {
                    continue;
                }

                var pkg = osType.ToLowerInvariant() switch
                {
                    "linux" => ParseLinuxPackageLine(trimmed),
                    "windows" => ParseWindowsPackageLine(trimmed),
                    "macos" or "darwin" => ParseMacosPackageLine(trimmed),
                    _ => null
                };

                if (pkg != null)
                {
                    packages.Add(pkg);
                }
            }
        }
        catch
        {
            // If parsing fails, return empty list
        }

        return packages;
    }

    /// <summary>
    /// Parses system state output into a structured format.
    /// </summary>
    public static SystemState ParseSystemState(string output)
    {
        var state = new SystemState();

        if (string.IsNullOrWhiteSpace(output))
        {
            return state;
        }

        var sections = output.Split("===");
        foreach (var section in sections)
        {
            if (string.IsNullOrWhiteSpace(section))
            {
                continue;
            }

            var lines = section.Split('\n');
            var sectionName = lines.FirstOrDefault()?.Trim() ?? "";

            switch (sectionName.ToUpperInvariant())
            {
                case "OS":
                    state.OsVersion = string.Join(" ", lines.Skip(1)).Trim();
                    break;
                case "KERNEL":
                    state.KernelVersion = string.Join(" ", lines.Skip(1)).Trim();
                    break;
                case "PACKAGES":
                    state.InstalledPackages = ParsePackageList(lines.Skip(1).ToArray());
                    break;
            }
        }

        return state;
    }

    #region Platform-specific helpers

    private static string BuildAptUpdateCommand(SystemUpdateOptions options)
    {
        // First update the package lists, then perform the upgrade
        // Without apt-get update, apt-get upgrade will complete successfully but won't
        // install any updates if the package list cache is stale
        // Note: sudo is required since the SSH user is typically not root
        var cmd = "sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -o Dpkg::Options::='--force-confdef' -o Dpkg::Options::='--force-confold'";

        // apt doesn't easily separate security/feature updates without complex filtering
        // We include all updates when any category is selected
        return cmd;
    }

    private static string BuildYumUpdateCommand(SystemUpdateOptions options)
    {
        var cmd = "sudo yum update -y";

        if (options.IncludeSecurityUpdates && !options.IncludeFeatureUpdates)
        {
            cmd += " --security";
        }

        return cmd + " 2>/dev/null";
    }

    private static string BuildDnfUpdateCommand(SystemUpdateOptions options)
    {
        var cmd = "sudo dnf upgrade -y";

        if (options.IncludeSecurityUpdates && !options.IncludeFeatureUpdates)
        {
            cmd += " --security";
        }

        return cmd + " 2>/dev/null";
    }

    private static string BuildPacmanUpdateCommand(SystemUpdateOptions options)
    {
        // pacman upgrades all packages by default
        return "sudo pacman -Syu --noconfirm 2>/dev/null";
    }

    private static string BuildZypperUpdateCommand(SystemUpdateOptions options)
    {
        var cmd = "sudo zypper dup -y";

        if (options.IncludeSecurityUpdates && !options.IncludeFeatureUpdates)
        {
            cmd = "sudo zypper patch -y --type security";
        }

        return cmd + " 2>/dev/null";
    }

    private static string BuildWindowsCheckCommand()
    {
        return @"
if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) {
    Install-Module -Name PSWindowsUpdate -Force -Scope CurrentUser -Confirm:$false 2>$null
}
if (Get-Module -ListAvailable -Name PSWindowsUpdate) {
    Get-WindowsUpdate -AcceptAll -IgnoreReboot -AutoSelect | ConvertTo-Json
} else {
    Write-Output '[]'
}
";
    }

    private static string BuildWindowsUpdateCommand(SystemUpdateOptions options)
    {
        var cmd = @"
if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) {
    Install-Module -Name PSWindowsUpdate -Force -Scope CurrentUser -Confirm:$false 2>$null
}
if (Get-Module -ListAvailable -Name PSWindowsUpdate) {
    Get-WindowsUpdate -Install -AcceptAll -IgnoreReboot | ConvertTo-Json
} else {
    Write-Output '[]'
}
";
        return cmd;
    }

    private static string BuildMacosUpdateCommand(SystemUpdateOptions options)
    {
        var cmd = "softwareupdate --install --all";

        if (!options.IncludeFeatureUpdates)
        {
            // macOS doesn't easily separate security from feature updates
            // This is a limitation of the softwareupdate CLI
        }

        return cmd;
    }

    private static SystemPackage? ParseLinuxPackageLine(string line)
    {
        // Try apt format: package/stable version -> version
        var aptMatch = AptPackageRegex().Match(line);
        if (aptMatch.Success)
        {
            return new SystemPackage
            {
                Name = aptMatch.Groups[1].Value,
                Version = aptMatch.Groups[2].Value,
                NewVersion = aptMatch.Groups[3].Value,
                Type = "other"
            };
        }

        // Try yum/dnf format: package-version
        var yumMatch = YumPackageRegex().Match(line);
        if (yumMatch.Success)
        {
            return new SystemPackage
            {
                Name = yumMatch.Groups[1].Value,
                Version = yumMatch.Groups[2].Value,
                NewVersion = yumMatch.Groups[3].Value,
                Type = "other"
            };
        }

        // Try pacman format: package version -> new_version
        var pacmanMatch = PacmanPackageRegex().Match(line);
        if (pacmanMatch.Success)
        {
            return new SystemPackage
            {
                Name = pacmanMatch.Groups[1].Value,
                Version = pacmanMatch.Groups[2].Value,
                NewVersion = pacmanMatch.Groups[3].Value,
                Type = "other"
            };
        }

        return null;
    }

    private static SystemPackage? ParseWindowsPackageLine(string line)
    {
        try
        {
            // Try to parse as JSON
            var json = JsonDocument.Parse(line);
            if (json.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in json.RootElement.EnumerateArray())
                {
                    if (item.TryGetProperty("Title", out var title) &&
                        item.TryGetProperty("KB", out var kb))
                    {
                        return new SystemPackage
                        {
                            Name = title.GetString() ?? kb.GetString() ?? "",
                            Version = kb.GetString() ?? "",
                            Type = "feature"
                        };
                    }
                }
            }
        }
        catch
        {
            // Not JSON or invalid JSON, ignore
        }

        return null;
    }

    private static SystemPackage? ParseMacosPackageLine(string line)
    {
        // macOS format: *   Label123- Version (123 MB)
        var match = MacOSPackageRegex().Match(line);
        if (match.Success)
        {
            return new SystemPackage
            {
                Name = match.Groups[1].Value,
                Version = match.Groups[2].Value,
                Type = match.Groups[1].Value.Contains("Security", StringComparison.OrdinalIgnoreCase)
                    ? "security"
                    : "feature"
            };
        }

        return null;
    }

    private static Dictionary<string, string> ParsePackageList(string[] lines)
    {
        var packages = new Dictionary<string, string>();

        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (string.IsNullOrWhiteSpace(trimmed) || trimmed.StartsWith("==="))
            {
                continue;
            }

            var parts = trimmed.Split(['\t', ' ', '\t'], StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 2)
            {
                packages[parts[0]] = parts[1];
            }
        }

        return packages;
    }

    private static bool IsAptAvailable()
    {
        try
        {
            // This is a heuristic - in reality, we'd check the actual system
            return true; // Default to apt for Debian/Ubuntu systems
        }
        catch
        {
            return false;
        }
    }

    #endregion

    #region Generated Regex

    [GeneratedRegex(@"^(\S+)\/\S+\s+(\S+)\s+(\S+)", RegexOptions.Compiled)]
    private static partial Regex AptPackageRegex();

    [GeneratedRegex(@"^(\S+)\.(\S+)\s+(\S+)\s+\-\s+(\S+)", RegexOptions.Compiled)]
    private static partial Regex YumPackageRegex();

    [GeneratedRegex(@"^(\S+)\s+(\S+)\s+->\s+(\S+)", RegexOptions.Compiled)]
    private static partial Regex PacmanPackageRegex();

    [GeneratedRegex(@"\*\s+([^\s]+)\s+([^\s]+)\s+\(", RegexOptions.Compiled)]
    private static partial Regex MacOSPackageRegex();

    #endregion
}

#region Public Data Types

/// <summary>
/// Options for system updates.
/// </summary>
public sealed class SystemUpdateOptions
{
    public bool IncludeSecurityUpdates { get; set; } = true;
    public bool IncludeFeatureUpdates { get; set; } = true;
    public bool IncludeDriverUpdates { get; set; } = true;
}

/// <summary>
/// Represents a system package that can be updated.
/// </summary>
public sealed class SystemPackage
{
    public required string Name { get; set; }
    public required string Version { get; set; }
    public string? NewVersion { get; set; }
    public long Size { get; set; }
    public required string Type { get; set; } // "security", "feature", "driver", "other"
}

#endregion
