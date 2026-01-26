using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace ManLab.Server.Services.Security;

public sealed class AuthTokenService
{
    public const string CookieName = "manlab_auth";

    private readonly AuthOptions _options;
    private readonly ILogger<AuthTokenService> _logger;

    public AuthTokenService(IOptions<AuthOptions> options, ILogger<AuthTokenService> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public AuthTokenResult CreateToken(string subject, string role, bool passwordMustChange = false)
    {
        if (string.IsNullOrWhiteSpace(_options.JwtSigningKey))
        {
            throw new InvalidOperationException("Auth:JwtSigningKey is not configured.");
        }

        var keyBytes = Encoding.UTF8.GetBytes(_options.JwtSigningKey);
        if (keyBytes.Length < 32)
        {
            throw new InvalidOperationException("Auth:JwtSigningKey must be at least 32 bytes.");
        }

        var key = new SymmetricSecurityKey(keyBytes);
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var now = DateTime.UtcNow;
        var expires = now.AddMinutes(Math.Max(5, _options.AccessTokenMinutes));

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, subject),
            new(ClaimTypes.Name, subject),
            new(ClaimTypes.Role, role),
            new("auth_method", "password")
        };

        if (passwordMustChange)
        {
            claims.Add(new Claim("password_must_change", "true"));
        }

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: now,
            expires: expires,
            signingCredentials: credentials);

        var tokenValue = new JwtSecurityTokenHandler().WriteToken(token);
        return new AuthTokenResult(tokenValue, expires);
    }

    public record AuthTokenResult(string Token, DateTime ExpiresAtUtc);
}
