/**
 * Network Tool History Types
 * Types for the network tool history tracking context.
 */

import { createContext } from "react";

/**
 * Network tool types tracked in history.
 */
export type NetworkToolType =
  | "ping"
  | "traceroute"
  | "port-scan"
  | "subnet-scan"
  | "discovery"
  | "wifi-scan"
  | "dns-lookup"
  | "whois"
  | "public-ip"
  | "wol"
  | "ssl-inspect"
  | "mac-vendor"
  | "speedtest";

/**
 * Parsed history entry for UI consumption.
 */
export interface ParsedHistoryEntry {
  id: string;
  timestamp: Date;
  toolType: NetworkToolType;
  target: string | null;
  input: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  success: boolean;
  durationMs: number;
  error: string | null;
}

/**
 * Context value for network tool history.
 */
export interface NetworkToolHistoryContextValue {
  /** History entries (most recent first) */
  history: ParsedHistoryEntry[];
  /** Whether history is being loaded */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Refresh history from server */
  refresh: () => Promise<void>;
  /** Delete a history entry */
  deleteEntry: (id: string) => Promise<void>;
  /** Current tool type filter */
  activeFilter: NetworkToolType | null;
  /** Set tool type filter */
  setFilter: (toolType: NetworkToolType | null) => void;
}

export const NetworkToolHistoryContext = createContext<NetworkToolHistoryContextValue | null>(null);
