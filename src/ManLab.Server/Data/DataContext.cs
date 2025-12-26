using ManLab.Server.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Data;

/// <summary>
/// Entity Framework Core database context for ManLab.
/// </summary>
public class DataContext : DbContext
{
    public DataContext(DbContextOptions<DataContext> options) : base(options)
    {
    }

    /// <summary>Registered agent nodes.</summary>
    public DbSet<Node> Nodes => Set<Node>();

    /// <summary>Telemetry snapshots from agent nodes.</summary>
    public DbSet<TelemetrySnapshot> TelemetrySnapshots => Set<TelemetrySnapshot>();

    /// <summary>Command queue for async task tracking.</summary>
    public DbSet<CommandQueueItem> CommandQueue => Set<CommandQueueItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Node configuration
        modelBuilder.Entity<Node>(entity =>
        {
            entity.HasIndex(e => e.Hostname);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.LastSeen);
        });

        // TelemetrySnapshot configuration
        modelBuilder.Entity<TelemetrySnapshot>(entity =>
        {
            entity.HasIndex(e => e.NodeId);
            entity.HasIndex(e => e.Timestamp);
            entity.HasIndex(e => new { e.NodeId, e.Timestamp });

            entity.HasOne(e => e.Node)
                .WithMany(n => n.TelemetrySnapshots)
                .HasForeignKey(e => e.NodeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // CommandQueueItem configuration
        modelBuilder.Entity<CommandQueueItem>(entity =>
        {
            entity.HasIndex(e => e.NodeId);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.CreatedAt);

            entity.HasOne(e => e.Node)
                .WithMany(n => n.Commands)
                .HasForeignKey(e => e.NodeId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
