using System.Collections.Concurrent;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Security;
using ManLab.Server.Services.Ssh;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services;

public sealed class OnboardingJobRunner
{
    private readonly ConcurrentDictionary<Guid, Task> _running = new();

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<AgentHub> _hub;
    private readonly ILogger<OnboardingJobRunner> _logger;

    public OnboardingJobRunner(IServiceScopeFactory scopeFactory, IHubContext<AgentHub> hub, ILogger<OnboardingJobRunner> logger)
    {
        _scopeFactory = scopeFactory;
        _hub = hub;
        _logger = logger;
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
        bool TrustOnFirstUse,
        string? ExpectedHostKeyFingerprint,
        string? Actor,
        string? ActorIp,
        string RateLimitKey);

    public sealed record UninstallRequest(
        string ServerBaseUrl,
        SshProvisioningService.AuthOptions Auth,
        bool TrustOnFirstUse,
        string? ExpectedHostKeyFingerprint,
        string? Actor,
        string? ActorIp,
        string RateLimitKey);

    private async Task RunInstallAsync(Guid machineId, InstallRequest request)
    {
        try
        {
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

            // Create an enrollment token (plain + hashed in DB)
            var (plainToken, tokenEntity) = await tokenService.CreateAsync(machineId);
            var tokenHash = tokenEntity.TokenHash;

            await PublishLogAsync(machineId, "Generated enrollment token.");

            var expectedFingerprint = machine.HostKeyFingerprint ?? request.ExpectedHostKeyFingerprint;

            var connOptions = new SshProvisioningService.ConnectionOptions(
                Host: machine.Host,
                Port: machine.Port,
                Username: machine.Username,
                Auth: request.Auth,
                ExpectedHostKeyFingerprint: expectedFingerprint,
                TrustOnFirstUse: request.TrustOnFirstUse);

            var progress = new Progress<string>(msg => _ = PublishLogAsync(machineId, msg));

            var (success, fingerprint, requiresTrust, logs) = await ssh.InstallAgentAsync(
                connOptions,
                serverUri,
                plainToken,
                request.Force,
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

            // Wait for agent to show up (node with matching token hash and Online status)
            var deadline = DateTime.UtcNow.AddMinutes(3);
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
                        break;
                    }
                }

                await Task.Delay(TimeSpan.FromSeconds(3));
            }

            if (nodeId is null)
            {
                await FailAsync(db, machine, "Install ran, but agent did not register within the timeout.", machineId);
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

            machine.LinkedNodeId = nodeId;
            machine.Status = OnboardingStatus.Succeeded;
            machine.LastError = null;
            machine.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            await PublishLogAsync(machineId, $"Agent registered successfully (nodeId={nodeId}).");
            await PublishStatusAsync(machineId, OnboardingStatus.Succeeded, null);

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
                TrustOnFirstUse: request.TrustOnFirstUse);

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
}
