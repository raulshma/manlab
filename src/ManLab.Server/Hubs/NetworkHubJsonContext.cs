using System.Text.Json.Serialization;
using ManLab.Server.Services.Network;

namespace ManLab.Server.Hubs;

/// <summary>
/// System.Text.Json source-generated context for NetworkHub DTOs and models.
/// Ensures SignalR payloads are AOT-safe and avoid anonymous types.
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(NetworkScanStartResult))]
[JsonSerializable(typeof(ScanProgressUpdate))]
[JsonSerializable(typeof(TracerouteStartedEvent))]
[JsonSerializable(typeof(TracerouteHopEvent))]
[JsonSerializable(typeof(PortScanStartedEvent))]
[JsonSerializable(typeof(PortFoundEvent))]
[JsonSerializable(typeof(DiscoveryStartedEvent))]
[JsonSerializable(typeof(MdnsDeviceFoundEvent))]
[JsonSerializable(typeof(UpnpDeviceFoundEvent))]
[JsonSerializable(typeof(WifiScanStartedEvent))]
[JsonSerializable(typeof(WifiNetworkFoundEvent))]
[JsonSerializable(typeof(HostFoundEvent))]
[JsonSerializable(typeof(ScanCompletedEvent))]
[JsonSerializable(typeof(ScanFailedEvent))]
[JsonSerializable(typeof(WolSendResult))]
[JsonSerializable(typeof(PingResult))]
[JsonSerializable(typeof(TracerouteResult))]
[JsonSerializable(typeof(TracerouteHop))]
[JsonSerializable(typeof(PortScanResult))]
[JsonSerializable(typeof(DiscoveryScanResult))]
[JsonSerializable(typeof(MdnsDiscoveredDevice))]
[JsonSerializable(typeof(UpnpDiscoveredDevice))]
[JsonSerializable(typeof(WifiScanResult))]
[JsonSerializable(typeof(WifiNetwork))]
[JsonSerializable(typeof(WifiAdapter))]
[JsonSerializable(typeof(DiscoveredHost))]
[JsonSerializable(typeof(SubnetScanResult))]
[JsonSerializable(typeof(List<DiscoveredHost>))]
[JsonSerializable(typeof(List<TracerouteHop>))]
[JsonSerializable(typeof(List<int>))]
[JsonSerializable(typeof(int[]))]
[JsonSerializable(typeof(List<string>))]
[JsonSerializable(typeof(Dictionary<string, string>))]
[JsonSerializable(typeof(System.Net.NetworkInformation.IPStatus))]
public partial class NetworkHubJsonContext : JsonSerializerContext;
