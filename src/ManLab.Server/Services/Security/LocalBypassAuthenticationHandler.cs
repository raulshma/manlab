using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Security;

public sealed class LocalBypassAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "LocalBypass";

    private readonly LocalBypassEvaluator _evaluator;

    public LocalBypassAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        ISystemClock clock,
        LocalBypassEvaluator evaluator)
        : base(options, logger, encoder, clock)
    {
        _evaluator = evaluator;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var decision = await _evaluator.EvaluateAsync(Context);
        if (!decision.Allowed)
        {
            return AuthenticateResult.NoResult();
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, "local"),
            new(ClaimTypes.Role, "Admin"),
            new("auth_method", decision.Reason),
        };

        if (!string.IsNullOrWhiteSpace(decision.MatchedCidr))
        {
            claims.Add(new Claim("auth_bypass_cidr", decision.MatchedCidr!));
        }

        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);
        return AuthenticateResult.Success(ticket);
    }
}
