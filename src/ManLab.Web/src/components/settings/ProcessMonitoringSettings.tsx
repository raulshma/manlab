import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { X, Plus } from "lucide-react";
import {
  fetchProcessMonitoringGlobalConfig,
  updateProcessMonitoringGlobalConfig,
  fetchNodes,
  fetchProcessMonitoringNodeConfig,
  resetProcessMonitoringNodeConfig,
} from "@/api";
import type { ProcessMonitoringConfig, Node } from "@/types";
import { toast } from "sonner";

const DEFAULT_GLOBAL_CONFIG: ProcessMonitoringConfig = {
  enabled: true,
  topCpuCount: 10,
  topMemoryCount: 10,
  refreshIntervalSeconds: 5,
  cpuAlertThreshold: 80,
  memoryAlertThreshold: 80,
  excludePatterns: [],
};

export function ProcessMonitoringSettings() {
  const queryClient = useQueryClient();
  const [excludePatternInput, setExcludePatternInput] = useState("");
  const [pendingChanges, setPendingChanges] = useState<Partial<ProcessMonitoringConfig> | null>(null);

  const { data: globalConfigData, isLoading } = useQuery({
    queryKey: ["processMonitoringGlobalConfig"],
    queryFn: fetchProcessMonitoringGlobalConfig,
  });

  // Use actual config data with defaults, applying any pending local changes
  const globalConfig = {
    ...DEFAULT_GLOBAL_CONFIG,
    ...globalConfigData,
    ...pendingChanges,
  };

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: () => fetchNodes(),
  });

  const globalMutation = useMutation({
    mutationFn: async (config: ProcessMonitoringConfig) => {
      await updateProcessMonitoringGlobalConfig(config);
    },
    onSuccess: () => {
      setPendingChanges(null);
      queryClient.invalidateQueries({ queryKey: ["processMonitoringGlobalConfig"] });
      toast.success("Process monitoring settings saved successfully.");
    },
    onError: (error) => {
      toast.error("Failed to save settings: " + error.message);
    },
  });

  const handleAddExcludePattern = () => {
    if (excludePatternInput && !globalConfig.excludePatterns.includes(excludePatternInput)) {
      setPendingChanges({
        ...pendingChanges,
        excludePatterns: [...globalConfig.excludePatterns, excludePatternInput],
      });
      setExcludePatternInput("");
    }
  };

  const handleRemoveExcludePattern = (pattern: string) => {
    setPendingChanges({
      ...pendingChanges,
      excludePatterns: globalConfig.excludePatterns.filter((p) => p !== pattern),
    });
  };

  const handleSaveGlobal = () => {
    // Validate
    if (globalConfig.topCpuCount < 1 || globalConfig.topCpuCount > 100) {
      toast.error("Top CPU count must be between 1 and 100");
      return;
    }
    if (globalConfig.topMemoryCount < 1 || globalConfig.topMemoryCount > 100) {
      toast.error("Top memory count must be between 1 and 100");
      return;
    }
    if (globalConfig.refreshIntervalSeconds < 2 || globalConfig.refreshIntervalSeconds > 300) {
      toast.error("Refresh interval must be between 2 and 300 seconds");
      return;
    }
    if (globalConfig.cpuAlertThreshold < 0 || globalConfig.cpuAlertThreshold > 100) {
      toast.error("CPU alert threshold must be between 0 and 100");
      return;
    }
    if (globalConfig.memoryAlertThreshold < 0 || globalConfig.memoryAlertThreshold > 100) {
      toast.error("Memory alert threshold must be between 0 and 100");
      return;
    }

    globalMutation.mutate(globalConfig);
  };

  return (
    <div className="space-y-6">
      {/* Global Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Global Process Monitoring Settings</CardTitle>
          <CardDescription>
            Configure default settings for process monitoring across all nodes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div>Loading...</div>
          ) : (
            <>
              {/* Enable/Disable */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Process Monitoring</Label>
                  <p className="text-sm text-muted-foreground">
                    Collect and display process telemetry across all nodes
                  </p>
                </div>
                <Switch
                  checked={globalConfig.enabled}
                  onCheckedChange={(checked) =>
                    setPendingChanges({ ...pendingChanges, enabled: checked })
                  }
                />
              </div>

              {globalConfig.enabled && (
                <>
                  {/* Process Counts */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Top CPU Processes: {globalConfig.topCpuCount}</Label>
                      <Slider
                        value={[globalConfig.topCpuCount]}
                        onValueChange={(value) =>
                          setPendingChanges({ ...globalConfig, topCpuCount: Array.isArray(value) ? value[0] : value })
                        }
                        min={1}
                        max={100}
                        step={1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Number of top CPU-consuming processes to collect per node
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Top Memory Processes: {globalConfig.topMemoryCount}</Label>
                      <Slider
                        value={[globalConfig.topMemoryCount]}
                        onValueChange={(value) =>
                          setPendingChanges({ ...globalConfig, topMemoryCount: Array.isArray(value) ? value[0] : value })
                        }
                        min={1}
                        max={100}
                        step={1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Number of top memory-consuming processes to collect per node
                      </p>
                    </div>
                  </div>

                  {/* Refresh Interval */}
                  <div className="space-y-2">
                    <Label>Refresh Interval: {globalConfig.refreshIntervalSeconds} seconds</Label>
                    <Slider
                      value={[globalConfig.refreshIntervalSeconds]}
                      onValueChange={(value) =>
                        setPendingChanges({ ...globalConfig, refreshIntervalSeconds: Array.isArray(value) ? value[0] : value })
                      }
                      min={2}
                      max={300}
                      step={1}
                    />
                    <p className="text-xs text-muted-foreground">
                      How often to refresh process telemetry (2-300 seconds)
                    </p>
                  </div>

                  {/* Alert Thresholds */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>CPU Alert Threshold: {globalConfig.cpuAlertThreshold}%</Label>
                      <Slider
                        value={[globalConfig.cpuAlertThreshold]}
                        onValueChange={(value) =>
                          setPendingChanges({ ...globalConfig, cpuAlertThreshold: Array.isArray(value) ? value[0] : value })
                        }
                        min={0}
                        max={100}
                        step={1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Trigger alert when process CPU exceeds this threshold
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Memory Alert Threshold: {globalConfig.memoryAlertThreshold}%</Label>
                      <Slider
                        value={[globalConfig.memoryAlertThreshold]}
                        onValueChange={(value) =>
                          setPendingChanges({ ...globalConfig, memoryAlertThreshold: Array.isArray(value) ? value[0] : value })
                        }
                        min={0}
                        max={100}
                        step={1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Trigger alert when process memory exceeds this threshold
                      </p>
                    </div>
                  </div>

                  {/* Exclude Patterns */}
                  <div className="space-y-2">
                    <Label>Exclude Patterns</Label>
                    <p className="text-xs text-muted-foreground">
                      Wildcard patterns for processes to exclude from monitoring (e.g., "system*", "idle")
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g., system*"
                        value={excludePatternInput}
                        onChange={(e) => setExcludePatternInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddExcludePattern();
                          }
                        }}
                      />
                      <Button type="button" onClick={handleAddExcludePattern}>
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                    {globalConfig.excludePatterns.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {globalConfig.excludePatterns.map((pattern) => (
                          <Badge key={pattern} variant="secondary">
                            {pattern}
                            <button
                              onClick={() => handleRemoveExcludePattern(pattern)}
                              className="ml-1 hover:text-destructive"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
        <CardFooter>
          <Button onClick={handleSaveGlobal} disabled={globalMutation.isPending}>
            {globalMutation.isPending ? "Saving..." : "Save Global Settings"}
          </Button>
        </CardFooter>
      </Card>

      {/* Per-Node Overrides */}
      {nodes && nodes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Node Overrides</CardTitle>
            <CardDescription>
              Configure node-specific settings that override global defaults
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Node</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>CPU Count</TableHead>
                    <TableHead>Memory Count</TableHead>
                    <TableHead>Refresh (s)</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((node) => (
                    <NodeOverrideRow key={node.id} node={node} />
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NodeOverrideRow({ node }: { node: Node }) {
  const queryClient = useQueryClient();
  const [editConfig, setEditConfig] = useState<ProcessMonitoringConfig | null>(null);

  const { data: nodeConfig, isLoading } = useQuery({
    queryKey: ["processMonitoringNodeConfig", node.id],
    queryFn: () => fetchProcessMonitoringNodeConfig(node.id),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      await resetProcessMonitoringNodeConfig(node.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processMonitoringNodeConfig", node.id] });
      toast.success(`Settings reset for ${node.hostname}`);
    },
    onError: (error) => {
      toast.error("Failed to reset settings: " + error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (config: ProcessMonitoringConfig) => {
      const response = await fetch(`/api/process-monitoring/nodes/${node.id}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error("Failed to update settings");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processMonitoringNodeConfig", node.id] });
      toast.success(`Settings updated for ${node.hostname}`);
      setEditConfig(null);
    },
    onError: (error) => {
      toast.error("Failed to update settings: " + error.message);
    },
  });

  const handleStartEdit = () => {
    if (nodeConfig) {
      setEditConfig(nodeConfig);
    }
  };

  const handleCancelEdit = () => {
    setEditConfig(null);
  };

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={6}>Loading...</TableCell>
      </TableRow>
    );
  }

  if (editConfig) {
    return (
      <TableRow>
        <TableCell className="font-medium">{node.hostname}</TableCell>
        <TableCell colSpan={4}>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-4">
              <Label className="text-sm">Enabled</Label>
              <Switch
                checked={editConfig.enabled}
                onCheckedChange={(checked) =>
                  setEditConfig({ ...editConfig, enabled: checked })
                }
              />
            </div>
            {editConfig.enabled && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">CPU Count</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={editConfig.topCpuCount}
                    onChange={(e) =>
                      setEditConfig({
                        ...editConfig,
                        topCpuCount: parseInt(e.target.value) || 10,
                      })
                    }
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Memory Count</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={editConfig.topMemoryCount}
                    onChange={(e) =>
                      setEditConfig({
                        ...editConfig,
                        topMemoryCount: parseInt(e.target.value) || 10,
                      })
                    }
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Refresh (s)</Label>
                  <Input
                    type="number"
                    min={2}
                    max={300}
                    value={editConfig.refreshIntervalSeconds}
                    onChange={(e) =>
                      setEditConfig({
                        ...editConfig,
                        refreshIntervalSeconds: parseInt(e.target.value) || 5,
                      })
                    }
                    className="h-8"
                  />
                </div>
              </div>
            )}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => updateMutation.mutate(editConfig)}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelEdit}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{node.hostname}</TableCell>
      <TableCell>
        <Badge variant={nodeConfig?.enabled ? "default" : "secondary"}>
          {nodeConfig?.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </TableCell>
      <TableCell>{nodeConfig?.topCpuCount ?? 10}</TableCell>
      <TableCell>{nodeConfig?.topMemoryCount ?? 10}</TableCell>
      <TableCell>{nodeConfig?.refreshIntervalSeconds ?? 5}s</TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleStartEdit}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
          >
            Reset
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
