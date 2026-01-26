import { useEffect, useMemo, useState } from "react";
import { parse as parseYaml } from "yaml";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchNodes,
  fetchNodeCommands,
  requestDockerContainerList,
  restartContainer,
  startContainer,
  stopContainer,
  removeContainer,
  inspectContainer,
  fetchContainerLogs,
  fetchContainerStats,
  execInContainer,
  listComposeStacks,
  composeUp,
  composeDown,
} from "@/api";
import type { Command, Container, DockerExecResult, DockerLogsResult, DockerStatsInfo } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Boxes,
  RefreshCw,
  Power,
  PowerOff,
  RotateCcw,
  Trash2,
  TerminalSquare,
  ScrollText,
  Activity,
  Layers,
  Upload,
  Download,
  AlertCircle,
} from "lucide-react";

const DEFAULT_COMPOSE = `services:\n  app:\n    image: nginx:latest\n    ports:\n      - "8080:80"\n`;

const STORAGE_KEYS = {
  logTail: "manlab.docker.logTail",
  logTimestamps: "manlab.docker.logTimestamps",
  autoRefreshLogs: "manlab.docker.autoRefreshLogs",
  autoRefreshStats: "manlab.docker.autoRefreshStats",
  logSince: "manlab.docker.logSince",
  logMaxBytes: "manlab.docker.logMaxBytes",
};

function readStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "true";
}

function readStoredString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  return raw ?? fallback;
}

function writeStoredValue(key: string, value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
}

type ParsedOutput<T> = { data: T | null; error: string | null };

type StatPoint = {
  timestamp: number;
  cpuPercent: number | null;
  memPercent: number | null;
};

type InspectDetails = {
  env: string[];
  mounts: string[];
  ports: string[];
};

function parseJsonOutput<T>(outputLog: string | null | undefined): ParsedOutput<T> {
  if (!outputLog) {
    return { data: null, error: null };
  }

  try {
    let jsonContent = outputLog;
    const arrayStart = jsonContent.indexOf("[");
    const objectStart = jsonContent.indexOf("{");

    let jsonStart = -1;
    if (arrayStart >= 0 && objectStart >= 0) {
      jsonStart = Math.min(arrayStart, objectStart);
    } else if (arrayStart >= 0) {
      jsonStart = arrayStart;
    } else if (objectStart >= 0) {
      jsonStart = objectStart;
    }

    if (jsonStart >= 0) {
      jsonContent = jsonContent.substring(jsonStart);
    }

    const parsed = JSON.parse(jsonContent) as T | { error?: string };
    if (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string") {
      return { data: null, error: parsed.error };
    }

    return { data: parsed as T, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Failed to parse output" };
  }
}

function getContainerBadgeVariant(state: string): "default" | "secondary" | "destructive" | "outline" {
  switch (state.toLowerCase()) {
    case "running":
      return "default";
    case "exited":
      return "outline";
    case "paused":
    case "restarting":
      return "secondary";
    case "dead":
      return "destructive";
    default:
      return "outline";
  }
}

function getPrimaryContainerName(container: Container): string {
  if (!container.names?.length) return "Unknown";
  return container.names[0].replace(/^\//, "");
}

function parsePercent(value?: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace("%", "").trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function renderSparkline(points: Array<number | null>, stroke: string) {
  const cleaned = points.map((p) => (p === null ? 0 : p));
  const max = Math.max(1, ...cleaned);
  const min = Math.min(0, ...cleaned);
  const range = Math.max(1, max - min);
  const width = 120;
  const height = 28;
  const step = cleaned.length > 1 ? width / (cleaned.length - 1) : width;
  const path = cleaned
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="text-muted-foreground">
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string") as string[];
}

function parseCommandTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar: string | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if ((ch === '"' || ch === "'") && (quoteChar === null || quoteChar === ch)) {
      if (inQuotes && quoteChar === ch) {
        inQuotes = false;
        quoteChar = null;
      } else {
        inQuotes = true;
        quoteChar = ch;
      }
      continue;
    }

    if (!inQuotes && ch === " ") {
      if (current.trim().length) {
        tokens.push(current.trim());
      }
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim().length) {
    tokens.push(current.trim());
  }

  return tokens;
}

function getLatestCommand(commands: Command[] | undefined, type: string, predicate?: (cmd: Command) => boolean) {
  if (!commands?.length) return null;
  const sorted = [...commands].sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return bTime - aTime;
  });

  return sorted.find((cmd) => cmd.commandType === type && cmd.status === "Success" && (!predicate || predicate(cmd))) ?? null;
}

function getPayloadContainerId(command: Command): string | null {
  if (!command.payload) return null;
  try {
    const parsed = JSON.parse(command.payload) as { containerId?: string };
    return parsed.containerId ?? null;
  } catch {
    return null;
  }
}

