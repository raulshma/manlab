using Microsoft.Extensions.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace ManLab.Agent.Commands;

/// <summary>
/// Executes OS-level system updates with stdout/stderr streaming.
/// </summary>
public class UpdateExecutor
{
    private readonly ILogger<UpdateExecutor> _logger;
    private readonly Func<string, string?, Task> _statusCallback;

    /// <summary>
    /// Creates a new UpdateExecutor.
    /// </summary>
    /// <param name="logger">Logger instance.</param>
    /// <param name="statusCallback">Callback to stream status updates (status, logs).</param>
    public UpdateExecutor(ILogger<UpdateExecutor> logger, Func<string, string?, Task> statusCallback)
    {
        _logger = logger;
        _statusCallback = statusCallback;
    }

    /// <summary>
    /// Executes the system update for the current OS/distro.
    /// </summary>
    public async Task<(bool Success, string Output)> ExecuteUpdateAsync(CancellationToken cancellationToken = default)
    {
        var (command, args) = GetUpdateCommand();
        
        if (string.IsNullOrEmpty(command))
        {
            var errorMsg = "Unsupported operating system for updates";
            _logger.LogError(errorMsg);
            await _statusCallback("Failed", errorMsg);
            return (false, errorMsg);
        }

        _logger.LogInformation("Executing update: {Command} {Args}", command, args);
        await _statusCallback("InProgress", $"Starting update: {command} {args}");

        var output = new StringBuilder();
        
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = command,
                    Arguments = args,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            process.OutputDataReceived += async (sender, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    output.AppendLine(e.Data);
                    _logger.LogDebug("[stdout] {Line}", e.Data);
                    
                    // Stream output every few lines to avoid overwhelming the hub
                    if (output.Length % 500 < 100)
                    {
                        await _statusCallback("InProgress", e.Data);
                    }
                }
            };

            process.ErrorDataReceived += async (sender, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    output.AppendLine($"[ERROR] {e.Data}");
                    _logger.LogWarning("[stderr] {Line}", e.Data);
                    await _statusCallback("InProgress", $"[ERROR] {e.Data}");
                }
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            await process.WaitForExitAsync(cancellationToken);

            var success = process.ExitCode == 0;
            var status = success ? "Success" : "Failed";
            var finalOutput = output.ToString();

            _logger.LogInformation("Update completed with exit code: {ExitCode}", process.ExitCode);
            await _statusCallback(status, $"Exit code: {process.ExitCode}\n{finalOutput}");

            return (success, finalOutput);
        }
        catch (OperationCanceledException)
        {
            var msg = "Update operation was cancelled";
            _logger.LogWarning(msg);
            await _statusCallback("Failed", msg);
            return (false, msg);
        }
        catch (Exception ex)
        {
            var msg = $"Update failed: {ex.Message}";
            _logger.LogError(ex, "Update execution failed");
            await _statusCallback("Failed", msg);
            return (false, msg);
        }
    }

    private (string Command, string Args) GetUpdateCommand()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return ("winget", "upgrade --all --accept-package-agreements --accept-source-agreements --silent");
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            var distro = GetLinuxDistro();
            
            return distro.ToLowerInvariant() switch
            {
                "debian" or "ubuntu" or "linuxmint" or "pop" => 
                    ("/bin/bash", "-c \"sudo apt-get update && sudo apt-get upgrade -y\""),
                "fedora" or "rhel" or "centos" or "rocky" or "almalinux" => 
                    ("/bin/bash", "-c \"sudo dnf upgrade -y\""),
                "arch" or "manjaro" => 
                    ("/bin/bash", "-c \"sudo pacman -Syu --noconfirm\""),
                "opensuse" or "sles" => 
                    ("/bin/bash", "-c \"sudo zypper update -y\""),
                _ => ("/bin/bash", "-c \"sudo apt-get update && sudo apt-get upgrade -y\"") // Default to apt
            };
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            return ("/bin/bash", "-c \"brew update && brew upgrade\"");
        }

        return (string.Empty, string.Empty);
    }

    private static string GetLinuxDistro()
    {
        try
        {
            if (File.Exists("/etc/os-release"))
            {
                var lines = File.ReadAllLines("/etc/os-release");
                foreach (var line in lines)
                {
                    if (line.StartsWith("ID=", StringComparison.OrdinalIgnoreCase))
                    {
                        return line[3..].Trim('"', '\'');
                    }
                }
            }
        }
        catch
        {
            // Ignore errors reading os-release
        }

        return "unknown";
    }
}
