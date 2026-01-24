/**
 * Network Scanner Page
 * Main page for network scanning and discovery tools.
 * Provides tab-based navigation between different scanning tools.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Network,
  Radio,
  Route,
  Search,
  Server,
  Wifi,
  Radar,
  History,
  Database,
  Globe,
  ShieldCheck,
  RefreshCw,
  Loader2,
  Power,
  Gauge,
  Calculator,
  Fingerprint,
  LocateFixed,
  Share2,
  X,
  Signal,
  FileText,
  Activity,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { PingTool } from "@/components/network/PingTool";
import { SubnetScanTool } from "@/components/network/SubnetScanTool";
import { NetworkTopologyTool } from "@/components/network/NetworkTopologyTool";
import { TracerouteTool } from "@/components/network/TracerouteTool";
import { PortScanTool } from "@/components/network/PortScanTool";
import { DeviceDiscoveryTool } from "@/components/network/DeviceDiscoveryTool";
import { WifiScannerTool } from "@/components/network/WifiScannerTool";
import { DnsTool } from "@/components/network/DnsTool";
import { SslInspectorTool } from "@/components/network/SslInspectorTool";
import { GeolocationDbManager } from "@/components/network/GeolocationDbManager";
import { WakeOnLanTool } from "@/components/network/WakeOnLanTool";
import { SpeedTestTool } from "@/components/network/SpeedTestTool";
import { SubnetCalculatorTool } from "@/components/network/SubnetCalculatorTool";
import { MacVendorLookupTool } from "@/components/network/MacVendorLookupTool";
import { PublicIpTool } from "@/components/network/PublicIpTool";
import { SnmpTool } from "@/components/network/SnmpTool";
import { ArpTableTool } from "@/components/network/ArpTableTool";
import { NetworkToolHistoryPanel } from "@/components/network/NetworkToolHistoryPanel";
import { NetworkErrorBoundary } from "@/components/network/NetworkErrorBoundary";
import { NetworkToolHistoryProvider } from "@/contexts/NetworkToolHistoryContext";
import { InternetHealthTool } from "@/components/network/InternetHealthTool";
import { SyslogTool } from "@/components/network/SyslogTool";
import { PacketCaptureTool } from "@/components/network/PacketCaptureTool";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  isRealtimeEnabled,
  isNotificationsEnabled,
  setRealtimeEnabled,
  setNotificationsEnabled,
  subscribeNotificationPreference,
  subscribeRealtimePreference,
} from "@/lib/network-preferences";
import { NetworkToolsProvider, type NetworkToolTab } from "@/contexts/NetworkToolsContext";
import { useNetworkSettingsSync } from "@/hooks/useNetworkSettingsSync";
import { cn } from "@/lib/utils";

// Tool Definitions
const TOOLS = [
  { id: "ping", label: "Ping", icon: Radio },
  { id: "internet-health", label: "Internet Health", icon: Signal },
  { id: "syslog", label: "Syslog", icon: FileText },
  { id: "packet-capture", label: "Packet Capture", icon: Activity },
  { id: "subnet", label: "Subnet", icon: Search },
  { id: "topology", label: "Topology", icon: Share2 },
  { id: "traceroute", label: "Traceroute", icon: Route },
  { id: "ports", label: "Ports", icon: Server },
  { id: "wol", label: "WoL", icon: Power },
  { id: "speedtest", label: "Speed Test", icon: Gauge },
  { id: "subnetcalc", label: "Subnet Calc", icon: Calculator },
  { id: "mac-vendor", label: "MAC Vendor", icon: Fingerprint },
  { id: "dns", label: "DNS", icon: Globe },
  { id: "snmp", label: "SNMP", icon: Database },
  { id: "arp", label: "ARP", icon: Network },
  { id: "public-ip", label: "Public IP", icon: LocateFixed },
  { id: "ssl", label: "SSL", icon: ShieldCheck },
  { id: "discovery", label: "Discovery", icon: Radar },
  { id: "wifi", label: "WiFi", icon: Wifi },
  { id: "geodb", label: "GeoIP", icon: Database },
  { id: "history", label: "History", icon: History },
] as const;

const ACTIVE_TAB_KEY = "manlab:network:active-tab";

// Connection status indicator with enhanced retry functionality
function ConnectionIndicator({ 
  status, 
  error,
  onRetry 
}: { 
  status: string; 
  error: Error | null;
  onRetry?: () => void;
}) {
  const getStatusColor = () => {
    switch (status) {
      case "Connected":
        return "bg-green-500";
      case "Connecting":
      case "Reconnecting":
        return "bg-yellow-500 animate-pulse";
      case "Error":
        return "bg-red-500";
      default:
        return "bg-gray-500";
      }
  };

  const getStatusText = () => {
    switch (status) {
      case "Connected":
        return "Real-time updates active";
      case "Connecting":
        return "Connecting to server...";
      case "Reconnecting":
        return "Connection lost. Reconnecting...";
      case "Error":
        return "Connection error";
      default:
        return "Disconnected";
    }
  };

  const isReconnecting = status === "Reconnecting" || status === "Connecting";
  const hasError = status === "Error" || status === "Disconnected";

  return (
    <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite" aria-atomic="true">
      <div className={`h-2.5 w-2.5 rounded-full ${getStatusColor()}`} aria-hidden="true" />
      <span className={hasError ? "text-destructive" : "text-muted-foreground"}>
        {getStatusText()}
        {error && hasError && (
          <span className="block text-xs opacity-75">{error.message}</span>
        )}
      </span>
      {isReconnecting && (
        <RefreshCw className="h-3 w-3 animate-spin text-yellow-500" />
      )}
      {hasError && onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-6 px-2">
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
      )}
    </div>
  );
}

export function NetworkScannerPage() {
  const { isReady: settingsReady } = useNetworkSettingsSync();

  const getStoredTab = (): NetworkToolTab => {
    if (typeof window === "undefined") return "ping";
    const stored = localStorage.getItem(ACTIVE_TAB_KEY);
    if (stored && TOOLS.some((tool) => tool.id === stored)) {
      return stored as NetworkToolTab;
    }
    return "ping";
  };

  const [activeTab, setActiveTab] = useState<NetworkToolTab>(() => getStoredTab());
  const { status, error } = useNetworkHub();
  const [realtimeEnabled, setRealtimeEnabledState] = useState(isRealtimeEnabled());
  const [notificationsEnabled, setNotificationsEnabledState] = useState(isNotificationsEnabled());
  const [toolQuery, setToolQuery] = useState("");

  const filteredTools = useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return TOOLS;
    return TOOLS.filter((tool) =>
      tool.label.toLowerCase().includes(query) || tool.id.toLowerCase().includes(query)
    );
  }, [toolQuery]);

    const handleToolQueryChange = useCallback((value: string) => {
      setToolQuery(value);
      const query = value.trim().toLowerCase();
      const nextFiltered = query
        ? TOOLS.filter((tool) =>
            tool.label.toLowerCase().includes(query) || tool.id.toLowerCase().includes(query)
          )
        : TOOLS;

      if (nextFiltered.length > 0 && !nextFiltered.some((tool) => tool.id === activeTab)) {
        setActiveTab(nextFiltered[0].id as NetworkToolTab);
      }

    }, [activeTab]);

  // Force reconnect by toggling realtime off and on
  const handleRetryConnection = useCallback(() => {
    setRealtimeEnabled(false);
    setTimeout(() => setRealtimeEnabled(true), 500);
  }, []);

  useEffect(() => {
    const unsubscribeRealtime = subscribeRealtimePreference(setRealtimeEnabledState);
    const unsubscribeNotifications = subscribeNotificationPreference(setNotificationsEnabledState);
    return () => {
      unsubscribeRealtime();
      unsubscribeNotifications();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
  }, [activeTab]);

  if (!settingsReady) {
    return (
      <div className="flex items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center gap-3 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Loading network settings...
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }


  return (
    <NetworkToolsProvider
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-primary/10">
              <Network className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            </div>
            Network Tools
          </h1>
          <p className="text-muted-foreground mt-1">
            Scan, discover, and analyze your network infrastructure
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          <ConnectionIndicator status={status} error={error} onRetry={handleRetryConnection} />
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Switch
                checked={realtimeEnabled}
                onCheckedChange={(checked) => {
                  setRealtimeEnabled(checked);
                }}
                aria-label="Toggle real-time updates"
              />
              <span>Real-time updates</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={notificationsEnabled}
                onCheckedChange={(checked) => {
                  setNotificationsEnabled(checked);
                }}
                aria-label="Toggle notifications"
              />
              <span>Notifications</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content with Tabs */}
      <Card className="border-0 shadow-none sm:border sm:shadow">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as NetworkToolTab)} className="w-full">
          <CardHeader className="px-0 sm:px-6 pb-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={toolQuery}
                  onChange={(event) => handleToolQueryChange(event.target.value)}
                  placeholder="Filter tools…"
                  aria-label="Filter network tools"
                  className="h-9 pl-9 pr-9 text-sm"
                />
                {toolQuery && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleToolQueryChange("")}
                    aria-label="Clear tool filter"
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Showing {filteredTools.length} of {TOOLS.length} tools
              </div>
            </div>
            
            {/* Tool Tab Bar */}
            <div className="w-full overflow-x-auto pb-1 scrollbar-hide">
              <TabsList className="flex w-max min-w-full justify-start h-auto p-1 bg-muted/50 rounded-lg gap-2">
                {filteredTools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <TabsTrigger
                      key={tool.id}
                      value={tool.id}
                      className={cn(
                        "gap-2 px-4 flex-none data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200",
                        "hover:bg-muted/60"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="inline whitespace-nowrap">{tool.label}</span>
                    </TabsTrigger>
                  );
                })}

                {filteredTools.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No tools match “{toolQuery.trim()}”.
                  </div>
                )}
              </TabsList>
            </div>
          </CardHeader>

          <CardContent className="pt-2 px-0 sm:px-6">
            <TabsContent value="ping" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Ping Tool Error">
                <PingTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="internet-health" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Internet Health Error">
                <InternetHealthTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="syslog" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Syslog Receiver Error">
                <SyslogTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="packet-capture" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Packet Capture Error">
                <PacketCaptureTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="subnet" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Subnet Scanner Error">
                <SubnetScanTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="topology" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Topology Mapper Error">
                <NetworkTopologyTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="traceroute" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Traceroute Tool Error">
                <TracerouteTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="ports" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Port Scanner Error">
                <PortScanTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="wol" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Wake-on-LAN Error">
                <WakeOnLanTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="speedtest" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Speed Test Error">
                <SpeedTestTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="subnetcalc" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Subnet Calculator Error">
                <SubnetCalculatorTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="mac-vendor" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="MAC Vendor Lookup Error">
                <MacVendorLookupTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="dns" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="DNS Tool Error">
                <DnsTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="public-ip" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Public IP Tool Error">
                <PublicIpTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="snmp" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="SNMP Tool Error">
                <SnmpTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="arp" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="ARP Tool Error">
                <ArpTableTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="ssl" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="SSL Inspector Error">
                <SslInspectorTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="discovery" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Device Discovery Error">
                <DeviceDiscoveryTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="wifi" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="WiFi Scanner Error">
                <WifiScannerTool />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="geodb" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Geolocation Database Error">
                <GeolocationDbManager />
              </NetworkErrorBoundary>
            </TabsContent>

            <TabsContent value="history" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="History Panel Error">
                <NetworkToolHistoryProvider autoRefreshMs={30000}>
                  <NetworkToolHistoryPanel />
                </NetworkToolHistoryProvider>
              </NetworkErrorBoundary>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
    </NetworkToolsProvider>
  );
}

