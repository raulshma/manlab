using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using ManLab.Server.Data;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services;

/// <summary>
/// Manages installation and uninstallation of the ManLab agent on the local (server) machine.
/// This enables monitoring the server itself without requiring SSH access.
/// </summary>
public sealed class LocalAgentInstallationService
{
    /// <summary>
    /// A sentinel GUID used to track local agent installation jobs.
    /// </summary>
    public static readonly Guid LocalMachineId = new("00000000-0000-0000-0000-000000000001");

    private const string TaskName = "ManLab Agent";
    private const string InstallDir = @"C:\ProgramData\ManLab\Agent";
    private static readonly TimeSpan ProcessTimeout = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan RegistrationTimeout = TimeSpan.FromMinutes(3);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<AgentHub> _hub;
    private readonly ILogger<LocalAgentInstallationService> _logger;
    private readonly IWebHostEnvironment _env;

    private readonly ConcurrentDictionary<Guid, Task> _running = new();

    public LocalAgentInstallationService(
        IServiceScopeFactory scopeFactory,
        IHubContext<AgentHub> hub,
        ILogger<LocalAgentInstallationService> logger,
        IWebHostEnvironment env)
    {
        _scopeFactory = scopeFactory;
        _hub = hub;
        _logger = logger;
        _env = env;
    }

    public bool IsRunning => _running.ContainsKey(LocalMachineId);

