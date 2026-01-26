using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;

namespace ManLab.Server.Services.Security;

/// <summary>
/// Authorization handler that checks if a password change is required.
/// If a password change is required, restrict access to only the change password endpoint.
/// </summary>
public sealed class PasswordChangeRequiredHandler : AuthorizationHandler<PasswordChangeRequiredRequirement>
{
    private readonly LocalBypassEvaluator _localBypassEvaluator;

    public PasswordChangeRequiredHandler(LocalBypassEvaluator localBypassEvaluator)
    {
        _localBypassEvaluator = localBypassEvaluator;
    }

    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PasswordChangeRequiredRequirement requirement)
    {
        var authMethod = context.User.FindFirst("auth_method")?.Value;
        if (string.Equals(authMethod, "local-bypass", StringComparison.OrdinalIgnoreCase))
        {
            context.Succeed(requirement);
            return;
        }

        var passwordMustChangeClaim = context.User.FindFirst("password_must_change");
        var passwordMustChange = passwordMustChangeClaim?.Value == "true";

        if (passwordMustChange)
        {
            var httpContext = GetHttpContext(context.Resource);
            if (httpContext is not null)
            {
                var decision = await _localBypassEvaluator.EvaluateAsync(httpContext);
                if (decision.Allowed)
                {
                    context.Succeed(requirement);
                    return;
                }
            }

            // If password must be changed, only allow access to change password endpoint
            var path = httpContext?.Request.Path.Value;

            // Allow access to the change password endpoint and auth status endpoint
            var isAllowedEndpoint = path?.Contains("/api/auth/change-password") == true ||
                                   path?.Contains("/api/auth/status") == true ||
                                   path?.Contains("/api/auth/logout") == true;

            if (isAllowedEndpoint)
            {
                context.Succeed(requirement);
            }
        }
        else
        {
            context.Succeed(requirement);
        }
    }

    private static Microsoft.AspNetCore.Http.HttpContext? GetHttpContext(object? resource)
    {
        return resource switch
        {
            Microsoft.AspNetCore.Http.HttpContext httpContext => httpContext,
            Microsoft.AspNetCore.Mvc.Filters.AuthorizationFilterContext filterContext => filterContext.HttpContext,
            _ => null
        };
    }
}

public sealed class PasswordChangeRequiredRequirement : IAuthorizationRequirement
{
}
