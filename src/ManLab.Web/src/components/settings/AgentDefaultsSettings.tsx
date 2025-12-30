import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api";
import { SettingKeys } from "@/constants/settingKeys";
import { toast } from "sonner";
import { AlertTriangle, Shield, Activity, Settings, FileText, Cpu, Network, Gauge, Plus, X } from "lucide-react";

interface SystemSetting {
  key: string;
  value: string | null;
  category: string;
  description: string | null;
}

// Default values matching AgentConfiguration.cs
const DEFAULTS = {
  heartbeatIntervalSeconds: "10",
  maxReconnectDelaySeconds: "120",
  telemetryCacheSeconds: "30",
  primaryInterfaceName: "",
  enableNetworkTelemetry: "true",
  enablePingTelemetry: "true",
  enableGpuTelemetry: "true",
  enableUpsTelemetry: "true",
  // Enhanced telemetry
  enableEnhancedNetworkTelemetry: "true",
  enableEnhancedGpuTelemetry: "true",
  enableApmTelemetry: "false",
  apmHealthCheckEndpoints: "[]",
  apmDatabaseEndpoints: "[]",
  // Ping settings
  pingTarget: "",
  pingTimeoutMs: "800",
  pingWindowSize: "10",
  enableLogViewer: "false",
  enableScripts: "false",
  enableTerminal: "false",
  enableFileBrowser: "false",
  logMaxBytes: "65536",
  logMinSecondsBetweenRequests: "1",
  scriptMaxOutputBytes: "65536",
  scriptMaxDurationSeconds: "60",
  scriptMinSecondsBetweenRuns: "1",
  terminalMaxOutputBytes: "65536",
  terminalMaxDurationSeconds: "600",
  fileBrowserMaxBytes: String(2 * 1024 * 1024),
  // Agent self-logging
  agentLogFilePath: "",
  agentLogFileMaxBytes: "5242880",
  agentLogFileRetainedFiles: "3",
};

type FormValues = typeof DEFAULTS;

