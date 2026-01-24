/**
 * Network Scanner Page
 * Main page for network scanning and discovery tools.
 * Provides tab-based navigation between different scanning tools.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useIsMobile();

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

  // Auto-hide header on scroll
  // Auto-hide header on scroll
  const lastScrollY = useRef(0);
  const handleContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const currentScrollY = e.currentTarget.scrollTop;
    const scrollHeight = e.currentTarget.scrollHeight;
    const clientHeight = e.currentTarget.clientHeight;
    const header = document.getElementById("app-header");
    
    const isScrollingDown = currentScrollY > lastScrollY.current;
    lastScrollY.current = currentScrollY;

    // Prevent loop at the bottom of the page
    if (Math.abs(scrollHeight - clientHeight - currentScrollY) < 100) {
      return;
    }
    
    if (header) {
      if (currentScrollY > 10 && isScrollingDown) {
        // Scrolling down - hide header
        header.style.transform = "translateY(-100%)";
        header.style.opacity = "0";
        header.style.pointerEvents = "none";
        header.style.marginBottom = `-${header.offsetHeight}px`;
      } else if (!isScrollingDown) {
        // Scrolling up - show header
        header.style.transform = "translateY(0)";
        header.style.opacity = "1";
        header.style.pointerEvents = "auto";
        header.style.marginBottom = "0px";
      }
    }
  }, []);

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

  const sidebarWidth = sidebarCollapsed && !isMobile ? "md:w-14" : "md:w-48";

  return (
    <NetworkToolsProvider
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
    <div 
      className="flex flex-col h-full gap-4 pr-1 md:overflow-hidden overflow-y-auto"
      onScroll={handleContentScroll}
    >
      {/* Page Header - Sticky to Top on Desktop only */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between shrink-0 bg-background z-20 md:sticky top-0 py-2 border-b md:border-b-0">
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

      {/* Main Content with Sidebar */}
      <div className="flex flex-1 flex-col md:flex-row border border-border rounded-xl bg-background relative isolate md:overflow-hidden md:min-h-0">
        
        {/* Mobile: Tool Selection Dropdown */}
        {isMobile ? (
          <div className="p-4 border-b border-border shrink-0 bg-sidebar/50 backdrop-blur-sm z-30 sticky top-0">
            <Select 
              value={activeTab} 
              onValueChange={(v) => setActiveTab(v as NetworkToolTab)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a tool" />
              </SelectTrigger>
              <SelectContent>
                {TOOLS.map((tool) => {
                   const Icon = tool.icon;
                   return (
                    <SelectItem key={tool.id} value={tool.id}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        <span>{tool.label}</span>
                      </div>
                    </SelectItem>
                   );
                })}
              </SelectContent>
            </Select>
          </div>
        ) : (
          /* Desktop: Sidebar */
          <div
            className={cn(
              "flex flex-col border-r border-border bg-sidebar transition-all duration-300 min-h-0 overflow-hidden",
              sidebarWidth,
              "h-full shrink-0"
            )}
          >
            <div className="flex items-center justify-between p-2 border-b border-border shrink-0">
              {!sidebarCollapsed && (
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold px-2">Tools</h2>
                  <span className="text-xs text-muted-foreground">
                    {filteredTools.length}/{TOOLS.length}
                  </span>
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              >
                {sidebarCollapsed ? (
                  <PanelLeft className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </Button>
            </div>

            {!sidebarCollapsed && (
              <div className="p-2 border-b border-border shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={toolQuery}
                    onChange={(event) => handleToolQueryChange(event.target.value)}
                    placeholder="Filter tools…"
                    aria-label="Filter network tools"
                    className="h-8 pl-9 pr-9 text-sm"
                  />
                  {toolQuery && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToolQueryChange("")}
                      aria-label="Clear tool filter"
                      className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full w-full">
                <div className={cn("p-2", sidebarCollapsed ? "space-y-1" : "space-y-1")}> 
                  {filteredTools.length === 0 && !sidebarCollapsed && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No tools match “{toolQuery.trim()}”.
                    </div>
                  )}
                  {filteredTools.map((tool) => {
                    const isSelected = tool.id === activeTab;
                    const Icon = tool.icon;

                    if (sidebarCollapsed) {
                      return (
                        <button
                          key={tool.id}
                          onClick={() => setActiveTab(tool.id as NetworkToolTab)}
                          className={cn(
                            "w-full p-2 rounded-md transition-colors flex items-center justify-center",
                            isSelected ? "bg-accent" : "hover:bg-accent/50"
                          )}
                          title={tool.label}
                        >
                          <Icon className={cn("h-4 w-4", isSelected ? "text-foreground" : "text-muted-foreground")} />
                        </button>
                      );
                    }

                    return (
                      <button
                        key={tool.id}
                        onClick={() => setActiveTab(tool.id as NetworkToolTab)}
                        className={cn(
                          "w-full text-left p-2 rounded-md transition-colors flex items-center gap-2",
                          isSelected ? "bg-accent text-foreground" : "hover:bg-accent/50 text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate text-sm font-medium">{tool.label}</span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {!sidebarCollapsed && (
              <div className="p-2 border-t border-border text-xs text-muted-foreground text-center shrink-0">
                Showing {filteredTools.length} of {TOOLS.length} tools
              </div>
            )}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as NetworkToolTab)} className="flex-1 flex flex-col min-w-0 md:overflow-hidden h-full">
          <CardContent 
            className="flex-col relative pt-4 px-4 sm:px-6 scroll-smooth md:flex-1 md:overflow-y-auto"
            onScroll={handleContentScroll}
          >
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
      </div>
    </div>
    </NetworkToolsProvider>
  );
}

