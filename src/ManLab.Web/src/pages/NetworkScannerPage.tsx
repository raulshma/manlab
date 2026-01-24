/**
 * Network Scanner Page
 * Main page for network scanning and discovery tools.
 * Provides tab-based navigation between different scanning tools.
 */

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
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
  Power,
  Gauge,
  Calculator,
  Fingerprint,
  LocateFixed,
  MoreHorizontal,
  Check,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { PingTool } from "@/components/network/PingTool";
import { SubnetScanTool } from "@/components/network/SubnetScanTool";
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
import { NetworkToolHistoryPanel } from "@/components/network/NetworkToolHistoryPanel";
import { NetworkErrorBoundary } from "@/components/network/NetworkErrorBoundary";
import { NetworkToolHistoryProvider } from "@/contexts/NetworkToolHistoryContext";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isRealtimeEnabled,
  isNotificationsEnabled,
  setRealtimeEnabled,
  setNotificationsEnabled,
  subscribeNotificationPreference,
  subscribeRealtimePreference,
} from "@/lib/network-preferences";
import { NetworkToolsProvider, type NetworkToolTab } from "@/contexts/NetworkToolsContext";
import { cn } from "@/lib/utils";

// Tool Definitions
const TOOLS = [
  { id: "ping", label: "Ping", icon: Radio },
  { id: "subnet", label: "Subnet", icon: Search },
  { id: "traceroute", label: "Traceroute", icon: Route },
  { id: "ports", label: "Ports", icon: Server },
  { id: "wol", label: "WoL", icon: Power },
  { id: "speedtest", label: "Speed Test", icon: Gauge },
  { id: "subnetcalc", label: "Subnet Calc", icon: Calculator },
  { id: "mac-vendor", label: "MAC Vendor", icon: Fingerprint },
  { id: "dns", label: "DNS", icon: Globe },
  { id: "public-ip", label: "Public IP", icon: LocateFixed },
  { id: "ssl", label: "SSL", icon: ShieldCheck },
  { id: "discovery", label: "Discovery", icon: Radar },
  { id: "wifi", label: "WiFi", icon: Wifi },
  { id: "geodb", label: "GeoIP", icon: Database },
  { id: "history", label: "History", icon: History },
] as const;

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
    <div className="flex items-center gap-2 text-sm">
      <div className={`h-2.5 w-2.5 rounded-full ${getStatusColor()}`} />
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
  const [activeTab, setActiveTab] = useState<NetworkToolTab>("ping");
  const { status, error } = useNetworkHub();
  const [realtimeEnabled, setRealtimeEnabledState] = useState(isRealtimeEnabled());
  const [notificationsEnabled, setNotificationsEnabledState] = useState(isNotificationsEnabled());

  // Responsive Tabs Logic
  const [visibleCount, setVisibleCount] = useState<number>(TOOLS.length);
  const containerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const calculateVisibleTabs = () => {
      if (!containerRef.current || !ghostRef.current) return;

      const containerWidth = containerRef.current.clientWidth;
      const ghostItems = Array.from(ghostRef.current.children) as HTMLElement[];
      const moreButtonWidth = 80; // Approximate width of "More" button + padding
      
      let currentWidth = 0;
      let count = 0;

      for (let i = 0; i < ghostItems.length; i++) {
        const itemWidth = ghostItems[i].offsetWidth + 8; // +8 for gap preference
        
        // If this is the last item and it fits, we don't need the "More" button
        if (i === ghostItems.length - 1) {
             if (currentWidth + itemWidth <= containerWidth) {
                 count++;
             }
             break;
        }

        if (currentWidth + itemWidth + moreButtonWidth <= containerWidth) {
          currentWidth += itemWidth;
          count++;
        } else {
          break;
        }
      }
      
      // Ensure at least one tab is visible if possible, though unlikely to fail
      setVisibleCount(Math.max(1, count));
    };

    calculateVisibleTabs();
    
    const observer = new ResizeObserver(calculateVisibleTabs);
    if (containerRef.current) {
        observer.observe(containerRef.current);
    }
    
    return () => observer.disconnect();
  }, []);

  const visibleTools = TOOLS.slice(0, visibleCount);
  const overflowTools = TOOLS.slice(visibleCount);
  const isOverflowActive = overflowTools.some(t => t.id === activeTab);
  const activeOverflowTool = overflowTools.find(t => t.id === activeTab);

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
            
            {/* Ghost List for Measurement (Invisible & Off-screen) */}
            <div 
                ref={ghostRef} 
                className="flex fixed bottom-0 left-0 -z-50 opacity-0 pointer-events-none w-max"
                aria-hidden="true"
                style={{ transform: 'translateY(200%)' }} // Extra safety to force it out of view
            >
                 {TOOLS.map((tool) => {
                    const Icon = tool.icon;
                    return (
                        <div key={tool.id} className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-transparent">
                            <Icon className="h-4 w-4" />
                            <span className="inline">{tool.label}</span>
                        </div>
                    );
                 })}
            </div>

            {/* Real Tab List */}
            <div ref={containerRef} className="w-full overflow-hidden">
                <TabsList className="flex w-full justify-start h-auto p-1 bg-muted/50 rounded-lg gap-2">
                {visibleTools.map((tool) => {
                    const Icon = tool.icon;
                    return (
                        <TabsTrigger 
                            key={tool.id} 
                            value={tool.id} 
                            className="gap-2 px-4 flex-none data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200"
                        >
                            <Icon className="h-4 w-4" />
                            <span className="inline">{tool.label}</span>
                        </TabsTrigger>
                    );
                })}
                
                {overflowTools.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            className={cn(
                                "flex items-center justify-center gap-2 px-4 h-9 rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent",
                                isOverflowActive && "bg-background text-foreground shadow-sm ring-1 ring-border"
                            )}
                        >
                                {isOverflowActive && activeOverflowTool ? (
                                    <>
                                        <activeOverflowTool.icon className="h-4 w-4" />
                                        <span className="inline">{activeOverflowTool.label}</span>
                                    </>
                                ) : (
                                    <>
                                        <MoreHorizontal className="h-4 w-4" />
                                        <span className="inline">More</span>
                                    </>
                                )}
                                <div className="ml-1 text-[10px] font-mono opacity-50 bg-primary/10 px-1 rounded">
                                    {overflowTools.length}
                                </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[200px]">
                            {overflowTools.map((tool) => {
                                const Icon = tool.icon;
                                return (
                                    <DropdownMenuItem
                                        key={tool.id}
                                        onClick={() => setActiveTab(tool.id as NetworkToolTab)}
                                        className="gap-2 cursor-pointer"
                                    >
                                        <Icon className="h-4 w-4 text-muted-foreground" />
                                        {tool.label}
                                        {activeTab === tool.id && (
                                            <Check className="ml-auto h-4 w-4 text-primary" />
                                        )}
                                    </DropdownMenuItem>
                                );
                            })}
                        </DropdownMenuContent>
                    </DropdownMenu>
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

            <TabsContent value="subnet" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="Subnet Scanner Error">
                <SubnetScanTool />
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

