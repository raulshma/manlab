/**
 * NetworkToolsContext Types and Context Definition
 * Provides a shared context for network tools to communicate and trigger actions across tabs.
 */

import { createContext, type ReactNode } from "react";

// ============================================================================
// Types
// ============================================================================

/** Available network tool tabs */
export type NetworkToolTab = "ping" | "subnet" | "traceroute" | "ports" | "discovery" | "wifi" | "geodb";

/** Pending action to execute when switching tabs */
export interface PendingToolAction {
  type: "ping" | "traceroute" | "port-scan" | "subnet-scan";
  target: string; // IP address or hostname
  options?: {
    ports?: number[]; // For port scan presets
    portRange?: { start: number; end: number }; // For port scan range
  };
}

export interface NetworkToolsContextValue {
  /** Current active tab */
  activeTab: NetworkToolTab;
  /** Set the active tab */
  setActiveTab: (tab: NetworkToolTab) => void;
  /** Pending action to execute when tool initializes */
  pendingAction: PendingToolAction | null;
  /** Clear the pending action (called after tool consumes it) */
  clearPendingAction: () => void;
  
  // Quick action helpers
  /** Navigate to Ping tool and start pinging the target */
  quickPing: (target: string) => void;
  /** Navigate to Traceroute tool and trace to the target */
  quickTraceroute: (target: string) => void;
  /** Navigate to Port Scan tool and scan the target */
  quickPortScan: (target: string, options?: { ports?: number[] }) => void;
  /** Navigate to Subnet Scan tool with a pre-filled subnet */
  quickSubnetScan: (subnet: string) => void;
}

// ============================================================================
// Context
// ============================================================================

export const NetworkToolsContext = createContext<NetworkToolsContextValue | null>(null);

// ============================================================================
// Provider Props
// ============================================================================

export interface NetworkToolsProviderProps {
  children: ReactNode;
  /** Initial tab (defaults to 'ping') */
  initialTab?: NetworkToolTab;
  /** External tab state (for controlled mode) */
  activeTab?: NetworkToolTab;
  /** External tab setter (for controlled mode) */
  onTabChange?: (tab: NetworkToolTab) => void;
}
