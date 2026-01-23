/**
 * Network Tools Hooks
 * React hooks for accessing the NetworkToolsContext
 */

import { useContext } from "react";
import {
  NetworkToolsContext,
  type NetworkToolsContextValue,
} from "@/contexts/network-tools-types";

/**
 * Hook to access network tools context
 * Must be used within a NetworkToolsProvider
 */
export function useNetworkTools(): NetworkToolsContextValue {
  const context = useContext(NetworkToolsContext);
  if (!context) {
    throw new Error("useNetworkTools must be used within a NetworkToolsProvider");
  }
  return context;
}

/**
 * Hook to safely access network tools context (returns null if not in provider)
 * Useful for components that might be used outside the NetworkToolsProvider
 */
export function useNetworkToolsOptional(): NetworkToolsContextValue | null {
  return useContext(NetworkToolsContext);
}
