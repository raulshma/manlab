import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { applyNetworkSettingsToStorage, type SystemSetting } from "@/lib/network-settings";

export function useNetworkSettingsSync() {
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await api.get<SystemSetting[]>("/api/settings");
      return response.data;
    },
  });

  useEffect(() => {
    if (!query.data) return;
    applyNetworkSettingsToStorage(query.data);
  }, [query.data]);

  return {
    isLoading: query.isLoading,
    isReady: query.isSuccess,
    isError: query.isError,
  };
}
