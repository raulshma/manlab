using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Filters;

namespace ManLab.Server.Services.Security;

public sealed class AdminOrLocalBypassRequirement : IAuthorizationRequirement
{
}

public sealed class AdminOrLocalBypassHandler : AuthorizationHandler<AdminOrLocalBypassRequirement>
{
    private readonly LocalBypassEvaluator _localBypassEvaluator;

    public AdminOrLocalBypassHandler(LocalBypassEvaluator localBypassEvaluator)
    {
        _localBypassEvaluator = localBypassEvaluator;
    }

    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        AdminOrLocalBypassRequirement requirement)
    {
        if (context.User?.IsInRole("Admin") == true)
        {
            context.Succeed(requirement);
            return;
        }

        var httpContext = GetHttpContext(context.Resource);
        if (httpContext is null)
        {
            return;
        }

        var decision = await _localBypassEvaluator.EvaluateAsync(httpContext);
        if (decision.Allowed)
        {
            context.Succeed(requirement);
        }
    }

    private static HttpContext? GetHttpContext(object? resource)
    {
        return resource switch
        {
            HttpContext httpContext => httpContext,
            AuthorizationFilterContext filterContext => filterContext.HttpContext,
            _ => null
        };
    }
}