using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Entities.Enhancements;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace ManLab.Server.Services.Persistence;

/// <summary>
/// Bounds large text columns at write-time (tail semantics) to avoid unbounded DB growth.
/// </summary>
internal sealed class BoundedTextSaveChangesInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Bound(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Bound(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private static void Bound(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified))
            {
                continue;
            }

            switch (entry.Entity)
            {
                case ScriptRun run:
                    run.StdoutTail = TextBounds.TruncateTailUtf8(run.StdoutTail, ScriptRun.MaxTailBytesUtf8);
                    run.StderrTail = TextBounds.TruncateTailUtf8(run.StderrTail, ScriptRun.MaxTailBytesUtf8);
                    break;

                // Existing command output can also grow quickly.
                case CommandQueueItem cmd:
                    cmd.OutputLog = TextBounds.TruncateTailUtf8(cmd.OutputLog, 64 * 1024);
                    break;
            }
        }
    }
}
