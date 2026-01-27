namespace ManLab.Server.Services.Network;

/// <summary>
/// Result of an IP geolocation lookup.
/// </summary>
public record GeoLocationResult
{
    /// <summary>
    /// The IP address that was looked up.
    /// </summary>
    public required string IpAddress { get; init; }

    /// <summary>
    /// ISO 3166-1 alpha-2 country code.
    /// </summary>
    public string? CountryCode { get; init; }

    /// <summary>
    /// Country name.
    /// </summary>
    public string? Country { get; init; }

    /// <summary>
    /// State or region name (first-level subdivision).
    /// </summary>
    public string? State { get; init; }

    /// <summary>
    /// City name.
    /// </summary>
    public string? City { get; init; }

    /// <summary>
    /// Postal/ZIP code.
    /// </summary>
    public string? PostalCode { get; init; }

    /// <summary>
    /// Latitude coordinate.
    /// </summary>
    public double? Latitude { get; init; }

    /// <summary>
    /// Longitude coordinate.
    /// </summary>
    public double? Longitude { get; init; }

    /// <summary>
    /// IANA timezone identifier.
    /// </summary>
    public string? Timezone { get; init; }

    /// <summary>
    /// Autonomous system number (ASN).
    /// </summary>
    public long? Asn { get; init; }

    /// <summary>
    /// ISP or organization name.
    /// </summary>
    public string? Isp { get; init; }

    /// <summary>
    /// Whether the lookup was successful.
    /// </summary>
    public bool IsFound => CountryCode is not null || Latitude.HasValue;
}

/// <summary>
/// Available geolocation database source.
/// </summary>
public record GeoDatabaseSource
{
    /// <summary>
    /// Unique identifier for this source (e.g., "geolite2-city").
    /// </summary>
    public required string Id { get; init; }

    /// <summary>
    /// Human-readable name (e.g., "GeoLite2 City").
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Description of the database.
    /// </summary>
    public required string Description { get; init; }

    /// <summary>
    /// License information.
    /// </summary>
    public required string License { get; init; }

    /// <summary>
    /// URL to download the database from.
    /// </summary>
    public required string DownloadUrl { get; init; }

    /// <summary>
    /// Estimated file size in bytes.
    /// </summary>
    public long? EstimatedSizeBytes { get; init; }
}

/// <summary>
/// Metadata about the installed database.
/// </summary>
public record GeoDatabaseInfo
{
    /// <summary>
    /// Database build/version date.
    /// </summary>
    public string? BuildDate { get; init; }

    /// <summary>
    /// Type of database (e.g., "GeoLite2-City").
    /// </summary>
    public string? DatabaseType { get; init; }

    /// <summary>
    /// Number of IP records in the database.
    /// </summary>
    public long? RecordCount { get; init; }
}

/// <summary>
/// Status of the IP geolocation database.
/// </summary>
public record GeoDatabaseStatus
{
    /// <summary>
    /// Whether the database is available for lookups.
    /// </summary>
    public bool IsAvailable { get; init; }

    /// <summary>
    /// Path to the database file.
    /// </summary>
    public string? DatabasePath { get; init; }

    /// <summary>
    /// When the database file was last modified.
    /// </summary>
    public DateTime? LastUpdated { get; init; }

    /// <summary>
    /// Size of the database file in bytes.
    /// </summary>
    public long? FileSizeBytes { get; init; }

    /// <summary>
    /// ID of the currently active database source.
    /// </summary>
    public string? ActiveSourceId { get; init; }

    /// <summary>
    /// Database metadata (if available).
    /// </summary>
    public GeoDatabaseInfo? Metadata { get; init; }
}

/// <summary>
/// Request to lookup IP addresses for geolocation.
/// </summary>
public record GeoLookupRequest
{
    /// <summary>
    /// IP addresses to lookup.
    /// </summary>
    public required string[] Ips { get; init; }
}

