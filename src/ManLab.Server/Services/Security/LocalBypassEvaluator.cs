using System.Net;
using ManLab.Server.Constants;
using ManLab.Server.Services;

namespace ManLab.Server.Services.Security;

public sealed class LocalBypassEvaluator
{
    private static readonly string[] DefaultLocalCidrs =
    [
        "127.0.0.0/8",
        "::1/128",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",
        "fc00::/7",
        "fe80::/10"
    ];

    private readonly ISettingsService _settingsService;
    private readonly ILogger<LocalBypassEvaluator> _logger;

    public LocalBypassEvaluator(ISettingsService settingsService, ILogger<LocalBypassEvaluator> logger)
    {
        _settingsService = settingsService;
        _logger = logger;
    }

    public async Task<LocalBypassDecision> EvaluateAsync(HttpContext httpContext, bool ignoreAuthEnabled = false)
    {
        var authEnabled = await _settingsService.GetValueAsync(SettingKeys.Auth.Enabled, false);
        if (!ignoreAuthEnabled && !authEnabled)
        {
            return LocalBypassDecision.Allow("auth-disabled", null);
        }

        var bypassEnabled = await _settingsService.GetValueAsync(SettingKeys.Auth.LocalBypassEnabled, false);
        if (!bypassEnabled)
        {
            return LocalBypassDecision.Deny("local-bypass-disabled");
        }

        var ip = NormalizeIp(httpContext.Connection.RemoteIpAddress);
        if (ip is null)
        {
            return LocalBypassDecision.Deny("missing-client-ip");
        }

        var cidrConfig = await _settingsService.GetValueAsync(SettingKeys.Auth.LocalBypassCidrs) ?? string.Empty;
        var cidrs = ParseCidrs(cidrConfig);
        if (cidrs.Count == 0)
        {
            cidrs = ParseCidrs(string.Join(",", DefaultLocalCidrs));
        }

        foreach (var range in cidrs)
        {
            if (range.Contains(ip))
            {
                return LocalBypassDecision.Allow("local-bypass", range.OriginalCidr);
            }
        }

        return LocalBypassDecision.Deny("client-ip-not-allowed");
    }

    public async Task<bool> IsClientInLocalRangeAsync(HttpContext httpContext)
    {
        var ip = NormalizeIp(httpContext.Connection.RemoteIpAddress);
        if (ip is null)
        {
            return false;
        }

        var cidrConfig = await _settingsService.GetValueAsync(SettingKeys.Auth.LocalBypassCidrs) ?? string.Empty;
        var cidrs = ParseCidrs(cidrConfig);
        if (cidrs.Count == 0)
        {
            cidrs = ParseCidrs(string.Join(",", DefaultLocalCidrs));
        }

        return cidrs.Any(range => range.Contains(ip));
    }

    private static List<CidrRange> ParseCidrs(string input)
    {
        var list = new List<CidrRange>();
        if (string.IsNullOrWhiteSpace(input))
        {
            return list;
        }

        var parts = input.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var part in parts)
        {
            if (CidrRange.TryParse(part, out var range))
            {
                list.Add(range);
            }
        }

        return list;
    }

    private static IPAddress? NormalizeIp(IPAddress? address)
    {
        if (address is null)
        {
            return null;
        }

        return address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
    }

    public sealed record LocalBypassDecision(bool Allowed, string Reason, string? MatchedCidr)
    {
        public static LocalBypassDecision Allow(string reason, string? matchedCidr) => new(true, reason, matchedCidr);
        public static LocalBypassDecision Deny(string reason) => new(false, reason, null);
    }

    private sealed record CidrRange(IPAddress Network, int PrefixLength, string OriginalCidr)
    {
        public bool Contains(IPAddress address)
        {
            if (address.AddressFamily != Network.AddressFamily)
            {
                return false;
            }

            var networkBytes = Network.GetAddressBytes();
            var addressBytes = address.GetAddressBytes();

            var fullBytes = PrefixLength / 8;
            var remainingBits = PrefixLength % 8;

            for (var i = 0; i < fullBytes; i++)
            {
                if (networkBytes[i] != addressBytes[i])
                {
                    return false;
                }
            }

            if (remainingBits == 0)
            {
                return true;
            }

            var mask = (byte)(0xFF << (8 - remainingBits));
            return (networkBytes[fullBytes] & mask) == (addressBytes[fullBytes] & mask);
        }

        public static bool TryParse(string cidr, out CidrRange range)
        {
            range = default!;

            var parts = cidr.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (parts.Length != 2)
            {
                return false;
            }

            if (!IPAddress.TryParse(parts[0], out var network))
            {
                return false;
            }

            if (!int.TryParse(parts[1], out var prefixLength))
            {
                return false;
            }

            var maxPrefix = network.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork ? 32 : 128;
            if (prefixLength < 0 || prefixLength > maxPrefix)
            {
                return false;
            }

            range = new CidrRange(network, prefixLength, cidr);
            return true;
        }
    }
}
