using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Application Performance Monitoring (APM) collector for tracking
/// response times, error rates, throughput, and database query performance.
/// </summary>
internal sealed class ApplicationPerformanceCollector
{
    private readonly ILogger _logger;
    private readonly AgentConfiguration _config;
    private readonly IHttpClientFactory _httpClientFactory;

    // Metrics aggregation state
    private readonly Dictionary<string, ApplicationMetricsAggregator> _appMetrics = new();
    private readonly Dictionary<string, DatabaseMetricsAggregator> _dbMetrics = new();
    private readonly Dictionary<string, EndpointMetricsAggregator> _endpointMetrics = new();
    private readonly ThroughputAggregator _throughputAggregator = new();

    private DateTime _lastSampleAtUtc;
    private ApplicationPerformanceTelemetry? _cached;

    public ApplicationPerformanceCollector(ILogger logger, AgentConfiguration config, IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _config = config;
        _httpClientFactory = httpClientFactory;
    }

    public ApplicationPerformanceTelemetry? Collect()
    {
        if (!_config.EnableApmTelemetry)
        {
            return null;
        }

        var cacheSeconds = Math.Max(1, _config.TelemetryCacheSeconds);
        if (_cached is not null && _lastSampleAtUtc != default &&
            (DateTime.UtcNow - _lastSampleAtUtc).TotalSeconds < cacheSeconds)
        {
            return _cached;
        }

        try
        {
            var telemetry = new ApplicationPerformanceTelemetry();

            // Collect application metrics from configured endpoints
            telemetry.Applications = CollectApplicationMetrics();

            // Collect database metrics
            telemetry.Databases = CollectDatabaseMetrics();

            // Collect endpoint metrics
            telemetry.Endpoints = GetEndpointMetrics();

            // Calculate system throughput
            telemetry.SystemThroughput = _throughputAggregator.GetMetrics();

            _cached = telemetry;
            _lastSampleAtUtc = DateTime.UtcNow;
            return telemetry;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "APM telemetry collection failed");
            return null;
        }
    }

    /// <summary>
    /// Record a request for metrics aggregation (called by instrumented code).
    /// </summary>
    public void RecordRequest(string appName, string endpoint, string method, int statusCode, float responseTimeMs, long bytesReceived, long bytesSent)
    {
        // Update application metrics
        if (!_appMetrics.TryGetValue(appName, out var appAgg))
        {
            appAgg = new ApplicationMetricsAggregator();
            _appMetrics[appName] = appAgg;
        }
        appAgg.RecordRequest(statusCode, responseTimeMs, bytesReceived, bytesSent);

        // Update endpoint metrics
        var endpointKey = $"{method}:{endpoint}";
        if (!_endpointMetrics.TryGetValue(endpointKey, out var endpointAgg))
        {
            endpointAgg = new EndpointMetricsAggregator(endpoint, method);
            _endpointMetrics[endpointKey] = endpointAgg;
        }
        endpointAgg.RecordRequest(statusCode, responseTimeMs);

        // Update throughput
        _throughputAggregator.RecordRequest(responseTimeMs, bytesReceived, bytesSent, statusCode >= 400);
    }

    /// <summary>
    /// Record a database query for metrics aggregation.
    /// </summary>
    public void RecordDatabaseQuery(string dbName, string query, float executionTimeMs, long? rowsAffected, bool failed)
    {
        if (!_dbMetrics.TryGetValue(dbName, out var dbAgg))
        {
            dbAgg = new DatabaseMetricsAggregator();
            _dbMetrics[dbName] = dbAgg;
        }
        dbAgg.RecordQuery(query, executionTimeMs, rowsAffected, failed);
    }

    private List<ApplicationMetrics> CollectApplicationMetrics()
    {
        var result = new List<ApplicationMetrics>();

        // Collect from configured health check endpoints
        foreach (var endpoint in _config.ApmHealthCheckEndpoints)
        {
            try
            {
                var metrics = CheckApplicationHealth(endpoint);
                if (metrics != null)
                {
                    // Merge with aggregated metrics if available
                    if (_appMetrics.TryGetValue(metrics.Name, out var agg))
                    {
                        var aggMetrics = agg.GetMetrics();
                        metrics.TotalRequests = aggMetrics.TotalRequests;
                        metrics.SuccessfulRequests = aggMetrics.SuccessfulRequests;
                        metrics.ClientErrors = aggMetrics.ClientErrors;
                        metrics.ServerErrors = aggMetrics.ServerErrors;
                        metrics.ErrorRatePercent = aggMetrics.ErrorRatePercent;
                        metrics.AvgResponseTimeMs = aggMetrics.AvgResponseTimeMs;
                        metrics.P50ResponseTimeMs = aggMetrics.P50ResponseTimeMs;
                        metrics.P95ResponseTimeMs = aggMetrics.P95ResponseTimeMs;
                        metrics.P99ResponseTimeMs = aggMetrics.P99ResponseTimeMs;
                        metrics.MaxResponseTimeMs = aggMetrics.MaxResponseTimeMs;
                        metrics.RequestsPerSecond = aggMetrics.RequestsPerSecond;
                        metrics.BytesReceivedPerSec = aggMetrics.BytesReceivedPerSec;
                        metrics.BytesSentPerSec = aggMetrics.BytesSentPerSec;
                    }
                    result.Add(metrics);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to check health for {Endpoint}", endpoint);
            }
        }

        // Add metrics for apps without health endpoints
        foreach (var (name, agg) in _appMetrics)
        {
            if (!result.Any(r => r.Name == name))
            {
                var metrics = agg.GetMetrics();
                metrics.Name = name;
                result.Add(metrics);
            }
        }

        return result;
    }

    private ApplicationMetrics? CheckApplicationHealth(string endpoint)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var uri = new Uri(endpoint);
            var httpClient = _httpClientFactory.CreateClient();
            var response = httpClient.GetAsync(endpoint).GetAwaiter().GetResult();
            sw.Stop();

            return new ApplicationMetrics
            {
                Name = uri.Host,
                HealthCheckUrl = endpoint,
                IsHealthy = response.IsSuccessStatusCode,
                HealthCheckResponseTimeMs = (float)sw.Elapsed.TotalMilliseconds
            };
        }
        catch (Exception)
        {
            sw.Stop();
            var uri = new Uri(endpoint);
            return new ApplicationMetrics
            {
                Name = uri.Host,
                HealthCheckUrl = endpoint,
                IsHealthy = false,
                HealthCheckResponseTimeMs = (float)sw.Elapsed.TotalMilliseconds
            };
        }
    }

    private List<DatabaseMetrics> CollectDatabaseMetrics()
    {
        var result = new List<DatabaseMetrics>();

        // Check configured database endpoints
        foreach (var dbConfig in _config.ApmDatabaseEndpoints)
        {
            try
            {
                var metrics = CheckDatabaseConnection(dbConfig);
                if (metrics != null)
                {
                    // Merge with aggregated metrics
                    if (_dbMetrics.TryGetValue(metrics.Name, out var agg))
                    {
                        var aggMetrics = agg.GetMetrics();
                        metrics.TotalQueries = aggMetrics.TotalQueries;
                        metrics.AvgQueryTimeMs = aggMetrics.AvgQueryTimeMs;
                        metrics.P95QueryTimeMs = aggMetrics.P95QueryTimeMs;
                        metrics.MaxQueryTimeMs = aggMetrics.MaxQueryTimeMs;
                        metrics.QueriesPerSecond = aggMetrics.QueriesPerSecond;
                        metrics.FailedQueries = aggMetrics.FailedQueries;
                        metrics.SlowQueries = aggMetrics.SlowQueries;
                    }
                    result.Add(metrics);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to check database {Name}", dbConfig.Name);
            }
        }

        // Add metrics for databases without configured endpoints
        foreach (var (name, agg) in _dbMetrics)
        {
            if (!result.Any(r => r.Name == name))
            {
                var metrics = agg.GetMetrics();
                metrics.Name = name;
                result.Add(metrics);
            }
        }

        return result;
    }

    private DatabaseMetrics? CheckDatabaseConnection(DatabaseEndpointConfig config)
    {
        var sw = Stopwatch.StartNew();
        var isReachable = false;

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            using var client = new TcpClient();

            try
            {
                client.ConnectAsync(config.Host, config.Port, cts.Token)
                    .GetAwaiter()
                    .GetResult();
                isReachable = true;
            }
            catch (OperationCanceledException)
            {
                // Timeout - connection failed
                isReachable = false;
            }
        }
        catch
        {
            // Connection failed
            isReachable = false;
        }

        sw.Stop();

        return new DatabaseMetrics
        {
            Name = config.Name,
            DatabaseType = config.DatabaseType,
            Host = config.Host,
            Port = config.Port,
            IsReachable = isReachable,
            ConnectionLatencyMs = isReachable ? (float)sw.Elapsed.TotalMilliseconds : null
        };
    }

    private List<EndpointMetrics> GetEndpointMetrics()
    {
        return _endpointMetrics.Values
            .Select(agg => agg.GetMetrics())
            .OrderByDescending(m => m.TotalRequests)
            .Take(20)
            .ToList();
    }


    // --- Aggregator Classes ---

    private sealed class ApplicationMetricsAggregator
    {
        private readonly object _lock = new();
        private readonly List<float> _responseTimes = new();
        private long _totalRequests;
        private long _successfulRequests;
        private long _clientErrors;
        private long _serverErrors;
        private long _bytesReceived;
        private long _bytesSent;
        private DateTime _windowStart = DateTime.UtcNow;

        public void RecordRequest(int statusCode, float responseTimeMs, long bytesReceived, long bytesSent)
        {
            lock (_lock)
            {
                _totalRequests++;
                _responseTimes.Add(responseTimeMs);
                _bytesReceived += bytesReceived;
                _bytesSent += bytesSent;

                if (statusCode >= 200 && statusCode < 400)
                {
                    _successfulRequests++;
                }
                else if (statusCode >= 400 && statusCode < 500)
                {
                    _clientErrors++;
                }
                else if (statusCode >= 500)
                {
                    _serverErrors++;
                }

                // Keep only last 1000 response times for percentile calculation
                if (_responseTimes.Count > 1000)
                {
                    _responseTimes.RemoveRange(0, _responseTimes.Count - 1000);
                }
            }
        }

        public ApplicationMetrics GetMetrics()
        {
            lock (_lock)
            {
                var elapsed = (DateTime.UtcNow - _windowStart).TotalSeconds;
                var sortedTimes = _responseTimes.OrderBy(t => t).ToList();

                return new ApplicationMetrics
                {
                    TotalRequests = _totalRequests,
                    SuccessfulRequests = _successfulRequests,
                    ClientErrors = _clientErrors,
                    ServerErrors = _serverErrors,
                    ErrorRatePercent = _totalRequests > 0 ? (float)((_clientErrors + _serverErrors) * 100.0 / _totalRequests) : 0,
                    AvgResponseTimeMs = sortedTimes.Count > 0 ? sortedTimes.Average() : null,
                    P50ResponseTimeMs = GetPercentile(sortedTimes, 50),
                    P95ResponseTimeMs = GetPercentile(sortedTimes, 95),
                    P99ResponseTimeMs = GetPercentile(sortedTimes, 99),
                    MaxResponseTimeMs = sortedTimes.Count > 0 ? sortedTimes.Max() : null,
                    RequestsPerSecond = elapsed > 0 ? (float)(_totalRequests / elapsed) : 0,
                    BytesReceivedPerSec = elapsed > 0 ? (long)(_bytesReceived / elapsed) : 0,
                    BytesSentPerSec = elapsed > 0 ? (long)(_bytesSent / elapsed) : 0
                };
            }
        }

        private static float? GetPercentile(List<float> sortedValues, int percentile)
        {
            if (sortedValues.Count == 0)
            {
                return null;
            }
            var index = (int)Math.Ceiling(percentile / 100.0 * sortedValues.Count) - 1;
            return sortedValues[Math.Max(0, Math.Min(index, sortedValues.Count - 1))];
        }
    }

    private sealed class DatabaseMetricsAggregator
    {
        private readonly object _lock = new();
        private readonly List<float> _queryTimes = new();
        private readonly List<SlowQueryInfo> _slowQueries = new();
        private long _totalQueries;
        private long _failedQueries;
        private DateTime _windowStart = DateTime.UtcNow;

        private const float SlowQueryThresholdMs = 1000;

        public void RecordQuery(string query, float executionTimeMs, long? rowsAffected, bool failed)
        {
            lock (_lock)
            {
                _totalQueries++;
                _queryTimes.Add(executionTimeMs);

                if (failed)
                {
                    _failedQueries++;
                }

                // Track slow queries
                if (executionTimeMs >= SlowQueryThresholdMs)
                {
                    _slowQueries.Add(new SlowQueryInfo
                    {
                        Query = query.Length > 200 ? query[..200] + "..." : query,
                        ExecutionTimeMs = executionTimeMs,
                        ExecutedAtUtc = DateTime.UtcNow,
                        RowsAffected = rowsAffected
                    });

                    // Keep only last 10 slow queries
                    if (_slowQueries.Count > 10)
                    {
                        _slowQueries.RemoveAt(0);
                    }
                }

                // Keep only last 1000 query times
                if (_queryTimes.Count > 1000)
                {
                    _queryTimes.RemoveRange(0, _queryTimes.Count - 1000);
                }
            }
        }

        public DatabaseMetrics GetMetrics()
        {
            lock (_lock)
            {
                var elapsed = (DateTime.UtcNow - _windowStart).TotalSeconds;
                var sortedTimes = _queryTimes.OrderBy(t => t).ToList();

                return new DatabaseMetrics
                {
                    TotalQueries = _totalQueries,
                    AvgQueryTimeMs = sortedTimes.Count > 0 ? sortedTimes.Average() : null,
                    P95QueryTimeMs = GetPercentile(sortedTimes, 95),
                    MaxQueryTimeMs = sortedTimes.Count > 0 ? sortedTimes.Max() : null,
                    QueriesPerSecond = elapsed > 0 ? (float)(_totalQueries / elapsed) : 0,
                    FailedQueries = _failedQueries,
                    SlowQueries = _slowQueries.OrderByDescending(q => q.ExecutionTimeMs).Take(5).ToList()
                };
            }
        }

        private static float? GetPercentile(List<float> sortedValues, int percentile)
        {
            if (sortedValues.Count == 0)
            {
                return null;
            }
            var index = (int)Math.Ceiling(percentile / 100.0 * sortedValues.Count) - 1;
            return sortedValues[Math.Max(0, Math.Min(index, sortedValues.Count - 1))];
        }
    }

    private sealed class EndpointMetricsAggregator
    {
        private readonly string _path;
        private readonly string _method;
        private readonly object _lock = new();
        private readonly List<float> _responseTimes = new();
        private readonly Dictionary<int, int> _statusCodes = new();
        private long _totalRequests;
        private long _errors;
        private DateTime _windowStart = DateTime.UtcNow;

        public EndpointMetricsAggregator(string path, string method)
        {
            _path = path;
            _method = method;
        }

        public void RecordRequest(int statusCode, float responseTimeMs)
        {
            lock (_lock)
            {
                _totalRequests++;
                _responseTimes.Add(responseTimeMs);

                if (!_statusCodes.ContainsKey(statusCode))
                {
                    _statusCodes[statusCode] = 0;
                }
                _statusCodes[statusCode]++;

                if (statusCode >= 400)
                {
                    _errors++;
                }

                if (_responseTimes.Count > 1000)
                {
                    _responseTimes.RemoveRange(0, _responseTimes.Count - 1000);
                }
            }
        }

        public EndpointMetrics GetMetrics()
        {
            lock (_lock)
            {
                var elapsed = (DateTime.UtcNow - _windowStart).TotalSeconds;
                var sortedTimes = _responseTimes.OrderBy(t => t).ToList();

                return new EndpointMetrics
                {
                    Path = _path,
                    Method = _method,
                    TotalRequests = _totalRequests,
                    AvgResponseTimeMs = sortedTimes.Count > 0 ? sortedTimes.Average() : null,
                    P95ResponseTimeMs = GetPercentile(sortedTimes, 95),
                    ErrorRatePercent = _totalRequests > 0 ? (float)(_errors * 100.0 / _totalRequests) : 0,
                    RequestsPerSecond = elapsed > 0 ? (float)(_totalRequests / elapsed) : 0,
                    MostCommonStatusCode = _statusCodes.Count > 0 ? _statusCodes.MaxBy(kv => kv.Value).Key : null
                };
            }
        }

        private static float? GetPercentile(List<float> sortedValues, int percentile)
        {
            if (sortedValues.Count == 0)
            {
                return null;
            }
            var index = (int)Math.Ceiling(percentile / 100.0 * sortedValues.Count) - 1;
            return sortedValues[Math.Max(0, Math.Min(index, sortedValues.Count - 1))];
        }
    }

    private sealed class ThroughputAggregator
    {
        private readonly object _lock = new();
        private long _totalRequests;
        private long _bytesReceived;
        private long _bytesSent;
        private long _errors;
        private float _peakRps;
        private readonly List<float> _latencies = new();
        private DateTime _windowStart = DateTime.UtcNow;
        private DateTime _lastRpsCheck = DateTime.UtcNow;
        private long _requestsSinceLastCheck;

        public void RecordRequest(float latencyMs, long bytesReceived, long bytesSent, bool isError)
        {
            lock (_lock)
            {
                _totalRequests++;
                _requestsSinceLastCheck++;
                _bytesReceived += bytesReceived;
                _bytesSent += bytesSent;
                _latencies.Add(latencyMs);

                if (isError)
                {
                    _errors++;
                }

                // Update peak RPS every second
                var now = DateTime.UtcNow;
                if ((now - _lastRpsCheck).TotalSeconds >= 1)
                {
                    var currentRps = (float)(_requestsSinceLastCheck / (now - _lastRpsCheck).TotalSeconds);
                    if (currentRps > _peakRps)
                    {
                        _peakRps = currentRps;
                    }
                    _requestsSinceLastCheck = 0;
                    _lastRpsCheck = now;
                }

                if (_latencies.Count > 1000)
                {
                    _latencies.RemoveRange(0, _latencies.Count - 1000);
                }
            }
        }

        public ThroughputMetrics GetMetrics()
        {
            lock (_lock)
            {
                var elapsed = (DateTime.UtcNow - _windowStart).TotalSeconds;

                return new ThroughputMetrics
                {
                    TotalRequestsPerSecond = elapsed > 0 ? (float)(_totalRequests / elapsed) : 0,
                    TotalBytesReceivedPerSec = elapsed > 0 ? (long)(_bytesReceived / elapsed) : 0,
                    TotalBytesSentPerSec = elapsed > 0 ? (long)(_bytesSent / elapsed) : 0,
                    PeakRequestsPerSecond = _peakRps,
                    AvgLatencyMs = _latencies.Count > 0 ? _latencies.Average() : null,
                    OverallErrorRatePercent = _totalRequests > 0 ? (float)(_errors * 100.0 / _totalRequests) : 0,
                    WindowStartUtc = _windowStart,
                    WindowDurationSeconds = (int)elapsed
                };
            }
        }
    }
}

/// <summary>
/// Configuration for a database endpoint to monitor.
/// </summary>
public sealed class DatabaseEndpointConfig
{
    public string Name { get; set; } = string.Empty;
    public string DatabaseType { get; set; } = string.Empty;
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; }
}
