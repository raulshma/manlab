/**
 * NetworkSettings Component
 * Centralized settings panel for network scanning tools.
 * Allows users to configure default scan parameters, real-time updates,
 * and notification preferences.
 */

import { useEffect, useCallback, useMemo } from "react";
import { useConfirm } from "@/hooks/useConfirm";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useStore } from "@tanstack/react-form";
import {
  Network,
  RotateCcw,
  Save,
  Clock,
  Zap,
  RefreshCcw,
  Bell,
  Radio,
  Search,
  Server,
  Radar,
  Route,
  Wifi,
  Gauge,
  Power,
  Share2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { api } from "@/api";
import {
  subscribeRealtimePreference,
  subscribeNotificationPreference,
} from "@/lib/network-preferences";
import {
  DEFAULT_NETWORK_PREFERENCES,
  applyNetworkSettingsToStorage,
  buildNetworkSettingsPayload,
  loadNetworkPreferences,
  saveNetworkPreferences,
  type NetworkPreferences,
  type SystemSetting,
} from "@/lib/network-settings";

// ============================================================================
// Component
// ============================================================================

export function NetworkSettings() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await api.get<SystemSetting[]>("/api/settings");
      return response.data;
    },
  });

  const serverValues = useMemo<NetworkPreferences>(() => {
    return loadNetworkPreferences(settings);
  }, [settings]);

  const mutation = useMutation({
    mutationFn: async (newSettings: SystemSetting[]) => {
      await api.post("/api/settings", newSettings);
    },
  });

  const form = useForm({
    defaultValues: serverValues,
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(buildNetworkSettingsPayload(value));
        queryClient.invalidateQueries({ queryKey: ["settings"] });
        saveNetworkPreferences(value);
        toast.success("Network settings saved successfully");
      } catch (error) {
        toast.error("Failed to save settings: " + (error as Error).message);
      }
    },
  });

  const values = useStore(form.store, (state) => state.values);
  const hasChanges = useMemo(() => JSON.stringify(values) !== JSON.stringify(serverValues), [values, serverValues]);
  const isSaving = mutation.isPending;

  // Subscribe to real-time preference changes
  useEffect(() => {
    const unsubscribeRealtime = subscribeRealtimePreference((enabled) => {
      form.setFieldValue("realtimeEnabled", enabled);
    });
    const unsubscribeNotifications = subscribeNotificationPreference((enabled) => {
      form.setFieldValue("notificationsEnabled", enabled);
    });
    return () => {
      unsubscribeRealtime();
      unsubscribeNotifications();
    };
  }, [form]);

  useEffect(() => {
    if (!settings) return;
    form.reset(serverValues);
    applyNetworkSettingsToStorage(settings);
  }, [form, settings, serverValues]);

  const handleSave = useCallback(() => {
    form.handleSubmit();
  }, [form]);

  const handleReset = useCallback(async () => {
    const confirmed = await confirm({
      title: "Reset Network Settings",
      description: "Reset all network settings to defaults? This cannot be undone.",
      confirmText: "Reset",
      cancelText: "Cancel",
      destructive: true,
    });
    if (!confirmed) return;

    const defaults = DEFAULT_NETWORK_PREFERENCES;
    mutation.mutate(buildNetworkSettingsPayload(defaults), {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["settings"] });
        form.reset(defaults);
        saveNetworkPreferences(defaults);
        toast.success("Network settings reset to defaults");
      },
      onError: (error) => {
        toast.error("Failed to reset settings: " + error.message);
      },
    });
  }, [form, mutation, queryClient, confirm]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="h-5 w-5" />
          Network Tools
        </CardTitle>
        <CardDescription>
          Configure default settings for network scanning and discovery tools.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Global Settings Section */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" />
            Global Settings
          </h4>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="realtime-switch" className="text-sm font-medium">
                  Real-time Updates
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable live scan progress via WebSocket
                </p>
              </div>
              <form.Field name="realtimeEnabled">
                {(field) => (
                  <Switch
                    id="realtime-switch"
                    checked={field.state.value}
                    onCheckedChange={field.handleChange}
                  />
                )}
              </form.Field>
            </div>
            
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="notifications-switch" className="text-sm font-medium flex items-center gap-1">
                  <Bell className="h-3.5 w-3.5" />
                  Notifications
                </Label>
                <p className="text-xs text-muted-foreground">
                  Show toast notifications for scan events
                </p>
              </div>
              <form.Field name="notificationsEnabled">
                {(field) => (
                  <Switch
                    id="notifications-switch"
                    checked={field.state.value}
                    onCheckedChange={field.handleChange}
                  />
                )}
              </form.Field>
            </div>
          </div>
        </div>

        <Separator />

        {/* Tool-Specific Settings */}
        <Accordion className="w-full" defaultValue={["ping", "subnet"]}>
          {/* Ping Settings */}
          <AccordionItem value="ping">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                <span>Ping Tool</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Default Host
                  </Label>
                  <form.Field name="pingHost">
                    {(field) => (
                      <Input
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="e.g., 8.8.8.8 or example.com"
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Pre-fill the ping target
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Default Timeout
                    </Label>
                    <form.Subscribe
                      selector={(state) => state.values.pingTimeout}
                    >
                      {(pingTimeout) => (
                        <span className="text-sm font-medium">{pingTimeout}ms</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="pingTimeout">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={100}
                        max={5000}
                        step={100}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    How long to wait for a ping response (100ms - 5000ms)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Subnet Scanner Settings */}
          <AccordionItem value="subnet">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                <span>Subnet Scanner</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Network className="h-3.5 w-3.5" />
                    Default Subnet
                  </Label>
                  <form.Field name="lastSubnet">
                    {(field) => (
                      <Input
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="e.g., 192.168.1.0/24"
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Remember the last scanned subnet
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      Concurrency
                    </Label>
                    <form.Subscribe selector={(state) => state.values.subnetConcurrency}>
                      {(subnetConcurrency) => (
                        <span className="text-sm font-medium">{subnetConcurrency}</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="subnetConcurrency">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={10}
                        max={500}
                        step={10}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Number of parallel ping requests (10 - 500)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Timeout
                    </Label>
                    <form.Subscribe selector={(state) => state.values.subnetTimeout}>
                      {(subnetTimeout) => (
                        <span className="text-sm font-medium">{subnetTimeout}ms</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="subnetTimeout">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={100}
                        max={2000}
                        step={100}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Per-host timeout for subnet scans (100ms - 2000ms)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Port Scanner Settings */}
          <AccordionItem value="ports">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                <span>Port Scanner</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Default Host
                  </Label>
                  <form.Field name="portHost">
                    {(field) => (
                      <Input
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="e.g., 192.168.1.10"
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Pre-fill the scan target
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      Concurrency
                    </Label>
                    <form.Subscribe selector={(state) => state.values.portConcurrency}>
                      {(portConcurrency) => (
                        <span className="text-sm font-medium">{portConcurrency}</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="portConcurrency">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={10}
                        max={200}
                        step={10}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Number of parallel port connections (10 - 200)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Timeout
                    </Label>
                    <form.Subscribe selector={(state) => state.values.portTimeout}>
                      {(portTimeout) => (
                        <span className="text-sm font-medium">{portTimeout}ms</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="portTimeout">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={500}
                        max={10000}
                        step={500}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Connection timeout per port (500ms - 10000ms)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Traceroute Settings */}
          <AccordionItem value="traceroute">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-primary" />
                <span>Traceroute</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Default Host
                  </Label>
                  <form.Field name="tracerouteHost">
                    {(field) => (
                      <Input
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="e.g., 1.1.1.1"
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Pre-fill the traceroute target
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      Max Hops
                    </Label>
                    <form.Subscribe selector={(state) => state.values.tracerouteMaxHops}>
                      {(tracerouteMaxHops) => (
                        <span className="text-sm font-medium">{tracerouteMaxHops}</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="tracerouteMaxHops">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={5}
                        max={64}
                        step={1}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Maximum number of network hops to trace (5 - 64)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Timeout
                    </Label>
                    <form.Subscribe selector={(state) => state.values.tracerouteTimeout}>
                      {(tracerouteTimeout) => (
                        <span className="text-sm font-medium">{tracerouteTimeout}ms</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="tracerouteTimeout">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={500}
                        max={5000}
                        step={100}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Timeout per hop (500ms - 5000ms)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Device Discovery Settings */}
          <AccordionItem value="discovery">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-primary" />
                <span>Device Discovery</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Discovery Mode
                  </Label>
                  <form.Field name="discoveryMode">
                    {(field) => (
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value as NetworkPreferences["discoveryMode"])}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="both">mDNS + UPnP</SelectItem>
                          <SelectItem value="mdns">mDNS Only</SelectItem>
                          <SelectItem value="upnp">UPnP Only</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Choose which protocols to listen for
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Scan Duration
                    </Label>
                    <form.Subscribe selector={(state) => state.values.discoveryDuration}>
                      {(discoveryDuration) => (
                        <span className="text-sm font-medium">{discoveryDuration}s</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="discoveryDuration">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={1}
                        max={30}
                        step={1}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    How long to listen for mDNS/UPnP devices (1s - 30s)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* WiFi Scanner Settings */}
          <AccordionItem value="wifi">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-primary" />
                <span>WiFi Scanner</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Preferred Adapter
                  </Label>
                  <form.Field name="wifiAdapter">
                    {(field) => (
                      <Input
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Adapter name (optional)"
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Used when multiple WiFi adapters are available
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Band Filter</Label>
                    <form.Field name="wifiBand">
                      {(field) => (
                        <Select
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value as NetworkPreferences["wifiBand"])}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Bands</SelectItem>
                            <SelectItem value="2.4">2.4 GHz</SelectItem>
                            <SelectItem value="5">5 GHz</SelectItem>
                            <SelectItem value="6">6 GHz</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </form.Field>
                  </div>
                  <div className="space-y-2">
                    <Label>Security Filter</Label>
                    <form.Field name="wifiSecurity">
                      {(field) => (
                        <Select
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value as NetworkPreferences["wifiSecurity"])}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Networks</SelectItem>
                            <SelectItem value="secured">Secured</SelectItem>
                            <SelectItem value="open">Open</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </form.Field>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Wake-on-LAN Settings */}
          <AccordionItem value="wol">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4 text-primary" />
                <span>Wake-on-LAN</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Default MAC Address</Label>
                  <form.Field name="wolMac">
                    {(field) => (
                      <Input
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="AA:BB:CC:DD:EE:FF"
                      />
                    )}
                  </form.Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Broadcast Address</Label>
                    <form.Field name="wolBroadcast">
                      {(field) => (
                        <Input
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="255.255.255.255"
                        />
                      )}
                    </form.Field>
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <form.Field name="wolPort">
                      {(field) => (
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          value={field.state.value}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            field.handleChange(Number.isFinite(next) ? next : DEFAULT_NETWORK_PREFERENCES.wolPort);
                          }}
                        />
                      )}
                    </form.Field>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Speed Test Settings */}
          <AccordionItem value="speedtest">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-primary" />
                <span>Speed Test</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Download Payload</Label>
                    <form.Subscribe selector={(state) => state.values.speedtestDownloadMb}>
                      {(speedtestDownloadMb) => (
                        <span className="text-sm font-medium">{speedtestDownloadMb} MB</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="speedtestDownloadMb">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={1}
                        max={100}
                        step={1}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Size of the download test payload
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Upload Payload</Label>
                    <form.Subscribe selector={(state) => state.values.speedtestUploadMb}>
                      {(speedtestUploadMb) => (
                        <span className="text-sm font-medium">{speedtestUploadMb} MB</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="speedtestUploadMb">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={1}
                        max={100}
                        step={1}
                      />
                    )}
                  </form.Field>
                  <p className="text-xs text-muted-foreground">
                    Size of the upload test payload
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Latency Samples</Label>
                    <form.Subscribe selector={(state) => state.values.speedtestLatencySamples}>
                      {(speedtestLatencySamples) => (
                        <span className="text-sm font-medium">{speedtestLatencySamples}</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="speedtestLatencySamples">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={1}
                        max={10}
                        step={1}
                      />
                    )}
                  </form.Field>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Network Topology Settings */}
          <AccordionItem value="topology">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-primary" />
                <span>Topology Map</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Default CIDR</Label>
                  <form.Field name="topologyCidr">
                    {(field) => (
                      <Input
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="e.g., 192.168.0.0/24"
                      />
                    )}
                  </form.Field>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Concurrency</Label>
                    <form.Subscribe selector={(state) => state.values.topologyConcurrency}>
                      {(topologyConcurrency) => (
                        <span className="text-sm font-medium">{topologyConcurrency}</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="topologyConcurrency">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={10}
                        max={500}
                        step={10}
                      />
                    )}
                  </form.Field>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Timeout</Label>
                    <form.Subscribe selector={(state) => state.values.topologyTimeout}>
                      {(topologyTimeout) => (
                        <span className="text-sm font-medium">{topologyTimeout}ms</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="topologyTimeout">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={200}
                        max={2000}
                        step={50}
                      />
                    )}
                  </form.Field>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">
                      Include Discovery
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Add mDNS/UPnP nodes to the topology map
                    </p>
                  </div>
                  <form.Field name="topologyIncludeDiscovery">
                    {(field) => (
                      <Switch
                        checked={field.state.value}
                        onCheckedChange={field.handleChange}
                      />
                    )}
                  </form.Field>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Discovery Duration</Label>
                    <form.Subscribe selector={(state) => state.values.topologyDiscoveryDuration}>
                      {(topologyDiscoveryDuration) => (
                        <span className="text-sm font-medium">{topologyDiscoveryDuration}s</span>
                      )}
                    </form.Subscribe>
                  </div>
                  <form.Field name="topologyDiscoveryDuration">
                    {(field) => (
                      <Slider
                        value={[field.state.value]}
                        onValueChange={(v) => field.handleChange(Array.isArray(v) ? v[0] : v)}
                        min={1}
                        max={30}
                        step={1}
                      />
                    )}
                  </form.Field>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
      <CardFooter className="flex justify-between gap-4 border-t pt-6">
        <Button
          variant="outline"
          onClick={handleReset}
          className="gap-1.5"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to Defaults
        </Button>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
