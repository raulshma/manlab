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
}
