using System.Collections.Concurrent;
using System.Net;
using MaxMind.Db;

namespace ManLab.Server.Services.Network;

/// <summary>
/// IP geolocation service using MMDB database files from ip-location-db.
/// </summary>
public sealed class IpGeolocationService : IIpGeolocationService, IDisposable
{
    private readonly ILogger<IpGeolocationService> _logger;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _dataPath;
    private string _databasePath;
    private string _activeSourceId;
    private Reader? _reader;
    private readonly object _readerLock = new();
    private bool _disposed;

    // Available database sources
    private static readonly IReadOnlyList<GeoDatabaseSource> _availableSources = new List<GeoDatabaseSource>
    {
        new()
        {
            Id = "geolite2-city",
            Name = "GeoLite2 City",
            Description = "MaxMind GeoLite2 City database with country, region, city, and coordinates",
            License = "GeoLite2 License (free for non-commercial use)",
            DownloadUrl = "https://cdn.jsdelivr.net/npm/@ip-location-db/geolite2-city-mmdb/geolite2-city-ipv4.mmdb",
            EstimatedSizeBytes = 25 * 1024 * 1024 // ~25 MB
        },
        new()
        {
            Id = "geolite2-country",
            Name = "GeoLite2 Country",
            Description = "MaxMind GeoLite2 Country database (smaller, country-level only)",
            License = "GeoLite2 License (free for non-commercial use)",
            DownloadUrl = "https://cdn.jsdelivr.net/npm/@ip-location-db/geolite2-country-mmdb/geolite2-country-ipv4.mmdb",
            EstimatedSizeBytes = 5 * 1024 * 1024 // ~5 MB
        },
        new()
        {
            Id = "dbip-city",
            Name = "DB-IP City",
            Description = "DB-IP City Lite database with country, region, city, and coordinates",
            License = "CC BY 4.0 (free for any use with attribution)",
            DownloadUrl = "https://cdn.jsdelivr.net/npm/@ip-location-db/dbip-city-mmdb/dbip-city-ipv4.mmdb",
            EstimatedSizeBytes = 20 * 1024 * 1024 // ~20 MB
        },
        new()
        {
            Id = "dbip-country",
            Name = "DB-IP Country",
            Description = "DB-IP Country Lite database (smaller, country-level only)",
            License = "CC BY 4.0 (free for any use with attribution)",
            DownloadUrl = "https://cdn.jsdelivr.net/npm/@ip-location-db/dbip-country-mmdb/dbip-country-ipv4.mmdb",
            EstimatedSizeBytes = 3 * 1024 * 1024 // ~3 MB
        }
    };

    private const string DefaultSourceId = "geolite2-city";
    private const string SourceIdFileName = "geolocation-source.txt";

    public IpGeolocationService(
        ILogger<IpGeolocationService> logger,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration)
    {
        _logger = logger;
        _httpClientFactory = httpClientFactory;
        
        // Get database path from configuration or use default
        _dataPath = configuration["Geolocation:DataPath"]
            ?? configuration["GeoLocation:DataPath"]
            ?? configuration["DataPath"]
            ?? GetDefaultDataPath();
        _logger.LogInformation("Geolocation database path set to {Path}", _dataPath);
        
        // Load active source ID
        _activeSourceId = LoadActiveSourceId() ?? DefaultSourceId;
        _databasePath = GetDatabasePath(_activeSourceId);
        
        // Initialize reader if database exists
        InitializeReader();
    }

    private static string GetDefaultDataPath()
    {
        var runningInContainer = string.Equals(
            Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER"),
            "true",
            StringComparison.OrdinalIgnoreCase);

        if (runningInContainer)
        {
            return Path.Combine(AppContext.BaseDirectory, "Distribution", "geolocation");
        }

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (string.IsNullOrWhiteSpace(appData))
        {
            return Path.Combine(AppContext.BaseDirectory, "Data", "ManLab");
        }

        return Path.Combine(appData, "ManLab");
    }

    private string GetDatabasePath(string sourceId) => 
        Path.Combine(_dataPath, $"{sourceId}.mmdb");

