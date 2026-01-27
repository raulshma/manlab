using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services;
using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Ssh;
using ManLab.Server.Services.Security;
using ManLab.Shared;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.OnboardingManage)]
public sealed class OnboardingController : ControllerBase
{
    private readonly DataContext _db;
    private readonly OnboardingJobRunner _jobRunner;
    private readonly SshProvisioningService _ssh;
    private readonly SshAuditService _audit;
    private readonly IAuditLog _auditLog;
    private readonly SshRateLimitService _rateLimit;
    private readonly SshProvisioningOptions _sshOptions;
    private readonly CredentialEncryptionService _encryptionService;

    public OnboardingController(
        DataContext db,
        OnboardingJobRunner jobRunner,
        SshProvisioningService ssh,
        SshAuditService audit,
        IAuditLog auditLog,
        SshRateLimitService rateLimit,
        IOptions<SshProvisioningOptions> sshOptions,
        CredentialEncryptionService encryptionService)
    {
        _db = db;
        _jobRunner = jobRunner;
        _ssh = ssh;
        _audit = audit;
        _auditLog = auditLog;
        _rateLimit = rateLimit;
        _sshOptions = sshOptions.Value;
        _encryptionService = encryptionService;
    }

    /// <summary>
    /// Returns all available server base URLs from all network interfaces.
    /// This is used by the web UI to populate the server URL dropdown.
    /// </summary>
    [HttpGet("suggested-server-base-url")]
    public ActionResult<SuggestedServerBaseUrlResponse> GetSuggestedServerBaseUrl()
    {
        var scheme = Request.Scheme;
        var requestHost = Request.Host.Host;
        var port = Request.Host.Port;

        var urls = new List<string>();

        // Add all LAN IP addresses
        var lanIps = GetAllLanIPv4Addresses();
        foreach (var ip in lanIps)
        {
            var url = port is null
                ? $"{scheme}://{ip}"
                : $"{scheme}://{ip}:{port.Value}";
            if (!urls.Contains(url))
                urls.Add(url);
        }

        // Add the request host if it's not a loopback (might be a DNS name or external IP)
        if (!IsLoopbackHost(requestHost))
        {
            var hostUrl = port is null
                ? $"{scheme}://{requestHost}"
                : $"{scheme}://{requestHost}:{port.Value}";
            if (!urls.Contains(hostUrl))
                urls.Insert(0, hostUrl); // Put the request host first
        }

        // Always include at least the request origin as fallback
        if (urls.Count == 0)
        {
            var fallback = port is null
                ? $"{scheme}://{requestHost}"
                : $"{scheme}://{requestHost}:{port.Value}";
            urls.Add(fallback);
        }

        // Return the first URL as the primary suggestion (for backward compat) and all URLs
        return Ok(new SuggestedServerBaseUrlResponse(urls.FirstOrDefault() ?? "", urls));
    }

