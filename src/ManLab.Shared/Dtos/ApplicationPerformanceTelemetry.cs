namespace ManLab.Shared.Dtos;

/// <summary>
/// Application Performance Monitoring (APM) telemetry data.
/// </summary>
public sealed class ApplicationPerformanceTelemetry
{
    /// <summary>Monitored applications/services.</summary>
    public List<ApplicationMetrics> Applications { get; set; } = [];

    /// <summary>Database performance metrics.</summary>
    public List<DatabaseMetrics> Databases { get; set; } = [];

    /// <summary>HTTP endpoint metrics.</summary>
    public List<EndpointMetrics> Endpoints { get; set; } = [];

    /// <summary>Overall system request throughput.</summary>
    public ThroughputMetrics? SystemThroughput { get; set; }
}

/// <summary>
/// Metrics for a monitored application or service.
/// </summary>
public sealed class ApplicationMetrics
{
    /// <summary>Application/service name.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Process ID (if running locally).</summary>
    public int? ProcessId { get; set; }

    /// <summary>Application type (e.g., "web", "api", "worker", "database").</summary>
    public string? ApplicationType { get; set; }

    /// <summary>Application version.</summary>
    public string? Version { get; set; }

    /// <summary>Whether the application is currently healthy.</summary>
    public bool IsHealthy { get; set; }

    /// <summary>Health check endpoint URL (if applicable).</summary>
    public string? HealthCheckUrl { get; set; }

    /// <summary>Last health check response time in milliseconds.</summary>
    public float? HealthCheckResponseTimeMs { get; set; }

    // --- Response Time ---

    /// <summary>Average response time in milliseconds.</summary>
    public float? AvgResponseTimeMs { get; set; }

    /// <summary>Median (P50) response time in milliseconds.</summary>
    public float? P50ResponseTimeMs { get; set; }

    /// <summary>95th percentile response time in milliseconds.</summary>
    public float? P95ResponseTimeMs { get; set; }

    /// <summary>99th percentile response time in milliseconds.</summary>
    public float? P99ResponseTimeMs { get; set; }

    /// <summary>Maximum response time in milliseconds.</summary>
    public float? MaxResponseTimeMs { get; set; }

    // --- Error Rates ---

    /// <summary>Total requests in the measurement window.</summary>
    public long TotalRequests { get; set; }

    /// <summary>Successful requests (2xx responses).</summary>
    public long SuccessfulRequests { get; set; }

    /// <summary>Client error requests (4xx responses).</summary>
    public long ClientErrors { get; set; }

    /// <summary>Server error requests (5xx responses).</summary>
    public long ServerErrors { get; set; }

    /// <summary>Error rate percentage (0-100).</summary>
    public float? ErrorRatePercent { get; set; }

    // --- Throughput ---

    /// <summary>Requests per second.</summary>
    public float? RequestsPerSecond { get; set; }

    /// <summary>Bytes received per second.</summary>
    public long? BytesReceivedPerSec { get; set; }

    /// <summary>Bytes sent per second.</summary>
    public long? BytesSentPerSec { get; set; }

    // --- Resource Usage ---

    /// <summary>CPU usage percentage (0-100).</summary>
    public float? CpuPercent { get; set; }

    /// <summary>Memory usage in bytes.</summary>
    public long? MemoryBytes { get; set; }

    /// <summary>Active connections/threads.</summary>
    public int? ActiveConnections { get; set; }

    /// <summary>Connection pool usage (if applicable).</summary>
    public int? ConnectionPoolSize { get; set; }

    /// <summary>Available connections in pool.</summary>
    public int? ConnectionPoolAvailable { get; set; }

    /// <summary>Uptime in seconds.</summary>
    public long? UptimeSeconds { get; set; }

    /// <summary>Last restart timestamp.</summary>
    public DateTime? LastRestartUtc { get; set; }
}

/// <summary>
/// Database performance metrics.
/// </summary>
public sealed class DatabaseMetrics
{
    /// <summary>Database name or connection identifier.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Database type (e.g., "PostgreSQL", "MySQL", "SQLServer", "MongoDB").</summary>
    public string? DatabaseType { get; set; }

    /// <summary>Database server hostname.</summary>
    public string? Host { get; set; }