    private string? LoadActiveSourceId()
    {
        var sourceIdPath = Path.Combine(_dataPath, SourceIdFileName);
        if (File.Exists(sourceIdPath))
        {
            try
            {
                var sourceId = File.ReadAllText(sourceIdPath).Trim();
                if (_availableSources.Any(s => s.Id == sourceId))
                    return sourceId;
            }
            catch { }
        }
        return null;
    }

    private void SaveActiveSourceId(string sourceId)
    {
        try
        {
            Directory.CreateDirectory(_dataPath);
            File.WriteAllText(Path.Combine(_dataPath, SourceIdFileName), sourceId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to save active source ID");
        }
    }

    private void InitializeReader()
    {
        lock (_readerLock)
        {
            if (_reader is not null)
            {
                _reader.Dispose();
                _reader = null;
            }

            if (File.Exists(_databasePath))
            {
                try
                {
                    _reader = new Reader(_databasePath);
                    _logger.LogInformation("Loaded geolocation database from {Path}", _databasePath);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to load geolocation database from {Path}", _databasePath);
                }
            }
        }
    }

    public IReadOnlyList<GeoDatabaseSource> GetAvailableSources() => _availableSources;

    public Task<GeoDatabaseStatus> GetStatusAsync(CancellationToken ct = default)
    {
        var fileInfo = File.Exists(_databasePath) ? new FileInfo(_databasePath) : null;
        
        GeoDatabaseInfo? metadata = null;
        if (_reader is not null)
        {
            try
            {
                metadata = new GeoDatabaseInfo
                {
                    DatabaseType = _reader.Metadata.DatabaseType,
                    BuildDate = _reader.Metadata.BuildDate.ToString("yyyy-MM-dd"),
                    // Note: MaxMind.Db doesn't expose record count directly
                    RecordCount = null
                };
            }
            catch { }
        }
        
        return Task.FromResult(new GeoDatabaseStatus
        {
            IsAvailable = _reader is not null,
            DatabasePath = _databasePath,
            LastUpdated = fileInfo?.LastWriteTimeUtc,
            FileSizeBytes = fileInfo?.Length,
            ActiveSourceId = _activeSourceId,
            Metadata = metadata
        });
    }

    public async Task<bool> DownloadDatabaseAsync(IProgress<int>? progress = null, CancellationToken ct = default)
    {
        return await DownloadDatabaseAsync(_activeSourceId, progress, ct);
    }

    public async Task<bool> DownloadDatabaseAsync(string sourceId, IProgress<int>? progress = null, CancellationToken ct = default)
    {
        var source = _availableSources.FirstOrDefault(s => s.Id == sourceId);
        if (source is null)
        {
            _logger.LogError("Unknown database source: {SourceId}", sourceId);
            return false;
        }

        try
        {
            _logger.LogInformation("Starting geolocation database download from {Source} ({Url})", source.Name, source.DownloadUrl);
            
            // Ensure directory exists
            Directory.CreateDirectory(_dataPath);
            
            var targetPath = GetDatabasePath(sourceId);

            using var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromMinutes(5);
            
            using var response = await client.GetAsync(source.DownloadUrl, HttpCompletionOption.ResponseHeadersRead, ct);
            response.EnsureSuccessStatusCode();

            var totalBytes = response.Content.Headers.ContentLength ?? source.EstimatedSizeBytes ?? -1L;
            var tempPath = targetPath + ".tmp";

            await using (var contentStream = await response.Content.ReadAsStreamAsync(ct))
            await using (var fileStream = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true))
            {
                var buffer = new byte[81920];
                var totalRead = 0L;
                int bytesRead;

                while ((bytesRead = await contentStream.ReadAsync(buffer, ct)) > 0)
                {
                    await fileStream.WriteAsync(buffer.AsMemory(0, bytesRead), ct);
                    totalRead += bytesRead;

                    if (totalBytes > 0)
                    {
                        var percentComplete = (int)((totalRead * 100) / totalBytes);
                        progress?.Report(percentComplete);
                    }
                }
            }

            // Replace existing file atomically
            if (File.Exists(targetPath))
            {
                File.Delete(targetPath);
            }
            File.Move(tempPath, targetPath);
            
            // Update active source and reinitialize reader
            _activeSourceId = sourceId;
            _databasePath = targetPath;
            SaveActiveSourceId(sourceId);
            InitializeReader();
            
            _logger.LogInformation("Successfully downloaded {Source} database to {Path}", source.Name, targetPath);
            progress?.Report(100);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to download geolocation database from {Source}", source.Name);
            return false;
        }
    }

