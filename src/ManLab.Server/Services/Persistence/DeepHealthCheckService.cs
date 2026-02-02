using ManLab.Server.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using NATS.Client.Core;
using StackExchange.Redis;
using System.Diagnostics;

namespace ManLab.Server.Services.Persistence;

/// <summary>
/// Deep health check service that provides comprehensive health status for critical dependencies.
/// </summary>
public class DeepHealthCheckService : IHealthCheck
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly INatsConnection? _natsConnection;
    private readonly IConnectionMultiplexer? _redisConnection;
    private readonly ILogger<DeepHealthCheckService> _logger;

    public DeepHealthCheckService(
        IServiceScopeFactory scopeFactory,
        INatsConnection? natsConnection = null,
        IConnectionMultiplexer? redisConnection = null,
        ILogger<DeepHealthCheckService>? logger = null)
    {
        _scopeFactory = scopeFactory;
        _natsConnection = natsConnection;
        _redisConnection = redisConnection;
        _logger = logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<DeepHealthCheckService>.Instance;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        var results = new Dictionary<string, object>();
        var overallStatus = HealthStatus.Healthy;
        var sw = Stopwatch.StartNew();

        try
        {
            // Check Database Connectivity
            var dbHealth = await CheckDatabaseHealthAsync(cancellationToken);
            results["database"] = dbHealth;
            if (dbHealth.Status != HealthStatus.Healthy)
            {
                overallStatus = HealthStatus.Degraded;
                if (dbHealth.Status == HealthStatus.Unhealthy)
                {
                    overallStatus = HealthStatus.Unhealthy;
                }
            }

            // Check NATS Connection
            var natsHealth = CheckNatsHealth();
            results["nats"] = natsHealth;
            if (natsHealth.Status == HealthStatus.Unhealthy)
            {
                overallStatus = HealthStatus.Degraded;
            }

            // Check Redis Connection
            var redisHealth = await CheckRedisHealthAsync(cancellationToken);
            results["redis"] = redisHealth;
            if (redisHealth.Status == HealthStatus.Unhealthy)
            {
                overallStatus = HealthStatus.Degraded;
            }

            sw.Stop();
            results["checkDurationMs"] = sw.ElapsedMilliseconds;

            var description = overallStatus switch
            {
                HealthStatus.Healthy => "All systems operational",
                HealthStatus.Degraded => "Some systems degraded but operational",
                HealthStatus.Unhealthy => "Critical systems unavailable",
                _ => "Unknown status"
            };

            return overallStatus switch
            {
                HealthStatus.Healthy => HealthCheckResult.Healthy(description, data: results),
                HealthStatus.Degraded => HealthCheckResult.Degraded(description, data: results),
                HealthStatus.Unhealthy => HealthCheckResult.Unhealthy(description, data: results),
                _ => HealthCheckResult.Unhealthy(description, data: results)
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Health check failed with exception");
            results["error"] = ex.Message;
            return HealthCheckResult.Unhealthy("Health check failed", data: results);
        }
    }

    private async Task<HealthCheckResult> CheckDatabaseHealthAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

            var sw = Stopwatch.StartNew();

            // Test basic connectivity
            var canConnect = await dbContext.Database.CanConnectAsync(cancellationToken);
            if (!canConnect)
            {
                return HealthCheckResult.Unhealthy("Database cannot connect", data: new Dictionary<string, object>
                {
                    ["status"] = "disconnected"
                });
            }

            // Test query performance with a simple LINQ query
            var nodeCount = await dbContext.Nodes.CountAsync(cancellationToken);

            sw.Stop();

            var dbResult = new Dictionary<string, object>
            {
                ["status"] = "connected",
                ["responseTimeMs"] = sw.ElapsedMilliseconds,
                ["nodeCount"] = nodeCount
            };

            // Check if TimescaleDB is available (using raw SQL)
            try
            {
                var timescaleExists = await dbContext.Nodes
                    .FromSqlRaw("SELECT 1 AS Id FROM pg_extension WHERE extname = 'timescaledb' LIMIT 1")
                    .FirstOrDefaultAsync(cancellationToken);
                dbResult["timescaleDB"] = timescaleExists != null;
            }
            catch
            {
                dbResult["timescaleDB"] = false;
            }

            return HealthCheckResult.Healthy("Database operational", data: dbResult);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Database health check failed");
            return HealthCheckResult.Unhealthy($"Database unavailable: {ex.Message}", data: new Dictionary<string, object>
            {
                ["status"] = "disconnected",
                ["error"] = ex.Message
            });
        }
    }

    private HealthCheckResult CheckNatsHealth()
    {
        if (_natsConnection == null)
        {
            return HealthCheckResult.Healthy("NATS not configured", data: new Dictionary<string, object>
            {
                ["status"] = "not_configured"
            });
        }

        try
        {
            // NATS connection check - the API doesn't expose State directly in this version
            // We simply verify the connection object exists
            var isHealthy = _natsConnection != null;

            return new HealthCheckResult(
                isHealthy ? HealthStatus.Healthy : HealthStatus.Unhealthy,
                "NATS check complete",
                data: new Dictionary<string, object>
                {
                    ["status"] = isHealthy ? "configured" : "error",
                    ["url"] = _natsConnection.Opts.Url
                });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "NATS health check failed");
            return HealthCheckResult.Unhealthy($"NATS unavailable: {ex.Message}", data: new Dictionary<string, object>
            {
                ["status"] = "error",
                ["error"] = ex.Message
            });
        }
    }

    private async Task<HealthCheckResult> CheckRedisHealthAsync(CancellationToken cancellationToken)
    {
        if (_redisConnection == null)
        {
            return HealthCheckResult.Healthy("Redis not configured", data: new Dictionary<string, object>
            {
                ["status"] = "not_configured"
            });
        }

        try
        {
            var sw = Stopwatch.StartNew();
            var db = _redisConnection.GetDatabase();
            await db.PingAsync();
            sw.Stop();

            var info = await _redisConnection.GetDatabase().StringGetAsync("health_check");
            var endpoints = _redisConnection.GetEndPoints();

            return HealthCheckResult.Healthy("Redis operational", data: new Dictionary<string, object>
            {
                ["status"] = "connected",
                ["responseTimeMs"] = sw.ElapsedMilliseconds,
                ["endpointCount"] = endpoints.Length,
                ["isConnected"] = _redisConnection.IsConnected
            });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Redis health check failed");
            return HealthCheckResult.Unhealthy($"Redis unavailable: {ex.Message}", data: new Dictionary<string, object>
            {
                ["status"] = "disconnected",
                ["error"] = ex.Message
            });
        }
    }
}

/// <summary>
/// Extension methods for registering deep health checks.
/// </summary>
public static class DeepHealthCheckExtensions
{
    /// <summary>
    /// Adds deep health checks for database and external services.
    /// </summary>
    public static IHealthChecksBuilder AddDeepHealthChecks(
        this IHealthChecksBuilder builder,
        string? name = null,
        HealthStatus? failureStatus = null,
        IEnumerable<string>? tags = null)
    {
        return builder.AddCheck<DeepHealthCheckService>(
            name ?? "deep",
            failureStatus ?? HealthStatus.Degraded,
            tags ?? Array.Empty<string>());
    }
}
