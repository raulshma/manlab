import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Server, Terminal, Shield, Monitor, HardDrive, Key, AlertTriangle, ChevronDown, ChevronRight, History, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  fetchNode,
  fetchOnboardingMachineForNode,
  fetchSuggestedServerBaseUrl,
  installAgent,
  updateMachineConfiguration,
  fetchNodeSettings,
  fetchAuditEvents,
} from "@/api";
import { useSignalR } from "@/SignalRContext";
import { AgentVersionPicker, type AgentVersionSelection } from "@/components/AgentVersionPicker";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export function NodeUpdatePage() {
  const { id: nodeId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { connection } = useSignalR();

  // 1. Fetch Node Basics
  const { data: node, isLoading: nodeLoading } = useQuery({
    queryKey: ["node", nodeId],
    queryFn: () => fetchNode(nodeId!),
    enabled: !!nodeId,
  });

  // 2. Fetch Node Settings (for channel)
  const { data: nodeSettings } = useQuery({
    queryKey: ["nodeSettings", nodeId],
    queryFn: () => fetchNodeSettings(nodeId!),
    enabled: !!nodeId,
  });
  const currentChannel = nodeSettings?.find((s) => s.key === "agent.update.channel")?.value ?? "stable";

  // 3. Fetch Machine Info (moved up for history dependency)
  const machineQuery = useQuery({
    queryKey: ["onboardingMachineForNode", nodeId],
    queryFn: () => fetchOnboardingMachineForNode(nodeId!),
    retry: false,
    enabled: !!nodeId,
  });
  const machine = machineQuery.data ?? null;

  // 4. Fetch Update History (via durable audit events)
  // Keep this aligned with the history shown in the Node Settings tab.
  const historyQuery = useQuery({
    queryKey: ["nodeAgentUpdateHistory", nodeId],
    queryFn: async () => {
      const events = await fetchAuditEvents({
        nodeId: nodeId!,
        category: "agents",
        take: 200,
      });

      return events
        .filter((e) => e.eventName === "agent.update.start" || e.eventName === "agent.update.completed")
        .sort((a, b) => new Date(a.timestampUtc).getTime() - new Date(b.timestampUtc).getTime());
    },
    enabled: !!nodeId,
    staleTime: 10_000,
  });

  type UpdateAttempt = {
    id: string;
    startedAtUtc: string;
    completedAtUtc?: string;
    success?: boolean | null;
    actorName?: string | null;
    machineId?: string | null;
    agentSource?: string | null;
    agentChannel?: string | null;
    agentVersion?: string | null;
    reportedAgentVersion?: string | null;
    error?: string | null;
  };

  const history: UpdateAttempt[] = useMemo(() => {
    const events = historyQuery.data ?? [];
    const starts = events.filter((e) => e.eventName === "agent.update.start");
    const completeds = events.filter((e) => e.eventName === "agent.update.completed");

    const parseData = (dataJson: string | null) => {
      if (!dataJson) return {} as Record<string, unknown>;
      try {
        return JSON.parse(dataJson) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    };

    const usedCompleted = new Set<string>();
    const attempts: UpdateAttempt[] = [];

    for (const s of starts) {
      const sData = parseData(s.dataJson);
      const sMachineId = s.machineId;
      const startTs = s.timestampUtc;

      let match: (typeof completeds)[number] | undefined;
      for (const c of completeds) {
        if (usedCompleted.has(c.id)) continue;
        if (sMachineId && c.machineId && c.machineId !== sMachineId) continue;
        if (new Date(c.timestampUtc).getTime() < new Date(startTs).getTime()) continue;
        match = c;
        break;
      }

      if (match) {
        usedCompleted.add(match.id);
      }

      const cData = match ? parseData(match.dataJson) : {};
      const agentSource = (cData.agentSource ?? sData.agentSource) as string | undefined;
      const agentChannel = (cData.agentChannel ?? sData.agentChannel) as string | undefined;
      const agentVersion = (cData.agentVersion ?? sData.agentVersion) as string | undefined;
      const reportedAgentVersion = (cData.reportedAgentVersion as string | undefined) ?? undefined;

      attempts.push({
        id: s.id,
        startedAtUtc: startTs,
        completedAtUtc: match?.timestampUtc,
        success: match?.success,
        actorName: s.actorName ?? match?.actorName,
        machineId: sMachineId ?? match?.machineId,
        agentSource: agentSource ?? null,
        agentChannel: agentChannel ?? null,
        agentVersion: agentVersion ?? null,
        reportedAgentVersion: reportedAgentVersion ?? null,
        error: match?.error ?? null,
      });
    }

    for (const c of completeds) {
      if (usedCompleted.has(c.id)) continue;
      const cData = parseData(c.dataJson);
      attempts.push({
        id: c.id,
        startedAtUtc: c.timestampUtc,
        completedAtUtc: c.timestampUtc,
        success: c.success,
        actorName: c.actorName,
        machineId: c.machineId,
        agentSource: (cData.agentSource as string | undefined) ?? null,
        agentChannel: (cData.agentChannel as string | undefined) ?? null,
        agentVersion: (cData.agentVersion as string | undefined) ?? null,
        reportedAgentVersion: (cData.reportedAgentVersion as string | undefined) ?? null,
        error: c.error,
      });
    }

    return attempts.sort((a, b) => new Date(b.startedAtUtc).getTime() - new Date(a.startedAtUtc).getTime());
  }, [historyQuery.data]);

  const historyLoading = historyQuery.isLoading;

  // --- Update Logic State ---
  const [logs, setLogs] = useState<Array<{ ts: string; msg: string }>>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const [isOptionsOpen, setIsOptionsOpen] = useState(true);

  const resetProgress = () => {
    setLogs([]);
    setStatus(null);
    setLastError(null);
  };



  // 4. Fetch Suggested URL
  const suggestedUrlQuery = useQuery({
    queryKey: ["suggestedServerBaseUrl"],
    queryFn: fetchSuggestedServerBaseUrl,
    staleTime: 60_000,
  });

  // The installer expects a *server base URL* (origin), not an API URL and not a hub URL.
  // Examples:
  //   ✅ http://192.168.1.10:5247
  //   ❌ http://192.168.1.10:5247/api
  //   ❌ http://192.168.1.10:5247/hubs/agent
  const normalizeAgentServerBaseUrl = (value: string): string => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return "";

    const toUrl = (v: string): URL | null => {
      try {
        if (/^https?:\/\//i.test(v)) return new URL(v);
        if (v.startsWith("//")) return new URL(`${window.location.protocol}${v}`);
        if (v.startsWith("/")) return new URL(v, window.location.origin);
        // Back-compat: host[:port] without scheme
        return new URL(`http://${v}`);
      } catch {
        return null;
      }
    };

    // If it's a URL, always reduce to origin; paths like /api or /hubs/agent are not valid for installers.
    const u = toUrl(trimmed);
    if (u) return u.origin;

    // Fallback: try to strip common suffixes in non-URL inputs.
    return trimmed
      .replace(/\/+$/, "")
      .replace(/\/(api|hubs\/agent)(\/.*)?$/i, "")
      .trim();
  };

  // Server URL selection (mirrors onboarding behavior; persisted to the linked onboarding machine)
  // Local override that takes precedence over persisted machine config once the user edits.
  // We avoid hydrating state from an effect; instead we derive defaults from `machine` unless the user changes it.
  const [serverBaseUrlOverride, setServerBaseUrlOverride] = useState<string | null>(null);
  const [useCustomServerUrl, setUseCustomServerUrl] = useState(false);
  const [serverBaseUrlDirty, setServerBaseUrlDirty] = useState(false);

  // Persisted preference from onboarding machine (set during install/update and editable via configuration endpoint)
  const persistedServerBaseUrlOverride = machine?.serverBaseUrlOverride ?? null;

  // Current effective override value: local (if user changed) else persisted.
  const selectedServerBaseUrlOverride = useMemo(() => {
    if (serverBaseUrlDirty) return serverBaseUrlOverride;
    return persistedServerBaseUrlOverride;
  }, [persistedServerBaseUrlOverride, serverBaseUrlOverride, serverBaseUrlDirty]);

  // Compute serverBaseUrl as a derived value.
  // Priority: user override > env var > suggested URL from backend > window origin
  const serverBaseUrl = useMemo(() => {
    if (selectedServerBaseUrlOverride !== null) {
      return selectedServerBaseUrlOverride;
    }
    if (import.meta.env.VITE_SERVER_BASE_URL) {
      return import.meta.env.VITE_SERVER_BASE_URL as string;
    }
    const suggested = suggestedUrlQuery.data?.serverBaseUrl?.trim();
    if (suggested) {
      return suggested;
    }
    return import.meta.env.VITE_API_URL ?? window.location.origin;
  }, [selectedServerBaseUrlOverride, suggestedUrlQuery.data]);

  const effectiveServerBaseUrl = useMemo(
    () => normalizeAgentServerBaseUrl(serverBaseUrl),
    [serverBaseUrl]
  );

  const availableServerUrls = useMemo(() => {
    const urlSet = new Set<string>();

    if (suggestedUrlQuery.data?.allServerUrls) {
      for (const url of suggestedUrlQuery.data.allServerUrls) {
        const normalized = normalizeAgentServerBaseUrl(url);
        if (normalized) urlSet.add(normalized);
      }
    }

    if (import.meta.env.VITE_SERVER_BASE_URL) {
      const normalized = normalizeAgentServerBaseUrl(import.meta.env.VITE_SERVER_BASE_URL as string);
      if (normalized) urlSet.add(normalized);
    }

    const originNormalized = normalizeAgentServerBaseUrl(window.location.origin);
    if (originNormalized) urlSet.add(originNormalized);

    if (selectedServerBaseUrlOverride) {
      const normalized = normalizeAgentServerBaseUrl(selectedServerBaseUrlOverride);
      if (normalized) urlSet.add(normalized);
    }

    return Array.from(urlSet);
  }, [suggestedUrlQuery.data, selectedServerBaseUrlOverride]);

  const updateConfigurationMutation = useMutation({
    mutationFn: async (input: { serverBaseUrlOverride?: string | null }) => {
      if (!machine) throw new Error("No onboarding machine linked to this node.");
      return updateMachineConfiguration(machine.id, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachineForNode", nodeId] });
      // Keep local state aligned with persisted server config.
      setServerBaseUrlDirty(false);
      setServerBaseUrlOverride(null);
    },
    onError: (err) => {
      toast.error("Failed to save server URL preference", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const handleServerBaseUrlChange = (value: string) => {
    setServerBaseUrlDirty(true);
    setServerBaseUrlOverride(value);
    // Persist the chosen URL so the next update starts with this selection.
    updateConfigurationMutation.mutate({ serverBaseUrlOverride: value });
  };

  // (effectiveServerBaseUrl is now derived from the selector above)

  // --- SignalR for Logs ---
  useEffect(() => {
    if (!connection || !machine || !nodeId) return;

    const handleLog = (machineId: string, timestamp: string, message: string) => {
      if (machineId !== machine.id) return;
      setLogs((old) => {
        const next = [...old, { ts: timestamp, msg: message }];
        return next.slice(-1000); // Keep more history on full page
      });
    };

    const handleStatus = (machineId: string, newStatus: string, error: string | null) => {
      if (machineId !== machine.id) return;
      setStatus(newStatus);
      setLastError(error);
      queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      queryClient.invalidateQueries({ queryKey: ["onboardingMachineForNode", nodeId] });
    };

    connection.on("OnboardingLog", handleLog);
    connection.on("OnboardingStatusChanged", handleStatus);

    return () => {
      connection.off("OnboardingLog", handleLog);
      connection.off("OnboardingStatusChanged", handleStatus);
    };
  }, [connection, machine, nodeId, queryClient]);

  // Auto-scroll logs
  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  // --- Form State ---
  const [trustHostKeyOverride, setTrustHostKeyOverride] = useState<boolean | null>(null);
  const [runAsRootOverride, setRunAsRootOverride] = useState<boolean | null>(null);
  const [forceOverride, setForceOverride] = useState<boolean | null>(null);

  const trustHostKey = trustHostKeyOverride ?? machine?.trustHostKey ?? true;
  const runAsRoot = runAsRootOverride ?? machine?.runAsRoot ?? false;
  const force = forceOverride ?? machine?.forceInstall ?? true;

  const [password, setPassword] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [sudoPassword, setSudoPassword] = useState("");
  const [useSavedCredentials, setUseSavedCredentials] = useState(true);

  // Automatically uncheck "Use Saved" if no credentials are saved
  if (machine && !machine.hasSavedCredentials && !machine.hasSavedSudoPassword && useSavedCredentials) {
    setUseSavedCredentials(false);
  }

  const [agentSelectionCore, setAgentSelectionCore] = useState<Pick<AgentVersionSelection, "source" | "version">>({
    source: "github",
    version: "",
  });

  const agentSelection: AgentVersionSelection = useMemo(
    () => ({ ...agentSelectionCore, channel: currentChannel }),
    [agentSelectionCore, currentChannel]
  );

  const installMutation = useMutation({
    mutationFn: async () => {
      if (!machine || !nodeId) throw new Error("No onboarding machine linked to this node.");

      if (!useSavedCredentials) {
        if (machine.authMode === "Password" && !password.trim()) throw new Error("Password is required.");
        if (machine.authMode === "PrivateKey" && !privateKeyPem.trim()) throw new Error("Private key PEM is required.");
      }

      resetProgress();

      // Ensure the selected server URL is persisted before starting an update.
      // NOTE: The server-side configuration endpoint treats empty string as "clear override".
      if (serverBaseUrlDirty) {
        const desired = (serverBaseUrlOverride ?? "").trim();
        const persisted = (persistedServerBaseUrlOverride ?? "").trim();
        if (desired !== persisted)
        {
          await updateMachineConfiguration(machine.id, { serverBaseUrlOverride: desired });
          await queryClient.invalidateQueries({ queryKey: ["onboardingMachineForNode", nodeId] });
          setServerBaseUrlDirty(false);
          setServerBaseUrlOverride(null);
        }
      }

      return await installAgent(machine.id, {
        serverBaseUrl: effectiveServerBaseUrl,
        force,
        runAsRoot,
        trustHostKey,
        targetNodeId: nodeId,
        agentSource: agentSelection.source,
        agentChannel: agentSelection.channel,
        agentVersion: agentSelection.version,
        password: useSavedCredentials ? undefined : password,
        privateKeyPem: useSavedCredentials ? undefined : privateKeyPem,
        privateKeyPassphrase: useSavedCredentials ? undefined : privateKeyPassphrase,
        sudoPassword: useSavedCredentials ? undefined : sudoPassword,
        useSavedCredentials,
      });
    },
    onSuccess: () => {
      toast.info("Agent update started");
      setIsOptionsOpen(false); // Collapse options to focus on logs
    },
    onError: (err) => {
      toast.error("Failed to start agent update", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const isInstalling = installMutation.isPending || (!!status && status !== "Idle" && status !== "Failed" && status !== "Installed");

  if (nodeLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!nodeId || !node) return null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="max-w-7xl mx-auto w-full px-6 flex-1 flex flex-col pt-6 pb-12">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="-ml-2">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              Update Agent
              <span className="text-muted-foreground font-normal text-lg">for {node.hostname}</span>
            </h1>
            <p className="text-muted-foreground text-sm">Manage agent version updates and view deployment history.</p>
          </div>
        </div>

        <Tabs defaultValue="update" className="flex-1 space-y-6">
          <TabsList>
            <TabsTrigger value="update" className="gap-2"><Server className="w-4 h-4" /> Update Agent</TabsTrigger>
            <TabsTrigger value="history" className="gap-2"><History className="w-4 h-4" /> Update History</TabsTrigger>
          </TabsList>

          <TabsContent value="update" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"> 
            
            {lastError && (
                <Alert variant="destructive" className="animate-in slide-in-from-top-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Update Error</AlertTitle>
                    <AlertDescription>{lastError}</AlertDescription>
                </Alert>
            )}
             {/* Configuration Card */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Monitor className="w-5 h-5" />
                        Configuration
                    </CardTitle>
                    <CardDescription>Configure the target machine and version for this update.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                     {machineQuery.isError && (
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Configuration Error</AlertTitle>
                            <AlertDescription>
                                This node is not linked to an onboarding machine. Use the Onboarding modal to add/link the machine first.
                            </AlertDescription>
                        </Alert>
                    )}

                    {machine && (
                        <>
                             <div className="grid md:grid-cols-2 gap-6">
                                <div className="space-y-3 p-4 rounded-xl border bg-card/50">
                                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                    <Monitor className="w-4 h-4" />
                                    Target Machine
                                    </div>
                                    <div className="space-y-1">
                                    <div className="font-mono text-sm bg-muted/50 px-2 py-1 rounded w-fit">
                                        {machine.username}@{machine.host}:{machine.port}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Key className="w-3 h-3" />
                                        Auth Mode: <span className="text-foreground font-medium">{machine.authMode}</span>
                                    </div>
                                    </div>
                                </div>

                                <div className="space-y-3 p-4 rounded-xl border bg-card/50">
                                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                    <HardDrive className="w-4 h-4" />
                                    Target Version
                                    </div>
                                    <AgentVersionPicker
                                    channel={currentChannel}
                                    value={agentSelection}
                                    onChange={(next) => setAgentSelectionCore({ source: next.source, version: next.version })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                              <div className="text-sm font-medium">Server URL (for agent install/update)</div>
                              <div className="text-xs text-muted-foreground">
                                Pick the ManLab <span className="font-mono">origin</span> the agent should connect to (e.g., <span className="font-mono">http://host:8080</span>).
                              </div>

                              {availableServerUrls.length > 1 && !useCustomServerUrl ? (
                                <div className="flex gap-2">
                                  <Select
                                    value={effectiveServerBaseUrl || ""}
                                    onValueChange={(val) => {
                                      if (val === null) return;
                                      if (val === "__custom__") {
                                        setUseCustomServerUrl(true);
                                        // Start from the currently effective URL when switching to custom.
                                        handleServerBaseUrlChange(effectiveServerBaseUrl || "");
                                      } else {
                                        setUseCustomServerUrl(false);
                                        handleServerBaseUrlChange(val);
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="font-mono text-xs h-9 flex-1">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {availableServerUrls.map((url) => (
                                        <SelectItem key={url} value={url} className="font-mono text-xs">
                                          {url}
                                        </SelectItem>
                                      ))}
                                      <SelectItem value="__custom__" className="text-xs">
                                        Custom...
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>

                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={updateConfigurationMutation.isPending}
                                    onClick={() => {
                                      // Revert to suggested URL by clearing the override (persist empty -> null).
                                      setServerBaseUrlDirty(true);
                                      setUseCustomServerUrl(false);
                                      setServerBaseUrlOverride(null);
                                      updateConfigurationMutation.mutate({ serverBaseUrlOverride: "" });
                                    }}
                                  >
                                    Reset
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <Input
                                    value={(serverBaseUrlOverride ?? selectedServerBaseUrlOverride ?? "")}
                                    onChange={(e) => {
                                      setServerBaseUrlOverride(e.target.value);
                                      setServerBaseUrlDirty(true);
                                    }}
                                    onBlur={() => {
                                      // Persist on blur to avoid saving a half-typed URL on every keystroke.
                                      handleServerBaseUrlChange((serverBaseUrlOverride ?? selectedServerBaseUrlOverride ?? "") );
                                    }}
                                    placeholder={suggestedUrlQuery.data?.serverBaseUrl ?? window.location.origin}
                                    className="font-mono text-xs h-9"
                                  />
                                  {availableServerUrls.length > 0 ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setUseCustomServerUrl(false);
                                      }}
                                    >
                                      Pick
                                    </Button>
                                  ) : null}
                                </div>
                              )}

                              {!effectiveServerBaseUrl ? (
                                <Alert variant="destructive" className="py-2">
                                  <AlertDescription className="text-xs">
                                    Please enter a valid server base URL (origin), like <span className="font-mono">http://192.168.1.10:8080</span>.
                                  </AlertDescription>
                                </Alert>
                              ) : null}
                            </div>
                            
                            <Collapsible open={isOptionsOpen} onOpenChange={setIsOptionsOpen} className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <CollapsibleTrigger className="p-0 h-auto hover:bg-transparent text-muted-foreground hover:text-foreground inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50">
                                        {isOptionsOpen ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
                                        Advanced Options & Credentials
                                    </CollapsibleTrigger>
                                    <Separator className="flex-1 ml-4" />
                                </div>
                                
                                <CollapsibleContent className="space-y-4 animate-in slide-in-from-top-2 fade-in duration-200">
                                    <div className="grid md:grid-cols-2 gap-6 pt-2">
                                    <div className="space-y-3">
                                        <label className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors cursor-pointer">
                                        <Checkbox checked={force} onCheckedChange={(c) => setForceOverride(c === true)} className="mt-0.5" />
                                        <div className="space-y-0.5">
                                            <span className="text-sm font-medium">Force Re-install</span>
                                            <p className="text-xs text-muted-foreground">Overwrite existing files even if version matches.</p>
                                        </div>
                                        </label>
                                        <label className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors cursor-pointer">
                                        <Checkbox checked={runAsRoot} onCheckedChange={(c) => setRunAsRootOverride(c === true)} className="mt-0.5" />
                                        <div className="space-y-0.5">
                                            <span className="text-sm font-medium">Run as Root</span>
                                            <p className="text-xs text-muted-foreground">Execute installation script with sudo privileges.</p>
                                        </div>
                                        </label>
                                        <label className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors cursor-pointer">
                                        <Checkbox checked={trustHostKey} onCheckedChange={(c) => setTrustHostKeyOverride(c === true)} className="mt-0.5" />
                                        <div className="space-y-0.5">
                                            <span className="text-sm font-medium">Trust Host Key</span>
                                            <p className="text-xs text-muted-foreground">Automatically accept SSH host fingerprint.</p>
                                        </div>
                                        </label>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium flex items-center gap-2">
                                            <Shield className="w-4 h-4" />
                                            Credentials
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                            id="use-saved"
                                            checked={useSavedCredentials}
                                            onCheckedChange={(c) => setUseSavedCredentials(c === true)}
                                            disabled={machine.hasSavedCredentials !== true && machine.hasSavedSudoPassword !== true}
                                            />
                                            <label htmlFor="use-saved" className="text-sm cursor-pointer select-none">
                                            Use Saved
                                            </label>
                                        </div>
                                        </div>

                                        {useSavedCredentials && (machine.hasSavedCredentials !== true && machine.hasSavedSudoPassword !== true) ? (
                                        <Alert variant="destructive" className="py-2">
                                            <AlertDescription className="text-xs">
                                            No saved credentials found. Please uncheck "Use Saved" and enter manually.
                                            </AlertDescription>
                                        </Alert>
                                        ) : null}

                                        {!useSavedCredentials && (
                                        <div className="space-y-3 bg-muted/30 p-3 rounded-lg border animate-in fade-in zoom-in-95 duration-200">
                                            {machine.authMode === "Password" ? (
                                            <div className="space-y-1">
                                                <label className="text-xs font-medium">SSH Password</label>
                                                <Input
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="Enter password..."
                                                className="h-8 bg-background"
                                                />
                                            </div>
                                            ) : (
                                            <>
                                                <div className="space-y-1">
                                                <label className="text-xs font-medium">Private Key (PEM)</label>
                                                <Textarea
                                                    value={privateKeyPem}
                                                    onChange={(e) => setPrivateKeyPem(e.target.value)}
                                                    placeholder="-----BEGIN RSA PRIVATE KEY-----"
                                                    className="font-mono text-[10px] h-20 bg-background resize-none"
                                                />
                                                </div>
                                                <div className="space-y-1">
                                                <label className="text-xs font-medium">Key Passphrase</label>
                                                <Input
                                                    type="password"
                                                    value={privateKeyPassphrase}
                                                    onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
                                                    placeholder="Optional"
                                                    className="h-8 bg-background"
                                                />
                                                </div>
                                            </>
                                            )}
                                            <div className="space-y-1">
                                            <label className="text-xs font-medium">Sudo Password</label>
                                            <Input
                                                type="password"
                                                value={sudoPassword}
                                                onChange={(e) => setSudoPassword(e.target.value)}
                                                placeholder="Optional (for sudo access)"
                                                className="h-8 bg-background"
                                            />
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                    </div>
                                </CollapsibleContent>
                            </Collapsible>

                            <div className="flex justify-end pt-4">
                                <Button
                                    size="lg"
                                    onClick={() => installMutation.mutate()}
                                    disabled={!machine || isInstalling || !effectiveServerBaseUrl}
                                    className="w-40"
                                >
                                    {installMutation.isPending ? "Starting…" : "Start Update"}
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Logs Card - Always visible if there are logs or status */}
            <Card className="flex-1 flex flex-col min-h-125">
                <CardHeader className="py-4">
                    <div className="flex items-center justify-between">
                         <CardTitle className="text-lg flex items-center gap-2">
                            <Terminal className="w-5 h-5" />
                            Live Logs
                        </CardTitle>
                        {status && (
                            <Badge variant="outline" className={cn(
                                "transition-colors px-3 py-1 text-sm",
                                status === "Installed" ? "bg-green-500/15 text-green-600 border-green-500/30" :
                                status === "Failed" ? "bg-red-500/15 text-red-600 border-red-500/30" :
                                "bg-blue-500/15 text-blue-600 border-blue-500/30 animate-pulse"
                            )}>
                                {status}
                            </Badge>
                        )}
                    </div>
                </CardHeader>
                <Separator />
                <CardContent className="flex-1 p-0 flex flex-col bg-[#0b0b10]">
                      <div className="flex items-center px-4 py-2 border-b border-white/5 bg-white/5 gap-1.5">
                       <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50" />
                       <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                       <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50" />
                       <div className="ml-2 text-xs font-mono text-muted-foreground">bash — ssh session</div>
                     </div>
                     <ScrollArea className="flex-1 h-125">
                        <div ref={logScrollRef} className="p-4 font-mono text-xs leading-relaxed">
                             {logs.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-muted-foreground/40 gap-2 min-h-50">
                                    <Terminal className="w-12 h-12 opacity-20" />
                                    <span className="text-sm">Ready to receive logs...</span>
                                </div>
                            ) : (
                                logs.map((l, idx) => (
                                    <div key={idx} className="break-all whitespace-pre-wrap mb-0.5">
                                        <span className="text-zinc-500 select-none mr-3 inline-block w-20 text-right">[{l.ts.split('T')[1].split('.')[0]}]</span>
                                        <span className="text-zinc-300">{l.msg}</span>
                                    </div>
                                ))
                            )}
                             {isInstalling && (
                                <div className="w-2 h-4 bg-zinc-500/50 animate-pulse inline-block align-middle ml-24" />
                            )}
                        </div>
                     </ScrollArea>
                </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
                <CardHeader>
                    <CardTitle>Update History</CardTitle>
                    <CardDescription>View past update attempts and results.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center mb-4">
                      <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => historyQuery.refetch()} 
                          disabled={historyQuery.isRefetching}
                      >
                          <RefreshCw className={cn("w-4 h-4 mr-2", historyQuery.isRefetching && "animate-spin")} />
                          Refresh
                      </Button>
                  </div>

                  {historyLoading ? (
                      <div className="flex items-center justify-center py-12">
                          <Spinner className="w-8 h-8" />
                      </div>
                  ) : !history || history.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                          <History className="w-12 h-12 mb-4 opacity-50" />
                          <p>No update history available.</p>
                      </div>
                  ) : (
                      <div className="rounded-md border">
                          <table className="w-full text-sm">
                              <thead>
                                  <tr className="border-b bg-muted/50">
                                      <th className="h-10 px-4 text-left font-medium">Version</th>
                                      <th className="h-10 px-4 text-left font-medium">Status</th>
                                      <th className="h-10 px-4 text-left font-medium">Date</th>
                                      <th className="h-10 px-4 text-left font-medium">Duration</th>
                                  </tr>
                              </thead>
                              <tbody>
                                  {history.map((item) => {
                                    const running = !item.completedAtUtc;
                                    const succeeded = item.success === true;
                                    const failed = item.success === false;

                                    const statusLabel = running ? "Running" : succeeded ? "Succeeded" : failed ? "Failed" : "Completed";

                                    const selection = [item.agentSource, item.agentChannel, item.agentVersion]
                                      .filter((x) => typeof x === "string" && x.length > 0)
                                      .join(" / ");

                                    const versionText = selection || item.reportedAgentVersion || "-";

                                    return (
                                      <tr key={`${item.id}-${item.startedAtUtc}`} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                                        <td className="p-4 font-mono">{versionText}</td>
                                        <td className="p-4">
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "font-normal",
                                              running
                                                ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                                                : succeeded
                                                  ? "bg-green-500/10 text-green-600 border-green-500/20"
                                                  : failed
                                                    ? "bg-red-500/10 text-red-600 border-red-500/20"
                                                    : "bg-muted/40 text-foreground border-border"
                                            )}
                                          >
                                            {statusLabel}
                                          </Badge>
                                          {item.error && (
                                            <div className="text-xs text-red-500 mt-1 max-w-75 truncate" title={item.error}>
                                              {item.error}
                                            </div>
                                          )}
                                        </td>
                                        <td className="p-4 text-muted-foreground">
                                          {format(new Date(item.startedAtUtc), "PPp")}
                                        </td>
                                        <td className="p-4 text-muted-foreground">
                                          {item.completedAtUtc ? (
                                            <span>
                                              {Math.max(
                                                0,
                                                Math.round(
                                                  (new Date(item.completedAtUtc).getTime() - new Date(item.startedAtUtc).getTime()) / 1000
                                                )
                                              )}
                                              s
                                            </span>
                                          ) : (
                                            "-"
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                          </table>
                      </div>
                  )}
                </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
