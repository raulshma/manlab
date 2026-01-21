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
  const connectionRef = useRef<HubConnection | null>(null);

  // Build and manage connection
  useEffect(() => {
    // Determine base URL for SignalR
    let baseUrl = "";
    if (import.meta.env.DEV) {
      // In development, use the API proxy base
      baseUrl = "";
    }

    const newConnection = new HubConnectionBuilder()
      .withUrl(`${baseUrl}${hubUrl}`)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          // Exponential backoff: 0, 2, 10, 30 seconds, then cap at 30
          if (retryContext.previousRetryCount === 0) return 0;
          if (retryContext.previousRetryCount === 1) return 2000;
          if (retryContext.previousRetryCount === 2) return 10000;
          return Math.min(
            30000,
            retryContext.previousRetryCount * 5000
          );
        },
      })
      .configureLogging(LogLevel.Information)
      .build();

    // Connection state change handlers
    newConnection.onreconnecting((err) => {
      setStatus("Reconnecting");
      if (err) setError(err);
    });

    newConnection.onreconnected(() => {
      setStatus("Connected");
      setError(null);
    });

    newConnection.onclose((err) => {
      setStatus("Disconnected");
      if (err) setError(err);
    });

    // Start connection
    setStatus("Connecting");
    newConnection
      .start()
      .then(() => {
        setStatus("Connected");
        setError(null);
        setConnection(newConnection);
        connectionRef.current = newConnection;
      })
      .catch((err) => {
        setStatus("Error");
        setError(err);
        console.error("Failed to connect to Network Hub:", err);
      });

    return () => {
      if (
        newConnection.state === HubConnectionState.Connected ||
        newConnection.state === HubConnectionState.Connecting
      ) {
        newConnection.stop();
      }
    };
  }, [hubUrl]);

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
    [connection]
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
    [connection]
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
    [connection]
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
    [connection]
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
    [connection]
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
