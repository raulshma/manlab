using System.Collections.Concurrent;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Security;
using ManLab.Server.Services.Ssh;
using ManLab.Shared;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Services;

public sealed class OnboardingJobRunner
{
    private readonly ConcurrentDictionary<Guid, Task> _running = new();

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<AgentHub> _hub;
    private readonly ILogger<OnboardingJobRunner> _logger;
    private readonly IAuditLog _auditLog;

    public OnboardingJobRunner(IServiceScopeFactory scopeFactory, IHubContext<AgentHub> hub, ILogger<OnboardingJobRunner> logger, IAuditLog auditLog)
    {
        _scopeFactory = scopeFactory;
        _hub = hub;
        _logger = logger;
        _auditLog = auditLog;
    }

    public bool IsRunning(Guid machineId) => _running.ContainsKey(machineId);

    public bool TryStartInstall(Guid machineId, InstallRequest request)
    {
        if (_running.ContainsKey(machineId))
        {
            return false;
        }

        var task = Task.Run(() => RunInstallAsync(machineId, request));
        return _running.TryAdd(machineId, task);
    }

    public bool TryStartUninstall(Guid machineId, UninstallRequest request)
    {
        if (_running.ContainsKey(machineId))
        {
            return false;
        }

        var task = Task.Run(() => RunUninstallAsync(machineId, request));
        return _running.TryAdd(machineId, task);
    }

    public sealed record InstallRequest(
        string ServerBaseUrl,
        bool Force,
        SshProvisioningService.AuthOptions Auth,
        string? SudoPassword,
        bool RunAsRoot,
        SshProvisioningService.AgentInstallOptions? AgentInstall,
        Guid? TargetNodeId,
        bool TrustOnFirstUse,
        string? ExpectedHostKeyFingerprint,
        string? Actor,
        string? ActorIp,
        string RateLimitKey);

    public sealed record UninstallRequest(
        string ServerBaseUrl,
        SshProvisioningService.AuthOptions Auth,
        string? SudoPassword,
        bool TrustOnFirstUse,
        string? ExpectedHostKeyFingerprint,
        string? Actor,
        string? ActorIp,
        string RateLimitKey);

