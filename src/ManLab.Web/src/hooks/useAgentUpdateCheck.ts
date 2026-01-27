import { useQuery } from "@tanstack/react-query";
import { fetchAgentReleaseCatalog, fetchNodeSettings } from "@/api";

export interface AgentUpdateStatus {
  hasUpdate: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  isLatest: boolean;
  loading: boolean;
  error?: Error | null;
}

/**
 * Custom hook to check if a node has an agent update available.
 * Compares the node's current agent version with the latest available version
 * from the agent release catalog.
 */
export function useAgentUpdateCheck(nodeId: string, currentAgentVersion: string | null): AgentUpdateStatus {
  // Fetch channel setting for the node (defaults to 'stable')
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["nodeSettings", nodeId],
    queryFn: () => fetchNodeSettings(nodeId),
    enabled: !!nodeId,
    staleTime: 60000, // Cache settings for 1 minute
  });

  const channel = settings?.find((s) => s.key === "agent.update.channel")?.value ?? "stable";

  // Fetch the agent release catalog for the node's channel
  const { data: catalog, isLoading: catalogLoading, error } = useQuery({
    queryKey: ["agentReleaseCatalog", channel],
    queryFn: () => fetchAgentReleaseCatalog(channel),
    enabled: !!channel,
    staleTime: 300000, // Cache catalog for 5 minutes
  });

  const loading = settingsLoading || catalogLoading;

  // Determine the latest available version
  // Priority: configuredLatestVersion > first GitHub release (non-draft) > first local version
  let latestVersion: string | null = null;

  if (catalog && !loading) {
    if (catalog.gitHub.enabled && catalog.gitHub.configuredLatestVersion) {
      latestVersion = catalog.gitHub.configuredLatestVersion;
    } else if (catalog.gitHub.enabled && catalog.gitHub.releases?.length > 0) {
      const nonDraftReleases = catalog.gitHub.releases.filter((r) => !r.draft);
      if (nonDraftReleases.length > 0) {
        latestVersion = nonDraftReleases[0].tag;
      }
    } else if (catalog.local && catalog.local.length > 0) {
      latestVersion = catalog.local[0].version;
    }
  }

  // Compare versions
  const hasUpdate = !!latestVersion && !!currentAgentVersion && currentAgentVersion !== latestVersion;
  const isLatest = !!currentAgentVersion && currentAgentVersion === latestVersion;

  return {
    hasUpdate,
    currentVersion: currentAgentVersion,
    latestVersion,
    isLatest,
    loading,
    error: error as Error | undefined,
  };
}
