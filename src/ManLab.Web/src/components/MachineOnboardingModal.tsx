import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOnboardingMachine,
  fetchOnboardingMachines,
  fetchSuggestedServerBaseUrl,
  fetchUninstallPreview,
  installAgent,
  testSshConnection,
  uninstallAgent,
  deleteOnboardingMachine,
} from "../api";
import type {
  OnboardingMachine,
  OnboardingStatus,
  SshAuthMode,
  SshTestResponse,
  UninstallPreviewResponse,
} from "../types";
import { useSignalR } from "../SignalRContext";
import { ConfirmationModal } from "./ConfirmationModal";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertCircle, Terminal, Trash2 } from "lucide-react";

const EMPTY_MACHINES: OnboardingMachine[] = [];

function getStatusVariant(
  status: OnboardingStatus
): "default" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "Succeeded":
      return "default";
    case "Failed":
      return "destructive";
    case "Running":
      return "secondary";
    default:
      return "outline";
  }
}

export function MachineOnboardingModal({ trigger }: { trigger: ReactNode }) {
  const queryClient = useQueryClient();
  const { connection } = useSignalR();

  const machinesQuery = useQuery({
    queryKey: ["onboardingMachines"],
    queryFn: fetchOnboardingMachines,
    staleTime: 5000,
  });

  const machines = machinesQuery.data ?? EMPTY_MACHINES;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo<OnboardingMachine | null>(() => {
    if (!selectedId) return machines[0] ?? null;
    return machines.find((m) => m.id === selectedId) ?? null;
  }, [machines, selectedId]);

  // Add machine form state
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authMode, setAuthMode] = useState<SshAuthMode>("PrivateKey");

  // Per-selected machine auth inputs (secrets are NOT persisted server-side)
  const [password, setPassword] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [trustHostKey, setTrustHostKey] = useState(false);
  const [lastTest, setLastTest] = useState<SshTestResponse | null>(null);
  // Use a ref to track if user has manually edited the server base URL
  const serverBaseUrlDirtyRef = useRef(false);
  const [serverBaseUrlOverride, setServerBaseUrlOverride] = useState<
    string | null
  >(null);
  const [forceInstall, setForceInstall] = useState(true);
  const [runAsRoot, setRunAsRoot] = useState(false);
  const [sudoPassword, setSudoPassword] = useState("");

  const [logs, setLogs] = useState<Array<{ ts: string; msg: string }>>([]);

  const [remoteUninstallPreview, setRemoteUninstallPreview] = useState<UninstallPreviewResponse | null>(null);

  const previewUninstallMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      if (!lastTest?.success) throw new Error("Test connection first");

      return fetchUninstallPreview(selected.id, {
        serverBaseUrl,
        trustHostKey,
        password: password || undefined,
        privateKeyPem: privateKeyPem || undefined,
        privateKeyPassphrase: privateKeyPassphrase || undefined,
        sudoPassword: sudoPassword || undefined,
      });
    },
    onSuccess: (data) => {
      setRemoteUninstallPreview(data);
    },
    onError: () => {
      setRemoteUninstallPreview(null);
    },
  });

  const uninstallPreview = useMemo(() => {
    if (previewUninstallMutation.isPending) {
      return (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cleanup preview
          </div>
          <div className="text-xs text-muted-foreground">Loading remote inventory…</div>
        </div>
      );
    }

    if (remoteUninstallPreview?.success && (remoteUninstallPreview.sections?.length ?? 0) > 0) {
      return (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cleanup preview (from target)
          </div>
          <div className="text-xs text-muted-foreground">
            Retrieved from the target machine via SSH.
          </div>
          <div className="space-y-2">
            {remoteUninstallPreview.sections.map((s) => (
              <div key={s.label}>
                <div className="text-xs font-medium">{s.label}</div>
                <ul className="mt-1 list-disc pl-5 text-xs font-mono text-muted-foreground">
                  {s.items.map((it) => (
                    <li key={it} className="break-all">{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      );
    }

    const osHint = lastTest?.osHint ?? null;
    const os = osHint?.toLowerCase() ?? "";

    const isWindows = os.startsWith("windows");
    const isLinux = os.startsWith("linux");
    const isMac = os.startsWith("darwin") || os.startsWith("mac") || os.startsWith("osx") || os.includes("darwin");

    const title = "Cleanup preview (best-effort)";
    const subtitle = "The uninstaller will attempt to stop/disable services and remove these resources:";

    const commonItems: Array<{ label: string; items: string[] }> = [];

    if (isWindows)
    {
      commonItems.push(
        {
          label: "Tasks / services",
          items: [
            "Scheduled task: ManLab Agent",
            "Scheduled task: ManLab Agent User",
            "Legacy Windows service (if present): manlab-agent",
          ],
        },
        {
          label: "Folders",
          items: [
            "C:\\ProgramData\\ManLab\\Agent",
            "%LOCALAPPDATA%\\ManLab\\Agent",
          ],
        }
      );
    }
    else if (isLinux)
    {
      commonItems.push(
        {
          label: "Systemd units",
          items: [
            "manlab-agent.service (and any manlab-agent*.service variants)",
            "/etc/systemd/system/manlab-agent.service",
            "/lib/systemd/system/manlab-agent.service",
            "/usr/lib/systemd/system/manlab-agent.service",
          ],
        },
        {
          label: "Config",
          items: [
            "/etc/manlab-agent.env",
            "/etc/default/manlab-agent (if present)",
            "/etc/sysconfig/manlab-agent (if present)",
          ],
        },
        {
          label: "Install directory",
          items: [
            "/opt/manlab-agent",
          ],
        },
        {
          label: "User/group",
          items: [
            "manlab-agent (if present)",
          ],
        }
      );
    }
    else if (isMac)
    {
      commonItems.push(
        {
          label: "launchd",
          items: [
            "Label: com.manlab.agent",
            "/Library/LaunchDaemons/com.manlab.agent.plist",
            "/Library/LaunchAgents/com.manlab.agent.plist (if present)",
          ],
        },
        {
          label: "Install directory",
          items: [
            "/opt/manlab-agent",
          ],
        }
      );
    }
    else
    {
      commonItems.push({
        label: "Resources",
        items: [
          "Service: manlab-agent",
          "Install directory: /opt/manlab-agent",
        ],
      });
    }

    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
        <div className="space-y-2">
          {commonItems.map((section) => (
            <div key={section.label}>
              <div className="text-xs font-medium">{section.label}</div>
              <ul className="mt-1 list-disc pl-5 text-xs font-mono text-muted-foreground">
                {section.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }, [lastTest?.osHint, previewUninstallMutation.isPending, remoteUninstallPreview]);

  // Subscribe to onboarding progress events
  useEffect(() => {
    if (!connection) return;

    const handleLog = (
      machineId: string,
      timestamp: string,
      message: string
    ) => {
      if (selected && machineId !== selected.id) return;

      setLogs((old) => {
        const next = [...old, { ts: timestamp, msg: message }];
        return next.slice(-300);
      });
    };

    const handleStatus = (machineId: string) => {
      // Refresh machine list when status changes.
      queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      if (selected && machineId === selected.id) {
        // Keep UI fresh; no-op beyond invalidation.
      }
    };

    connection.on("OnboardingLog", handleLog);
    connection.on("OnboardingStatusChanged", handleStatus);

    return () => {
      connection.off("OnboardingLog", handleLog);
      connection.off("OnboardingStatusChanged", handleStatus);
    };
  }, [connection, queryClient, selected]);

  const suggestedServerBaseUrlQuery = useQuery({
    queryKey: ["onboardingSuggestedServerBaseUrl"],
    queryFn: fetchSuggestedServerBaseUrl,
    staleTime: 60_000,
    retry: 1,
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

  // Compute serverBaseUrl as a derived value instead of using setState in useEffect.
  // Priority: user override > env variable > suggested URL from backend > window origin
  const serverBaseUrl = useMemo(() => {
    if (serverBaseUrlOverride !== null) {
      return serverBaseUrlOverride;
    }
    if (import.meta.env.VITE_SERVER_BASE_URL) {
      return import.meta.env.VITE_SERVER_BASE_URL as string;
    }
    const suggested = suggestedServerBaseUrlQuery.data?.trim();
    if (suggested) {
      return suggested;
    }
    return import.meta.env.VITE_API_URL ?? window.location.origin;
  }, [serverBaseUrlOverride, suggestedServerBaseUrlQuery.data]);

  const effectiveServerBaseUrl = useMemo(
    () => normalizeAgentServerBaseUrl(serverBaseUrl),
    [serverBaseUrl]
  );

  // Handler to update server base URL when user edits
  const handleServerBaseUrlChange = (value: string) => {
    serverBaseUrlDirtyRef.current = true;
    setServerBaseUrlOverride(value);
  };

  const selectMachine = (id: string) => {
    setSelectedId(id);
    setLogs([]);
    setLastTest(null);
    setTrustHostKey(false);
    setCredErrors({});
    setSudoPassword("");
  };

  // Auto-scroll logs
  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const createMachineMutation = useMutation({
    mutationFn: createOnboardingMachine,
    onSuccess: async (m) => {
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      selectMachine(m.id);
      setHost("");
      setPort("22");
      setUsername("");
      setAuthMode("PrivateKey");
      setAddMachineErrors({});
      toast.success(`Machine ${m.host} added to inventory`);
    },
    onError: (err) => {
      toast.error("Failed to add machine", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      return testSshConnection(selected.id, {
        password: password || undefined,
        privateKeyPem: privateKeyPem || undefined,
        privateKeyPassphrase: privateKeyPassphrase || undefined,
        sudoPassword: sudoPassword || undefined,
        trustHostKey,
      });
    },
    onSuccess: async (res) => {
      setLastTest(res);
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      if (res.success) {
        toast.success("SSH Connection Verified", {
          description: `Connected as ${res.whoAmI} on ${res.osHint}`,
        });
      } else {
        toast.error("SSH Connection Failed", { description: res.error });
      }
    },
    onError: (err) => {
      toast.error("Test connection request failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const installMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      return installAgent(selected.id, {
        serverBaseUrl: effectiveServerBaseUrl,
        force: forceInstall,
        runAsRoot,
        trustHostKey,
        password: password || undefined,
        privateKeyPem: privateKeyPem || undefined,
        privateKeyPassphrase: privateKeyPassphrase || undefined,
        sudoPassword: sudoPassword || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      toast.info("Installation started", {
        description: "Check the logs console for matching progress.",
      });
    },
    onError: (err) => {
      toast.error("Failed to start installation", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      return uninstallAgent(selected.id, {
        serverBaseUrl: effectiveServerBaseUrl,
        trustHostKey,
        password: password || undefined,
        privateKeyPem: privateKeyPem || undefined,
        privateKeyPassphrase: privateKeyPassphrase || undefined,
        sudoPassword: sudoPassword || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      toast.info("Uninstall started");
    },
    onError: (err) => {
      toast.error("Failed to start uninstall", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  // Machine to delete is now managed by the ConfirmationModal's open state per machine.

  const deleteMachineMutation = useMutation({
    mutationFn: (id: string) => deleteOnboardingMachine(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      toast.success("Machine removed from inventory");
    },
    onError: (err) => {
      toast.error("Failed to delete machine", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const isBusy =
    createMachineMutation.isPending ||
    deleteMachineMutation.isPending ||
    testMutation.isPending ||
    installMutation.isPending ||
    uninstallMutation.isPending;

  // Form Validation State for "Add Machine"
  const [addMachineErrors, setAddMachineErrors] = useState<{
    host?: string;
    username?: string;
  }>({});

  const validateAddMachine = () => {
    const errors: { host?: string; username?: string } = {};
    if (!host.trim()) errors.host = "Host is required";
    if (!username.trim()) errors.username = "Username is required";

    setAddMachineErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Credentials validation state (Right Pane)
  const [credErrors, setCredErrors] = useState<{
    password?: string;
    privateKey?: string;
  }>({});

  const validateCredentials = () => {
    if (!selected) return false;
    const errors: { password?: string; privateKey?: string } = {};
    if (selected.authMode === "Password" && !password) {
      errors.password = "Password is required";
    }
    if (selected.authMode === "PrivateKey" && !privateKeyPem) {
      errors.privateKey = "Private key is required";
    }
    setCredErrors(errors);
    return Object.keys(errors).length === 0;
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="w-[95vw] sm:max-w-[95vw] h-[95vh] p-0 gap-0 overflow-hidden flex flex-col md:flex-row"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Machine Onboarding</DialogTitle>
        {/* Left Sidebar: Add Machine & Inventory */}
        <div className="w-full md:w-80 shrink-0 flex flex-col border-r bg-muted/10">
          <div className="p-4 border-b flex items-center justify-between bg-background">
            <h2 className="font-semibold text-sm tracking-tight">Machines</h2>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="md:hidden h-8 w-8">
                <span className="sr-only">Close</span>✕
              </Button>
            </DialogClose>
          </div>

          <div className="p-4 border-b space-y-3 bg-background/50">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                New Connection
              </Label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Input
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value);
                    if (addMachineErrors.host)
                      setAddMachineErrors({
                        ...addMachineErrors,
                        host: undefined,
                      });
                  }}
                  className={cn(
                    "h-8 text-xs font-mono",
                    addMachineErrors.host && "border-destructive"
                  )}
                  placeholder="Host (192.168.1.10)"
                />
              </div>
              <div className="col-span-1">
                <Input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="h-8 text-xs font-mono"
                  placeholder="22"
                />
              </div>
            </div>
            {addMachineErrors.host && (
              <p className="text-[10px] text-destructive mt-0.5">
                {addMachineErrors.host}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (addMachineErrors.username)
                    setAddMachineErrors({
                      ...addMachineErrors,
                      username: undefined,
                    });
                }}
                className={cn(
                  "h-8 text-xs font-mono",
                  addMachineErrors.username && "border-destructive"
                )}
                placeholder="root"
              />
              <Select
                value={authMode}
                onValueChange={(value) => setAuthMode(value as SshAuthMode)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue>{authMode}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PrivateKey">PrivateKey</SelectItem>
                  <SelectItem value="Password">Password</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {addMachineErrors.username && (
              <p className="text-[10px] text-destructive mt-0.5">
                {addMachineErrors.username}
              </p>
            )}

            {createMachineMutation.isError && (
              <Alert variant="destructive" className="py-2 px-3 text-xs">
                <AlertCircle className="h-3 w-3" />
                <AlertTitle className="text-xs font-semibold ml-1 inline">
                  Error
                </AlertTitle>
                <AlertDescription className="ml-1 inline">
                  {createMachineMutation.error instanceof Error
                    ? createMachineMutation.error.message
                    : "Failed"}
                </AlertDescription>
              </Alert>
            )}

            <Button
              size="sm"
              className="w-full h-8 text-xs font-medium"
              disabled={isBusy}
              onClick={() => {
                if (!validateAddMachine()) return;
                createMachineMutation.mutate({
                  host: host.trim(),
                  port: Number(port || "22"),
                  username: username.trim(),
                  authMode,
                });
              }}
            >
              Add to Inventory
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {machinesQuery.isLoading && (
                <div className="p-4 text-xs text-center text-muted-foreground">
                  Loading inventory...
                </div>
              )}
              {machines.map((m) => (
                <div key={m.id} className="relative group">
                  <button
                    onClick={() => selectMachine(m.id)}
                    className={cn(
                      "w-full text-left p-3 rounded-md border transition-all hover:bg-muted/50 flex flex-col gap-1 pr-8",
                      selected?.id === m.id
                        ? "bg-background border-primary shadow-sm"
                        : "bg-transparent border-transparent hover:border-border"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-mono text-xs font-semibold truncate">
                        {m.host}
                      </span>
                      <Badge
                        variant={getStatusVariant(m.status)}
                        className={cn(
                          "text-[10px] h-4 px-1.5",
                          m.status === "Failed" && "animate-pulse"
                        )}
                      >
                        {m.status}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {m.username}@{m.port}
                      </span>
                      <span>{m.authMode}</span>
                    </div>
                  </button>
                  {/* Delete Button with ConfirmationModal */}
                  <ConfirmationModal
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    }
                    title="Remove Machine"
                    message={`Are you sure you want to remove ${m.host} from the inventory?`}
                    confirmText="Remove"
                    isDestructive
                    isLoading={deleteMachineMutation.isPending}
                    onConfirm={async () => {
                      await deleteMachineMutation.mutateAsync(m.id);
                      if (selectedId === m.id) {
                        setSelectedId(null);
                      }
                    }}
                  />
                </div>
              ))}
              {machines.length === 0 && !machinesQuery.isLoading && (
                <div className="p-8 text-center">
                  <p className="text-xs text-muted-foreground">
                    No machines added yet.
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right Content: Selected Machine Details */}
        <div className="flex-1 flex flex-col h-full bg-background relative">
          <div className="hidden md:flex absolute top-4 right-4 z-10">
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <span className="sr-only">Close</span>✕
              </Button>
            </DialogClose>
          </div>

          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-10">
              <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4 text-2xl">
                ⚡
              </div>
              <h3 className="font-medium text-sm">
                Select a machine to configure
              </h3>
              <p className="text-xs mt-1 text-center max-w-xs opacity-70">
                Choose a machine from the inventory on the left to view
                connection details and install the agent.
              </p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-6 py-4 border-b flex items-center gap-4 bg-background">
                <div>
                  <h2 className="text-lg font-bold tracking-tight">
                    {selected.host}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono mt-0.5">
                    <span>ID: {selected.id.split("-")[0]}...</span>
                    <span>•</span>
                    <span
                      className={cn(
                        selected.status === "Succeeded" ? "text-green-500" : ""
                      )}
                    >
                      {selected.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Main Content Scroll */}
              <ScrollArea className="flex-1">
                <div className="p-6 space-y-8 max-w-4xl mx-auto">
                  {/* Configuration Section */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Auth Credentials */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        🔒 Credentials
                      </h3>
                      <Card className="border-dashed shadow-none bg-muted/5">
                        <CardContent className="pt-4 space-y-3">
                          {selected.authMode === "Password" ? (
                            <div>
                              <Label className="text-xs mb-1.5 block">
                                SSH Password
                              </Label>
                              <Input
                                type="password"
                                value={password}
                                onChange={(e) => {
                                  setPassword(e.target.value);
                                  if (credErrors.password)
                                    setCredErrors({
                                      ...credErrors,
                                      password: undefined,
                                    });
                                }}
                                placeholder="••••••••"
                                className={cn(
                                  "bg-background",
                                  credErrors.password && "border-destructive"
                                )}
                              />
                              {credErrors.password && (
                                <p className="text-[10px] text-destructive mt-1">
                                  {credErrors.password}
                                </p>
                              )}
                            </div>
                          ) : (
                            <>
                              <div>
                                <Label className="text-xs mb-1.5 block">
                                  Private Key (PEM)
                                </Label>
                                <Textarea
                                  value={privateKeyPem}
                                  onChange={(e) => {
                                    setPrivateKeyPem(e.target.value);
                                    if (credErrors.privateKey)
                                      setCredErrors({
                                        ...credErrors,
                                        privateKey: undefined,
                                      });
                                  }}
                                  className={cn(
                                    "font-mono text-[10px] min-h-30 bg-background resize-none leading-tight",
                                    credErrors.privateKey &&
                                      "border-destructive"
                                  )}
                                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                                />
                                {credErrors.privateKey && (
                                  <p className="text-[10px] text-destructive mt-1">
                                    {credErrors.privateKey}
                                  </p>
                                )}
                              </div>
                              <div>
                                <Label className="text-xs mb-1.5 block">
                                  Passphrase (Optional)
                                </Label>
                                <Input
                                  type="password"
                                  value={privateKeyPassphrase}
                                  onChange={(e) =>
                                    setPrivateKeyPassphrase(e.target.value)
                                  }
                                  placeholder="••••••••"
                                  className="bg-background"
                                />
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </div>

                    {/* Connection Settings */}
                    <div className="space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        ⚙️ Installation Settings
                      </h3>
                      <Card className="border-dashed shadow-none bg-muted/5">
                        <CardContent className="pt-4 space-y-4">
                          <div>
                            <Label className="text-xs mb-1.5 block">
                              Agent Server URL
                            </Label>
                            <Input
                              value={serverBaseUrl}
                              onChange={(e) =>
                                handleServerBaseUrlChange(e.target.value)
                              }
                              className="font-mono text-xs bg-background"
                              placeholder="http://..."
                            />
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                              The address the agent will use to call back home (origin only — no <span className="font-mono">/api</span> or <span className="font-mono">/hubs/agent</span>).
                            </p>
                          </div>

                          <div className="flex flex-col gap-3 py-1">
                            <label className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={trustHostKey}
                                onChange={(e) =>
                                  setTrustHostKey(e.target.checked)
                                }
                              />
                              <div className="space-y-0.5">
                                <span className="text-sm font-medium leading-none">
                                  Trust Host Key (TOFU)
                                </span>
                                <p className="text-xs text-muted-foreground">
                                  Automatically accept the SSH fingerprint.
                                </p>
                                {selected.hostKeyFingerprint && (
                                  <div className="inline-block mt-1 px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono break-all text-muted-foreground border">
                                    {selected.hostKeyFingerprint}
                                  </div>
                                )}
                              </div>
                            </label>

                            <label className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border">
                              <input
                                type="checkbox"
                                checked={forceInstall}
                                onChange={(e) =>
                                  setForceInstall(e.target.checked)
                                }
                              />
                              <span className="text-sm font-medium leading-none">
                                Force Re-install
                              </span>
                            </label>

                            <label className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer transition-colors border border-transparent hover:border-border">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={runAsRoot}
                                onChange={(e) =>
                                  setRunAsRoot(e.target.checked)
                                }
                              />
                              <div className="space-y-0.5">
                                <span className="text-sm font-medium leading-none">
                                  Run agent as root
                                </span>
                                <p className="text-xs text-muted-foreground">
                                  Required for system updates without passwordless sudo. 
                                  Less secure but enables full management capabilities (package updates, service control).
                                </p>
                              </div>
                            </label>
                          </div>

                          <div>
                            <Label className="text-xs mb-1.5 block">
                              Sudo Password (Optional)
                            </Label>
                            <Input
                              type="password"
                              value={sudoPassword}
                              onChange={(e) => setSudoPassword(e.target.value)}
                              placeholder="••••••••"
                              className="bg-background"
                            />
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                              Only needed for Linux if the SSH user requires a password for sudo. Leave empty if running as root or if passwordless sudo is configured.
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      disabled={isBusy}
                      onClick={() => {
                        if (validateCredentials()) testMutation.mutate();
                      }}
                      className="min-w-30"
                    >
                      {testMutation.isPending
                        ? "Testing..."
                        : "Test Connection"}
                    </Button>

                    <div className="h-6 w-px bg-border mx-1" />

                    <ConfirmationModal
                      trigger={
                        <Button
                          disabled={isBusy || !lastTest?.success}
                          onClick={(e) => {
                            if (!validateCredentials()) {
                              e.preventDefault();
                              e.stopPropagation();
                            }
                          }}
                          className="min-w-25"
                        >
                          Install Agent
                        </Button>
                      }
                      title="Install ManLab Agent"
                      message={`Connect to ${selected.host} and install agent? Target must have root/sudo access.`}
                      confirmText="Install"
                      isLoading={installMutation.isPending}
                      onConfirm={async () => {
                        if (!validateCredentials()) return;
                        setLogs([]);
                        await installMutation.mutateAsync();
                      }}
                    />

                    <ConfirmationModal
                      trigger={
                        <Button
                          variant="ghost"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          disabled={isBusy || !(lastTest?.success || lastTest?.hasExistingInstallation)}
                          onClick={() => {
                            // Best-effort: prefetch remote inventory so the confirmation dialog
                            // can show an accurate preview of what will be removed.
                            if (validateCredentials() && !previewUninstallMutation.isPending) {
                              previewUninstallMutation.mutate();
                            }
                          }}
                        >
                          Uninstall
                        </Button>
                      }
                      title="Uninstall Agent"
                      message={`Remove ManLab agent from ${selected.host}?`}
                      details={uninstallPreview}
                      confirmText="Uninstall"
                      isLoading={uninstallMutation.isPending}
                      onConfirm={async () => {
                        setLogs([]);
                        await uninstallMutation.mutateAsync();
                      }}
                    />

                    {lastTest?.error && (
                      <span
                        className="text-xs font-mono text-destructive ml-auto max-w-xs truncate"
                        title={lastTest.error}
                      >
                        Error: {lastTest.error}
                      </span>
                    )}
                    {lastTest?.success && (
                      <span className="text-xs font-mono text-green-600 ml-auto flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        Connection Verified (OS: {lastTest.osHint})
                        {lastTest.hasExistingInstallation && (
                          <span className="text-amber-600 ml-2">• Existing installation detected</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </ScrollArea>

              {/* Log Console Footer */}
              <div className="border-t bg-black text-white h-64 flex flex-col shrink-0">
                <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900 border-b border-neutral-800">
                  <span className="text-[10px] font-mono tracking-wider text-neutral-400 uppercase">
                    Terminal Output
                  </span>
                  <button
                    onClick={() => setLogs([])}
                    className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex-1 overflow-auto font-mono text-xs p-3">
                  {logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-neutral-600 space-y-2 select-none">
                      <Terminal className="h-8 w-8 opacity-20" />
                      <span className="italic">Waiting for job output...</span>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {logs.map((l, i) => (
                        <div
                          key={i}
                          className="flex gap-2 hover:bg-neutral-900/50 -mx-1 px-1 rounded-sm"
                        >
                          <span className="text-neutral-600 select-none w-16 shrink-0">
                            {new Date(l.ts).toLocaleTimeString([], {
                              hour12: false,
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                          <span
                            className={cn(
                              "break-all whitespace-pre-wrap flex-1",
                              l.msg.toLowerCase().includes("error") ||
                                l.msg.toLowerCase().includes("failed")
                                ? "text-red-400 font-semibold"
                                : l.msg.toLowerCase().includes("success")
                                ? "text-green-400"
                                : "text-neutral-300"
                            )}
                          >
                            {l.msg}
                          </span>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
