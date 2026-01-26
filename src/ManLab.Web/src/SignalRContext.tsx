/**
 * SignalR Context for real-time WebSocket communication.
 * Provides connection management and live updates for the dashboard.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  HubConnectionBuilder,
  HubConnection,
  LogLevel,
} from "@microsoft/signalr";
import { useQueryClient } from "@tanstack/react-query";
import type { Node, NodeStatus, AgentBackoffStatus } from "./types";

/**
 * Local agent log entry for real-time log streaming.
 */
export interface LocalAgentLogEntry {
  machineId: string;
  timestamp: string;
  message: string;
}

/**
 * Command output entry for live command streaming.
 */
export interface CommandOutputEntry {
  commandId: string;
  nodeId: string;
  status: string;
  logs: string;
  timestamp: string;
}

const COMMAND_OUTPUT_STORAGE_KEY = "manlab:command_output_logs";

const loadCommandOutputLogs = (): Map<string, CommandOutputEntry[]> => {
  try {
    const raw = localStorage.getItem(COMMAND_OUTPUT_STORAGE_KEY);
    if (!raw) return new Map();

    const parsed = JSON.parse(raw) as Record<string, CommandOutputEntry[]>;
    if (!parsed || typeof parsed !== "object") return new Map();

    const entries = Object.entries(parsed).filter(
      ([key, value]) => typeof key === "string" && Array.isArray(value)
    );

    return new Map(entries);
  } catch {
    return new Map();
  }
};

const persistCommandOutputLogs = (map: Map<string, CommandOutputEntry[]>) => {
  try {
    const asObject = Object.fromEntries(map.entries());
    localStorage.setItem(COMMAND_OUTPUT_STORAGE_KEY, JSON.stringify(asObject));
  } catch {
    // Best-effort persistence only.
  }
};

const concatCommandLogs = (entries: CommandOutputEntry[]) =>
  entries.map((entry) => entry.logs).join("");

/**
 * Connection state for the SignalR context.
 */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/**
 * SignalR context value interface.
 */
interface SignalRContextValue {
  connection: HubConnection | null;
  connectionStatus: ConnectionStatus;
  error: Error | null;
  localAgentLogs: LocalAgentLogEntry[];
  /** Map of nodeId -> backoff status for agents experiencing heartbeat failures */
  agentBackoffStatus: Map<string, AgentBackoffStatus>;
  /** Map of commandId -> accumulated output logs */
  commandOutputLogs: Map<string, CommandOutputEntry[]>;
  /** Merge server-side command output snapshot (fills gaps during reload). */
  syncCommandOutputSnapshot: (
    commandId: string,
    nodeId: string,
    status: string,
    outputLog: string | null
  ) => void;
  subscribeToLocalAgentLogs: (
    callback: (log: LocalAgentLogEntry) => void
  ) => () => void;
  subscribeToCommandOutput: (commandId: string) => Promise<void>;
  unsubscribeFromCommandOutput: (commandId: string) => Promise<void>;
  clearCommandOutputLogs: (commandId: string) => void;
}

const SignalRContext = createContext<SignalRContextValue | null>(null);

/**
 * Props for the SignalR provider component.
 */
interface SignalRProviderProps {
  children: ReactNode;
  hubUrl?: string;
}

/**
 * SignalR Provider component.
 * Manages the WebSocket connection and provides real-time updates.
 */
