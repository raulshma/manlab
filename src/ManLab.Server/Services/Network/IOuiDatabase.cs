namespace ManLab.Server.Services.Network;

/// <summary>
/// Interface for OUI (Organizationally Unique Identifier) database lookups.
/// </summary>
public interface IOuiDatabase
{
    /// <summary>
    /// Looks up the vendor name for a MAC address.
    /// </summary>
    /// <param name="macAddress">MAC address in any common format (XX:XX:XX:XX:XX:XX, XX-XX-XX-XX-XX-XX, etc.).</param>
    /// <returns>Vendor name or null if not found.</returns>
    string? LookupVendor(string macAddress);
    
    /// <summary>
    /// Gets the total number of vendors in the database.
    /// </summary>
    int VendorCount { get; }
}
