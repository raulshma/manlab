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
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        ISettingsService settingsService,
        LocalBypassEvaluator localBypassEvaluator,
        AuthTokenService tokenService,
        PasswordHasher<string> passwordHasher,
        ILogger<AuthController> logger)
    {
        _settingsService = settingsService;
        _localBypassEvaluator = localBypassEvaluator;
        _tokenService = tokenService;
        _passwordHasher = passwordHasher;
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

        return Ok(new AuthStatusResponse
        {
            AuthEnabled = authEnabled,
            PasswordSet = !string.IsNullOrWhiteSpace(passwordHash),
            LocalBypassEnabled = bypassEnabled,
            LocalBypassCidrs = string.IsNullOrWhiteSpace(cidrs) ? null : cidrs,
            ClientIp = HttpContext.Connection.RemoteIpAddress?.ToString(),
            ClientIsLocal = clientIsLocal,
            IsAuthenticated = User?.Identity?.IsAuthenticated == true,
            AuthMethod = User?.FindFirst("auth_method")?.Value
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

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest("Password is required.");
        }

        var existingHash = await _settingsService.GetValueAsync(SettingKeys.Auth.AdminPasswordHash);
        if (!string.IsNullOrWhiteSpace(existingHash))
        {
            return Conflict("Password already set.");
        }

        var hash = _passwordHasher.HashPassword("admin", request.Password);
        await _settingsService.SetValueAsync(SettingKeys.Auth.AdminPasswordHash, hash, "Auth", "Hashed admin password.");
        await _settingsService.SetValueAsync(SettingKeys.Auth.Enabled, "true", "Auth", "Require authentication for dashboard/API.");

        return await IssueTokenAsync();
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthLoginResponse>> Login([FromBody] AuthLoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest("Password is required.");
        }

        var passwordHash = await _settingsService.GetValueAsync(SettingKeys.Auth.AdminPasswordHash);
        if (string.IsNullOrWhiteSpace(passwordHash))
        {
            return Conflict("Password has not been set.");
        }

        var result = _passwordHasher.VerifyHashedPassword("admin", passwordHash, request.Password);
        if (result == PasswordVerificationResult.Failed)
        {
            return Unauthorized();
        }

        return await IssueTokenAsync();
    }

    [HttpPost("change-password")]
    [Authorize]
    public async Task<ActionResult<AuthLoginResponse>> ChangePassword([FromBody] ChangePasswordRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword))
        {
            return BadRequest("New password is required.");
        }

        var passwordHash = await _settingsService.GetValueAsync(SettingKeys.Auth.AdminPasswordHash);
        if (string.IsNullOrWhiteSpace(passwordHash))
        {
            return Conflict("Password has not been set.");
        }

        var result = _passwordHasher.VerifyHashedPassword("admin", passwordHash, request.CurrentPassword ?? string.Empty);
        if (result == PasswordVerificationResult.Failed)
        {
            return Unauthorized();
        }

        var newHash = _passwordHasher.HashPassword("admin", request.NewPassword);
        await _settingsService.SetValueAsync(SettingKeys.Auth.AdminPasswordHash, newHash, "Auth", "Hashed admin password.");
        return await IssueTokenAsync();
    }

    [HttpPost("logout")]
    [AllowAnonymous]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(AuthTokenService.CookieName);
        return Ok();
    }

    private async Task<ActionResult<AuthLoginResponse>> IssueTokenAsync()
    {
        try
        {
            var token = _tokenService.CreateToken("admin", "Admin");
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
                AuthEnabled = authEnabled
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
        public bool LocalBypassEnabled { get; set; }
        public string? LocalBypassCidrs { get; set; }
        public string? ClientIp { get; set; }
        public bool ClientIsLocal { get; set; }
        public bool IsAuthenticated { get; set; }
        public string? AuthMethod { get; set; }
    }

    public sealed class AuthLoginRequest
    {
        public string Password { get; set; } = string.Empty;
    }

    public sealed class AuthSetupRequest
    {
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
    }
}
