/**
 * WifiScannerTool Component
 * Scan for nearby WiFi networks and display signal/security details.
 * Features:
 * - Check support status on mount
 * - Adapter dropdown
 * - Scan button
 * - Network cards sorted by signal strength
 * - Filters: band and security
 * - Connected network indicator
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Wifi,
  Loader2,
  RefreshCw,
  Signal,
  Filter,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/network-notify";
import {
  checkWifiSupport,
  getWifiAdapters,
  scanWifi as scanWifiApi,
  type WifiAdapter,
  type WifiNetwork,
  type WifiSupportResponse,
} from "@/api/networkApi";
import {
  announce,
  announceScanEvent,
  handleArrowNavigation,
} from "@/lib/accessibility";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { WifiNetworkCard } from "@/components/network/WifiNetworkCard";
import {
  normalizeBand,
  isOpenNetwork,
} from "@/components/network/network-utils";

// ============================================================================
// Normalization Helpers
// ============================================================================

type RawWifiNetwork = Partial<WifiNetwork> & {
  signalQualityPercent?: number | null;
  frequencyMhz?: number | null;
  security?: string[] | null;
  isSecured?: boolean | null;
};

type RawWifiScanResult = {
  networks?: RawWifiNetwork[];
  scanDurationMs?: number;
  durationMs?: number;
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

const getNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const computeSignalStrength = (network: RawWifiNetwork): number => {
  if (typeof network.signalStrength === "number" && Number.isFinite(network.signalStrength)) {
    return clampPercent(network.signalStrength);
  }

  if (typeof network.signalQualityPercent === "number" && Number.isFinite(network.signalQualityPercent)) {
    return clampPercent(network.signalQualityPercent);
  }

  if (typeof network.signalStrengthDbm === "number" && Number.isFinite(network.signalStrengthDbm)) {
    const dbm = network.signalStrengthDbm;
    if (dbm >= -50) return 100;
    if (dbm <= -100) return 0;
    return clampPercent(2 * (dbm + 100));
  }

  return 0;
};

const normalizeSecurityType = (network: RawWifiNetwork): string => {
  const direct = typeof network.securityType === "string" ? network.securityType.trim() : "";
  if (direct) return direct;

  const fromList = Array.isArray(network.security)
    ? network.security.filter(Boolean).join(" / ")
    : "";
  if (fromList) return fromList;

  if (network.isSecured === false) return "Open";
  if (network.isSecured === true) return "Secured";

  return "";
};

const normalizeWifiNetwork = (network: RawWifiNetwork): WifiNetwork => {
  const ssidRaw = typeof network.ssid === "string" ? network.ssid.trim() : "";
  const isHidden =
    network.isHidden ??
    (ssidRaw.length === 0 ||
      ssidRaw === "[Hidden Network]" ||
      ssidRaw.toLowerCase().includes("hidden"));

  const signalStrength = computeSignalStrength(network);
  const signalStrengthDbm =
    typeof network.signalStrengthDbm === "number" && Number.isFinite(network.signalStrengthDbm)
      ? Math.round(network.signalStrengthDbm)
      : typeof network.signalQualityPercent === "number" && Number.isFinite(network.signalQualityPercent)
        ? Math.round(network.signalQualityPercent / 2 - 100)
        : null;

  return {
    ssid: ssidRaw || "Hidden Network",
    bssid: typeof network.bssid === "string" && network.bssid.trim().length > 0 ? network.bssid : "—",
    signalStrength,
    signalStrengthDbm,
    channel: getNumber(network.channel, 0),
    frequency: getNumber(network.frequency ?? network.frequencyMhz, 0),
    band: typeof network.band === "string" && network.band.trim().length > 0 ? network.band : "Unknown",
    securityType: normalizeSecurityType(network),
    isConnected: Boolean(network.isConnected),
    isHidden,
  };
};

// ============================================================================
// Types
// ============================================================================

type BandFilter = "all" | "2.4" | "5" | "6";
type SecurityFilter = "all" | "secured" | "open";

const WIFI_ADAPTER_KEY = "manlab:network:wifi-adapter";
const WIFI_BAND_FILTER_KEY = "manlab:network:wifi-band";
const WIFI_SECURITY_FILTER_KEY = "manlab:network:wifi-security";

// ============================================================================
// Main Component
// ============================================================================

export function WifiScannerTool() {
  const getStoredString = (key: string, fallback: string) => {
    if (typeof window === "undefined") return fallback;
    return localStorage.getItem(key) ?? fallback;
  };

  const [support, setSupport] = useState<WifiSupportResponse | null>(null);
  const [adapters, setAdapters] = useState<WifiAdapter[]>([]);
  const [selectedAdapter, setSelectedAdapter] = useState<string | undefined>(
    getStoredString(WIFI_ADAPTER_KEY, "") || undefined
  );
  const [bandFilter, setBandFilter] = useState<BandFilter>(
    () => (getStoredString(WIFI_BAND_FILTER_KEY, "all") as BandFilter)
  );
  const [securityFilter, setSecurityFilter] = useState<SecurityFilter>(
    () => (getStoredString(WIFI_SECURITY_FILTER_KEY, "all") as SecurityFilter)
  );
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [liveNetworks, setLiveNetworks] = useState<WifiNetwork[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const {
    isConnected,
    scanWifi: hubScanWifi,
    subscribeToWifiScan,
  } = useNetworkHub();

  // Load support + adapters
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    const load = async () => {
      try {
        const supportResult = await checkWifiSupport({ signal: controller.signal });
        setSupport(supportResult);
        if (!supportResult.isSupported) return;

        const adapterList = await getWifiAdapters({ signal: controller.signal });
        setAdapters(adapterList);
        if (adapterList.length > 0) {
          const storedAdapter = getStoredString(WIFI_ADAPTER_KEY, "");
          const match = adapterList.find((adapter) => adapter.name === storedAdapter);
          setSelectedAdapter(match?.name ?? adapterList[0].name);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Failed to load WiFi status";
        notify.error(message);
      }
    };

    load();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedAdapter) {
      localStorage.setItem(WIFI_ADAPTER_KEY, selectedAdapter);
    }
    localStorage.setItem(WIFI_BAND_FILTER_KEY, bandFilter);
    localStorage.setItem(WIFI_SECURITY_FILTER_KEY, securityFilter);
  }, [selectedAdapter, bandFilter, securityFilter]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Subscribe to live events
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribeToWifiScan({
      onWifiScanStarted: () => {
        setIsScanning(true);
        setLiveNetworks([]);
        announceScanEvent("started", "WiFi scan");
      },
      onWifiNetworkFound: (event) => {
        const payload = event as { network?: RawWifiNetwork };
        if (!payload?.network) return;
        const network = payload.network;
        setLiveNetworks((prev) => [...prev, normalizeWifiNetwork(network)]);
      },
      onWifiScanCompleted: (event) => {
        setIsScanning(false);
        const payload = event as unknown as { result?: RawWifiScanResult } | RawWifiScanResult | undefined;
        const rawResult = payload && "result" in payload ? payload.result ?? payload : payload;
        if (!rawResult) {
          notify.error("WiFi scan completed without results.");
          announceScanEvent("completed", "WiFi scan", "No results received");
          return;
        }
        const result = rawResult as RawWifiScanResult;
        const networks = Array.isArray(result.networks) ? result.networks.map(normalizeWifiNetwork) : [];
        setNetworks(networks);
        setLiveNetworks([]);
        const durationMs = result.scanDurationMs ?? result.durationMs ?? 0;
        notify.success(
          `Found ${networks.length} networks in ${(durationMs / 1000).toFixed(1)}s`
        );
        announceScanEvent(
          "completed",
          "WiFi scan",
          `Found ${networks.length} networks`
        );
      },
    });

    return unsubscribe;
  }, [isConnected, subscribeToWifiScan]);

  const handleScan = useCallback(async () => {
    if (support && !support.isSupported) {
      notify.error(support.reason || "WiFi scanning is not supported");
      return;
    }

    setIsScanning(true);
    setLiveNetworks([]);
    setNetworks([]);
    setRateLimitMessage(null);
    announce("Starting WiFi scan", "polite");

    try {
      if (isConnected) {
        const result = await hubScanWifi(selectedAdapter);
        const networks = Array.isArray(result?.networks)
          ? result.networks.map(normalizeWifiNetwork)
          : [];
        setNetworks(networks);
        const durationMs =
          (result as RawWifiScanResult | undefined)?.scanDurationMs ??
          (result as RawWifiScanResult | undefined)?.durationMs ??
          0;
        notify.success(
          `Found ${networks.length} networks in ${(durationMs / 1000).toFixed(1)}s`
        );
        announceScanEvent(
          "completed",
          "WiFi scan",
          `Found ${networks.length} networks`
        );
      } else {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const result = await scanWifiApi(
          { adapterName: selectedAdapter },
          { signal: controller.signal }
        );
        const networks = Array.isArray(result?.networks)
          ? result.networks.map(normalizeWifiNetwork)
          : [];
        setNetworks(networks);
        const durationMs =
          (result as RawWifiScanResult | undefined)?.scanDurationMs ??
          (result as RawWifiScanResult | undefined)?.durationMs ??
          0;
        notify.success(
          `Found ${networks.length} networks in ${(durationMs / 1000).toFixed(1)}s`
        );
        announceScanEvent(
          "completed",
          "WiFi scan",
          `Found ${networks.length} networks`
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const message =
        error instanceof Error ? error.message : "WiFi scan failed";
      if (message.toLowerCase().includes("rate") || message.includes("429")) {
        setRateLimitMessage("Rate limit reached. Please wait before retrying.");
      }
      notify.error(message);
      announceScanEvent("failed", "WiFi scan", message);
    } finally {
      setIsScanning(false);
    }
  }, [support, isConnected, hubScanWifi, selectedAdapter]);

  const displayedNetworks = useMemo(() => {
    const source = isScanning && liveNetworks.length > 0 ? liveNetworks : networks;

    return source
      .filter((network) => {
        if (bandFilter === "all") return true;
        return normalizeBand(network.band) === bandFilter;
      })
      .filter((network) => {
        if (securityFilter === "all") return true;
        const open = isOpenNetwork(network.securityType);
        return securityFilter === "open" ? open : !open;
      })
      .sort((a, b) => b.signalStrength - a.signalStrength);
  }, [networks, liveNetworks, bandFilter, securityFilter, isScanning]);

  // Keyboard navigation for network list
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (displayedNetworks.length === 0) return;
      handleArrowNavigation(e, focusedIndex, displayedNetworks.length, setFocusedIndex, 3);
    },
    [focusedIndex, displayedNetworks.length]
  );

  return (
    <div className="space-y-6">
      <Card role="region" aria-label="WiFi Scanner configuration">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2" id="wifi-scanner-title">
            <Wifi className="h-5 w-5" aria-hidden="true" />
            WiFi Scanner
          </CardTitle>
          <CardDescription id="wifi-scanner-desc">
            Scan for nearby WiFi networks and view signal/security details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!support && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking WiFi support...
            </div>
          )}

          {support && !support.isSupported && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              WiFi scanning is not supported on this server.
              {support.reason && <div className="mt-1">Reason: {support.reason}</div>}
            </div>
          )}

          {support?.isSupported && (
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <label htmlFor="wifi-adapter-select" className="text-sm font-medium">Adapter</label>
                <Select
                  value={selectedAdapter ?? null}
                  onValueChange={(value) => setSelectedAdapter(value ?? undefined)}
                  disabled={adapters.length === 0 || isScanning}
                >
                  <SelectTrigger id="wifi-adapter-select" aria-label="Select WiFi adapter">
                    <SelectValue placeholder="Select adapter" />
                  </SelectTrigger>
                  <SelectContent>
                    {adapters.map((adapter) => (
                      <SelectItem key={adapter.name} value={adapter.name}>
                        {adapter.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {adapters.length === 0 && (
                  <p className="text-xs text-muted-foreground" role="status">
                    No WiFi adapters detected.
                  </p>
                )}
              </div>

              <div className="flex items-end">
                <Button
                  onClick={handleScan}
                  disabled={!support.isSupported || isScanning}
                  className="min-h-11"
                  aria-label={isScanning ? "Scanning for WiFi networks" : "Start WiFi network scan"}
                  aria-busy={isScanning}
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                      Scan Networks
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {rateLimitMessage && (
        <Card className="border-orange-500/40 bg-orange-500/5" role="alert" aria-live="polite">
          <CardContent className="pt-4 flex items-center gap-2 text-sm text-orange-600 dark:text-orange-400">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {rateLimitMessage}
          </CardContent>
        </Card>
      )}

      {support?.isSupported && (
        <Card role="region" aria-label="Network filter options">
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" aria-hidden="true" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="band-filter" className="text-sm font-medium">Band</label>
              <Select value={bandFilter} onValueChange={(value) => setBandFilter(value as BandFilter)}>
                <SelectTrigger id="band-filter" aria-label="Filter by frequency band">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Bands</SelectItem>
                  <SelectItem value="2.4">2.4 GHz</SelectItem>
                  <SelectItem value="5">5 GHz</SelectItem>
                  <SelectItem value="6">6 GHz</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="security-filter" className="text-sm font-medium">Security</label>
              <Select value={securityFilter} onValueChange={(value) => setSecurityFilter(value as SecurityFilter)}>
                <SelectTrigger id="security-filter" aria-label="Filter by security type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Networks</SelectItem>
                  <SelectItem value="secured">Secured</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {support?.isSupported && (
        <div className="space-y-4">
          {displayedNetworks.length > 0 ? (
            <>
              <div
                role="status"
                aria-live="polite"
                className="sr-only"
              >
                {displayedNetworks.length} WiFi networks displayed
              </div>
              <div
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                role="list"
                aria-label={`WiFi networks list, ${displayedNetworks.length} networks`}
                onKeyDown={handleListKeyDown}
                tabIndex={0}
              >
                {displayedNetworks.map((network, idx) => (
                  <div
                    key={`${network.bssid}-${idx}`}
                    role="listitem"
                    aria-posinset={idx + 1}
                    aria-setsize={displayedNetworks.length}
                    tabIndex={focusedIndex === idx ? 0 : -1}
                    className={`focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-lg ${
                      focusedIndex === idx ? "ring-2 ring-primary ring-offset-2" : ""
                    }`}
                  >
                    <WifiNetworkCard network={network} />
                  </div>
                ))}
              </div>
            </>
          ) : isScanning ? (
            <div
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              role="status"
              aria-label="Loading WiFi networks"
              aria-busy="true"
            >
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-36" aria-hidden="true" />
              ))}
            </div>
          ) : (
            <Card className="border-dashed" role="status">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <Signal className="h-10 w-10 mb-3 text-muted-foreground opacity-50" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  {isScanning
                    ? "Scanning for networks..."
                    : "No WiFi networks found yet. Run a scan to see results."}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}