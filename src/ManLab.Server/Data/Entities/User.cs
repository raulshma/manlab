using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents a user account in the ManLab system.
/// </summary>
[Table("Users")]
public class User
{
    /// <summary>Unique identifier for the user.</summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>Username for login (must be unique).</summary>
    [Required]
    [MaxLength(100)]
    public string Username { get; set; } = string.Empty;

    /// <summary>Hashed password.</summary>
    [Required]
    [MaxLength(512)]
    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>User role: Admin or User.</summary>
    [Required]
    public UserRole Role { get; set; } = UserRole.User;

    /// <summary>Whether user must change password on next login.</summary>
    public bool PasswordMustChange { get; set; } = true;

    /// <summary>When the user was created.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>When the user last logged in successfully.</summary>
    public DateTime? LastLoginAt { get; set; }

    /// <summary>When the password was last changed.</summary>
    public DateTime? PasswordChangedAt { get; set; }

    /// <summary>Per-user permission overrides.</summary>
    public ICollection<UserPermission> Permissions { get; set; } = [];
}