export function DockerStudioPage() {
  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [execInput, setExecInput] = useState("");
  const [composeProjectName, setComposeProjectName] = useState("edge-stack");
  const [composeYaml, setComposeYaml] = useState(DEFAULT_COMPOSE);
  const [containerSearch, setContainerSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "exited" | "paused" | "restarting" | "dead">("all");
  const [sortOption, setSortOption] = useState<"name-asc" | "name-desc" | "created-desc" | "created-asc" | "state-asc">("name-asc");
  const [logTail, setLogTail] = useState(() => readStoredNumber(STORAGE_KEYS.logTail, 200));
  const [logTimestamps, setLogTimestamps] = useState(() => readStoredBoolean(STORAGE_KEYS.logTimestamps, true));
  const [logSince, setLogSince] = useState(() => readStoredString(STORAGE_KEYS.logSince, ""));
  const [logMaxBytes, setLogMaxBytes] = useState(() => readStoredNumber(STORAGE_KEYS.logMaxBytes, 128000));
  const [logFollow, setLogFollow] = useState(false);
  const [logRefreshSeconds, setLogRefreshSeconds] = useState(12);
  const [autoRefreshStats, setAutoRefreshStats] = useState(() => readStoredBoolean(STORAGE_KEYS.autoRefreshStats, false));
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(() => readStoredBoolean(STORAGE_KEYS.autoRefreshLogs, false));
  const [statsRefreshSeconds, setStatsRefreshSeconds] = useState(10);
  const [removeTargets, setRemoveTargets] = useState<Container[]>([]);
  const [removeForce, setRemoveForce] = useState(false);
  const [removeVolumes, setRemoveVolumes] = useState(false);
  const [selectedContainerIds, setSelectedContainerIds] = useState<string[]>([]);
  const [composeEnvRows, setComposeEnvRows] = useState<Array<{ key: string; value: string }>>([]);
  const [composeProfiles, setComposeProfiles] = useState("");

  const activeNodeId = selectedNodeId ?? nodes?.[0]?.id ?? null;

  const { data: commands, refetch: refetchCommands } = useQuery({
    queryKey: ["commands", activeNodeId],
    queryFn: () => (activeNodeId ? fetchNodeCommands(activeNodeId, 80) : Promise.resolve([])),
    enabled: !!activeNodeId,
    refetchInterval: 5000,
  });

  const latestListCommand = getLatestCommand(commands, "docker.list");
  const { data: containerList, error: containerListError } = useMemo(() => {
    const parsed = parseJsonOutput<Container[]>(latestListCommand?.outputLog);
    if (!parsed.data) return { data: [], error: parsed.error };
    if (Array.isArray(parsed.data)) return { data: parsed.data, error: parsed.error };
    return { data: [], error: parsed.error ?? "Unexpected response." };
  }, [latestListCommand?.outputLog]);

  const containers = useMemo(() => {
    const list = containerList ?? [];
    const filtered = list.filter((container) => {
      const matchesStatus = statusFilter === "all" || container.state.toLowerCase() === statusFilter;
      const search = containerSearch.trim().toLowerCase();
      if (!search) return matchesStatus;
      const name = getPrimaryContainerName(container).toLowerCase();
      return matchesStatus && (name.includes(search) || container.image.toLowerCase().includes(search));
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortOption) {
        case "name-desc":
          return getPrimaryContainerName(b).localeCompare(getPrimaryContainerName(a));
        case "created-desc":
          return new Date(b.created).getTime() - new Date(a.created).getTime();
        case "created-asc":
          return new Date(a.created).getTime() - new Date(b.created).getTime();
        case "state-asc":
          return a.state.localeCompare(b.state);
        case "name-asc":
        default:
          return getPrimaryContainerName(a).localeCompare(getPrimaryContainerName(b));
      }
    });

    return sorted;
  }, [containerList, containerSearch, statusFilter, sortOption]);

  const selectedContainer = containers.find((c) => c.id === selectedContainerId) ?? containers[0] ?? null;

  const statsCommand = getLatestCommand(
    commands,
    "docker.stats",
    (cmd) => {
      const payloadId = getPayloadContainerId(cmd);
      return !payloadId || payloadId === selectedContainer?.id;
    }
  );

  const { data: statsList } = useMemo(() => {
    const parsed = parseJsonOutput<DockerStatsInfo[]>(statsCommand?.outputLog);
    return { data: parsed.data ?? [] };
  }, [statsCommand?.outputLog]);

  const activeStats = statsList?.find((s) => selectedContainer && s.id.startsWith(selectedContainer.id)) ?? null;

  const logsCommand = getLatestCommand(
    commands,
    "docker.logs",
    (cmd) => getPayloadContainerId(cmd) === selectedContainer?.id
  );

  const { data: logsResult, error: logsError } = useMemo(() => {
    const parsed = parseJsonOutput<DockerLogsResult>(logsCommand?.outputLog);
    return { data: parsed.data, error: parsed.error };
  }, [logsCommand?.outputLog]);

  const inspectCommand = getLatestCommand(
    commands,
    "docker.inspect",
    (cmd) => getPayloadContainerId(cmd) === selectedContainer?.id
  );

  const { data: inspectData } = useMemo(() => {
    const parsed = parseJsonOutput<unknown>(inspectCommand?.outputLog);
    return { data: parsed.data };
  }, [inspectCommand?.outputLog]);

  const composeListCommand = getLatestCommand(commands, "compose.list");
  const { data: composeStacks, error: composeError } = useMemo(() => {
    const parsed = parseJsonOutput<Record<string, unknown>[]>(composeListCommand?.outputLog);
    if (Array.isArray(parsed.data)) return { data: parsed.data, error: parsed.error };
    return { data: [], error: parsed.error };
  }, [composeListCommand?.outputLog]);

  const execCommand = getLatestCommand(
    commands,
    "docker.exec",
    (cmd) => getPayloadContainerId(cmd) === selectedContainer?.id
  );

  const { data: execResult } = useMemo(() => {
    const parsed = parseJsonOutput<DockerExecResult>(execCommand?.outputLog);
    return { data: parsed.data };
  }, [execCommand?.outputLog]);

  const composeUpCommand = getLatestCommand(commands, "compose.up");
  const composeDownCommand = getLatestCommand(commands, "compose.down");

  const latestComposeCommand = useMemo(() => {
    const candidates = [composeUpCommand, composeDownCommand].filter(Boolean) as Command[];
    if (!candidates.length) return null;
    return candidates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [composeUpCommand, composeDownCommand]);

  const refreshDockerList = useMutation({
    mutationFn: () => (activeNodeId ? requestDockerContainerList(activeNodeId) : Promise.reject()),
    onSuccess: () => refetchCommands(),
  });

  const refreshComposeList = useMutation({
    mutationFn: () => (activeNodeId ? listComposeStacks(activeNodeId) : Promise.reject()),
    onSuccess: () => refetchCommands(),
  });

  const actionMutation = useMutation({
    mutationFn: (action: Promise<Command>) => action,
    onSuccess: () => refetchCommands(),
  });

  const execMutation = useMutation({
    mutationFn: () => {
      if (!activeNodeId || !selectedContainer) return Promise.reject();
      const tokens = parseCommandTokens(execInput);
      return execInContainer(activeNodeId, {
        containerId: selectedContainer.id,
        command: tokens,
      });
    },
    onSuccess: () => {
      setExecInput("");
      refetchCommands();
    },
  });

  const composeUpMutation = useMutation({
    mutationFn: () => {
      if (!activeNodeId) return Promise.reject();
      if (composeValidationError) return Promise.reject(new Error(composeValidationError));
      return composeUp(activeNodeId, {
        projectName: composeProjectName,
        composeYaml,
        environment: composeEnvObject,
        detach: true,
        removeOrphans: true,
        profiles: composeProfileList,
      });
    },
    onSuccess: () => refetchCommands(),
  });

  const composeDownMutation = useMutation({
    mutationFn: () => {
      if (!activeNodeId) return Promise.reject();
      return composeDown(activeNodeId, {
        projectName: composeProjectName,
        composeYaml,
        environment: composeEnvObject,
        removeOrphans: true,
        volumes: false,
        removeImages: false,
      });
    },
    onSuccess: () => refetchCommands(),
  });

  const nodeOptions = nodes ?? [];
  const nodeStatus = nodeOptions.find((n) => n.id === activeNodeId)?.status ?? "Offline";

  const containerActionMap = useMemo(() => {
    const map = new Map<string, Command>();
    const actionTypes = new Set(["docker.start", "docker.stop", "docker.restart", "docker.remove"]);
    for (const cmd of commands ?? []) {
      if (!actionTypes.has(cmd.commandType)) continue;
      const containerId = getPayloadContainerId(cmd);
      if (!containerId) continue;
      const existing = map.get(containerId);
      if (!existing || new Date(cmd.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        map.set(containerId, cmd);
      }
    }
    return map;
  }, [commands]);

  const pendingStatuses = new Set(["Queued", "Sent", "InProgress"]);
  const selectedIdSet = useMemo(() => new Set(selectedContainerIds), [selectedContainerIds]);
  const selectableIds = useMemo(() => containers.map((c) => c.id), [containers]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIdSet.has(id));
  const selectedContainers = useMemo(
    () => containers.filter((container) => selectedIdSet.has(container.id)),
    [containers, selectedIdSet]
  );

  const composeValidationError = useMemo(() => {
    try {
      const parsed = parseYaml(composeYaml) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== "object") {
        return "Compose YAML must be a valid object.";
      }
      if (!("services" in parsed)) {
        return "Compose YAML must include a 'services' section.";
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Compose YAML is invalid.";
    }
  }, [composeYaml]);

  const composeEnvObject = useMemo(() => {
    const env: Record<string, string> = {};
    for (const row of composeEnvRows) {
      const key = row.key.trim();
      if (!key) continue;
      env[key] = row.value;
    }
    return Object.keys(env).length ? env : undefined;
  }, [composeEnvRows]);

  const composeProfileList = useMemo(() => {
    const raw = composeProfiles
      .split(",")
      .map((profile) => profile.trim())
      .filter(Boolean);
    return raw.length ? raw : undefined;
  }, [composeProfiles]);

  const statsHistory = useMemo(() => {
    if (!selectedContainer) return [] as StatPoint[];
    const history: StatPoint[] = [];
    const statsCommands = (commands ?? [])
      .filter((cmd) => cmd.commandType === "docker.stats" && cmd.status === "Success" && cmd.outputLog)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (const cmd of statsCommands) {
      const payloadId = getPayloadContainerId(cmd);
      if (payloadId && payloadId !== selectedContainer.id) continue;
      const parsed = parseJsonOutput<DockerStatsInfo[]>(cmd.outputLog);
      const list = parsed.data ?? [];
      const entry = list.find((stat) => stat.id.startsWith(selectedContainer.id));
      if (!entry) continue;
      history.push({
        timestamp: new Date(cmd.createdAt).getTime(),
        cpuPercent: parsePercent(entry.cpuPercent),
        memPercent: parsePercent(entry.memPercent),
      });
    }

    return history.slice(-30);
  }, [commands, selectedContainer]);

  const logsHistory = useMemo(() => {
    if (!selectedContainer) return { content: "", truncated: false };
    if (!logFollow) return { content: logsResult?.content ?? "", truncated: !!logsResult?.truncated };

    const logCommands = (commands ?? [])
      .filter((cmd) => cmd.commandType === "docker.logs" && cmd.status === "Success" && cmd.outputLog)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-5);

    const chunks: string[] = [];
    let truncated = false;
    for (const cmd of logCommands) {
      const payloadId = getPayloadContainerId(cmd);
      if (payloadId !== selectedContainer.id) continue;
      const parsed = parseJsonOutput<DockerLogsResult>(cmd.outputLog);
      if (parsed.data?.content) {
        chunks.push(parsed.data.content);
        truncated = truncated || parsed.data.truncated;
      }
    }

    return {
      content: chunks.join("\n\n---\n\n"),
      truncated,
    };
  }, [commands, logsResult, logFollow, selectedContainer]);

  const inspectSummary = useMemo(() => {
    if (!isRecord(inspectData)) return null;
    const root = Array.isArray(inspectData) ? inspectData[0] : inspectData;
    if (!isRecord(root)) return null;

    const state = isRecord(root.State) ? root.State : {};
    const config = isRecord(root.Config) ? root.Config : {};
    const hostConfig = isRecord(root.HostConfig) ? root.HostConfig : {};
    const mounts = Array.isArray(root.Mounts) ? root.Mounts : [];
    const networkSettings = isRecord(root.NetworkSettings) ? root.NetworkSettings : {};
    const ports = isRecord(networkSettings.Ports) ? networkSettings.Ports : {};
    const health = isRecord(state.Health) ? state.Health : {};

    return {
      name: typeof root.Name === "string" ? root.Name : "",
      image: typeof root.Image === "string" ? root.Image : "",
      created: typeof root.Created === "string" ? root.Created : "",
      status: typeof state.Status === "string" ? state.Status : "",
      health: typeof health.Status === "string" ? health.Status : "",
      restartCount: typeof state.RestartCount === "number" ? state.RestartCount : 0,
      user: typeof config.User === "string" ? config.User : "",
      networkMode: typeof hostConfig.NetworkMode === "string" ? hostConfig.NetworkMode : "",
      envCount: Array.isArray(config.Env) ? config.Env.length : 0,
      mountCount: mounts.length,
      portCount: Object.keys(ports).length,
    };
  }, [inspectData]);

  const inspectDetails = useMemo<InspectDetails | null>(() => {
    if (!isRecord(inspectData)) return null;
    const root = Array.isArray(inspectData) ? inspectData[0] : inspectData;
    if (!isRecord(root)) return null;

    const config = isRecord(root.Config) ? root.Config : {};
    const env = toStringArray(config.Env);

    const mounts = Array.isArray(root.Mounts)
      ? root.Mounts
          .map((mount) => {
            if (!isRecord(mount)) return null;
            const source = typeof mount.Source === "string" ? mount.Source : "";
            const target = typeof mount.Destination === "string" ? mount.Destination : "";
            const type = typeof mount.Type === "string" ? mount.Type : "";
            const mode = typeof mount.RW === "boolean" ? (mount.RW ? "rw" : "ro") : "";
            const label = [type, mode].filter(Boolean).join(":");
            const descriptor = [source, "→", target].filter(Boolean).join(" ");
            return label ? `${descriptor} (${label})` : descriptor;
          })
          .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];

    const networkSettings = isRecord(root.NetworkSettings) ? root.NetworkSettings : {};
    const portsObj = isRecord(networkSettings.Ports) ? networkSettings.Ports : {};
    const ports = Object.entries(portsObj).flatMap(([containerPort, bindings]) => {
      if (!Array.isArray(bindings)) return [`${containerPort} (internal)`];
      const items = bindings
        .map((binding) => {
          if (!isRecord(binding)) return null;
          const hostIp = typeof binding.HostIp === "string" ? binding.HostIp : "";
          const hostPort = typeof binding.HostPort === "string" ? binding.HostPort : "";
          const hostLabel = [hostIp, hostPort].filter(Boolean).join(":");
          return hostLabel ? `${hostLabel} → ${containerPort}` : null;
        })
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
      return items.length ? items : [`${containerPort} (internal)`];
    });

    return {
      env,
      mounts,
      ports,
    };
  }, [inspectData]);

  const copyToClipboard = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore clipboard failures
    }
  };

  const runningCount = containers.filter((c) => c.state === "running").length;
  const exitedCount = containers.filter((c) => c.state === "exited").length;

  useEffect(() => {
    if (!autoRefreshStats || !activeNodeId || !selectedContainer) return;
    const timer = setInterval(() => {
      actionMutation.mutate(fetchContainerStats(activeNodeId, selectedContainer.id));
    }, Math.max(5, statsRefreshSeconds) * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshStats, activeNodeId, selectedContainer, statsRefreshSeconds, actionMutation]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.logTail, String(logTail));
  }, [logTail]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.logTimestamps, String(logTimestamps));
  }, [logTimestamps]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.logSince, logSince);
  }, [logSince]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.logMaxBytes, String(logMaxBytes));
  }, [logMaxBytes]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.autoRefreshLogs, String(autoRefreshLogs));
  }, [autoRefreshLogs]);

  useEffect(() => {
    writeStoredValue(STORAGE_KEYS.autoRefreshStats, String(autoRefreshStats));
  }, [autoRefreshStats]);

  useEffect(() => {
    if (!autoRefreshLogs || !activeNodeId || !selectedContainer) return;
    const timer = setInterval(() => {
      actionMutation.mutate(
        fetchContainerLogs(activeNodeId, {
          containerId: selectedContainer.id,
          tail: logTail,
          since: logSince.trim() || undefined,
          timestamps: logTimestamps,
          maxBytes: logMaxBytes > 0 ? logMaxBytes : undefined,
        })
      );
    }, Math.max(5, logRefreshSeconds) * 1000);
    return () => clearInterval(timer);
  }, [
    autoRefreshLogs,
    activeNodeId,
    selectedContainer,
    logTail,
    logSince,
    logTimestamps,
    logMaxBytes,
    logRefreshSeconds,
    actionMutation,
  ]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background/50">
        <div className="mx-auto max-w-7xl space-y-8 p-4 md:p-6 lg:p-8">
          <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-primary to-primary/60">
                Docker Studio
              </h1>
              <p className="text-muted-foreground text-lg font-light">
                High-fidelity container + compose management, optimized for operational flow.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={activeNodeId ?? undefined}
                onValueChange={(val) => {
                  setSelectedNodeId(val);
                  setSelectedContainerId(null);
                  setSelectedContainerIds([]);
                }}
              >
                <SelectTrigger className="w-60">
                  <SelectValue placeholder="Select node" />
                </SelectTrigger>
                <SelectContent>
                  {nodeOptions.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.hostname} · {node.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant={nodeStatus === "Online" ? "default" : "secondary"}>{nodeStatus}</Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  refreshDockerList.mutate();
                  refreshComposeList.mutate();
                }}
                disabled={!activeNodeId}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </header>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Containers</CardDescription>
                <CardTitle className="text-2xl">{containers.length}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Active inventory for selected node.</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Running</CardDescription>
                <CardTitle className="text-2xl text-primary">{runningCount}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Live workloads and uptime.</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Exited</CardDescription>
                <CardTitle className="text-2xl text-muted-foreground">{exitedCount}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Recently stopped containers.</CardContent>
            </Card>
          </div>

          <Tabs defaultValue="containers" className="space-y-4">
            <TabsList>
              <TabsTrigger value="containers" className="gap-2">
                <Boxes className="h-4 w-4" />
                Containers
              </TabsTrigger>
              <TabsTrigger value="stacks" className="gap-2">
                <Layers className="h-4 w-4" />
                Stacks
              </TabsTrigger>
            </TabsList>

            <TabsContent value="containers" className="space-y-4">
              {containerListError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Docker list failed</AlertTitle>
                  <AlertDescription>{containerListError}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <Card className="min-h-135">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Containers</CardTitle>
                      <CardDescription>Manage runtime state and actions.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refreshDockerList.mutate()}
                        disabled={!activeNodeId || refreshDockerList.isPending}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                      </Button>
                      {selectedContainerIds.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectedContainerIds.forEach((id) => actionMutation.mutate(startContainer(activeNodeId ?? "", id)))}
                            disabled={!activeNodeId}
                          >
                            Start
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectedContainerIds.forEach((id) => actionMutation.mutate(stopContainer(activeNodeId ?? "", id)))}
                            disabled={!activeNodeId}
                          >
                            Stop
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectedContainerIds.forEach((id) => actionMutation.mutate(restartContainer(activeNodeId ?? "", id)))}
                            disabled={!activeNodeId}
                          >
                            Restart
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setRemoveForce(false);
                              setRemoveVolumes(false);
                              setRemoveTargets(selectedContainers);
                            }}
                            disabled={!activeNodeId}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-3 pb-3">
                      <div className="flex flex-wrap gap-2">
                        <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={(checked) => {
                              if (checked === true) {
                                setSelectedContainerIds(selectableIds);
                              } else {
                                setSelectedContainerIds([]);
                              }
                            }}
                          />
                          <span>Select all</span>
                          {selectedContainerIds.length > 0 && (
                            <span className="text-foreground">({selectedContainerIds.length} selected)</span>
                          )}
                        </div>
                        <Input
                          value={containerSearch}
                          onChange={(e) => setContainerSearch(e.target.value)}
                          placeholder="Search containers by name or image"
                          className="h-9 min-w-60"
                        />
                        <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val as typeof statusFilter)}>
                          <SelectTrigger className="h-9 w-40">
                            <SelectValue placeholder="All statuses" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="running">Running</SelectItem>
                            <SelectItem value="exited">Exited</SelectItem>
                            <SelectItem value="paused">Paused</SelectItem>
                            <SelectItem value="restarting">Restarting</SelectItem>
                            <SelectItem value="dead">Dead</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={sortOption} onValueChange={(val) => setSortOption(val as typeof sortOption)}>
                          <SelectTrigger className="h-9 w-44">
                            <SelectValue placeholder="Sort" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="name-asc">Name (A → Z)</SelectItem>
                            <SelectItem value="name-desc">Name (Z → A)</SelectItem>
                            <SelectItem value="created-desc">Created (newest)</SelectItem>
                            <SelectItem value="created-asc">Created (oldest)</SelectItem>
                            <SelectItem value="state-asc">State</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex flex-wrap gap-2">
                          {["all", "running", "exited", "restarting"].map((state) => (
                            <Button
                              key={state}
                              variant={statusFilter === state ? "default" : "outline"}
                              size="sm"
                              onClick={() => setStatusFilter(state as typeof statusFilter)}
                            >
                              {state === "all" ? "All" : state.charAt(0).toUpperCase() + state.slice(1)}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <ScrollArea className="h-115 pr-3">
                      <div className="space-y-3">
                        {containers.map((container) => {
                          const isSelected = selectedContainer?.id === container.id;
                          const name = getPrimaryContainerName(container);
                          const latestAction = containerActionMap.get(container.id) ?? null;
                          const isPending = latestAction ? pendingStatuses.has(latestAction.status) : false;
                          const pendingLabel = latestAction?.commandType.replace("docker.", "") ?? "action";
                          return (
                            <button
                              key={container.id}
                              type="button"
                              onClick={() => setSelectedContainerId(container.id)}
                              className={`w-full rounded-xl border p-4 text-left transition-all hover:shadow-sm ${
                                isSelected ? "border-primary/40 bg-primary/5" : "border-border"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      checked={selectedIdSet.has(container.id)}
                                      onCheckedChange={(checked) => {
                                        if (checked === true) {
                                          setSelectedContainerIds((prev) => (prev.includes(container.id) ? prev : [...prev, container.id]));
                                        } else {
                                          setSelectedContainerIds((prev) => prev.filter((id) => id !== container.id));
                                        }
                                      }}
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                    <span className="text-sm font-semibold text-foreground">{name}</span>
                                    <Badge variant={getContainerBadgeVariant(container.state)}>{container.state}</Badge>
                                    {isPending && (
                                      <Badge variant="secondary">Pending {pendingLabel}</Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground truncate">{container.image}</p>
                                  <p className="text-xs text-muted-foreground/70 truncate">{container.status}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          actionMutation.mutate(startContainer(activeNodeId ?? "", container.id));
                                        }}
                                        disabled={isPending}
                                      >
                                        <Power className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Start</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          actionMutation.mutate(stopContainer(activeNodeId ?? "", container.id));
                                        }}
                                        disabled={isPending}
                                      >
                                        <PowerOff className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Stop</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          actionMutation.mutate(restartContainer(activeNodeId ?? "", container.id));
                                        }}
                                        disabled={isPending}
                                      >
                                        <RotateCcw className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Restart</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRemoveForce(false);
                                          setRemoveVolumes(false);
                                          setRemoveTargets([container]);
                                        }}
                                        disabled={isPending}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Remove</TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                        {!containers.length && (
                          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                            No containers available for this node yet.
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="min-h-135">
                  <CardHeader>
                    <CardTitle>Container Console</CardTitle>
                    <CardDescription>Inspect, log, and exec workflows.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedContainer ? (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold">{getPrimaryContainerName(selectedContainer)}</div>
                            <div className="text-xs text-muted-foreground">{selectedContainer.image}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={getContainerBadgeVariant(selectedContainer.state)}>{selectedContainer.state}</Badge>
                            {(() => {
                              const latestAction = containerActionMap.get(selectedContainer.id) ?? null;
                              if (!latestAction || !pendingStatuses.has(latestAction.status)) return null;
                              const label = latestAction.commandType.replace("docker.", "");
                              return <Badge variant="secondary">Pending {label}</Badge>;
                            })()}
                          </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button
                            variant="outline"
                            onClick={() => actionMutation.mutate(inspectContainer(activeNodeId ?? "", selectedContainer.id))}
                            className="justify-start"
                          >
                            <ScrollText className="h-4 w-4 mr-2" />
                            Inspect
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => actionMutation.mutate(fetchContainerStats(activeNodeId ?? "", selectedContainer.id))}
                            className="justify-start"
                          >
                            <Activity className="h-4 w-4 mr-2" />
                            Stats
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              actionMutation.mutate(
                                fetchContainerLogs(activeNodeId ?? "", {
                                  containerId: selectedContainer.id,
                                  tail: logTail,
                                  since: logSince.trim() || undefined,
                                  timestamps: logTimestamps,
                                  maxBytes: logMaxBytes > 0 ? logMaxBytes : undefined,
                                })
                              )
                            }
                            className="justify-start"
                          >
                            <ScrollText className="h-4 w-4 mr-2" />
                            Logs
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setExecInput("sh")}
                            className="justify-start"
                          >
                            <TerminalSquare className="h-4 w-4 mr-2" />
                            Quick exec
                          </Button>
                        </div>

                        <div className="grid gap-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">Log tail</span>
                              <Input
                                type="number"
                                value={logTail}
                                onChange={(e) => setLogTail(Number(e.target.value || 0))}
                                className="h-8 w-20"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">Max bytes</span>
                              <Input
                                type="number"
                                value={logMaxBytes}
                                onChange={(e) => setLogMaxBytes(Number(e.target.value || 0))}
                                className="h-8 w-24"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">Refresh</span>
                              <Input
                                type="number"
                                value={logRefreshSeconds}
                                onChange={(e) => setLogRefreshSeconds(Number(e.target.value || 0))}
                                className="h-8 w-20"
                              />
                              <span>s</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span>Since</span>
                              <Input
                                value={logSince}
                                onChange={(e) => setLogSince(e.target.value)}
                                placeholder="e.g. 10m, 2025-01-26T00:00:00Z"
                                className="h-8 min-w-52"
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setLogSince("")}
                              >
                                Clear
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <span>Show timestamps</span>
                              <Switch checked={logTimestamps} onCheckedChange={setLogTimestamps} />
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span>Follow</span>
                              <Switch checked={logFollow} onCheckedChange={setLogFollow} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span>Auto-refresh logs</span>
                              <Switch checked={autoRefreshLogs} onCheckedChange={setAutoRefreshLogs} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span>Auto-refresh stats</span>
                              <Switch checked={autoRefreshStats} onCheckedChange={setAutoRefreshStats} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">Stats refresh</span>
                              <Input
                                type="number"
                                value={statsRefreshSeconds}
                                onChange={(e) => setStatsRefreshSeconds(Number(e.target.value || 0))}
                                className="h-8 w-20"
                              />
                              <span>s</span>
                            </div>
                          </div>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">Latest Stats</div>
                          {activeStats ? (
                            <div className="grid gap-2 text-xs text-muted-foreground">
                              <div className="flex items-center justify-between">
                                <span>CPU</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-foreground">{activeStats.cpuPercent}</span>
                                  {renderSparkline(
                                    statsHistory.map((p) => p.cpuPercent),
                                    "hsl(var(--primary))"
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Memory</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-foreground">{activeStats.memUsage}</span>
                                  {renderSparkline(
                                    statsHistory.map((p) => p.memPercent),
                                    "hsl(var(--muted-foreground))"
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Network</span>
                                <span className="text-foreground">{activeStats.netIO}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Block IO</span>
                                <span className="text-foreground">{activeStats.blockIO}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">Run stats to populate metrics.</div>
                          )}
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">Exec Command</div>
                          <div className="flex gap-2">
                            <Input
                              value={execInput}
                              onChange={(e) => setExecInput(e.target.value)}
                              placeholder='e.g. "bash" or "node -v"'
                            />
                            <Button
                              onClick={() => execMutation.mutate()}
                              disabled={!execInput.trim() || execMutation.isPending}
                            >
                              Run
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Use quotes for arguments with spaces. Output is stored in the command log.
                          </p>
                          {execResult && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <div>
                                  Exit code: <span className="text-foreground">{execResult.exitCode}</span>
                                  {execResult.success ? "" : " · Failed"}
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => copyToClipboard(execResult.output || execResult.error || "")}
                                >
                                  Copy output
                                </Button>
                              </div>
                              <ScrollArea className="h-28 rounded-lg border bg-muted/30 p-3 text-xs">
                                <pre className="whitespace-pre-wrap text-muted-foreground">
                                  {execResult.output || execResult.error || "No output captured."}
                                </pre>
                              </ScrollArea>
                            </div>
                          )}
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-muted-foreground">Latest Logs</span>
                            <div className="flex items-center gap-2">
                              {logsHistory.truncated && (
                                <Badge variant="secondary">Truncated</Badge>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => copyToClipboard(logsHistory.content)}
                              >
                                Copy logs
                              </Button>
                            </div>
                          </div>
                          {logsError && <div className="text-xs text-destructive">{logsError}</div>}
                          <ScrollArea className="h-36 rounded-lg border bg-muted/30 p-3 text-xs">
                            <pre className="whitespace-pre-wrap text-muted-foreground">
                              {logsHistory.content || "Run logs to view output."}
                            </pre>
                          </ScrollArea>
                        </div>

                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">Inspect Summary</div>
                          {inspectSummary ? (
                            <div className="grid gap-2 text-xs text-muted-foreground">
                              <div className="flex items-center justify-between">
                                <span>Name</span>
                                <span className="text-foreground">{inspectSummary.name}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Image</span>
                                <span className="text-foreground">{inspectSummary.image}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Status</span>
                                <span className="text-foreground">{inspectSummary.status || "unknown"}</span>
                              </div>
                              {inspectSummary.health && (
                                <div className="flex items-center justify-between">
                                  <span>Health</span>
                                  <span className="text-foreground">{inspectSummary.health}</span>
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                <span>Restart count</span>
                                <span className="text-foreground">{inspectSummary.restartCount}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Network mode</span>
                                <span className="text-foreground">{inspectSummary.networkMode || "default"}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Env vars</span>
                                <span className="text-foreground">{inspectSummary.envCount}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Mounts</span>
                                <span className="text-foreground">{inspectSummary.mountCount}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>Ports</span>
                                <span className="text-foreground">{inspectSummary.portCount}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">Run inspect to view summary.</div>
                          )}
                        </div>

                        {inspectDetails && (
                          <div className="grid gap-4 text-xs text-muted-foreground sm:grid-cols-2">
                            <div className="space-y-2">
                              <div className="font-semibold text-muted-foreground">Ports</div>
                              <ScrollArea className="h-24 rounded-lg border bg-muted/30 p-2">
                                <ul className="space-y-1">
                                  {inspectDetails.ports.length ? (
                                    inspectDetails.ports.map((port) => <li key={port}>{port}</li>)
                                  ) : (
                                    <li className="text-muted-foreground">No published ports.</li>
                                  )}
                                </ul>
                              </ScrollArea>
                            </div>
                            <div className="space-y-2">
                              <div className="font-semibold text-muted-foreground">Mounts</div>
                              <ScrollArea className="h-24 rounded-lg border bg-muted/30 p-2">
                                <ul className="space-y-1">
                                  {inspectDetails.mounts.length ? (
                                    inspectDetails.mounts.map((mount) => <li key={mount}>{mount}</li>)
                                  ) : (
                                    <li className="text-muted-foreground">No mounts detected.</li>
                                  )}
                                </ul>
                              </ScrollArea>
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                              <div className="font-semibold text-muted-foreground">Environment</div>
                              <ScrollArea className="h-24 rounded-lg border bg-muted/30 p-2">
                                <ul className="space-y-1">
                                  {inspectDetails.env.length ? (
                                    inspectDetails.env.map((env) => <li key={env}>{env}</li>)
                                  ) : (
                                    <li className="text-muted-foreground">No environment variables.</li>
                                  )}
                                </ul>
                              </ScrollArea>
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-muted-foreground">Inspect JSON</span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyToClipboard(inspectData ? JSON.stringify(inspectData, null, 2) : "")}
                            >
                              Copy JSON
                            </Button>
                          </div>
                          <ScrollArea className="h-40 rounded-lg border bg-muted/30 p-3 text-xs">
                            <pre className="whitespace-pre-wrap text-muted-foreground">
                              {inspectData ? JSON.stringify(inspectData, null, 2) : "Run inspect to view output."}
                            </pre>
                          </ScrollArea>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">Select a container to view details.</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="stacks" className="space-y-4">
              {composeError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Compose list failed</AlertTitle>
                  <AlertDescription>{composeError}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <Card className="min-h-130">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Stacks</CardTitle>
                      <CardDescription>Compose deployments and service footprints.</CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refreshComposeList.mutate()}
                      disabled={!activeNodeId || refreshComposeList.isPending}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-105 pr-3">
                      <div className="space-y-3">
                        {composeStacks?.map((stack, idx) => {
                          const name = (stack.Name ?? stack.name ?? stack.Project ?? "Unnamed") as string;
                          const status = (stack.Status ?? stack.status ?? "unknown") as string;
                          const config = (stack.ConfigFiles ?? stack.configFiles ?? "") as string;
                          return (
                            <div key={`${name}-${idx}`} className="rounded-xl border p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="text-sm font-semibold">{name}</div>
                                  <div className="text-xs text-muted-foreground">{config || "Compose stack"}</div>
                                </div>
                                <Badge variant={status.includes("running") ? "default" : "secondary"}>{status}</Badge>
                              </div>
                            </div>
                          );
                        })}
                        {!composeStacks?.length && (
                          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                            No stacks detected. Deploy to create your first stack.
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="min-h-130">
                  <CardHeader>
                    <CardTitle>Deploy Stack</CardTitle>
                    <CardDescription>Compose YAML + lifecycle controls.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">Project Name</div>
                      <Input
                        value={composeProjectName}
                        onChange={(e) => setComposeProjectName(e.target.value)}
                        placeholder="edge-stack"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">Profiles (comma-separated)</div>
                      <Input
                        value={composeProfiles}
                        onChange={(e) => setComposeProfiles(e.target.value)}
                        placeholder="web, worker"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">Compose YAML</div>
                      <Textarea
                        value={composeYaml}
                        onChange={(e) => setComposeYaml(e.target.value)}
                        className="min-h-55 font-mono text-xs"
                      />
                      {composeValidationError ? (
                        <div className="text-xs text-destructive">{composeValidationError}</div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Compose YAML looks good.</div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">Environment Variables</div>
                      <div className="space-y-2">
                        {composeEnvRows.map((row, index) => (
                          <div key={`env-${index}`} className="flex flex-wrap items-center gap-2">
                            <Input
                              value={row.key}
                              onChange={(e) => {
                                const next = [...composeEnvRows];
                                next[index] = { ...next[index], key: e.target.value };
                                setComposeEnvRows(next);
                              }}
                              placeholder="KEY"
                              className="h-9 min-w-40"
                            />
                            <Input
                              value={row.value}
                              onChange={(e) => {
                                const next = [...composeEnvRows];
                                next[index] = { ...next[index], value: e.target.value };
                                setComposeEnvRows(next);
                              }}
                              placeholder="Value"
                              className="h-9 min-w-40"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setComposeEnvRows((prev) => prev.filter((_, i) => i !== index))}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setComposeEnvRows((prev) => [...prev, { key: "", value: "" }])}
                        >
                          Add variable
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        onClick={() => composeUpMutation.mutate()}
                        disabled={!activeNodeId || composeUpMutation.isPending || !!composeValidationError}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Compose Up
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => composeDownMutation.mutate()}
                        disabled={!activeNodeId || composeDownMutation.isPending}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Compose Down
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Compose actions run on the selected node. Stack output is recorded in command logs.
                    </p>
                    <Separator />
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">Latest Compose Output</div>
                      <ScrollArea className="h-28 rounded-lg border bg-muted/30 p-3 text-xs">
                        <pre className="whitespace-pre-wrap text-muted-foreground">
                          {latestComposeCommand?.outputLog ?? "Run compose up/down to view output."}
                        </pre>
                      </ScrollArea>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>

          <Card>
            <CardHeader>
              <CardTitle>Operational History</CardTitle>
              <CardDescription>Latest docker + compose actions for this node.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {(commands ?? [])
                  .filter((cmd) =>
                    cmd.commandType.startsWith("docker.") || cmd.commandType.startsWith("compose.")
                  )
                  .slice(0, 8)
                  .map((cmd) => (
                    <div key={cmd.id} className="rounded-lg border p-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-foreground">{cmd.commandType}</div>
                        <Badge variant={cmd.status === "Success" ? "default" : cmd.status === "Failed" ? "destructive" : "secondary"}>
                          {cmd.status}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground">{new Date(cmd.createdAt).toLocaleString()}</div>
                      {cmd.outputLog && (
                        <ScrollArea className="mt-2 h-20 rounded-md border bg-muted/30 p-2">
                          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground">
                            {cmd.outputLog}
                          </pre>
                        </ScrollArea>
                      )}
                    </div>
                  ))}
                {!commands?.length && (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No docker or compose command history yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <AlertDialog open={removeTargets.length > 0} onOpenChange={(open) => !open && setRemoveTargets([])}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{removeTargets.length === 1 ? "Remove container?" : "Remove containers?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTargets.length === 1
                ? `This will permanently remove the container "${getPrimaryContainerName(removeTargets[0])}".`
                : `This will permanently remove ${removeTargets.length} containers.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold">Force removal</div>
                <div className="text-xs text-muted-foreground">Stops the container if it is running.</div>
              </div>
              <Switch checked={removeForce} onCheckedChange={setRemoveForce} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold">Remove volumes</div>
                <div className="text-xs text-muted-foreground">Deletes attached anonymous volumes.</div>
              </div>
              <Switch checked={removeVolumes} onCheckedChange={setRemoveVolumes} />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!removeTargets.length || !activeNodeId) return;
                removeTargets.forEach((target) => {
                  actionMutation.mutate(
                    removeContainer(activeNodeId, {
                      containerId: target.id,
                      force: removeForce,
                      removeVolumes,
                    })
                  );
                });
                setRemoveTargets([]);
                setSelectedContainerIds([]);
              }}
            >
              {removeTargets.length === 1 ? "Remove container" : "Remove containers"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
