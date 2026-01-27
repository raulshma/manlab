namespace ManLab.Server.Services.Network;

/// <summary>
/// Service interface for IP geolocation lookups using MMDB databases.
/// </summary>
public interface IIpGeolocationService
{
    /// <summary>
    /// Gets the list of available database sources.
    /// </summary>
    /// <returns>List of available database sources.</returns>
    IReadOnlyList<GeoDatabaseSource> GetAvailableSources();

    /// <summary>
    /// Gets the current status of the geolocation database.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The database status.</returns>
    Task<GeoDatabaseStatus> GetStatusAsync(CancellationToken ct = default);

    /// <summary>
    /// Downloads the geolocation database from the default source.
    /// </summary>
    /// <param name="progress">Optional progress reporter (0-100).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>True if download was successful.</returns>
    Task<bool> DownloadDatabaseAsync(IProgress<int>? progress = null, CancellationToken ct = default);

    /// <summary>
    /// Downloads the geolocation database from a specific source.
    /// </summary>
    /// <param name="sourceId">The source ID to download from.</param>
    /// <param name="progress">Optional progress reporter (0-100).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>True if download was successful.</returns>
    Task<bool> DownloadDatabaseAsync(string sourceId, IProgress<int>? progress = null, CancellationToken ct = default);

    /// <summary>
    /// Updates the geolocation database to the latest version.
    /// </summary>
    /// <param name="progress">Optional progress reporter (0-100).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>True if update was successful.</returns>
    Task<bool> UpdateDatabaseAsync(IProgress<int>? progress = null, CancellationToken ct = default);

    /// <summary>
    /// Deletes the installed geolocation database.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>True if deletion was successful.</returns>
    Task<bool> DeleteDatabaseAsync(CancellationToken ct = default);

    /// <summary>
    /// Looks up the geolocation for a single IP address.
    /// </summary>
    /// <param name="ipAddress">The IP address to lookup.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The geolocation result, or null if not found.</returns>
    Task<GeoLocationResult?> LookupAsync(string ipAddress, CancellationToken ct = default);

    /// <summary>
    /// Looks up geolocations for multiple IP addresses in batch.
    /// </summary>
    /// <param name="ipAddresses">The IP addresses to lookup.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>List of geolocation results.</returns>
    Task<IReadOnlyList<GeoLocationResult>> LookupBatchAsync(IEnumerable<string> ipAddresses, CancellationToken ct = default);
}

