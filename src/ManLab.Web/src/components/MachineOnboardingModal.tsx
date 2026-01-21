import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOnboardingMachine,
  fetchOnboardingMachines,
  fetchNodes,
  fetchSuggestedServerBaseUrl,
  fetchUninstallPreview,
  installAgent,
  shutdownAgent,
  testSshConnection,
  uninstallAgent,
  deleteOnboardingMachine,
  saveMachineCredentials,
  clearMachineCredentials,
  updateMachineConfiguration,
  deleteNode,
} from "../api";
import type {
  Node,
  OnboardingMachine,
  OnboardingStatus,
  SshAuthMode,
  SshTestResponse,
  UninstallPreviewResponse,
  SaveCredentialsRequest,
  UpdateConfigurationRequest,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Terminal, Trash2, ChevronDown, Plus, X, Settings2, Key } from "lucide-react";
import { AgentVersionPicker, type AgentVersionSelection } from "@/components/AgentVersionPicker";

const EMPTY_MACHINES: OnboardingMachine[] = [];

const INSTALL_TARGET_NEW = "__new__";

const normalizeHostKey = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();

const getAssociatedNodesForMachine = (machine: OnboardingMachine, nodes: Node[]): Node[] => {
  const hostKey = normalizeHostKey(machine.host);
  const linkedNodeId = machine.linkedNodeId;

  const matches = nodes.filter((n) => {
    if (linkedNodeId && n.id === linkedNodeId) return true;
    if (!hostKey) return false;
    if (normalizeHostKey(n.hostname) === hostKey) return true;
    if (normalizeHostKey(n.ipAddress) === hostKey) return true;
    return false;
  });

  // De-dupe by id while preserving stable ordering.
  const seen = new Set<string>();
  const unique: Node[] = [];
  for (const n of matches)
  {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }

  return unique;
};

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

  const [open, setOpen] = useState(false);

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
  const [trustHostKey, setTrustHostKey] = useState(true);
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [lastTest, setLastTest] = useState<SshTestResponse | null>(null);
  // Use a ref to track if user has manually edited the server base URL
  const serverBaseUrlDirtyRef = useRef(false);
  const [serverBaseUrlOverride, setServerBaseUrlOverride] = useState<
    string | null
  >(null);
  const [forceInstall, setForceInstall] = useState(true);
  const [runAsRoot, setRunAsRoot] = useState(false);
  const [sudoPassword, setSudoPassword] = useState("");

  // Agent version selection (used for installs from this modal)
  const [agentChannel, setAgentChannel] = useState("stable");
  const [agentSelection, setAgentSelection] = useState<AgentVersionSelection>({
    source: "github",
    version: "",
    channel: "stable",
  });

  useEffect(() => {
    setAgentSelection((prev) => ({ ...prev, channel: agentChannel }));
  }, [agentChannel]);

  // Track configuration changes to auto-save them
  const prevTrustHostKey = useRef(trustHostKey);
  const prevForceInstall = useRef(forceInstall);
  const prevRunAsRoot = useRef(runAsRoot);
  const prevServerBaseUrlOverride = useRef(serverBaseUrlOverride);

  // Update refs when values change
  useEffect(() => {
    prevTrustHostKey.current = trustHostKey;
  }, [trustHostKey]);

  useEffect(() => {
    prevForceInstall.current = forceInstall;
  }, [forceInstall]);

  useEffect(() => {
    prevRunAsRoot.current = runAsRoot;
  }, [runAsRoot]);

  useEffect(() => {
    prevServerBaseUrlOverride.current = serverBaseUrlOverride;
  }, [serverBaseUrlOverride]);

  const [logs, setLogs] = useState<Array<{ ts: string; msg: string }>>([]);

  const [remoteUninstallPreview, setRemoteUninstallPreview] = useState<UninstallPreviewResponse | null>(null);
  // Track whether the user started an uninstall from this modal so we can prompt on completion.
  const pendingUninstallMachineIdRef = useRef<string | null>(null);
  const pendingUninstallLinkedNodeIdRef = useRef<string | null>(null);
  const pendingUninstallHostRef = useRef<string | null>(null);
  // Track the status transition so we don't prompt immediately if the machine was already Succeeded
  // from a previous operation (e.g., install).
  const pendingUninstallSawRunningRef = useRef(false);
  const pendingUninstallInitialStatusRef = useRef<OnboardingStatus | null>(null);

  const [removeNodesPromptOpen, setRemoveNodesPromptOpen] = useState(false);
  const [removeNodesPrompt, setRemoveNodesPrompt] = useState<{
    machineId: string;
    host: string;
    nodeIds: string[];
    linkedNodeId: string | null;
  } | null>(null);
  const [removeNodesSelectedIds, setRemoveNodesSelectedIds] = useState<string[]>([]);

  const [stopExistingAgentFirst, setStopExistingAgentFirst] = useState(true);
  // Allows the user to attach an install to an existing node identity (update mode).
  // Default behavior: create a new node identity unless the machine is already linked.
  const [installTargetNodeId, setInstallTargetNodeId] = useState<string>(INSTALL_TARGET_NEW);
  const installTargetDirtyRef = useRef(false);

  useEffect(() => {
    // Reset per-machine selection edits.
    installTargetDirtyRef.current = false;
  }, [selected?.id]);

  const MASKED_SECRET = "•••••";
  const isMaskedSecret = (value: string | null | undefined) => (value ?? "") === MASKED_SECRET;

  const nodesQuery = useQuery<Node[]>({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 15_000,
    enabled: open,
  });

  const existingNode = useMemo(() => {
    if (!selected) return null;
    const nodes = nodesQuery.data;
    if (!nodes || nodes.length === 0) return null;

    const host = (selected.host ?? "").trim().toLowerCase();
    if (!host) return null;

    return (
      nodes.find((n) => (n.hostname ?? "").trim().toLowerCase() === host) ??
      nodes.find((n) => (n.ipAddress ?? "").trim().toLowerCase() === host) ??
      null
    );
  }, [nodesQuery.data, selected]);

  const nodeLinkOwners = useMemo(() => {
    // Map nodeId -> onboarding machine that claims it.
    const m = new Map<string, OnboardingMachine>();
    for (const machine of machines)
    {
      if (!machine.linkedNodeId) continue;
      m.set(machine.linkedNodeId, machine);
    }
    return m;
  }, [machines]);

  const isNodeEligibleForInstallTarget = useMemo(() => {
    const selectedMachineId = selected?.id;
    return (nodeId: string): boolean => {
      const owner = nodeLinkOwners.get(nodeId);
      if (!owner) return true;
      return owner.id === selectedMachineId;
    };
  }, [nodeLinkOwners, selected?.id]);

  // Pick a sensible default target:
  // - if machine already linked, keep that
  // - else if we detected a matching node for this host and it's eligible, suggest it
  // - else create a new node
  useEffect(() => {
    if (!selected)
    {
      setInstallTargetNodeId(INSTALL_TARGET_NEW);
      return;
    }

    if (installTargetDirtyRef.current)
    {
      return;
    }

    const linked = selected.linkedNodeId;
    if (linked)
    {
      setInstallTargetNodeId(linked);
      return;
    }

    const detected = existingNode?.id;
    if (detected && isNodeEligibleForInstallTarget(detected))
    {
      setInstallTargetNodeId(detected);
      return;
    }

    setInstallTargetNodeId(INSTALL_TARGET_NEW);
  }, [existingNode?.id, isNodeEligibleForInstallTarget, selected, selected?.id, selected?.linkedNodeId]);

  const eligibleInstallTargetNodes = useMemo(() => {
    const nodes = nodesQuery.data ?? [];
    if (!selected) return [];

    return nodes
      .filter((n) => isNodeEligibleForInstallTarget(n.id))
      .sort((a, b) => {
        // Prefer detected node first, then hostname.
        const detectedId = existingNode?.id;
        if (detectedId && a.id === detectedId && b.id !== detectedId) return -1;
        if (detectedId && b.id === detectedId && a.id !== detectedId) return 1;

        const ah = (a.hostname ?? "").toLowerCase();
        const bh = (b.hostname ?? "").toLowerCase();
        return ah.localeCompare(bh);
      });
  }, [existingNode?.id, isNodeEligibleForInstallTarget, nodesQuery.data, selected]);

  const ineligibleInstallTargetNodes = useMemo(() => {
    const nodes = nodesQuery.data ?? [];
    if (!selected) return [];
    return nodes
      .filter((n) => !isNodeEligibleForInstallTarget(n.id))
      .sort((a, b) => {
        const ah = (a.hostname ?? "").toLowerCase();
        const bh = (b.hostname ?? "").toLowerCase();
        return ah.localeCompare(bh);
      });
  }, [isNodeEligibleForInstallTarget, nodesQuery.data, selected]);

  const installTargetNode = useMemo(() => {
    if (installTargetNodeId === INSTALL_TARGET_NEW) return null;
    const nodes = nodesQuery.data ?? [];
    return nodes.find((n) => n.id === installTargetNodeId) ?? null;
  }, [installTargetNodeId, nodesQuery.data]);

  const existingNodeId = useMemo(() => {
    if (!selected) return null;
    return selected.linkedNodeId ?? existingNode?.id ?? null;
  }, [existingNode?.id, selected]);

  const hasExistingAgent = Boolean(existingNodeId) || Boolean(lastTest?.hasExistingInstallation);

  const previewUninstallMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      if (!lastTest?.success) throw new Error("Test connection first");

      const useSavedAuth =
        selected.hasSavedCredentials === true &&
        (selected.authMode === "Password"
          ? (!password || password === "•••••")
          : (!privateKeyPem || privateKeyPem === "•••••"));

      const useSavedSudo =
        selected.hasSavedSudoPassword === true &&
        (!sudoPassword || sudoPassword === "•••••");

      const useSavedCredentials = useSavedAuth || useSavedSudo;
      return fetchUninstallPreview(selected.id, {
        serverBaseUrl,
        trustHostKey,
        password: useSavedAuth ? undefined : (password || undefined),
        privateKeyPem: useSavedAuth ? undefined : (privateKeyPem || undefined),
        privateKeyPassphrase: useSavedAuth ? undefined : (privateKeyPassphrase || undefined),
        sudoPassword: useSavedSudo ? undefined : (sudoPassword || undefined),
        useSavedCredentials,
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
    const suggested = suggestedServerBaseUrlQuery.data?.serverBaseUrl?.trim();
    if (suggested) {
      return suggested;
    }
    return import.meta.env.VITE_API_URL ?? window.location.origin;
  }, [serverBaseUrlOverride, suggestedServerBaseUrlQuery.data]);

  const effectiveServerBaseUrl = useMemo(
    () => normalizeAgentServerBaseUrl(serverBaseUrl),
    [serverBaseUrl]
  );

  // Collect all available server URLs from different sources for the dropdown
  const availableServerUrls = useMemo(() => {
    const urlSet = new Set<string>();

    // Add URLs detected from existing installation (from last test connection)
    if (lastTest?.detectedServerUrls) {
      for (const url of lastTest.detectedServerUrls) {
        const normalized = normalizeAgentServerBaseUrl(url);
        if (normalized) urlSet.add(normalized);
      }
    }

    // Add all suggested URLs from backend
    if (suggestedServerBaseUrlQuery.data?.allServerUrls) {
      for (const url of suggestedServerBaseUrlQuery.data.allServerUrls) {
        const normalized = normalizeAgentServerBaseUrl(url);
        if (normalized) urlSet.add(normalized);
      }
    }

    // Add environment variable URL
    if (import.meta.env.VITE_SERVER_BASE_URL) {
      const normalized = normalizeAgentServerBaseUrl(import.meta.env.VITE_SERVER_BASE_URL as string);
      if (normalized) urlSet.add(normalized);
    }

    // Add window origin as fallback
    const originNormalized = normalizeAgentServerBaseUrl(window.location.origin);
    if (originNormalized) urlSet.add(originNormalized);

    // Add the current value if it's a user override
    if (serverBaseUrlOverride) {
      const normalized = normalizeAgentServerBaseUrl(serverBaseUrlOverride);
      if (normalized) urlSet.add(normalized);
    }

    return Array.from(urlSet);
  }, [lastTest?.detectedServerUrls, suggestedServerBaseUrlQuery.data, serverBaseUrlOverride]);

  // Track if user wants to use custom URL not in the list
  const [useCustomUrl, setUseCustomUrl] = useState(false);
  // Handler to update server base URL when user edits
  const handleServerBaseUrlChange = (value: string) => {
    serverBaseUrlDirtyRef.current = true;
    setServerBaseUrlOverride(value);
  };

  const selectMachine = (id: string) => {
    const machine = machines.find((m) => m.id === id);
    setSelectedId(id);
    setLogs([]);
    setLastTest(null);
    setRemoteUninstallPreview(null);
    setCredErrors({});

    if (!machine) return;

    // Reset credentials state - they'll be loaded from saved if available
    setPassword(machine.hasSavedCredentials ? "•••••" : "");
    setPrivateKeyPem(machine.hasSavedCredentials ? "•••••" : "");
    setPrivateKeyPassphrase("");
    // Show masked sudo password if saved, otherwise empty
    setSudoPassword(machine.hasSavedSudoPassword ? "•••••" : "");
    setRememberCredentials(false);

    // Load saved configuration preferences
    // Default Trust Host Key to true for a better first-run experience.
    const nextTrustHostKey = machine.trustHostKey ?? true;
    const nextForceInstall = machine.forceInstall ?? true;
    // If sudo password is saved, ensure runAsRoot is also checked
    const nextRunAsRoot = machine.hasSavedSudoPassword ? true : (machine.runAsRoot ?? false);
    const nextServerBaseUrlOverride = machine.serverBaseUrlOverride ?? null;

    // IMPORTANT: prevent the auto-save effect from firing just because we hydrated state
    // from another machine. We sync the "prev" refs to the hydrated values here.
    prevTrustHostKey.current = nextTrustHostKey;
    prevForceInstall.current = nextForceInstall;
    prevRunAsRoot.current = nextRunAsRoot;
    prevServerBaseUrlOverride.current = nextServerBaseUrlOverride;

    setTrustHostKey(nextTrustHostKey);
    setForceInstall(nextForceInstall);
    setRunAsRoot(nextRunAsRoot);

    // Load saved serverBaseUrl override
    if (nextServerBaseUrlOverride) {
      setServerBaseUrlOverride(nextServerBaseUrlOverride);
      serverBaseUrlDirtyRef.current = true;
    } else {
      setServerBaseUrlOverride(null);
      serverBaseUrlDirtyRef.current = false;
    }
    setUseCustomUrl(false);
  };

  // Hydrate the form for the implicitly selected first machine.
  // Without this, `selected` can be machines[0] while the input state remains blank until a click,
  // leading to "Missing SSH credentials" even though credentials are saved.
  useEffect(() => {
    if (selectedId) return;
    if (machines.length === 0) return;
    selectMachine(machines[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines, selectedId]);

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

      const useSavedAuth =
        selected.hasSavedCredentials === true &&
        (selected.authMode === "Password"
          ? (!password || password === "•••••")
          : (!privateKeyPem || privateKeyPem === "•••••"));

      const useSavedSudo =
        selected.hasSavedSudoPassword === true &&
        (!sudoPassword || sudoPassword === "•••••");

      const useSavedCredentials = useSavedAuth || useSavedSudo;
      return testSshConnection(selected.id, {
        password: useSavedAuth ? undefined : (password || undefined),
        privateKeyPem: useSavedAuth ? undefined : (privateKeyPem || undefined),
        privateKeyPassphrase: useSavedAuth ? undefined : (privateKeyPassphrase || undefined),
        sudoPassword: useSavedSudo ? undefined : (sudoPassword || undefined),
        trustHostKey,
        useSavedCredentials,
      });
    },
    onSuccess: async (res) => {
      setLastTest(res);
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      if (res.success) {
        toast.success("SSH Connection Verified", {
          description: `Connected as ${res.whoAmI} on ${res.osHint}`,
        });

        // Auto-save credentials when the user opted into remembering them.
        // This avoids a separate manual "Save Credentials" step after verification.
        if (rememberCredentials && selected) {
          const payload: SaveCredentialsRequest = {
            password:
              selected.authMode === "Password" && password && !isMaskedSecret(password)
                ? password
                : undefined,
            privateKeyPem:
              selected.authMode === "PrivateKey" && privateKeyPem && !isMaskedSecret(privateKeyPem)
                ? privateKeyPem
                : undefined,
            privateKeyPassphrase:
              selected.authMode === "PrivateKey" && privateKeyPassphrase
                ? privateKeyPassphrase
                : undefined,
            sudoPassword:
              sudoPassword && !isMaskedSecret(sudoPassword)
                ? sudoPassword
                : undefined,
          };

          const hasAnythingToSave = Boolean(
            payload.password ||
              payload.privateKeyPem ||
              payload.privateKeyPassphrase ||
              payload.sudoPassword
          );

          // If there is nothing new to save, skip.
          if (hasAnythingToSave) {
            autoSaveCredentialsMutation.mutate(payload);
          }
        }
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

  // A dedicated mutation for auto-save (silent success to avoid toast spam).
  const autoSaveCredentialsMutation = useMutation({
    mutationFn: async (input: SaveCredentialsRequest) => {
      if (!selected) throw new Error("No machine selected");
      return saveMachineCredentials(selected.id, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });

      // Reflect saved state in the UI.
      if (selected?.authMode === "Password") {
        if (password && !isMaskedSecret(password)) setPassword(MASKED_SECRET);
      } else {
        if (privateKeyPem && !isMaskedSecret(privateKeyPem)) setPrivateKeyPem(MASKED_SECRET);
      }

      if (sudoPassword && !isMaskedSecret(sudoPassword)) {
        setSudoPassword(MASKED_SECRET);
        setRunAsRoot(true);
      }
    },
    onError: (err) => {
      // Non-blocking: verification succeeded, but saving failed.
      toast.warning("SSH verified but credentials were not saved", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const installMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");

      const useSavedAuth =
        selected.hasSavedCredentials === true &&
        (selected.authMode === "Password"
          ? (!password || password === "•••••")
          : (!privateKeyPem || privateKeyPem === "•••••"));

      const useSavedSudo =
        selected.hasSavedSudoPassword === true &&
        (!sudoPassword || sudoPassword === "•••••");

      const useSavedCredentials = useSavedAuth || useSavedSudo;

      const effectiveForce = hasExistingAgent ? true : forceInstall;
      return installAgent(selected.id, {
        serverBaseUrl: effectiveServerBaseUrl,
        targetNodeId: installTargetNodeId !== INSTALL_TARGET_NEW ? installTargetNodeId : undefined,
        force: effectiveForce,
        runAsRoot,
        trustHostKey,
        agentSource: agentSelection.source,
        agentChannel,
        agentVersion: agentSelection.version,
        password: useSavedAuth ? undefined : (password || undefined),
        privateKeyPem: useSavedAuth ? undefined : (privateKeyPem || undefined),
        privateKeyPassphrase: useSavedAuth ? undefined : (privateKeyPassphrase || undefined),
        sudoPassword: useSavedSudo ? undefined : (sudoPassword || undefined),
        useSavedCredentials,
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

  const stopExistingAgentMutation = useMutation({
    mutationFn: async (nodeId: string) => {
      await shutdownAgent(nodeId);
    },
    onError: (err) => {
      toast.warning("Could not request existing agent shutdown", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");

      const useSavedAuth =
        selected.hasSavedCredentials === true &&
        (selected.authMode === "Password"
          ? (!password || password === "•••••")
          : (!privateKeyPem || privateKeyPem === "•••••"));

      const useSavedSudo =
        selected.hasSavedSudoPassword === true &&
        (!sudoPassword || sudoPassword === "•••••");

      const useSavedCredentials = useSavedAuth || useSavedSudo;
      return uninstallAgent(selected.id, {
        serverBaseUrl: effectiveServerBaseUrl,
        trustHostKey,
        password: useSavedAuth ? undefined : (password || undefined),
        privateKeyPem: useSavedAuth ? undefined : (privateKeyPem || undefined),
        privateKeyPassphrase: useSavedAuth ? undefined : (privateKeyPassphrase || undefined),
        sudoPassword: useSavedSudo ? undefined : (sudoPassword || undefined),
        useSavedCredentials,
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

  const deleteAssociatedNodesMutation = useMutation({
    mutationFn: async (nodeIds: string[]) => {
      const succeeded: string[] = [];
      const failed: Array<{ id: string; error: unknown }> = [];

      for (const id of nodeIds)
      {
        try
        {
          await deleteNode(id);
          succeeded.push(id);
        }
        catch (error)
        {
          failed.push({ id, error });
        }
      }

      return { succeeded, failed };
    },
    onSuccess: async (result) => {
      // Node deletion may also remove linked onboarding machine server-side.
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });

      if (result.succeeded.length > 0)
      {
        toast.success(
          result.succeeded.length === 1 ? "Node removed" : `Removed ${result.succeeded.length} nodes`
        );
      }

      if (result.failed.length > 0)
      {
        toast.error("Some nodes could not be removed", {
          description: `${result.failed.length} failed. You can retry removing the remaining nodes.`,
        });
        setRemoveNodesSelectedIds(result.failed.map((x) => x.id));
        return;
      }

      // If we deleted the linked node for the selected machine, selection may disappear; reset.
      if (
        removeNodesPrompt?.machineId &&
        selectedId === removeNodesPrompt.machineId &&
        removeNodesPrompt.linkedNodeId &&
        result.succeeded.includes(removeNodesPrompt.linkedNodeId)
      )
      {
        setSelectedId(null);
      }

      setRemoveNodesPromptOpen(false);
      setRemoveNodesPrompt(null);
      setRemoveNodesSelectedIds([]);
    },
    onError: (err) => {
      toast.error("Failed to delete node(s)", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  // When an uninstall we started completes successfully, prompt to delete associated node(s).
  useEffect(() => {
    const machineId = pendingUninstallMachineIdRef.current;
    if (!machineId) return;

    const m = machines.find((x) => x.id === machineId);
    if (!m) return;

    if (m.status === "Running")
    {
      pendingUninstallSawRunningRef.current = true;
      return;
    }

    if (m.status === "Failed") {
      pendingUninstallMachineIdRef.current = null;
      pendingUninstallLinkedNodeIdRef.current = null;
      pendingUninstallHostRef.current = null;
      pendingUninstallSawRunningRef.current = false;
      pendingUninstallInitialStatusRef.current = null;
      return;
    }

    if (m.status !== "Succeeded") return;

    // Avoid a false-positive prompt if the machine was already "Succeeded" before uninstall started
    // and we haven't observed the uninstall job transition through Running.
    const initialStatus = pendingUninstallInitialStatusRef.current;
    if (initialStatus === "Succeeded" && pendingUninstallSawRunningRef.current !== true)
    {
      return;
    }

    pendingUninstallMachineIdRef.current = null;

    const linkedNodeId = pendingUninstallLinkedNodeIdRef.current ?? m.linkedNodeId;
    const host = pendingUninstallHostRef.current ?? m.host;

    pendingUninstallLinkedNodeIdRef.current = null;
    pendingUninstallHostRef.current = null;
    pendingUninstallSawRunningRef.current = false;
    pendingUninstallInitialStatusRef.current = null;

    const nodes = nodesQuery.data;
    const associatedNodeIds = (() => {
      // Prefer a full association scan when nodes are available.
      if (nodes && nodes.length > 0)
      {
        const associatedNodes = getAssociatedNodesForMachine(m, nodes);
        const ids = associatedNodes.map((n) => n.id);
        // Always include linked node id if present, even if it wasn't in the list.
        if (linkedNodeId && !ids.includes(linkedNodeId)) ids.unshift(linkedNodeId);
        return ids;
      }

      // Fallback: if we at least know the linked node, prompt with that.
      if (linkedNodeId)
      {
        return [linkedNodeId];
      }

      return [];
    })();

    // Only prompt if there is at least one associated node.
    if (associatedNodeIds.length > 0)
    {
      setRemoveNodesPrompt({
        machineId: m.id,
        host,
        nodeIds: associatedNodeIds,
        linkedNodeId: linkedNodeId ?? null,
      });

      // Preselect the linked node if present; otherwise select all.
      const initialSelected =
        linkedNodeId && associatedNodeIds.includes(linkedNodeId)
          ? [linkedNodeId]
          : associatedNodeIds;
      setRemoveNodesSelectedIds(initialSelected);
      setRemoveNodesPromptOpen(true);
    }
  }, [machines, nodesQuery.data]);

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

  // Mutation to save credentials
  const saveCredentialsMutation = useMutation({
    mutationFn: async (input: SaveCredentialsRequest) => {
      if (!selected) throw new Error("No machine selected");
      return saveMachineCredentials(selected.id, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });

      // Reflect saved state in the UI (without requiring a re-select).
      if (selected?.authMode === "Password") {
        setPassword("•••••");
      } else {
        setPrivateKeyPem("•••••");
      }

      if (sudoPassword) {
        setSudoPassword("•••••");
        setRunAsRoot(true);
      }

      toast.success("Credentials saved");
    },
    onError: (err) => {
      toast.error("Failed to save credentials", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  // Mutation to clear credentials
  const clearCredentialsMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      return clearMachineCredentials(selected.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      setRememberCredentials(false);

      // Clear local input state as well.
      setPassword("");
      setPrivateKeyPem("");
      setPrivateKeyPassphrase("");
      setSudoPassword("");

      toast.success("Credentials cleared");
    },
    onError: (err) => {
      toast.error("Failed to clear credentials", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  // Mutation to update configuration
  const updateConfigurationMutation = useMutation({
    mutationFn: async (input: UpdateConfigurationRequest) => {
      if (!selected) throw new Error("No machine selected");
      return updateMachineConfiguration(selected.id, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      // Silent auto-save - no toast to avoid noise
    },
    onError: (err) => {
      toast.error("Failed to update configuration", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  // Auto-save configuration when settings change
  useEffect(() => {
    if (!selected) return;

    const hasTrustHostKeyChanged = prevTrustHostKey.current !== trustHostKey;
    const hasForceInstallChanged = prevForceInstall.current !== forceInstall;
    const hasRunAsRootChanged = prevRunAsRoot.current !== runAsRoot;
    const hasServerBaseUrlOverrideChanged = prevServerBaseUrlOverride.current !== serverBaseUrlOverride;

    if (hasTrustHostKeyChanged || hasForceInstallChanged || hasRunAsRootChanged || hasServerBaseUrlOverrideChanged) {
      updateConfigurationMutation.mutate({
        trustHostKey: hasTrustHostKeyChanged ? trustHostKey : undefined,
        forceInstall: hasForceInstallChanged ? forceInstall : undefined,
        runAsRoot: hasRunAsRootChanged ? runAsRoot : undefined,
        serverBaseUrlOverride: hasServerBaseUrlOverrideChanged ? serverBaseUrlOverride : undefined,
      });
    }
  }, [trustHostKey, forceInstall, runAsRoot, serverBaseUrlOverride, selected, updateConfigurationMutation]);

  const isBusy =
    createMachineMutation.isPending ||
    deleteMachineMutation.isPending ||
    testMutation.isPending ||
    installMutation.isPending ||
    uninstallMutation.isPending ||
    saveCredentialsMutation.isPending ||
    clearCredentialsMutation.isPending ||
    updateConfigurationMutation.isPending;

  const isRemovingNodes = deleteAssociatedNodesMutation.isPending;

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
    
    // If credentials are saved, we can use them (represented by "•••••" in the field)
    // Otherwise, require actual input
    if (selected.authMode === "Password") {
      // "•••••" indicates saved credentials, or require actual password input
      if (!password && !selected.hasSavedCredentials) {
        errors.password = "Password is required";
      }
    }
    if (selected.authMode === "PrivateKey") {
      // "•••••" indicates saved credentials, or require actual key input
      if (!privateKeyPem && !selected.hasSavedCredentials) {
        errors.privateKey = "Private key is required";
      }
    }
    setCredErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // State for collapsible sections
  const [addFormOpen, setAddFormOpen] = useState(machines.length === 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="w-[95vw] sm:max-w-[80vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col md:flex-row"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Machine Onboarding</DialogTitle>
        {/* Left Sidebar: Compact Machine List */}
        <div className="w-full md:w-64 shrink-0 flex flex-col border-r bg-muted/5">
          <div className="px-3 py-2 border-b flex items-center justify-between bg-background">
            <h2 className="font-semibold text-xs tracking-tight">Machines</h2>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setAddFormOpen(!addFormOpen)}
              >
                <Plus className={cn("h-3.5 w-3.5 transition-transform", addFormOpen && "rotate-45")} />
              </Button>
              <DialogClose asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </DialogClose>
            </div>
          </div>

          {/* Compact Add Machine Form */}
          <Collapsible open={addFormOpen} onOpenChange={setAddFormOpen}>
            <CollapsibleContent>
              <div className="p-2 border-b space-y-2 bg-muted/10">
                <div className="flex gap-1">
                  <Input
                    value={host}
                    onChange={(e) => {
                      setHost(e.target.value);
                      if (addMachineErrors.host) setAddMachineErrors({ ...addMachineErrors, host: undefined });
                    }}
                    className={cn("h-7 text-xs font-mono flex-1", addMachineErrors.host && "border-destructive")}
                    placeholder="Host"
                  />
                  <Input
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="h-7 text-xs font-mono w-14"
                    placeholder="22"
                  />
                </div>
                <div className="flex gap-1">
                  <Input
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (addMachineErrors.username) setAddMachineErrors({ ...addMachineErrors, username: undefined });
                    }}
                    className={cn("h-7 text-xs font-mono flex-1", addMachineErrors.username && "border-destructive")}
                    placeholder="user"
                  />
                  <Select value={authMode} onValueChange={(value) => setAuthMode(value as SshAuthMode)}>
                    <SelectTrigger className="h-7 text-xs w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PrivateKey">Key</SelectItem>
                      <SelectItem value="Password">Pass</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(addMachineErrors.host || addMachineErrors.username) && (
                  <p className="text-[10px] text-destructive">{addMachineErrors.host || addMachineErrors.username}</p>
                )}
                {createMachineMutation.isError && (
                  <p className="text-[10px] text-destructive">
                    {createMachineMutation.error instanceof Error ? createMachineMutation.error.message : "Failed"}
                  </p>
                )}
                <Button
                  size="sm"
                  className="w-full h-7 text-xs"
                  disabled={isBusy}
                  onClick={() => {
                    if (!validateAddMachine()) return;
                    createMachineMutation.mutate({
                      host: host.trim(),
                      port: Number(port || "22"),
                      username: username.trim(),
                      authMode,
                      trustHostKey: true,
                      forceInstall: true,
                      runAsRoot: false,
                      serverBaseUrlOverride: null,
                    });
                  }}
                >
                  Add
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Machine List */}
          <ScrollArea className="flex-1">
            <div className="p-1 space-y-0.5">
              {machinesQuery.isLoading && (
                <div className="p-3 text-xs text-center text-muted-foreground">Loading...</div>
              )}
              {machines.map((m) => (
                <div key={m.id} className="relative group">
                  <button
                    onClick={() => selectMachine(m.id)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded text-xs transition-all hover:bg-muted/50",
                      selected?.id === m.id ? "bg-muted border-l-2 border-primary" : "bg-transparent"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-medium truncate">{m.host}</span>
                      <Badge variant={getStatusVariant(m.status)} className="text-[9px] h-4 px-1 scale-90">
                        {m.status}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{m.username}:{m.port}</div>
                  </button>
                  <ConfirmationModal
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-0.5 top-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    }
                    title="Remove Machine"
                    message={`Remove ${m.host}?`}
                    confirmText="Remove"
                    isDestructive
                    isLoading={deleteMachineMutation.isPending}
                    onConfirm={async () => {
                      await deleteMachineMutation.mutateAsync(m.id);
                      if (selectedId === m.id) setSelectedId(null);
                    }}
                  />
                </div>
              ))}
              {machines.length === 0 && !machinesQuery.isLoading && (
                <div className="p-4 text-center text-xs text-muted-foreground">No machines</div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right Content: Selected Machine Details */}
        <div className="flex-1 flex flex-col h-full bg-background relative">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6">
              <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-3 text-xl">⚡</div>
              <h3 className="font-medium text-sm">Select a machine</h3>
              <p className="text-xs mt-1 text-center max-w-xs opacity-70">
                Choose a machine from the list to configure and install the agent.
              </p>
            </div>
          ) : (
            <>
              {/* Compact Header */}
              <div className="px-4 py-2 border-b flex items-center justify-between bg-background">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-bold tracking-tight font-mono">{selected.host}</h2>
                  <Badge variant={getStatusVariant(selected.status)} className="text-[10px] h-5">
                    {selected.status}
                  </Badge>
                  {lastTest?.success && (
                    <span className="text-[10px] font-mono text-green-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      {lastTest.osHint}
                      {lastTest.hasExistingInstallation && <span className="text-amber-600 ml-1">• Installed</span>}
                    </span>
                  )}
                </div>
              </div>

              {/* Main Content */}
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-3">
                  {/* Credentials Section - Collapsible */}
                  <Collapsible defaultOpen>
                    <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors w-full">
                      <Key className="h-3 w-3" />
                      <span>Credentials</span>
                      <ChevronDown className="h-3 w-3 ml-auto transition-transform in-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 rounded-md border bg-muted/5">
                        {selected.authMode === "Password" ? (
                          <div>
                            <Label className="text-[10px] mb-1 block text-muted-foreground">SSH Password</Label>
                            <Input
                              type="password"
                              value={password}
                              onChange={(e) => {
                                setPassword(e.target.value);
                                if (credErrors.password) setCredErrors({ ...credErrors, password: undefined });
                              }}
                              placeholder="••••••••"
                              className={cn("h-8 text-xs", credErrors.password && "border-destructive")}
                            />
                            {credErrors.password && <p className="text-[10px] text-destructive mt-0.5">{credErrors.password}</p>}
                          </div>
                        ) : (
                          <>
                            <div className="md:col-span-2">
                              <Label className="text-[10px] mb-1 block text-muted-foreground">Private Key (PEM)</Label>
                              <Textarea
                                value={privateKeyPem}
                                onChange={(e) => {
                                  setPrivateKeyPem(e.target.value);
                                  if (credErrors.privateKey) setCredErrors({ ...credErrors, privateKey: undefined });
                                }}
                                className={cn(
                                  "font-mono text-[10px] min-h-20 resize-none leading-tight",
                                  credErrors.privateKey && "border-destructive"
                                )}
                                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                              />
                              {credErrors.privateKey && <p className="text-[10px] text-destructive mt-0.5">{credErrors.privateKey}</p>}
                            </div>
                            <div>
                              <Label className="text-[10px] mb-1 block text-muted-foreground">Passphrase</Label>
                              <Input
                                type="password"
                                value={privateKeyPassphrase}
                                onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
                                placeholder="Optional"
                                className="h-8 text-xs"
                              />
                            </div>
                          </>
                        )}
                        <div>
                          <Label className="text-[10px] mb-1 block text-muted-foreground">Sudo Password</Label>
                          <Input
                            type="password"
                            value={sudoPassword}
                            onChange={(e) => {
                              const newPassword = e.target.value;
                              setSudoPassword(newPassword);
                              // Auto-check Run as root if sudo password is provided and not already checked
                              if (newPassword && !runAsRoot) {
                                setRunAsRoot(true);
                              }
                              // Auto-uncheck Run as root if sudo password is cleared
                              else if (!newPassword && runAsRoot) {
                                setRunAsRoot(false);
                              }
                            }}
                            placeholder="Optional"
                            className="h-8 text-xs"
                          />
                        </div>
                        <label className="flex items-center gap-2 text-xs cursor-pointer pt-2">
                          <Checkbox checked={rememberCredentials} onCheckedChange={(c) => setRememberCredentials(c === true)} />
                          <span>Remember credentials</span>
                        </label>
                        {rememberCredentials ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full h-7 text-xs mt-1"
                            disabled={saveCredentialsMutation.isPending || isBusy}
                            onClick={() => {
                              const payload: SaveCredentialsRequest = {
                                password:
                                  selected?.authMode === "Password" && password && !isMaskedSecret(password)
                                    ? password
                                    : undefined,
                                privateKeyPem:
                                  selected?.authMode === "PrivateKey" && privateKeyPem && !isMaskedSecret(privateKeyPem)
                                    ? privateKeyPem
                                    : undefined,
                                privateKeyPassphrase:
                                  selected?.authMode === "PrivateKey" && privateKeyPassphrase
                                    ? privateKeyPassphrase
                                    : undefined,
                                sudoPassword:
                                  sudoPassword && !isMaskedSecret(sudoPassword)
                                    ? sudoPassword
                                    : undefined,
                              };

                              const hasAnythingToSave = Boolean(
                                payload.password ||
                                  payload.privateKeyPem ||
                                  payload.privateKeyPassphrase ||
                                  payload.sudoPassword
                              );

                              if (!hasAnythingToSave) {
                                toast.info("No new credentials to save");
                                return;
                              }

                              saveCredentialsMutation.mutate({
                                ...payload,
                              });
                            }}
                          >
                            {saveCredentialsMutation.isPending ? "Saving..." : "Save Credentials"}
                          </Button>
                        ) : (selected?.hasSavedCredentials) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full h-7 text-xs mt-1"
                            disabled={clearCredentialsMutation.isPending || isBusy}
                            onClick={() => {
                              clearCredentialsMutation.mutate();
                            }}
                          >
                            {clearCredentialsMutation.isPending ? "Clearing..." : "Clear Credentials"}
                          </Button>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Settings Section - Collapsible */}
                  <Collapsible defaultOpen>
                    <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors w-full">
                      <Settings2 className="h-3 w-3" />
                      <span>Settings</span>
                      <ChevronDown className="h-3 w-3 ml-auto transition-transform in-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <div className="p-3 rounded-md border bg-muted/5 space-y-3">
                        <div>
                          <Label className="text-[10px] mb-1 block text-muted-foreground">Server URL</Label>
                          {availableServerUrls.length > 1 && !useCustomUrl ? (
                            <div className="flex gap-2">
                              <Select
                                value={effectiveServerBaseUrl || ""}
                                onValueChange={(val) => {
                                  if (val === null) return;
                                  if (val === "__custom__") {
                                    setUseCustomUrl(true);
                                    setServerBaseUrlOverride("");
                                  } else {
                                    handleServerBaseUrlChange(val);
                                  }
                                }}
                              >
                                <SelectTrigger className="font-mono text-xs h-8 flex-1">
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
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <Input
                                value={serverBaseUrl}
                                onChange={(e) => handleServerBaseUrlChange(e.target.value)}
                                className="font-mono text-xs h-8 flex-1"
                                placeholder="http://..."
                              />
                              {useCustomUrl && availableServerUrls.length > 1 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => {
                                    setUseCustomUrl(false);
                                    setServerBaseUrlOverride(null);
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4">
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <Checkbox checked={trustHostKey} onCheckedChange={(c) => setTrustHostKey(c === true)} />
                            <span>Trust Host Key</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <Checkbox checked={forceInstall} onCheckedChange={(c) => setForceInstall(c === true)} />
                            <span>Force Re-install</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <Checkbox checked={runAsRoot} onCheckedChange={(c) => setRunAsRoot(c === true)} />
                            <span>Run as root</span>
                          </label>
                        </div>
                        {selected.hostKeyFingerprint && (
                          <div className="text-[10px] font-mono text-muted-foreground px-2 py-1 bg-muted rounded break-all">
                            {selected.hostKeyFingerprint}
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Actions Bar */}
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => {
                        if (validateCredentials()) testMutation.mutate();
                      }}
                      className="h-8 text-xs"
                    >
                      {testMutation.isPending ? "Testing..." : "Test Connection"}
                    </Button>

                    <ConfirmationModal
                      trigger={
                        <Button
                          size="sm"
                          disabled={isBusy || !lastTest?.success}
                          onClick={(e) => {
                            if (!validateCredentials()) {
                              e.preventDefault();
                              e.stopPropagation();
                            }
                          }}
                          className="h-8 text-xs"
                        >
                          Install
                        </Button>
                      }
                      title={hasExistingAgent ? "Overwrite Existing Agent" : "Install ManLab Agent"}
                      message={(() => {
                        if (!hasExistingAgent)
                        {
                          if (installTargetNodeId !== INSTALL_TARGET_NEW)
                          {
                            return `Install agent on ${selected.host} and link to existing node ${installTargetNodeId}?`;
                          }

                          return `Install agent on ${selected.host}?`;
                        }

                        const parts: string[] = [];
                        parts.push(`An existing agent/node was detected for ${selected.host}.`);
                        if (existingNodeId) {
                          parts.push(`Node ID: ${existingNodeId}.`);
                        }
                        if (lastTest?.hasExistingInstallation) {
                          parts.push("A ManLab agent installation appears to already exist on the target machine.");
                        }

                        if (installTargetNodeId !== INSTALL_TARGET_NEW)
                        {
                          parts.push(`This install will be linked to existing node ${installTargetNodeId} (update mode).`);
                        }
                        else
                        {
                          parts.push("This install will create a new node identity.");
                        }

                        parts.push("Continuing will stop/overwrite the existing installation.");
                        return parts.join(" ");
                      })()}
                      confirmText={hasExistingAgent ? "Overwrite & Install" : "Install"}
                      isLoading={installMutation.isPending}
                      details={
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Agent Version
                            </div>

                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">Channel</div>
                                <Select
                                  value={agentChannel}
                                  onValueChange={(v) => {
                                    if (!v) return;
                                    setAgentChannel(v);
                                  }}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="stable">stable</SelectItem>
                                    <SelectItem value="beta">beta</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">&nbsp;</div>
                                <div className="text-xs text-muted-foreground">
                                  Used only for local (server-staged) downloads.
                                </div>
                              </div>
                            </div>

                            <AgentVersionPicker
                              channel={agentChannel}
                              value={agentSelection}
                              onChange={setAgentSelection}
                            />

                            <div className="text-xs text-muted-foreground">
                              Tip: use <span className="font-mono">staged</span> to install whatever the server currently has staged for that channel.
                            </div>
                          </div>

                            <div className="space-y-2">
                              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Node Link
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Attach this install to an existing node identity (update mode). Nodes already linked to another onboarding machine are shown as disabled.
                              </div>

                              <Select
                                value={installTargetNodeId}
                                onValueChange={(v) => {
                                  if (!v) return;
                                  installTargetDirtyRef.current = true;
                                  setInstallTargetNodeId(v);
                                }}
                                disabled={nodesQuery.isLoading}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={INSTALL_TARGET_NEW}>Create new node</SelectItem>

                                  {eligibleInstallTargetNodes.length > 0 ? (
                                    eligibleInstallTargetNodes.map((n) => {
                                      const label =
                                        (n.hostname ?? "").trim() ||
                                        (n.ipAddress ?? "").trim() ||
                                        n.id;
                                      return (
                                        <SelectItem key={n.id} value={n.id}>
                                          {label} ({n.status}) — {n.id.slice(0, 8)}
                                        </SelectItem>
                                      );
                                    })
                                  ) : (
                                    <SelectItem value="__none__" disabled>
                                      No eligible nodes found
                                    </SelectItem>
                                  )}

                                  {ineligibleInstallTargetNodes.length > 0 ? (
                                    ineligibleInstallTargetNodes.map((n) => {
                                      const owner = nodeLinkOwners.get(n.id);
                                      const label =
                                        (n.hostname ?? "").trim() ||
                                        (n.ipAddress ?? "").trim() ||
                                        n.id;

                                      const ownerLabel = owner
                                        ? `${owner.username}@${owner.host}:${owner.port}`
                                        : "another onboarding machine";

                                      return (
                                        <SelectItem key={n.id} value={n.id} disabled>
                                          {label} ({n.status}) — linked to {ownerLabel}
                                        </SelectItem>
                                      );
                                    })
                                  ) : null}
                                </SelectContent>
                              </Select>

                              {installTargetNodeId !== INSTALL_TARGET_NEW ? (
                                <div className="text-xs text-muted-foreground">
                                  Selected node will be preserved: <span className="font-mono">{installTargetNodeId}</span>
                                  {installTargetNode
                                    ? ` (${(installTargetNode.hostname ?? "").trim() || installTargetNode.ipAddress || "unknown"})`
                                    : ""}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">
                                  A new node identity will be created on first connect.
                                </div>
                              )}

                              {nodesQuery.isError ? (
                                <div className="text-xs text-destructive">
                                  Failed to load nodes. You can still install using “Create new node”.
                                </div>
                              ) : null}
                            </div>

                          {hasExistingAgent ? (
                            <div className="space-y-3">
                              <label className="flex items-center gap-2 text-xs cursor-pointer">
                                <Checkbox
                                  checked={stopExistingAgentFirst}
                                  onCheckedChange={(c) => setStopExistingAgentFirst(c === true)}
                                  disabled={!existingNodeId}
                                />
                                <span>
                                  Stop the existing agent first (best-effort)
                                  {!existingNodeId ? " — no matching node id" : ""}
                                </span>
                              </label>
                              <div className="text-xs text-muted-foreground">
                                Tip: leave “Force Re-install” enabled when overwriting.
                              </div>
                            </div>
                          ) : null}
                        </div>
                      }
                      onConfirm={async () => {
                        if (!validateCredentials()) return;
                        setLogs([]);

                        if (hasExistingAgent && stopExistingAgentFirst && existingNodeId) {
                          // Best-effort: request the old agent to terminate before we overwrite.
                          await stopExistingAgentMutation.mutateAsync(existingNodeId);
                        }

                        await installMutation.mutateAsync();
                      }}
                    />

                    <ConfirmationModal
                      trigger={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 text-xs"
                          disabled={isBusy || !(lastTest?.success || lastTest?.hasExistingInstallation)}
                          onClick={() => {
                            if (validateCredentials() && !previewUninstallMutation.isPending) {
                              previewUninstallMutation.mutate();
                            }
                          }}
                        >
                          Uninstall
                        </Button>
                      }
                      title="Uninstall Agent"
                      message={`Remove agent from ${selected.host}?`}
                      details={uninstallPreview}
                      confirmText="Uninstall"
                      isLoading={uninstallMutation.isPending}
                      onConfirm={async () => {
                        setLogs([]);
                        pendingUninstallMachineIdRef.current = selected?.id ?? null;
                        pendingUninstallLinkedNodeIdRef.current = selected?.linkedNodeId ?? null;
                        pendingUninstallHostRef.current = selected?.host ?? null;
                        pendingUninstallSawRunningRef.current = false;
                        pendingUninstallInitialStatusRef.current = selected?.status ?? null;
                        await uninstallMutation.mutateAsync();
                      }}
                    />

                    {lastTest?.error && (
                      <span className="text-xs font-mono text-destructive ml-auto truncate max-w-40" title={lastTest.error}>
                        {lastTest.error}
                      </span>
                    )}
                  </div>
                </div>
              </ScrollArea>

              {/* Compact Terminal */}
              <div className="border-t bg-black text-white h-72 flex flex-col shrink-0">
                <div className="flex items-center justify-between px-3 py-1 bg-neutral-900 border-b border-neutral-800">
                  <span className="text-[10px] font-mono tracking-wider text-neutral-400 uppercase">Output</span>
                  <button
                    onClick={() => setLogs([])}
                    className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex-1 overflow-auto font-mono text-[11px] p-2">
                  {logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-neutral-600 space-y-1 select-none">
                      <Terminal className="h-5 w-5 opacity-20" />
                      <span className="italic text-[10px]">Waiting for output...</span>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {logs.map((l, i) => (
                        <div key={i} className="flex gap-1.5 hover:bg-neutral-900/50 -mx-1 px-1 rounded-sm">
                          <span className="text-neutral-600 select-none text-[10px] w-14 shrink-0">
                            {new Date(l.ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                          <span
                            className={cn(
                              "break-all whitespace-pre-wrap flex-1",
                              l.msg.toLowerCase().includes("error") || l.msg.toLowerCase().includes("failed")
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

      <AlertDialog
        open={removeNodesPromptOpen}
        onOpenChange={(next) => {
          setRemoveNodesPromptOpen(next);
          if (!next)
          {
            setRemoveNodesPrompt(null);
            setRemoveNodesSelectedIds([]);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove node(s) too?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent uninstall completed successfully.
              {removeNodesPrompt ? (
                <>
                  <br />
                  Do you also want to remove the associated node(s) for <span className="font-mono">{removeNodesPrompt.host}</span>?
                  This deletes telemetry, settings, and command history for the selected node(s).
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isRemovingNodes}
              onClick={() => {
                setRemoveNodesPromptOpen(false);
                setRemoveNodesPrompt(null);
                setRemoveNodesSelectedIds([]);
              }}
            >
              Keep Node(s)
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={() => {
                if (!removeNodesPrompt) return;
                const ids = removeNodesSelectedIds;
                if (!ids || ids.length === 0) return;
                deleteAssociatedNodesMutation.mutate(ids);
              }}
              disabled={!removeNodesPrompt || isRemovingNodes || removeNodesSelectedIds.length === 0}
              variant="destructive"
            >
              {isRemovingNodes
                ? "Removing…"
                : removeNodesSelectedIds.length === 1
                ? "Remove Node"
                : `Remove ${removeNodesSelectedIds.length} Nodes`}
            </AlertDialogAction>
          </AlertDialogFooter>

          {removeNodesPrompt ? (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Associated nodes
              </div>

              <div className="space-y-2 rounded-md border p-3">
                {(() => {
                  const nodes = nodesQuery.data ?? [];
                  const byId = new Map(nodes.map((n) => [n.id, n] as const));
                  const missingIds = removeNodesPrompt.nodeIds.filter((id) => !byId.has(id));

                  return (
                    <>
                      {nodes
                        .filter((n) => removeNodesPrompt.nodeIds.includes(n.id))
                        .map((n) => {
                    const checked = removeNodesSelectedIds.includes(n.id);
                    const labelHost = (n.hostname ?? "").trim() || (n.ipAddress ?? "").trim() || n.id;
                    const isLinked = removeNodesPrompt.linkedNodeId === n.id;

                    return (
                      <label key={n.id} className="flex items-start gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={checked}
                          disabled={isRemovingNodes}
                          onCheckedChange={(v) => {
                            const nextChecked = v === true;
                            setRemoveNodesSelectedIds((prev) => {
                              const set = new Set(prev);
                              if (nextChecked) set.add(n.id);
                              else set.delete(n.id);
                              return Array.from(set);
                            });
                          }}
                        />
                        <span className="flex-1">
                          <span className="font-mono">{labelHost}</span>
                          {isLinked ? (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              linked
                            </Badge>
                          ) : null}
                          <div className="mt-0.5 text-xs text-muted-foreground font-mono break-all">
                            {n.id} • {n.status}
                            {n.ipAddress ? ` • ${n.ipAddress}` : ""}
                          </div>
                        </span>
                      </label>
                    );
                  })}

                      {missingIds.map((id) => {
                        const checked = removeNodesSelectedIds.includes(id);
                        const isLinked = removeNodesPrompt.linkedNodeId === id;

                        return (
                          <label key={id} className="flex items-start gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={checked}
                              disabled={isRemovingNodes}
                              onCheckedChange={(v) => {
                                const nextChecked = v === true;
                                setRemoveNodesSelectedIds((prev) => {
                                  const set = new Set(prev);
                                  if (nextChecked) set.add(id);
                                  else set.delete(id);
                                  return Array.from(set);
                                });
                              }}
                            />
                            <span className="flex-1">
                              <span className="font-mono">{id}</span>
                              {isLinked ? (
                                <Badge variant="secondary" className="ml-2 text-[10px]">
                                  linked
                                </Badge>
                              ) : null}
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                Node details not loaded yet.
                              </div>
                            </span>
                          </label>
                        );
                      })}

                      {(nodesQuery.data ?? []).length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          Loading node details…
                        </div>
                      ) : null}
                    </>
                  );
                })()}

                {removeNodesPrompt.nodeIds.length > 1 ? (
                  <div className="pt-2 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={isRemovingNodes}
                      onClick={() => {
                        setRemoveNodesSelectedIds(removeNodesPrompt.nodeIds);
                      }}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={isRemovingNodes}
                      onClick={() => {
                        setRemoveNodesSelectedIds([]);
                      }}
                    >
                      Select none
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
