using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/users")]
[Authorize(Policy = "AdminOnly")]
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
}
