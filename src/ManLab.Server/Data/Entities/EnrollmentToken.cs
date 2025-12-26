using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

[Table("EnrollmentTokens")]
public sealed class EnrollmentToken
{
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// SHA-256 hash of the token (hex).
    /// </summary>
    [Required]
    [MaxLength(128)]
    public string TokenHash { get; set; } = string.Empty;

    public DateTime ExpiresAt { get; set; }

    public DateTime? UsedAt { get; set; }

    public Guid? MachineId { get; set; }

    public Guid? NodeId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