// Helper to parse JSON arrays safely
function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Component for managing APM health check endpoints
function ApmEndpointList({ 
  endpoints, 
  onChange, 
  placeholder 
}: { 
  endpoints: string[]; 
  onChange: (endpoints: string[]) => void;
  placeholder: string;
}) {
  const [newEndpoint, setNewEndpoint] = useState("");

  const addEndpoint = () => {
    const trimmed = newEndpoint.trim();
    if (trimmed && !endpoints.includes(trimmed)) {
      onChange([...endpoints, trimmed]);
      setNewEndpoint("");
    }
  };

  const removeEndpoint = (index: number) => {
    onChange(endpoints.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={newEndpoint}
          onChange={(e) => setNewEndpoint(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEndpoint())}
        />
        <Button type="button" variant="outline" size="icon" onClick={addEndpoint}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {endpoints.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {endpoints.map((endpoint, index) => (
            <Badge key={index} variant="secondary" className="flex items-center gap-1">
              <span className="font-mono text-xs">{endpoint}</span>
              <button
                type="button"
                onClick={() => removeEndpoint(index)}
                className="ml-1 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// Database endpoint type
interface DatabaseEndpoint {
  name: string;
  databaseType: string;
  host: string;
  port: number;
}

// Component for managing APM database endpoints
function ApmDatabaseEndpointList({ 
  endpoints, 
  onChange 
}: { 
  endpoints: DatabaseEndpoint[]; 
  onChange: (endpoints: DatabaseEndpoint[]) => void;
}) {
  const [newEndpoint, setNewEndpoint] = useState<DatabaseEndpoint>({
    name: "",
    databaseType: "PostgreSQL",
    host: "localhost",
    port: 5432
  });

  const addEndpoint = () => {
    if (newEndpoint.name.trim() && newEndpoint.host.trim()) {
      onChange([...endpoints, { ...newEndpoint, name: newEndpoint.name.trim(), host: newEndpoint.host.trim() }]);
      setNewEndpoint({ name: "", databaseType: "PostgreSQL", host: "localhost", port: 5432 });
    }
  };

  const removeEndpoint = (index: number) => {
    onChange(endpoints.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <Input
          value={newEndpoint.name}
          onChange={(e) => setNewEndpoint({ ...newEndpoint, name: e.target.value })}
          placeholder="Name"
        />
        <select
          value={newEndpoint.databaseType}
          onChange={(e) => setNewEndpoint({ ...newEndpoint, databaseType: e.target.value })}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        >
          <option value="PostgreSQL">PostgreSQL</option>
          <option value="MySQL">MySQL</option>
          <option value="SQLServer">SQL Server</option>
          <option value="MongoDB">MongoDB</option>
          <option value="Redis">Redis</option>
        </select>
        <Input
          value={newEndpoint.host}
          onChange={(e) => setNewEndpoint({ ...newEndpoint, host: e.target.value })}
          placeholder="Host"
        />
        <div className="flex gap-2">
          <Input
            type="number"
            value={newEndpoint.port}
            onChange={(e) => setNewEndpoint({ ...newEndpoint, port: parseInt(e.target.value) || 0 })}
            placeholder="Port"
            className="w-20"
          />
          <Button type="button" variant="outline" size="icon" onClick={addEndpoint}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {endpoints.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Host</th>
                <th className="px-3 py-2 text-left">Port</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((ep, index) => (
                <tr key={index} className="border-t">
                  <td className="px-3 py-2">{ep.name}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px]">{ep.databaseType}</Badge>
                  </td>
                  <td className="px-3 py-2 font-mono">{ep.host}</td>
                  <td className="px-3 py-2 font-mono">{ep.port}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeEndpoint(index)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AgentDefaultsSettings() {
  const queryClient = useQueryClient();
  
  // Local form overrides - only set when user modifies a field
  const [overrides, setOverrides] = useState<Partial<FormValues>>({});

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await api.get<SystemSetting[]>("/api/settings");
      return response.data;
    },
  });

  // Compute initial values from server settings
  const serverValues = useMemo(() => {
    if (!settings) return DEFAULTS;
    
    const get = (key: string, fallback: string) => {
      const s = settings.find((setting: SystemSetting) => setting.key === key);
      return s?.value ?? fallback;
    };

    return {
      heartbeatIntervalSeconds: get(SettingKeys.Agent.HeartbeatIntervalSeconds, DEFAULTS.heartbeatIntervalSeconds),
      maxReconnectDelaySeconds: get(SettingKeys.Agent.MaxReconnectDelaySeconds, DEFAULTS.maxReconnectDelaySeconds),
      telemetryCacheSeconds: get(SettingKeys.Agent.TelemetryCacheSeconds, DEFAULTS.telemetryCacheSeconds),
      primaryInterfaceName: get(SettingKeys.Agent.PrimaryInterfaceName, DEFAULTS.primaryInterfaceName),
      enableNetworkTelemetry: get(SettingKeys.Agent.EnableNetworkTelemetry, DEFAULTS.enableNetworkTelemetry),
      enablePingTelemetry: get(SettingKeys.Agent.EnablePingTelemetry, DEFAULTS.enablePingTelemetry),
      enableGpuTelemetry: get(SettingKeys.Agent.EnableGpuTelemetry, DEFAULTS.enableGpuTelemetry),
      enableUpsTelemetry: get(SettingKeys.Agent.EnableUpsTelemetry, DEFAULTS.enableUpsTelemetry),
      // Enhanced telemetry
      enableEnhancedNetworkTelemetry: get(SettingKeys.Agent.EnableEnhancedNetworkTelemetry, DEFAULTS.enableEnhancedNetworkTelemetry),
      enableEnhancedGpuTelemetry: get(SettingKeys.Agent.EnableEnhancedGpuTelemetry, DEFAULTS.enableEnhancedGpuTelemetry),
      enableApmTelemetry: get(SettingKeys.Agent.EnableApmTelemetry, DEFAULTS.enableApmTelemetry),
      apmHealthCheckEndpoints: get(SettingKeys.Agent.ApmHealthCheckEndpoints, DEFAULTS.apmHealthCheckEndpoints),
      apmDatabaseEndpoints: get(SettingKeys.Agent.ApmDatabaseEndpoints, DEFAULTS.apmDatabaseEndpoints),
      // Ping settings
      pingTarget: get(SettingKeys.Agent.PingTarget, DEFAULTS.pingTarget),
      pingTimeoutMs: get(SettingKeys.Agent.PingTimeoutMs, DEFAULTS.pingTimeoutMs),
      pingWindowSize: get(SettingKeys.Agent.PingWindowSize, DEFAULTS.pingWindowSize),
      enableLogViewer: get(SettingKeys.Agent.EnableLogViewer, DEFAULTS.enableLogViewer),
      enableScripts: get(SettingKeys.Agent.EnableScripts, DEFAULTS.enableScripts),
      enableTerminal: get(SettingKeys.Agent.EnableTerminal, DEFAULTS.enableTerminal),
      enableFileBrowser: get(SettingKeys.Agent.EnableFileBrowser, DEFAULTS.enableFileBrowser),
      logMaxBytes: get(SettingKeys.Agent.LogMaxBytes, DEFAULTS.logMaxBytes),
      logMinSecondsBetweenRequests: get(SettingKeys.Agent.LogMinSecondsBetweenRequests, DEFAULTS.logMinSecondsBetweenRequests),
      scriptMaxOutputBytes: get(SettingKeys.Agent.ScriptMaxOutputBytes, DEFAULTS.scriptMaxOutputBytes),
      scriptMaxDurationSeconds: get(SettingKeys.Agent.ScriptMaxDurationSeconds, DEFAULTS.scriptMaxDurationSeconds),
      scriptMinSecondsBetweenRuns: get(SettingKeys.Agent.ScriptMinSecondsBetweenRuns, DEFAULTS.scriptMinSecondsBetweenRuns),
      terminalMaxOutputBytes: get(SettingKeys.Agent.TerminalMaxOutputBytes, DEFAULTS.terminalMaxOutputBytes),
      terminalMaxDurationSeconds: get(SettingKeys.Agent.TerminalMaxDurationSeconds, DEFAULTS.terminalMaxDurationSeconds),
      fileBrowserMaxBytes: get(SettingKeys.Agent.FileBrowserMaxBytes, DEFAULTS.fileBrowserMaxBytes),
      agentLogFilePath: get(SettingKeys.Agent.AgentLogFilePath, DEFAULTS.agentLogFilePath),
      agentLogFileMaxBytes: get(SettingKeys.Agent.AgentLogFileMaxBytes, DEFAULTS.agentLogFileMaxBytes),
      agentLogFileRetainedFiles: get(SettingKeys.Agent.AgentLogFileRetainedFiles, DEFAULTS.agentLogFileRetainedFiles),
    };
  }, [settings]);

  // Merge server values with local overrides
  const values = useMemo(() => ({ ...serverValues, ...overrides }), [serverValues, overrides]);

  const updateField = useCallback(<K extends keyof FormValues>(key: K, value: string) => {
    setOverrides(prev => ({ ...prev, [key]: value }));
  }, []);

  const mutation = useMutation({
    mutationFn: async (newSettings: SystemSetting[]) => {
      await api.post("/api/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setOverrides({});
      toast.success("Agent defaults saved successfully.");
    },
    onError: (error) => {
      toast.error("Failed to save settings: " + error.message);
    }
  });

  const handleSave = () => {
    mutation.mutate([
      { key: SettingKeys.Agent.HeartbeatIntervalSeconds, value: values.heartbeatIntervalSeconds, category: "Agent", description: "Default heartbeat interval in seconds" },
      { key: SettingKeys.Agent.MaxReconnectDelaySeconds, value: values.maxReconnectDelaySeconds, category: "Agent", description: "Default max reconnect delay in seconds" },
      { key: SettingKeys.Agent.TelemetryCacheSeconds, value: values.telemetryCacheSeconds, category: "Agent", description: "How long to cache telemetry data" },
      { key: SettingKeys.Agent.PrimaryInterfaceName, value: values.primaryInterfaceName || null, category: "Agent", description: "Override for primary network interface" },
      { key: SettingKeys.Agent.EnableNetworkTelemetry, value: values.enableNetworkTelemetry, category: "Agent", description: "Enable network throughput monitoring" },
      { key: SettingKeys.Agent.EnablePingTelemetry, value: values.enablePingTelemetry, category: "Agent", description: "Enable ping latency monitoring" },
      { key: SettingKeys.Agent.EnableGpuTelemetry, value: values.enableGpuTelemetry, category: "Agent", description: "Enable GPU monitoring" },
      { key: SettingKeys.Agent.EnableUpsTelemetry, value: values.enableUpsTelemetry, category: "Agent", description: "Enable UPS monitoring" },
      // Enhanced telemetry
      { key: SettingKeys.Agent.EnableEnhancedNetworkTelemetry, value: values.enableEnhancedNetworkTelemetry, category: "Agent", description: "Enable enhanced network telemetry with per-interface stats" },
      { key: SettingKeys.Agent.EnableEnhancedGpuTelemetry, value: values.enableEnhancedGpuTelemetry, category: "Agent", description: "Enable enhanced GPU telemetry with power and clocks" },
      { key: SettingKeys.Agent.EnableApmTelemetry, value: values.enableApmTelemetry, category: "Agent", description: "Enable Application Performance Monitoring" },
      { key: SettingKeys.Agent.ApmHealthCheckEndpoints, value: values.apmHealthCheckEndpoints, category: "Agent", description: "Health check endpoint URLs for APM" },
      { key: SettingKeys.Agent.ApmDatabaseEndpoints, value: values.apmDatabaseEndpoints, category: "Agent", description: "Database endpoints for APM monitoring" },
      // Ping settings
      { key: SettingKeys.Agent.PingTarget, value: values.pingTarget || null, category: "Agent", description: "Custom ping target hostname/IP" },
      { key: SettingKeys.Agent.PingTimeoutMs, value: values.pingTimeoutMs, category: "Agent", description: "Ping timeout in milliseconds" },
      { key: SettingKeys.Agent.PingWindowSize, value: values.pingWindowSize, category: "Agent", description: "Rolling window size for ping samples" },
      { key: SettingKeys.Agent.EnableLogViewer, value: values.enableLogViewer, category: "Agent", description: "Enable remote log viewer" },
      { key: SettingKeys.Agent.EnableScripts, value: values.enableScripts, category: "Agent", description: "Enable remote script execution" },
      { key: SettingKeys.Agent.EnableTerminal, value: values.enableTerminal, category: "Agent", description: "Enable remote terminal access" },
      { key: SettingKeys.Agent.EnableFileBrowser, value: values.enableFileBrowser, category: "Agent", description: "Enable remote file browser" },
      { key: SettingKeys.Agent.LogMaxBytes, value: values.logMaxBytes, category: "Agent", description: "Maximum bytes for log reads" },
      { key: SettingKeys.Agent.LogMinSecondsBetweenRequests, value: values.logMinSecondsBetweenRequests, category: "Agent", description: "Minimum seconds between log requests" },
      { key: SettingKeys.Agent.ScriptMaxOutputBytes, value: values.scriptMaxOutputBytes, category: "Agent", description: "Maximum bytes for script output" },
      { key: SettingKeys.Agent.ScriptMaxDurationSeconds, value: values.scriptMaxDurationSeconds, category: "Agent", description: "Maximum script runtime in seconds" },
      { key: SettingKeys.Agent.ScriptMinSecondsBetweenRuns, value: values.scriptMinSecondsBetweenRuns, category: "Agent", description: "Minimum seconds between script runs" },
      { key: SettingKeys.Agent.TerminalMaxOutputBytes, value: values.terminalMaxOutputBytes, category: "Agent", description: "Maximum bytes for terminal output" },
      { key: SettingKeys.Agent.TerminalMaxDurationSeconds, value: values.terminalMaxDurationSeconds, category: "Agent", description: "Maximum terminal session duration" },
      { key: SettingKeys.Agent.FileBrowserMaxBytes, value: values.fileBrowserMaxBytes, category: "Agent", description: "Maximum bytes for file reads" },
      { key: SettingKeys.Agent.AgentLogFilePath, value: values.agentLogFilePath || null, category: "Agent", description: "Path to agent self-log file" },
      { key: SettingKeys.Agent.AgentLogFileMaxBytes, value: values.agentLogFileMaxBytes, category: "Agent", description: "Max agent log file size before rotation" },
      { key: SettingKeys.Agent.AgentLogFileRetainedFiles, value: values.agentLogFileRetainedFiles, category: "Agent", description: "Number of rotated agent log files to keep" },
    ]);
  };

  const hasRemoteToolsEnabled = values.enableLogViewer === "true" || values.enableScripts === "true" || values.enableTerminal === "true" || values.enableFileBrowser === "true";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Agent Defaults
        </CardTitle>
        <CardDescription>
          Configure default settings for new agent installations. These values are used when installing agents via the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Connection Settings */}
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4" />
            Connection
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="heartbeat">Heartbeat Interval (Seconds)</Label>
              <Input
                id="heartbeat"
                type="number"
                min={5}
                max={300}
                value={values.heartbeatIntervalSeconds}
                onChange={(e) => updateField("heartbeatIntervalSeconds", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reconnect">Max Reconnect Delay (Seconds)</Label>
              <Input
                id="reconnect"
                type="number"
                min={10}
                max={600}
                value={values.maxReconnectDelaySeconds}
                onChange={(e) => updateField("maxReconnectDelaySeconds", e.target.value)}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Telemetry Settings */}
        <div>
          <h4 className="text-sm font-medium mb-3">Telemetry</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="grid gap-2">
              <Label htmlFor="telemetryCache">Cache Duration (Seconds)</Label>
              <Input
                id="telemetryCache"
                type="number"
                min={5}
                max={300}
                value={values.telemetryCacheSeconds}
                onChange={(e) => updateField("telemetryCacheSeconds", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="primaryInterface">Primary Interface Name</Label>
              <Input
                id="primaryInterface"
                type="text"
                placeholder="Auto-detect"
                value={values.primaryInterfaceName}
                onChange={(e) => updateField("primaryInterfaceName", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="enableNetwork">Network</Label>
              <Switch id="enableNetwork" checked={values.enableNetworkTelemetry === "true"} onCheckedChange={(c) => updateField("enableNetworkTelemetry", String(c))} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="enablePing">Ping</Label>
              <Switch id="enablePing" checked={values.enablePingTelemetry === "true"} onCheckedChange={(c) => updateField("enablePingTelemetry", String(c))} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="enableGpu">GPU</Label>
              <Switch id="enableGpu" checked={values.enableGpuTelemetry === "true"} onCheckedChange={(c) => updateField("enableGpuTelemetry", String(c))} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="enableUps">UPS</Label>
              <Switch id="enableUps" checked={values.enableUpsTelemetry === "true"} onCheckedChange={(c) => updateField("enableUpsTelemetry", String(c))} />
            </div>
          </div>
        </div>

        <Separator />

        {/* Enhanced Telemetry Settings */}
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3">
            <Gauge className="h-4 w-4" />
            Enhanced Telemetry
          </h4>
          <p className="text-xs text-muted-foreground mb-4">
            Enhanced telemetry provides detailed metrics including per-interface network stats, GPU power/clocks, and application performance monitoring.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-muted-foreground" />
                <div>
                  <Label htmlFor="enableEnhancedNetwork">Enhanced Network</Label>
                  <p className="text-xs text-muted-foreground">Per-interface stats, connections</p>
                </div>
              </div>
              <Switch 
                id="enableEnhancedNetwork" 
                checked={values.enableEnhancedNetworkTelemetry === "true"} 
                onCheckedChange={(c) => updateField("enableEnhancedNetworkTelemetry", String(c))} 
              />
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                <div>
                  <Label htmlFor="enableEnhancedGpu">Enhanced GPU</Label>
                  <p className="text-xs text-muted-foreground">Power, clocks, processes</p>
                </div>
              </div>
              <Switch 
                id="enableEnhancedGpu" 
                checked={values.enableEnhancedGpuTelemetry === "true"} 
                onCheckedChange={(c) => updateField("enableEnhancedGpuTelemetry", String(c))} 
              />
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <div>
                  <Label htmlFor="enableApm">APM Telemetry</Label>
                  <p className="text-xs text-muted-foreground">App & database metrics</p>
                </div>
              </div>
              <Switch 
                id="enableApm" 
                checked={values.enableApmTelemetry === "true"} 
                onCheckedChange={(c) => updateField("enableApmTelemetry", String(c))} 
              />
            </div>
          </div>

          {/* APM Configuration (shown when APM is enabled) */}
          {values.enableApmTelemetry === "true" && (
            <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
              <h5 className="text-sm font-medium">APM Configuration</h5>
              
              {/* Health Check Endpoints */}
              <div className="space-y-2">
                <Label>Health Check Endpoints</Label>
                <p className="text-xs text-muted-foreground">
                  URLs to monitor for application health (e.g., http://localhost:8080/health)
                </p>
                <ApmEndpointList
                  endpoints={parseJsonArray(values.apmHealthCheckEndpoints)}
                  onChange={(endpoints) => updateField("apmHealthCheckEndpoints", JSON.stringify(endpoints))}
                  placeholder="http://localhost:8080/health"
                />
              </div>

              {/* Database Endpoints */}
              <div className="space-y-2">
                <Label>Database Endpoints</Label>
                <p className="text-xs text-muted-foreground">
                  Database connections to monitor for performance metrics
                </p>
                <ApmDatabaseEndpointList
                  endpoints={parseJsonArray(values.apmDatabaseEndpoints)}
                  onChange={(endpoints) => updateField("apmDatabaseEndpoints", JSON.stringify(endpoints))}
                />
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Ping Settings */}
        <div>
          <h4 className="text-sm font-medium mb-3">Ping Configuration</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pingTarget">Ping Target</Label>
              <Input
                id="pingTarget"
                type="text"
                placeholder="Default gateway"
                value={values.pingTarget}
                onChange={(e) => updateField("pingTarget", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pingTimeout">Timeout (ms)</Label>
              <Input
                id="pingTimeout"
                type="number"
                min={100}
                max={5000}
                value={values.pingTimeoutMs}
                onChange={(e) => updateField("pingTimeoutMs", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pingWindow">Window Size</Label>
              <Input
                id="pingWindow"
                type="number"
                min={5}
                max={100}
                value={values.pingWindowSize}
                onChange={(e) => updateField("pingWindowSize", e.target.value)}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Remote Tools */}
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4" />
            Remote Tools
          </h4>
          {hasRemoteToolsEnabled && (
            <Alert className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Security Warning:</strong> Remote tools allow administrators to execute commands and view/modify files on agent machines.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label htmlFor="enableLogViewer">Log Viewer</Label>
                <p className="text-xs text-muted-foreground">View log files</p>
              </div>
              <Switch id="enableLogViewer" checked={values.enableLogViewer === "true"} onCheckedChange={(c) => updateField("enableLogViewer", String(c))} />
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label htmlFor="enableScripts">Scripts</Label>
                <p className="text-xs text-muted-foreground">Execute scripts</p>
              </div>
              <Switch id="enableScripts" checked={values.enableScripts === "true"} onCheckedChange={(c) => updateField("enableScripts", String(c))} />
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label htmlFor="enableTerminal">Terminal</Label>
                <p className="text-xs text-muted-foreground">Shell access</p>
              </div>
              <Switch id="enableTerminal" checked={values.enableTerminal === "true"} onCheckedChange={(c) => updateField("enableTerminal", String(c))} />
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <Label htmlFor="enableFileBrowser">File Browser</Label>
                <p className="text-xs text-muted-foreground">Browse and read files</p>
              </div>
              <Switch id="enableFileBrowser" checked={values.enableFileBrowser === "true"} onCheckedChange={(c) => updateField("enableFileBrowser", String(c))} />
            </div>
          </div>
        </div>

        <Separator />

        {/* Rate Limits */}
        <div>
          <h4 className="text-sm font-medium mb-3">Rate Limits & Bounds</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="logMaxBytes">Log Max Bytes</Label>
              <Input id="logMaxBytes" type="number" value={values.logMaxBytes} onChange={(e) => updateField("logMaxBytes", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="scriptMaxBytes">Script Max Output</Label>
              <Input id="scriptMaxBytes" type="number" value={values.scriptMaxOutputBytes} onChange={(e) => updateField("scriptMaxOutputBytes", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="scriptMaxDuration">Script Max Duration (s)</Label>
              <Input id="scriptMaxDuration" type="number" value={values.scriptMaxDurationSeconds} onChange={(e) => updateField("scriptMaxDurationSeconds", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="terminalMaxBytes">Terminal Max Output</Label>
              <Input id="terminalMaxBytes" type="number" value={values.terminalMaxOutputBytes} onChange={(e) => updateField("terminalMaxOutputBytes", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="terminalMaxDuration">Terminal Max Duration (s)</Label>
              <Input id="terminalMaxDuration" type="number" value={values.terminalMaxDurationSeconds} onChange={(e) => updateField("terminalMaxDurationSeconds", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fileBrowserMaxBytes">File Browser Max Bytes</Label>
              <Input id="fileBrowserMaxBytes" type="number" min={1} value={values.fileBrowserMaxBytes} onChange={(e) => updateField("fileBrowserMaxBytes", e.target.value)} />
            </div>
          </div>
        </div>

        <Separator />

        {/* Agent Self-Logging */}
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4" />
            Agent Logging
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            Configure how the agent logs its own activity. Leave path empty for OS-specific default location.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="grid gap-2 md:col-span-3">
              <Label htmlFor="agentLogFilePath">Log File Path</Label>
              <Input
                id="agentLogFilePath"
                type="text"
                placeholder="Auto-detect (e.g. %LocalAppData%\ManLab\Logs)"
                value={values.agentLogFilePath}
                onChange={(e) => updateField("agentLogFilePath", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agentLogMaxBytes">Max File Size (bytes)</Label>
              <Input
                id="agentLogMaxBytes"
                type="number"
                min={1024}
                value={values.agentLogFileMaxBytes}
                onChange={(e) => updateField("agentLogFileMaxBytes", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agentLogRetainedFiles">Retained Files</Label>
              <Input
                id="agentLogRetainedFiles"
                type="number"
                min={1}
                max={10}
                value={values.agentLogFileRetainedFiles}
                onChange={(e) => updateField("agentLogFileRetainedFiles", e.target.value)}
              />
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
