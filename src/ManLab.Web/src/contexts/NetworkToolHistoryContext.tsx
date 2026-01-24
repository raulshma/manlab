/**
 * NetworkToolHistoryProvider Component
 * Provides context for network tool history state and operations.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  NetworkToolHistoryContext,
  type ParsedHistoryEntry,
  type NetworkToolHistoryQueryState,
} from "./network-tool-history-types";
import {
  queryNetworkToolHistory,
  deleteNetworkToolHistoryEntry,
  updateNetworkToolHistoryMetadata,
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
    tags: raw.tags ?? [],
    notes: raw.notes ?? null,
  };
}

export function NetworkToolHistoryProvider({
  children,
  initialCount = 50,
  autoRefreshMs = 0,
}: NetworkToolHistoryProviderProps) {
  const [history, setHistory] = useState<ParsedHistoryEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultQuery = useMemo<NetworkToolHistoryQueryState>(() => ({
    page: 1,
    pageSize: Math.max(10, Math.min(200, initialCount)),
    toolTypes: [],
    status: "all",
    search: "",
    fromUtc: null,
    toUtc: null,
    sortBy: "timestamp",
    sortDir: "desc",
  }), [initialCount]);

  const [query, setQueryState] = useState<NetworkToolHistoryQueryState>(defaultQuery);

  const setQuery = useCallback((update: Partial<NetworkToolHistoryQueryState>) => {
    setQueryState((prev) => ({
      ...prev,
      ...update,
      page: update.page ?? (update.pageSize || update.toolTypes || update.status || update.search || update.fromUtc || update.toUtc || update.sortBy || update.sortDir
        ? 1
        : prev.page),
    }));
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await queryNetworkToolHistory({
        page: query.page,
        pageSize: query.pageSize,
        toolTypes: query.toolTypes.length > 0 ? query.toolTypes : undefined,
        status: query.status,
        search: query.search,
        fromUtc: query.fromUtc,
        toUtc: query.toUtc,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      });
      setHistory(result.items.map(parseHistoryEntry));
      setTotalCount(result.totalCount);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load history";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  const deleteEntry = useCallback(async (id: string) => {
    try {
      await deleteNetworkToolHistoryEntry(id);
      setHistory((prev) => prev.filter((entry) => entry.id !== id));
      setTotalCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete entry";
      setError(message);
    }
  }, []);

  const updateMetadata = useCallback(async (id: string, tags: string[], notes?: string | null) => {
    try {
      const updated = await updateNetworkToolHistoryMetadata(id, { tags, notes });
      setHistory((prev) => prev.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              tags: updated.tags ?? [],
              notes: updated.notes ?? null,
            }
          : entry
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update metadata";
      setError(message);
    }
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
        totalCount,
        isLoading,
        error,
        refresh,
        deleteEntry,
        updateMetadata,
        query,
        setQuery,
      }}
    >
      {children}
    </NetworkToolHistoryContext.Provider>
  );
}