    private async Task RunInstallAsync(Guid machineId, InstallRequest request)
    {
        try
        {
            void TryEmitUpdateCompleted(bool success, string message, string? error)
            {
                if (request.TargetNodeId is not Guid targetNodeId)
                {
                    return;
                }

                _auditLog.TryEnqueue(new AuditEvent
                {
                    Kind = "activity",
                    EventName = "agent.update.completed",
                    Category = "agents",
                    Source = "system",
                    ActorType = "dashboard",
                    ActorName = request.Actor,
                    ActorIp = request.ActorIp,
                    NodeId = targetNodeId,
                    MachineId = machineId,
                    Success = success,
                    Message = message,
                    Error = error,
                    DataJson = JsonSerializer.Serialize(new
                    {
                        agentSource = request.AgentInstall?.Source,
                        agentChannel = request.AgentInstall?.Channel,
                        agentVersion = request.AgentInstall?.Version
                    })
                });
            }

            await PublishStatusAsync(machineId, OnboardingStatus.Running, null);
            await PublishLogAsync(machineId, "Starting onboarding job...");

            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<DataContext>();
            var tokenService = scope.ServiceProvider.GetRequiredService<EnrollmentTokenService>();
            var ssh = scope.ServiceProvider.GetRequiredService<SshProvisioningService>();
            var audit = scope.ServiceProvider.GetRequiredService<ManLab.Server.Services.Ssh.SshAuditService>();
            var rateLimit = scope.ServiceProvider.GetRequiredService<ManLab.Server.Services.Ssh.SshRateLimitService>();

            var machine = await db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == machineId);
            if (machine is null)
            {
                await PublishStatusAsync(machineId, OnboardingStatus.Failed, "Machine not found.");
                TryEmitUpdateCompleted(false, "Agent update failed", "Machine not found");
                return;
            }

            machine.Status = OnboardingStatus.Running;
            machine.LastError = null;
            machine.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            if (!ServerBaseUrl.TryNormalizeInstallerOrigin(request.ServerBaseUrl, out var serverUri, out var serverUrlError, out var changed)
                || serverUri is null)
            {
                await FailAsync(db, machine, serverUrlError ?? "Invalid serverBaseUrl (must be an absolute URL).", machineId);
                TryEmitUpdateCompleted(false, "Agent update failed", serverUrlError ?? "Invalid serverBaseUrl (must be an absolute URL).");
                rateLimit.RecordFailure(request.RateLimitKey);
                await audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = request.Actor,
                    ActorIp = request.ActorIp,
                    Action = "ssh.install.result",
                    MachineId = machineId,
                    Host = machine.Host,
                    Port = machine.Port,
                    Username = machine.Username,
                    HostKeyFingerprint = machine.HostKeyFingerprint,
                    Success = false,
                    Error = "Invalid serverBaseUrl"
                });
                return;
            }

            if (changed)
            {
                await PublishLogAsync(
                    machineId,
                    $"Note: Normalized serverBaseUrl from '{request.ServerBaseUrl}' to '{serverUri}' (installer expects an origin, not a path)."
                );
            }

            // For SSH onboarding, the serverBaseUrl must be reachable FROM the target device.
            // Common misconfiguration: using http://localhost:xxxx which points to the target itself.
            if (serverUri.IsLoopback
                || string.Equals(serverUri.Host, "localhost", StringComparison.OrdinalIgnoreCase)
                || string.Equals(serverUri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase)
                || string.Equals(serverUri.Host, "::1", StringComparison.OrdinalIgnoreCase)
                || string.Equals(serverUri.Host, "0.0.0.0", StringComparison.OrdinalIgnoreCase)
                || string.Equals(serverUri.Host, "::", StringComparison.OrdinalIgnoreCase))
            {
                var msg =
                    $"Invalid serverBaseUrl for remote install: '{serverUri}'. " +
                    "The Raspberry Pi must be able to reach the ManLab server at that address. " +
                    "Do not use localhost/127.0.0.1/0.0.0.0; use a LAN IP or DNS name (e.g. http://192.168.x.y:5247). " +
                    "Also ensure the value is an origin (no /api, no /hubs/agent).";

                await PublishLogAsync(machineId, "ERROR: " + msg);
                await FailAsync(db, machine, msg, machineId);
                TryEmitUpdateCompleted(false, "Agent update failed", msg);
                rateLimit.RecordFailure(request.RateLimitKey);
                await audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = request.Actor,
                    ActorIp = request.ActorIp,
                    Action = "ssh.install.result",
                    MachineId = machineId,
                    Host = machine.Host,
                    Port = machine.Port,
                    Username = machine.Username,
                    HostKeyFingerprint = machine.HostKeyFingerprint,
                    Success = false,
                    Error = "Invalid serverBaseUrl for remote install"
                });
                return;
            }

            // If a target node is specified, we treat this as an update-in-place.
            // IMPORTANT: do NOT mint a new token in update mode; doing so would create a new node identity.
            var updateMode = request.TargetNodeId.HasValue;
            string enrollmentToken;
            string? tokenHash = null;

            if (updateMode)
            {
                var targetNodeId = request.TargetNodeId!.Value;
                var existingNode = await db.Nodes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == targetNodeId);
                if (existingNode is null)
                {
                    await FailAsync(db, machine, $"Target node not found: {targetNodeId}", machineId);
                    TryEmitUpdateCompleted(false, "Agent update failed", "Target node not found");
                    rateLimit.RecordFailure(request.RateLimitKey);
                    await audit.RecordAsync(new Data.Entities.SshAuditEvent
                    {
                        TimestampUtc = DateTime.UtcNow,
                        Actor = request.Actor,
                        ActorIp = request.ActorIp,
                        Action = "ssh.install.result",
                        MachineId = machineId,
                        Host = machine.Host,
                        Port = machine.Port,
                        Username = machine.Username,
                        HostKeyFingerprint = machine.HostKeyFingerprint,
                        Success = false,
                        Error = "Target node not found"
                    });
                    return;
                }

                // Keep link stable.
                if (machine.LinkedNodeId.HasValue && machine.LinkedNodeId.Value != targetNodeId)
                {
                    await FailAsync(db, machine, "This onboarding machine is linked to a different node; refusing to update to avoid creating/overwriting identities.", machineId);
                    TryEmitUpdateCompleted(false, "Agent update failed", "Onboarding machine linked to a different node");
                    rateLimit.RecordFailure(request.RateLimitKey);
                    return;
                }

                machine.LinkedNodeId = targetNodeId;
                machine.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();

                await PublishLogAsync(machineId, $"Update mode: will update existing node {targetNodeId} and preserve node identity.");

                // In update mode we reuse the existing agent token on the target.
                // SshProvisioningService will attempt to read it from the target if this is empty.
                enrollmentToken = string.Empty;
            }
            else
            {
                // Create an enrollment token (plain + hashed in DB)
                var (plainToken, tokenEntity) = await tokenService.CreateAsync(machineId);
                enrollmentToken = plainToken;
                tokenHash = tokenEntity.TokenHash;
                await PublishLogAsync(machineId, "Generated enrollment token.");
            }

            var expectedFingerprint = machine.HostKeyFingerprint ?? request.ExpectedHostKeyFingerprint;

            var connOptions = new SshProvisioningService.ConnectionOptions(
                Host: machine.Host,
                Port: machine.Port,
                Username: machine.Username,
                Auth: request.Auth,
                ExpectedHostKeyFingerprint: expectedFingerprint,
                TrustOnFirstUse: request.TrustOnFirstUse,
                SudoPassword: request.SudoPassword);

            var progress = new Progress<string>(msg => _ = PublishLogAsync(machineId, msg));

            var (success, fingerprint, requiresTrust, logs) = await ssh.InstallAgentAsync(
                connOptions,
                serverUri,
                enrollmentToken,
                request.Force,
                request.RunAsRoot,
                request.AgentInstall,
                progress,
                CancellationToken.None);

            if (requiresTrust)
            {
                // Persist fingerprint for approval workflow.
                machine.HostKeyFingerprint ??= fingerprint;
                machine.Status = OnboardingStatus.Failed;
                machine.LastError = "SSH host key not trusted. Confirm fingerprint and retry.";
                machine.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();

                // Not counted as a failure for lockout purposes (this is a safety gate, not a brute force signal).
                await audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = request.Actor,
                    ActorIp = request.ActorIp,
                    Action = "ssh.install.result",
                    MachineId = machineId,
                    Host = machine.Host,
                    Port = machine.Port,
                    Username = machine.Username,
                    HostKeyFingerprint = fingerprint,
                    Success = false,
                    Error = "SSH host key not trusted"
                });

                TryEmitUpdateCompleted(false, "Agent update failed", "SSH host key not trusted");

                await PublishLogAsync(machineId, $"Host key fingerprint: {fingerprint}");
                await PublishStatusAsync(machineId, OnboardingStatus.Failed, machine.LastError);
                return;
            }

            if (!string.IsNullOrWhiteSpace(fingerprint) && string.IsNullOrWhiteSpace(machine.HostKeyFingerprint))
            {
                machine.HostKeyFingerprint = fingerprint;
                machine.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }

            await PublishLogAsync(machineId, "Remote installer completed. Waiting for agent to register...");

            var deadline = DateTime.UtcNow.AddMinutes(3);
            Guid? nodeId = null;

            // If a specific node is targeted, wait for that node to come online and (best-effort) report the selected version.
            if (updateMode)
            {
                var targetNodeId = request.TargetNodeId!.Value;
                nodeId = targetNodeId;

                var expectedVersion = NormalizeExpectedAgentVersion(request.AgentInstall);
                if (!string.IsNullOrWhiteSpace(expectedVersion))
                {
                    await PublishLogAsync(machineId, $"Waiting for node to report agentVersion='{expectedVersion}'...");
                }

                while (DateTime.UtcNow < deadline)
                {
                    var node = await db.Nodes
                        .AsNoTracking()
                        .FirstOrDefaultAsync(n => n.Id == targetNodeId);

                    if (node is not null && node.Status == NodeStatus.Online)
                    {
                        if (string.IsNullOrWhiteSpace(expectedVersion) || string.Equals(NormalizeVersionString(node.AgentVersion), expectedVersion, StringComparison.OrdinalIgnoreCase))
                        {
                            break;
                        }
                    }

                    await Task.Delay(TimeSpan.FromSeconds(3));
                }
            }
            else
            {
                // Wait for agent to show up (node with matching token hash and Online status)
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
                            break;
                        }
                    }

                    await Task.Delay(TimeSpan.FromSeconds(3));
                }
            }

            if (nodeId is null)
            {
                await PublishLogAsync(machineId, "Agent did not register within timeout. Collecting diagnostics from target...");
                try
                {
                    var diagnostics = await ssh.CollectAgentDiagnosticsAsync(connOptions, serverUri, CancellationToken.None);
                    if (!string.IsNullOrWhiteSpace(diagnostics))
                    {
                        await PublishLogAsync(machineId, diagnostics);
                    }
                }
                catch (Exception ex)
                {
                    await PublishLogAsync(machineId, "WARNING: Failed to collect target diagnostics: " + ex.Message);
                }

                await FailAsync(db, machine, "Install ran, but agent did not register within the timeout.", machineId);
                TryEmitUpdateCompleted(false, "Agent update failed", "Agent did not register within timeout");
                rateLimit.RecordSuccess(request.RateLimitKey);
                await audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = request.Actor,
                    ActorIp = request.ActorIp,
                    Action = "ssh.install.result",
                    MachineId = machineId,
                    Host = machine.Host,
                    Port = machine.Port,
                    Username = machine.Username,
                    HostKeyFingerprint = fingerprint,
                    Success = false,
                    Error = "Agent did not register within timeout"
                });
                return;
            }

            // In update mode, keep the existing node link stable.
            machine.LinkedNodeId = nodeId;
            machine.Status = OnboardingStatus.Succeeded;
            machine.LastError = null;
            machine.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            await PublishLogAsync(machineId, $"Agent registered successfully (nodeId={nodeId}).");
            await PublishStatusAsync(machineId, OnboardingStatus.Succeeded, null);

            if (updateMode)
            {
                // Best-effort: capture the reported version at completion.
                var node = await db.Nodes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == nodeId.Value);
                _auditLog.TryEnqueue(new AuditEvent
                {
                    Kind = "activity",
                    EventName = "agent.update.completed",
                    Category = "agents",
                    Source = "system",
                    ActorType = "dashboard",
                    ActorName = request.Actor,
                    ActorIp = request.ActorIp,
                    NodeId = nodeId,
                    MachineId = machineId,
                    Success = true,
                    Message = "Agent update completed",
                    DataJson = JsonSerializer.Serialize(new
                    {
                        agentSource = request.AgentInstall?.Source,
                        agentChannel = request.AgentInstall?.Channel,
                        agentVersion = request.AgentInstall?.Version,
                        reportedAgentVersion = node?.AgentVersion
                    })
                });
            }

            rateLimit.RecordSuccess(request.RateLimitKey);
            await audit.RecordAsync(new Data.Entities.SshAuditEvent
            {
                TimestampUtc = DateTime.UtcNow,
                Actor = request.Actor,
                ActorIp = request.ActorIp,
                Action = "ssh.install.result",
                MachineId = machineId,
                Host = machine.Host,
                Port = machine.Port,
                Username = machine.Username,
                HostKeyFingerprint = fingerprint,
                Success = true,
                Error = null
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Onboarding job failed for machine {MachineId}", machineId);

            // Best-effort durable completion record for update mode.
            if (request.TargetNodeId is Guid targetNodeId)
            {
                _auditLog.TryEnqueue(new AuditEvent
                {
                    Kind = "activity",
                    EventName = "agent.update.completed",
                    Category = "agents",
                    Source = "system",
                    ActorType = "dashboard",
                    ActorName = request.Actor,
                    ActorIp = request.ActorIp,
                    NodeId = targetNodeId,
                    MachineId = machineId,
                    Success = false,
                    Message = "Agent update failed",
                    Error = ex.Message,
                    DataJson = JsonSerializer.Serialize(new
                    {
                        agentSource = request.AgentInstall?.Source,
                        agentChannel = request.AgentInstall?.Channel,
                        agentVersion = request.AgentInstall?.Version
                    })
                });
            }

            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<DataContext>();
            var machine = await db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == machineId);
            if (machine is not null)
            {
                machine.Status = OnboardingStatus.Failed;
                machine.LastError = ex.Message;
                machine.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }

            try
            {
                var audit = scope.ServiceProvider.GetRequiredService<ManLab.Server.Services.Ssh.SshAuditService>();
                var rateLimit = scope.ServiceProvider.GetRequiredService<ManLab.Server.Services.Ssh.SshRateLimitService>();

                rateLimit.RecordFailure(request.RateLimitKey);

                await audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = request.Actor,
                    ActorIp = request.ActorIp,
                    Action = "ssh.install.result",
                    MachineId = machineId,
                    Host = machine?.Host,
                    Port = machine?.Port,
                    Username = machine?.Username,
                    HostKeyFingerprint = machine?.HostKeyFingerprint,
                    Success = false,
                    Error = ex.Message
                });
            }
            catch
            {
                // Best effort; never block job completion on audit.
            }

            await PublishLogAsync(machineId, "Failed: " + ex.Message);
            await PublishStatusAsync(machineId, OnboardingStatus.Failed, ex.Message);
        }
        finally
        {
            _running.TryRemove(machineId, out _);
        }
    }

    private async Task RunUninstallAsync(Guid machineId, UninstallRequest request)
    {
        try
        {
            await PublishStatusAsync(machineId, OnboardingStatus.Running, null);
            await PublishLogAsync(machineId, "Starting uninstall job...");

            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<DataContext>();
            var ssh = scope.ServiceProvider.GetRequiredService<SshProvisioningService>();
            var audit = scope.ServiceProvider.GetRequiredService<ManLab.Server.Services.Ssh.SshAuditService>();
            var rateLimit = scope.ServiceProvider.GetRequiredService<ManLab.Server.Services.Ssh.SshRateLimitService>();

            var machine = await db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == machineId);
            if (machine is null)
            {
                await PublishStatusAsync(machineId, OnboardingStatus.Failed, "Machine not found.");
                return;
            }

            machine.Status = OnboardingStatus.Running;
            machine.LastError = null;
            machine.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            if (!Uri.TryCreate(request.ServerBaseUrl, UriKind.Absolute, out var serverUri))
            {
                await FailAsync(db, machine, "Invalid serverBaseUrl (must be an absolute URL).", machineId);
                rateLimit.RecordFailure(request.RateLimitKey);

                await audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = request.Actor,
                    ActorIp = request.ActorIp,
                    Action = "ssh.uninstall.result",
                    MachineId = machineId,
                    Host = machine.Host,
                    Port = machine.Port,
                    Username = machine.Username,
                    HostKeyFingerprint = machine.HostKeyFingerprint,
                    Success = false,
                    Error = "Invalid serverBaseUrl"
                });
                return;
            }

            var expectedFingerprint = machine.HostKeyFingerprint ?? request.ExpectedHostKeyFingerprint;

            var connOptions = new SshProvisioningService.ConnectionOptions(
                Host: machine.Host,
                Port: machine.Port,
                Username: machine.Username,
                Auth: request.Auth,
                ExpectedHostKeyFingerprint: expectedFingerprint,
                TrustOnFirstUse: request.TrustOnFirstUse,
                SudoPassword: request.SudoPassword);

            var progress = new Progress<string>(msg => _ = PublishLogAsync(machineId, msg));

            var (success, fingerprint, requiresTrust, logs) = await ssh.UninstallAgentAsync(
                connOptions,
                serverUri,
                progress,
                CancellationToken.None);

            if (requiresTrust)
            {
                machine.HostKeyFingerprint ??= fingerprint;
                machine.Status = OnboardingStatus.Failed;
                machine.LastError = "SSH host key not trusted. Confirm fingerprint and retry.";
                machine.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();

                await audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = request.Actor,
                    ActorIp = request.ActorIp,
                    Action = "ssh.uninstall.result",
                    MachineId = machineId,
                    Host = machine.Host,
                    Port = machine.Port,
                    Username = machine.Username,
                    HostKeyFingerprint = fingerprint,
                    Success = false,
                    Error = "SSH host key not trusted"
                });

                await PublishLogAsync(machineId, $"Host key fingerprint: {fingerprint}");
                await PublishStatusAsync(machineId, OnboardingStatus.Failed, machine.LastError);
                return;
            }

            if (!string.IsNullOrWhiteSpace(fingerprint) && string.IsNullOrWhiteSpace(machine.HostKeyFingerprint))
            {
                machine.HostKeyFingerprint = fingerprint;
            }

            // Consider uninstall successful even if the remote target reported no installed agent (idempotent).
            if (!success)
            {
                await FailAsync(db, machine, "Uninstall failed.", machineId);
                rateLimit.RecordFailure(request.RateLimitKey);

                await audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = request.Actor,
                    ActorIp = request.ActorIp,
                    Action = "ssh.uninstall.result",
                    MachineId = machineId,
                    Host = machine.Host,
                    Port = machine.Port,
                    Username = machine.Username,
                    HostKeyFingerprint = fingerprint,
                    Success = false,
                    Error = "Uninstall failed"
                });
                return;
            }

            machine.LinkedNodeId = null;
            machine.Status = OnboardingStatus.Pending;
            machine.LastError = null;
            machine.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            await PublishLogAsync(machineId, "Uninstall completed.");
            await PublishStatusAsync(machineId, machine.Status, null);

            rateLimit.RecordSuccess(request.RateLimitKey);
            await audit.RecordAsync(new Data.Entities.SshAuditEvent
            {
                TimestampUtc = DateTime.UtcNow,
                Actor = request.Actor,
                ActorIp = request.ActorIp,
                Action = "ssh.uninstall.result",
                MachineId = machineId,
                Host = machine.Host,
                Port = machine.Port,
                Username = machine.Username,
                HostKeyFingerprint = fingerprint,
                Success = true,
                Error = null
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Uninstall job failed for machine {MachineId}", machineId);

            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<DataContext>();
            var machine = await db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == machineId);
            if (machine is not null)
            {
                machine.Status = OnboardingStatus.Failed;
                machine.LastError = ex.Message;
                machine.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }

            try
            {
                var audit = scope.ServiceProvider.GetRequiredService<ManLab.Server.Services.Ssh.SshAuditService>();
                var rateLimit = scope.ServiceProvider.GetRequiredService<ManLab.Server.Services.Ssh.SshRateLimitService>();

                rateLimit.RecordFailure(request.RateLimitKey);

                await audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = request.Actor,
                    ActorIp = request.ActorIp,
                    Action = "ssh.uninstall.result",
                    MachineId = machineId,
                    Host = machine?.Host,
                    Port = machine?.Port,
                    Username = machine?.Username,
                    HostKeyFingerprint = machine?.HostKeyFingerprint,
                    Success = false,
                    Error = ex.Message
                });
            }
            catch
            {
                // Best effort; never block job completion on audit.
            }

            await PublishLogAsync(machineId, "Failed: " + ex.Message);
            await PublishStatusAsync(machineId, OnboardingStatus.Failed, ex.Message);
        }
        finally
        {
            _running.TryRemove(machineId, out _);
        }
    }

    private async Task FailAsync(DataContext db, OnboardingMachine machine, string error, Guid machineId)
    {
        machine.Status = OnboardingStatus.Failed;
        machine.LastError = error;
        machine.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        await PublishLogAsync(machineId, "Failed: " + error);
        await PublishStatusAsync(machineId, OnboardingStatus.Failed, error);
    }

    private Task PublishLogAsync(Guid machineId, string message)
    {
        // Broadcast to all dashboards (no secrets should be included).
        return _hub.Clients.All.SendAsync("OnboardingLog", machineId, DateTime.UtcNow, message);
    }

    private Task PublishStatusAsync(Guid machineId, OnboardingStatus status, string? lastError)
    {
        return _hub.Clients.All.SendAsync("OnboardingStatusChanged", machineId, status.ToString(), lastError);
    }

    private static string? NormalizeExpectedAgentVersion(SshProvisioningService.AgentInstallOptions? agentInstall)
    {
        if (agentInstall is null)
        {
            return null;
        }

        var v = (agentInstall.Version ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(v) || string.Equals(v, "staged", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return NormalizeVersionString(v);
    }

    private static string? NormalizeVersionString(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        raw = raw.Trim();

        if (raw.StartsWith("v", StringComparison.OrdinalIgnoreCase) && raw.Length > 1)
        {
            raw = raw[1..];
        }

        var plus = raw.IndexOf('+');
        if (plus > 0)
        {
            raw = raw[..plus];
        }

        return raw;
    }
}
