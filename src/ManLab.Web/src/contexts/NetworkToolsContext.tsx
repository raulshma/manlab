/**
 * NetworkToolsProvider Component
 * Provides context for network tools to communicate and trigger actions across tabs.
 * Enables quick shortcuts from tool results (e.g., ping a discovered host, port scan an IP).
 */

import { useCallback, useState } from "react";
import {
  NetworkToolsContext,
  type NetworkToolTab,
  type NetworkToolsProviderProps,
  type PendingToolAction,
  type NetworkToolsContextValue,
} from "./network-tools-types";

// Re-export types for convenience
export type { NetworkToolTab, PendingToolAction, NetworkToolsContextValue } from "./network-tools-types";

export function NetworkToolsProvider({
  children,
  initialTab = "ping",
  activeTab: externalActiveTab,
  onTabChange,
}: NetworkToolsProviderProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<NetworkToolTab>(initialTab);
  const [pendingAction, setPendingAction] = useState<PendingToolAction | null>(null);

  // Use external state if provided (controlled mode)
  const activeTab = externalActiveTab ?? internalActiveTab;
  const setActiveTab = useCallback(
    (tab: NetworkToolTab) => {
      if (onTabChange) {
        onTabChange(tab);
      } else {
        setInternalActiveTab(tab);
      }
    },
    [onTabChange]
  );

  const clearPendingAction = useCallback(() => {
    setPendingAction(null);
  }, []);

  // Quick action: Ping
  const quickPing = useCallback(
    (target: string) => {
      setPendingAction({ type: "ping", target });
      setActiveTab("ping");
    },
    [setActiveTab]
  );

  // Quick action: Traceroute
  const quickTraceroute = useCallback(
    (target: string) => {
      setPendingAction({ type: "traceroute", target });
      setActiveTab("traceroute");
    },
    [setActiveTab]
  );

  // Quick action: Port Scan
  const quickPortScan = useCallback(
    (target: string, options?: { ports?: number[] }) => {
      setPendingAction({ type: "port-scan", target, options });
      setActiveTab("ports");
    },
    [setActiveTab]
  );

  // Quick action: Subnet Scan
  const quickSubnetScan = useCallback(
    (subnet: string) => {
      setPendingAction({ type: "subnet-scan", target: subnet });
      setActiveTab("subnet");
    },
    [setActiveTab]
  );

  const value: NetworkToolsContextValue = {
    activeTab,
    setActiveTab,
    pendingAction,
    clearPendingAction,
    quickPing,
    quickTraceroute,
    quickPortScan,
    quickSubnetScan,
  };

  return (
    <NetworkToolsContext.Provider value={value}>
      {children}
    </NetworkToolsContext.Provider>
  );
}
