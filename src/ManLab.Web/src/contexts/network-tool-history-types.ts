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

export type HistoryStatusFilter = "all" | "success" | "failed";
export type HistorySortBy = "timestamp" | "duration" | "tool" | "target" | "status";
export type HistorySortDir = "asc" | "desc";

export interface NetworkToolHistoryQueryState {
  page: number;
  pageSize: number;
  toolTypes: NetworkToolType[];
  status: HistoryStatusFilter;
  search: string;
  fromUtc: string | null;
  toUtc: string | null;
  sortBy: HistorySortBy;
  sortDir: HistorySortDir;
}

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
  tags: string[];
  notes: string | null;
}

/**
 * Context value for network tool history.
 */
export interface NetworkToolHistoryContextValue {
  /** History entries (most recent first) */
  history: ParsedHistoryEntry[];
  /** Total count for current query */
  totalCount: number;
  /** Whether history is being loaded */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Refresh history from server */
  refresh: () => Promise<void>;
  /** Delete a history entry */
  deleteEntry: (id: string) => Promise<void>;
  /** Update history metadata */
  updateMetadata: (id: string, tags: string[], notes?: string | null) => Promise<void>;
  /** Current query state */
  query: NetworkToolHistoryQueryState;
  /** Update query state */
  setQuery: (update: Partial<NetworkToolHistoryQueryState>) => void;
}

export const NetworkToolHistoryContext = createContext<NetworkToolHistoryContextValue | null>(null);
