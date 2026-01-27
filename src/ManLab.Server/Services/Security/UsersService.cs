using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services.Security;

/// <summary>
/// Service for managing users in the ManLab system.
/// </summary>
public class UsersService
{
    private readonly DataContext _dbContext;
    private readonly PasswordHasher<string> _passwordHasher;
    private readonly ILogger<UsersService> _logger;

    public UsersService(
        DataContext dbContext,
        PasswordHasher<string> passwordHasher,
        ILogger<UsersService> logger)
    {
        _dbContext = dbContext;
        _passwordHasher = passwordHasher;
        _logger = logger;
    }

    /// <summary>
    /// Gets a user by ID.
    /// </summary>
    public async Task<User?> GetUserByIdAsync(Guid userId)
    {
        return await _dbContext.Users.FindAsync(userId);
    }

    /// <summary>
    /// Gets a user by username.
    /// </summary>
    public async Task<User?> GetUserByUsernameAsync(string username)
    {
        return await _dbContext.Users.FirstOrDefaultAsync(u => u.Username == username);
    }

    /// <summary>
    /// Gets all users.
    /// </summary>
    public async Task<List<User>> GetAllUsersAsync()
    {
        return await _dbContext.Users.OrderBy(u => u.Username).ToListAsync();
    }

    /// <summary>
    /// Gets per-user permission overrides.
    /// </summary>
    public async Task<List<UserPermission>> GetUserPermissionOverridesAsync(Guid userId)
    {
        return await _dbContext.UserPermissions
            .Where(p => p.UserId == userId)
            .OrderBy(p => p.Permission)
            .ToListAsync();
    }

    /// <summary>
    /// Computes the effective permissions for a user.
    /// </summary>
    public async Task<HashSet<string>> GetEffectivePermissionsAsync(User user)
    {
        if (user.Role == UserRole.Admin)
        {
            return new HashSet<string>(Permissions.All, StringComparer.OrdinalIgnoreCase);
        }

        var permissions = new HashSet<string>(Permissions.GetRoleDefaults(user.Role), StringComparer.OrdinalIgnoreCase);
        var overrides = await GetUserPermissionOverridesAsync(user.Id);
        foreach (var entry in overrides)
        {
            if (entry.IsGranted)
            {
                permissions.Add(entry.Permission);
            }
            else
            {
                permissions.Remove(entry.Permission);
            }
        }

        return permissions;
    }

    /// <summary>
    /// Replaces a user's permission overrides.
    /// </summary>
    public async Task ReplaceUserPermissionOverridesAsync(Guid userId, IEnumerable<(string Permission, bool IsGranted)> overrides)
    {
        var existing = await _dbContext.UserPermissions
            .Where(p => p.UserId == userId)
            .ToListAsync();

        if (existing.Count > 0)
        {
            _dbContext.UserPermissions.RemoveRange(existing);
        }

        foreach (var overrideEntry in overrides)
        {
            _dbContext.UserPermissions.Add(new UserPermission
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Permission = overrideEntry.Permission,
                IsGranted = overrideEntry.IsGranted,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Creates a new user with a temporary password.
    /// </summary>
    public async Task<User> CreateUserAsync(string username, string tempPassword, UserRole role = UserRole.User)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            throw new ArgumentException("Username is required.", nameof(username));
        }

        if (await _dbContext.Users.AnyAsync(u => u.Username == username))
        {
            throw new InvalidOperationException($"A user with username '{username}' already exists.");
        }

        var passwordHash = _passwordHasher.HashPassword(username, tempPassword);
        var user = new User
        {
            Id = Guid.NewGuid(),
            Username = username,
            PasswordHash = passwordHash,
            Role = role,
            PasswordMustChange = true,
            CreatedAt = DateTime.UtcNow
        };

        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();

        _logger.LogInformation(
            "Created user {Username} with role {Role}. Password must be changed on first login.",
            username, role);

        return user;
    }

    /// <summary>
    /// Deletes a user.
    /// </summary>
    public async Task<bool> DeleteUserAsync(Guid userId)
    {
        var user = await _dbContext.Users.FindAsync(userId);
        if (user == null)
        {
            return false;
        }

        _dbContext.Users.Remove(user);
        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Deleted user {Username}", user.Username);
        return true;
    }

    /// <summary>
    /// Changes a user's password.
    /// </summary>
    public async Task<bool> ChangePasswordAsync(
        Guid userId,
        string currentPassword,
        string newPassword)
    {
        var user = await _dbContext.Users.FindAsync(userId);
        if (user == null)
        {
            return false;
        }

        var result = _passwordHasher.VerifyHashedPassword(user.Username, user.PasswordHash, currentPassword);
        if (result == PasswordVerificationResult.Failed)
        {
            return false;
        }

        user.PasswordHash = _passwordHasher.HashPassword(user.Username, newPassword);
        user.PasswordMustChange = false;
        user.PasswordChangedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Password changed for user {Username}", user.Username);
        return true;
    }

    /// <summary>
    /// Resets a user's password (admin action). User will need to change on next login.
    /// </summary>
    public async Task<bool> ResetPasswordAsync(Guid userId, string tempPassword)
    {
        var user = await _dbContext.Users.FindAsync(userId);
        if (user == null)
        {
            return false;
        }

        user.PasswordHash = _passwordHasher.HashPassword(user.Username, tempPassword);
        user.PasswordMustChange = true;
        user.PasswordChangedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Password reset for user {Username}", user.Username);
        return true;
    }

    /// <summary>
    /// Updates a user's role.
    /// </summary>
    public async Task<bool> UpdateUserRoleAsync(Guid userId, UserRole newRole)
    {
        var user = await _dbContext.Users.FindAsync(userId);
        if (user == null)
        {
            return false;
        }

        var oldRole = user.Role;
        user.Role = newRole;
        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Role for user {Username} changed from {OldRole} to {NewRole}",
            user.Username, oldRole, newRole);
        return true;
    }

