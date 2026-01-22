/**
 * SignalR hook for Network Hub real-time communication.
 * Provides connection management and event handling for network scanning operations.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from "@microsoft/signalr";
import {
  isRealtimeEnabled,
  subscribeRealtimePreference,
} from "@/lib/network-preferences";
import type {
  PingResult,
  TracerouteResult,
  PortScanResult,
  DiscoveryScanResult,
  WifiScanResult,
  ScanStartedEvent,
  ScanProgressEvent,
  HostFoundEvent,
  ScanCompletedEvent,
  ScanFailedEvent,
  TracerouteStartedEvent,
  TracerouteHopEvent,
  TracerouteCompletedEvent,
  PortScanStartedEvent,
  PortFoundEvent,
  PortScanCompletedEvent,
  DiscoveryStartedEvent,
  MdnsDeviceFoundEvent,
  UpnpDeviceFoundEvent,
  DiscoveryCompletedEvent,
  WifiScanStartedEvent,
  WifiNetworkFoundEvent,
  WifiScanCompletedEvent,
} from "../api/networkApi";

// ============================================================================
// Shared Connection Pool
// ============================================================================

interface SharedConnectionSnapshot {
  connection: HubConnection | null;
  status: NetworkHubStatus;
  error: Error | null;
}

interface SharedConnectionState extends SharedConnectionSnapshot {
  subscribers: number;
  listeners: Set<(snapshot: SharedConnectionSnapshot) => void>;
}

const sharedConnections = new Map<string, SharedConnectionState>();

function getSnapshot(state: SharedConnectionState): SharedConnectionSnapshot {
  return {
    connection: state.connection,
    status: state.status,
    error: state.error,
  };
}

function notifyShared(state: SharedConnectionState) {
  const snapshot = getSnapshot(state);
  state.listeners.forEach((listener) => listener(snapshot));
}

function getOrCreateSharedConnection(hubUrl: string): SharedConnectionState {
  const existing = sharedConnections.get(hubUrl);
  if (existing) return existing;

  const initial: SharedConnectionState = {
    connection: null,
    status: "Disconnected",
    error: null,
    subscribers: 0,
    listeners: new Set(),
  };

  sharedConnections.set(hubUrl, initial);
  return initial;
}

function subscribeSharedState(
  hubUrl: string,
  listener: (snapshot: SharedConnectionSnapshot) => void
): () => void {
  const state = getOrCreateSharedConnection(hubUrl);
  state.listeners.add(listener);
  listener(getSnapshot(state));

  return () => {
    state.listeners.delete(listener);
  };
}

function buildConnection(hubUrl: string): HubConnection {
  let baseUrl = "";
  if (import.meta.env.DEV) {
    baseUrl = "";
  }

  return new HubConnectionBuilder()
    .withUrl(`${baseUrl}${hubUrl}`)
    .withAutomaticReconnect({
      nextRetryDelayInMilliseconds: (retryContext) => {
        if (retryContext.previousRetryCount === 0) return 0;
        if (retryContext.previousRetryCount === 1) return 2000;
        if (retryContext.previousRetryCount === 2) return 10000;
        return Math.min(30000, retryContext.previousRetryCount * 5000);
      },
    })
    .configureLogging(LogLevel.Information)
    .build();
}

function startSharedConnection(state: SharedConnectionState, hubUrl: string) {
  if (state.connection) return;

  const newConnection = buildConnection(hubUrl);
  state.connection = newConnection;
  state.status = "Connecting";
  state.error = null;
  notifyShared(state);

  const onReconnecting = (err?: Error) => {
    state.status = "Reconnecting";
    state.error = err ?? null;
    notifyShared(state);
  };

  const onReconnected = () => {
    state.status = "Connected";
    state.error = null;
    notifyShared(state);
  };

  const onClose = (err?: Error) => {
    state.status = "Disconnected";
    state.error = err ?? null;
    notifyShared(state);
  };

  newConnection.onreconnecting(onReconnecting);
  newConnection.onreconnected(onReconnected);
  newConnection.onclose(onClose);

  newConnection
    .start()
    .then(() => {
      state.status = "Connected";
      state.error = null;
      notifyShared(state);
    })
    .catch((err) => {
      state.status = "Error";
      state.error = err instanceof Error ? err : new Error(String(err));
      notifyShared(state);
      console.error("Failed to connect to Network Hub:", err);
    });
}

function stopSharedConnection(state: SharedConnectionState) {
  if (!state.connection) return;

  const connection = state.connection;
  state.connection = null;
  state.status = "Disconnected";
  state.error = null;
  notifyShared(state);

  if (
    connection.state === HubConnectionState.Connected ||
    connection.state === HubConnectionState.Connecting
  ) {
    connection.stop();
  }
}

function retainSharedConnection(hubUrl: string): () => void {
  const state = getOrCreateSharedConnection(hubUrl);
  state.subscribers += 1;
  if (!state.connection) {
    startSharedConnection(state, hubUrl);
  }

  return () => {
    state.subscribers = Math.max(0, state.subscribers - 1);
    if (state.subscribers === 0) {
      stopSharedConnection(state);
    }
  };
}

// ============================================================================
// Types
// ============================================================================

/**
 * Network Hub connection status.
 */
