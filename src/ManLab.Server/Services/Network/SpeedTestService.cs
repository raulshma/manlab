using System.Buffers;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Implementation of server-side internet speed tests using M-Lab ndt7.
/// </summary>
public sealed class SpeedTestService : ISpeedTestService
{
    private readonly HttpClient _httpClient;
    private readonly SpeedTestOptions _options;
    private readonly ILogger<SpeedTestService> _logger;

    public SpeedTestService(
        HttpClient httpClient,
        IOptions<SpeedTestOptions> options,
        ILogger<SpeedTestService> logger)
    {
        _httpClient = httpClient;
        _options = options.Value ?? new SpeedTestOptions();
        _logger = logger;
    }

    public async Task<SpeedTestResult> RunAsync(
        SpeedTestRequest request,
        CancellationToken ct = default,
        Action<SpeedTestProgressUpdate>? onProgress = null)
    {
        var startedAt = DateTime.UtcNow;
        var overallStopwatch = Stopwatch.StartNew();

        var downloadBytes = ClampSize(request.DownloadSizeBytes ?? _options.DownloadSizeBytes);
        var uploadBytes = ClampSize(request.UploadSizeBytes ?? _options.UploadSizeBytes);
        var latencySamples = Math.Clamp(request.LatencySamples ?? _options.LatencySamples, 1, 10);

        try
        {
            var (downloadUrl, uploadUrl, discoveryError) = await DiscoverNdt7UrlsAsync(ct);
            if (downloadUrl is null || uploadUrl is null)
            {
                return new SpeedTestResult
                {
                    StartedAt = startedAt,
                    CompletedAt = DateTime.UtcNow,
                    Success = false,
                    Error = discoveryError ?? "Unable to discover M-Lab ndt7 endpoints."
                };
            }

            var metadata = BuildMetadata(downloadUrl, uploadUrl, downloadBytes, uploadBytes, latencySamples);
            onProgress?.Invoke(new SpeedTestProgressUpdate
            {
                Metadata = metadata
            });

            var rttSamples = new List<double>();
            var latencyCallback = CreateLatencyCallback(rttSamples, latencySamples, overallStopwatch, onProgress);

            var downloadResult = await RunDownloadAsync(
                downloadUrl,
                downloadBytes,
                rttSamples,
                latencySamples,
                latencyCallback,
                onProgress,
                ct);

            var uploadResult = await RunUploadAsync(
                uploadUrl,
                uploadBytes,
                rttSamples,
                latencySamples,
                latencyCallback,
                onProgress,
                ct);

            var latencyStats = ComputeLatencyStats(rttSamples);

            var completedAt = DateTime.UtcNow;
            var success = downloadResult.success && uploadResult.success && latencyStats.samples.Count > 0;

            return new SpeedTestResult
            {
                StartedAt = startedAt,
                CompletedAt = completedAt,
                Success = success,
                DownloadMbps = downloadResult.mbps,
                UploadMbps = uploadResult.mbps,
                DownloadBytes = downloadResult.bytes,
                UploadBytes = uploadResult.bytes,
                LatencyMinMs = latencyStats.minMs,
                LatencyAvgMs = latencyStats.avgMs,
                LatencyMaxMs = latencyStats.maxMs,
                JitterMs = latencyStats.jitterMs,
                DownloadSizeBytes = metadata.DownloadSizeBytes,
                UploadSizeBytes = metadata.UploadSizeBytes,
                LatencySamples = metadata.LatencySamples,
                LocateUrl = metadata.LocateUrl,
                DownloadUrl = metadata.DownloadUrl,
                UploadUrl = metadata.UploadUrl,
                ServiceName = metadata.ServiceName,
                ServiceType = metadata.ServiceType,
                ClientName = metadata.ClientName,
                ClientVersion = metadata.ClientVersion,
                ClientLibraryName = metadata.ClientLibraryName,
                ClientLibraryVersion = metadata.ClientLibraryVersion,
                Error = success ? null : BuildError(downloadResult.error, uploadResult.error, latencyStats.error)
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Speed test failed");
            return new SpeedTestResult
            {
                StartedAt = startedAt,
                CompletedAt = DateTime.UtcNow,
                Success = false,
                Error = ex.Message
            };
        }
    }

    private int ClampSize(int size)
    {
        if (size < 1) return 1_000_000;
        return Math.Clamp(size, 256_000, _options.MaxSizeBytes);
    }

    private async Task<(Uri? downloadUrl, Uri? uploadUrl, string? error)> DiscoverNdt7UrlsAsync(CancellationToken ct)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(_options.LocateTimeoutSeconds, 5, 60)));

            var locateUrl = BuildLocateUrl();
            using var request = new HttpRequestMessage(HttpMethod.Get, locateUrl);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.UserAgent.ParseAdd(BuildUserAgent());

            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token);

            if (response.StatusCode == System.Net.HttpStatusCode.NoContent)
            {
                return (null, null, "M-Lab locate service has no capacity at the moment.");
            }

            if (!response.IsSuccessStatusCode)
            {
                return (null, null, $"Locate request failed: {(int)response.StatusCode} {response.ReasonPhrase}");
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

            var urls = ExtractUrls(doc.RootElement);
            var download = urls.FirstOrDefault(u => u.Contains("/ndt/v7/download", StringComparison.OrdinalIgnoreCase));
            var upload = urls.FirstOrDefault(u => u.Contains("/ndt/v7/upload", StringComparison.OrdinalIgnoreCase));

            if (string.IsNullOrWhiteSpace(download) || string.IsNullOrWhiteSpace(upload))
            {
                return (null, null, "Locate response did not include ndt7 download/upload URLs.");
            }

            var downloadUrl = AppendMetadata(new Uri(download));
            var uploadUrl = AppendMetadata(new Uri(upload));

            return (downloadUrl, uploadUrl, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Failed to discover M-Lab ndt7 URLs");
            return (null, null, ex.Message);
        }
    }

    private string BuildLocateUrl()
    {
        var baseUrl = _options.LocateBaseUrl.TrimEnd('/');
        return $"{baseUrl}/v2/nearest/{_options.ServiceName}/{_options.ServiceType}";
    }

    private string BuildUserAgent()
    {
        var version = _options.ClientVersion ?? GetAssemblyVersion();
        return string.IsNullOrWhiteSpace(version)
            ? _options.ClientName
            : $"{_options.ClientName}/{version}";
    }

    private string? GetAssemblyVersion()
        => typeof(SpeedTestService).Assembly.GetName().Version?.ToString();

    private static List<string> ExtractUrls(JsonElement root)
    {
        var urls = new List<string>();

        if (!root.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
        {
            return urls;
        }

        foreach (var result in results.EnumerateArray())
        {
            if (!result.TryGetProperty("urls", out var urlsElement) || urlsElement.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            foreach (var property in urlsElement.EnumerateObject())
            {
                AppendUrlsFromElement(property.Value, urls);
            }
        }

        return urls;
    }

    private static void AppendUrlsFromElement(JsonElement element, List<string> urls)
    {
        if (element.ValueKind == JsonValueKind.String)
        {
            var value = element.GetString();
            if (!string.IsNullOrWhiteSpace(value))
            {
                urls.Add(value);
            }
            return;
        }

        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                AppendUrlsFromElement(property.Value, urls);
            }
        }
    }

    private Uri AppendMetadata(Uri uri)
    {
        var query = new StringBuilder(uri.Query.TrimStart('?'));
        void Append(string key, string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            if (query.Length > 0) query.Append('&');
            query.Append(Uri.EscapeDataString(key));
            query.Append('=');
            query.Append(Uri.EscapeDataString(value));
        }

        Append("client_name", _options.ClientName);
        Append("client_version", _options.ClientVersion ?? GetAssemblyVersion());
        Append("client_library_name", _options.ClientLibraryName);
        Append("client_library_version", _options.ClientLibraryVersion ?? GetAssemblyVersion());

        var builder = new UriBuilder(uri) { Query = query.ToString() };
        return builder.Uri;
    }

    private async Task<(bool success, long bytes, double? mbps, string? error)> RunDownloadAsync(
        Uri url,
        int limitBytes,
        List<double> rttSamples,
        int maxSamples,
        Action<double>? onLatencySample,
        Action<SpeedTestProgressUpdate>? onProgress,
        CancellationToken ct)
    {
        try
        {
            using var ws = new ClientWebSocket();
            ws.Options.AddSubProtocol("net.measurementlab.ndt.v7");

            await ws.ConnectAsync(url, ct);

            var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
            var sw = Stopwatch.StartNew();
            long lastProgressMs = 0;
            long totalBytes = 0;

            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    WebSocketReceiveResult result;
                    try
                    {
                        result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                    }
                    catch (WebSocketException ex) when (IsPrematureClose(ex))
                    {
                        break;
                    }
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        break;
                    }

                    if (result.MessageType == WebSocketMessageType.Binary)
                    {
                        totalBytes += result.Count;
                        ReportProgress("download", totalBytes, limitBytes, sw, ref lastProgressMs, onProgress, rttSamples, maxSamples);
                        if (totalBytes >= limitBytes)
                        {
                            try
                            {
                                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "limit reached", ct);
                            }
                            catch (WebSocketException ex) when (IsPrematureClose(ex))
                            {
                                // Ignore premature close during shutdown
                            }
                            break;
                        }
                    }
                    else if (result.MessageType == WebSocketMessageType.Text)
                    {
                        await ProcessTextMessageAsync(ws, buffer, result, rttSamples, maxSamples, onLatencySample, ct);
                    }
                }
            }
            finally
            {
                ArrayPool<byte>.Shared.Return(buffer);
            }

            sw.Stop();
            ReportProgress("download", totalBytes, limitBytes, sw, ref lastProgressMs, onProgress, rttSamples, maxSamples, force: true);
            var mbps = ToMbps(totalBytes, sw.Elapsed);
            return (true, totalBytes, mbps, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "NDT7 download test failed");
            return (false, 0, null, ex.Message);
        }
    }

    private async Task<(bool success, long bytes, double? mbps, string? error)> RunUploadAsync(
        Uri url,
        int limitBytes,
        List<double> rttSamples,
        int maxSamples,
        Action<double>? onLatencySample,
        Action<SpeedTestProgressUpdate>? onProgress,
        CancellationToken ct)
    {
        try
        {
            using var ws = new ClientWebSocket();
            ws.Options.AddSubProtocol("net.measurementlab.ndt.v7");

            await ws.ConnectAsync(url, ct);

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(_options.MaxTestSeconds, 5, 20)));

            var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
            Random.Shared.NextBytes(buffer);

            var sw = Stopwatch.StartNew();
            long lastProgressMs = 0;
            long totalBytes = 0;

            var receiveTask = Task.Run(async () =>
            {
                while (ws.State == WebSocketState.Open && !timeoutCts.IsCancellationRequested)
                {
                    WebSocketReceiveResult result;
                    try
                    {
                        result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), timeoutCts.Token);
                    }
                    catch (WebSocketException ex) when (IsPrematureClose(ex))
                    {
                        break;
                    }
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        break;
                    }

                    if (result.MessageType == WebSocketMessageType.Text)
                    {
                        await ProcessTextMessageAsync(ws, buffer, result, rttSamples, maxSamples, onLatencySample, timeoutCts.Token);
                    }
                }
            }, timeoutCts.Token);

            try
            {
                while (ws.State == WebSocketState.Open && !timeoutCts.IsCancellationRequested)
                {
                    var remaining = limitBytes - totalBytes;
                    if (remaining <= 0)
                    {
                        try
                        {
                            await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "limit reached", ct);
                        }
                        catch (WebSocketException ex) when (IsPrematureClose(ex))
                        {
                            // Ignore premature close during shutdown
                        }
                        break;
                    }

                    var chunkSize = (int)Math.Min(buffer.Length, remaining);
                    await ws.SendAsync(new ArraySegment<byte>(buffer, 0, chunkSize), WebSocketMessageType.Binary, true, timeoutCts.Token);
                    totalBytes += chunkSize;
                    ReportProgress("upload", totalBytes, limitBytes, sw, ref lastProgressMs, onProgress, rttSamples, maxSamples);
                }
            }
            finally
            {
                timeoutCts.Cancel();
                await Task.WhenAny(receiveTask, Task.Delay(50, ct));
                ArrayPool<byte>.Shared.Return(buffer);
            }

            sw.Stop();
            ReportProgress("upload", totalBytes, limitBytes, sw, ref lastProgressMs, onProgress, rttSamples, maxSamples, force: true);
            var mbps = ToMbps(totalBytes, sw.Elapsed);
            return (true, totalBytes, mbps, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "NDT7 upload test failed");
            return (false, 0, null, ex.Message);
        }
    }

    private async Task ProcessTextMessageAsync(
        ClientWebSocket ws,
        byte[] buffer,
        WebSocketReceiveResult initial,
        List<double> rttSamples,
        int maxSamples,
        Action<double>? onLatencySample,
        CancellationToken ct)
    {
        var text = await ReadTextMessageAsync(ws, buffer, initial, ct);
        if (string.IsNullOrWhiteSpace(text)) return;

        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("TCPInfo", out var tcpInfo) && tcpInfo.ValueKind == JsonValueKind.Object)
            {
                if (tcpInfo.TryGetProperty("RTT", out var rttElement) && rttElement.TryGetInt64(out var rttMicros))
                {
                    if (AddLatencySample(rttSamples, maxSamples, rttMicros / 1000d))
                    {
                        onLatencySample?.Invoke(rttMicros / 1000d);
                    }
                }
                else if (tcpInfo.TryGetProperty("MinRTT", out var minRttElement) && minRttElement.TryGetInt64(out var minRttMicros))
                {
                    if (AddLatencySample(rttSamples, maxSamples, minRttMicros / 1000d))
                    {
                        onLatencySample?.Invoke(minRttMicros / 1000d);
                    }
                }
            }
        }
        catch (JsonException)
        {
            // Ignore malformed measurement frames
        }
    }

    private static bool AddLatencySample(List<double> samples, int maxSamples, double valueMs)
    {
        if (maxSamples <= 0) return false;
        if (samples.Count >= maxSamples) return false;
        if (double.IsNaN(valueMs) || double.IsInfinity(valueMs)) return false;
        samples.Add(valueMs);
        return true;
    }

    private SpeedTestMetadata BuildMetadata(Uri downloadUrl, Uri uploadUrl, int downloadBytes, int uploadBytes, int latencySamples)
    {
        var version = _options.ClientVersion ?? GetAssemblyVersion();
        var libraryVersion = _options.ClientLibraryVersion ?? GetAssemblyVersion();
        return new SpeedTestMetadata
        {
            DownloadSizeBytes = downloadBytes,
            UploadSizeBytes = uploadBytes,
            LatencySamples = latencySamples,
            LocateUrl = BuildLocateUrl(),
            DownloadUrl = downloadUrl.ToString(),
            UploadUrl = uploadUrl.ToString(),
            ServiceName = _options.ServiceName,
            ServiceType = _options.ServiceType,
            ClientName = _options.ClientName,
            ClientVersion = version,
            ClientLibraryName = _options.ClientLibraryName,
            ClientLibraryVersion = libraryVersion
        };
    }

    private static Action<double> CreateLatencyCallback(
        List<double> rttSamples,
        int maxSamples,
        Stopwatch overallStopwatch,
        Action<SpeedTestProgressUpdate>? onProgress)
    {
        return sampleMs =>
        {
            onProgress?.Invoke(new SpeedTestProgressUpdate
            {
                Progress = new SpeedTestProgress
                {
                    Phase = "latency",
                    BytesTransferred = 0,
                    TargetBytes = 0,
                    Mbps = null,
                    LatencySampleMs = sampleMs,
                    LatencySamplesCollected = rttSamples.Count,
                    LatencySamplesTarget = maxSamples,
                    ElapsedMs = overallStopwatch.ElapsedMilliseconds
                }
            });
        };
    }

    private static void ReportProgress(
        string phase,
        long bytes,
        int targetBytes,
        Stopwatch sw,
        ref long lastProgressMs,
        Action<SpeedTestProgressUpdate>? onProgress,
        List<double> rttSamples,
        int maxSamples,
        bool force = false)
    {
        var elapsedMs = sw.ElapsedMilliseconds;
        if (!force && elapsedMs - lastProgressMs < 250)
        {
            return;
        }

        lastProgressMs = elapsedMs;
        onProgress?.Invoke(new SpeedTestProgressUpdate
        {
            Progress = new SpeedTestProgress
            {
                Phase = phase,
                BytesTransferred = bytes,
                TargetBytes = targetBytes,
                Mbps = ToMbps(bytes, sw.Elapsed),
                LatencySampleMs = null,
                LatencySamplesCollected = rttSamples.Count,
                LatencySamplesTarget = maxSamples,
                ElapsedMs = elapsedMs
            }
        });
    }

    private static async Task<string> ReadTextMessageAsync(
        ClientWebSocket ws,
        byte[] buffer,
        WebSocketReceiveResult initial,
        CancellationToken ct)
    {
        var builder = new StringBuilder();
        builder.Append(Encoding.UTF8.GetString(buffer, 0, initial.Count));

        var result = initial;
        while (!result.EndOfMessage && ws.State == WebSocketState.Open)
        {
            result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                break;
            }
            builder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
        }

        return builder.ToString();
    }

    private static (List<double> samples, double? minMs, double? avgMs, double? maxMs, double? jitterMs, string? error) ComputeLatencyStats(List<double> samples)
    {
        if (samples.Count == 0)
        {
            return (samples, null, null, null, null, "Latency samples unavailable from ndt7 measurements");
        }

        var min = samples.Min();
        var max = samples.Max();
        var avg = samples.Average();
        var jitter = CalculateStdDev(samples, avg);

        return (samples, min, avg, max, jitter, null);
    }

    private static double? ToMbps(long bytes, TimeSpan duration)
    {
        if (duration.TotalSeconds <= 0 || bytes <= 0) return null;
        return (bytes * 8d) / (duration.TotalSeconds * 1_000_000d);
    }

    private static double? CalculateStdDev(IEnumerable<double> samples, double mean)
    {
        var values = samples.ToArray();
        if (values.Length <= 1) return 0;
        var sumSq = values.Sum(v => Math.Pow(v - mean, 2));
        return Math.Sqrt(sumSq / values.Length);
    }

    private static string? BuildError(params string?[] messages)
    {
        var combined = string.Join(" | ", messages.Where(m => !string.IsNullOrWhiteSpace(m)));
        return string.IsNullOrWhiteSpace(combined) ? null : combined;
    }

    private static bool IsPrematureClose(WebSocketException ex)
        => ex.WebSocketErrorCode == WebSocketError.ConnectionClosedPrematurely
           || ex.Message.Contains("close handshake", StringComparison.OrdinalIgnoreCase);
}
