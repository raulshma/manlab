/**
 * Network Scanner Page
 * Main page for network scanning and discovery tools.
 * Provides tab-based navigation between different scanning tools.
 */

import { useEffect, useState, useCallback } from "react";
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
import { NetworkToolHistoryPanel } from "@/components/network/NetworkToolHistoryPanel";
import { NetworkErrorBoundary } from "@/components/network/NetworkErrorBoundary";
import { NetworkToolHistoryProvider } from "@/contexts/NetworkToolHistoryContext";
import { Switch } from "@/components/ui/switch";
import {
  isRealtimeEnabled,
  isNotificationsEnabled,
  setRealtimeEnabled,
  setNotificationsEnabled,
  subscribeNotificationPreference,
  subscribeRealtimePreference,
} from "@/lib/network-preferences";
import { NetworkToolsProvider, type NetworkToolTab } from "@/contexts/NetworkToolsContext";

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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <CardHeader className="px-0 sm:px-6 pb-2">
            <TabsList className="flex w-full overflow-x-auto justify-start h-auto p-1 scrollbar-hide snap-x bg-muted/50 rounded-lg">
              <TabsTrigger value="ping" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <Radio className="h-4 w-4" />
                <span className="inline">Ping</span>
              </TabsTrigger>
              <TabsTrigger value="subnet" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <Search className="h-4 w-4" />
                <span className="inline">Subnet</span>
              </TabsTrigger>
              <TabsTrigger value="traceroute" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <Route className="h-4 w-4" />
                <span className="inline">Traceroute</span>
              </TabsTrigger>
              <TabsTrigger value="ports" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <Server className="h-4 w-4" />
                <span className="inline">Ports</span>
              </TabsTrigger>
              <TabsTrigger value="dns" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <Globe className="h-4 w-4" />
                <span className="inline">DNS</span>
              </TabsTrigger>
              <TabsTrigger value="ssl" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <ShieldCheck className="h-4 w-4" />
                <span className="inline">SSL</span>
              </TabsTrigger>
              <TabsTrigger value="discovery" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <Radar className="h-4 w-4" />
                <span className="inline">Discovery</span>
              </TabsTrigger>
              <TabsTrigger value="wifi" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <Wifi className="h-4 w-4" />
                <span className="inline">WiFi</span>
              </TabsTrigger>
              <TabsTrigger value="geodb" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <Database className="h-4 w-4" />
                <span className="inline">GeoIP</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2 min-w-fit px-4 sm:px-6 flex-1 shrink-0 snap-center data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200">
                <History className="h-4 w-4" />
                <span className="inline">History</span>
              </TabsTrigger>
            </TabsList>
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

            <TabsContent value="dns" className="mt-0 space-y-4">
              <NetworkErrorBoundary fallbackTitle="DNS Tool Error">
                <DnsTool />
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
