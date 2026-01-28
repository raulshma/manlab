using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ManLab.Server.Services;

/// <summary>
/// Bootstraps the onboarding service, cleaning up any stuck jobs on startup.
/// </summary>
public sealed class OnboardingBootstrapper : IHostedService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<OnboardingBootstrapper> _logger;

    public OnboardingBootstrapper(
        IServiceScopeFactory scopeFactory,
        ILogger<OnboardingBootstrapper> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await CleanupStuckJobsAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to cleanup stuck onboarding jobs");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task CleanupStuckJobsAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var stuckMachines = await db.OnboardingMachines
            .Where(m => m.Status == OnboardingStatus.Running)
            .ToListAsync(cancellationToken);

        if (stuckMachines.Count == 0)
        {
            return;
        }

        _logger.LogInformation("Found {Count} stuck onboarding jobs. Marking as failed.", stuckMachines.Count);

        foreach (var machine in stuckMachines)
        {
            machine.Status = OnboardingStatus.Failed;
            machine.LastError = "Onboarding job interrupted by server shutdown";
            machine.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
