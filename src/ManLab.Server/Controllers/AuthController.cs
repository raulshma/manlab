using System.Security.Claims;
using ManLab.Server.Constants;
using ManLab.Server.Services;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly ISettingsService _settingsService;
    private readonly LocalBypassEvaluator _localBypassEvaluator;
    private readonly AuthTokenService _tokenService;
    private readonly PasswordHasher<string> _passwordHasher;
    private readonly UsersService _usersService;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        ISettingsService settingsService,
        LocalBypassEvaluator localBypassEvaluator,
        AuthTokenService tokenService,
        PasswordHasher<string> passwordHasher,
        UsersService usersService,
        ILogger<AuthController> logger)
    {
        _settingsService = settingsService;
        _localBypassEvaluator = localBypassEvaluator;
        _tokenService = tokenService;
        _passwordHasher = passwordHasher;
        _usersService = usersService;
        _logger = logger;
    }

    [HttpGet("status")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthStatusResponse>> GetStatus()
    {
        var authEnabled = await _settingsService.GetValueAsync(SettingKeys.Auth.Enabled, false);
        var bypassEnabled = await _settingsService.GetValueAsync(SettingKeys.Auth.LocalBypassEnabled, false);
        var cidrs = await _settingsService.GetValueAsync(SettingKeys.Auth.LocalBypassCidrs);
        var passwordHash = await _settingsService.GetValueAsync(SettingKeys.Auth.AdminPasswordHash);
        var clientIsLocal = await _localBypassEvaluator.IsClientInLocalRangeAsync(HttpContext);

        // Check if we need to migrate from SystemSettings to Users table
        if (!string.IsNullOrWhiteSpace(passwordHash))
        {
            await _usersService.MigrateAdminFromSettingsAsync(passwordHash);
            // Clear the old setting after migration
            await _settingsService.SetValueAsync(SettingKeys.Auth.AdminPasswordHash, "", "Auth", "Migrated to Users table.");
        }

        // Check password status based on existing users
        var hasUsers = await _usersService.GetAllUsersAsync();
        var passwordSet = hasUsers.Any();
        var needsSetup = await _usersService.NeedsInitialAdminAsync();

        return Ok(new AuthStatusResponse
        {
            AuthEnabled = authEnabled,
            PasswordSet = passwordSet,
            NeedsSetup = needsSetup,
            LocalBypassEnabled = bypassEnabled,
            LocalBypassCidrs = string.IsNullOrWhiteSpace(cidrs) ? null : cidrs,
            ClientIp = HttpContext.Connection.RemoteIpAddress?.ToString(),
            ClientIsLocal = clientIsLocal,
            IsAuthenticated = User?.Identity?.IsAuthenticated == true,
            AuthMethod = User?.FindFirst("auth_method")?.Value,
            Username = User?.FindFirst(ClaimTypes.Name)?.Value,
            Role = User?.FindFirst(ClaimTypes.Role)?.Value,
            PasswordMustChange = User?.FindFirst("password_must_change")?.Value == "true"
        });
    }

    [HttpPost("setup")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthLoginResponse>> Setup([FromBody] AuthSetupRequest request)
    {
        var clientIsLocal = await _localBypassEvaluator.IsClientInLocalRangeAsync(HttpContext);
        if (!clientIsLocal)
        {
            return Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest("Username and password are required.");
        }

        try
        {
            var user = await _usersService.CreateInitialAdminAsync(request.Username, request.Password);
            await _settingsService.SetValueAsync(SettingKeys.Auth.Enabled, "true", "Auth", "Require authentication for dashboard/API.");

            return await IssueTokenAsync(user.Username, user.Role.ToString());
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ex.Message);
        }
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthLoginResponse>> Login([FromBody] AuthLoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest("Username and password are required.");
        }

        var (user, success) = await _usersService.VerifyCredentialsAsync(request.Username, request.Password);
        if (!success || user == null)
        {
            return Unauthorized("Invalid username or password.");
        }

        return await IssueTokenAsync(user.Username, user.Role.ToString(), user.PasswordMustChange);
    }

    [HttpPost("change-password")]
    [Authorize]
    public async Task<ActionResult<AuthLoginResponse>> ChangePassword([FromBody] ChangePasswordRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword))
        {
            return BadRequest("New password is required.");
        }

        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username))
        {
            return Unauthorized();
        }

        var user = await _usersService.GetUserByUsernameAsync(username);
        if (user == null)
        {
            return NotFound("User not found.");
        }

        var success = await _usersService.ChangePasswordAsync(user.Id, request.CurrentPassword ?? string.Empty, request.NewPassword);
        if (!success)
        {
            return Unauthorized("Current password is incorrect.");
        }

        return await IssueTokenAsync(user.Username, user.Role.ToString(), false);
    }

    [HttpPost("logout")]
    [AllowAnonymous]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(AuthTokenService.CookieName);
        return Ok();
    }

    private async Task<ActionResult<AuthLoginResponse>> IssueTokenAsync(string username, string role, bool passwordMustChange = false)
    {
        try
        {
            var token = _tokenService.CreateToken(username, role);
            var cookieOptions = new CookieOptions
            {
                HttpOnly = true,
                Secure = Request.IsHttps,
                SameSite = SameSiteMode.Lax,
                Expires = token.ExpiresAtUtc
            };
            Response.Cookies.Append(AuthTokenService.CookieName, token.Token, cookieOptions);

            var authEnabled = await _settingsService.GetValueAsync(SettingKeys.Auth.Enabled, false);
            return Ok(new AuthLoginResponse
            {
                Token = token.Token,
                ExpiresAtUtc = token.ExpiresAtUtc,
                AuthEnabled = authEnabled,
                Username = username,
                Role = role,
                PasswordMustChange = passwordMustChange
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to issue auth token");
            return StatusCode(StatusCodes.Status500InternalServerError, "Failed to issue token.");
        }
    }

    public sealed class AuthStatusResponse
    {
        public bool AuthEnabled { get; set; }
        public bool PasswordSet { get; set; }
        public bool NeedsSetup { get; set; }
        public bool LocalBypassEnabled { get; set; }
        public string? LocalBypassCidrs { get; set; }
        public string? ClientIp { get; set; }
        public bool ClientIsLocal { get; set; }
        public bool IsAuthenticated { get; set; }
        public string? AuthMethod { get; set; }
        public string? Username { get; set; }
        public string? Role { get; set; }
        public bool PasswordMustChange { get; set; }
    }

    public sealed class AuthLoginRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    public sealed class AuthSetupRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    public sealed class ChangePasswordRequest
    {
        public string? CurrentPassword { get; set; }
        public string NewPassword { get; set; } = string.Empty;
    }

    public sealed class AuthLoginResponse
    {
        public string Token { get; set; } = string.Empty;
        public DateTime ExpiresAtUtc { get; set; }
        public bool AuthEnabled { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public bool PasswordMustChange { get; set; }
    }
}
