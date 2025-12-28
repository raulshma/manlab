import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/api";
import { SettingKeys } from "@/constants/settingKeys";
import { toast } from "sonner";
import { AlertTriangle, Shield, Activity, Settings } from "lucide-react";

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
  pingTarget: "",
  pingTimeoutMs: "800",
  pingWindowSize: "10",
  enableLogViewer: "false",
  enableScripts: "false",
  enableTerminal: "false",
  logMaxBytes: "65536",
  logMinSecondsBetweenRequests: "1",
  scriptMaxOutputBytes: "65536",
  scriptMaxDurationSeconds: "60",
  scriptMinSecondsBetweenRuns: "1",
  terminalMaxOutputBytes: "65536",
  terminalMaxDurationSeconds: "600",
};

type FormValues = typeof DEFAULTS;

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
      pingTarget: get(SettingKeys.Agent.PingTarget, DEFAULTS.pingTarget),
      pingTimeoutMs: get(SettingKeys.Agent.PingTimeoutMs, DEFAULTS.pingTimeoutMs),
      pingWindowSize: get(SettingKeys.Agent.PingWindowSize, DEFAULTS.pingWindowSize),
      enableLogViewer: get(SettingKeys.Agent.EnableLogViewer, DEFAULTS.enableLogViewer),
      enableScripts: get(SettingKeys.Agent.EnableScripts, DEFAULTS.enableScripts),
      enableTerminal: get(SettingKeys.Agent.EnableTerminal, DEFAULTS.enableTerminal),
      logMaxBytes: get(SettingKeys.Agent.LogMaxBytes, DEFAULTS.logMaxBytes),
      logMinSecondsBetweenRequests: get(SettingKeys.Agent.LogMinSecondsBetweenRequests, DEFAULTS.logMinSecondsBetweenRequests),
      scriptMaxOutputBytes: get(SettingKeys.Agent.ScriptMaxOutputBytes, DEFAULTS.scriptMaxOutputBytes),
      scriptMaxDurationSeconds: get(SettingKeys.Agent.ScriptMaxDurationSeconds, DEFAULTS.scriptMaxDurationSeconds),
      scriptMinSecondsBetweenRuns: get(SettingKeys.Agent.ScriptMinSecondsBetweenRuns, DEFAULTS.scriptMinSecondsBetweenRuns),
      terminalMaxOutputBytes: get(SettingKeys.Agent.TerminalMaxOutputBytes, DEFAULTS.terminalMaxOutputBytes),
      terminalMaxDurationSeconds: get(SettingKeys.Agent.TerminalMaxDurationSeconds, DEFAULTS.terminalMaxDurationSeconds),
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
      { key: SettingKeys.Agent.PingTarget, value: values.pingTarget || null, category: "Agent", description: "Custom ping target hostname/IP" },
      { key: SettingKeys.Agent.PingTimeoutMs, value: values.pingTimeoutMs, category: "Agent", description: "Ping timeout in milliseconds" },
      { key: SettingKeys.Agent.PingWindowSize, value: values.pingWindowSize, category: "Agent", description: "Rolling window size for ping samples" },
      { key: SettingKeys.Agent.EnableLogViewer, value: values.enableLogViewer, category: "Agent", description: "Enable remote log viewer" },
      { key: SettingKeys.Agent.EnableScripts, value: values.enableScripts, category: "Agent", description: "Enable remote script execution" },
      { key: SettingKeys.Agent.EnableTerminal, value: values.enableTerminal, category: "Agent", description: "Enable remote terminal access" },
      { key: SettingKeys.Agent.LogMaxBytes, value: values.logMaxBytes, category: "Agent", description: "Maximum bytes for log reads" },
      { key: SettingKeys.Agent.LogMinSecondsBetweenRequests, value: values.logMinSecondsBetweenRequests, category: "Agent", description: "Minimum seconds between log requests" },
      { key: SettingKeys.Agent.ScriptMaxOutputBytes, value: values.scriptMaxOutputBytes, category: "Agent", description: "Maximum bytes for script output" },
      { key: SettingKeys.Agent.ScriptMaxDurationSeconds, value: values.scriptMaxDurationSeconds, category: "Agent", description: "Maximum script runtime in seconds" },
      { key: SettingKeys.Agent.ScriptMinSecondsBetweenRuns, value: values.scriptMinSecondsBetweenRuns, category: "Agent", description: "Minimum seconds between script runs" },
      { key: SettingKeys.Agent.TerminalMaxOutputBytes, value: values.terminalMaxOutputBytes, category: "Agent", description: "Maximum bytes for terminal output" },
      { key: SettingKeys.Agent.TerminalMaxDurationSeconds, value: values.terminalMaxDurationSeconds, category: "Agent", description: "Maximum terminal session duration" },
    ]);
  };

  const hasRemoteToolsEnabled = values.enableLogViewer === "true" || values.enableScripts === "true" || values.enableTerminal === "true";

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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
