
import { useMemo, useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOnboardingMachine,
  fetchOnboardingMachines,
  fetchNodes,
  fetchSuggestedServerBaseUrl,
  fetchUninstallPreview,
  installAgent,
  testSshConnection,
  uninstallAgent,
  deleteOnboardingMachine,
  saveMachineCredentials,
  clearMachineCredentials,
  updateMachineConfiguration,
  deleteNode,
  shutdownAgent,
  cancelOnboardingMachine,
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
import { ConfirmationModal } from "@/components/ConfirmationModal";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Trash2,
  Plus,
  ChevronLeft,
  Server,
  RotateCw,
  Cpu,
  Shield,
  Upload,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Network,
  Activity,
  Square,
} from "lucide-react";
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

  const seen = new Set<string>();
  const unique: Node[] = [];
  for (const n of matches) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }

  return unique;
};

function StatusIcon({ status }: { status: OnboardingStatus }) {
  switch (status) {
    case "Succeeded":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "Failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "Running":
      return <Activity className="h-4 w-4 text-blue-500 animate-pulse" />;
    default:
      return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

const normalizeAgentServerBaseUrl = (value: string): string => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  try {
      const url = new URL(trimmed);
      return url.origin;
  } catch {
      return trimmed.replace(/\/+$/, "").replace(/\/(api|hubs\/agent)(\/.*)?$/i, "").trim();
  }
};

export function OnboardingPage() {
  const queryClient = useQueryClient();
  const { connection } = useSignalR();
  const [searchParams, setSearchParams] = useSearchParams();

  // State Declarations
  const [activeTab, setActiveTab] = useState("config");
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addMachineErrors, setAddMachineErrors] = useState<{ host?: string; username?: string }>({});
  const [credErrors, setCredErrors] = useState<{ password?: string; privateKey?: string }>({});

  const machinesQuery = useQuery({
    queryKey: ["onboardingMachines"],
    queryFn: fetchOnboardingMachines,
    staleTime: 5000,
  });

  const machines = machinesQuery.data ?? EMPTY_MACHINES;

  const selectedId = searchParams.get("machine");
  const setSelectedId = (id: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("machine", id);
      else next.delete("machine");
      return next;
    });
  };

  const selected = useMemo<OnboardingMachine | null>(() => {
    if (!selectedId) return machines[0] ?? null;
    return machines.find((m) => m.id === selectedId) ?? null;
  }, [machines, selectedId]);

  useEffect(() => {
    if (!selectedId && machines.length > 0) {
        setSelectedId(machines[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines.length, selectedId]);

  // Add machine form state
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authMode, setAuthMode] = useState<SshAuthMode>("PrivateKey");

  // Per-selected machine auth inputs
  const [password, setPassword] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [trustHostKey, setTrustHostKey] = useState(true);
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [lastTest, setLastTest] = useState<SshTestResponse | null>(null);
  
  const serverBaseUrlDirtyRef = useRef(false);
  const [serverBaseUrlOverride, setServerBaseUrlOverride] = useState<string | null>(null);
  const [forceInstall, setForceInstall] = useState(true);
  const [runAsRoot, setRunAsRoot] = useState(false);
  const [sudoPassword, setSudoPassword] = useState("");

  const [agentChannel, setAgentChannel] = useState("stable");
  const [agentSelection, setAgentSelection] = useState<AgentVersionSelection>({
    source: "github",
    version: "",
    channel: "stable",
  });

  useEffect(() => {
      setAgentSelection(prev => ({ ...prev, channel: agentChannel }));
  }, [agentChannel]);

  const prevTrustHostKey = useRef(trustHostKey);
  const prevForceInstall = useRef(forceInstall);
  const prevRunAsRoot = useRef(runAsRoot);
  const prevServerBaseUrlOverride = useRef(serverBaseUrlOverride);

  useEffect(() => { prevTrustHostKey.current = trustHostKey; }, [trustHostKey]);
  useEffect(() => { prevForceInstall.current = forceInstall; }, [forceInstall]);
  useEffect(() => { prevRunAsRoot.current = runAsRoot; }, [runAsRoot]);
  useEffect(() => { prevServerBaseUrlOverride.current = serverBaseUrlOverride; }, [serverBaseUrlOverride]);

  const [logs, setLogs] = useState<Array<{ ts: string; msg: string }>>([]);
  const [remoteUninstallPreview, setRemoteUninstallPreview] = useState<UninstallPreviewResponse | null>(null);
  
  const pendingUninstallMachineIdRef = useRef<string | null>(null);
  const pendingUninstallLinkedNodeIdRef = useRef<string | null>(null);
  const pendingUninstallHostRef = useRef<string | null>(null);
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
  const [overwritePromptOpen, setOverwritePromptOpen] = useState(false);
  
  const [installTargetNodeId, setInstallTargetNodeId] = useState<string>(INSTALL_TARGET_NEW);
  const installTargetDirtyRef = useRef(false);

  useEffect(() => {
    installTargetDirtyRef.current = false;
  }, [selected?.id]);

  const [stopExistingAgentFirst, setStopExistingAgentFirst] = useState(true);

  const MASKED_SECRET = "•••••";
  const isMaskedSecret = (value: string | null | undefined) => (value ?? "") === MASKED_SECRET;

  const nodesQuery = useQuery<Node[]>({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 15_000,
  });

  const existingNode = useMemo(() => {
    if (!selected) return null;
    const nodes = nodesQuery.data;
    if (!nodes || nodes.length === 0) return null;

    const hostVal = (selected.host ?? "").trim().toLowerCase();
    if (!hostVal) return null;

    return (
      nodes.find((n) => (n.hostname ?? "").trim().toLowerCase() === hostVal) ??
      nodes.find((n) => (n.ipAddress ?? "").trim().toLowerCase() === hostVal) ??
      null
    );
  }, [nodesQuery.data, selected]);

  const nodeLinkOwners = useMemo(() => {
    const m = new Map<string, OnboardingMachine>();
    for (const machine of machines) {
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

  useEffect(() => {
    if (!selected) {
      setTimeout(() => setInstallTargetNodeId(INSTALL_TARGET_NEW), 0);
      return;
    }

    if (installTargetDirtyRef.current) return;

    const linked = selected.linkedNodeId;
    if (linked) {
      setInstallTargetNodeId(linked);
      return;
    }

    const detected = existingNode?.id;
    if (detected && isNodeEligibleForInstallTarget(detected)) {
      setInstallTargetNodeId(detected);
      return;
    }

    setInstallTargetNodeId(INSTALL_TARGET_NEW);
  }, [existingNode?.id, isNodeEligibleForInstallTarget, selected]);

  const existingNodeId = useMemo(() => {
    if (!selected) return null;
    return selected.linkedNodeId ?? existingNode?.id ?? null;
  }, [existingNode?.id, selected]);

  const hasExistingAgent = Boolean(existingNodeId) || Boolean(lastTest?.hasExistingInstallation);

  const previewUninstallMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      if (!lastTest?.success) throw new Error("Test connection first");

      const useSavedAuth = selected.hasSavedCredentials === true &&
        (selected.authMode === "Password" ? (!password || password === MASKED_SECRET) : (!privateKeyPem || privateKeyPem === MASKED_SECRET));

      const useSavedSudo = selected.hasSavedSudoPassword === true && (!sudoPassword || sudoPassword === MASKED_SECRET);
      const useSavedCredentials = useSavedAuth || useSavedSudo;

      return fetchUninstallPreview(selected.id, {
        serverBaseUrl: effectiveServerBaseUrl,
        trustHostKey,
        password: useSavedAuth ? undefined : (password || undefined),
        privateKeyPem: useSavedAuth ? undefined : (privateKeyPem || undefined),
        privateKeyPassphrase: useSavedAuth ? undefined : (privateKeyPassphrase || undefined),
        sudoPassword: useSavedSudo ? undefined : (sudoPassword || undefined),
        useSavedCredentials,
      });
    },
    onSuccess: (data) => setRemoteUninstallPreview(data),
    onError: () => setRemoteUninstallPreview(null),
  });

  const uninstallPreview = useMemo(() => {
    if (previewUninstallMutation.isPending) {
        return <div className="text-xs text-muted-foreground animate-pulse">Scanning remote system...</div>;
    }
    if (remoteUninstallPreview?.success) {
        return <div className="text-xs text-green-600">Ready to clean up detected artifacts.</div>
    }
    if (remoteUninstallPreview && !remoteUninstallPreview.success) {
        return <div className="text-xs text-destructive">{remoteUninstallPreview.error}</div>;
    }
    return null;
  }, [previewUninstallMutation.isPending, remoteUninstallPreview]);

  useEffect(() => {
    if (!connection) return;

    const handleLog = (machineId: string, timestamp: string, message: string) => {
      if (selected && machineId !== selected.id) return;
      setLogs((old) => {
        const next = [...old, { ts: timestamp, msg: message }];
        return next.slice(-1000);
      });
    };

    const handleStatus = () => {
      queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
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
  });



  const serverBaseUrl = useMemo(() => {
    if (serverBaseUrlOverride !== null) return serverBaseUrlOverride;
    if (import.meta.env.VITE_SERVER_BASE_URL) return import.meta.env.VITE_SERVER_BASE_URL as string;
    const suggested = suggestedServerBaseUrlQuery.data?.serverBaseUrl?.trim();
    if (suggested) return suggested;
    return import.meta.env.VITE_API_URL ?? window.location.origin;
  }, [serverBaseUrlOverride, suggestedServerBaseUrlQuery.data]);

  const effectiveServerBaseUrl = normalizeAgentServerBaseUrl(serverBaseUrl);

  const availableServerUrls = (() => {
    const urlSet = new Set<string>();
    if (lastTest?.detectedServerUrls) lastTest.detectedServerUrls.forEach(u => urlSet.add(normalizeAgentServerBaseUrl(u)));
    if (suggestedServerBaseUrlQuery.data?.allServerUrls) suggestedServerBaseUrlQuery.data.allServerUrls.forEach(u => urlSet.add(normalizeAgentServerBaseUrl(u)));
    if (import.meta.env.VITE_SERVER_BASE_URL) urlSet.add(normalizeAgentServerBaseUrl(import.meta.env.VITE_SERVER_BASE_URL));
    urlSet.add(normalizeAgentServerBaseUrl(window.location.origin));
    if (serverBaseUrlOverride) urlSet.add(normalizeAgentServerBaseUrl(serverBaseUrlOverride));
    return Array.from(urlSet).filter(Boolean);
  })();

  const [useCustomUrl, setUseCustomUrl] = useState(false);
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

    setPassword(machine.hasSavedCredentials ? MASKED_SECRET : "");
    setPrivateKeyPem(machine.hasSavedCredentials ? MASKED_SECRET : "");
    setPrivateKeyPassphrase("");
    setSudoPassword(machine.hasSavedSudoPassword ? MASKED_SECRET : "");
    setRememberCredentials(false);

    setTrustHostKey(machine.trustHostKey ?? true);
    setForceInstall(machine.forceInstall ?? true);
    setRunAsRoot(machine.hasSavedSudoPassword ? true : (machine.runAsRoot ?? false));
    
    prevTrustHostKey.current = machine.trustHostKey ?? true;
    prevForceInstall.current = machine.forceInstall ?? true;
    prevRunAsRoot.current = machine.hasSavedSudoPassword ? true : (machine.runAsRoot ?? false);
    prevServerBaseUrlOverride.current = machine.serverBaseUrlOverride ?? null;

    if (machine.serverBaseUrlOverride) {
      setServerBaseUrlOverride(machine.serverBaseUrlOverride);
      serverBaseUrlDirtyRef.current = true;
    } else {
      setServerBaseUrlOverride(null);
      serverBaseUrlDirtyRef.current = false;
    }
    setUseCustomUrl(false);
    setStopExistingAgentFirst(true);
  };

  useEffect(() => {
    if (selectedId && machines.find(m => m.id === selectedId)) {
        setTimeout(() => selectMachine(selectedId), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, machines.length]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const createMachineMutation = useMutation({
    mutationFn: createOnboardingMachine,
    onSuccess: (m) => {
      queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
      setSelectedId(m.id);
      setHost("");
      setPort("22");
      setUsername("");
      setAddFormOpen(false);
      toast.success("Machine added to inventory");
    },
    onError: (err) => toast.error("Failed to add machine", { description: err instanceof Error ? err.message : "Unknown error" }),
  });

  const autoSaveCredentialsMutation = useMutation({
    mutationFn: async (input: SaveCredentialsRequest) => {
      if (!selected) throw new Error("No machine selected");
      return saveMachineCredentials(selected.id, input);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] }),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      const useSavedAuth = selected.hasSavedCredentials === true &&
        (selected.authMode === "Password" ? (!password || password === MASKED_SECRET) : (!privateKeyPem || privateKeyPem === MASKED_SECRET));
      const useSavedSudo = selected.hasSavedSudoPassword === true && (!sudoPassword || sudoPassword === MASKED_SECRET);

      return testSshConnection(selected.id, {
        password: useSavedAuth ? undefined : (password || undefined),
        privateKeyPem: useSavedAuth ? undefined : (privateKeyPem || undefined),
        privateKeyPassphrase: useSavedAuth ? undefined : (privateKeyPassphrase || undefined),
        sudoPassword: useSavedSudo ? undefined : (sudoPassword || undefined),
        trustHostKey,
        useSavedCredentials: useSavedAuth || useSavedSudo,
      });
    },
    onSuccess: (res) => {
      setLastTest(res);
      if (res.success) {
        toast.success("Connection Verified", { description: res.osHint });
        previewUninstallMutation.mutate();
        
        if (rememberCredentials && selected) {
             const payload: SaveCredentialsRequest = {
                password: selected.authMode === "Password" && password && !isMaskedSecret(password) ? password : undefined,
                privateKeyPem: selected.authMode === "PrivateKey" && privateKeyPem && !isMaskedSecret(privateKeyPem) ? privateKeyPem : undefined,
                privateKeyPassphrase: selected.authMode === "PrivateKey" && privateKeyPassphrase ? privateKeyPassphrase : undefined,
                sudoPassword: sudoPassword && !isMaskedSecret(sudoPassword) ? sudoPassword : undefined,
             };
             if (payload.password || payload.privateKeyPem || payload.privateKeyPassphrase || payload.sudoPassword) {
                 autoSaveCredentialsMutation.mutate(payload);
             }
        }
      } else {
        toast.error("Connection Failed", { description: res.error });
      }
    },
    onError: (err) => toast.error("Test failed", { description: err instanceof Error ? err.message : "Unknown error" }),
  });

  const installMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      const useSavedAuth = selected.hasSavedCredentials === true &&
        (selected.authMode === "Password" ? (!password || password === MASKED_SECRET) : (!privateKeyPem || privateKeyPem === MASKED_SECRET));
      const useSavedSudo = selected.hasSavedSudoPassword === true && (!sudoPassword || sudoPassword === MASKED_SECRET);
      
      const effectiveForce = hasExistingAgent ? true : forceInstall;
      return installAgent(selected.id, {
        serverBaseUrl: effectiveServerBaseUrl,
        targetNodeId: installTargetNodeId !== INSTALL_TARGET_NEW ? installTargetNodeId : undefined,
        force: effectiveForce,
        runAsRoot,
        trustHostKey,
        agentSource: agentSelection.source,
        agentChannel: agentChannel,
        agentVersion: agentSelection.version,
        password: useSavedAuth ? undefined : (password || undefined),
        privateKeyPem: useSavedAuth ? undefined : (privateKeyPem || undefined),
        privateKeyPassphrase: useSavedAuth ? undefined : (privateKeyPassphrase || undefined),
        sudoPassword: useSavedSudo ? undefined : (sudoPassword || undefined),
        useSavedCredentials: useSavedAuth || useSavedSudo,
      });
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
        setActiveTab("logs");
    },
    onError: (err) => toast.error("Installation failed", { description: err instanceof Error ? err.message : "Checking logs might help" }),
  });

  const uninstallMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No machine selected");
      const useSavedAuth = selected.hasSavedCredentials === true &&
        (selected.authMode === "Password" ? (!password || password === MASKED_SECRET) : (!privateKeyPem || privateKeyPem === MASKED_SECRET));
      const useSavedSudo = selected.hasSavedSudoPassword === true && (!sudoPassword || sudoPassword === MASKED_SECRET);

      return uninstallAgent(selected.id, {
        serverBaseUrl: effectiveServerBaseUrl,
        trustHostKey,
        password: useSavedAuth ? undefined : (password || undefined),
        privateKeyPem: useSavedAuth ? undefined : (privateKeyPem || undefined),
        privateKeyPassphrase: useSavedAuth ? undefined : (privateKeyPassphrase || undefined),
        sudoPassword: useSavedSudo ? undefined : (sudoPassword || undefined),
        useSavedCredentials: useSavedAuth || useSavedSudo,
      });
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
        setActiveTab("logs");
        setLastTest(null);
        pendingUninstallMachineIdRef.current = selected?.id ?? null;
        pendingUninstallInitialStatusRef.current = selected?.status ?? null;
        // Reset uninstall tracking flags
        pendingUninstallLinkedNodeIdRef.current = selected?.linkedNodeId ?? null;
        pendingUninstallHostRef.current = selected?.host ?? null;
        pendingUninstallSawRunningRef.current = false;
        
        toast.success("Uninstall started successfully", { description: "Check logs for progress" });
    },
    onError: (err) => {
      toast.error("Failed to start uninstall", { description: err.message });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (machineId: string) => cancelOnboardingMachine(machineId),
    onSuccess: () => {
        toast.success("Cancellation requested");
    },
    onError: (err) => {
        toast.error("Failed to cancel", { description: err.message });
    }
  });

  const deleteAssociatedNodesMutation = useMutation({
    mutationFn: async (nodeIds: string[]) => {
      const succeeded: string[] = [];
      const failed: Array<{ id: string; error: unknown }> = [];

      for (const id of nodeIds) {
        try {
          await deleteNode(id);
          succeeded.push(id);
        } catch (error) {
          failed.push({ id, error });
        }
      }
      return { succeeded, failed };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
      await queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });

      if (result.succeeded.length > 0) {
        toast.success(result.succeeded.length === 1 ? "Node removed" : `Removed ${result.succeeded.length} nodes`);
      }

      if (result.failed.length > 0) {
        toast.error("Some nodes could not be removed", { description: `${result.failed.length} failed. You can retry removing the remaining nodes.` });
        setRemoveNodesSelectedIds(result.failed.map((x) => x.id));
        return;
      }
      
      if (removeNodesPrompt?.machineId && selectedId === removeNodesPrompt.machineId && removeNodesPrompt.linkedNodeId && result.succeeded.includes(removeNodesPrompt.linkedNodeId)) {
         setSelectedId(null);
      }

      setRemoveNodesPromptOpen(false);
      setRemoveNodesPrompt(null);
      setRemoveNodesSelectedIds([]);
    },
    onError: (err) => toast.error("Failed to delete node(s)", { description: err instanceof Error ? err.message : "Unknown error" }),
  });

  useEffect(() => {
    const machineId = pendingUninstallMachineIdRef.current;
    if (!machineId) return;

    const m = machines.find((x) => x.id === machineId);
    if (!m) return;

    if (m.status === "Running") {
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

    const initialStatus = pendingUninstallInitialStatusRef.current;
    if (initialStatus === "Succeeded" && pendingUninstallSawRunningRef.current !== true) return;

    pendingUninstallMachineIdRef.current = null;

    const linkedNodeId = pendingUninstallLinkedNodeIdRef.current ?? m.linkedNodeId;
    const host = pendingUninstallHostRef.current ?? m.host;

    pendingUninstallLinkedNodeIdRef.current = null;
    pendingUninstallHostRef.current = null;
    pendingUninstallSawRunningRef.current = false;
    pendingUninstallInitialStatusRef.current = null;

    const nodes = nodesQuery.data;
    const associatedNodeIds = (() => {
      if (nodes && nodes.length > 0) {
        const associatedNodes = getAssociatedNodesForMachine(m, nodes);
        const ids = associatedNodes.map((n) => n.id);
        if (linkedNodeId && !ids.includes(linkedNodeId)) ids.unshift(linkedNodeId);
        return ids;
      }
      if (linkedNodeId) return [linkedNodeId];
      return [];
    })();

    if (associatedNodeIds.length > 0) {
      setRemoveNodesPrompt({
        machineId: m.id,
        host,
        nodeIds: associatedNodeIds,
        linkedNodeId: linkedNodeId ?? null,
      });

      const initialSelected = linkedNodeId && associatedNodeIds.includes(linkedNodeId) ? [linkedNodeId] : associatedNodeIds;
      setRemoveNodesSelectedIds(initialSelected);
      setRemoveNodesPromptOpen(true);
    }
  }, [machines, nodesQuery.data]);

  const stopExistingAgentMutation = useMutation({
    mutationFn: async (nodeId: string) => {
      await shutdownAgent(nodeId);
    },
    onError: (err) => toast.warning("Could not request existing agent shutdown", { description: err instanceof Error ? err.message : "Unknown error" }),
  });

  const deleteMachineMutation = useMutation({
    mutationFn: deleteOnboardingMachine,
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
        toast.success("Machine removed");
        if (machines.length <= 1) setSelectedId(null);
    }
  });

  const saveCredentialsMutation = useMutation({
    mutationFn: async (input: SaveCredentialsRequest) => {
        if (!selected) throw new Error("No machine selected");
        return saveMachineCredentials(selected.id, input);
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
        if (selected?.authMode === "Password") setPassword(MASKED_SECRET);
        else setPrivateKeyPem(MASKED_SECRET);
        if (sudoPassword) setSudoPassword(MASKED_SECRET);
        toast.success("Credentials saved");
    }
  });

  const clearCredentialsMutation = useMutation({
    mutationFn: async () => {
        if (!selected) throw new Error("No machine selected");
        return clearMachineCredentials(selected.id);
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["onboardingMachines"] });
        setUseCustomUrl(false);
        setPassword("");
        setPrivateKeyPem("");
        setSudoPassword("");
        toast.success("Credentials cleared");
    }
  });

  const updateConfigurationMutation = useMutation({
    mutationFn: async (input: UpdateConfigurationRequest) => {
        if (!selected) throw new Error("No machine selected");
        return updateMachineConfiguration(selected.id, input);
    }
  });

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

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] bg-background -m-4 -mb-8 overflow-hidden">
        <div className="flex items-center gap-4 px-6 py-3 border-b shrink-0 bg-background z-20">
            <Link to="/nodes" className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}>
                <ChevronLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-lg font-semibold tracking-tight">Onboard Machine</h1>
            <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setAddFormOpen(true)} className="gap-2">
                    <Plus className="h-4 w-4" /> Add Machine
                </Button>
            </div>
        </div>

        <div className="flex flex-1 overflow-hidden relative">
            <aside className="w-56 border-r bg-muted flex flex-col shrink-0 z-10 overflow-hidden">
                {addFormOpen && (
                    <div className="p-4 border-b bg-background/50 space-y-3 animate-in slide-in-from-top-2">
                         <div className="flex items-center justify-between">
                            <h3 className="text-xs font-semibold uppercase text-muted-foreground">New Machine</h3>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setAddFormOpen(false)}><XCircle className="h-4 w-4" /></Button>
                         </div>
                         <div className="space-y-2">
                            <div className="flex gap-2">
                                <Input 
                                    placeholder="Host / IP" 
                                    value={host} 
                                    onChange={e => {
                                        setHost(e.target.value);
                                        setAddMachineErrors(prev => ({ ...prev, host: undefined }));
                                    }} 
                                    className={cn("h-8 text-xs font-mono", addMachineErrors.host && "border-destructive")} 
                                />
                                <Input placeholder="22" value={port} onChange={e => setPort(e.target.value)} className="h-8 text-xs font-mono w-14" />
                            </div>
                            <div className="flex gap-2">
                                <Input 
                                    placeholder="Username" 
                                    value={username} 
                                    onChange={e => {
                                        setUsername(e.target.value);
                                        setAddMachineErrors(prev => ({ ...prev, username: undefined }));
                                    }} 
                                    className={cn("h-8 text-xs font-mono", addMachineErrors.username && "border-destructive")} 
                                />
                                <Select value={authMode} onValueChange={e => setAuthMode(e as SshAuthMode)}>
                                    <SelectTrigger className="h-8 text-xs w-28"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="PrivateKey">SSH Key</SelectItem>
                                        <SelectItem value="Password">Password</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button size="sm" className="w-full h-8 text-xs" onClick={() => {
                                const newErrors: { host?: string; username?: string } = {};
                                if (!host) newErrors.host = "Required";
                                if (!username) newErrors.username = "Required";
                                if (Object.keys(newErrors).length > 0) {
                                    setAddMachineErrors(newErrors);
                                    return;
                                }
                                createMachineMutation.mutate({ host, port: Number(port), username, authMode });
                            }} disabled={createMachineMutation.isPending}>Add to Inventory</Button>
                         </div>
                    </div>
                )}
                <ScrollArea className="flex-1 overflow-y-auto">
                    <div className="p-2 space-y-1">
                        {machines.map((m) => (
                            <button
                                key={m.id}
                                onClick={() => selectMachine(m.id)}
                                className={cn(
                                    "w-full text-left px-3 py-3 rounded-lg border transition-all hover:bg-background/80 flex flex-col gap-1",
                                    selected?.id === m.id ? "bg-background border-primary shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <div className="flex items-center justify-between w-full">
                                    <span className="font-mono text-sm font-medium truncate">{m.host}</span>
                                    <StatusIcon status={m.status} />
                                </div>
                                <div className="flex items-center justify-between w-full text-xs opacity-70">
                                    <span>{m.username}:{m.port}</span>
                                    <Badge variant="outline" className="text-[10px] h-4 px-1">{m.authMode === "PrivateKey" ? "Key" : "Pass"}</Badge>
                                </div>
                            </button>
                        ))}
                        {machines.length === 0 && !addFormOpen && (
                            <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                                <Server className="h-8 w-8 mb-2 opacity-20" />
                                <p className="text-xs">No machines added.</p>
                                <Button variant="link" onClick={() => setAddFormOpen(true)} className="text-xs h-auto p-0">Add one now</Button>
                            </div>
                        )}
                    </div>
                </ScrollArea>
                <div className="p-2 border-t text-xs text-center text-muted-foreground">
                    {machines.length} machine{machines.length !== 1 && 's'} pending
                </div>
            </aside>

            <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
                {!selected ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground p-8">
                         <div className="max-w-md text-center">
                            <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mx-auto mb-4">
                                <Network className="w-8 h-8 opacity-50" />
                            </div>
                            <h2 className="text-2xl font-semibold mb-2">Select a Machine</h2>
                            <p className="text-muted-foreground mb-4">Select a machine from the inventory on the left to configure SSH access, install the agent, or view logs.</p>
                            <Button onClick={() => setAddFormOpen(true)}>Add New Machine</Button>
                         </div>
                    </div>
                ) : (
                    <div className="flex flex-col h-full">
                        <div className="flex items-center justify-between px-6 py-4 border-b bg-background">
                            <div className="flex items-center gap-4">
                                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                                    <Server className="h-5 w-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold font-mono tracking-tight">{selected.host}</h2>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> {selected.port}</span>
                                        <Separator orientation="vertical" className="h-3" />
                                        <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> {selected.username}</span>
                                    {lastTest?.success ? (
                                        <>
                                            <Separator orientation="vertical" className="h-3" />
                                            <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3 w-3" /> {lastTest.osHint}</span>
                                            {lastTest.hasExistingInstallation && (
                                                <span className="flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-[10px] border border-blue-500/20 font-medium">
                                                    Agent Installed
                                                </span>
                                            )}
                                        </>
                                    ) : lastTest?.error ? (
                                        <>
                                            <Separator orientation="vertical" className="h-3" />
                                            <span className="flex items-center gap-1 text-destructive truncate max-w-[200px]" title={lastTest.error}>
                                                <XCircle className="h-3 w-3" /> {lastTest.error}
                                            </span>
                                        </>
                                    ) : null}
                                </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button size="sm" variant={lastTest?.success ? "outline" : "default"} onClick={() => { setActiveTab("config"); testMutation.mutate(); }} disabled={selected.status === 'Running' || testMutation.isPending}>
                                    {testMutation.isPending ? <RotateCw className="h-4 w-4 mr-2 animate-spin" /> : <Network className="h-4 w-4 mr-2" />}
                                    Test Connection
                                </Button>
                                <ConfirmationModal
                                    trigger={<Button variant="destructive" size="icon" className="h-9 w-9"><Trash2 className="h-4 w-4" /></Button>}
                                    title="Remove Machine"
                                    message={`Remove ${selected.host} from inventory?`}
                                    confirmText="Remove"
                                    isDestructive
                                    onConfirm={() => deleteMachineMutation.mutate(selected.id)}
                                />
                            </div>
                        </div>

                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
                            <div className="px-6 py-2 bg-muted/5 shrink-0">
                                {selected.status === 'Running' && (
                                    <Alert variant="default" className="mb-2 bg-blue-50/50 border-blue-200 text-blue-900 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-100 flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Activity className="h-4 w-4 animate-pulse text-blue-500" />
                                                <AlertTitle className="mb-0">Operation in Progress</AlertTitle>
                                            </div>
                                            <AlertDescription>
                                                An onboarding script is currently running on this machine. Please wait for it to complete.
                                            </AlertDescription>
                                        </div>
                                        <Button 
                                            variant="secondary" 
                                            size="sm" 
                                            className="ml-4 h-8 bg-background/50 hover:bg-destructive/10 hover:text-destructive border border-transparent hover:border-destructive/20 transition-colors"
                                            onClick={() => cancelMutation.mutate(selected.id)}
                                            disabled={cancelMutation.isPending}
                                        >
                                            {cancelMutation.isPending ? <RotateCw className="h-3 w-3 mr-2 animate-spin" /> : <Square className="h-3 w-3 mr-2 fill-current" />}
                                            Force Stop
                                        </Button>
                                    </Alert>
                                )}
                                <TabsList className="h-11 w-full justify-start bg-transparent p-0 border-b rounded-none">
                                    <TabsTrigger value="config" className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-4">Configuration</TabsTrigger>
                                    <TabsTrigger value="install" className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-4">Installation</TabsTrigger>
                                    <TabsTrigger value="logs" className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-4">Console Logs {logs.length > 0 && `(${logs.length})`}</TabsTrigger>
                                </TabsList>
                            </div>

                            <ScrollArea className="flex-1 bg-muted/5 overflow-y-auto">
                                <div className="p-6 max-w-4xl mx-auto space-y-6">

                                    <TabsContent value="config" className="space-y-6 mt-0">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <Card>
                                                <CardHeader><CardTitle>SSH Credentials</CardTitle><CardDescription>Configure access for {selected.authMode === "PrivateKey" ? "Key-based" : "Password-based"} authentication</CardDescription></CardHeader>
                                                <CardContent className="space-y-4">
                                                    {selected.authMode === "Password" ? (
                                                        <div className="space-y-2">
                                                            <Label>Password</Label>
                                                            <Input 
                                                                type="password" 
                                                                value={password} 
                                                                onChange={e => {
                                                                    setPassword(e.target.value);
                                                                    setCredErrors(prev => ({ ...prev, password: undefined }));
                                                                }} 
                                                                placeholder="••••••••" 
                                                                className={cn(credErrors.password && "border-destructive")}
                                                            />
                                                            {credErrors.password && <p className="text-[10px] text-destructive">{credErrors.password}</p>}
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            <Label>Private Key (PEM)</Label>
                                                            <Textarea 
                                                                value={privateKeyPem} 
                                                                onChange={e => {
                                                                    setPrivateKeyPem(e.target.value);
                                                                    setCredErrors(prev => ({ ...prev, privateKey: undefined }));
                                                                }} 
                                                                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" 
                                                                className={cn("font-mono text-xs min-h-[120px]", credErrors.privateKey && "border-destructive")} 
                                                            />
                                                            {credErrors.privateKey && <p className="text-[10px] text-destructive">{credErrors.privateKey}</p>}
                                                            <Input type="password" value={privateKeyPassphrase} onChange={e => setPrivateKeyPassphrase(e.target.value)} placeholder="Passphrase (Optional)" className="mt-2" />
                                                        </div>
                                                    )}
                                                    
                                                    <div className="space-y-2 pt-2 border-t">
                                                        <Label>Sudo Password</Label>
                                                        <Input type="password" value={sudoPassword} onChange={e => {
                                                            setSudoPassword(e.target.value);
                                                            if (e.target.value && !runAsRoot) setRunAsRoot(true);
                                                        }} placeholder="••••••••" />
                                                        <p className="text-[10px] text-muted-foreground">Required if the user is not root but needs sudo privileges.</p>
                                                    </div>

                                                    <div className="flex items-center justify-between pt-2">
                                                        <div className="flex items-center space-x-2">
                                                            <Checkbox id="remember" checked={rememberCredentials} onCheckedChange={c => setRememberCredentials(c === true)} />
                                                            <label htmlFor="remember" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Remember credentials</label>
                                                        </div>
                                                        {selected.hasSavedCredentials && (
                                                            <Button variant="ghost" size="sm" onClick={() => clearCredentialsMutation.mutate()} className="text-xs text-destructive hover:text-destructive">Clear Saved</Button>
                                                        )}
                                                    </div>
                                                </CardContent>
                                                <CardFooter className="bg-muted/10 flex justify-end p-3">
                                                    {rememberCredentials ? (
                                                        <Button size="sm" onClick={() => {
                                                            const errors: { password?: string; privateKey?: string } = {};
                                                            if (selected.authMode === "Password" && !password && !selected.hasSavedCredentials) errors.password = "Required";
                                                            if (selected.authMode === "PrivateKey" && !privateKeyPem && !selected.hasSavedCredentials) errors.privateKey = "Required";
                                                            if (Object.keys(errors).length > 0) {
                                                                setCredErrors(errors);
                                                                return;
                                                            }

                                                            saveCredentialsMutation.mutate({
                                                                password: selected.authMode === "Password" && password && !isMaskedSecret(password) ? password : undefined,
                                                                privateKeyPem: selected.authMode === "PrivateKey" && privateKeyPem && !isMaskedSecret(privateKeyPem) ? privateKeyPem : undefined,
                                                                privateKeyPassphrase: privateKeyPassphrase,
                                                                sudoPassword: sudoPassword && !isMaskedSecret(sudoPassword) ? sudoPassword : undefined
                                                            });
                                                        }}>Save Safe Credentials</Button>
                                                    ) : (
                                                        <Button size="sm" variant="secondary" onClick={() => testMutation.mutate()}>Verify Connection</Button>
                                                    )}
                                                </CardFooter>
                                            </Card>

                                            <Card>
                                                <CardHeader><CardTitle>Connection Settings</CardTitle><CardDescription>Adjust connection and installation parameters</CardDescription></CardHeader>
                                                <CardContent className="space-y-4">
                                                    <div className="space-y-2">
                                                        <Label>Server Public URL</Label>
                                                        {availableServerUrls.length > 1 && !useCustomUrl ? (
                                                            <div className="flex gap-2">
                                                                <Select value={availableServerUrls.length > 1 && !useCustomUrl ? (effectiveServerBaseUrl || "") : undefined} onValueChange={v => v === "__custom__" ? (() => { setUseCustomUrl(true); setServerBaseUrlOverride(""); })() : handleServerBaseUrlChange(v ?? "")}>
                                                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                                                    <SelectContent>
                                                                        {availableServerUrls.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                                                        <SelectItem value="__custom__">Custom...</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        ) : (
                                                            <div className="flex gap-2">
                                                                <Input value={serverBaseUrl} onChange={e => handleServerBaseUrlChange(e.target.value)} placeholder="http://..." className="font-mono text-xs" />
                                                                {(useCustomUrl || availableServerUrls.length <= 1) && availableServerUrls.length > 1 && <Button variant="ghost" size="icon" onClick={() => { setUseCustomUrl(false); setServerBaseUrlOverride(null); }}><XCircle className="h-4 w-4" /></Button>}
                                                            </div>
                                                        )}
                                                        <p className="text-[10px] text-muted-foreground">The URL the agent uses to connect back to this server.</p>
                                                    </div>

                                                    <div className="space-y-3">
                                                        <div className="flex items-center space-x-2">
                                                            <Checkbox id="trust" checked={trustHostKey} onCheckedChange={c => setTrustHostKey(c === true)} />
                                                            <label htmlFor="trust" className="text-sm font-medium">Trust Host Key (StrictHostKeyChecking=no)</label>
                                                        </div>
                                                        <div className="flex items-center space-x-2">
                                                            <Checkbox id="root" checked={runAsRoot} onCheckedChange={c => setRunAsRoot(c === true)} />
                                                            <label htmlFor="root" className="text-sm font-medium">Run installation as sudo/root</label>
                                                        </div>
                                                        <div className="flex items-center space-x-2">
                                                            <Checkbox id="force" checked={forceInstall} onCheckedChange={c => setForceInstall(c === true)} />
                                                            <label htmlFor="force" className="text-sm font-medium">Force re-install (overwrite existing)</label>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </div>
                                    </TabsContent>

                                    <TabsContent value="install" className="space-y-6 mt-0">
                                         <Card>
                                            <CardHeader>
                                                <CardTitle>Installation Target</CardTitle>
                                                <CardDescription>Choose version and destination for the agent</CardDescription>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div className="space-y-2">
                                                        <Label>Agent Version</Label>
                                                        <AgentVersionPicker 
                                                            channel={agentChannel}
                                                            value={agentSelection} 
                                                            onChange={setAgentSelection}
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>Release Channel</Label>
                                                        <Select value={agentChannel} onValueChange={(v) => v && setAgentChannel(v)}>
                                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="stable">Stable</SelectItem>
                                                                <SelectItem value="beta">Beta</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    {nodesQuery.data && nodesQuery.data.length > 0 && (
                                                        <div className="space-y-2">
                                                            <Label>Target Node Identity</Label>
                                                            <Select value={installTargetNodeId} onValueChange={(v) => v && setInstallTargetNodeId(v)}>
                                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value={INSTALL_TARGET_NEW}><span className="text-muted-foreground italic">Create New Node Identity</span></SelectItem>
                                                                    {existingNode && isNodeEligibleForInstallTarget(existingNode.id) && (
                                                                        <SelectItem value={existingNode.id}>
                                                                            <span className="font-semibold">{existingNode.hostname}</span> (Detected match)
                                                                        </SelectItem>
                                                                    )}
                                                                    <Separator className="my-1"/>
                                                                    {nodesQuery.data.filter(n => n.id !== existingNode?.id && isNodeEligibleForInstallTarget(n.id)).map(n => (
                                                                         <SelectItem key={n.id} value={n.id}>{n.hostname}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    )}
                                                </div>
                                            </CardContent>
                                            <CardFooter className="flex gap-2 justify-end bg-muted/10 p-4">
                                                <Button size="lg" onClick={() => {
                                                    if (hasExistingAgent) {
                                                        setOverwritePromptOpen(true);
                                                    } else {
                                                        installMutation.mutate();
                                                    }
                                                }} disabled={selected.status === 'Running' || installMutation.isPending || (selected.authMode === "Password" && !password && !selected.hasSavedCredentials) || (selected.authMode === "PrivateKey" && !privateKeyPem && !selected.hasSavedCredentials)} className="w-full md:w-auto">
                                                    {installMutation.isPending ? <RotateCw className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                                                    Install Agent
                                                </Button>
                                            </CardFooter>
                                         </Card>

                                         <Card className="border-destructive/20">
                                            <CardHeader>
                                                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                                                <CardDescription>Uninstall agent or remove machine configuration</CardDescription>
                                            </CardHeader>
                                            <CardContent className="flex flex-col gap-4">
                                                <div className="flex items-center justify-between p-3 rounded-md bg-destructive/5 border border-destructive/10">
                                                    <div>
                                                        <h4 className="font-semibold text-sm">Uninstall Agent</h4>
                                                        <p className="text-xs text-muted-foreground">Stops the service and removes files from remote machine.</p>
                                                    </div>
                                                    <Button variant="destructive" size="sm" onClick={() => uninstallMutation.mutate()} disabled={selected.status === 'Running' || uninstallMutation.isPending}>Uninstall</Button>
                                                </div>
                                                {uninstallPreview && (
                                                    <div className="text-xs bg-muted p-2 rounded">{uninstallPreview}</div>
                                                )}
                                            </CardContent>
                                         </Card>
                                    </TabsContent>

                                    <TabsContent value="logs" className="mt-0 h-[600px] flex flex-col">
                                        <div className="flex items-center justify-between mb-2 px-1">
                                            <h3 className="text-sm font-semibold">Live Console</h3>
                                            <Button variant="ghost" size="xs" onClick={() => setLogs([])} className="h-6 gap-1">
                                                <Trash2 className="h-3 w-3" /> Clear
                                            </Button>
                                        </div>
                                        <Card className="flex-1 flex flex-col min-h-0 bg-zinc-950 border-zinc-900 shadow-inner">
                                            <ScrollArea className="flex-1 p-4">
                                                <div className="space-y-1 font-mono text-xs">
                                                    {logs.length === 0 ? (
                                                        <div className="text-zinc-600 italic">Waiting for connection logs...</div>
                                                    ) : (
                                                        logs.map((log, i) => (
                                                            <div key={i} className="flex gap-3">
                                                                <span className="text-zinc-500 shrink-0 select-none w-20">{log.ts.split("T")[1]?.slice(0, 8)}</span>
                                                                <span className="text-zinc-300 break-all whitespace-pre-wrap">{log.msg}</span>
                                                            </div>
                                                        ))
                                                    )}
                                                    <div ref={logsEndRef} />
                                                </div>
                                            </ScrollArea>
                                        </Card>
                                    </TabsContent>
                                </div>
                            </ScrollArea>
                        </Tabs>
                    </div>
                )}
            </main>
        </div>
        
         <AlertDialog open={removeNodesPromptOpen} onOpenChange={setRemoveNodesPromptOpen}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Cleanup Associated Nodes?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Uninstall completed. Do you want to remove the associated node entries from ManLab as well?
                    </AlertDialogDescription>
                </AlertDialogHeader>
                 {removeNodesPrompt && (
                   <div className="text-sm my-2 p-3 bg-muted rounded-md space-y-2">
                        {removeNodesPrompt.nodeIds.map(nodeId => {
                            const node = nodesQuery.data?.find(n => n.id === nodeId);
                            return (
                                <div key={nodeId} className="flex items-center gap-2">
                                     <Checkbox 
                                        checked={removeNodesSelectedIds.includes(nodeId)} 
                                        onCheckedChange={(c) => {
                                            if (c) setRemoveNodesSelectedIds(prev => [...prev, nodeId]);
                                            else setRemoveNodesSelectedIds(prev => prev.filter(x => x !== nodeId));
                                        }}
                                     />
                                     <span className="font-mono">{node?.hostname || nodeId}</span>
                                     <Badge variant="outline" className="text-[10px]">{nodeId === removeNodesPrompt.linkedNodeId ? "Linked" : "Associated"}</Badge>
                                </div>
                            )
                        })}
                   </div>
                 )}
                {removeNodesPrompt && removeNodesPrompt.nodeIds.length > 1 && (
                    <div className="flex gap-2 mb-2">
                        <Button variant="outline" size="xs" className="h-6 text-xs" onClick={() => setRemoveNodesSelectedIds(removeNodesPrompt.nodeIds)}>Select All</Button>
                        <Button variant="outline" size="xs" className="h-6 text-xs" onClick={() => setRemoveNodesSelectedIds([])}>Select None</Button>
                    </div>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel>Keep Nodes</AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                        deleteAssociatedNodesMutation.mutate(removeNodesSelectedIds);
                    }} className="bg-destructive hover:bg-destructive/90">Remove Selected</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>

         <AlertDialog open={overwritePromptOpen} onOpenChange={setOverwritePromptOpen}>
            <AlertDialogContent className="sm:max-w-[550px]">
                <AlertDialogHeader>
                    <AlertDialogTitle>Overwrite Existing Agent?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                        <p>An agent or ManLab node installation was detected on this machine. Proceeding will stop and overwrite the existing installation.</p>
                        {existingNodeId && (
                             <div className="font-mono text-xs bg-muted p-2 rounded border flex items-center justify-between">
                                <span>Detected Node ID: {existingNodeId}</span>
                                {installTargetNodeId === existingNodeId && <Badge variant="outline" className="text-[10px] bg-background">Selected Target</Badge>}
                             </div>
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                
                <div className="py-4 space-y-4 border-y">
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Agent Version</Label>
                            <AgentVersionPicker 
                                channel={agentChannel}
                                value={agentSelection} 
                                onChange={setAgentSelection}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Release Channel</Label>
                            <Select value={agentChannel} onValueChange={(v) => v && setAgentChannel(v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="stable">Stable</SelectItem>
                                    <SelectItem value="beta">Beta</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                     </div>

                     {nodesQuery.data && nodesQuery.data.length > 0 && (
                        <div className="space-y-2">
                            <Label>Target Node Identity</Label>
                            <div className="text-[10px] text-muted-foreground mb-1">
                                {installTargetNodeId !== INSTALL_TARGET_NEW 
                                    ? "Install will be linked to this existing node identifier." 
                                    : "A new node identifier will be created."}
                            </div>
                            <Select value={installTargetNodeId} onValueChange={(v) => v && setInstallTargetNodeId(v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={INSTALL_TARGET_NEW}><span className="text-muted-foreground italic">Create New Node Identity</span></SelectItem>
                                    {existingNode && isNodeEligibleForInstallTarget(existingNode.id) && (
                                        <SelectItem value={existingNode.id}>
                                            <span className="font-semibold">{existingNode.hostname}</span> (Detected match)
                                        </SelectItem>
                                    )}
                                    <Separator className="my-1"/>
                                    {nodesQuery.data.filter(n => n.id !== existingNode?.id && isNodeEligibleForInstallTarget(n.id)).map(n => (
                                            <SelectItem key={n.id} value={n.id}>{n.hostname}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                     {hasExistingAgent && existingNodeId && (
                        <div className="pt-2 border-t">
                            <div className="flex items-center space-x-2">
                                <Checkbox id="stop-agent" checked={stopExistingAgentFirst} onCheckedChange={c => setStopExistingAgentFirst(c === true)} />
                                <label htmlFor="stop-agent" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                    Stop the existing agent first (best-effort)
                                </label>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1 ml-6">
                                Attempts to gracefully shut down the running agent on node {existingNodeId} before overwriting.
                            </p>
                        </div>
                     )}
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={async () => {
                        if (hasExistingAgent && stopExistingAgentFirst && existingNodeId) {
                             await stopExistingAgentMutation.mutateAsync(existingNodeId);
                        }
                        installMutation.mutate();
                    }}>Overwrite & Install</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
    </div>
  );
}