    public Task<bool> UpdateDatabaseAsync(IProgress<int>? progress = null, CancellationToken ct = default)
    {
        // Update is the same as download - just re-download the current source
        return DownloadDatabaseAsync(_activeSourceId, progress, ct);
    }

    public Task<bool> DeleteDatabaseAsync(CancellationToken ct = default)
    {
        try
        {
            lock (_readerLock)
            {
                _reader?.Dispose();
                _reader = null;
            }

            if (File.Exists(_databasePath))
            {
                File.Delete(_databasePath);
                _logger.LogInformation("Deleted geolocation database from {Path}", _databasePath);
            }

            // Also delete the source ID file
            var sourceIdPath = Path.Combine(_dataPath, SourceIdFileName);
            if (File.Exists(sourceIdPath))
            {
                File.Delete(sourceIdPath);
            }

            return Task.FromResult(true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete geolocation database");
            return Task.FromResult(false);
        }
    }

    public Task<GeoLocationResult?> LookupAsync(string ipAddress, CancellationToken ct = default)
    {
        if (_reader is null)
        {
            return Task.FromResult<GeoLocationResult?>(null);
        }

        try
        {
            if (!IPAddress.TryParse(ipAddress, out var ip))
            {
                return Task.FromResult<GeoLocationResult?>(new GeoLocationResult
                {
                    IpAddress = ipAddress
                });
            }

            // Skip private/local addresses
            if (IsPrivateOrLocal(ip))
            {
                return Task.FromResult<GeoLocationResult?>(new GeoLocationResult
                {
                    IpAddress = ipAddress
                });
            }

            var data = _reader.Find<Dictionary<string, object>>(ip);
            if (data is null)
            {
                return Task.FromResult<GeoLocationResult?>(new GeoLocationResult
                {
                    IpAddress = ipAddress
                });
            }

            return Task.FromResult<GeoLocationResult?>(ParseResult(ipAddress, data));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to lookup IP {IpAddress}", ipAddress);
            return Task.FromResult<GeoLocationResult?>(new GeoLocationResult
            {
                IpAddress = ipAddress
            });
        }
    }

    public async Task<IReadOnlyList<GeoLocationResult>> LookupBatchAsync(
        IEnumerable<string> ipAddresses, 
        CancellationToken ct = default)
    {
        if (_reader is null)
        {
            return ipAddresses.Select(ip => new GeoLocationResult { IpAddress = ip }).ToList();
        }

        var results = new ConcurrentBag<GeoLocationResult>();
        
        await Parallel.ForEachAsync(ipAddresses, ct, async (ip, token) =>
        {
            var result = await LookupAsync(ip, token);
            if (result is not null)
            {
                results.Add(result);
            }
        });

        return results.ToList();
    }

    private static GeoLocationResult ParseResult(string ipAddress, Dictionary<string, object> data)
    {
        // MMDB structure varies by database type
        // ip-location-db simplified format: country_code, state1, state2, city, postcode, latitude, longitude, timezone
        
        string? countryCode = null;
        string? country = null;
        string? state = null;
        string? city = null;
        string? postalCode = null;
        double? latitude = null;
        double? longitude = null;
        string? timezone = null;
        long? asn = null;
        string? isp = null;

        // Try to extract country info
        if (data.TryGetValue("country", out var countryObj) && countryObj is Dictionary<string, object> countryDict)
        {
            if (countryDict.TryGetValue("iso_code", out var isoCode))
                countryCode = isoCode?.ToString();
            if (countryDict.TryGetValue("names", out var namesObj) && namesObj is Dictionary<string, object> names)
            {
                if (names.TryGetValue("en", out var enName))
                    country = enName?.ToString();
            }
        }
        
        // Fallback for simpler format
        if (countryCode is null && data.TryGetValue("country_code", out var cc))
            countryCode = cc?.ToString();

        // Extract subdivisions (state)
        if (data.TryGetValue("subdivisions", out var subdivObj) && subdivObj is object[] subdivisions && subdivisions.Length > 0)
        {
            if (subdivisions[0] is Dictionary<string, object> subdiv)
            {
                if (subdiv.TryGetValue("names", out var namesObj) && namesObj is Dictionary<string, object> names)
                {
                    if (names.TryGetValue("en", out var enName))
                        state = enName?.ToString();
                }
            }
        }
        
        // Fallback for simpler format
        if (state is null && data.TryGetValue("state1", out var s1))
            state = s1?.ToString();

        // Extract city
        if (data.TryGetValue("city", out var cityObj))
        {
            if (cityObj is Dictionary<string, object> cityDict)
            {
                if (cityDict.TryGetValue("names", out var namesObj) && namesObj is Dictionary<string, object> names)
                {
                    if (names.TryGetValue("en", out var enName))
                        city = enName?.ToString();
                }
            }
            else
            {
                city = cityObj?.ToString();
            }
        }

        // Extract postal code
        if (data.TryGetValue("postal", out var postalObj) && postalObj is Dictionary<string, object> postalDict)
        {
            if (postalDict.TryGetValue("code", out var code))
                postalCode = code?.ToString();
        }
        else if (data.TryGetValue("postcode", out var pc))
        {
            postalCode = pc?.ToString();
        }

        // Extract location
        if (data.TryGetValue("location", out var locObj) && locObj is Dictionary<string, object> location)
        {
            if (location.TryGetValue("latitude", out var lat))
                latitude = Convert.ToDouble(lat);
            if (location.TryGetValue("longitude", out var lon))
                longitude = Convert.ToDouble(lon);
            if (location.TryGetValue("time_zone", out var tz))
                timezone = tz?.ToString();
        }
        else
        {
            // Simpler format fallback
            if (data.TryGetValue("latitude", out var lat))
                latitude = Convert.ToDouble(lat);
            if (data.TryGetValue("longitude", out var lon))
                longitude = Convert.ToDouble(lon);
            if (data.TryGetValue("timezone", out var tz))
                timezone = tz?.ToString();
        }

        // Extract ASN/ISP information (if available)
        if (data.TryGetValue("traits", out var traitsObj) && traitsObj is Dictionary<string, object> traits)
        {
            if (traits.TryGetValue("autonomous_system_number", out var asnValue) && long.TryParse(asnValue?.ToString(), out var parsedAsn))
            {
                asn = parsedAsn;
            }

            if (traits.TryGetValue("autonomous_system_organization", out var orgValue))
            {
                isp = orgValue?.ToString();
            }
        }

        if (asn is null && data.TryGetValue("asn", out var asnFallback) && long.TryParse(asnFallback?.ToString(), out var parsedFallbackAsn))
        {
            asn = parsedFallbackAsn;
        }

        if (isp is null)
        {
            if (data.TryGetValue("isp", out var ispValue))
                isp = ispValue?.ToString();
            else if (data.TryGetValue("organization", out var orgValue))
                isp = orgValue?.ToString();
        }

        return new GeoLocationResult
        {
            IpAddress = ipAddress,
            CountryCode = countryCode,
            Country = country,
            State = state,
            City = city,
            PostalCode = postalCode,
            Latitude = latitude,
            Longitude = longitude,
            Timezone = timezone,
            Asn = asn,
            Isp = isp
        };
    }

    private static bool IsPrivateOrLocal(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip))
            return true;

        var bytes = ip.GetAddressBytes();
        
        // IPv4
        if (bytes.Length == 4)
        {
            // 10.0.0.0/8
            if (bytes[0] == 10)
                return true;
            // 172.16.0.0/12
            if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
                return true;
            // 192.168.0.0/16
            if (bytes[0] == 192 && bytes[1] == 168)
                return true;
            // 169.254.0.0/16 (link-local)
            if (bytes[0] == 169 && bytes[1] == 254)
                return true;
        }
        
        return false;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        
        lock (_readerLock)
        {
            _reader?.Dispose();
            _reader = null;
        }
    }
}
