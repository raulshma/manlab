using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities;

[Table("OnboardingMachines")]
public sealed class OnboardingMachine
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    [MaxLength(255)]
    public string Host { get; set; } = string.Empty;

    public int Port { get; set; } = 22;

    [Required]
    [MaxLength(128)]
    public string Username { get; set; } = string.Empty;

    public SshAuthMode AuthMode { get; set; } = SshAuthMode.PrivateKey;

    /// <summary>
    /// SSH host key fingerprint (TOFU) persisted after admin approval.
    /// Format: SHA256:... or hex.
    /// </summary>
    [MaxLength(256)]
    public string? HostKeyFingerprint { get; set; }

    public OnboardingStatus Status { get; set; } = OnboardingStatus.Pending;

    [MaxLength(4096)]
    public string? LastError { get; set; }

    public Guid? LinkedNodeId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // ===== Encrypted Credentials (optional) =====
    // These fields store encrypted credentials for password-based auth when user opts to save them.

    /// <summary>
    /// Encrypted SSH password (only used with Password auth mode).
    /// </summary>
    [MaxLength(2048)]
    public string? EncryptedSshPassword { get; set; }

    /// <summary>
    /// Encrypted private key PEM content (only used with PrivateKey auth mode).
    /// </summary>
    [MaxLength(8192)]
    public string? EncryptedPrivateKeyPem { get; set; }

    /// <summary>
    /// Encrypted private key passphrase (only used when private key has a passphrase).
    /// </summary>
    [MaxLength(2048)]
    public string? EncryptedPrivateKeyPassphrase { get; set; }

    /// <summary>
    /// Encrypted sudo password for Linux installations.
    /// </summary>
    [MaxLength(2048)]
    public string? EncryptedSudoPassword { get; set; }

    // ===== Remembered Configuration Options =====
    // These fields store the user's preferred configuration for this machine.

    /// <summary>
    /// Whether the user prefers to trust this host key automatically.
    /// </summary>
    public bool TrustHostKey { get; set; } = false;

    /// <summary>
    /// Whether the user prefers to force re-installation.
    /// </summary>
    public bool ForceInstall { get; set; } = true;

    /// <summary>
    /// Whether the user prefers to run installation as root.
    /// </summary>
    public bool RunAsRoot { get; set; } = false;

    /// <summary>
    /// User's preferred server base URL for this machine (if overridden from default).
    /// </summary>
    [MaxLength(512)]
    public string? ServerBaseUrlOverride { get; set; }
}
