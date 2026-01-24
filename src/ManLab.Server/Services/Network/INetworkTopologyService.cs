namespace ManLab.Server.Services.Network;

/// <summary>
/// Builds network topology maps from discovery and scanning data.
/// </summary>
public interface INetworkTopologyService
{
    /// <summary>
    /// Builds a topology graph for the given request.
    /// </summary>
    Task<NetworkTopologyResult> BuildAsync(NetworkTopologyRequest request, CancellationToken ct = default);
}