    private static bool IsLoopbackHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return true;
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
        if (host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase)) return true;
        if (host.Equals("::1", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static List<string> GetAllLanIPv4Addresses()
    {
        var ips = new List<string>();

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

                    var ip = unicast.Address.ToString();
                    if (!ips.Contains(ip))
                        ips.Add(ip);
                }
            }
        }
        catch
        {
            // Best effort only.
        }

        return ips;
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
                m.UpdatedAt,
                // Include saved configuration and whether credentials are saved
                HasSavedCredentials: !string.IsNullOrWhiteSpace(m.EncryptedSshPassword) || !string.IsNullOrWhiteSpace(m.EncryptedPrivateKeyPem),
                // Include whether a saved sudo password is available
                HasSavedSudoPassword: !string.IsNullOrWhiteSpace(m.EncryptedSudoPassword),
                TrustHostKey: m.TrustHostKey,
                ForceInstall: m.ForceInstall,
                RunAsRoot: m.RunAsRoot,
                ServerBaseUrlOverride: m.ServerBaseUrlOverride))
            .ToListAsync();

        return Ok(machines);
    }

    /// <summary>
    /// Fetches the onboarding machine linked to a specific node (if any).
    /// This enables node-level actions (like reinstalling/updating the agent) without requiring
    /// the UI to fetch the entire machines list.
    /// </summary>
    [HttpGet("nodes/{nodeId:guid}/machine")]
    public async Task<ActionResult<OnboardingMachineDto>> GetMachineForNode(Guid nodeId, CancellationToken cancellationToken)
    {
        var machine = await _db.OnboardingMachines
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.LinkedNodeId == nodeId, cancellationToken);

        if (machine is null)
        {
            return NotFound();
        }

        return Ok(ToDto(machine));
    }
    public sealed record SuggestedServerBaseUrlResponse(string ServerBaseUrl, IReadOnlyList<string> AllServerUrls);

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
            UpdatedAt = DateTime.UtcNow,
            // Save configuration preferences
            TrustHostKey = request.TrustHostKey,
            ForceInstall = request.ForceInstall,
            RunAsRoot = request.RunAsRoot,
            ServerBaseUrlOverride = request.ServerBaseUrlOverride?.Trim()
        };

        // Encryption service for saving credentials (not used in CreateMachine since credentials aren't provided yet)
        // Credentials will be saved via PUT /machines/{id}/credentials endpoint

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

        // Also remove the linked node if present
        if (machine.LinkedNodeId.HasValue)
        {
            var linkedNode = await _db.Nodes.FirstOrDefaultAsync(n => n.Id == machine.LinkedNodeId.Value);
            if (linkedNode != null)
            {
                _db.Nodes.Remove(linkedNode);
            }
        }

        _db.OnboardingMachines.Remove(machine);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    /// <summary>
    /// Save or update encrypted credentials for a machine.
    /// </summary>
    [HttpPut("machines/{id:guid}/credentials")]
    public async Task<IActionResult> SaveCredentials(Guid id, [FromBody] SaveCredentialsRequest request, CancellationToken cancellationToken)
    {
        var machine = await _db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (machine is null)
        {
            return NotFound();
        }

        // Encrypt and save credentials based on auth mode.
        // NOTE: This endpoint supports partial updates so the UI can update sudo password
        // without re-sending SSH auth credentials, as long as the machine already has saved
        // auth credentials for its configured auth mode.
        if (machine.AuthMode == SshAuthMode.Password)
        {
            if (!string.IsNullOrWhiteSpace(request.Password))
            {
                machine.EncryptedSshPassword = await _encryptionService.EncryptAsync(request.Password, cancellationToken);
                // Clear any private-key fields when switching/setting password credentials.
                machine.EncryptedPrivateKeyPem = null;
                machine.EncryptedPrivateKeyPassphrase = null;
            }
            else if (string.IsNullOrWhiteSpace(machine.EncryptedSshPassword))
            {
                return BadRequest("Missing password for Password auth mode.");
            }
        }
        else if (machine.AuthMode == SshAuthMode.PrivateKey)
        {
            if (!string.IsNullOrWhiteSpace(request.PrivateKeyPem))
            {
                machine.EncryptedSshPassword = null;
                machine.EncryptedPrivateKeyPem = await _encryptionService.EncryptAsync(request.PrivateKeyPem, cancellationToken);

                // Passphrase handling: if caller supplies a new key but no passphrase, clear.
                machine.EncryptedPrivateKeyPassphrase = string.IsNullOrWhiteSpace(request.PrivateKeyPassphrase)
                    ? null
                    : await _encryptionService.EncryptAsync(request.PrivateKeyPassphrase, cancellationToken);
            }
            else
            {
                // Allow passphrase-only updates when a key is already saved.
                if (string.IsNullOrWhiteSpace(machine.EncryptedPrivateKeyPem))
                {
                    return BadRequest("Missing private key for PrivateKey auth mode.");
                }

                if (!string.IsNullOrWhiteSpace(request.PrivateKeyPassphrase))
                {
                    machine.EncryptedPrivateKeyPassphrase = await _encryptionService.EncryptAsync(request.PrivateKeyPassphrase, cancellationToken);
                }
            }
        }
        else
        {
            return BadRequest("Invalid auth mode.");
        }

        // Save sudo password if provided
        if (!string.IsNullOrWhiteSpace(request.SudoPassword))
        {
            machine.EncryptedSudoPassword = await _encryptionService.EncryptAsync(request.SudoPassword, cancellationToken);
        }

        machine.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    /// <summary>
    /// Clear saved credentials for a machine.
    /// </summary>
    [HttpDelete("machines/{id:guid}/credentials")]
    public async Task<IActionResult> ClearCredentials(Guid id, CancellationToken cancellationToken)
    {
        var machine = await _db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (machine is null)
        {
            return NotFound();
        }

        machine.EncryptedSshPassword = null;
        machine.EncryptedPrivateKeyPem = null;
        machine.EncryptedPrivateKeyPassphrase = null;
        machine.EncryptedSudoPassword = null;

        machine.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    /// <summary>
    /// Update configuration preferences for a machine.
    /// </summary>
    [HttpPut("machines/{id:guid}/configuration")]
    public async Task<IActionResult> UpdateConfiguration(Guid id, [FromBody] UpdateConfigurationRequest request, CancellationToken cancellationToken)
    {
        var machine = await _db.OnboardingMachines.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (machine is null)
        {
            return NotFound();
        }

        if (request.TrustHostKey.HasValue)
            machine.TrustHostKey = request.TrustHostKey.Value;
        if (request.ForceInstall.HasValue)
            machine.ForceInstall = request.ForceInstall.Value;
        if (request.RunAsRoot.HasValue)
            machine.RunAsRoot = request.RunAsRoot.Value;
        if (request.ServerBaseUrlOverride != null)
            machine.ServerBaseUrlOverride = string.IsNullOrWhiteSpace(request.ServerBaseUrlOverride) ? null : request.ServerBaseUrlOverride.Trim();

        machine.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);

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

        // Build auth from provided credentials or fall back to saved credentials when UseSavedCredentials is true
        var auth = await BuildAuthAsync(machine.AuthMode, request, _encryptionService, machine, cancellationToken);
        if (auth is null)
        {
            return BadRequest("Missing SSH credentials. Provide credentials or enable UseSavedCredentials.");
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
            result.HasExistingInstallation,
            result.DetectedServerUrls,
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

        var auth = await BuildAuthAsync(machine.AuthMode, request, _encryptionService, machine, cancellationToken: default);
        if (auth is null)
        {
            return BadRequest("Missing SSH credentials. Provide credentials or enable UseSavedCredentials.");
        }

        // Decrypt sudo password if saved and not provided in request
        var sudoPassword = request.SudoPassword;
        if (string.IsNullOrWhiteSpace(sudoPassword) && request.UseSavedCredentials && !string.IsNullOrWhiteSpace(machine.EncryptedSudoPassword))
        {
            sudoPassword = await _encryptionService.DecryptAsync(machine.EncryptedSudoPassword, cancellationToken: default);
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
            SudoPassword: sudoPassword ?? "",
            RunAsRoot: request.RunAsRoot,
            AgentInstall: new ManLab.Server.Services.Ssh.SshProvisioningService.AgentInstallOptions(
                Source: request.AgentSource,
                Channel: request.AgentChannel,
                Version: request.AgentVersion,
                GitHubReleaseBaseUrl: request.GitHubReleaseBaseUrl),
            TargetNodeId: request.TargetNodeId,
            TrustOnFirstUse: request.TrustHostKey && _sshOptions.AllowTrustOnFirstUse && string.IsNullOrWhiteSpace(machine.HostKeyFingerprint),
            ExpectedHostKeyFingerprint: machine.HostKeyFingerprint,
            Actor: User?.Identity?.Name,
            ActorIp: HttpContext.Connection.RemoteIpAddress?.ToString(),
            RateLimitKey: rateKey));

        if (!started)
        {
            return Conflict("Unable to start install (already running).");
        }

        // Persist the server base URL that will be used for this install/update.
        // This enables the update UI to preselect the same URL next time.
        if (ServerBaseUrl.TryNormalizeInstallerOrigin(request.ServerBaseUrl, out var origin, out _, out _) && origin is not null)
        {
            machine.ServerBaseUrlOverride = origin.ToString();
        }
        else if (!string.IsNullOrWhiteSpace(request.ServerBaseUrl))
        {
            // Best-effort fallback; job runner will validate and may fail later.
            machine.ServerBaseUrlOverride = request.ServerBaseUrl.Trim();
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

        if (request.TargetNodeId is Guid targetNodeId)
        {
            _auditLog.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "agent.update.start",
                httpContext: HttpContext,
                success: null,
                statusCode: StatusCodes.Status202Accepted,
                nodeId: targetNodeId,
                machineId: machine.Id,
                category: "agents",
                message: "Agent update started",
                dataJson: JsonSerializer.Serialize(new
                {
                    hostname = machine.Host,
                    port = machine.Port,
                    username = machine.Username,
                    serverBaseUrl = machine.ServerBaseUrlOverride,
                    agentSource = request.AgentSource,
                    agentChannel = request.AgentChannel,
                    agentVersion = request.AgentVersion
                })));
        }

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

        var auth = await BuildAuthAsync(machine.AuthMode, request, _encryptionService, machine, cancellationToken: default);
        if (auth is null)
        {
            return BadRequest("Missing SSH credentials. Provide credentials or enable UseSavedCredentials.");
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

        // Decrypt sudo password if saved and not provided in request
        var sudoPassword = request.SudoPassword;
        if (string.IsNullOrWhiteSpace(sudoPassword) && request.UseSavedCredentials && !string.IsNullOrWhiteSpace(machine.EncryptedSudoPassword))
        {
            sudoPassword = await _encryptionService.DecryptAsync(machine.EncryptedSudoPassword, cancellationToken: default);
        }

        var started = _jobRunner.TryStartUninstall(id, new OnboardingJobRunner.UninstallRequest(
            ServerBaseUrl: request.ServerBaseUrl,
            Auth: auth,
            SudoPassword: sudoPassword ?? "",
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

    [HttpPost("machines/{id:guid}/uninstall/preview")]
    public async Task<ActionResult<UninstallPreviewResponse>> UninstallPreview(Guid id, [FromBody] StartUninstallPreviewRequest request, CancellationToken cancellationToken)
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

        var auth = await BuildAuthAsync(machine.AuthMode, request, _encryptionService, machine, cancellationToken);
        if (auth is null)
        {
            return BadRequest("Missing SSH credentials. Provide credentials or enable UseSavedCredentials.");
        }

        if (request.TrustHostKey && !_sshOptions.AllowTrustOnFirstUse)
        {
            return BadRequest("Trust-on-first-use is disabled by server policy. Provide an allowlisted fingerprint.");
        }

        var trustOnFirstUse = request.TrustHostKey && _sshOptions.AllowTrustOnFirstUse && string.IsNullOrWhiteSpace(machine.HostKeyFingerprint);

        // If no fingerprint yet, require explicit TOFU approval for this call (if allowed).
        if (string.IsNullOrWhiteSpace(machine.HostKeyFingerprint) && (!request.TrustHostKey || !_sshOptions.AllowTrustOnFirstUse))
        {
            return BadRequest("Host key not trusted yet. Run Test Connection and confirm fingerprint first.");
        }

        var result = await _ssh.GetUninstallPreviewAsync(
            new SshProvisioningService.ConnectionOptions(
                machine.Host,
                machine.Port,
                machine.Username,
                auth,
                machine.HostKeyFingerprint,
                TrustOnFirstUse: trustOnFirstUse),
            new Uri(request.ServerBaseUrl),
            cancellationToken);

        if (result.Success)
        {
            _rateLimit.RecordSuccess(rateKey);
        }
        else
        {
            _rateLimit.RecordFailure(rateKey);
        }

        // Best-effort audit (do not block response).
        try
        {
            await _audit.RecordAsync(new Data.Entities.SshAuditEvent
            {
                TimestampUtc = DateTime.UtcNow,
                Actor = User?.Identity?.Name,
                ActorIp = HttpContext.Connection.RemoteIpAddress?.ToString(),
                Action = "ssh.uninstall.preview",
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
        }
        catch
        {
            // ignore
        }

        return Ok(new UninstallPreviewResponse(
            Success: result.Success,
            HostKeyFingerprint: result.HostKeyFingerprint,
            RequiresHostKeyTrust: result.RequiresHostKeyTrust,
            OsHint: result.OsHint,
            Sections: result.Sections.Select(s => new InventorySectionDto(s.Label, s.Items.ToArray())).ToList(),
            Error: result.Error));
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

    /// <summary>
    /// Build auth options from request, falling back to encrypted credentials stored on machine if UseSavedCredentials is true.
    /// </summary>
    private static async Task<SshProvisioningService.AuthOptions?> BuildAuthAsync(
        SshAuthMode mode,
        ISshAuthRequest request,
        CredentialEncryptionService encryptionService,
        OnboardingMachine machine,
        CancellationToken cancellationToken)
    {
        var password = request.Password;
        var privateKeyPem = request.PrivateKeyPem;
        var privateKeyPassphrase = request.PrivateKeyPassphrase;

        // If UseSavedCredentials is true and credentials aren't provided, fall back to encrypted values
        if (request.UseSavedCredentials)
        {
            if (string.IsNullOrWhiteSpace(password) && !string.IsNullOrWhiteSpace(machine.EncryptedSshPassword))
            {
                password = await encryptionService.DecryptAsync(machine.EncryptedSshPassword, cancellationToken);
            }

            if (string.IsNullOrWhiteSpace(privateKeyPem) && !string.IsNullOrWhiteSpace(machine.EncryptedPrivateKeyPem))
            {
                privateKeyPem = await encryptionService.DecryptAsync(machine.EncryptedPrivateKeyPem, cancellationToken);
            }

            if (string.IsNullOrWhiteSpace(privateKeyPassphrase) && !string.IsNullOrWhiteSpace(machine.EncryptedPrivateKeyPassphrase))
            {
                privateKeyPassphrase = await encryptionService.DecryptAsync(machine.EncryptedPrivateKeyPassphrase, cancellationToken);
            }
        }

        return mode switch
        {
            SshAuthMode.Password => string.IsNullOrWhiteSpace(password)
                ? null
                : new SshProvisioningService.PasswordAuth(password),

            SshAuthMode.PrivateKey => string.IsNullOrWhiteSpace(privateKeyPem)
                ? null
                : new SshProvisioningService.PrivateKeyAuth(privateKeyPem, privateKeyPassphrase),

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
            m.UpdatedAt,
            // Indicates whether saved credentials are available for this machine
            HasSavedCredentials: !string.IsNullOrWhiteSpace(m.EncryptedSshPassword) || !string.IsNullOrWhiteSpace(m.EncryptedPrivateKeyPem),
            // Indicates whether a saved sudo password is available
            HasSavedSudoPassword: !string.IsNullOrWhiteSpace(m.EncryptedSudoPassword),
            // Saved configuration preferences
            TrustHostKey: m.TrustHostKey,
            ForceInstall: m.ForceInstall,
            RunAsRoot: m.RunAsRoot,
            ServerBaseUrlOverride: m.ServerBaseUrlOverride);

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
        DateTime UpdatedAt,
        // Indicates whether saved credentials are available for this machine
        bool HasSavedCredentials = false,
        // Indicates whether a saved sudo password is available
        bool HasSavedSudoPassword = false,
        // Saved configuration preferences
        bool TrustHostKey = true,
        bool ForceInstall = true,
        bool RunAsRoot = false,
        string? ServerBaseUrlOverride = null);

    public sealed record CreateMachineRequest(
        string Host,
        int Port,
        string Username,
        string AuthMode,
        // Allow frontend to specify whether to save credentials for new machines
        bool RememberCredentials = false,
        // Configuration preferences to save
        bool TrustHostKey = true,
        bool ForceInstall = true,
        bool RunAsRoot = false,
        string? ServerBaseUrlOverride = null);

    public interface ISshAuthRequest
    {
        string? Password { get; }
        string? PrivateKeyPem { get; }
        string? PrivateKeyPassphrase { get; }
        string? SudoPassword { get; }
        bool UseSavedCredentials { get; }
    }

    public sealed record SshTestRequest(
        string? Password,
        string? PrivateKeyPem,
        string? PrivateKeyPassphrase,
        string? SudoPassword,
        bool TrustHostKey,
        bool UseSavedCredentials = false) : ISshAuthRequest;

    public sealed record SshTestResponse(
        bool Success,
        string? HostKeyFingerprint,
        bool RequiresHostKeyTrust,
        string? WhoAmI,
        string? OsHint,
        bool HasExistingInstallation,
        IReadOnlyList<string> DetectedServerUrls,
        string? Error);

    public sealed record StartInstallRequest(
        string ServerBaseUrl,
        bool Force,
        bool RunAsRoot,
        bool TrustHostKey,
        string? AgentSource,
        string? AgentChannel,
        string? AgentVersion,
        string? GitHubReleaseBaseUrl,
        Guid? TargetNodeId,
        string? Password,
        string? PrivateKeyPem,
        string? PrivateKeyPassphrase,
        string? SudoPassword,
        bool UseSavedCredentials = false) : ISshAuthRequest;

    public sealed record StartInstallResponse(Guid MachineId, string Status);

    public sealed record StartUninstallRequest(
        string ServerBaseUrl,
        bool TrustHostKey,
        string? Password,
        string? PrivateKeyPem,
        string? PrivateKeyPassphrase,
        string? SudoPassword,
        bool UseSavedCredentials = false) : ISshAuthRequest;

    public sealed record StartUninstallPreviewRequest(
        string ServerBaseUrl,
        bool TrustHostKey,
        string? Password,
        string? PrivateKeyPem,
        string? PrivateKeyPassphrase,
        string? SudoPassword,
        bool UseSavedCredentials = false) : ISshAuthRequest;

    public sealed record InventorySectionDto(string Label, IReadOnlyList<string> Items);

    public sealed record UninstallPreviewResponse(
        bool Success,
        string? HostKeyFingerprint,
        bool RequiresHostKeyTrust,
        string? OsHint,
        IReadOnlyList<InventorySectionDto> Sections,
        string? Error);

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

    // DTOs for saving credentials and configuration

    public sealed record SaveCredentialsRequest(
        string? Password,
        string? PrivateKeyPem,
        string? PrivateKeyPassphrase,
        string? SudoPassword);

    public sealed record UpdateConfigurationRequest(
        bool? TrustHostKey,
        bool? ForceInstall,
        bool? RunAsRoot,
        string? ServerBaseUrlOverride);
}