    /// <summary>
    /// Verifies a user's password credentials.
    /// </summary>
    public async Task<(User? User, bool Success)> VerifyCredentialsAsync(string username, string password)
    {
        var user = await GetUserByUsernameAsync(username);
        if (user == null)
        {
            return (null, false);
        }

        var result = _passwordHasher.VerifyHashedPassword(username, user.PasswordHash, password);
        var success = result != PasswordVerificationResult.Failed;

        if (success)
        {
            user.LastLoginAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync();
        }

        return (user, success);
    }

    /// <summary>
    /// Checks if the initial admin user needs to be created.
    /// </summary>
    public async Task<bool> NeedsInitialAdminAsync()
    {
        var adminCount = await _dbContext.Users.CountAsync(u => u.Role == UserRole.Admin);
        return adminCount == 0;
    }

    /// <summary>
    /// Creates the initial admin user.
    /// </summary>
    public async Task<User> CreateInitialAdminAsync(string username, string password)
    {
        if (!await NeedsInitialAdminAsync())
        {
            throw new InvalidOperationException("An admin user already exists.");
        }

        return await CreateUserAsync(username, password, UserRole.Admin);
    }

    /// <summary>
    /// Ensures the admin user from SystemSettings exists in the Users table (migration path).
    /// </summary>
    public async Task MigrateAdminFromSettingsAsync(string? passwordHash)
    {
        if (string.IsNullOrWhiteSpace(passwordHash))
        {
            return;
        }

        var existingAdmin = await _dbContext.Users.AnyAsync(u => u.Role == UserRole.Admin);
        if (existingAdmin)
        {
            return;
        }

        var adminUser = new User
        {
            Id = Guid.NewGuid(),
            Username = "admin",
            PasswordHash = passwordHash,
            Role = UserRole.Admin,
            PasswordMustChange = false,
            CreatedAt = DateTime.UtcNow
        };

        _dbContext.Users.Add(adminUser);
        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Migrated admin user from SystemSettings to Users table.");
    }

    /// <summary>
    /// DTOs for user management.
    /// </summary>
    public sealed record UserDto
    {
        public Guid Id { get; init; }
        public string Username { get; init; } = string.Empty;
        public string Role { get; init; } = string.Empty;
        public bool PasswordMustChange { get; init; }
        public DateTime CreatedAt { get; init; }
        public DateTime? LastLoginAt { get; init; }
    }

    /// <summary>
    /// Converts a User entity to a UserDto.
    /// </summary>
    public UserDto ToDto(User user)
    {
        return new UserDto
        {
            Id = user.Id,
            Username = user.Username,
            Role = user.Role.ToString(),
            PasswordMustChange = user.PasswordMustChange,
            CreatedAt = user.CreatedAt,
            LastLoginAt = user.LastLoginAt
        };
    }
}
