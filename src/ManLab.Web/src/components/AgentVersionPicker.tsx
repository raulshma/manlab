import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAgentReleaseCatalog } from "@/api";
import type { AgentReleaseCatalogResponse } from "@/types";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export type AgentVersionSource = "local" | "github";

export interface AgentVersionSelection {
  source: AgentVersionSource;
  /**
   * For source=github: GitHub tag (e.g. v1.2.3)
   * For source=local: version folder (e.g. staged or v1.2.3)
   */
  version: string;
  /**
   * Channel used for local downloads (e.g. stable/beta). Only relevant when source=local.
   */
  channel: string;
}

interface AgentVersionPickerProps {
  channel: string;
  value: AgentVersionSelection;
  onChange: (next: AgentVersionSelection) => void;
}

function pickDefaultSource(catalog: AgentReleaseCatalogResponse): AgentVersionSource {
  const hasGitHub =
    catalog.gitHub.enabled &&
    (catalog.gitHub.releases?.length ?? 0) > 0 &&
    !!catalog.gitHub.releaseBaseUrl;
  return hasGitHub ? "github" : "local";
}

function isGitHubAvailable(catalog: AgentReleaseCatalogResponse, githubTags: string[]): boolean {
  return (
    catalog.gitHub.enabled &&
    !!catalog.gitHub.releaseBaseUrl &&
    (githubTags.length ?? 0) > 0
  );
}

function isLocalAvailable(catalog: AgentReleaseCatalogResponse): boolean {
  return (catalog.local?.length ?? 0) > 0;
}

export function AgentVersionPicker({ channel, value, onChange }: AgentVersionPickerProps) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["agentReleaseCatalog", channel],
    queryFn: () => fetchAgentReleaseCatalog(channel),
    staleTime: 60_000,
  });

  const localVersions = useMemo(() => {
    if (!data) return [];
    return (data.local ?? []).map((l) => l.version);
  }, [data]);

  const githubTags = useMemo(() => {
    if (!data) return [];
    return (data.gitHub.releases ?? [])
      .filter((r) => !r.draft)
      .map((r) => r.tag);
  }, [data]);

  // If the current selection isn't valid for the fetched catalog, normalize it.
  useEffect(() => {
    if (!data) return;

    // Treat the incoming selection as a preference, but never get stuck on a source
    // that isn't actually available for the current catalog.
    const preferredSource = value.source;
    const canUseGitHub = isGitHubAvailable(data, githubTags);
    const canUseLocal = isLocalAvailable(data);

    const desiredSource: AgentVersionSource =
      preferredSource === "github" && canUseGitHub
        ? "github"
        : preferredSource === "local" && canUseLocal
          ? "local"
          : pickDefaultSource(data);

    if (desiredSource === "github") {
      const defaultTag =
        data.gitHub.configuredLatestVersion || githubTags[0] || "";
      const nextTag = githubTags.includes(value.version) ? value.version : defaultTag;

      if (value.source !== "github" || value.version !== nextTag || value.channel !== channel) {
        onChange({ source: "github", version: nextTag, channel });
      }
    } else {
      const defaultLocal = localVersions.includes("staged")
        ? "staged"
        : localVersions[0] || "staged";
      const nextVersion = localVersions.includes(value.version)
        ? value.version
        : defaultLocal;

      if (value.source !== "local" || value.version !== nextVersion || value.channel !== channel) {
        onChange({ source: "local", version: nextVersion, channel });
      }
    }
  }, [data, channel, githubTags, localVersions, onChange, value.channel, value.source, value.version]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" />
        Loading versions…
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error ? error.message : "Failed to load release catalog"}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return null;
  }

  const sourceOptions: { value: AgentVersionSource; label: string; disabled?: boolean }[] = [
    {
      value: "local",
      label: "Server (local staged)",
      disabled: (data.local?.length ?? 0) === 0,
    },
    {
      value: "github",
      label: "GitHub Releases",
      disabled:
        !data.gitHub.enabled ||
        !data.gitHub.releaseBaseUrl ||
        (githubTags.length ?? 0) === 0,
    },
  ];

  const versionOptions = value.source === "github" ? githubTags : localVersions;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Source</div>
          <Select
            value={value.source}
            onValueChange={(v) => {
              const src = v as AgentVersionSource;
              const nextVersion =
                src === "github"
                  ? data.gitHub.configuredLatestVersion || githubTags[0] || ""
                  : localVersions.includes("staged")
                  ? "staged"
                  : localVersions[0] || "staged";
              onChange({ source: src, version: nextVersion, channel });
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sourceOptions.map((o) => (
                <SelectItem key={o.value} value={o.value} disabled={!!o.disabled}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Version</div>
          <Select
            value={value.version}
            onValueChange={(v) => {
              if (!v) return;
              onChange({ ...value, version: v });
            }}
            disabled={versionOptions.length === 0}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versionOptions.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.source === "github" && data.gitHub.enabled && data.gitHub.error ? (
        <Alert variant="destructive">
          <AlertDescription>GitHub listing error: {data.gitHub.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
