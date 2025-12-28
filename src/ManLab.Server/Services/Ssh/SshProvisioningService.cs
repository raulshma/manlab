using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace ManLab.Server.Services.Ssh;

public sealed class SshProvisioningService
{
    private readonly Services.ISettingsService _settingsService;

    public SshProvisioningService(Services.ISettingsService settingsService)
    {
        _settingsService = settingsService;
    }
    public sealed record TargetInfo(
        string OsFamily,
        string? OsDistro,
        string? OsVersion,
        string? CpuArch,
        string? Raw);

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

    public sealed record InventorySection(string Label, IReadOnlyList<string> Items);

    public sealed record UninstallPreviewResult(
        bool Success,
        string? HostKeyFingerprint,
        bool RequiresHostKeyTrust,
        string? OsHint,
        IReadOnlyList<InventorySection> Sections,
        string? Error);

    public async Task<ConnectionTestResult> TestConnectionAsync(ConnectionOptions options, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        using var client = CreateSshClient(options, out var hostKey);
        try
        {
            client.Connect();

            var whoami = Execute(client, "whoami", maxChars: 4096);
            var target = DetectTarget(client);

            client.Disconnect();

            var osHint = target.Raw;

            return new ConnectionTestResult(
                Success: true,
                HostKeyFingerprint: hostKey.Fingerprint,
                RequiresHostKeyTrust: false,
                WhoAmI: whoami?.Trim(),
                OsHint: osHint?.Trim(),
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

        var target = DetectTarget(client);
        progress.Report($"Detected target: {target.Raw}");

        if (string.Equals(target.OsFamily, "linux", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(target.OsFamily, "unix", StringComparison.OrdinalIgnoreCase))
        {
            var logs = await InstallLinuxAsync(client, serverBaseUrl, enrollmentToken, force, progress, cancellationToken);
            client.Disconnect();
            return (true, hostKey.Fingerprint, false, logs);
        }
        else
        {
            var logs = await InstallWindowsAsync(client, serverBaseUrl, enrollmentToken, force, progress, cancellationToken);
            client.Disconnect();
            return (true, hostKey.Fingerprint, false, logs);
        }
    }

    public async Task<(bool Success, string? HostKeyFingerprint, bool RequiresHostKeyTrust, string Logs)> UninstallAgentAsync(
        ConnectionOptions options,
        Uri serverBaseUrl,
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

        var target = DetectTarget(client);
        progress.Report($"Detected target: {target.Raw}");

        if (string.Equals(target.OsFamily, "linux", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(target.OsFamily, "unix", StringComparison.OrdinalIgnoreCase))
        {
            var logs = await UninstallLinuxAsync(client, serverBaseUrl, progress, cancellationToken);
            client.Disconnect();
            return (true, hostKey.Fingerprint, false, logs);
        }
        else
        {
            var logs = await UninstallWindowsAsync(client, serverBaseUrl, progress, cancellationToken);
            client.Disconnect();
            return (true, hostKey.Fingerprint, false, logs);
        }
    }

    public async Task<UninstallPreviewResult> GetUninstallPreviewAsync(
        ConnectionOptions options,
        Uri serverBaseUrl,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        using var client = CreateSshClient(options, out var hostKey);
        try
        {
            client.Connect();
        }
        catch (SshConnectionException) when (hostKey.TrustRequired)
        {
            return new UninstallPreviewResult(
                Success: false,
                HostKeyFingerprint: hostKey.Fingerprint,
                RequiresHostKeyTrust: true,
                OsHint: null,
                Sections: Array.Empty<InventorySection>(),
                Error: "SSH host key not trusted.");
        }

        var target = DetectTarget(client);
        var osHint = target.Raw?.Trim();

        var server = serverBaseUrl.ToString().TrimEnd('/');
        string cmd;

        if (string.Equals(target.OsFamily, "linux", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(target.OsFamily, "unix", StringComparison.OrdinalIgnoreCase))
        {
            var url = server + "/install.sh";
            cmd = BuildLinuxUninstallPreviewCommand(url);
        }
        else
        {
            var url = server + "/install.ps1";
            cmd = BuildWindowsUninstallPreviewCommand(url);
        }

        string output;
        try
        {
            output = ExecuteWithExitCheck(client, cmd, maxChars: 200_000);
        }
        catch (Exception ex)
        {
            client.Disconnect();
            return new UninstallPreviewResult(
                Success: false,
                HostKeyFingerprint: hostKey.Fingerprint,
                RequiresHostKeyTrust: false,
                OsHint: osHint,
                Sections: Array.Empty<InventorySection>(),
                Error: "Failed to collect preview: " + ex.Message);
        }

        client.Disconnect();

        if (!TryExtractFirstJsonObject(output, out var json))
        {
            return new UninstallPreviewResult(
                Success: false,
                HostKeyFingerprint: hostKey.Fingerprint,
                RequiresHostKeyTrust: false,
                OsHint: osHint,
                Sections: Array.Empty<InventorySection>(),
                Error: "Remote preview did not return valid JSON.");
        }

        try
        {
            var payload = JsonSerializer.Deserialize<UninstallPreviewPayload>(json, JsonOptions);

            var sections = new List<InventorySection>();
            if (payload?.Sections is { Count: > 0 })
            {
                foreach (var s in payload.Sections)
                {
                    if (string.IsNullOrWhiteSpace(s.Label)) continue;
                    sections.Add(new InventorySection(s.Label.Trim(), (s.Items ?? new List<string>()).Where(i => !string.IsNullOrWhiteSpace(i)).ToArray()));
                }
            }

            if (payload?.Notes is { Count: > 0 })
            {
                sections.Add(new InventorySection("Notes", payload.Notes.Where(n => !string.IsNullOrWhiteSpace(n)).ToArray()));
            }

            return new UninstallPreviewResult(
                Success: payload?.Success ?? false,
                HostKeyFingerprint: hostKey.Fingerprint,
                RequiresHostKeyTrust: false,
                OsHint: payload?.OsHint ?? osHint,
                Sections: sections,
                Error: payload?.Error);
        }
        catch (Exception ex)
        {
            return new UninstallPreviewResult(
                Success: false,
                HostKeyFingerprint: hostKey.Fingerprint,
                RequiresHostKeyTrust: false,
                OsHint: osHint,
                Sections: Array.Empty<InventorySection>(),
                Error: "Failed to parse remote preview JSON: " + ex.Message);
        }
    }

    /// <summary>
    /// Best-effort diagnostics collection intended for onboarding failures.
    /// Never throws for common remote errors; returns a human-readable report.
    /// </summary>
    public Task<string> CollectAgentDiagnosticsAsync(ConnectionOptions options, Uri serverBaseUrl, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        using var client = CreateSshClient(options, out _);
        var sb = new StringBuilder();
        sb.AppendLine("--- Target diagnostics (best-effort) ---");
        sb.AppendLine($"Timestamp (UTC): {DateTime.UtcNow:O}");

        try
        {
            client.Connect();

            var target = DetectTarget(client);
            sb.AppendLine($"Detected OS: {target.Raw}");

            if (string.Equals(target.OsFamily, "linux", StringComparison.OrdinalIgnoreCase))
            {
                sb.AppendLine("\n# systemd service status");
                sb.AppendLine(Execute(client, "sh -c 'systemctl --no-pager --full status manlab-agent.service 2>&1 || true'", maxChars: 50_000) ?? string.Empty);

                sb.AppendLine("\n# recent journal (manlab-agent)");
                sb.AppendLine(Execute(client, "sh -c 'journalctl --no-pager -u manlab-agent -n 200 2>&1 || true'", maxChars: 80_000) ?? string.Empty);

                sb.AppendLine("\n# environment (redacted)");
                sb.AppendLine(Execute(client,
                    "sh -c 'if [ -f /etc/manlab-agent.env ]; then sed -e " +
                    "\"s/^MANLAB_AUTH_TOKEN=.*/MANLAB_AUTH_TOKEN=<redacted>/\" /etc/manlab-agent.env; " +
                    "else echo \"/etc/manlab-agent.env not found\"; fi'",
                    maxChars: 8_192) ?? string.Empty);

                sb.AppendLine("\n# install directory");
                sb.AppendLine(Execute(client, "sh -c 'ls -la /opt/manlab-agent 2>&1 || true'", maxChars: 8_192) ?? string.Empty);

                sb.AppendLine("\n# binary probe");
                sb.AppendLine(Execute(client, "sh -c 'test -x /opt/manlab-agent/manlab-agent && echo BINARY_OK || echo BINARY_MISSING'", maxChars: 512) ?? string.Empty);

                // Quick reachability probe to the server (installers already require curl or wget).
                var server = serverBaseUrl.ToString().TrimEnd('/');
                sb.AppendLine("\n# server reachability probe");
                sb.AppendLine(Execute(client,
                    "sh -c 'set -e; URL=\"" + EscapeSingleQuotes(server) + "/install.sh\"; " +
                    "if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 5 --max-time 10 \"$URL\" >/dev/null && echo SERVER_OK || echo SERVER_UNREACHABLE; " +
                    "elif command -v wget >/dev/null 2>&1; then wget -qO- --timeout=10 \"$URL\" >/dev/null && echo SERVER_OK || echo SERVER_UNREACHABLE; " +
                    "else echo NO_CURL_OR_WGET; fi'",
                    maxChars: 2_048) ?? string.Empty);
            }
            else
            {
                // Windows over OpenSSH
                sb.AppendLine("\n# Windows service status");
                var ps = "try { " +
                         "Get-Service -Name 'manlab-agent' -ErrorAction Stop | Format-List -Property *; " +
                         "} catch { Write-Output $_.Exception.Message }";
                sb.AppendLine(Execute(client,
                    $"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"{EscapeDoubleQuotes(ps)}\"",
                    maxChars: 50_000) ?? string.Empty);

                sb.AppendLine("\n# agent install directory probe");
                var ps2 = "try { " +
                          "Get-ChildItem 'C:\\ProgramData\\ManLab\\Agent' -Force | Format-Table -AutoSize; " +
                          "} catch { Write-Output $_.Exception.Message }";
                sb.AppendLine(Execute(client,
                    $"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"{EscapeDoubleQuotes(ps2)}\"",
                    maxChars: 20_000) ?? string.Empty);
            }

            client.Disconnect();
        }
        catch (Exception ex)
        {
            // Best-effort: return what we have plus the failure.
            sb.AppendLine("\nDiagnostics collection failed: " + ex.Message);
        }

        return Task.FromResult(sb.ToString());
    }

    private async Task<string> InstallLinuxAsync(
        SshClient client,
        Uri serverBaseUrl,
        string enrollmentToken,
        bool force,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // Idempotency: if already installed, automatically enable force to avoid a hard failure.
        if (!force)
        {
            var installedProbe = Execute(client, "sh -c 'test -x /opt/manlab-agent/manlab-agent && echo INSTALLED || true'", maxChars: 64);
            if (installedProbe?.Trim().Equals("INSTALLED", StringComparison.OrdinalIgnoreCase) == true)
            {
                progress.Report("Existing agent installation detected on target; reinstalling in-place (idempotent run). ");
                force = true;
            }
        }

        var server = serverBaseUrl.ToString().TrimEnd('/');
        var url = server + "/install.sh";

        progress.Report("Running Linux installer (requires root or passwordless sudo)...");

        var idu = Execute(client, "id -u", maxChars: 64)?.Trim();
        var isRoot = string.Equals(idu, "0", StringComparison.Ordinal);

        // Non-interactive: sudo -n will fail if it needs a password.
        var sudoPrefix = isRoot ? string.Empty : "sudo -n ";

        var forceArg = force ? " --force" : string.Empty;

        // If GitHub release downloads are enabled in server settings, pass the config directly to the installer.
        // This avoids relying on python3/jq being installed on minimal Linux images to parse JSON.
        var githubEnabled = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.EnableGitHubDownload, false);
        var githubBaseUrl = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.ReleaseBaseUrl);
        var githubVersion = await _settingsService.GetValueAsync(Constants.SettingKeys.GitHub.LatestVersion);

        progress.Report($"GitHub settings read: enabled={githubEnabled}, baseUrl={(string.IsNullOrWhiteSpace(githubBaseUrl) ? "<empty>" : githubBaseUrl.Trim())}, version={(string.IsNullOrWhiteSpace(githubVersion) ? "<empty>" : githubVersion.Trim())}.");

        var githubArgs = string.Empty;
        if (githubEnabled && !string.IsNullOrWhiteSpace(githubBaseUrl) && !string.IsNullOrWhiteSpace(githubVersion))
        {
            progress.Report($"GitHub Releases download is enabled (base={githubBaseUrl.Trim().TrimEnd('/')}, version={githubVersion.Trim()}).");
            // Match install.sh flags.
            githubArgs =
                " --prefer-github" +
                $" --github-release-base-url '{EscapeSingleQuotes(githubBaseUrl.Trim())}'" +
                $" --github-version '{EscapeSingleQuotes(githubVersion.Trim())}'";
        }
        else
        {
            progress.Report("GitHub Releases download is not enabled (or missing base URL/version); installer may fall back to server-staged binaries.");
        }

        var cmd = BuildLinuxInstallCommand(server, url, enrollmentToken, sudoPrefix, forceArg, githubArgs);

        var output = ExecuteWithExitCheck(client, cmd, maxChars: 200_000);
        progress.Report("Linux installer finished.");
        return RedactToken(output, enrollmentToken);
    }

    internal static string BuildLinuxInstallCommand(string server, string url, string enrollmentToken, string sudoPrefix, string forceArg, string? extraInstallerArgs = null)
    {
        // IMPORTANT: do not stream the installer into bash via a plain pipeline under /bin/sh.
        // Instead: download to a temp file, then execute it; propagate failures reliably.
        // Also apply reasonable timeouts so onboarding doesn't hang for minutes on unreachable servers.
        //
        // NOTE: avoid bash arrays like DL=(...) and "${DL[@]}" here.
        // They are easy to accidentally break when passing through multiple escaping layers, and a broken
        // temp path/redirection can produce confusing syntax errors (e.g. "> ; chmod +x ; bash  --server ...").

        // Use a single-quoted bash -lc script to prevent the *outer* login shell from expanding $URL/$TMP.
        // This avoids subtle multi-layer quoting bugs that can produce malformed curl/wget arguments.
        var safeServer = EscapeSingleQuotes(server);
        var safeUrl = EscapeSingleQuotes(url);
        var safeToken = EscapeSingleQuotes(enrollmentToken);

        var script =
            "set -euo pipefail; " +
            "if ! command -v bash >/dev/null 2>&1; then echo 'Need bash' 1>&2; exit 2; fi; " +
            $"URL='{safeUrl}'; " +
            // Prefer explicit template path for portability across mktemp variants.
            "TMP=\"$(mktemp /tmp/manlab-install.XXXXXX)\"; " +
            "if [ -z \"$TMP\" ]; then echo 'mktemp produced empty TMP' 1>&2; exit 2; fi; " +
            // Use a double-quoted trap body so we don't need single quotes inside the single-quoted script.
            "trap \"rm -f \\\"$TMP\\\"\" EXIT; " +
            "if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 5 --max-time 120 \"$URL\" -o \"$TMP\"; " +
            "elif command -v wget >/dev/null 2>&1; then wget -q --timeout=120 -O \"$TMP\" \"$URL\"; " +
            "else echo 'Need curl or wget' 1>&2; exit 2; fi; " +
            // Defensive: strip CR if the script was served with CRLF (common when the server runs on Windows).
            "if command -v sed >/dev/null 2>&1; then sed -i 's/\r$//' \"$TMP\" 2>/dev/null || true; " +
            "else tr -d '\\r' < \"$TMP\" > \"$TMP.clean\" && mv -f \"$TMP.clean\" \"$TMP\"; fi; " +
            "chmod +x \"$TMP\"; " +
            $"{sudoPrefix}bash \"$TMP\" --server '{safeServer}' --token '{safeToken}'{forceArg}{(string.IsNullOrWhiteSpace(extraInstallerArgs) ? string.Empty : extraInstallerArgs)}";

        return $"bash -lc '{EscapeSingleQuotes(script)}'";
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

        // Idempotency: if already installed, automatically enable force to avoid a hard failure.
        if (!force)
        {
            var installedProbe = Execute(client,
                "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"if (Test-Path 'C:\\\\ProgramData\\\\ManLab\\\\Agent\\\\manlab-agent.exe') { 'INSTALLED' }\"",
                maxChars: 128);
            if (installedProbe?.Trim().Equals("INSTALLED", StringComparison.OrdinalIgnoreCase) == true)
            {
                progress.Report("Existing agent installation detected on target; reinstalling in-place (idempotent run). ");
                force = true;
            }
        }

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
        return Task.FromResult(RedactToken(output, enrollmentToken));
    }

    private static Task<string> UninstallLinuxAsync(
        SshClient client,
        Uri serverBaseUrl,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var server = serverBaseUrl.ToString().TrimEnd('/');
        var url = server + "/install.sh";

        progress.Report("Running Linux uninstaller (requires root or passwordless sudo)...");

        var idu = Execute(client, "id -u", maxChars: 64)?.Trim();
        var isRoot = string.Equals(idu, "0", StringComparison.Ordinal);
        var sudoPrefix = isRoot ? string.Empty : "sudo -n ";

          var cmd = BuildLinuxUninstallCommand(url, sudoPrefix);

        var output = ExecuteWithExitCheck(client, cmd, maxChars: 200_000);
        progress.Report("Linux uninstaller finished.");
        return Task.FromResult(output);
    }

    internal static string BuildLinuxUninstallCommand(string url, string sudoPrefix)
    {
        var safeUrl = EscapeSingleQuotes(url);

        var script =
            "set -euo pipefail; " +
            "if ! command -v bash >/dev/null 2>&1; then echo 'Need bash' 1>&2; exit 2; fi; " +
            $"URL='{safeUrl}'; " +
            "TMP=\"$(mktemp /tmp/manlab-install.XXXXXX)\"; " +
            "if [ -z \"$TMP\" ]; then echo 'mktemp produced empty TMP' 1>&2; exit 2; fi; " +
            "trap \"rm -f \\\"$TMP\\\"\" EXIT; " +
            "if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 5 --max-time 120 \"$URL\" -o \"$TMP\"; " +
            "elif command -v wget >/dev/null 2>&1; then wget -q --timeout=120 -O \"$TMP\" \"$URL\"; " +
            "else echo 'Need curl or wget' 1>&2; exit 2; fi; " +
            "if command -v sed >/dev/null 2>&1; then sed -i 's/\r$//' \"$TMP\" 2>/dev/null || true; " +
            "else tr -d '\\r' < \"$TMP\" > \"$TMP.clean\" && mv -f \"$TMP.clean\" \"$TMP\"; fi; " +
            "chmod +x \"$TMP\"; " +
            $"{sudoPrefix}bash \"$TMP\" --uninstall";

        return $"bash -lc '{EscapeSingleQuotes(script)}'";
    }

    internal static string BuildLinuxUninstallPreviewCommand(string url)
    {
        var safeUrl = EscapeSingleQuotes(url);

        var script =
            "set -euo pipefail; " +
            "if ! command -v bash >/dev/null 2>&1; then echo 'Need bash' 1>&2; exit 2; fi; " +
            $"URL='{safeUrl}'; " +
            "TMP=\"$(mktemp /tmp/manlab-install.XXXXXX)\"; " +
            "if [ -z \"$TMP\" ]; then echo 'mktemp produced empty TMP' 1>&2; exit 2; fi; " +
            "trap \"rm -f \\\"$TMP\\\"\" EXIT; " +
            "if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 5 --max-time 120 \"$URL\" -o \"$TMP\"; " +
            "elif command -v wget >/dev/null 2>&1; then wget -q --timeout=120 -O \"$TMP\" \"$URL\"; " +
            "else echo 'Need curl or wget' 1>&2; exit 2; fi; " +
            "if command -v sed >/dev/null 2>&1; then sed -i 's/\r$//' \"$TMP\" 2>/dev/null || true; " +
            "else tr -d '\\r' < \"$TMP\" > \"$TMP.clean\" && mv -f \"$TMP.clean\" \"$TMP\"; fi; " +
            "chmod +x \"$TMP\"; " +
            "bash \"$TMP\" --preview-uninstall";

        return $"bash -lc '{EscapeSingleQuotes(script)}'";
    }

    private static Task<string> UninstallWindowsAsync(
        SshClient client,
        Uri serverBaseUrl,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var server = serverBaseUrl.ToString().TrimEnd('/');
        var url = server + "/install.ps1";

        progress.Report("Running Windows uninstaller (requires elevated PowerShell on the target)...");

        // Download to %TEMP% then execute with -Uninstall.
        var ps = "$ErrorActionPreference='Stop'; " +
                 "$p = Join-Path $env:TEMP 'manlab-install.ps1'; " +
                 $"Invoke-WebRequest -UseBasicParsing -Uri '{EscapeSingleQuotes(url)}' -OutFile $p; " +
                 "& $p -Uninstall -UninstallAll;";

        var cmd = $"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"{EscapeDoubleQuotes(ps)}\"";

        var output = ExecuteWithExitCheck(client, cmd, maxChars: 200_000);
        progress.Report("Windows uninstaller finished.");
        return Task.FromResult(output);
    }

    internal static string BuildWindowsUninstallPreviewCommand(string url)
    {
        var safeUrl = EscapeSingleQuotes(url);
        var ps = "$ErrorActionPreference='Stop'; " +
                 "$p = Join-Path $env:TEMP 'manlab-install.ps1'; " +
                 $"Invoke-WebRequest -UseBasicParsing -Uri '{safeUrl}' -OutFile $p; " +
                 "& $p -PreviewUninstall;";

        return $"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"{EscapeDoubleQuotes(ps)}\"";
    }

    private sealed record InventorySectionPayload(
        [property: JsonPropertyName("label")] string Label,
        [property: JsonPropertyName("items")] List<string>? Items);

    private sealed record UninstallPreviewPayload(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("osHint")] string? OsHint,
        [property: JsonPropertyName("sections")] List<InventorySectionPayload>? Sections,
        [property: JsonPropertyName("notes")] List<string>? Notes,
        [property: JsonPropertyName("error")] string? Error);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private static bool TryExtractFirstJsonObject(string text, out string json)
    {
        json = string.Empty;
        if (string.IsNullOrWhiteSpace(text)) return false;

        var start = text.IndexOf('{');
        if (start < 0) return false;

        var depth = 0;
        for (var i = start; i < text.Length; i++)
        {
            var c = text[i];
            if (c == '{') depth++;
            else if (c == '}') depth--;

            if (depth == 0)
            {
                json = text.Substring(start, i - start + 1);
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Upload a file over SFTP.
    /// </summary>
    public Task UploadFileAsync(ConnectionOptions options, Stream content, string remotePath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        using var sftp = CreateSftpClient(options, out _);
        sftp.Connect();
        sftp.UploadFile(content, remotePath, canOverride: true);
        sftp.Disconnect();
        return Task.CompletedTask;
    }

    /// <summary>
    /// Download a file over SFTP.
    /// </summary>
    public Task DownloadFileAsync(ConnectionOptions options, string remotePath, Stream destination, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        using var sftp = CreateSftpClient(options, out _);
        sftp.Connect();
        sftp.DownloadFile(remotePath, destination);
        sftp.Disconnect();
        return Task.CompletedTask;
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
        return CreateSshClient(connectionInfo, options, hostKeyState);
    }

    private static SshClient CreateSshClient(Renci.SshNet.ConnectionInfo connectionInfo, ConnectionOptions options, HostKeyState hostKeyState)
    {
        var client = new SshClient(connectionInfo);
        client.HostKeyReceived += (_, e) => ApplyHostKeyPolicy(options, hostKeyState, e);
        return client;
    }

    private static SftpClient CreateSftpClient(ConnectionOptions options, out HostKeyState hostKey)
    {
        var hostKeyState = new HostKeyState();
        hostKey = hostKeyState;

        // Reuse the same auth construction as SSH.
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
        var sftp = new SftpClient(connectionInfo);
        sftp.HostKeyReceived += (_, e) => ApplyHostKeyPolicy(options, hostKeyState, e);
        return sftp;
    }

    private static void ApplyHostKeyPolicy(ConnectionOptions options, HostKeyState hostKeyState, HostKeyEventArgs e)
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
    }

    private static TargetInfo DetectTarget(SshClient client)
    {
        // Best-effort:
        // - Linux: uname + /etc/os-release
        // - Windows: PowerShell probes

        var unameS = Execute(client, "uname -s 2>/dev/null || true", maxChars: 256)?.Trim();
        var unameM = Execute(client, "uname -m 2>/dev/null || true", maxChars: 256)?.Trim();

        if (!string.IsNullOrWhiteSpace(unameS))
        {
            var osRelease = Execute(client, "sh -c 'cat /etc/os-release 2>/dev/null || true'", maxChars: 16_384);
            var (id, versionId, name) = ParseOsRelease(osRelease);
            var distro = id ?? name;

            var raw = string.Join(' ', new[]
            {
                "Linux",
                distro,
                versionId,
                string.IsNullOrWhiteSpace(unameM) ? null : unameM
            }.Where(s => !string.IsNullOrWhiteSpace(s)));

            return new TargetInfo(
                OsFamily: "linux",
                OsDistro: distro,
                OsVersion: versionId,
                CpuArch: unameM,
                Raw: raw);
        }

        // Windows target over OpenSSH: try PowerShell.
        var ps = "try {" +
                 " $arch=$env:PROCESSOR_ARCHITECTURE;" +
                 " $caption=(Get-CimInstance Win32_OperatingSystem).Caption;" +
                 " $ver=(Get-CimInstance Win32_OperatingSystem).Version;" +
                 " Write-Output ('Windows|' + $caption + '|' + $ver + '|' + $arch);" +
                 " } catch { Write-Output 'Windows|||'; }";

        var win = Execute(client, $"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"{EscapeDoubleQuotes(ps)}\"", maxChars: 2048)?.Trim();
        var parts = (win ?? string.Empty).Split('|');
        var caption = parts.Length > 1 ? parts[1] : null;
        var ver2 = parts.Length > 2 ? parts[2] : null;
        var arch2 = parts.Length > 3 ? parts[3] : null;
        var rawWin = string.Join(' ', new[] { "Windows", caption, ver2, arch2 }.Where(s => !string.IsNullOrWhiteSpace(s)));

        return new TargetInfo(
            OsFamily: "windows",
            OsDistro: caption,
            OsVersion: ver2,
            CpuArch: arch2,
            Raw: rawWin);
    }

    private static (string? Id, string? VersionId, string? Name) ParseOsRelease(string? osRelease)
    {
        if (string.IsNullOrWhiteSpace(osRelease)) return (null, null, null);

        string? id = null;
        string? version = null;
        string? name = null;

        foreach (var line in osRelease.Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;

            var idx = trimmed.IndexOf('=');
            if (idx <= 0) continue;

            var key = trimmed[..idx];
            var value = trimmed[(idx + 1)..].Trim().Trim('"');

            switch (key)
            {
                case "ID":
                    id = value;
                    break;
                case "VERSION_ID":
                    version = value;
                    break;
                case "NAME":
                    name = value;
                    break;
            }
        }

        return (id, version, name);
    }

    private static string RedactToken(string input, string token)
    {
        if (string.IsNullOrEmpty(input) || string.IsNullOrEmpty(token)) return input;
        return input.Replace(token, "<redacted>", StringComparison.Ordinal);
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
