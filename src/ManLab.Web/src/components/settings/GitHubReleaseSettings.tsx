import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/api";
import { SettingKeys } from "@/constants/settingKeys";
import { toast } from "sonner";

interface SystemSetting {
  key: string;
  value: string | null;
  category: string;
  description: string | null;
}

const normalizeBaseUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
};

export function GitHubReleaseSettings() {
  const queryClient = useQueryClient();

  // Draft values (null means: use server values)
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [releaseBaseUrlDraft, setReleaseBaseUrlDraft] = useState<string | null>(null);
  const [latestVersionDraft, setLatestVersionDraft] = useState<string | null>(null);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await api.get<SystemSetting[]>("/api/settings");
      return response.data;
    },
  });

  const serverValues = useMemo(() => {
    const list = settings ?? [];
    const enabledSetting = list.find(
      (s: SystemSetting) => s.key === SettingKeys.GitHub.EnableGitHubDownload,
    );
    const baseUrlSetting = list.find(
      (s: SystemSetting) => s.key === SettingKeys.GitHub.ReleaseBaseUrl,
    );
    const versionSetting = list.find(
      (s: SystemSetting) => s.key === SettingKeys.GitHub.LatestVersion,
    );

    const enabledValue = (enabledSetting?.value || "").toLowerCase();
    const enabled =
      enabledValue === "true" || enabledValue === "1" || enabledValue === "yes";

    return {
      enabled,
      releaseBaseUrl: baseUrlSetting?.value ?? "",
      latestVersion: versionSetting?.value ?? "",
    };
  }, [settings]);

  const enabled = enabledDraft ?? serverValues.enabled;
  const releaseBaseUrl = releaseBaseUrlDraft ?? serverValues.releaseBaseUrl;
  const latestVersion = latestVersionDraft ?? serverValues.latestVersion;

  const isDirty =
    enabledDraft !== null ||
    releaseBaseUrlDraft !== null ||
    latestVersionDraft !== null;

  const mutation = useMutation({
    mutationFn: async (newSettings: SystemSetting[]) => {
      await api.post("/api/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setEnabledDraft(null);
      setReleaseBaseUrlDraft(null);
      setLatestVersionDraft(null);
      toast.success("GitHub release settings saved successfully.");
    },
    onError: (error) => {
      toast.error("Failed to save settings: " + error.message);
    },
  });

  const handleSave = () => {
    const normalizedBase = normalizeBaseUrl(releaseBaseUrl);

    // If disabled, clear the values so the backend reports Enabled=false.
    const valueEnabled = enabled ? "true" : "false";
    const valueBaseUrl = enabled ? normalizedBase : "";
    const valueVersion = enabled ? latestVersion.trim() : "";

    mutation.mutate([
      {
        key: SettingKeys.GitHub.EnableGitHubDownload,
        value: valueEnabled,
        category: "GitHub",
        description: "Prefer downloading agent binaries from GitHub Releases (fallback to server if unavailable)",
      },
      {
        key: SettingKeys.GitHub.ReleaseBaseUrl,
        value: valueBaseUrl,
        category: "GitHub",
        description: "Base URL like https://github.com/<owner>/<repo>/releases/download",
      },
      {
        key: SettingKeys.GitHub.LatestVersion,
        value: valueVersion,
        category: "GitHub",
        description: "Release tag like v0.0.1-alpha",
      },
    ]);
  };

  const githubWillWork =
    enabled &&
    normalizeBaseUrl(releaseBaseUrl).length > 0 &&
    latestVersion.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub Releases (Agent Downloads)</CardTitle>
        <CardDescription>
          Configure whether installers (including “Install local agent”) should prefer downloading agent binaries from GitHub Releases.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center space-x-2">
          <Switch
            id="github-enable"
            checked={enabled}
            onCheckedChange={(val) => {
              setEnabledDraft(val);
            }}
          />
          <Label htmlFor="github-enable">Prefer GitHub Releases for agent downloads</Label>
        </div>

        {enabled && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="github-release-base">Release base URL</Label>
              <Input
                id="github-release-base"
                value={releaseBaseUrl}
                onChange={(e) => {
                  setReleaseBaseUrlDraft(e.target.value);
                }}
                placeholder="https://github.com/raulshma/manlab/releases/download"
              />
              <p className="text-[0.8rem] text-muted-foreground">
                Should end with <span className="font-mono">/releases/download</span> (no trailing slash needed).
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="github-version">Release tag</Label>
              <Input
                id="github-version"
                value={latestVersion}
                onChange={(e) => {
                  setLatestVersionDraft(e.target.value);
                }}
                placeholder="v0.0.1-alpha"
              />
              <p className="text-[0.8rem] text-muted-foreground">
                Example: <span className="font-mono">v0.0.1-alpha</span>
              </p>
            </div>

            {!githubWillWork && (
              <p className="text-[0.8rem] text-muted-foreground">
                Fill in both fields to enable GitHub downloads. If GitHub download fails, installers will fall back to the server binary API.
              </p>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex justify-end">
        <Button onClick={handleSave} disabled={mutation.isPending || (!enabled && !isDirty)}>
          {mutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
