using Microsoft.AspNetCore.Authorization;

namespace ManLab.Server.Services.Security;

public sealed class PermissionRequirement : IAuthorizationRequirement
{
    public PermissionRequirement(string permission)
    {
        Permission = permission ?? throw new ArgumentNullException(nameof(permission));
    }

    public string Permission { get; }
}

public sealed class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PermissionRequirement requirement)
    {
        if (context.User?.IsInRole("Admin") == true)
        {
            context.Succeed(requirement);
            return Task.CompletedTask;
        }

        if (context.User?.Claims.Any(c =>
                c.Type == Permissions.ClaimType &&
                string.Equals(c.Value, requirement.Permission, StringComparison.OrdinalIgnoreCase)) == true)
        {
            context.Succeed(requirement);
            return Task.CompletedTask;
        }

        if (requirement.Permission.StartsWith(Permissions.NetworkToolsPrefix, StringComparison.OrdinalIgnoreCase)
            && context.User?.Claims.Any(c =>
                c.Type == Permissions.ClaimType &&
                string.Equals(c.Value, Permissions.NetworkTools, StringComparison.OrdinalIgnoreCase)) == true)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
