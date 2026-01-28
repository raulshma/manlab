import { useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { api } from "@/api";
import { toast } from "sonner";

interface GitHubUpdateConfig {
  enabled: boolean;
  releaseBaseUrl: string | null;
  repository: string | null;
  versionStrategy: string;
  manualVersion: string | null;
  preferGitHubForUpdates: boolean;
}

interface GitHubTestResult {
  success: boolean;
  error: string | null;
  releases: string[];
}

const normalizeBaseUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
};

export function GitHubReleaseSettings() {
  const queryClient = useQueryClient();

  // Test state
  const [testResult, setTestResult] = useState<GitHubTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Fetch current configuration
  const { data: config, isLoading } = useQuery({
    queryKey: ["github-update-config"],
    queryFn: async () => {
      const response = await api.get<GitHubUpdateConfig>("/api/settings/github-update");
      return response.data;
    },
  });

  // Derive initial form data from config
  const getInitialFormData = () => config ? {
    enabled: config.enabled,
    releaseBaseUrl: config.releaseBaseUrl || "",
    repository: config.repository || "",
    versionStrategy: config.versionStrategy,
    manualVersion: config.manualVersion || "",
    preferGitHub: config.preferGitHubForUpdates,
  } : {
    enabled: false,
    releaseBaseUrl: "",
    repository: "",
    versionStrategy: "latest-stable",
    manualVersion: "",
    preferGitHub: false,
  };

  // Local state for form
  const [formData, setFormData] = useState(getInitialFormData());

  // Track previous config to detect changes
  const [prevConfig, setPrevConfig] = useState<GitHubUpdateConfig | undefined>(undefined);

  // Sync state with config changes (Render-as-you-fetch pattern)
  // This updates formData immediately when config is loaded or changes, avoiding useEffect and flicker
  if (config !== prevConfig) {
    setPrevConfig(config);
    if (config) {
      setFormData({
        enabled: config.enabled,
        releaseBaseUrl: config.releaseBaseUrl || "",
        repository: config.repository || "",
        versionStrategy: config.versionStrategy,
        manualVersion: config.manualVersion || "",
        preferGitHub: config.preferGitHubForUpdates,
      });
    }
  }

  const mutation = useMutation({
    mutationFn: async (newConfig: GitHubUpdateConfig) => {
      await api.put("/api/settings/github-update", newConfig);
    },
    onSuccess: async () => {
      // Invalidate and refetch to ensure we get the latest data from server
      await queryClient.invalidateQueries({ queryKey: ["github-update-config"] });
      await queryClient.refetchQueries({ queryKey: ["github-update-config"] });
      
      // Get the fresh config from the cache after refetch
      const freshConfig = queryClient.getQueryData<GitHubUpdateConfig>(["github-update-config"]);
      
      // Reset form to match server state after successful save
      if (freshConfig) {
        setFormData({
          enabled: freshConfig.enabled,
          releaseBaseUrl: freshConfig.releaseBaseUrl || "",
          repository: freshConfig.repository || "",
          versionStrategy: freshConfig.versionStrategy,
          manualVersion: freshConfig.manualVersion || "",
          preferGitHub: freshConfig.preferGitHubForUpdates,
        });
      }
      
      toast.success("GitHub update settings saved successfully.");
    },
    onError: (error: Error) => {
      toast.error("Failed to save settings: " + (error.message || "Unknown error"));
    },
  });

  const testMutation = useMutation({
    mutationFn: async (repo: string) => {
      const response = await api.post<GitHubTestResult>("/api/settings/github-update/test", {
        repository: repo,
      });
      return response.data;
    },
    onSuccess: (data) => {
      setTestResult(data);
      if (data.success) {
        toast.success(`Successfully connected! Found ${data.releases.length} releases.`);
      } else {
        toast.error("Connection failed: " + data.error);
      }
    },
    onError: (error: Error) => {
      const errorMsg = error.message || "Unknown error";
      setTestResult({
        success: false,
        error: errorMsg,
        releases: [],
      });
      toast.error("Test failed: " + errorMsg);
    },
  });

  const handleSave = () => {
    const normalizedBase = normalizeBaseUrl(formData.releaseBaseUrl);

    mutation.mutate({
      enabled: formData.enabled,
      releaseBaseUrl: formData.enabled ? normalizedBase : null,
      repository: formData.enabled ? formData.repository.trim() || null : null,
      versionStrategy: formData.enabled ? formData.versionStrategy : "latest-stable",
      manualVersion: formData.enabled && formData.versionStrategy === "manual" ? formData.manualVersion.trim() || null : null,
      preferGitHubForUpdates: formData.enabled ? formData.preferGitHub : false,
    });
  };

  const handleTest = () => {
    if (!formData.repository.trim()) {
      toast.error("Please enter a repository first");
      return;
    }
    setIsTesting(true);
    testMutation.mutate(formData.repository.trim(), {
      onSettled: () => setIsTesting(false),
    });
  };

  const handleReset = () => {
    if (config) {
      setFormData({
        enabled: config.enabled,
        releaseBaseUrl: config.releaseBaseUrl || "",
        repository: config.repository || "",
        versionStrategy: config.versionStrategy,
        manualVersion: config.manualVersion || "",
        preferGitHub: config.preferGitHubForUpdates,
      });
    }
    setTestResult(null);
  };

  const isValid = !formData.enabled || (formData.repository.trim().length > 0 && 
    (formData.versionStrategy !== "manual" || formData.manualVersion.trim().length > 0));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub Releases (Agent Updates)</CardTitle>
        <CardDescription>
          Configure automatic agent updates from GitHub releases with semantic versioning.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="flex items-center space-x-2">
          <Switch
            id="github-enable"
            checked={formData.enabled}
            onCheckedChange={(val) => setFormData(prev => ({ ...prev, enabled: val }))}
          />
          <Label htmlFor="github-enable">Enable GitHub releases for agent updates</Label>
        </div>

        {formData.enabled && (
          <div className="space-y-6">
            {/* Repository Configuration */}
            <div className="space-y-4 p-4 border rounded-lg">
              <h4 className="font-medium text-sm">Repository Configuration</h4>
              
              <div className="grid gap-2">
                <Label htmlFor="github-repo">GitHub Repository</Label>
                <div className="flex gap-2">
                  <Input
                    id="github-repo"
                    value={formData.repository}
                    onChange={(e) => setFormData(prev => ({ ...prev, repository: e.target.value }))}
                    placeholder="owner/repo (e.g., manlab/agent)"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={handleTest}
                    disabled={isTesting || !formData.repository.trim()}
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      "Test Connection"
                    )}
                  </Button>
                </div>
                <p className="text-[0.8rem] text-muted-foreground">
                  Format: <span className="font-mono">owner/repository</span>
                </p>
              </div>

              {testResult && (
                <div className={`p-3 rounded-md border ${testResult.success ? 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800' : 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800'}`}>
                  <div className="flex items-start gap-2">
                    {testResult.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {testResult.success ? "Connection successful!" : "Connection failed"}
                      </p>
                      {testResult.success && testResult.releases.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground mb-1">
                            Found {testResult.releases.length} releases:
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {testResult.releases.slice(0, 5).map((release) => (
                              <Badge key={release} variant="secondary" className="text-xs">
                                {release}
                              </Badge>
                            ))}
                            {testResult.releases.length > 5 && (
                              <Badge variant="outline" className="text-xs">
                                +{testResult.releases.length - 5} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                      {testResult.error && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          {testResult.error}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="github-release-base">Release Base URL (Optional)</Label>
                <Input
                  id="github-release-base"
                  value={formData.releaseBaseUrl}
                  onChange={(e) => setFormData(prev => ({ ...prev, releaseBaseUrl: e.target.value }))}
                  placeholder="https://github.com/owner/repo/releases/download"
                />
                <p className="text-[0.8rem] text-muted-foreground">
                  Auto-generated from repository if not specified. Should end with <span className="font-mono">/releases/download</span>
                </p>
              </div>
            </div>

            {/* Version Strategy */}
            <div className="space-y-4 p-4 border rounded-lg">
              <h4 className="font-medium text-sm">Version Selection Strategy</h4>
              
              <div className="grid gap-2">
                <Label htmlFor="version-strategy">Strategy</Label>
                <Select 
                  value={formData.versionStrategy} 
                  onValueChange={(val) => setFormData(prev => ({ ...prev, versionStrategy: val || "latest-stable" }))}
                >
                  <SelectTrigger id="version-strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest-stable">
                      Latest Stable
                      <span className="text-xs text-muted-foreground ml-2">
                        (Recommended)
                      </span>
                    </SelectItem>
                    <SelectItem value="latest-prerelease">
                      Latest Prerelease
                      <span className="text-xs text-muted-foreground ml-2">
                        (Includes beta/alpha)
                      </span>
                    </SelectItem>
                    <SelectItem value="manual">
                      Manual Version
                      <span className="text-xs text-muted-foreground ml-2">
                        (Pin to specific version)
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[0.8rem] text-muted-foreground">
                  {formData.versionStrategy === "latest-stable" && "Automatically use the latest stable release (excludes prereleases)"}
                  {formData.versionStrategy === "latest-prerelease" && "Include beta/alpha releases when finding the latest version"}
                  {formData.versionStrategy === "manual" && "Pin to a specific version tag"}
                </p>
              </div>

              {formData.versionStrategy === "manual" && (
                <div className="grid gap-2">
                  <Label htmlFor="manual-version">Version Tag</Label>
                  <Input
                    id="manual-version"
                    value={formData.manualVersion}
                    onChange={(e) => setFormData(prev => ({ ...prev, manualVersion: e.target.value }))}
                    placeholder="v1.2.3"
                  />
                  <p className="text-[0.8rem] text-muted-foreground">
                    Example: <span className="font-mono">v1.2.3</span> or <span className="font-mono">v1.0.0-beta.1</span>
                  </p>
                </div>
              )}
            </div>

            {/* Update Preferences */}
            <div className="space-y-4 p-4 border rounded-lg">
              <h4 className="font-medium text-sm">Update Preferences</h4>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="prefer-github"
                  checked={formData.preferGitHub}
                  onCheckedChange={(val) => setFormData(prev => ({ ...prev, preferGitHub: val }))}
                />
                <div className="flex-1">
                  <Label htmlFor="prefer-github">Prefer GitHub over local binaries</Label>
                  <p className="text-[0.8rem] text-muted-foreground mt-1">
                    When enabled, auto-update will check GitHub first, then fall back to local binaries if unavailable.
                  </p>
                </div>
              </div>
            </div>

            {!isValid && (
              <div className="p-3 rounded-md border border-yellow-200 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  Please fill in all required fields to enable GitHub updates.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={handleReset}
        >
          Reset
        </Button>
        <Button onClick={handleSave} disabled={mutation.isPending || !isValid}>
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
