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

    /// <summary>Inventory of machines being onboarded via SSH.</summary>
    public DbSet<OnboardingMachine> OnboardingMachines => Set<OnboardingMachine>();

    /// <summary>Enrollment tokens used to bootstrap agent authentication.</summary>
    public DbSet<EnrollmentToken> EnrollmentTokens => Set<EnrollmentToken>();

    /// <summary>Audit trail for SSH onboarding/provisioning.</summary>
    public DbSet<SshAuditEvent> SshAuditEvents => Set<SshAuditEvent>();

    /// <summary>System-wide configuration settings.</summary>
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();

    /// <summary>Per-node configuration settings.</summary>
    public DbSet<NodeSetting> NodeSettings => Set<NodeSetting>();

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

        modelBuilder.Entity<OnboardingMachine>(entity =>
        {
            entity.HasIndex(e => e.Host);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.UpdatedAt);
        });

        modelBuilder.Entity<EnrollmentToken>(entity =>
        {
            entity.HasIndex(e => e.TokenHash).IsUnique();
            entity.HasIndex(e => e.ExpiresAt);
            entity.HasIndex(e => e.UsedAt);
            entity.HasIndex(e => e.MachineId);
        });

        modelBuilder.Entity<SshAuditEvent>(entity =>
        {
            entity.HasIndex(e => e.TimestampUtc);
            entity.HasIndex(e => e.Action);
            entity.HasIndex(e => e.MachineId);
            entity.HasIndex(e => e.Host);
            entity.HasIndex(e => e.Success);
        });

        modelBuilder.Entity<NodeSetting>(entity =>
        {
            entity.HasKey(e => new { e.NodeId, e.Key });
            entity.HasIndex(e => e.NodeId);

            entity.Property(e => e.Key).HasMaxLength(256);
            entity.Property(e => e.Category).HasMaxLength(64);
            entity.Property(e => e.Description).HasMaxLength(1024);

            entity.HasOne(e => e.Node)
                .WithMany()
                .HasForeignKey(e => e.NodeId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
