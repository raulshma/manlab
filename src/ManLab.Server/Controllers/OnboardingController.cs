using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services;
using ManLab.Server.Services.Ssh;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class OnboardingController : ControllerBase
{
    private readonly DataContext _db;
    private readonly OnboardingJobRunner _jobRunner;
    private readonly SshProvisioningService _ssh;
    private readonly SshAuditService _audit;
    private readonly SshRateLimitService _rateLimit;
    private readonly SshProvisioningOptions _sshOptions;

    public OnboardingController(
        DataContext db,
        OnboardingJobRunner jobRunner,
        SshProvisioningService ssh,
        SshAuditService audit,
        SshRateLimitService rateLimit,
        IOptions<SshProvisioningOptions> sshOptions)
    {
        _db = db;
        _jobRunner = jobRunner;
        _ssh = ssh;
        _audit = audit;
        _rateLimit = rateLimit;
        _sshOptions = sshOptions.Value;
    }

    /// <summary>
    /// Returns the server base URL as observed by this API request (scheme + host + port).
    /// This is used by the web UI to auto-fill the "Server base URL (reachable from target)" field.
    ///
    /// In development, when the UI runs on a different origin (e.g. Vite dev server), requests are
    /// proxied to the backend and the backend can still report its own origin.
    /// </summary>
    [HttpGet("suggested-server-base-url")]
    public ActionResult<SuggestedServerBaseUrlResponse> GetSuggestedServerBaseUrl()
    {
        // Example: http://192.168.1.10:5247
        // If the backend is accessed as "localhost" (common in dev), that value is *not* reachable
        // from an SSH target machine. In that case, try to suggest a LAN IP instead.

        var scheme = Request.Scheme;
        var host = Request.Host.Host;
        var port = Request.Host.Port;

        if (IsLoopbackHost(host) && TryGetLanIPv4(out var lanIp))
        {
            host = lanIp;
        }

        var serverBaseUrl = port is null
            ? $"{scheme}://{host}"
            : $"{scheme}://{host}:{port.Value}";

        return Ok(new SuggestedServerBaseUrlResponse(serverBaseUrl));
    }

    private static bool IsLoopbackHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return true;
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
        if (host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)) return true;
        if (host.Equals("::1", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static bool TryGetLanIPv4(out string ip)
    {
        ip = string.Empty;

        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;

                var props = nic.GetIPProperties();
                foreach (var unicast in props.UnicastAddresses)
                {
                    if (unicast.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    if (IPAddress.IsLoopback(unicast.Address)) continue;

                    var bytes = unicast.Address.GetAddressBytes();
                    if (bytes.Length != 4) continue;

                    // RFC1918 private ranges:
                    // 10.0.0.0/8
                    // 172.16.0.0/12
                    // 192.168.0.0/16
                    var isPrivate =
                        bytes[0] == 10 ||
                        (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
                        (bytes[0] == 192 && bytes[1] == 168);

                    if (!isPrivate) continue;

                    ip = unicast.Address.ToString();
                    return true;
                }
            }
        }
        catch
        {
            // Best effort only.
        }

        return false;
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

    public sealed record SuggestedServerBaseUrlResponse(string ServerBaseUrl);

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

    [HttpDelete("machines/{id:guid}")]
    public async Task<IActionResult> DeleteMachine(Guid id)
    {
        var machine = await _db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == id);
        if (machine is null)
        {
            return NotFound();
        }

        // Prevent deletion if a job is currently running for this machine.
        if (_jobRunner.IsRunning(id))
        {
            return Conflict("Cannot delete machine while an onboarding job is in progress.");
        }

        _db.OnboardingMachines.Remove(machine);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    [HttpPost("machines/{id:guid}/ssh/test")]
    public async Task<ActionResult<SshTestResponse>> TestSsh(Guid id, [FromBody] SshTestRequest request, CancellationToken cancellationToken)
    {
        var machine = await _db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (machine is null)
        {
            return NotFound();
        }

        var rateKey = BuildRateKey(machine.Id, machine.Host, HttpContext.Connection.RemoteIpAddress?.ToString());
        try
        {
            _rateLimit.ThrowIfLockedOut(rateKey);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status429TooManyRequests, ex.Message);
        }

        var auth = BuildAuth(machine.AuthMode, request);
        if (auth is null)
        {
            return BadRequest("Missing SSH credentials for selected auth mode.");
        }

        if (request.TrustHostKey && !_sshOptions.AllowTrustOnFirstUse)
        {
            return BadRequest("Trust-on-first-use is disabled by server policy. Provide an allowlisted fingerprint.");
        }

        var expectedFingerprint = machine.HostKeyFingerprint;
        var trustOnFirstUse = request.TrustHostKey && _sshOptions.AllowTrustOnFirstUse && string.IsNullOrWhiteSpace(expectedFingerprint);

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

                await _audit.RecordAsync(new Data.Entities.SshAuditEvent
                {
                    TimestampUtc = DateTime.UtcNow,
                    Actor = User?.Identity?.Name,
                    ActorIp = HttpContext.Connection.RemoteIpAddress?.ToString(),
                    Action = "ssh.hostkey.trust",
                    MachineId = machine.Id,
                    Host = machine.Host,
                    Port = machine.Port,
                    Username = machine.Username,
                    HostKeyFingerprint = result.HostKeyFingerprint,
                    Success = true,
                    Error = null,
                    OsFamily = InferOsFamily(result.OsHint),
                    CpuArch = null,
                    OsDistro = null,
                    OsVersion = null
                }, cancellationToken);

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

        if (result.Success)
        {
            _rateLimit.RecordSuccess(rateKey);
        }
        else
        {
            _rateLimit.RecordFailure(rateKey);
        }

        await _audit.RecordAsync(new Data.Entities.SshAuditEvent
        {
            TimestampUtc = DateTime.UtcNow,
            Actor = User?.Identity?.Name,
            ActorIp = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Action = "ssh.test",
            MachineId = machine.Id,
            Host = machine.Host,
            Port = machine.Port,
            Username = machine.Username,
            HostKeyFingerprint = result.HostKeyFingerprint,
            Success = result.Success,
            Error = result.Error,
            OsFamily = InferOsFamily(result.OsHint),
            CpuArch = null,
            OsDistro = null,
            OsVersion = null
        }, cancellationToken);

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

        var rateKey = BuildRateKey(machine.Id, machine.Host, HttpContext.Connection.RemoteIpAddress?.ToString());
        try
        {
            _rateLimit.ThrowIfLockedOut(rateKey);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status429TooManyRequests, ex.Message);
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

        if (request.TrustHostKey && !_sshOptions.AllowTrustOnFirstUse)
        {
            return BadRequest("Trust-on-first-use is disabled by server policy. Provide an allowlisted fingerprint.");
        }

        // If no fingerprint yet, require explicit TOFU approval for this call (if allowed).
        if (string.IsNullOrWhiteSpace(machine.HostKeyFingerprint) && (!request.TrustHostKey || !_sshOptions.AllowTrustOnFirstUse))
        {
            return BadRequest("Host key not trusted yet. Run Test Connection and confirm fingerprint first.");
        }

        var started = _jobRunner.TryStartInstall(id, new OnboardingJobRunner.InstallRequest(
            ServerBaseUrl: request.ServerBaseUrl,
            Force: request.Force,
            Auth: auth,
            TrustOnFirstUse: request.TrustHostKey && _sshOptions.AllowTrustOnFirstUse && string.IsNullOrWhiteSpace(machine.HostKeyFingerprint),
            ExpectedHostKeyFingerprint: machine.HostKeyFingerprint,
            Actor: User?.Identity?.Name,
            ActorIp: HttpContext.Connection.RemoteIpAddress?.ToString(),
            RateLimitKey: rateKey));

        if (!started)
        {
            return Conflict("Unable to start install (already running).");
        }

        machine.Status = OnboardingStatus.Running;
        machine.LastError = null;
        machine.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _audit.RecordAsync(new Data.Entities.SshAuditEvent
        {
            TimestampUtc = DateTime.UtcNow,
            Actor = User?.Identity?.Name,
            ActorIp = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Action = "ssh.install.start",
            MachineId = machine.Id,
            Host = machine.Host,
            Port = machine.Port,
            Username = machine.Username,
            HostKeyFingerprint = machine.HostKeyFingerprint,
            Success = true,
            Error = null
        });

        return Accepted(new StartInstallResponse(machine.Id, machine.Status.ToString()));
    }

    [HttpPost("machines/{id:guid}/uninstall")]
    public async Task<ActionResult<StartUninstallResponse>> Uninstall(Guid id, [FromBody] StartUninstallRequest request)
    {
        var machine = await _db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == id);
        if (machine is null)
        {
            return NotFound();
        }

        var rateKey = BuildRateKey(machine.Id, machine.Host, HttpContext.Connection.RemoteIpAddress?.ToString());
        try
        {
            _rateLimit.ThrowIfLockedOut(rateKey);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status429TooManyRequests, ex.Message);
        }

        if (_jobRunner.IsRunning(id))
        {
            return Conflict("A job is already running for this machine.");
        }

        var auth = BuildAuth(machine.AuthMode, request);
        if (auth is null)
        {
            return BadRequest("Missing SSH credentials for selected auth mode.");
        }

        if (request.TrustHostKey && !_sshOptions.AllowTrustOnFirstUse)
        {
            return BadRequest("Trust-on-first-use is disabled by server policy. Provide an allowlisted fingerprint.");
        }

        // If no fingerprint yet, require explicit TOFU approval for this call (if allowed).
        if (string.IsNullOrWhiteSpace(machine.HostKeyFingerprint) && (!request.TrustHostKey || !_sshOptions.AllowTrustOnFirstUse))
        {
            return BadRequest("Host key not trusted yet. Run Test Connection and confirm fingerprint first.");
        }

        var started = _jobRunner.TryStartUninstall(id, new OnboardingJobRunner.UninstallRequest(
            ServerBaseUrl: request.ServerBaseUrl,
            Auth: auth,
            TrustOnFirstUse: request.TrustHostKey && _sshOptions.AllowTrustOnFirstUse && string.IsNullOrWhiteSpace(machine.HostKeyFingerprint),
            ExpectedHostKeyFingerprint: machine.HostKeyFingerprint,
            Actor: User?.Identity?.Name,
            ActorIp: HttpContext.Connection.RemoteIpAddress?.ToString(),
            RateLimitKey: rateKey));

        if (!started)
        {
            return Conflict("Unable to start uninstall (already running).");
        }

        machine.Status = OnboardingStatus.Running;
        machine.LastError = null;
        machine.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        await _audit.RecordAsync(new Data.Entities.SshAuditEvent
        {
            TimestampUtc = DateTime.UtcNow,
            Actor = User?.Identity?.Name,
            ActorIp = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Action = "ssh.uninstall.start",
            MachineId = machine.Id,
            Host = machine.Host,
            Port = machine.Port,
            Username = machine.Username,
            HostKeyFingerprint = machine.HostKeyFingerprint,
            Success = true,
            Error = null
        });

        return Accepted(new StartUninstallResponse(machine.Id, machine.Status.ToString()));
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

    public sealed record StartUninstallRequest(
        string ServerBaseUrl,
        bool TrustHostKey,
        string? Password,
        string? PrivateKeyPem,
        string? PrivateKeyPassphrase) : ISshAuthRequest;

    public sealed record StartUninstallResponse(Guid MachineId, string Status);

    private static string BuildRateKey(Guid machineId, string host, string? actorIp)
        => $"machine:{machineId}|host:{host}|ip:{actorIp ?? "?"}";

    private static string? InferOsFamily(string? osHint)
    {
        if (string.IsNullOrWhiteSpace(osHint)) return null;
        if (osHint.StartsWith("Linux", StringComparison.OrdinalIgnoreCase)) return "linux";
        if (osHint.StartsWith("Windows", StringComparison.OrdinalIgnoreCase)) return "windows";
        return null;
    }
}