    /// <summary>
    /// Checks if the local agent is currently installed.
    /// </summary>
    public LocalAgentStatus GetStatus()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return new LocalAgentStatus(
                IsSupported: false,
                IsInstalled: false,
                IsRunning: false,
                LinkedNodeId: null,
                Status: "Not supported on this platform",
                CurrentOperation: null);
        }

        if (IsRunning)
        {
            return new LocalAgentStatus(
                IsSupported: true,
                IsInstalled: false,
                IsRunning: false,
                LinkedNodeId: null,
                Status: "Operation in progress",
                CurrentOperation: "Running");
        }

        try
        {
            var taskExists = CheckScheduledTaskExists();
            var binaryExists = File.Exists(Path.Combine(InstallDir, "manlab-agent.exe"));

            if (taskExists && binaryExists)
            {
                var isTaskRunning = CheckScheduledTaskRunning();
                // Try to find linked node
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<DataContext>();
                var node = db.Nodes
                    .Where(n => n.Hostname == Environment.MachineName)
                    .OrderByDescending(n => n.LastSeen)
                    .FirstOrDefault();

                return new LocalAgentStatus(
                    IsSupported: true,
                    IsInstalled: true,
                    IsRunning: isTaskRunning,
                    LinkedNodeId: node?.Id,
                    Status: isTaskRunning ? "Running" : "Installed (not running)",
                    CurrentOperation: null);
            }

            return new LocalAgentStatus(
                IsSupported: true,
                IsInstalled: false,
                IsRunning: false,
                LinkedNodeId: null,
                Status: "Not installed",
                CurrentOperation: null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to check local agent status");
            return new LocalAgentStatus(
                IsSupported: true,
                IsInstalled: false,
                IsRunning: false,
                LinkedNodeId: null,
                Status: $"Error: {ex.Message}",
                CurrentOperation: null);
        }
    }

    /// <summary>
    /// Starts local agent installation in the background.
    /// </summary>
    public bool TryStartInstall(string serverBaseUrl, bool force)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return false;
        }

        if (_running.ContainsKey(LocalMachineId))
        {
            return false;
        }

        var task = Task.Run(() => RunInstallAsync(serverBaseUrl, force));
        return _running.TryAdd(LocalMachineId, task);
    }

    /// <summary>
    /// Starts local agent uninstallation in the background.
    /// </summary>
    public bool TryStartUninstall()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return false;
        }

        if (_running.ContainsKey(LocalMachineId))
        {
            return false;
        }

        var task = Task.Run(() => RunUninstallAsync());
        return _running.TryAdd(LocalMachineId, task);
    }

    private async Task RunInstallAsync(string serverBaseUrl, bool force)
    {
        string? tokenHash = null;

        try
        {
            await PublishLogAsync("Starting local agent installation...");
            await PublishStatusAsync("Installing", null);

            // Check for administrator privileges
            if (!IsAdministrator())
            {
                var error = "Administrator privileges required. Please run the server as Administrator.";
                await PublishLogAsync($"ERROR: {error}");
                await PublishStatusAsync("Failed", error);
                return;
            }
            await PublishLogAsync("Administrator privileges confirmed.");

            // Idempotency check: if already installed, auto-enable force
            var taskExists = CheckScheduledTaskExists();
            var binaryExists = File.Exists(Path.Combine(InstallDir, "manlab-agent.exe"));
            if (!force && taskExists && binaryExists)
            {
                await PublishLogAsync("Existing installation detected; reinstalling in-place (idempotent run).");
                force = true;
            }

            using var scope = _scopeFactory.CreateScope();
            var tokenService = scope.ServiceProvider.GetRequiredService<EnrollmentTokenService>();
            var db = scope.ServiceProvider.GetRequiredService<DataContext>();

            // Generate enrollment token
            var (plainToken, tokenEntity) = await tokenService.CreateAsync(LocalMachineId);
            tokenHash = tokenEntity.TokenHash;
            await PublishLogAsync("Generated enrollment token.");

            // Locate install.ps1 script
            var scriptsPath = FindInstallScript();
            if (scriptsPath is null)
            {
                var error = "Install script not found. Searched rel and abs paths.";
                await PublishLogAsync($"ERROR: {error}");
                await PublishStatusAsync("Failed", error);
                return;
            }

            await PublishLogAsync($"Using install script: {scriptsPath}");

            // Build PowerShell arguments
            var serverUrl = serverBaseUrl.TrimEnd('/');
            var args = $"-NoProfile -ExecutionPolicy Bypass -File \"{scriptsPath}\" -Server \"{serverUrl}\" -AuthToken \"{plainToken}\"";
            if (force)
            {
                args += " -Force";
            }

            await PublishLogAsync($"Running: powershell.exe {args.Replace(plainToken, "***")}");

            // Run PowerShell with timeout
            var (exitCode, timedOut) = await RunPowerShellWithTimeoutAsync(args, scriptsPath);

            if (timedOut)
            {
                var error = $"Installation timed out after {ProcessTimeout.TotalMinutes} minutes.";
                await PublishLogAsync($"ERROR: {error}");
                await PublishStatusAsync("Failed", error);
                return;
            }

            if (exitCode != 0)
            {
                var error = $"Installation failed with exit code: {exitCode}";
                await PublishLogAsync(error);
                await PublishStatusAsync("Failed", error);
                return;
            }

            await PublishLogAsync("PowerShell installer completed. Waiting for agent to register...");

            // Wait for agent to register (like SSH installation does)
            var nodeId = await WaitForAgentRegistrationAsync(db, tokenHash);

            if (nodeId is null)
            {
                var error = $"Agent did not register within {RegistrationTimeout.TotalMinutes} minutes.";
                await PublishLogAsync($"WARNING: {error}");
                // Still mark as installed since the script succeeded
                await PublishLogAsync("Installation completed, but agent registration not confirmed.");
                await PublishStatusAsync("Installed", error);
                return;
            }

            await PublishLogAsync($"Agent registered successfully (nodeId={nodeId}).");
            await PublishStatusAsync("Installed", null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Local agent installation failed");
            await PublishLogAsync($"ERROR: {ex.Message}");
            await PublishStatusAsync("Failed", ex.Message);
        }
        finally
        {
            _running.TryRemove(LocalMachineId, out _);
        }
    }

    private async Task RunUninstallAsync()
    {
        try
        {
            await PublishLogAsync("Starting local agent uninstallation...");
            await PublishStatusAsync("Uninstalling", null);

            // Check for administrator privileges
            if (!IsAdministrator())
            {
                var error = "Administrator privileges required. Please run the server as Administrator.";
                await PublishLogAsync($"ERROR: {error}");
                await PublishStatusAsync("Failed", error);
                return;
            }
            await PublishLogAsync("Administrator privileges confirmed.");

            // Locate install.ps1 script
            var scriptsPath = FindInstallScript();
            if (scriptsPath is null)
            {
                var error = "Install script not found. Searched rel and abs paths.";
                await PublishLogAsync($"ERROR: {error}");
                await PublishStatusAsync("Failed", error);
                return;
            }

            await PublishLogAsync($"Using install script: {scriptsPath}");

            var args = $"-NoProfile -ExecutionPolicy Bypass -File \"{scriptsPath}\" -Uninstall";

            await PublishLogAsync($"Running: powershell.exe {args}");

            // Run PowerShell with timeout
            var (exitCode, timedOut) = await RunPowerShellWithTimeoutAsync(args, scriptsPath);

            if (timedOut)
            {
                var error = $"Uninstallation timed out after {ProcessTimeout.TotalMinutes} minutes.";
                await PublishLogAsync($"ERROR: {error}");
                await PublishStatusAsync("Failed", error);
                return;
            }

            if (exitCode == 0)
            {
                await PublishLogAsync("Uninstallation completed successfully.");
                await PublishStatusAsync("NotInstalled", null);
            }
            else
            {
                var error = $"Uninstallation failed with exit code: {exitCode}";
                await PublishLogAsync(error);
                await PublishStatusAsync("Failed", error);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Local agent uninstallation failed");
            await PublishLogAsync($"ERROR: {ex.Message}");
            await PublishStatusAsync("Failed", ex.Message);
        }
        finally
        {
            _running.TryRemove(LocalMachineId, out _);
        }
    }

    private string? FindInstallScript()
    {
        // Try relative path from content root (development)
        var scriptsPath = Path.Combine(_env.ContentRootPath, "..", "..", "scripts", "install.ps1");
        if (File.Exists(scriptsPath))
        {
            return Path.GetFullPath(scriptsPath);
        }

        // Try published deployment path
        scriptsPath = Path.Combine(_env.ContentRootPath, "scripts", "install.ps1");
        if (File.Exists(scriptsPath))
        {
            return Path.GetFullPath(scriptsPath);
        }

        return null;
    }

    private async Task<(int ExitCode, bool TimedOut)> RunPowerShellWithTimeoutAsync(string args, string scriptsPath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetDirectoryName(scriptsPath)!
        };

        using var process = new Process { StartInfo = psi };
        using var cts = new CancellationTokenSource(ProcessTimeout);

        process.OutputDataReceived += async (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                try { await PublishLogAsync(e.Data); } catch { /* ignore */ }
            }
        };

        process.ErrorDataReceived += async (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data))
            {
                try { await PublishLogAsync($"ERROR: {e.Data}"); } catch { /* ignore */ }
            }
        };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        try
        {
            await process.WaitForExitAsync(cts.Token);
            return (process.ExitCode, false);
        }
        catch (OperationCanceledException)
        {
            // Timeout: kill the process
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch
            {
                // Best effort
            }
            return (-1, true);
        }
    }

    private async Task<Guid?> WaitForAgentRegistrationAsync(DataContext db, string? tokenHash)
    {
        if (string.IsNullOrEmpty(tokenHash))
        {
            return null;
        }

        var deadline = DateTime.UtcNow.Add(RegistrationTimeout);
        Guid? nodeId = null;

        while (DateTime.UtcNow < deadline)
        {
            var node = await db.Nodes
                .Where(n => n.AuthKeyHash == tokenHash)
                .OrderByDescending(n => n.LastSeen)
                .FirstOrDefaultAsync();

            if (node is not null)
            {
                nodeId = node.Id;
                if (node.Status == NodeStatus.Online)
                {
                    return nodeId;
                }
            }

            await Task.Delay(TimeSpan.FromSeconds(3));
        }

        return nodeId;
    }

    private static bool IsAdministrator()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return false;
        }

        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    private static bool CheckScheduledTaskExists()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "schtasks.exe",
                Arguments = $"/Query /TN \"{TaskName}\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            process?.WaitForExit(5000);
            return process?.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private static bool CheckScheduledTaskRunning()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "schtasks.exe",
                Arguments = $"/Query /TN \"{TaskName}\" /FO CSV /V",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process is null) return false;

            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(5000);

            // Check if status column contains "Running"
            return output.Contains("Running", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private Task PublishLogAsync(string message)
    {
        return _hub.Clients.All.SendAsync("LocalAgentLog", LocalMachineId, DateTime.UtcNow, message);
    }

    private Task PublishStatusAsync(string status, string? error)
    {
        return _hub.Clients.All.SendAsync("LocalAgentStatusChanged", LocalMachineId, status, error);
    }
}

/// <summary>
/// Status of the local agent installation.
/// </summary>
public sealed record LocalAgentStatus(
    bool IsSupported,
    bool IsInstalled,
    bool IsRunning,
    Guid? LinkedNodeId,
    string Status,
    string? CurrentOperation);
