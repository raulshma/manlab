import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Activity, Network, Globe, Signal } from "lucide-react";
import { MonitorJobsPanel } from "../components/monitoring/MonitorJobsPanel";
import { HttpMonitorsPanel } from "../components/monitoring/HttpMonitorsPanel";
import { TrafficMonitorPanel } from "../components/monitoring/TrafficMonitorPanel";
import { EnhancedNetworkTelemetryPanel } from "../components/monitoring/EnhancedNetworkTelemetryPanel";

export function MonitoringPage() {
  const [activeTab, setActiveTab] = useState("jobs");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Activity className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Monitoring</h1>
          <p className="text-muted-foreground mt-1">
            Manage background monitors and review health signals.
          </p>
        </div>
      </div>

      <Card className="border-0 shadow-none sm:border sm:shadow">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <CardHeader className="pb-2">
            <TabsList className="grid w-full grid-cols-1 sm:grid-cols-4">
              <TabsTrigger value="jobs" className="gap-2">
                <Activity className="h-4 w-4" />
                Jobs
              </TabsTrigger>
              <TabsTrigger value="http" className="gap-2">
                <Globe className="h-4 w-4" />
                HTTP Health
              </TabsTrigger>
              <TabsTrigger value="traffic" className="gap-2">
                <Network className="h-4 w-4" />
                Traffic
              </TabsTrigger>
              <TabsTrigger value="enhanced" className="gap-2">
                <Signal className="h-4 w-4" />
                Network Telemetry
              </TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="jobs" className="mt-0">
              <MonitorJobsPanel onManageJob={(type) => setActiveTab(type === "http" ? "http" : "traffic")} />
            </TabsContent>
            <TabsContent value="http" className="mt-0">
              <HttpMonitorsPanel />
            </TabsContent>
            <TabsContent value="traffic" className="mt-0">
              <TrafficMonitorPanel />
            </TabsContent>
            <TabsContent value="enhanced" className="mt-0">
              <EnhancedNetworkTelemetryPanel />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );
}