export function SignalRProvider({
  children,
  hubUrl = "/hubs/agent",
}: SignalRProviderProps) {
  const normalizeServerBaseUrl = (value: string): string | null =>
    {
      const trimmed = value.trim();
      if (!trimmed) return null;

      if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
      if (trimmed.startsWith("//")) return `${window.location.protocol}${trimmed}`.replace(/\/+$/, "");
      if (trimmed.startsWith("/")) return `${window.location.origin}${trimmed}`.replace(/\/+$/, "");
      // Back-compat: older Settings stored host[:port] without scheme.
      return `http://${trimmed}`.replace(/\/+$/, "");
    };

  // Optional override in localStorage.
  // This should be a *server base URL* (e.g., https://example.com:8080), not a hub URL.
  const storedUrl = localStorage.getItem("manlab:server_url");
  const normalizedBase = storedUrl ? normalizeServerBaseUrl(storedUrl) : null;
  const finalHubUrl = normalizedBase ? `${normalizedBase}/hubs/agent` : hubUrl;

  const [connection, setConnection] = useState<HubConnection | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<Error | null>(null);
  const [localAgentLogs, setLocalAgentLogs] = useState<LocalAgentLogEntry[]>(
    []
  );
  const [agentBackoffStatus, setAgentBackoffStatus] = useState<Map<string, AgentBackoffStatus>>(
    new Map()
  );
  const [commandOutputLogs, setCommandOutputLogs] = useState<Map<string, CommandOutputEntry[]>>(
    () => loadCommandOutputLogs()
  );
  const queryClient = useQueryClient();

  // Subscribers for local agent log events
  const localAgentLogSubscribersRef = useRef<
    Set<(log: LocalAgentLogEntry) => void>
  >(new Set());

  // Subscribe to local agent log events
  const subscribeToLocalAgentLogs = useCallback(
    (callback: (log: LocalAgentLogEntry) => void) => {
      localAgentLogSubscribersRef.current.add(callback);
      return () => {
        localAgentLogSubscribersRef.current.delete(callback);
      };
    },
    []
  );

  // Handle node status change events
  const handleNodeStatusChange = useCallback(
    (nodeId: string, status: string, lastSeen: string) => {
      const oldNodes = queryClient.getQueryData<Node[]>(["nodes"]);

      // If we don't have this node yet, a status change likely means a new registration.
      // Refetch the nodes list to stay consistent.
      if (!oldNodes || !oldNodes.some((n) => n.id === nodeId)) {
        queryClient.invalidateQueries({ queryKey: ["nodes"] });
        return;
      }

      // Update the nodes query cache
      queryClient.setQueryData<Node[]>(["nodes"], (nodes) => {
        if (!nodes) return nodes;
        return nodes.map((node) =>
          node.id === nodeId
            ? { ...node, status: status as NodeStatus, lastSeen }
            : node
        );
      });
    },
    [queryClient]
  );

  // Handle new node registration events
  const handleNodeRegistered = useCallback(
    (node: Node) => {
      queryClient.setQueryData<Node[]>(["nodes"], (oldNodes) => {
        if (!oldNodes) return [node];
        // Check if node already exists
        const existingIndex = oldNodes.findIndex((n) => n.id === node.id);
        if (existingIndex >= 0) {
          // Update existing node
          const updated = [...oldNodes];
          updated[existingIndex] = node;
          return updated;
        }
        // Add new node
        return [node, ...oldNodes];
      });
    },
    [queryClient]
  );

  // Handle telemetry updates
  const handleTelemetryUpdate = useCallback(
    (nodeId: string) => {
      // Invalidate telemetry query for this node to trigger refetch
      queryClient.invalidateQueries({ queryKey: ["telemetry", nodeId] });

      // Update node's lastSeen in the cache
      queryClient.setQueryData<Node[]>(["nodes"], (oldNodes) => {
        if (!oldNodes) return oldNodes;
        return oldNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                lastSeen: new Date().toISOString(),
                status: "Online" as NodeStatus,
              }
            : node
        );
      });
    },
    [queryClient]
  );

  // Handle command updates
  const handleCommandUpdated = useCallback(
    (nodeId: string) => {
      queryClient.invalidateQueries({ queryKey: ["commands", nodeId] });
    },
    [queryClient]
  );

  // Handle local agent log events (prevents 'No client method' warnings)
  const handleLocalAgentLog = useCallback(
    (machineId: string, timestamp: string, message: string) => {
      const logEntry: LocalAgentLogEntry = { machineId, timestamp, message };
      setLocalAgentLogs((prev) => [...prev, logEntry].slice(-100));
      // Notify all subscribers
      localAgentLogSubscribersRef.current.forEach((callback) =>
        callback(logEntry)
      );
    },
    []
  );

  // Handle local agent status change events (prevents 'No client method' warnings)
  const handleLocalAgentStatusChanged = useCallback(
    (machineId: string, status: string, error: string | null) => {
      // Invalidate local agent status query to trigger refetch
      queryClient.invalidateQueries({ queryKey: ["localAgentStatus"] });
      // Log status change as a log entry for visibility
      const logEntry: LocalAgentLogEntry = {
        machineId,
        timestamp: new Date().toISOString(),
        message: `Status changed to ${status}${error ? `: ${error}` : ""}`,
      };
      setLocalAgentLogs((prev) => [...prev, logEntry].slice(-100));
      localAgentLogSubscribersRef.current.forEach((callback) =>
        callback(logEntry)
      );
    },
    [queryClient]
  );

  // Handle agent backoff status updates
  const handleAgentBackoffStatus = useCallback(
    (nodeId: string, consecutiveFailures: number, nextRetryTimeUtc: string | null) => {
      setAgentBackoffStatus((prev) => {
        const newMap = new Map(prev);
        if (consecutiveFailures === 0 || !nextRetryTimeUtc) {
          // Backoff cleared
          newMap.delete(nodeId);
        } else {
          newMap.set(nodeId, { nodeId, consecutiveFailures, nextRetryTimeUtc });
        }
        return newMap;
      });
    },
    []
  );

  // Handle agent ping response
  const handleAgentPingResponse = useCallback(
    (nodeId: string, success: boolean, nextRetryTimeUtc: string | null) => {
      if (success) {
        // Clear backoff status on successful ping
        setAgentBackoffStatus((prev) => {
          const newMap = new Map(prev);
          newMap.delete(nodeId);
          return newMap;
        });
      } else if (nextRetryTimeUtc) {
        // Update backoff status with new retry time
        setAgentBackoffStatus((prev) => {
          const newMap = new Map(prev);
          const existing = prev.get(nodeId);
          newMap.set(nodeId, {
            nodeId,
            consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
            nextRetryTimeUtc,
          });
          return newMap;
        });
      }
      // Invalidate node data to refresh status
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
    },
    [queryClient]
  );

  // Handle node deleted events (sent when agent is uninstalled)
  const handleNodeDeleted = useCallback(
    (nodeId: string) => {
      // Remove the deleted node from the cache
      queryClient.setQueryData<Node[]>(["nodes"], (oldNodes) => {
        if (!oldNodes) return oldNodes;
        return oldNodes.filter((node) => node.id !== nodeId);
      });
      // Clear any backoff status for the deleted node
      setAgentBackoffStatus((prev) => {
        const newMap = new Map(prev);
        newMap.delete(nodeId);
        return newMap;
      });
    },
    [queryClient]
  );

  // Handle node error state changed events (agent hit non-transient error)
  const handleNodeErrorStateChanged = useCallback(
    (nodeId: string, errorCode: number, errorMessage: string, errorAt: string) => {
      // Update the nodes query cache with error state
      queryClient.setQueryData<Node[]>(["nodes"], (nodes) => {
        if (!nodes) return nodes;
        return nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                status: "Error" as NodeStatus,
                errorCode,
                errorMessage,
                errorAt,
              }
            : node
        );
      });
    },
    [queryClient]
  );

  // Handle node error state cleared events (admin cleared the error)
  const handleNodeErrorStateCleared = useCallback(
    (nodeId: string) => {
      // Update the nodes query cache to clear error state
      queryClient.setQueryData<Node[]>(["nodes"], (nodes) => {
        if (!nodes) return nodes;
        return nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                status: "Offline" as NodeStatus,
                errorCode: null,
                errorMessage: null,
                errorAt: null,
              }
            : node
        );
      });
    },
    [queryClient]
  );

  // Handle command output appended events (live command streaming)
  const handleCommandOutputAppended = useCallback(
    (nodeId: string, commandId: string, status: string, logs: string) => {
      const entry: CommandOutputEntry = {
        commandId,
        nodeId,
        status,
        logs,
        timestamp: new Date().toISOString(),
      };
      setCommandOutputLogs((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(commandId) ?? [];
        newMap.set(commandId, [...existing, entry]);
        return newMap;
      });
    },
    []
  );

  // Subscribe to command output for a specific command
  const subscribeToCommandOutput = useCallback(
    async (commandId: string) => {
      if (connection && connection.state === "Connected") {
        try {
          await connection.invoke("SubscribeCommandOutput", commandId);
        } catch (err) {
          console.error("Failed to subscribe to command output:", err);
        }
      }
    },
    [connection]
  );

  // Unsubscribe from command output for a specific command
  const unsubscribeFromCommandOutput = useCallback(
    async (commandId: string) => {
      if (connection && connection.state === "Connected") {
        try {
          await connection.invoke("UnsubscribeCommandOutput", commandId);
        } catch (err) {
          console.error("Failed to unsubscribe from command output:", err);
        }
      }
    },
    [connection]
  );

  // Clear command output logs for a specific command
  const clearCommandOutputLogs = useCallback((commandId: string) => {
    setCommandOutputLogs((prev) => {
      const newMap = new Map(prev);
      newMap.delete(commandId);
      return newMap;
    });
  }, []);

  // Merge server snapshot to avoid missing output during reloads
  const syncCommandOutputSnapshot = useCallback(
    (commandId: string, nodeId: string, status: string, outputLog: string | null) => {
      setCommandOutputLogs((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(commandId) ?? [];
        const snapshot = outputLog ?? "";
        const existingCombined = concatCommandLogs(existing);
        const now = new Date().toISOString();

        const pushStatusOnly = () => {
          const lastStatus = existing[existing.length - 1]?.status;
          if (lastStatus !== status) {
            newMap.set(commandId, [
              ...existing,
              { commandId, nodeId, status, logs: "", timestamp: now },
            ]);
          } else {
            newMap.set(commandId, existing);
          }
        };

        if (!snapshot) {
          if (existing.length === 0) {
            newMap.set(commandId, [
              { commandId, nodeId, status, logs: "", timestamp: now },
            ]);
          } else {
            pushStatusOnly();
          }
          return newMap;
        }

        if (snapshot.startsWith(existingCombined)) {
          const missing = snapshot.slice(existingCombined.length);
          if (missing.length > 0) {
            newMap.set(commandId, [
              ...existing,
              { commandId, nodeId, status, logs: missing, timestamp: now },
            ]);
          } else {
            pushStatusOnly();
          }
          return newMap;
        }

        if (existingCombined.startsWith(snapshot)) {
          pushStatusOnly();
          return newMap;
        }

        newMap.set(commandId, [
          { commandId, nodeId, status, logs: snapshot, timestamp: now },
        ]);
        return newMap;
      });
    },
    []
  );

  useEffect(() => {
    persistCommandOutputLogs(commandOutputLogs);
  }, [commandOutputLogs]);

  // Use ref to track if we've started connecting (to avoid synchronous setState in effect)
  const isConnectingRef = useRef(false);

  // Store handlers in refs so they can be accessed in cleanup without causing effect re-runs
  const handlersRef = useRef({
    handleNodeStatusChange,
    handleNodeRegistered,
    handleTelemetryUpdate,
    handleCommandUpdated,
    handleLocalAgentLog,
    handleLocalAgentStatusChanged,
    handleAgentBackoffStatus,
    handleAgentPingResponse,
    handleNodeDeleted,
    handleNodeErrorStateChanged,
    handleNodeErrorStateCleared,
    handleCommandOutputAppended,
  });

  // Keep refs in sync with latest handlers
  useEffect(() => {
    handlersRef.current = {
      handleNodeStatusChange,
      handleNodeRegistered,
      handleTelemetryUpdate,
      handleCommandUpdated,
      handleLocalAgentLog,
      handleLocalAgentStatusChanged,
      handleAgentBackoffStatus,
      handleAgentPingResponse,
      handleNodeDeleted,
      handleNodeErrorStateChanged,
      handleNodeErrorStateCleared,
      handleCommandOutputAppended,
    };
  });

  useEffect(() => {
    // Build the connection
    const newConnection = new HubConnectionBuilder()
      .withUrl(finalHubUrl)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          // Exponential backoff: 0s, 2s, 4s, 8s, 16s, then cap at 30s
          const delay = Math.min(
            1000 * Math.pow(2, retryContext.previousRetryCount),
            30000
          );
          return delay;
        },
      })
      .configureLogging(LogLevel.Information)
      .build();

    // Set up event handlers
    newConnection.onreconnecting((err) => {
      setConnectionStatus("reconnecting");
      if (err) {
        setError(new Error(err.message));
      }
    });

    newConnection.onreconnected(() => {
      setConnectionStatus("connected");
      setError(null);
      // Refetch all nodes after reconnection
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
    });

    newConnection.onclose((err) => {
      setConnectionStatus("disconnected");
      if (err) {
        setError(new Error(err.message));
      }
    });

    // Create wrapper functions that delegate to the current handler refs
    // This ensures we always call the latest handler without re-registering
    const nodeStatusChangedHandler = (
      ...args: Parameters<typeof handleNodeStatusChange>
    ) => handlersRef.current.handleNodeStatusChange(...args);
    const nodeRegisteredHandler = (
      ...args: Parameters<typeof handleNodeRegistered>
    ) => handlersRef.current.handleNodeRegistered(...args);
    const telemetryUpdateHandler = (
      ...args: Parameters<typeof handleTelemetryUpdate>
    ) => handlersRef.current.handleTelemetryUpdate(...args);
    const commandUpdatedHandler = (
      ...args: Parameters<typeof handleCommandUpdated>
    ) => handlersRef.current.handleCommandUpdated(...args);
    const localAgentLogHandler = (
      ...args: Parameters<typeof handleLocalAgentLog>
    ) => handlersRef.current.handleLocalAgentLog(...args);
    const localAgentStatusChangedHandler = (
      ...args: Parameters<typeof handleLocalAgentStatusChanged>
    ) => handlersRef.current.handleLocalAgentStatusChanged(...args);

    // Register server-to-client event handlers
    newConnection.on("NodeStatusChanged", nodeStatusChangedHandler);
    newConnection.on("NodeRegistered", nodeRegisteredHandler);
    newConnection.on("TelemetryReceived", telemetryUpdateHandler);
    newConnection.on("telemetryreceived", telemetryUpdateHandler);
    newConnection.on("CommandUpdated", commandUpdatedHandler);

    // Register local agent event handlers (prevents 'No client method' warnings)
    newConnection.on("LocalAgentLog", localAgentLogHandler);
    newConnection.on("LocalAgentStatusChanged", localAgentStatusChangedHandler);

    // Register agent backoff/ping event handlers
    const agentBackoffStatusHandler = (
      ...args: Parameters<typeof handleAgentBackoffStatus>
    ) => handlersRef.current.handleAgentBackoffStatus(...args);
    const agentPingResponseHandler = (
      ...args: Parameters<typeof handleAgentPingResponse>
    ) => handlersRef.current.handleAgentPingResponse(...args);

    newConnection.on("AgentBackoffStatus", agentBackoffStatusHandler);
    newConnection.on("AgentPingResponse", agentPingResponseHandler);

    // Register node deleted handler
    const nodeDeletedHandler = (
      ...args: Parameters<typeof handleNodeDeleted>
    ) => handlersRef.current.handleNodeDeleted(...args);
    newConnection.on("NodeDeleted", nodeDeletedHandler);

    // Register node error state handlers
    const nodeErrorStateChangedHandler = (
      ...args: Parameters<typeof handleNodeErrorStateChanged>
    ) => handlersRef.current.handleNodeErrorStateChanged(...args);
    const nodeErrorStateClearedHandler = (
      ...args: Parameters<typeof handleNodeErrorStateCleared>
    ) => handlersRef.current.handleNodeErrorStateCleared(...args);
    newConnection.on("NodeErrorStateChanged", nodeErrorStateChangedHandler);
    newConnection.on("NodeErrorStateCleared", nodeErrorStateClearedHandler);

    // Register command output handler for live streaming
    const commandOutputAppendedHandler = (
      ...args: Parameters<typeof handleCommandOutputAppended>
    ) => handlersRef.current.handleCommandOutputAppended(...args);
    newConnection.on("CommandOutputAppended", commandOutputAppendedHandler);

    // Start the connection asynchronously
    // Wrap in an async IIFE to handle setState after the microtask
    const startConnection = async () => {
      // Mark as connecting before starting
      isConnectingRef.current = true;
      setConnectionStatus("connecting");

      try {
        await newConnection.start();
        setConnectionStatus("connected");
        setError(null);
      } catch (err) {
        setConnectionStatus("disconnected");
        setError(err instanceof Error ? err : new Error(String(err)));
        console.error("SignalR connection error:", err);
      }
    };

    // Use queueMicrotask to defer the initial status update (avoids synchronous setState in effect)
    queueMicrotask(() => {
      setConnection(newConnection);
      startConnection();
    });

    return () => {
      newConnection.off("NodeStatusChanged", nodeStatusChangedHandler);
      newConnection.off("NodeRegistered", nodeRegisteredHandler);
      newConnection.off("TelemetryReceived", telemetryUpdateHandler);
      newConnection.off("CommandUpdated", commandUpdatedHandler);
      newConnection.off("LocalAgentLog", localAgentLogHandler);
      newConnection.off(
        "LocalAgentStatusChanged",
        localAgentStatusChangedHandler
      );
      newConnection.off("AgentBackoffStatus", agentBackoffStatusHandler);
      newConnection.off("AgentPingResponse", agentPingResponseHandler);
      newConnection.off("NodeDeleted", nodeDeletedHandler);
      newConnection.off("NodeErrorStateChanged", nodeErrorStateChangedHandler);
      newConnection.off("NodeErrorStateCleared", nodeErrorStateClearedHandler);
      newConnection.off("CommandOutputAppended", commandOutputAppendedHandler);
      newConnection.stop();
    };
  }, [finalHubUrl, queryClient]);

  return (
    <SignalRContext.Provider
      value={{
        connection,
        connectionStatus,
        error,
        localAgentLogs,
        agentBackoffStatus,
        commandOutputLogs,
        syncCommandOutputSnapshot,
        subscribeToLocalAgentLogs,
        subscribeToCommandOutput,
        unsubscribeFromCommandOutput,
        clearCommandOutputLogs,
      }}
    >
      {children}
    </SignalRContext.Provider>
  );
}

/**
 * Hook to access the SignalR context.
 * Throws an error if used outside of SignalRProvider.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useSignalR(): SignalRContextValue {
  const context = useContext(SignalRContext);
  if (!context) {
    throw new Error("useSignalR must be used within a SignalRProvider");
  }
  return context;
}
