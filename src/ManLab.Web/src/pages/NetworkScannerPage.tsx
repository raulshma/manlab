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
  Activity,
  ChevronDown,
  Database,
  RefreshCw,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { PingTool } from "@/components/network/PingTool";
import { SubnetScanTool } from "@/components/network/SubnetScanTool";
import { TracerouteTool } from "@/components/network/TracerouteTool";
import { PortScanTool } from "@/components/network/PortScanTool";
import { DeviceDiscoveryTool } from "@/components/network/DeviceDiscoveryTool";
import { WifiScannerTool } from "@/components/network/WifiScannerTool";
import { GeolocationDbManager } from "@/components/network/GeolocationDbManager";
import { NetworkErrorBoundary } from "@/components/network/NetworkErrorBoundary";
import { Switch } from "@/components/ui/switch";
import {
  isRealtimeEnabled,
  isNotificationsEnabled,
  setRealtimeEnabled,
  setNotificationsEnabled,
  subscribeNotificationPreference,
  subscribeRealtimePreference,
} from "@/lib/network-preferences";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
  const [activeTab, setActiveTab] = useState("ping");
  const { status, error } = useNetworkHub();
  const [realtimeEnabled, setRealtimeEnabledState] = useState(isRealtimeEnabled());
  const [notificationsEnabled, setNotificationsEnabledState] = useState(isNotificationsEnabled());
  const [showQuickTools, setShowQuickTools] = useState(false);

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

      {/* Tools Overview Cards - Quick Stats */}
      <Collapsible open={showQuickTools} onOpenChange={setShowQuickTools}>
        <div className="flex items-center justify-between sm:hidden">
          <p className="text-sm font-medium text-muted-foreground">Quick tools</p>
          <CollapsibleTrigger className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3 gap-2">
            {showQuickTools ? "Hide" : "Show"}
            <ChevronDown className={`h-4 w-4 transition-transform ${showQuickTools ? "rotate-180" : ""}`} />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="sm:hidden">
          <div className="grid gap-4">
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'ping' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('ping')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Radio className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Ping</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'subnet' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('subnet')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Search className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Subnet Scan</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'traceroute' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('traceroute')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Route className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Traceroute</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'ports' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('ports')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Server className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Port Scan</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'discovery' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('discovery')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Radar className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Discovery</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'wifi' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('wifi')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Wifi className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">WiFi</span>
              </CardContent>
            </Card>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr] xl:grid-cols-[260px_1fr_320px]">
        <aside className="hidden lg:block space-y-4">
          <div className="grid gap-4">
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'ping' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('ping')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Radio className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Ping</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'subnet' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('subnet')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Search className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Subnet Scan</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'traceroute' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('traceroute')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Route className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Traceroute</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'ports' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('ports')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Server className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Port Scan</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'discovery' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('discovery')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Radar className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Discovery</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'wifi' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('wifi')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Wifi className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">WiFi</span>
              </CardContent>
            </Card>
          </div>
        </aside>

        <div className="space-y-6">
          <div className="hidden sm:grid lg:hidden gap-4 sm:grid-cols-2">
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'ping' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('ping')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Radio className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Ping</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'subnet' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('subnet')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Search className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Subnet Scan</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'traceroute' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('traceroute')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Route className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Traceroute</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'ports' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('ports')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Server className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Port Scan</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'discovery' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('discovery')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Radar className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">Discovery</span>
              </CardContent>
            </Card>
            <Card 
              className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'wifi' ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => setActiveTab('wifi')}
            >
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Wifi className="h-8 w-8 mb-2 text-primary" />
                <span className="text-sm font-medium">WiFi</span>
              </CardContent>
            </Card>
          </div>

          {/* Main Content with Tabs */}
          <Card>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <CardHeader className="pb-0">
                <TabsList className="flex w-full overflow-x-auto justify-start h-auto p-1 scrollbar-hide snap-x sm:grid sm:grid-cols-4 lg:grid-cols-7">
                  <TabsTrigger value="ping" className="gap-2 min-w-fit px-3 sm:px-2 flex-1 shrink-0 snap-center">
                    <Radio className="h-4 w-4" />
                    <span className="inline">Ping</span>
                  </TabsTrigger>
                  <TabsTrigger value="subnet" className="gap-2 min-w-fit px-3 sm:px-2 flex-1 shrink-0 snap-center">
                    <Search className="h-4 w-4" />
                    <span className="inline">Subnet</span>
                  </TabsTrigger>
                  <TabsTrigger value="traceroute" className="gap-2 min-w-fit px-3 sm:px-2 flex-1 shrink-0 snap-center">
                    <Route className="h-4 w-4" />
                    <span className="inline">Traceroute</span>
                  </TabsTrigger>
                  <TabsTrigger value="ports" className="gap-2 min-w-fit px-3 sm:px-2 flex-1 shrink-0 snap-center">
                    <Server className="h-4 w-4" />
                    <span className="inline">Ports</span>
                  </TabsTrigger>
                  <TabsTrigger value="discovery" className="gap-2 min-w-fit px-3 sm:px-2 flex-1 shrink-0 snap-center">
                    <Radar className="h-4 w-4" />
                    <span className="inline">Discovery</span>
                  </TabsTrigger>
                  <TabsTrigger value="wifi" className="gap-2 min-w-fit px-3 sm:px-2 flex-1 shrink-0 snap-center">
                    <Wifi className="h-4 w-4" />
                    <span className="inline">WiFi</span>
                  </TabsTrigger>
                  <TabsTrigger value="geodb" className="gap-2 min-w-fit px-3 sm:px-2 flex-1 shrink-0 snap-center">
                    <Database className="h-4 w-4" />
                    <span className="inline">GeoIP</span>
                  </TabsTrigger>
                </TabsList>
              </CardHeader>

              <CardContent className="pt-6">
                <TabsContent value="ping" className="mt-0">
                  <NetworkErrorBoundary fallbackTitle="Ping Tool Error">
                    <PingTool />
                  </NetworkErrorBoundary>
                </TabsContent>

                <TabsContent value="subnet" className="mt-0">
                  <NetworkErrorBoundary fallbackTitle="Subnet Scanner Error">
                    <SubnetScanTool />
                  </NetworkErrorBoundary>
                </TabsContent>

                <TabsContent value="traceroute" className="mt-0">
                  <NetworkErrorBoundary fallbackTitle="Traceroute Tool Error">
                    <TracerouteTool />
                  </NetworkErrorBoundary>
                </TabsContent>

                <TabsContent value="ports" className="mt-0">
                  <NetworkErrorBoundary fallbackTitle="Port Scanner Error">
                    <PortScanTool />
                  </NetworkErrorBoundary>
                </TabsContent>

                <TabsContent value="discovery" className="mt-0">
                  <NetworkErrorBoundary fallbackTitle="Device Discovery Error">
                    <DeviceDiscoveryTool />
                  </NetworkErrorBoundary>
                </TabsContent>

                <TabsContent value="wifi" className="mt-0">
                  <NetworkErrorBoundary fallbackTitle="WiFi Scanner Error">
                    <WifiScannerTool />
                  </NetworkErrorBoundary>
                </TabsContent>

                <TabsContent value="geodb" className="mt-0">
                  <NetworkErrorBoundary fallbackTitle="Geolocation Database Error">
                    <GeolocationDbManager />
                  </NetworkErrorBoundary>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

          {/* Feature Info Footer (below on smaller screens) */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2 xl:hidden">
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-green-500" />
                  Real-Time Updates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  All scanning operations support real-time progress updates via SignalR WebSocket connection.
                </CardDescription>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4 text-blue-500" />
                  Cross-Platform
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Network scanning works on both Windows and Linux servers with platform-specific optimizations.
                </CardDescription>
              </CardContent>
            </Card>
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Network className="h-4 w-4 text-purple-500" />
                  Secure Scanning
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Scans are restricted to private network ranges with rate limiting and audit logging.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="hidden xl:grid gap-4">
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-green-500" />
                Real-Time Updates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                All scanning operations support real-time progress updates via SignalR WebSocket connection.
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="h-4 w-4 text-blue-500" />
                Cross-Platform
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Network scanning works on both Windows and Linux servers with platform-specific optimizations.
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Network className="h-4 w-4 text-purple-500" />
                Secure Scanning
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Scans are restricted to private network ranges with rate limiting and audit logging.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
