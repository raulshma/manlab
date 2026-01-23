/**
 * NetworkToolHistoryProvider Component
 * Provides context for network tool history state and operations.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  NetworkToolHistoryContext,
  type NetworkToolType,
  type ParsedHistoryEntry,
} from "./network-tool-history-types";
import {
  getNetworkToolHistory,
  deleteNetworkToolHistoryEntry,
  type NetworkToolHistoryEntry,
} from "@/api/networkApi";

// Re-export types for convenience
export { NetworkToolHistoryContext } from "./network-tool-history-types";
export type { NetworkToolType, ParsedHistoryEntry, NetworkToolHistoryContextValue } from "./network-tool-history-types";

interface NetworkToolHistoryProviderProps {
  children: ReactNode;
  /** Initial count of entries to fetch */
  initialCount?: number;
  /** Auto-refresh interval in milliseconds (0 = disabled) */
  autoRefreshMs?: number;
}

/**
 * Parse a raw history entry from the API into a UI-friendly format.
 */
function parseHistoryEntry(raw: NetworkToolHistoryEntry): ParsedHistoryEntry {
  let input: Record<string, unknown> | null = null;
  let result: Record<string, unknown> | null = null;

  try {
    if (raw.inputJson) {
      input = JSON.parse(raw.inputJson);
    }
  } catch {
    // Ignore parse errors
  }

  try {
    if (raw.resultJson) {
      result = JSON.parse(raw.resultJson);
    }
  } catch {
    // Ignore parse errors
  }

  return {
    id: raw.id,
    timestamp: new Date(raw.timestampUtc),
    toolType: raw.toolType,
    target: raw.target,
    input,
    result,
    success: raw.success,
    durationMs: raw.durationMs,
    error: raw.errorMessage,
  };
}

export function NetworkToolHistoryProvider({
  children,
  initialCount = 50,
  autoRefreshMs = 0,
}: NetworkToolHistoryProviderProps) {
  const [history, setHistory] = useState<ParsedHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<NetworkToolType | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const entries = await getNetworkToolHistory(initialCount, activeFilter ?? undefined);
      setHistory(entries.map(parseHistoryEntry));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load history";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [initialCount, activeFilter]);

  const deleteEntry = useCallback(async (id: string) => {
    try {
      await deleteNetworkToolHistoryEntry(id);
      setHistory((prev) => prev.filter((entry) => entry.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete entry";
      setError(message);
    }
  }, []);

  const setFilter = useCallback((toolType: NetworkToolType | null) => {
    setActiveFilter(toolType);
  }, []);

  // Fetch on mount and when filter changes
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshMs <= 0) return;
    const interval = setInterval(refresh, autoRefreshMs);
    return () => clearInterval(interval);
  }, [autoRefreshMs, refresh]);

  return (
    <NetworkToolHistoryContext.Provider
      value={{
        history,
        isLoading,
        error,
        refresh,
        deleteEntry,
        activeFilter,
        setFilter,
      }}
    >
      {children}
    </NetworkToolHistoryContext.Provider>
  );
}
