using System.Security.Cryptography;
using System.Text;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace ManLab.Server.Services.Ssh;

public sealed class SshProvisioningService
{
    public sealed record ConnectionOptions(
        string Host,
        int Port,
        string Username,
        AuthOptions Auth,
        string? ExpectedHostKeyFingerprint,
        bool TrustOnFirstUse);

    public abstract record AuthOptions;

    public sealed record PasswordAuth(string Password) : AuthOptions;

    public sealed record PrivateKeyAuth(string PrivateKeyPem, string? Passphrase) : AuthOptions;

    public sealed record ConnectionTestResult(
        bool Success,
        string? HostKeyFingerprint,
        bool RequiresHostKeyTrust,
        string? WhoAmI,
        string? OsHint,
        string? Error);

    public async Task<ConnectionTestResult> TestConnectionAsync(ConnectionOptions options, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        using var client = CreateSshClient(options, out var hostKey);
        try
        {
            client.Connect();

            var whoami = Execute(client, "whoami", maxChars: 4096);
            var uname = Execute(client, "uname -s", maxChars: 4096);

            client.Disconnect();

            return new ConnectionTestResult(
                Success: true,
                HostKeyFingerprint: hostKey.Fingerprint,
                RequiresHostKeyTrust: false,
                WhoAmI: whoami?.Trim(),
                OsHint: uname?.Trim(),
                Error: null);
        }
        catch (SshAuthenticationException ex)
        {
            return new ConnectionTestResult(false, hostKey.Fingerprint, false, null, null, "SSH authentication failed: " + ex.Message);
        }
        catch (SshConnectionException ex)
        {
            if (hostKey.TrustRequired)
            {
                return new ConnectionTestResult(
                    Success: false,
                    HostKeyFingerprint: hostKey.Fingerprint,
                    RequiresHostKeyTrust: true,
                    WhoAmI: null,
                    OsHint: null,
                    Error: "SSH host key not trusted. Confirm fingerprint to proceed.");
            }

            return new ConnectionTestResult(false, hostKey.Fingerprint, false, null, null, "SSH connection failed: " + ex.Message);
        }
        catch (Exception ex)
        {
            return new ConnectionTestResult(false, hostKey.Fingerprint, hostKey.TrustRequired, null, null, ex.Message);
        }
    }

    public async Task<(bool Success, string? HostKeyFingerprint, bool RequiresHostKeyTrust, string Logs)> InstallAgentAsync(
        ConnectionOptions options,
        Uri serverBaseUrl,
        string enrollmentToken,
        bool force,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        progress.Report("Connecting over SSH...");

        using var client = CreateSshClient(options, out var hostKey);
        try
        {
            client.Connect();
        }
        catch (SshConnectionException) when (hostKey.TrustRequired)
        {
            return (false, hostKey.Fingerprint, true, "SSH host key not trusted.");
        }

        progress.Report("Connected. Detecting OS...");

        var uname = Execute(client, "uname -s", maxChars: 4096);
        var unameTrimmed = uname?.Trim();
        var isUnixLike = !string.IsNullOrWhiteSpace(unameTrimmed);

        // If uname returned something plausible, treat as Unix-like. Otherwise assume Windows.
        if (isUnixLike)
        {
            progress.Report($"Detected Unix-like OS (uname={unameTrimmed}).");
            var logs = await InstallLinuxAsync(client, serverBaseUrl, enrollmentToken, force, progress, cancellationToken);
            client.Disconnect();
            return (true, hostKey.Fingerprint, false, logs);
        }
        else
        {
            progress.Report("Assuming Windows target.");
            var logs = await InstallWindowsAsync(client, serverBaseUrl, enrollmentToken, force, progress, cancellationToken);
            client.Disconnect();
            return (true, hostKey.Fingerprint, false, logs);
        }
    }

    private static Task<string> InstallLinuxAsync(
        SshClient client,
        Uri serverBaseUrl,
        string enrollmentToken,
        bool force,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var server = serverBaseUrl.ToString().TrimEnd('/');
        var url = server + "/install.sh";

        progress.Report("Running Linux installer (requires root or passwordless sudo)...");

        var idu = Execute(client, "id -u", maxChars: 64)?.Trim();
        var isRoot = string.Equals(idu, "0", StringComparison.Ordinal);

        // Non-interactive: sudo -n will fail if it needs a password.
        var sudoPrefix = isRoot ? string.Empty : "sudo -n ";

        var forceArg = force ? " --force" : string.Empty;

        // Use curl if present, otherwise wget.
        var cmd = $"sh -c \"set -e; " +
                  $"if command -v curl >/dev/null 2>&1; then DL='curl -fsSL'; " +
                  $"elif command -v wget >/dev/null 2>&1; then DL='wget -qO-'; " +
                  $"else echo 'Need curl or wget' 1>&2; exit 2; fi; " +
                  $"$DL '{EscapeSingleQuotes(url)}' | {sudoPrefix}bash -s -- --server '{EscapeSingleQuotes(server)}' --token '{EscapeSingleQuotes(enrollmentToken)}'{forceArg}\"";

        var output = ExecuteWithExitCheck(client, cmd, maxChars: 200_000);
        progress.Report("Linux installer finished.");
        return Task.FromResult(output);
    }

