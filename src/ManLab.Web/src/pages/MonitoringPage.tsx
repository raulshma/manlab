import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonitorJobsPanel } from "@/components/monitoring/MonitorJobsPanel";
import { HttpMonitorsPanel } from "@/components/monitoring/HttpMonitorsPanel";
import { TrafficMonitorPanel } from "@/components/monitoring/TrafficMonitorPanel";
import { EnhancedNetworkTelemetryPanel } from "@/components/monitoring/EnhancedNetworkTelemetryPanel";
import { MonitoringHistoryPanel } from "@/components/monitoring/MonitoringHistoryPanel";
import { Activity, Radio, BarChart3, LineChart, History } from "lucide-react";

export function MonitoringPage() {
  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Monitoring</h1>
        <p className="text-muted-foreground">
          Real-time system metrics, network analysis, and service health status.
        </p>
      </div>

      <Tabs defaultValue="jobs" className="space-y-4">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="jobs" className="gap-2">
            <Activity className="h-4 w-4" />
            Jobs
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
          <TabsTrigger value="http" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            HTTP Health
          </TabsTrigger>
          <TabsTrigger value="traffic" className="gap-2">
            <LineChart className="h-4 w-4" />
            Traffic
          </TabsTrigger>
          <TabsTrigger value="network" className="gap-2">
            <Radio className="h-4 w-4" />
            Network Telemetry
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jobs" className="space-y-4">
          <MonitorJobsPanel />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <MonitoringHistoryPanel />
        </TabsContent>

        <TabsContent value="http" className="space-y-4">
          <HttpMonitorsPanel />
        </TabsContent>

        <TabsContent value="traffic" className="space-y-4">
          <TrafficMonitorPanel />
        </TabsContent>

        <TabsContent value="network" className="space-y-4">
          <EnhancedNetworkTelemetryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
