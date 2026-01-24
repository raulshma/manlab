using System.Net;

namespace ManLab.Server.Services.Network;

public sealed class NetworkTopologyService : INetworkTopologyService
{
    private readonly INetworkScannerService _scanner;
    private readonly IDeviceDiscoveryService _discovery;
    private readonly ILogger<NetworkTopologyService> _logger;

    public NetworkTopologyService(
        INetworkScannerService scanner,
        IDeviceDiscoveryService discovery,
        ILogger<NetworkTopologyService> logger)
    {
        _scanner = scanner;
        _discovery = discovery;
        _logger = logger;
    }

    public async Task<NetworkTopologyResult> BuildAsync(NetworkTopologyRequest request, CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;

        var concurrency = Math.Clamp(request.ConcurrencyLimit ?? 100, 10, 300);
        var timeout = Math.Clamp(request.Timeout ?? 750, 100, 5000);
        var includeDiscovery = request.IncludeDiscovery ?? true;
        var discoveryDuration = Math.Clamp(request.DiscoveryDurationSeconds ?? 6, 1, 30);

        var hosts = new List<DiscoveredHost>();
        await foreach (var host in _scanner.ScanSubnetAsync(request.Cidr, concurrency, timeout, ct))
        {
            hosts.Add(host);
        }

        DiscoveryScanResult? discovery = null;
        if (includeDiscovery)
        {
            try
            {
                discovery = await _discovery.DiscoverAllAsync(discoveryDuration, ct: ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Topology discovery failed; continuing with subnet scan results only.");
            }
        }

        var (nodes, links, summary) = BuildTopologyGraph(hosts, discovery);

        return new NetworkTopologyResult
        {
            Cidr = request.Cidr,
            Nodes = nodes,
            Links = links,
            StartedAt = startedAt,
            CompletedAt = DateTime.UtcNow,
            Summary = summary
        };
    }

    private static (List<NetworkTopologyNode> nodes, List<NetworkTopologyLink> links, NetworkTopologySummary summary)
        BuildTopologyGraph(List<DiscoveredHost> hosts, DiscoveryScanResult? discovery)
    {
        var nodes = new List<NetworkTopologyNode>();
        var links = new List<NetworkTopologyLink>();
        var nodeIndex = new Dictionary<string, NetworkTopologyNode>(StringComparer.OrdinalIgnoreCase);

        var rootId = "network:local";
        nodes.Add(new NetworkTopologyNode
        {
            Id = rootId,
            Kind = "root",
            Label = "Local Network",
            Source = "system"
        });
        nodeIndex[rootId] = nodes[0];

        var subnetMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var hostMap = new Dictionary<string, NetworkTopologyNode>(StringComparer.OrdinalIgnoreCase);

        foreach (var host in hosts)
        {
            if (string.IsNullOrWhiteSpace(host.IpAddress))
            {
                continue;
            }

            var subnet = GetSubnetKey(host.IpAddress);
            var subnetId = EnsureSubnetNode(subnet, rootId, nodes, links, subnetMap);

            var hostNode = new NetworkTopologyNode
            {
                Id = host.IpAddress,
                Kind = "host",
                Label = host.Hostname ?? host.IpAddress,
                IpAddress = host.IpAddress,
                Hostname = host.Hostname,
                MacAddress = host.MacAddress,
                Vendor = host.Vendor,
                DeviceType = host.DeviceType,
                Subnet = subnet,
                Source = "scan"
            };

            if (!nodeIndex.ContainsKey(hostNode.Id))
            {
                nodes.Add(hostNode);
                nodeIndex[hostNode.Id] = hostNode;
                links.Add(new NetworkTopologyLink
                {
                    Source = subnetId,
                    Target = hostNode.Id,
                    Kind = "contains"
                });
            }

            hostMap[host.IpAddress] = nodeIndex[hostNode.Id];
        }

        var mdnsCount = 0;
        var upnpCount = 0;
        var discoveryOnlyHosts = 0;

        if (discovery is not null)
        {
            foreach (var mdns in discovery.MdnsDevices)
            {
                var ip = mdns.IpAddresses.FirstOrDefault(IsValidIpv4);
                if (string.IsNullOrWhiteSpace(ip))
                {
                    continue;
                }

                if (!hostMap.TryGetValue(ip, out var hostNode))
                {
                    hostNode = CreateDiscoveryHost(ip, mdns.Hostname, nodes, links, subnetMap, rootId, nodeIndex);
                    hostMap[ip] = hostNode;
                    discoveryOnlyHosts++;
                }

                var serviceId = $"mdns:{ip}:{mdns.ServiceType}:{mdns.Port}";
                if (!nodeIndex.ContainsKey(serviceId))
                {
                    nodes.Add(new NetworkTopologyNode
                    {
                        Id = serviceId,
                        Kind = "mdns",
                        Label = mdns.Name,
                        IpAddress = ip,
                        Hostname = mdns.Hostname,
                        Subnet = hostNode.Subnet,
                        Source = "mdns",
                        ServiceType = mdns.ServiceType,
                        Port = mdns.Port
                    });
                    nodeIndex[serviceId] = nodes[^1];
                    links.Add(new NetworkTopologyLink
                    {
                        Source = hostNode.Id,
                        Target = serviceId,
                        Kind = "service"
                    });
                }

                mdnsCount++;
            }

            foreach (var upnp in discovery.UpnpDevices)
            {
                var ip = ExtractIpFromUpnp(upnp) ?? upnp.IpAddress;
                if (string.IsNullOrWhiteSpace(ip) || !IsValidIpv4(ip))
                {
                    continue;
                }

                if (!hostMap.TryGetValue(ip, out var hostNode))
                {
                    hostNode = CreateDiscoveryHost(ip, upnp.FriendlyName, nodes, links, subnetMap, rootId, nodeIndex);
                    hostMap[ip] = hostNode;
                    discoveryOnlyHosts++;
                }

                var deviceId = $"upnp:{upnp.Usn}";
                if (!nodeIndex.ContainsKey(deviceId))
                {
                    nodes.Add(new NetworkTopologyNode
                    {
                        Id = deviceId,
                        Kind = "upnp",
                        Label = upnp.FriendlyName ?? upnp.ModelName ?? upnp.Usn,
                        IpAddress = ip,
                        Subnet = hostNode.Subnet,
                        Source = "upnp",
                        ServiceType = upnp.NotificationType
                    });
                    nodeIndex[deviceId] = nodes[^1];
                    links.Add(new NetworkTopologyLink
                    {
                        Source = hostNode.Id,
                        Target = deviceId,
                        Kind = "service"
                    });
                }

                upnpCount++;
            }
        }

        var subnets = subnetMap.Count;
        var hostCount = hostMap.Count;

        var summary = new NetworkTopologySummary
        {
            SubnetCount = subnets,
            HostCount = hostCount,
            DiscoveryOnlyHosts = discoveryOnlyHosts,
            MdnsServices = mdnsCount,
            UpnpDevices = upnpCount,
            TotalNodes = nodes.Count,
            TotalLinks = links.Count
        };

        return (nodes, links, summary);
    }

    private static string EnsureSubnetNode(
        string subnet,
        string rootId,
        List<NetworkTopologyNode> nodes,
        List<NetworkTopologyLink> links,
        Dictionary<string, string> subnetMap)
    {
        if (subnetMap.TryGetValue(subnet, out var existingId))
        {
            return existingId;
        }

        var subnetId = $"subnet:{subnet}";
        subnetMap[subnet] = subnetId;
        nodes.Add(new NetworkTopologyNode
        {
            Id = subnetId,
            Kind = "subnet",
            Label = subnet,
            Subnet = subnet,
            Source = "scan"
        });
        links.Add(new NetworkTopologyLink
        {
            Source = rootId,
            Target = subnetId,
            Kind = "contains"
        });
        return subnetId;
    }

    private static NetworkTopologyNode CreateDiscoveryHost(
        string ip,
        string? label,
        List<NetworkTopologyNode> nodes,
        List<NetworkTopologyLink> links,
        Dictionary<string, string> subnetMap,
        string rootId,
        Dictionary<string, NetworkTopologyNode> nodeIndex)
    {
        var subnet = GetSubnetKey(ip);
        var subnetId = EnsureSubnetNode(subnet, rootId, nodes, links, subnetMap);
        var hostNode = new NetworkTopologyNode
        {
            Id = ip,
            Kind = "host",
            Label = label ?? ip,
            IpAddress = ip,
            Hostname = label,
            Subnet = subnet,
            Source = "discovery"
        };

        if (!nodeIndex.ContainsKey(hostNode.Id))
        {
            nodes.Add(hostNode);
            nodeIndex[hostNode.Id] = hostNode;
            links.Add(new NetworkTopologyLink
            {
                Source = subnetId,
                Target = hostNode.Id,
                Kind = "contains"
            });
        }

        return nodeIndex[hostNode.Id];
    }

    private static string GetSubnetKey(string ip)
    {
        var parts = ip.Split('.');
        return parts.Length >= 3 ? $"{parts[0]}.{parts[1]}.{parts[2]}.0/24" : ip;
    }

    private static bool IsValidIpv4(string ip)
    {
        return IPAddress.TryParse(ip, out var parsed) && parsed.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork;
    }

    private static string? ExtractIpFromUpnp(UpnpDiscoveredDevice device)
    {
        var location = device.DescriptionLocation;
        if (string.IsNullOrWhiteSpace(location))
        {
            return null;
        }

        if (Uri.TryCreate(location, UriKind.Absolute, out var uri))
        {
            return uri.Host;
        }

        return null;
    }
}
