/**
 * Network Scanner Page
 * Main page for network scanning and discovery tools.
 * Provides tab-based navigation between different scanning tools.
 */

import { useState } from "react";
import {
  Network,
  Radio,
  Route,
  Search,
  Server,
  Wifi,
  Radar,
  Activity,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { PingTool } from "@/components/network/PingTool";
import { SubnetScanTool } from "@/components/network/SubnetScanTool";
import { TracerouteTool } from "@/components/network/TracerouteTool";
import { PortScanTool } from "@/components/network/PortScanTool";
import { DeviceDiscoveryTool } from "@/components/network/DeviceDiscoveryTool";

// Placeholder component - will be implemented in subsequent tasks

function WifiScannerToolPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <Wifi className="h-16 w-16 mb-4 opacity-50" />
      <h3 className="text-lg font-medium mb-2">WiFi Scanner</h3>
      <p className="text-sm text-center max-w-md">
        Scan for nearby WiFi networks. View SSIDs, signal strength, channels, and security information.
      </p>
      <Badge variant="outline" className="mt-4">Coming Soon</Badge>
    </div>
  );
}

// Connection status indicator
function ConnectionIndicator({ status, error }: { status: string; error: Error | null }) {
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

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <div className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
      <span>
        {status === "Connected" ? "Real-time updates active" : status}
        {error && status === "Error" && `: ${error.message}`}
      </span>
    </div>
  );
}

export function NetworkScannerPage() {
  const [activeTab, setActiveTab] = useState("ping");
  const { status, error } = useNetworkHub();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Network className="h-6 w-6 text-primary" />
            </div>
            Network Tools
          </h1>
          <p className="text-muted-foreground mt-1">
            Scan, discover, and analyze your network infrastructure
          </p>
        </div>
        <ConnectionIndicator status={status} error={error} />
      </div>

      {/* Tools Overview Cards - Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
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
            <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
              <TabsTrigger value="ping" className="gap-2">
                <Radio className="h-4 w-4" />
                <span className="hidden sm:inline">Ping</span>
              </TabsTrigger>
              <TabsTrigger value="subnet" className="gap-2">
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">Subnet</span>
              </TabsTrigger>
              <TabsTrigger value="traceroute" className="gap-2">
                <Route className="h-4 w-4" />
                <span className="hidden sm:inline">Traceroute</span>
              </TabsTrigger>
              <TabsTrigger value="ports" className="gap-2">
                <Server className="h-4 w-4" />
                <span className="hidden sm:inline">Ports</span>
              </TabsTrigger>
              <TabsTrigger value="discovery" className="gap-2">
                <Radar className="h-4 w-4" />
                <span className="hidden sm:inline">Discovery</span>
              </TabsTrigger>
              <TabsTrigger value="wifi" className="gap-2">
                <Wifi className="h-4 w-4" />
                <span className="hidden sm:inline">WiFi</span>
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          <CardContent className="pt-6">
            <TabsContent value="ping" className="mt-0">
              <PingTool />
            </TabsContent>

            <TabsContent value="subnet" className="mt-0">
              <SubnetScanTool />
            </TabsContent>

            <TabsContent value="traceroute" className="mt-0">
              <TracerouteTool />
            </TabsContent>

            <TabsContent value="ports" className="mt-0">
              <PortScanTool />
            </TabsContent>

            <TabsContent value="discovery" className="mt-0">
              <DeviceDiscoveryTool />
            </TabsContent>

            <TabsContent value="wifi" className="mt-0">
              <WifiScannerToolPlaceholder />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>

      {/* Feature Info Footer */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
  );
}
