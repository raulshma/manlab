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
      const stableReleases = catalog.gitHub.releases.filter((r) => !r.draft && !r.prerelease);
      if (stableReleases.length > 0) {
        stableReleases.sort((a, b) => compareVersions(b.tag, a.tag));
        latestVersion = stableReleases[0].tag;
      }
    } else if (catalog.local && catalog.local.length > 0) {
      latestVersion = catalog.local[0].version;
    }
  }

  // Compare versions
  // Compare versions
  const hasUpdate = !!latestVersion && !!currentAgentVersion && compareVersions(latestVersion, currentAgentVersion) > 0;
  const isLatest = !!currentAgentVersion && !!latestVersion && compareVersions(latestVersion, currentAgentVersion) === 0;

  return {
    hasUpdate,
    currentVersion: currentAgentVersion,
    latestVersion,
    isLatest,
    loading,
    error: error as Error | undefined,
  };
}

/**
 * Compare two semver strings (e.g. "v1.0.0", "1.2.3").
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 * Ignores prerelease suffixes for comparison (treats 1.0.0-beta as 1.0.0).
 */
function compareVersions(v1: string, v2: string): number {
  const s1 = v1.replace(/^v/, "");
  const s2 = v2.replace(/^v/, "");
  
  const p1 = s1.split(".").map((p) => parseInt(p, 10));
  const p2 = s2.split(".").map((p) => parseInt(p, 10));
  
  const len = Math.max(p1.length, p2.length);
  
  for (let i = 0; i < len; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  
  return 0;
}