export type NetworkHubStatus =
  | "Disconnected"
  | "Connecting"
  | "Connected"
  | "Reconnecting"
  | "Error";

/**
 * Event handlers for subnet scan events.
 */
export interface SubnetScanHandlers {
  onScanStarted?: (event: ScanStartedEvent) => void;
  onScanProgress?: (event: ScanProgressEvent) => void;
  onHostFound?: (event: HostFoundEvent) => void;
  onScanCompleted?: (event: ScanCompletedEvent) => void;
  onScanFailed?: (event: ScanFailedEvent) => void;
}

/**
 * Event handlers for traceroute events.
 */
export interface TracerouteHandlers {
  onTracerouteStarted?: (event: TracerouteStartedEvent) => void;
  onTracerouteHop?: (event: TracerouteHopEvent) => void;
  onTracerouteCompleted?: (event: TracerouteCompletedEvent) => void;
}

/**
 * Event handlers for port scan events.
 */
export interface PortScanHandlers {
  onPortScanStarted?: (event: PortScanStartedEvent) => void;
  onPortFound?: (event: PortFoundEvent) => void;
  onPortScanCompleted?: (event: PortScanCompletedEvent) => void;
}

/**
 * Event handlers for device discovery events.
 */
export interface DiscoveryHandlers {
  onDiscoveryStarted?: (event: DiscoveryStartedEvent) => void;
  onMdnsDeviceFound?: (event: MdnsDeviceFoundEvent) => void;
  onUpnpDeviceFound?: (event: UpnpDeviceFoundEvent) => void;
  onDiscoveryCompleted?: (event: DiscoveryCompletedEvent) => void;
}

/**
 * Event handlers for WiFi scan events.
 */
export interface WifiScanHandlers {
  onWifiScanStarted?: (event: WifiScanStartedEvent) => void;
  onWifiNetworkFound?: (event: WifiNetworkFoundEvent) => void;
  onWifiScanCompleted?: (event: WifiScanCompletedEvent) => void;
}

/**
 * Return type for useNetworkHub hook.
 */
export interface UseNetworkHubReturn {
  // Connection state
  connection: HubConnection | null;
  status: NetworkHubStatus;
  error: Error | null;
  isConnected: boolean;

  // Hub methods (Client→Server)
  startSubnetScan: (
    cidr: string,
    concurrency?: number,
    timeout?: number
  ) => Promise<{ scanId: string }>;
  ping: (host: string, timeout?: number) => Promise<PingResult>;
  traceroute: (
    host: string,
    maxHops?: number,
    timeout?: number
  ) => Promise<TracerouteResult>;
  scanPorts: (
    host: string,
    ports: number[],
    concurrency?: number,
    timeout?: number
  ) => Promise<PortScanResult>;
  discoverDevices: (
    scanDurationSeconds?: number
  ) => Promise<DiscoveryScanResult>;
  scanWifi: (adapterName?: string) => Promise<WifiScanResult>;
  subscribeScan: (scanId: string) => Promise<void>;
  unsubscribeScan: (scanId: string) => Promise<void>;

