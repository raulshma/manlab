using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services;
using ManLab.Server.Services.Ssh;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class OnboardingController : ControllerBase
{
    private readonly DataContext _db;
    private readonly OnboardingJobRunner _jobRunner;
    private readonly SshProvisioningService _ssh;

    public OnboardingController(DataContext db, OnboardingJobRunner jobRunner, SshProvisioningService ssh)
    {
        _db = db;
        _jobRunner = jobRunner;
        _ssh = ssh;
    }

    [HttpGet("machines")]
    public async Task<ActionResult<IEnumerable<OnboardingMachineDto>>> ListMachines()
    {
        var machines = await _db.OnboardingMachines
            .OrderByDescending(m => m.UpdatedAt)
            .Select(m => new OnboardingMachineDto(
                m.Id,
                m.Host,
                m.Port,
                m.Username,
                m.AuthMode.ToString(),
                m.HostKeyFingerprint,
                m.Status.ToString(),
                m.LastError,
                m.LinkedNodeId,
                m.CreatedAt,
                m.UpdatedAt))
            .ToListAsync();

        return Ok(machines);
    }

    [HttpPost("machines")]
    public async Task<ActionResult<OnboardingMachineDto>> CreateMachine([FromBody] CreateMachineRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Host))
        {
            return BadRequest("Host is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Username))
        {
            return BadRequest("Username is required.");
        }

        if (!Enum.TryParse<SshAuthMode>(request.AuthMode, true, out var authMode))
        {
            return BadRequest("Invalid authMode.");
        }

        var machine = new OnboardingMachine
        {
            Id = Guid.NewGuid(),
            Host = request.Host.Trim(),
            Port = request.Port <= 0 ? 22 : request.Port,
            Username = request.Username.Trim(),
            AuthMode = authMode,
            HostKeyFingerprint = null,
            Status = OnboardingStatus.Pending,
            LastError = null,
            LinkedNodeId = null,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.OnboardingMachines.Add(machine);
        await _db.SaveChangesAsync();

        return CreatedAtAction(nameof(ListMachines), new { }, ToDto(machine));
    }

    [HttpPost("machines/{id:guid}/ssh/test")]
    public async Task<ActionResult<SshTestResponse>> TestSsh(Guid id, [FromBody] SshTestRequest request, CancellationToken cancellationToken)
    {
        var machine = await _db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (machine is null)
        {
            return NotFound();
        }

        var auth = BuildAuth(machine.AuthMode, request);
        if (auth is null)
        {
            return BadRequest("Missing SSH credentials for selected auth mode.");
        }

        var expectedFingerprint = machine.HostKeyFingerprint;
        var trustOnFirstUse = request.TrustHostKey && string.IsNullOrWhiteSpace(expectedFingerprint);

        var result = await _ssh.TestConnectionAsync(
            new SshProvisioningService.ConnectionOptions(
                machine.Host,
                machine.Port,
                machine.Username,
                auth,
                expectedFingerprint,
                TrustOnFirstUse: trustOnFirstUse),
            cancellationToken);

        if (result.RequiresHostKeyTrust)
        {
            // Persist fingerprint if admin explicitly trusted TOFU.
            if (trustOnFirstUse && !string.IsNullOrWhiteSpace(result.HostKeyFingerprint))
            {
                machine.HostKeyFingerprint = result.HostKeyFingerprint;
                machine.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(cancellationToken);

                // Retry once now that it's trusted.
                result = await _ssh.TestConnectionAsync(
                    new SshProvisioningService.ConnectionOptions(
                        machine.Host,
                        machine.Port,
                        machine.Username,
                        auth,
                        machine.HostKeyFingerprint,
                        TrustOnFirstUse: false),
                    cancellationToken);
            }
        }

        return Ok(new SshTestResponse(
            result.Success,
            result.HostKeyFingerprint,
            result.RequiresHostKeyTrust,
            result.WhoAmI,
            result.OsHint,
            result.Error));
    }

    [HttpPost("machines/{id:guid}/install")]
    public async Task<ActionResult<StartInstallResponse>> Install(Guid id, [FromBody] StartInstallRequest request)
    {
        var machine = await _db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == id);
        if (machine is null)
        {
            return NotFound();
        }

        if (_jobRunner.IsRunning(id))
        {
            return Conflict("An install is already running for this machine.");
        }

        var auth = BuildAuth(machine.AuthMode, request);
        if (auth is null)
        {
            return BadRequest("Missing SSH credentials for selected auth mode.");
        }

        // If no fingerprint yet, require explicit TOFU approval for this call.
        if (string.IsNullOrWhiteSpace(machine.HostKeyFingerprint) && !request.TrustHostKey)
        {
            return BadRequest("Host key not trusted yet. Run Test Connection and confirm fingerprint first.");
        }

        var started = _jobRunner.TryStartInstall(id, new OnboardingJobRunner.InstallRequest(
            ServerBaseUrl: request.ServerBaseUrl,
            Force: request.Force,
            Auth: auth,
            TrustOnFirstUse: request.TrustHostKey && string.IsNullOrWhiteSpace(machine.HostKeyFingerprint),
            ExpectedHostKeyFingerprint: machine.HostKeyFingerprint));

        if (!started)
        {
            return Conflict("Unable to start install (already running).");
        }

        machine.Status = OnboardingStatus.Running;
        machine.LastError = null;
        machine.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Accepted(new StartInstallResponse(machine.Id, machine.Status.ToString()));
    }

    private static SshProvisioningService.AuthOptions? BuildAuth(SshAuthMode mode, ISshAuthRequest request)
    {
        return mode switch
        {
            SshAuthMode.Password => string.IsNullOrWhiteSpace(request.Password)
                ? null
                : new SshProvisioningService.PasswordAuth(request.Password),

            SshAuthMode.PrivateKey => string.IsNullOrWhiteSpace(request.PrivateKeyPem)
                ? null
                : new SshProvisioningService.PrivateKeyAuth(request.PrivateKeyPem, request.PrivateKeyPassphrase),

            _ => null
        };
    }

    private static OnboardingMachineDto ToDto(OnboardingMachine m)
        => new(
            m.Id,
            m.Host,
            m.Port,
            m.Username,
            m.AuthMode.ToString(),
            m.HostKeyFingerprint,
            m.Status.ToString(),
            m.LastError,
            m.LinkedNodeId,
            m.CreatedAt,
            m.UpdatedAt);

    public sealed record OnboardingMachineDto(
        Guid Id,
        string Host,
        int Port,
        string Username,
        string AuthMode,
        string? HostKeyFingerprint,
        string Status,
        string? LastError,
        Guid? LinkedNodeId,
        DateTime CreatedAt,
        DateTime UpdatedAt);

    public sealed record CreateMachineRequest(string Host, int Port, string Username, string AuthMode);

    public interface ISshAuthRequest
    {
        string? Password { get; }
        string? PrivateKeyPem { get; }
        string? PrivateKeyPassphrase { get; }
    }

    public sealed record SshTestRequest(
        string? Password,
        string? PrivateKeyPem,
        string? PrivateKeyPassphrase,
        bool TrustHostKey) : ISshAuthRequest;

    public sealed record SshTestResponse(
        bool Success,
        string? HostKeyFingerprint,
        bool RequiresHostKeyTrust,
        string? WhoAmI,
        string? OsHint,
        string? Error);

    public sealed record StartInstallRequest(
        string ServerBaseUrl,
        bool Force,
        bool TrustHostKey,
        string? Password,
        string? PrivateKeyPem,
        string? PrivateKeyPassphrase) : ISshAuthRequest;

    public sealed record StartInstallResponse(Guid MachineId, string Status);
}