    private static Task<string> InstallWindowsAsync(
        SshClient client,
        Uri serverBaseUrl,
        string enrollmentToken,
        bool force,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var server = serverBaseUrl.ToString().TrimEnd('/');
        var url = server + "/install.ps1";

        progress.Report("Running Windows installer (requires elevated PowerShell on the target)...");

        var forceArg = force ? " -Force" : string.Empty;

        // Download to %TEMP% then execute with parameters.
        // Note: escaping is delicate. Use single quotes around literals where possible.
        var ps = "$ErrorActionPreference='Stop'; " +
                 "$p = Join-Path $env:TEMP 'manlab-install.ps1'; " +
                 $"Invoke-WebRequest -UseBasicParsing -Uri '{EscapeSingleQuotes(url)}' -OutFile $p; " +
                 $"& $p -Server '{EscapeSingleQuotes(server)}' -AuthToken '{EscapeSingleQuotes(enrollmentToken)}'{forceArg};";

        var cmd = $"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"{EscapeDoubleQuotes(ps)}\"";

        var output = ExecuteWithExitCheck(client, cmd, maxChars: 200_000);
        progress.Report("Windows installer finished.");
        return Task.FromResult(output);
    }

    private sealed class HostKeyState
    {
        public string? Fingerprint { get; set; }
        public bool TrustRequired { get; set; }
    }

    private static SshClient CreateSshClient(ConnectionOptions options, out HostKeyState hostKey)
    {
        var hostKeyState = new HostKeyState();
        hostKey = hostKeyState;

        var authMethods = new List<AuthenticationMethod>();

        switch (options.Auth)
        {
            case PasswordAuth passwordAuth:
                authMethods.Add(new PasswordAuthenticationMethod(options.Username, passwordAuth.Password));
                break;

            case PrivateKeyAuth privateKeyAuth:
            {
                var keyBytes = Encoding.UTF8.GetBytes(privateKeyAuth.PrivateKeyPem);
                using var ms = new MemoryStream(keyBytes);

                PrivateKeyFile keyFile;
                if (!string.IsNullOrEmpty(privateKeyAuth.Passphrase))
                {
                    keyFile = new PrivateKeyFile(ms, privateKeyAuth.Passphrase);
                }
                else
                {
                    keyFile = new PrivateKeyFile(ms);
                }

                authMethods.Add(new PrivateKeyAuthenticationMethod(options.Username, keyFile));
                break;
            }

            default:
                throw new ArgumentOutOfRangeException(nameof(options.Auth), "Unknown SSH auth mode");
        }

        var connectionInfo = new Renci.SshNet.ConnectionInfo(options.Host, options.Port, options.Username, authMethods.ToArray());

        var client = new SshClient(connectionInfo);
        client.HostKeyReceived += (_, e) =>
        {
            hostKeyState.Fingerprint = ComputeHostKeyFingerprint(e.HostKey);

            if (!string.IsNullOrWhiteSpace(options.ExpectedHostKeyFingerprint))
            {
                e.CanTrust = string.Equals(options.ExpectedHostKeyFingerprint.Trim(), hostKeyState.Fingerprint, StringComparison.OrdinalIgnoreCase);
                if (!e.CanTrust)
                {
                    hostKeyState.TrustRequired = true;
                }

                return;
            }

            if (options.TrustOnFirstUse)
            {
                e.CanTrust = true;
                return;
            }

            // Not trusted yet (TOFU prompt).
            e.CanTrust = false;
            hostKeyState.TrustRequired = true;
        };

        return client;
    }

    private static string? Execute(SshClient client, string commandText, int maxChars)
    {
        var cmd = client.CreateCommand(commandText);
        var result = cmd.Execute();
        var combined = (result ?? string.Empty) + (string.IsNullOrWhiteSpace(cmd.Error) ? string.Empty : "\n" + cmd.Error);

        if (combined.Length > maxChars)
        {
            return combined[..maxChars];
        }

        return combined;
    }

    private static string ExecuteWithExitCheck(SshClient client, string commandText, int maxChars)
    {
        var cmd = client.CreateCommand(commandText);
        var result = cmd.Execute();

        var combined = (result ?? string.Empty) + (string.IsNullOrWhiteSpace(cmd.Error) ? string.Empty : "\n" + cmd.Error);
        if (combined.Length > maxChars)
        {
            combined = combined[..maxChars];
        }

        if (cmd.ExitStatus != 0)
        {
            throw new InvalidOperationException($"Remote command failed (exit={cmd.ExitStatus}): {combined}");
        }

        return combined;
    }

    private static string ComputeHostKeyFingerprint(byte[] hostKey)
    {
        // Matches common OpenSSH display: SHA256:<base64>
        var hash = SHA256.HashData(hostKey);
        var b64 = Convert.ToBase64String(hash).TrimEnd('=');
        return "SHA256:" + b64;
    }

    private static string EscapeSingleQuotes(string s) => s.Replace("'", "'\\''");

    private static string EscapeDoubleQuotes(string s) => s.Replace("\"", "\\\"");
}
