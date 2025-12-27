using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Principal;
using ManLab.Server.Data;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Security;
using Microsoft.Win32;
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

    private const string SystemTaskName = "ManLab Agent";
    private const string UserTaskName = "ManLab Agent User";
    private const string SystemInstallDir = @"C:\ProgramData\ManLab\Agent";
    private static readonly string UserInstallDir = 
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ManLab", "Agent");
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
        if (!OperatingSystem.IsWindows())
        {
            return new LocalAgentStatus(
                IsSupported: false,
                IsInstalled: false,
                IsRunning: false,
                LinkedNodeId: null,
                Status: "Not supported on this platform",
                CurrentOperation: null,
                InstallMode: null,
                HasSystemFiles: false,
                HasUserFiles: false,
                HasSystemTask: false,
                HasUserTask: false,
                OrphanedResources: null);
        }

        if (IsRunning)
        {
            return new LocalAgentStatus(
                IsSupported: true,
                IsInstalled: false,
                IsRunning: false,
                LinkedNodeId: null,
                Status: "Operation in progress",
                CurrentOperation: "Running",
                InstallMode: null,
                HasSystemFiles: false,
                HasUserFiles: false,
                HasSystemTask: false,
                HasUserTask: false,
                OrphanedResources: null);
        }

        try
        {
            // Check both install directories and corresponding tasks
            var systemBinaryExists = File.Exists(Path.Combine(SystemInstallDir, "manlab-agent.exe"));
            var userBinaryExists = File.Exists(Path.Combine(UserInstallDir, "manlab-agent.exe"));
            var systemTaskExists = CheckScheduledTaskExists(SystemTaskName);
            var userTaskExists = CheckScheduledTaskExists(UserTaskName);
            var userRunEntryExists = CheckUserRunEntryExists(UserTaskName);
            
            // Determine install mode (user mode takes precedence if both exist)
            string? installMode = null;
            bool isInstalled = false;
            string taskName = SystemTaskName;
            
            if (userBinaryExists && userTaskExists)
            {
                installMode = "User";
                isInstalled = true;
                taskName = UserTaskName;
            }
            else if (userBinaryExists && userRunEntryExists)
            {
                // User-mode fallback when Task Scheduler creation is blocked by policy.
                installMode = "User";
                isInstalled = true;
                taskName = UserTaskName;
            }
            else if (systemBinaryExists && systemTaskExists)
            {
                installMode = "System";
                isInstalled = true;
                taskName = SystemTaskName;
            }

            if (isInstalled)
            {
                var isTaskRunning = CheckScheduledTaskRunning(taskName);
                // If the user install is using HKCU Run (no scheduled task), fall back to
                // process inspection to infer running state.
                if (!userTaskExists && userBinaryExists && userRunEntryExists)
                {
                    try
                    {
                        isTaskRunning = Process.GetProcessesByName("manlab-agent").Length > 0;
                    }
                    catch
                    {
                        // best effort
                    }
                }
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
                    Status: isTaskRunning
                        ? $"Running ({installMode} mode)"
                        : (!userTaskExists && userBinaryExists && userRunEntryExists)
                            ? $"Installed ({installMode} mode via user autostart, not running)"
                            : $"Installed ({installMode} mode, not running)",
                    CurrentOperation: null,
                    InstallMode: installMode,
                    HasSystemFiles: systemBinaryExists,
                    HasUserFiles: userBinaryExists,
                    HasSystemTask: systemTaskExists,
                    HasUserTask: userTaskExists,
                    OrphanedResources: null);
            }

            // Check for leftover files even if not properly installed
            var hasSystemFiles = Directory.Exists(SystemInstallDir) && Directory.EnumerateFileSystemEntries(SystemInstallDir).Any();
            var hasUserFiles = Directory.Exists(UserInstallDir) && Directory.EnumerateFileSystemEntries(UserInstallDir).Any();
            
            // Check for orphaned tasks (task exists without proper installation)
            var hasSystemTask = systemTaskExists;
            var hasUserTask = userTaskExists;
            
            // Build detailed orphaned resources info
            var orphanedResources = GetOrphanedResourcesInfo(
                hasSystemFiles, hasUserFiles, hasSystemTask, hasUserTask);

            return new LocalAgentStatus(
                IsSupported: true,
                IsInstalled: false,
                IsRunning: false,
                LinkedNodeId: null,
                Status: "Not installed",
                CurrentOperation: null,
                InstallMode: null,
                HasSystemFiles: hasSystemFiles,
                HasUserFiles: hasUserFiles,
                HasSystemTask: hasSystemTask,
                HasUserTask: hasUserTask,
                OrphanedResources: orphanedResources);
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
                CurrentOperation: null,
                InstallMode: null,
                HasSystemFiles: false,
                HasUserFiles: false,
                HasSystemTask: false,
                HasUserTask: false,
                OrphanedResources: null);
        }
    }

    /// <summary>
    /// Starts local agent installation in the background.
    /// </summary>
    /// <param name="serverBaseUrl">Base URL of the ManLab server.</param>
    /// <param name="force">If true, reinstall even if already installed.</param>
    /// <param name="userMode">If true, install to user-local directory without admin privileges.</param>
    public bool TryStartInstall(string serverBaseUrl, bool force, bool userMode = false)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        if (_running.ContainsKey(LocalMachineId))
        {
            return false;
        }

        var task = Task.Run(() => RunInstallAsync(serverBaseUrl, force, userMode));
        return _running.TryAdd(LocalMachineId, task);
    }

    /// <summary>
    /// Starts local agent uninstallation in the background.
    /// </summary>
    /// <param name="userMode">If true, uninstall from user-local directory.</param>
    public bool TryStartUninstall(bool userMode = false)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        if (_running.ContainsKey(LocalMachineId))
        {
            return false;
        }

        var task = Task.Run(() => RunUninstallAsync(userMode));
        return _running.TryAdd(LocalMachineId, task);
    }

    /// <summary>
    /// Starts clearing leftover agent files in the background.
    /// </summary>
    /// <param name="clearSystem">If true, clear system install directory (requires admin).</param>
    /// <param name="clearUser">If true, clear user install directory.</param>
    public bool TryStartClearFiles(bool clearSystem, bool clearUser)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        if (_running.ContainsKey(LocalMachineId))
        {
            return false;
        }

        var task = Task.Run(() => RunClearFilesAsync(clearSystem, clearUser));
        return _running.TryAdd(LocalMachineId, task);
    }

    private async Task RunInstallAsync(string serverBaseUrl, bool force, bool userMode)
    {
        string? tokenHash = null;
        var installDir = userMode ? UserInstallDir : SystemInstallDir;

        try
        {
            var modeLabel = userMode ? "user" : "system";
            await PublishLogAsync($"Starting local agent installation ({modeLabel} mode)...");
            await PublishStatusAsync("Installing", null);

            // Check for administrator privileges (only required for system mode)
            if (!userMode && !IsAdministrator())
            {
                var error = "Administrator privileges required for system-wide installation. Use User mode to install without admin.";
                await PublishLogAsync($"ERROR: {error}");
                await PublishStatusAsync("Failed", error);
                return;
            }
            
            if (userMode)
            {
                await PublishLogAsync("User mode: installing to local app data (no admin required).");
            }
            else
            {
                await PublishLogAsync("Administrator privileges confirmed.");
            }

            // Idempotency check: if already installed or orphaned task exists, auto-enable force
            var taskName = userMode ? UserTaskName : SystemTaskName;
            var taskExists = CheckScheduledTaskExists(taskName);
            var binaryExists = File.Exists(Path.Combine(installDir, "manlab-agent.exe"));
            if (!force && taskExists)
            {
                if (binaryExists)
                {
                    await PublishLogAsync("Existing installation detected; reinstalling in-place (idempotent run).");
                }
                else
                {
                    await PublishLogAsync("Orphaned scheduled task detected; using force mode to recreate.");
                }
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
            // Always pass -Force for idempotent installation - the script handles non-existing tasks gracefully
            var serverUrl = serverBaseUrl.TrimEnd('/');
            var args = $"-NoProfile -ExecutionPolicy Bypass -File \"{scriptsPath}\" -Server \"{serverUrl}\" -AuthToken \"{plainToken}\" -Force";
            if (userMode)
            {
                args += " -UserMode";
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

    private async Task RunUninstallAsync(bool userMode)
    {
        Guid? linkedNodeId = null;
        
        try
        {
            var modeLabel = userMode ? "user" : "system";
            await PublishLogAsync($"Starting local agent uninstallation ({modeLabel} mode)...");
            await PublishStatusAsync("Uninstalling", null);

            // Check for administrator privileges (only required for system mode)
            if (!userMode && !IsAdministrator())
            {
                var error = "Administrator privileges required for system-wide uninstallation. Use User mode for user-local uninstall.";
                await PublishLogAsync($"ERROR: {error}");
                await PublishStatusAsync("Failed", error);
                return;
            }
            
            if (userMode)
            {
                await PublishLogAsync("User mode: uninstalling from local app data (no admin required).");
            }
            else
            {
                await PublishLogAsync("Administrator privileges confirmed.");
            }

            // Find the linked node before uninstalling (by machine name)
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<DataContext>();
            var linkedNode = await db.Nodes
                .Where(n => n.Hostname == Environment.MachineName)
                .OrderByDescending(n => n.LastSeen)
                .FirstOrDefaultAsync();
            
            if (linkedNode is not null)
            {
                linkedNodeId = linkedNode.Id;
                await PublishLogAsync($"Found linked node: {linkedNode.Hostname} (ID: {linkedNodeId})");
            }

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
            if (userMode)
            {
                args += " -UserMode";
            }

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
                
                // Delete the linked node from the database
                if (linkedNodeId.HasValue)
                {
                    await PublishLogAsync($"Removing node from database: {linkedNodeId}");
                    
                    try
                    {
                        var nodeToDelete = await db.Nodes
                            .Include(n => n.TelemetrySnapshots)
                            .Include(n => n.Commands)
                            .FirstOrDefaultAsync(n => n.Id == linkedNodeId.Value);
                        
                        if (nodeToDelete is not null)
                        {
                            db.Nodes.Remove(nodeToDelete);
                            await db.SaveChangesAsync();
                            await PublishLogAsync($"Node {nodeToDelete.Hostname} removed from database.");
                            
                            // Notify connected clients
                            await _hub.Clients.All.SendAsync("NodeDeleted", linkedNodeId.Value);
                        }
                    }
                    catch (Exception ex)
                    {
                        await PublishLogAsync($"WARNING: Failed to remove node from database: {ex.Message}");
                        // Don't fail the uninstall just because node deletion failed
                    }
                }
                
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

    private async Task RunClearFilesAsync(bool clearSystem, bool clearUser)
    {
        try
        {
            await PublishLogAsync("Starting cleanup of leftover agent files...");
            await PublishStatusAsync("Cleaning", null);

            // Check for administrator privileges if clearing system files
            if (clearSystem && !IsAdministrator())
            {
                var error = "Administrator privileges required to clear system files.";
                await PublishLogAsync($"ERROR: {error}");
                await PublishStatusAsync("Failed", error);
                return;
            }

            var clearedAny = false;

            if (clearSystem && Directory.Exists(SystemInstallDir))
            {
                await PublishLogAsync($"Clearing system directory: {SystemInstallDir}");
                try
                {
                    Directory.Delete(SystemInstallDir, recursive: true);
                    await PublishLogAsync("System directory cleared.");
                    clearedAny = true;
                }
                catch (Exception ex)
                {
                    await PublishLogAsync($"WARNING: Failed to clear system directory: {ex.Message}");
                }
            }

            if (clearUser && Directory.Exists(UserInstallDir))
            {
                await PublishLogAsync($"Clearing user directory: {UserInstallDir}");
                try
                {
                    Directory.Delete(UserInstallDir, recursive: true);
                    await PublishLogAsync("User directory cleared.");
                    clearedAny = true;
                }
                catch (Exception ex)
                {
                    await PublishLogAsync($"WARNING: Failed to clear user directory: {ex.Message}");
                }
            }

            if (!clearedAny)
            {
                await PublishLogAsync("No directories found to clear.");
            }

            await PublishLogAsync("Cleanup completed.");
            await PublishStatusAsync("NotInstalled", null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to clear agent files");
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
        if (!OperatingSystem.IsWindows())
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

    private static bool CheckScheduledTaskExists(string taskName)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        return TryGetRegisteredTaskSnapshot(taskName, out _, out _, out _);
    }

    [SupportedOSPlatform("windows")]
    private static bool CheckUserRunEntryExists(string name)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        try
        {
            // HKCU\Software\Microsoft\Windows\CurrentVersion\Run
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", writable: false);
            if (key is null) return false;
            var value = key.GetValue(name) as string;
            return !string.IsNullOrWhiteSpace(value);
        }
        catch
        {
            return false;
        }
    }

    private static bool CheckScheduledTaskRunning(string taskName)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        if (!TryGetRegisteredTaskSnapshot(taskName, out var state, out _, out _))
        {
            return false;
        }

        return state == WindowsTaskState.Running;
    }

    private Task PublishLogAsync(string message)
    {
        return _hub.Clients.All.SendAsync("LocalAgentLog", LocalMachineId, DateTime.UtcNow, message);
    }

    private Task PublishStatusAsync(string status, string? error)
    {
        return _hub.Clients.All.SendAsync("LocalAgentStatusChanged", LocalMachineId, status, error);
    }

    private static OrphanedResourcesInfo? GetOrphanedResourcesInfo(
        bool hasSystemFiles, bool hasUserFiles, bool hasSystemTask, bool hasUserTask)
    {
        if (!hasSystemFiles && !hasUserFiles && !hasSystemTask && !hasUserTask)
        {
            return null;
        }

        return new OrphanedResourcesInfo(
            SystemDirectory: hasSystemFiles ? GetDirectoryInfo(SystemInstallDir) : null,
            UserDirectory: hasUserFiles ? GetDirectoryInfo(UserInstallDir) : null,
            SystemTask: hasSystemTask ? GetTaskInfo(SystemTaskName) : null,
            UserTask: hasUserTask ? GetTaskInfo(UserTaskName) : null);
    }

    private static FileDirectoryInfo? GetDirectoryInfo(string path)
    {
        try
        {
            if (!Directory.Exists(path))
            {
                return null;
            }

            var files = Directory.GetFiles(path, "*", SearchOption.AllDirectories);
            var totalSize = files.Sum(f => new FileInfo(f).Length);
            
            // Get relative file names, limited to 20 files
            var fileNames = files
                .Select(f => Path.GetRelativePath(path, f))
                .Take(20)
                .ToArray();

            return new FileDirectoryInfo(
                Path: path,
                TotalSizeBytes: totalSize,
                FileCount: files.Length,
                Files: fileNames);
        }
        catch
        {
            return null;
        }
    }

    private static TaskInfo? GetTaskInfo(string taskName)
    {
        if (!OperatingSystem.IsWindows())
        {
            return null;
        }

        if (!TryGetRegisteredTaskSnapshot(taskName, out var state, out var lastRunTime, out var nextRunTime))
        {
            return null;
        }

        var stateStr = state switch
        {
            WindowsTaskState.Unknown => "Unknown",
            WindowsTaskState.Disabled => "Disabled",
            WindowsTaskState.Queued => "Queued",
            WindowsTaskState.Ready => "Ready",
            WindowsTaskState.Running => "Running",
            _ => "Unknown"
        };

        return new TaskInfo(
            Name: taskName,
            State: stateStr,
            LastRunTime: lastRunTime?.ToString("o"),
            NextRunTime: nextRunTime?.ToString("o"));
    }

    private enum WindowsTaskState
    {
        Unknown = 0,
        Disabled = 1,
        Queued = 2,
        Ready = 3,
        Running = 4
    }

    /// <summary>
    /// Uses the native Task Scheduler COM automation entry point (Schedule.Service)
    /// to retrieve lightweight information about a task by name from the root folder.
    ///
    /// References:
    /// - Task Scheduler start page: https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page
    /// - Enumerating task info: https://learn.microsoft.com/en-us/windows/win32/taskschd/enumerating-tasks-and-displaying-task-information
    /// </summary>
    [SupportedOSPlatform("windows")]
    private static bool TryGetRegisteredTaskSnapshot(
        string taskName,
        out WindowsTaskState state,
        out DateTime? lastRunTime,
        out DateTime? nextRunTime)
    {
        state = WindowsTaskState.Unknown;
        lastRunTime = null;
        nextRunTime = null;

        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return false;
        }

        object? service = null;
        object? rootFolder = null;
        object? task = null;

        try
        {
            var serviceType = Type.GetTypeFromProgID("Schedule.Service");
            if (serviceType is null) return false;

            service = Activator.CreateInstance(serviceType);
            if (service is null) return false;

            dynamic svc = service;
            svc.Connect();

            rootFolder = svc.GetFolder("\\");
            dynamic folder = rootFolder;

            try
            {
                task = folder.GetTask(taskName);
            }
            catch (COMException ex) when ((uint)ex.HResult == 0x80070002)
            {
                // HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)
                return false;
            }

            dynamic t = task;

            try
            {
                var stateValue = (int)t.State;
                state = Enum.IsDefined(typeof(WindowsTaskState), stateValue)
                    ? (WindowsTaskState)stateValue
                    : WindowsTaskState.Unknown;
            }
            catch
            {
                state = WindowsTaskState.Unknown;
            }

            try
            {
                if (t.LastRunTime is DateTime dt && dt.Year > 1900)
                {
                    lastRunTime = dt;
                }
            }
            catch { }

            try
            {
                if (t.NextRunTime is DateTime dt && dt.Year > 1900)
                {
                    nextRunTime = dt;
                }
            }
            catch { }

            return true;
        }
        catch
        {
            // best-effort
            return false;
        }
        finally
        {
            ReleaseComObject(task);
            ReleaseComObject(rootFolder);
            ReleaseComObject(service);
        }
    }

    [SupportedOSPlatform("windows")]
    private static void ReleaseComObject(object? com)
    {
        if (!OperatingSystem.IsWindows()) return;
        if (com is null) return;

        try
        {
            if (Marshal.IsComObject(com))
            {
                Marshal.FinalReleaseComObject(com);
            }
        }
        catch
        {
            // ignore
        }
    }

    private static string[] ParseCsvLine(string line)
    {
        var result = new List<string>();
        var inQuotes = false;
        var current = new System.Text.StringBuilder();

        foreach (var c in line)
        {
            if (c == '"')
            {
                inQuotes = !inQuotes;
            }
            else if (c == ',' && !inQuotes)
            {
                result.Add(current.ToString().Trim());
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }
        result.Add(current.ToString().Trim());
        return result.ToArray();
    }
}

/// <summary>
/// Status of the local agent installation.
/// </summary>
/// <param name="IsSupported">Whether local agent is supported on this platform.</param>
/// <param name="IsInstalled">Whether the agent is currently installed.</param>
/// <param name="IsRunning">Whether the agent task is currently running.</param>
/// <param name="LinkedNodeId">The node ID if the agent has registered.</param>
/// <param name="Status">Human-readable status message.</param>
/// <param name="CurrentOperation">Current operation in progress, if any.</param>
/// <param name="InstallMode">Installation mode: "System" for admin install, "User" for user-local, null if not installed.</param>
public sealed record LocalAgentStatus(
    bool IsSupported,
    bool IsInstalled,
    bool IsRunning,
    Guid? LinkedNodeId,
    string Status,
    string? CurrentOperation,
    string? InstallMode,
    bool HasSystemFiles,
    bool HasUserFiles,
    bool HasSystemTask,
    bool HasUserTask,
    OrphanedResourcesInfo? OrphanedResources);

/// <summary>
/// Detailed information about orphaned agent resources.
/// </summary>
public sealed record OrphanedResourcesInfo(
    FileDirectoryInfo? SystemDirectory,
    FileDirectoryInfo? UserDirectory,
    TaskInfo? SystemTask,
    TaskInfo? UserTask);

/// <summary>
/// Information about a file directory.
/// </summary>
public sealed record FileDirectoryInfo(
    string Path,
    long TotalSizeBytes,
    int FileCount,
    string[] Files);

/// <summary>
/// Information about a scheduled task.
/// </summary>
public sealed record TaskInfo(
    string Name,
    string State,
    string? LastRunTime,
    string? NextRunTime);
