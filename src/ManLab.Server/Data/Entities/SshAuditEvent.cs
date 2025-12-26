using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

[Table("SshAuditEvents")]
public sealed class SshAuditEvent
{
    [Key]
    public Guid Id { get; set; }

    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    [MaxLength(64)]
    public string? Actor { get; set; }

    [MaxLength(64)]
    public string? ActorIp { get; set; }

    [Required]
    [MaxLength(64)]
    public string Action { get; set; } = string.Empty; // e.g. ssh.test, ssh.install.start, ssh.install.result

    public Guid? MachineId { get; set; }

    [MaxLength(255)]
    public string? Host { get; set; }

    public int? Port { get; set; }

    [MaxLength(128)]
    public string? Username { get; set; }

    [MaxLength(256)]
    public string? HostKeyFingerprint { get; set; }

    public bool Success { get; set; }

    [MaxLength(2048)]
    public string? Error { get; set; }

    [MaxLength(64)]
    public string? OsFamily { get; set; }

    [MaxLength(128)]
    public string? OsDistro { get; set; }

    [MaxLength(128)]
    public string? OsVersion { get; set; }

    [MaxLength(64)]
    public string? CpuArch { get; set; }
}
