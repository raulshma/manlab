/**
 * useNetworkToolHistory Hook
 * Hook for consuming network tool history context.
 */

import { useContext } from "react";
import {
  NetworkToolHistoryContext,
  type NetworkToolHistoryContextValue,
} from "@/contexts/network-tool-history-types";

/**
 * Hook to access network tool history context.
 * Must be used within a NetworkToolHistoryProvider.
 */
export function useNetworkToolHistory(): NetworkToolHistoryContextValue {
  const context = useContext(NetworkToolHistoryContext);
  if (!context) {
    throw new Error(
      "useNetworkToolHistory must be used within a NetworkToolHistoryProvider"
    );
  }
  return context;
}

/**
 * Optional hook that returns null if context is not available.
 */
export function useNetworkToolHistoryOptional(): NetworkToolHistoryContextValue | null {
  return useContext(NetworkToolHistoryContext);
}