    /// <summary>Database server port.</summary>
    public int? Port { get; set; }

    /// <summary>Whether the database is reachable.</summary>
    public bool IsReachable { get; set; }

    /// <summary>Connection latency in milliseconds.</summary>
    public float? ConnectionLatencyMs { get; set; }

    // --- Query Performance ---

    /// <summary>Total queries executed in the measurement window.</summary>
    public long TotalQueries { get; set; }

    /// <summary>Average query execution time in milliseconds.</summary>
    public float? AvgQueryTimeMs { get; set; }

    /// <summary>95th percentile query time in milliseconds.</summary>
    public float? P95QueryTimeMs { get; set; }

    /// <summary>Slowest query time in milliseconds.</summary>
    public float? MaxQueryTimeMs { get; set; }

    /// <summary>Queries per second.</summary>
    public float? QueriesPerSecond { get; set; }

    /// <summary>Failed queries count.</summary>
    public long FailedQueries { get; set; }

    // --- Connection Pool ---

    /// <summary>Active connections.</summary>
    public int? ActiveConnections { get; set; }

    /// <summary>Idle connections.</summary>
    public int? IdleConnections { get; set; }

    /// <summary>Maximum connections allowed.</summary>
    public int? MaxConnections { get; set; }

    /// <summary>Connection wait time in milliseconds.</summary>
    public float? ConnectionWaitTimeMs { get; set; }

    // --- Slow Queries ---

    /// <summary>Recent slow queries (limited to top 5).</summary>
    public List<SlowQueryInfo>? SlowQueries { get; set; }
}

/// <summary>
/// Information about a slow database query.
/// </summary>
public sealed class SlowQueryInfo
{
    /// <summary>Query text (truncated if too long).</summary>
    public string Query { get; set; } = string.Empty;

    /// <summary>Execution time in milliseconds.</summary>
    public float ExecutionTimeMs { get; set; }

    /// <summary>When the query was executed.</summary>
    public DateTime ExecutedAtUtc { get; set; }

    /// <summary>Number of rows affected/returned.</summary>
    public long? RowsAffected { get; set; }

    /// <summary>Database name.</summary>
    public string? DatabaseName { get; set; }
}

/// <summary>
/// HTTP endpoint performance metrics.
/// </summary>
public sealed class EndpointMetrics
{
    /// <summary>Endpoint path (e.g., "/api/users").</summary>
    public string Path { get; set; } = string.Empty;

    /// <summary>HTTP method (e.g., "GET", "POST").</summary>
    public string Method { get; set; } = string.Empty;

    /// <summary>Total requests to this endpoint.</summary>
    public long TotalRequests { get; set; }

    /// <summary>Average response time in milliseconds.</summary>
    public float? AvgResponseTimeMs { get; set; }

    /// <summary>95th percentile response time.</summary>
    public float? P95ResponseTimeMs { get; set; }

    /// <summary>Error rate percentage (0-100).</summary>
    public float? ErrorRatePercent { get; set; }

    /// <summary>Requests per second.</summary>
    public float? RequestsPerSecond { get; set; }

    /// <summary>Most common response status code.</summary>
    public int? MostCommonStatusCode { get; set; }
}

/// <summary>
/// System-wide throughput metrics.
/// </summary>
public sealed class ThroughputMetrics
{
    /// <summary>Total requests per second across all applications.</summary>
    public float TotalRequestsPerSecond { get; set; }

    /// <summary>Total bytes received per second.</summary>
    public long TotalBytesReceivedPerSec { get; set; }

    /// <summary>Total bytes sent per second.</summary>
    public long TotalBytesSentPerSec { get; set; }

    /// <summary>Peak requests per second in the measurement window.</summary>
    public float PeakRequestsPerSecond { get; set; }

    /// <summary>Average latency across all requests in milliseconds.</summary>
    public float? AvgLatencyMs { get; set; }

    /// <summary>Overall error rate percentage.</summary>
    public float? OverallErrorRatePercent { get; set; }

    /// <summary>Measurement window start time.</summary>
    public DateTime WindowStartUtc { get; set; }

    /// <summary>Measurement window duration in seconds.</summary>
    public int WindowDurationSeconds { get; set; }
}