  // Event subscriptions
  subscribeToSubnetScan: (handlers: SubnetScanHandlers) => () => void;
  subscribeToTraceroute: (handlers: TracerouteHandlers) => () => void;
  subscribeToPortScan: (handlers: PortScanHandlers) => () => void;
  subscribeToDiscovery: (handlers: DiscoveryHandlers) => () => void;
  subscribeToWifiScan: (handlers: WifiScanHandlers) => () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * React hook for managing SignalR Network Hub connection and events.
 * @param hubUrl - The URL of the Network Hub (default: "/hubs/network")
 */
export function useNetworkHub(
  hubUrl: string = "/hubs/network"
): UseNetworkHubReturn {
  const [connection, setConnection] = useState<HubConnection | null>(null);
  const [status, setStatus] = useState<NetworkHubStatus>("Disconnected");
  const [error, setError] = useState<Error | null>(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(isRealtimeEnabled());
  const connectionRef = useRef<HubConnection | null>(null);

  // Sync local state with shared connection pool
  useEffect(() => {
    const unsubscribe = subscribeSharedState(hubUrl, (snapshot) => {
      setConnection(snapshot.connection);
      setStatus(snapshot.status);
      setError(snapshot.error);
      connectionRef.current = snapshot.connection;
    });

    return unsubscribe;
  }, [hubUrl]);

  // Build and manage shared connection
  useEffect(() => {
    if (!realtimeEnabled) {
      const shared = getOrCreateSharedConnection(hubUrl);
      stopSharedConnection(shared);
      return;
    }

    const release = retainSharedConnection(hubUrl);
    return release;
  }, [hubUrl, realtimeEnabled]);

  useEffect(() => {
    return subscribeRealtimePreference(setRealtimeEnabled);
  }, []);

  // ============================================================================
  // Hub Methods (Client→Server)
  // ============================================================================

  const startSubnetScan = useCallback(
    async (
      cidr: string,
      concurrency: number = 100,
      timeout: number = 500
    ): Promise<{ scanId: string }> => {
      if (!connectionRef.current) {
        throw new Error("Not connected to Network Hub");
      }
      return await connectionRef.current.invoke<{ scanId: string }>(
        "StartSubnetScan",
        cidr,
        concurrency,
        timeout
      );
    },
    []
  );

  const ping = useCallback(
    async (host: string, timeout: number = 1000): Promise<PingResult> => {
      if (!connectionRef.current) {
        throw new Error("Not connected to Network Hub");
      }
      return await connectionRef.current.invoke<PingResult>(
        "Ping",
        host,
        timeout
      );
    },
    []
  );

  const traceroute = useCallback(
    async (
      host: string,
      maxHops: number = 30,
      timeout: number = 1000
    ): Promise<TracerouteResult> => {
      if (!connectionRef.current) {
        throw new Error("Not connected to Network Hub");
      }
      return await connectionRef.current.invoke<TracerouteResult>(
        "Traceroute",
        host,
        maxHops,
        timeout
      );
    },
    []
  );

  const scanPorts = useCallback(
    async (
      host: string,
      ports: number[],
      concurrency: number = 50,
      timeout: number = 2000
    ): Promise<PortScanResult> => {
      if (!connectionRef.current) {
        throw new Error("Not connected to Network Hub");
      }
      return await connectionRef.current.invoke<PortScanResult>(
        "ScanPorts",
        host,
        ports,
        concurrency,
        timeout
      );
    },
    []
  );

  const discoverDevices = useCallback(
    async (scanDurationSeconds: number = 5): Promise<DiscoveryScanResult> => {
      if (!connectionRef.current) {
        throw new Error("Not connected to Network Hub");
      }
      return await connectionRef.current.invoke<DiscoveryScanResult>(
        "DiscoverDevices",
        scanDurationSeconds
      );
    },
    []
  );

  const scanWifi = useCallback(
    async (adapterName?: string): Promise<WifiScanResult> => {
      if (!connectionRef.current) {
        throw new Error("Not connected to Network Hub");
      }
      return await connectionRef.current.invoke<WifiScanResult>(
        "ScanWifi",
        adapterName
      );
    },
    []
  );

  const subscribeScan = useCallback(async (scanId: string): Promise<void> => {
    if (!connectionRef.current) {
      throw new Error("Not connected to Network Hub");
    }
    await connectionRef.current.invoke("SubscribeScan", scanId);
  }, []);

  const unsubscribeScan = useCallback(async (scanId: string): Promise<void> => {
    if (!connectionRef.current) {
      throw new Error("Not connected to Network Hub");
    }
    await connectionRef.current.invoke("UnsubscribeScan", scanId);
  }, []);

  // ============================================================================
  // Event Subscriptions (Server→Client)
  // ============================================================================

  const subscribeToSubnetScan = useCallback(
    (handlers: SubnetScanHandlers) => {
      if (!connectionRef.current) return () => {};

      const conn = connectionRef.current;

      if (handlers.onScanStarted) {
        conn.on("ScanStarted", handlers.onScanStarted);
      }
      if (handlers.onScanProgress) {
        conn.on("ScanProgress", handlers.onScanProgress);
      }
      if (handlers.onHostFound) {
        conn.on("HostFound", handlers.onHostFound);
      }
      if (handlers.onScanCompleted) {
        conn.on("ScanCompleted", handlers.onScanCompleted);
      }
      if (handlers.onScanFailed) {
        conn.on("ScanFailed", handlers.onScanFailed);
      }

      return () => {
        if (handlers.onScanStarted) conn.off("ScanStarted");
        if (handlers.onScanProgress) conn.off("ScanProgress");
        if (handlers.onHostFound) conn.off("HostFound");
        if (handlers.onScanCompleted) conn.off("ScanCompleted");
        if (handlers.onScanFailed) conn.off("ScanFailed");
      };
    },
    []
  );

  const subscribeToTraceroute = useCallback(
    (handlers: TracerouteHandlers) => {
      if (!connectionRef.current) return () => {};

      const conn = connectionRef.current;

      if (handlers.onTracerouteStarted) {
        conn.on("TracerouteStarted", handlers.onTracerouteStarted);
      }
      if (handlers.onTracerouteHop) {
        conn.on("TracerouteHop", handlers.onTracerouteHop);
      }
      if (handlers.onTracerouteCompleted) {
        conn.on("TracerouteCompleted", handlers.onTracerouteCompleted);
      }

      return () => {
        if (handlers.onTracerouteStarted) conn.off("TracerouteStarted");
        if (handlers.onTracerouteHop) conn.off("TracerouteHop");
        if (handlers.onTracerouteCompleted) conn.off("TracerouteCompleted");
      };
    },
    []
  );

  const subscribeToPortScan = useCallback(
    (handlers: PortScanHandlers) => {
      if (!connectionRef.current) return () => {};

      const conn = connectionRef.current;

      if (handlers.onPortScanStarted) {
        conn.on("PortScanStarted", handlers.onPortScanStarted);
      }
      if (handlers.onPortFound) {
        conn.on("PortFound", handlers.onPortFound);
      }
      if (handlers.onPortScanCompleted) {
        conn.on("PortScanCompleted", handlers.onPortScanCompleted);
      }

      return () => {
        if (handlers.onPortScanStarted) conn.off("PortScanStarted");
        if (handlers.onPortFound) conn.off("PortFound");
        if (handlers.onPortScanCompleted) conn.off("PortScanCompleted");
      };
    },
    []
  );

  const subscribeToDiscovery = useCallback(
    (handlers: DiscoveryHandlers) => {
      if (!connectionRef.current) return () => {};

      const conn = connectionRef.current;

      if (handlers.onDiscoveryStarted) {
        conn.on("DiscoveryStarted", handlers.onDiscoveryStarted);
      }
      if (handlers.onMdnsDeviceFound) {
        conn.on("MdnsDeviceFound", handlers.onMdnsDeviceFound);
      }
      if (handlers.onUpnpDeviceFound) {
        conn.on("UpnpDeviceFound", handlers.onUpnpDeviceFound);
      }
      if (handlers.onDiscoveryCompleted) {
        conn.on("DiscoveryCompleted", handlers.onDiscoveryCompleted);
      }

      return () => {
        if (handlers.onDiscoveryStarted) conn.off("DiscoveryStarted");
        if (handlers.onMdnsDeviceFound) conn.off("MdnsDeviceFound");
        if (handlers.onUpnpDeviceFound) conn.off("UpnpDeviceFound");
        if (handlers.onDiscoveryCompleted) conn.off("DiscoveryCompleted");
      };
    },
    []
  );

  const subscribeToWifiScan = useCallback(
    (handlers: WifiScanHandlers) => {
      if (!connectionRef.current) return () => {};

      const conn = connectionRef.current;

      if (handlers.onWifiScanStarted) {
        conn.on("WifiScanStarted", handlers.onWifiScanStarted);
      }
      if (handlers.onWifiNetworkFound) {
        conn.on("WifiNetworkFound", handlers.onWifiNetworkFound);
      }
      if (handlers.onWifiScanCompleted) {
        conn.on("WifiScanCompleted", handlers.onWifiScanCompleted);
      }

      return () => {
        if (handlers.onWifiScanStarted) conn.off("WifiScanStarted");
        if (handlers.onWifiNetworkFound) conn.off("WifiNetworkFound");
        if (handlers.onWifiScanCompleted) conn.off("WifiScanCompleted");
      };
    },
    []
  );

  return {
    // Connection state
    connection,
    status,
    error,
    isConnected: status === "Connected",

    // Hub methods
    startSubnetScan,
    ping,
    traceroute,
    scanPorts,
    discoverDevices,
    scanWifi,
    subscribeScan,
    unsubscribeScan,

    // Event subscriptions
    subscribeToSubnetScan,
    subscribeToTraceroute,
    subscribeToPortScan,
    subscribeToDiscovery,
    subscribeToWifiScan,
  };
}
