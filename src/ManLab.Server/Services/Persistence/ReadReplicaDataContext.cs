using ManLab.Server.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Persistence;

/// <summary>
/// Factory for creating DataContext instances with optional read replica routing.
/// Read queries can be routed to a replica for better scalability, while writes
/// always go to the primary database.
/// </summary>
public interface IDataContextFactory
{
    /// <summary>
    /// Creates a DataContext for read operations (may use replica).
    /// </summary>
    DataContext CreateReadOnlyContext();

    /// <summary>
    /// Creates a DataContext for write operations (always uses primary).
    /// </summary>
    DataContext CreateReadWriteContext();

    /// <summary>
    /// Creates a DataContext with explicit replica usage.
    /// </summary>
    DataContext CreateReplicaContext();
}

/// <summary>
/// Default implementation of IDataContextFactory that supports read replica routing.
/// </summary>
public class DataContextFactory : IDataContextFactory
{
    private readonly IServiceProvider _serviceProvider;
    private readonly DatabaseOptions _options;
    private readonly Random _random = new();

    public DataContextFactory(
        IServiceProvider serviceProvider,
        IOptions<DatabaseOptions> options)
    {
        _serviceProvider = serviceProvider;
        _options = options.Value;
    }

    /// <summary>
    /// Creates a DataContext optimized for read operations.
    /// May route to replica based on probability setting.
    /// </summary>
    public DataContext CreateReadOnlyContext()
    {
        // For now, always use primary since replica routing requires significant additional complexity
        // with multiple DbContext factories and connection string management
        var scope = _serviceProvider.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<DataContext>();

        return ConfigureForReads(context);
    }

    /// <summary>
    /// Creates a DataContext for read-write operations (always primary).
    /// </summary>
    public DataContext CreateReadWriteContext()
    {
        var scope = _serviceProvider.CreateScope();
        return scope.ServiceProvider.GetRequiredService<DataContext>();
    }

    /// <summary>
    /// Creates a DataContext explicitly using the replica.
    /// </summary>
    public DataContext CreateReplicaContext()
    {
        // For now, replicas are not directly supported through this factory
        // The database options allow for future implementation
        return CreateReadOnlyContext();
    }

    private static DataContext ConfigureForReads(DataContext context)
    {
        // Optimize for read-only queries: disable change tracking
        context.ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking;
        context.ChangeTracker.AutoDetectChangesEnabled = false;
        return context;
    }
}

/// <summary>
/// Extension methods for using IDataContextFactory with dependency injection.
/// </summary>
public static class DataContextFactoryExtensions
{
    /// <summary>
    /// Adds the DataContext factory with read replica support to the service collection.
    /// </summary>
    public static IServiceCollection AddDataContextFactorySupport(
        this IServiceCollection services)
    {
        services.AddSingleton<IDataContextFactory, DataContextFactory>();
        return services;
    }
}
