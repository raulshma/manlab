using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Windows implementation of WiFi scanner using the Native WiFi API (wlanapi.dll).
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsWifiScannerService : IWifiScannerService
{
    private readonly ILogger<WindowsWifiScannerService> _logger;

    public WindowsWifiScannerService(ILogger<WindowsWifiScannerService> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public bool IsSupported => OperatingSystem.IsWindows();

    /// <inheritdoc />
    public async Task<List<WifiAdapter>> GetAdaptersAsync(CancellationToken ct = default)
    {
        if (!OperatingSystem.IsWindows())
        {
            return [];
        }

        return await Task.Run(() =>
        {
            var adapters = new List<WifiAdapter>();
            
            try
            {
                var clientHandle = IntPtr.Zero;
                uint negotiatedVersion;
                
                var result = WlanOpenHandle(2, IntPtr.Zero, out negotiatedVersion, out clientHandle);
                if (result != 0)
                {
                    _logger.LogWarning("WlanOpenHandle failed with error code {ErrorCode}", result);
                    return adapters;
                }

                try
                {
                    IntPtr interfaceList;
                    result = WlanEnumInterfaces(clientHandle, IntPtr.Zero, out interfaceList);
                    if (result != 0)
                    {
                        _logger.LogWarning("WlanEnumInterfaces failed with error code {ErrorCode}", result);
                        return adapters;
                    }

                    try
                    {
                        var header = Marshal.PtrToStructure<WLAN_INTERFACE_INFO_LIST>(interfaceList);
                        var offset = Marshal.OffsetOf<WLAN_INTERFACE_INFO_LIST>("InterfaceInfo").ToInt32();
                        
                        for (int i = 0; i < header.dwNumberOfItems; i++)
                        {
                            var infoPtr = IntPtr.Add(interfaceList, offset + i * Marshal.SizeOf<WLAN_INTERFACE_INFO>());
                            var info = Marshal.PtrToStructure<WLAN_INTERFACE_INFO>(infoPtr);
                            
                            adapters.Add(new WifiAdapter
                            {
                                Name = info.strInterfaceDescription,
                                Id = info.InterfaceGuid.ToString(),
                                State = ((WLAN_INTERFACE_STATE)info.isState).ToString(),
                                CanScan = info.isState == (int)WLAN_INTERFACE_STATE.wlan_interface_state_connected ||
                                         info.isState == (int)WLAN_INTERFACE_STATE.wlan_interface_state_disconnected,
                                Description = info.strInterfaceDescription
                            });
                        }
                    }
                    finally
                    {
                        WlanFreeMemory(interfaceList);
                    }
                }
                finally
                {
                    WlanCloseHandle(clientHandle, IntPtr.Zero);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error enumerating WiFi adapters");
            }

            return adapters;
        }, ct);
    }

    /// <inheritdoc />
    public async Task<WifiScanResult> ScanAsync(string? adapterName = null, CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        
        if (!OperatingSystem.IsWindows())
        {
            return new WifiScanResult
            {
                StartedAt = startedAt,
                CompletedAt = DateTime.UtcNow,
                Success = false,
                ErrorMessage = "WiFi scanning is only supported on Windows",
                Platform = "Windows"
            };
        }

        return await Task.Run(() =>
        {
            var networks = new List<WifiNetwork>();
            WifiAdapter? usedAdapter = null;
            string? errorMessage = null;

            try
            {
                var clientHandle = IntPtr.Zero;
                uint negotiatedVersion;

                var result = WlanOpenHandle(2, IntPtr.Zero, out negotiatedVersion, out clientHandle);
                if (result != 0)
                {
                    return new WifiScanResult
                    {
                        StartedAt = startedAt,
                        CompletedAt = DateTime.UtcNow,
                        Success = false,
                        ErrorMessage = $"Failed to open WLAN handle: error {result}",
                        Platform = "Windows"
                    };
                }

                try
                {
                    IntPtr interfaceList;
                    result = WlanEnumInterfaces(clientHandle, IntPtr.Zero, out interfaceList);
                    if (result != 0)
                    {
                        return new WifiScanResult
                        {
                            StartedAt = startedAt,
                            CompletedAt = DateTime.UtcNow,
                            Success = false,
                            ErrorMessage = $"Failed to enumerate WLAN interfaces: error {result}",
                            Platform = "Windows"
                        };
                    }

                    try
                    {
                        var header = Marshal.PtrToStructure<WLAN_INTERFACE_INFO_LIST>(interfaceList);
                        
                        if (header.dwNumberOfItems == 0)
                        {
                            return new WifiScanResult
                            {
                                StartedAt = startedAt,
                                CompletedAt = DateTime.UtcNow,
                                Success = false,
                                ErrorMessage = "No WiFi adapters found",
                                Platform = "Windows"
                            };
                        }

                        // Use first adapter or find by name
                        var offset = Marshal.OffsetOf<WLAN_INTERFACE_INFO_LIST>("InterfaceInfo").ToInt32();
                        WLAN_INTERFACE_INFO selectedInterface = default;
                        bool found = false;

                        for (int i = 0; i < header.dwNumberOfItems; i++)
                        {
                            var infoPtr = IntPtr.Add(interfaceList, offset + i * Marshal.SizeOf<WLAN_INTERFACE_INFO>());
                            var info = Marshal.PtrToStructure<WLAN_INTERFACE_INFO>(infoPtr);

                            if (string.IsNullOrEmpty(adapterName) || 
                                info.strInterfaceDescription.Contains(adapterName, StringComparison.OrdinalIgnoreCase))
                            {
                                selectedInterface = info;
                                found = true;
                                usedAdapter = new WifiAdapter
                                {
                                    Name = info.strInterfaceDescription,
                                    Id = info.InterfaceGuid.ToString(),
                                    State = ((WLAN_INTERFACE_STATE)info.isState).ToString(),
                                    CanScan = true,
                                    Description = info.strInterfaceDescription
                                };
                                break;
                            }
                        }

                        if (!found)
                        {
                            return new WifiScanResult
                            {
                                StartedAt = startedAt,
                                CompletedAt = DateTime.UtcNow,
                                Success = false,
                                ErrorMessage = adapterName != null 
                                    ? $"WiFi adapter '{adapterName}' not found"
                                    : "No suitable WiFi adapter found",
                                Platform = "Windows"
                            };
                        }

                        // Trigger a scan (optional, may require elevated privileges)
                        WlanScan(clientHandle, ref selectedInterface.InterfaceGuid, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                        
                        // Give some time for scan to complete
                        Thread.Sleep(1000);

                        // Get available networks
                        IntPtr networkList;
                        result = WlanGetAvailableNetworkList(
                            clientHandle,
                            ref selectedInterface.InterfaceGuid,
                            0x00000002, // WLAN_AVAILABLE_NETWORK_INCLUDE_ALL_ADHOC_PROFILES
                            IntPtr.Zero,
                            out networkList);

                        if (result != 0)
                        {
                            _logger.LogWarning("WlanGetAvailableNetworkList failed with error {ErrorCode}", result);
                        }
                        else
                        {
                            try
                            {
                                var networkHeader = Marshal.PtrToStructure<WLAN_AVAILABLE_NETWORK_LIST>(networkList);
                                var networkOffset = Marshal.OffsetOf<WLAN_AVAILABLE_NETWORK_LIST>("Network").ToInt32();

                                for (int i = 0; i < networkHeader.dwNumberOfItems; i++)
                                {
                                    var netPtr = IntPtr.Add(networkList, networkOffset + i * Marshal.SizeOf<WLAN_AVAILABLE_NETWORK>());
                                    var net = Marshal.PtrToStructure<WLAN_AVAILABLE_NETWORK>(netPtr);

                                    var ssid = Encoding.ASCII.GetString(net.dot11Ssid.ucSSID, 0, (int)net.dot11Ssid.uSSIDLength);
                                    if (string.IsNullOrWhiteSpace(ssid))
                                    {
                                        ssid = "[Hidden Network]";
                                    }

                                    var security = new List<string>();
                                    if (net.bSecurityEnabled)
                                    {
                                        security.Add(GetAuthAlgorithmName(net.dot11DefaultAuthAlgorithm));
                                        security.Add(GetCipherAlgorithmName(net.dot11DefaultCipherAlgorithm));
                                    }
                                    else
                                    {
                                        security.Add("Open");
                                    }

                                    networks.Add(new WifiNetwork
                                    {
                                        Ssid = ssid,
                                        SignalQualityPercent = (int)net.wlanSignalQuality,
                                        SignalStrengthDbm = WifiHelpers.PercentToDbm((int)net.wlanSignalQuality),
                                        Security = security,
                                        IsSecured = net.bSecurityEnabled,
                                        NetworkType = GetBssTypeName(net.dot11BssType),
                                        IsConnected = (net.dwFlags & 0x00000001) != 0, // WLAN_AVAILABLE_NETWORK_CONNECTED
                                        DiscoveredAt = DateTime.UtcNow
                                    });
                                }
                            }
                            finally
                            {
                                WlanFreeMemory(networkList);
                            }
                        }

                        // Get BSS list for more details (BSSID, channel, frequency)
                        IntPtr bssList;
                        result = WlanGetNetworkBssList(
                            clientHandle,
                            ref selectedInterface.InterfaceGuid,
                            IntPtr.Zero,
                            DOT11_BSS_TYPE.dot11_BSS_type_any,
                            false,
                            IntPtr.Zero,
                            out bssList);

                        if (result == 0 && bssList != IntPtr.Zero)
                        {
                            try
                            {
                                var bssHeader = Marshal.PtrToStructure<WLAN_BSS_LIST>(bssList);
                                var bssOffset = Marshal.OffsetOf<WLAN_BSS_LIST>("wlanBssEntries").ToInt32();

                                for (int i = 0; i < bssHeader.dwNumberOfItems; i++)
                                {
                                    var bssPtr = IntPtr.Add(bssList, bssOffset + i * Marshal.SizeOf<WLAN_BSS_ENTRY>());
                                    var bss = Marshal.PtrToStructure<WLAN_BSS_ENTRY>(bssPtr);

                                    var ssid = Encoding.ASCII.GetString(bss.dot11Ssid.ucSSID, 0, (int)bss.dot11Ssid.uSSIDLength);
                                    var bssid = FormatMacAddress(bss.dot11Bssid);
                                    var frequency = (int)(bss.ulChCenterFrequency / 1000); // Convert kHz to MHz
                                    var channel = WifiHelpers.FrequencyToChannel(frequency);

                                    // Update existing network or add new
                                    var existing = networks.FirstOrDefault(n => n.Ssid == ssid);
                                    if (existing != null)
                                    {
                                        var index = networks.IndexOf(existing);
                                        networks[index] = existing with
                                        {
                                            Bssid = bssid,
                                            FrequencyMhz = frequency,
                                            Channel = channel,
                                            Band = WifiHelpers.GetBand(frequency),
                                            SignalStrengthDbm = bss.lRssi
                                        };
                                    }
                                    else if (!string.IsNullOrWhiteSpace(ssid))
                                    {
                                        networks.Add(new WifiNetwork
                                        {
                                            Ssid = ssid,
                                            Bssid = bssid,
                                            FrequencyMhz = frequency,
                                            Channel = channel,
                                            Band = WifiHelpers.GetBand(frequency),
                                            SignalStrengthDbm = bss.lRssi,
                                            SignalQualityPercent = WifiHelpers.DbmToPercent(bss.lRssi),
                                            DiscoveredAt = DateTime.UtcNow
                                        });
                                    }
                                }
                            }
                            finally
                            {
                                WlanFreeMemory(bssList);
                            }
                        }
                    }
                    finally
                    {
                        WlanFreeMemory(interfaceList);
                    }
                }
                finally
                {
                    WlanCloseHandle(clientHandle, IntPtr.Zero);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during WiFi scan");
                errorMessage = ex.Message;
            }

            // Remove duplicates (keep highest signal)
            var uniqueNetworks = networks
                .GroupBy(n => n.Ssid)
                .Select(g => g.OrderByDescending(n => n.SignalStrengthDbm ?? -100).First())
                .OrderByDescending(n => n.SignalQualityPercent ?? 0)
                .ToList();

            return new WifiScanResult
            {
                Adapter = usedAdapter,
                Networks = uniqueNetworks,
                StartedAt = startedAt,
                CompletedAt = DateTime.UtcNow,
                Success = errorMessage == null,
                ErrorMessage = errorMessage,
                Platform = "Windows"
            };
        }, ct);
    }

    #region Native API Declarations

    [DllImport("wlanapi.dll", SetLastError = true)]
    private static extern uint WlanOpenHandle(
        uint dwClientVersion,
        IntPtr pReserved,
        out uint pdwNegotiatedVersion,
        out IntPtr phClientHandle);

    [DllImport("wlanapi.dll", SetLastError = true)]
    private static extern uint WlanCloseHandle(IntPtr hClientHandle, IntPtr pReserved);

    [DllImport("wlanapi.dll", SetLastError = true)]
    private static extern uint WlanEnumInterfaces(
        IntPtr hClientHandle,
        IntPtr pReserved,
        out IntPtr ppInterfaceList);

    [DllImport("wlanapi.dll", SetLastError = true)]
    private static extern uint WlanGetAvailableNetworkList(
        IntPtr hClientHandle,
        ref Guid pInterfaceGuid,
        uint dwFlags,
        IntPtr pReserved,
        out IntPtr ppAvailableNetworkList);

    [DllImport("wlanapi.dll", SetLastError = true)]
    private static extern uint WlanGetNetworkBssList(
        IntPtr hClientHandle,
        ref Guid pInterfaceGuid,
        IntPtr pDot11Ssid,
        DOT11_BSS_TYPE dot11BssType,
        bool bSecurityEnabled,
        IntPtr pReserved,
        out IntPtr ppWlanBssList);

    [DllImport("wlanapi.dll", SetLastError = true)]
    private static extern uint WlanScan(
        IntPtr hClientHandle,
        ref Guid pInterfaceGuid,
        IntPtr pDot11Ssid,
        IntPtr pIeData,
        IntPtr pReserved);

    [DllImport("wlanapi.dll", SetLastError = true)]
    private static extern void WlanFreeMemory(IntPtr pMemory);

    #endregion

    #region Native Structures

    [StructLayout(LayoutKind.Sequential)]
    private struct WLAN_INTERFACE_INFO_LIST
    {
        public uint dwNumberOfItems;
        public uint dwIndex;
        public WLAN_INTERFACE_INFO InterfaceInfo;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WLAN_INTERFACE_INFO
    {
        public Guid InterfaceGuid;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string strInterfaceDescription;
        public int isState;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WLAN_AVAILABLE_NETWORK_LIST
    {
        public uint dwNumberOfItems;
        public uint dwIndex;
        public WLAN_AVAILABLE_NETWORK Network;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WLAN_AVAILABLE_NETWORK
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string strProfileName;
        public DOT11_SSID dot11Ssid;
        public int dot11BssType;
        public uint uNumberOfBssids;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bNetworkConnectable;
        public uint wlanNotConnectableReason;
        public uint uNumberOfPhyTypes;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)]
        public int[] dot11PhyTypes;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bMorePhyTypes;
        public uint wlanSignalQuality;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bSecurityEnabled;
        public int dot11DefaultAuthAlgorithm;
        public int dot11DefaultCipherAlgorithm;
        public uint dwFlags;
        public uint dwReserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DOT11_SSID
    {
        public uint uSSIDLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public byte[] ucSSID;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WLAN_BSS_LIST
    {
        public uint dwTotalSize;
        public uint dwNumberOfItems;
        public WLAN_BSS_ENTRY wlanBssEntries;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WLAN_BSS_ENTRY
    {
        public DOT11_SSID dot11Ssid;
        public uint uPhyId;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)]
        public byte[] dot11Bssid;
        public int dot11BssType;
        public int dot11BssPhyType;
        public int lRssi;
        public uint uLinkQuality;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bInRegDomain;
        public ushort usBeaconPeriod;
        public ulong ullTimestamp;
        public ulong ullHostTimestamp;
        public ushort usCapabilityInformation;
        public uint ulChCenterFrequency;
        public WLAN_RATE_SET wlanRateSet;
        public uint ulIeOffset;
        public uint ulIeSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WLAN_RATE_SET
    {
        public uint uRateSetLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 126)]
        public ushort[] usRateSet;
    }

    private enum WLAN_INTERFACE_STATE
    {
        wlan_interface_state_not_ready = 0,
        wlan_interface_state_connected = 1,
        wlan_interface_state_ad_hoc_network_formed = 2,
        wlan_interface_state_disconnecting = 3,
        wlan_interface_state_disconnected = 4,
        wlan_interface_state_associating = 5,
        wlan_interface_state_discovering = 6,
        wlan_interface_state_authenticating = 7
    }

    private enum DOT11_BSS_TYPE
    {
        dot11_BSS_type_infrastructure = 1,
        dot11_BSS_type_independent = 2,
        dot11_BSS_type_any = 3
    }

    #endregion

    #region Helper Methods

    private static string FormatMacAddress(byte[] mac)
    {
        return string.Join(":", mac.Select(b => b.ToString("X2")));
    }

    private static string GetAuthAlgorithmName(int algorithm)
    {
        return algorithm switch
        {
            1 => "Open",
            2 => "Shared Key",
            3 => "WPA",
            4 => "WPA-PSK",
            5 => "WPA-None",
            6 => "RSNA",
            7 => "RSNA-PSK",
            8 => "WPA3",
            9 => "WPA3-ENT-192",
            10 => "OWE",
            _ => $"Auth-{algorithm}"
        };
    }

    private static string GetCipherAlgorithmName(int algorithm)
    {
        return algorithm switch
        {
            0 => "None",
            1 => "WEP40",
            2 => "TKIP",
            4 => "CCMP",
            5 => "WEP104",
            6 => "WPA-Group",
            0x100 => "WEP",
            _ => $"Cipher-{algorithm}"
        };
    }

    private static string GetBssTypeName(int bssType)
    {
        return bssType switch
        {
            1 => "Infrastructure",
            2 => "Ad-hoc",
            _ => "Unknown"
        };
    }

    #endregion
}
