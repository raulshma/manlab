using System.IO.Compression;
using Renci.SshNet;
using Renci.SshNet.Sftp;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services.Ssh;

/// <summary>
/// Service for SSH/SFTP-based file operations using stored onboarding credentials.
/// This bypasses the agent and connects directly to the target machine via SSH.
/// </summary>
public sealed class SshFileService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly CredentialEncryptionService _encryptionService;
    private readonly ILogger<SshFileService> _logger;

    public SshFileService(
        IServiceScopeFactory scopeFactory,
        CredentialEncryptionService encryptionService,
        ILogger<SshFileService> logger)
    {
        _scopeFactory = scopeFactory;
        _encryptionService = encryptionService;
        _logger = logger;
    }

    /// <summary>
    /// Result of resolving SSH credentials for a node.
    /// </summary>
    public sealed record SshCredentialsResult(
        bool Success,
        OnboardingMachine? Machine,
        SshProvisioningService.AuthOptions? Auth,
        string? Error);

    /// <summary>
    /// Result of listing files via SSH.
    /// </summary>
    public sealed record SshFileListResult(
        bool Success,
        IReadOnlyList<SshFileEntry> Entries,
        bool Truncated,
        string? Error);

    /// <summary>
    /// A file entry returned from SSH file listing.
    /// </summary>
    public sealed record SshFileEntry(
        string Name,
        string Path,
        bool IsDirectory,
        long? Size,
        DateTime? LastModified);

    /// <summary>
    /// Resolves SSH credentials for a node by finding the linked onboarding machine.
    /// </summary>
    public async Task<SshCredentialsResult> GetCredentialsForNodeAsync(Guid nodeId, CancellationToken ct)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Find onboarding machine linked to this node
        var machine = await db.OnboardingMachines
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.LinkedNodeId == nodeId, ct);

        if (machine is null)
        {
            return new SshCredentialsResult(false, null, null, "No onboarding machine linked to this node. SSH credentials are required.");
        }

        // Check if credentials are saved
        var hasCredentials = machine.AuthMode == SshAuthMode.Password
            ? !string.IsNullOrWhiteSpace(machine.EncryptedSshPassword)
            : !string.IsNullOrWhiteSpace(machine.EncryptedPrivateKeyPem);

        if (!hasCredentials)
        {
            return new SshCredentialsResult(false, machine, null, "SSH credentials not saved for this machine. Save credentials in the onboarding settings.");
        }

        // Decrypt credentials
        SshProvisioningService.AuthOptions auth;
        try
        {
            if (machine.AuthMode == SshAuthMode.Password)
            {
                var password = await _encryptionService.DecryptAsync(machine.EncryptedSshPassword!, ct);
                if (string.IsNullOrEmpty(password))
                {
                    return new SshCredentialsResult(false, machine, null, "SSH password is empty after decryption.");
                }
                auth = new SshProvisioningService.PasswordAuth(password);
            }
            else
            {
                var privateKeyPem = await _encryptionService.DecryptAsync(machine.EncryptedPrivateKeyPem!, ct);
                if (string.IsNullOrEmpty(privateKeyPem))
                {
                    return new SshCredentialsResult(false, machine, null, "SSH private key is empty after decryption.");
                }
                string? passphrase = null;
                if (!string.IsNullOrWhiteSpace(machine.EncryptedPrivateKeyPassphrase))
                {
                    passphrase = await _encryptionService.DecryptAsync(machine.EncryptedPrivateKeyPassphrase, ct);
                }
                auth = new SshProvisioningService.PrivateKeyAuth(privateKeyPem, passphrase);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to decrypt SSH credentials for node {NodeId}", nodeId);
            return new SshCredentialsResult(false, machine, null, "Failed to decrypt SSH credentials.");
        }

        return new SshCredentialsResult(true, machine, auth, null);
    }

    /// <summary>
    /// Lists files in a directory via SFTP.
    /// </summary>
    public async Task<SshFileListResult> ListFilesAsync(
        Guid nodeId,
        string virtualPath,
        int maxEntries,
        CancellationToken ct)
    {
        var creds = await GetCredentialsForNodeAsync(nodeId, ct);
        if (!creds.Success || creds.Machine is null || creds.Auth is null)
        {
            return new SshFileListResult(false, [], false, creds.Error);
        }

        var machine = creds.Machine;

        try
        {
            // Always detect OS first - needed for proper path conversion
            var isWindows = await IsWindowsAsync(machine, creds.Auth, ct);

            using var sftp = CreateSftpClient(machine, creds.Auth);
            sftp.Connect();

            // Convert virtual path to real path (Windows OpenSSH uses /c/ for C:\)
            var realPath = VirtualToRealPath(virtualPath, sftp, isWindows);

            // Handle root listing (list available drives on Windows, or just "/" on Linux)
            if (string.IsNullOrWhiteSpace(realPath) || realPath == "/")
            {
                if (isWindows)
                {
                    // List Windows drives
                    var drives = await ListWindowsDrivesAsync(machine, creds.Auth, ct);
                    var driveEntries = drives.Select(d => new SshFileEntry(
                        Name: d,
                        Path: "/" + d.TrimEnd(':').ToUpperInvariant(),
                        IsDirectory: true,
                        Size: null,
                        LastModified: null
                    )).ToList();

                    sftp.Disconnect();
                    return new SshFileListResult(true, driveEntries, false, null);
                }
                else
                {
                    realPath = "/";
                }
            }

            var entries = new List<SshFileEntry>();
            var truncated = false;

            try
            {
                var files = sftp.ListDirectory(realPath);
                var count = 0;

                foreach (var file in files)
                {
                    if (file.Name == "." || file.Name == "..")
                        continue;

                    if (count >= maxEntries)
                    {
                        truncated = true;
                        break;
                    }

                    var entryPath = virtualPath.TrimEnd('/') + "/" + file.Name;
                    if (virtualPath == "/" || string.IsNullOrEmpty(virtualPath))
                    {
                        entryPath = "/" + file.Name;
                    }

                    entries.Add(new SshFileEntry(
                        Name: file.Name,
                        Path: entryPath,
                        IsDirectory: file.IsDirectory,
                        Size: file.IsDirectory ? null : file.Length,
                        LastModified: file.LastWriteTime
                    ));

                    count++;
                }
            }
            catch (Renci.SshNet.Common.SftpPathNotFoundException)
            {
                sftp.Disconnect();
                return new SshFileListResult(false, [], false, $"Path not found: {realPath}");
            }
            catch (Renci.SshNet.Common.SftpPermissionDeniedException)
            {
                sftp.Disconnect();
                return new SshFileListResult(false, [], false, $"Permission denied: {realPath}");
            }

            sftp.Disconnect();
            return new SshFileListResult(true, entries, truncated, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to list files via SSH for node {NodeId} at path {Path}", nodeId, virtualPath);
            return new SshFileListResult(false, [], false, $"SSH error: {ex.Message}");
        }
    }

    /// <summary>
    /// Downloads a file via SFTP and streams it to the provided output.
    /// </summary>
    public async Task DownloadFileAsync(
        Guid nodeId,
        string virtualPath,
        Stream outputStream,
        IProgress<(long bytesTransferred, long totalBytes)>? progress,
        CancellationToken ct)
    {
        var creds = await GetCredentialsForNodeAsync(nodeId, ct);
        if (!creds.Success || creds.Machine is null || creds.Auth is null)
        {
            throw new InvalidOperationException(creds.Error ?? "SSH credentials not available");
        }

        var machine = creds.Machine;

        // Detect OS for proper path conversion
        var isWindows = await IsWindowsAsync(machine, creds.Auth, ct);

        using var sftp = CreateSftpClient(machine, creds.Auth);
        sftp.Connect();

        var realPath = VirtualToRealPath(virtualPath, sftp, isWindows);

        try
        {
            // Get file size for progress reporting
            var attrs = sftp.GetAttributes(realPath);
            var totalBytes = attrs.Size;

            // Download with progress callback
            long bytesTransferred = 0;
            sftp.DownloadFile(realPath, outputStream, downloaded =>
            {
                bytesTransferred = (long)downloaded;
                progress?.Report((bytesTransferred, totalBytes));
            });

            await outputStream.FlushAsync(ct);
        }
        catch (Renci.SshNet.Common.SftpPathNotFoundException)
        {
            throw new FileNotFoundException($"File not found: {virtualPath}");
        }
        catch (Renci.SshNet.Common.SftpPermissionDeniedException)
        {
            throw new UnauthorizedAccessException($"Permission denied: {virtualPath}");
        }
        finally
        {
            sftp.Disconnect();
        }
    }

    /// <summary>
    /// Downloads multiple files/folders as a zip archive via SFTP.
    /// Creates the zip in a temp file first to avoid synchronous I/O issues with response streams.
    /// </summary>
    public async Task DownloadAsZipAsync(
        Guid nodeId,
        string[] virtualPaths,
        Stream outputStream,
        IProgress<(long filesProcessed, long totalFiles, string currentFile)>? progress,
        CancellationToken ct)
    {
        var creds = await GetCredentialsForNodeAsync(nodeId, ct);
        if (!creds.Success || creds.Machine is null || creds.Auth is null)
        {
            throw new InvalidOperationException(creds.Error ?? "SSH credentials not available");
        }

        var machine = creds.Machine;

        // Detect OS for proper path conversion
        var isWindows = await IsWindowsAsync(machine, creds.Auth, ct);

        // Create temp file to buffer the zip (avoids ZipArchive synchronous I/O on response stream)
        var tempFile = Path.GetTempFileName();
        try
        {
            using var sftp = CreateSftpClient(machine, creds.Auth);
            sftp.Connect();

            try
            {
                // Collect all files to include in the zip
                var filesToZip = new List<(string virtualPath, string realPath, long size)>();

                foreach (var vpath in virtualPaths)
                {
                    var realPath = VirtualToRealPath(vpath, sftp, isWindows);
                    await CollectFilesRecursiveAsync(sftp, vpath, realPath, filesToZip, ct);
                }

                var totalFiles = filesToZip.Count;
                var filesProcessed = 0L;

                // Create zip archive in temp file
                await using (var tempStream = new FileStream(tempFile, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
                {
                    using var archive = new ZipArchive(tempStream, ZipArchiveMode.Create, leaveOpen: false);

                    foreach (var (vpath, realPath, size) in filesToZip)
                    {
                        ct.ThrowIfCancellationRequested();

                        progress?.Report((filesProcessed, totalFiles, vpath));

                        // Determine entry name (relative path within zip)
                        var entryName = vpath.TrimStart('/');
                        if (virtualPaths.Length == 1)
                        {
                            // If single item, use just the filename
                            var singlePath = virtualPaths[0].TrimStart('/');
                            if (vpath.StartsWith(virtualPaths[0], StringComparison.Ordinal))
                            {
                                entryName = vpath[(virtualPaths[0].Length)..].TrimStart('/');
                                if (string.IsNullOrEmpty(entryName))
                                {
                                    entryName = Path.GetFileName(singlePath);
                                }
                            }
                        }

                        var entry = archive.CreateEntry(entryName, CompressionLevel.Optimal);

                        await using var entryStream = entry.Open();

                        // Download file content directly into the zip entry
                        sftp.DownloadFile(realPath, entryStream);
                        await entryStream.FlushAsync(ct);

                        filesProcessed++;
                    }

                    progress?.Report((filesProcessed, totalFiles, "Complete"));
                } // ZipArchive disposes here, writing to temp file (sync I/O is OK on FileStream)
            }
            finally
            {
                sftp.Disconnect();
            }

            // Stream the completed zip to the output asynchronously
            await using var readStream = new FileStream(tempFile, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
            await readStream.CopyToAsync(outputStream, ct);
            await outputStream.FlushAsync(ct);
        }
        finally
        {
            // Clean up temp file
            try
            {
                if (File.Exists(tempFile))
                {
                    File.Delete(tempFile);
                }
            }
            catch
            {
                // Ignore cleanup errors
            }
        }
    }

    /// <summary>
    /// Gets file metadata via SFTP.
    /// </summary>
    public async Task<(long size, DateTime lastModified)?> GetFileMetadataAsync(
        Guid nodeId,
        string virtualPath,
        CancellationToken ct)
    {
        var creds = await GetCredentialsForNodeAsync(nodeId, ct);
        if (!creds.Success || creds.Machine is null || creds.Auth is null)
        {
            return null;
        }

        var machine = creds.Machine;

        try
        {
            // Detect OS for proper path conversion
            var isWindows = await IsWindowsAsync(machine, creds.Auth, ct);

            using var sftp = CreateSftpClient(machine, creds.Auth);
            sftp.Connect();

            var realPath = VirtualToRealPath(virtualPath, sftp, isWindows);
            var attrs = sftp.GetAttributes(realPath);

            sftp.Disconnect();
            return (attrs.Size, attrs.LastWriteTime);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get file metadata via SSH for node {NodeId} at path {Path}", nodeId, virtualPath);
            return null;
        }
    }

    private async Task CollectFilesRecursiveAsync(
        SftpClient sftp,
        string basePath,
        string realPath,
        List<(string virtualPath, string realPath, long size)> files,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        try
        {
            var attrs = sftp.GetAttributes(realPath);

            if (!attrs.IsDirectory)
            {
                files.Add((basePath, realPath, attrs.Size));
                return;
            }

            // It's a directory, recurse
            foreach (var entry in sftp.ListDirectory(realPath))
            {
                if (entry.Name == "." || entry.Name == "..")
                    continue;

                var childVirtual = basePath.TrimEnd('/') + "/" + entry.Name;
                var childReal = realPath.TrimEnd('/') + "/" + entry.Name;

                if (entry.IsDirectory)
                {
                    await CollectFilesRecursiveAsync(sftp, childVirtual, childReal, files, ct);
                }
                else
                {
                    files.Add((childVirtual, childReal, entry.Length));
                }
            }
        }
        catch (Renci.SshNet.Common.SftpPermissionDeniedException)
        {
            _logger.LogWarning("Permission denied while collecting files: {Path}", realPath);
        }
    }

    /// <summary>
    /// Converts virtual path to SFTP real path.
    /// Windows OpenSSH uses paths like: /C:/Users or C:/Users
    /// Linux SSH uses standard POSIX paths.
    /// </summary>
    private static string VirtualToRealPath(string virtualPath, SftpClient? sftp, bool isWindows)
    {
        // Virtual paths use forward slashes. Windows drive roots are represented as "/C", "/D", etc.
        var path = (virtualPath ?? "/").Trim();
        if (string.IsNullOrEmpty(path) || path == "/")
        {
            return "/";
        }

        path = path.Replace('\\', '/');

        // Check if this looks like a Windows drive path: /C/... or /C
        if (path.Length >= 2 && path[0] == '/' && char.IsLetter(path[1]))
        {
            var driveLetter = char.ToUpperInvariant(path[1]);

            if (isWindows)
            {
                // Windows OpenSSH uses paths like /C:/ for C:\
                if (path.Length == 2)
                {
                    // /C -> /C:/
                    return $"/{driveLetter}:/";
                }

                if (path.Length > 2 && path[2] == '/')
                {
                    // /C/Users/... -> /C:/Users/...
                    return $"/{driveLetter}:{path[2..]}";
                }
            }
            // else: Linux doesn't have drive letters, so /C would be a literal folder named C
        }

        // Unix path - return as-is (without any transformation)
        return path;
    }

    /// <summary>
    /// Legacy overload - detects Windows by trying path variations.
    /// </summary>
    private static string VirtualToRealPath(string virtualPath, SftpClient sftp)
    {
        // For backward compatibility, assume Windows drive letter format means Windows
        var path = (virtualPath ?? "/").Trim().Replace('\\', '/');
        var isWindowsDrivePath = path.Length >= 2 && path[0] == '/' && char.IsLetter(path[1]) &&
                                  (path.Length == 2 || path[2] == '/');
        
        return VirtualToRealPath(virtualPath!, sftp, isWindowsDrivePath);
    }

    private async Task<bool> IsWindowsAsync(OnboardingMachine machine, SshProvisioningService.AuthOptions auth, CancellationToken ct)
    {
        try
        {
            using var ssh = CreateSshClient(machine, auth);
            ssh.Connect();

            // Try to detect Windows by running a simple PowerShell command
            var cmd = ssh.CreateCommand("powershell.exe -NoProfile -Command \"echo WINDOWS\"");
            var result = cmd.Execute();

            ssh.Disconnect();

            return result?.Trim().Contains("WINDOWS", StringComparison.OrdinalIgnoreCase) == true;
        }
        catch
        {
            // Assume Linux if detection fails
            return false;
        }
    }

    private async Task<List<string>> ListWindowsDrivesAsync(OnboardingMachine machine, SshProvisioningService.AuthOptions auth, CancellationToken ct)
    {
        var drives = new List<string>();

        try
        {
            using var ssh = CreateSshClient(machine, auth);
            ssh.Connect();

            var cmd = ssh.CreateCommand("powershell.exe -NoProfile -Command \"Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name\"");
            var result = cmd.Execute();

            ssh.Disconnect();

            if (!string.IsNullOrWhiteSpace(result))
            {
                foreach (var line in result.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                {
                    var drive = line.Trim();
                    if (drive.Length == 1 && char.IsLetter(drive[0]))
                    {
                        drives.Add($"{drive}:");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to list Windows drives via SSH");
            // Return common drives as fallback
            drives.AddRange(["C:", "D:"]);
        }

        if (drives.Count == 0)
        {
            drives.Add("C:");
        }

        return drives;
    }

    private static SftpClient CreateSftpClient(OnboardingMachine machine, SshProvisioningService.AuthOptions auth)
    {
        var authMethods = new List<AuthenticationMethod>();

        switch (auth)
        {
            case SshProvisioningService.PasswordAuth passwordAuth:
                authMethods.Add(new PasswordAuthenticationMethod(machine.Username, passwordAuth.Password));
                break;

            case SshProvisioningService.PrivateKeyAuth privateKeyAuth:
            {
                var keyBytes = System.Text.Encoding.UTF8.GetBytes(privateKeyAuth.PrivateKeyPem);
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

                authMethods.Add(new PrivateKeyAuthenticationMethod(machine.Username, keyFile));
                break;
            }

            default:
                throw new ArgumentOutOfRangeException(nameof(auth), "Unknown SSH auth mode");
        }

        var connectionInfo = new Renci.SshNet.ConnectionInfo(machine.Host, machine.Port, machine.Username, authMethods.ToArray());
        var sftp = new SftpClient(connectionInfo);

        // Trust host key if fingerprint is stored
        if (!string.IsNullOrWhiteSpace(machine.HostKeyFingerprint))
        {
            sftp.HostKeyReceived += (_, e) =>
            {
                var fingerprint = ComputeHostKeyFingerprint(e.HostKey);
                e.CanTrust = string.Equals(machine.HostKeyFingerprint.Trim(), fingerprint, StringComparison.OrdinalIgnoreCase);
            };
        }
        else
        {
            // Trust on first use (TOFU)
            sftp.HostKeyReceived += (_, e) => e.CanTrust = true;
        }

        return sftp;
    }

    private static SshClient CreateSshClient(OnboardingMachine machine, SshProvisioningService.AuthOptions auth)
    {
        var authMethods = new List<AuthenticationMethod>();

        switch (auth)
        {
            case SshProvisioningService.PasswordAuth passwordAuth:
                authMethods.Add(new PasswordAuthenticationMethod(machine.Username, passwordAuth.Password));
                break;

            case SshProvisioningService.PrivateKeyAuth privateKeyAuth:
            {
                var keyBytes = System.Text.Encoding.UTF8.GetBytes(privateKeyAuth.PrivateKeyPem);
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

                authMethods.Add(new PrivateKeyAuthenticationMethod(machine.Username, keyFile));
                break;
            }

            default:
                throw new ArgumentOutOfRangeException(nameof(auth), "Unknown SSH auth mode");
        }

        var connectionInfo = new Renci.SshNet.ConnectionInfo(machine.Host, machine.Port, machine.Username, authMethods.ToArray());
        var ssh = new SshClient(connectionInfo);

        // Trust host key if fingerprint is stored
        if (!string.IsNullOrWhiteSpace(machine.HostKeyFingerprint))
        {
            ssh.HostKeyReceived += (_, e) =>
            {
                var fingerprint = ComputeHostKeyFingerprint(e.HostKey);
                e.CanTrust = string.Equals(machine.HostKeyFingerprint.Trim(), fingerprint, StringComparison.OrdinalIgnoreCase);
            };
        }
        else
        {
            // Trust on first use (TOFU)
            ssh.HostKeyReceived += (_, e) => e.CanTrust = true;
        }

        return ssh;
    }

    private static string ComputeHostKeyFingerprint(byte[] hostKey)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(hostKey);
        var b64 = Convert.ToBase64String(hash).TrimEnd('=');
        return "SHA256:" + b64;
    }
}
