using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/users")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.UsersManage)]
public class UsersController : ControllerBase
{
    private readonly UsersService _usersService;
    private readonly ILogger<UsersController> _logger;

    public UsersController(UsersService usersService, ILogger<UsersController> logger)
    {
        _usersService = usersService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<List<UsersService.UserDto>>> GetAllUsers()
    {
        var users = await _usersService.GetAllUsersAsync();
        return Ok(users.Select(u => _usersService.ToDto(u)).ToList());
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<UsersService.UserDto>> GetUser(Guid id)
    {
        var user = await _usersService.GetUserByIdAsync(id);
        if (user == null)
        {
            return NotFound();
        }

        return Ok(_usersService.ToDto(user));
    }

    [HttpPost]
    public async Task<ActionResult<UsersService.UserDto>> CreateUser([FromBody] CreateUserRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username))
        {
            return BadRequest("Username is required.");
        }

        if (string.IsNullOrWhiteSpace(request.TempPassword))
        {
            return BadRequest("Temporary password is required.");
        }

        var role = request.Role?.ToLower() switch
        {
            "admin" => UserRole.Admin,
            "user" => UserRole.User,
            _ => UserRole.User
        };

        try
        {
            var user = await _usersService.CreateUserAsync(request.Username, request.TempPassword, role);
            _logger.LogInformation(
                "Admin created user {Username} with role {Role}",
                request.Username, role);
            return CreatedAtAction(nameof(GetUser), new { id = user.Id }, _usersService.ToDto(user));
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ex.Message);
        }
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> DeleteUser(Guid id)
    {
        var success = await _usersService.DeleteUserAsync(id);
        if (!success)
        {
            return NotFound();
        }

        return NoContent();
    }

    [HttpPost("{id}/reset-password")]
    public async Task<ActionResult> ResetPassword(Guid id, [FromBody] ResetPasswordRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.TempPassword))
        {
            return BadRequest("New temporary password is required.");
        }

        var success = await _usersService.ResetPasswordAsync(id, request.TempPassword);
        if (!success)
        {
            return NotFound();
        }

        return Ok();
    }

    [HttpPut("{id}/role")]
    public async Task<ActionResult<UsersService.UserDto>> UpdateUserRole(Guid id, [FromBody] UpdateRoleRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Role))
        {
            return BadRequest("Role is required.");
        }

        var roleName = request.Role.ToLower();
        if (roleName != "admin" && roleName != "user")
        {
            return BadRequest("Role must be either 'admin' or 'user'.");
        }

        var role = roleName == "admin" ? UserRole.Admin : UserRole.User;

        var success = await _usersService.UpdateUserRoleAsync(id, role);
        if (!success)
        {
            return NotFound();
        }

        var user = await _usersService.GetUserByIdAsync(id);
        if (user == null)
        {
            return NotFound();
        }

        return Ok(_usersService.ToDto(user));
    }

    [HttpGet("{id}/permissions")]
    public async Task<ActionResult<UserPermissionsResponse>> GetUserPermissions(Guid id)
    {
        var user = await _usersService.GetUserByIdAsync(id);
        if (user == null)
        {
            return NotFound();
        }

        var effective = await _usersService.GetEffectivePermissionsAsync(user);
        var overrides = await _usersService.GetUserPermissionOverridesAsync(id);

        var overrideDtos = overrides
            .Select(o => new UserPermissionOverrideDto(
                o.Permission,
                o.IsGranted ? PermissionState.Allow : PermissionState.Deny))
            .OrderBy(o => o.Permission, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Ok(new UserPermissionsResponse(
            Permissions.All.ToArray(),
            effective.OrderBy(p => p, StringComparer.OrdinalIgnoreCase).ToArray(),
            overrideDtos));
    }

    [HttpPut("{id}/permissions")]
    public async Task<ActionResult<UserPermissionsResponse>> UpdateUserPermissions(
        Guid id,
        [FromBody] UpdateUserPermissionsRequest request)
    {
        var user = await _usersService.GetUserByIdAsync(id);
        if (user == null)
        {
            return NotFound();
        }

        if (user.Role == UserRole.Admin)
        {
            return BadRequest("Admin users always have full permissions and cannot be overridden.");
        }

        var overrides = new List<(string Permission, bool IsGranted)>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in request.Overrides)
        {
            if (string.IsNullOrWhiteSpace(item.Permission))
            {
                return BadRequest("Permission is required.");
            }

            if (!Permissions.All.Contains(item.Permission, StringComparer.OrdinalIgnoreCase))
            {
                return BadRequest($"Unknown permission '{item.Permission}'.");
            }

            if (!seen.Add(item.Permission))
            {
                continue;
            }

            switch (item.State)
            {
                case PermissionState.Inherit:
                    continue;
                case PermissionState.Allow:
                    overrides.Add((item.Permission, true));
                    break;
                case PermissionState.Deny:
                    overrides.Add((item.Permission, false));
                    break;
                default:
                    return BadRequest("State must be 'inherit', 'allow', or 'deny'.");
            }
        }

        await _usersService.ReplaceUserPermissionOverridesAsync(user.Id, overrides);

        var effective = await _usersService.GetEffectivePermissionsAsync(user);
        var updatedOverrides = await _usersService.GetUserPermissionOverridesAsync(user.Id);

        var overrideDtos = updatedOverrides
            .Select(o => new UserPermissionOverrideDto(
                o.Permission,
                o.IsGranted ? PermissionState.Allow : PermissionState.Deny))
            .OrderBy(o => o.Permission, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Ok(new UserPermissionsResponse(
            Permissions.All.ToArray(),
            effective.OrderBy(p => p, StringComparer.OrdinalIgnoreCase).ToArray(),
            overrideDtos));
    }

    public sealed record CreateUserRequest
    {
        public string Username { get; init; } = string.Empty;
        public string? Role { get; init; }
        public string TempPassword { get; init; } = string.Empty;
    }

    public sealed record ResetPasswordRequest
    {
        public string TempPassword { get; init; } = string.Empty;
    }

    public sealed record UpdateRoleRequest
    {
        public string Role { get; init; } = string.Empty;
    }

    public static class PermissionState
    {
        public const string Inherit = "inherit";
        public const string Allow = "allow";
        public const string Deny = "deny";
    }

    public sealed record UserPermissionOverrideDto(string Permission, string State);

    public sealed record UpdateUserPermissionsRequest
    {
        public List<UserPermissionOverrideDto> Overrides { get; init; } = [];
    }

    public sealed record UserPermissionsResponse(
        string[] AvailablePermissions,
        string[] EffectivePermissions,
        List<UserPermissionOverrideDto> Overrides);
}
