/**
 * ServiceMonitoringPanel - Manage and display service monitoring for a node.
 * Allows configuring which services to monitor, viewing their status, and triggering restarts.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchServiceMonitorConfigs,
  fetchServiceStatusHistory,
  upsertServiceMonitorConfig,
  deleteServiceMonitorConfig,
  requestServiceStatusRefresh,
  createCommand,
} from "../api";
import type { ServiceMonitorConfig, ServiceStatusSnapshot } from "../types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmationModal } from "./ConfirmationModal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Edit2,
  Server,
} from "lucide-react";

interface ServiceMonitoringPanelProps {
  nodeId: string;
  nodeStatus?: string;
}

// Helper to format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffSeconds < 60) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// Get status badge variant based on service state
function getStatusBadgeVariant(
  state: string
): "default" | "destructive" | "secondary" | "outline" {
  const lowerState = state.toLowerCase();
  if (lowerState === "active" || lowerState === "running") return "default";
  if (lowerState === "failed" || lowerState === "dead" || lowerState === "error")
    return "destructive";
  if (lowerState === "inactive" || lowerState === "stopped") return "secondary";
  return "outline";
}

export function ServiceMonitoringPanel({
  nodeId,
  nodeStatus = "Online",
}: ServiceMonitoringPanelProps) {
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [editingConfig, setEditingConfig] = useState<ServiceMonitorConfig | null>(
    null
  );
  const [editServiceName, setEditServiceName] = useState("");

  const isOnline = nodeStatus === "Online";

  // Fetch service monitor configs
  const { data: configs, isLoading: configsLoading } = useQuery({
    queryKey: ["serviceMonitorConfigs", nodeId],
    queryFn: () => fetchServiceMonitorConfigs(nodeId),
  });

  // Fetch service status history
  const { data: statusHistory } = useQuery({
    queryKey: ["serviceStatusHistory", nodeId],
    queryFn: () => fetchServiceStatusHistory(nodeId, 100),
    refetchInterval: 10000,
  });

  // Get latest status for each service
  const getLatestStatus = (
    serviceName: string
  ): ServiceStatusSnapshot | undefined => {
    return statusHistory?.find(
      (s) => s.serviceName.toLowerCase() === serviceName.toLowerCase()
    );
  };

  // Add service mutation
  const addMutation = useMutation({
    mutationFn: (serviceName: string) =>
      upsertServiceMonitorConfig(nodeId, null, { serviceName, enabled: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["serviceMonitorConfigs", nodeId] });
      setNewServiceName("");
      setAddDialogOpen(false);

       // Kick off a status refresh so "Last Check" and status populate quickly.
       if (isOnline) {
         setTimeout(() => refreshMutation.mutate(), 250);
       }
    },
  });

  // Update service mutation
  const updateMutation = useMutation({
    mutationFn: ({
      configId,
      serviceName,
      enabled,
    }: {
      configId: string;
      serviceName?: string;
      enabled?: boolean;
    }) => upsertServiceMonitorConfig(nodeId, configId, { serviceName, enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["serviceMonitorConfigs", nodeId] });
      setEditingConfig(null);
      setEditDialogOpen(false);

      // If the service was renamed or enabled, refresh statuses.
      if (isOnline) {
        setTimeout(() => refreshMutation.mutate(), 250);
      }
    },
  });

  // Delete service mutation
  const deleteMutation = useMutation({
    mutationFn: (configId: string) => deleteServiceMonitorConfig(nodeId, configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["serviceMonitorConfigs", nodeId] });
    },
  });

  // Refresh status mutation
  const refreshMutation = useMutation({
    mutationFn: () => requestServiceStatusRefresh(nodeId),
    onSuccess: () => {
      // Refetch status history after refresh command is queued
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: ["serviceStatusHistory", nodeId],
        });
      }, 2000);
    },
  });

  // Restart service mutation
  const restartMutation = useMutation({
    mutationFn: (serviceName: string) =>
      createCommand(nodeId, "service.restart", { serviceName }),
    onSuccess: () => {
      // Trigger refresh after restart
      setTimeout(() => refreshMutation.mutate(), 2000);
    },
  });

  const handleAddService = () => {
    if (newServiceName.trim()) {
      addMutation.mutate(newServiceName.trim());
    }
  };

  const handleEditService = () => {
    if (editingConfig && editServiceName.trim()) {
      updateMutation.mutate({
        configId: editingConfig.id,
        serviceName: editServiceName.trim(),
      });
    }
  };

  const handleToggleEnabled = (config: ServiceMonitorConfig) => {
    updateMutation.mutate({
      configId: config.id,
      enabled: !config.enabled,
    });
  };

  const openEditDialog = (config: ServiceMonitorConfig) => {
    setEditingConfig(config);
    setEditServiceName(config.serviceName);
    setEditDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Service Monitoring</CardTitle>
              <CardDescription>
                Configure which services to monitor on this node
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={!isOnline || refreshMutation.isPending}
            >
              {refreshMutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-1 hidden sm:inline">Refresh</span>
            </Button>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Service
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Service to Monitor</DialogTitle>
                  <DialogDescription>
                        Enter the service identifier to monitor (Linux: systemd unit name
                        like nginx/ssh/docker; Windows: service name like Spooler).
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="serviceName">Service Name</Label>
                    <Input
                      id="serviceName"
                      placeholder="e.g., nginx"
                      value={newServiceName}
                      onChange={(e) => setNewServiceName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddService();
                      }}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setAddDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddService}
                    disabled={!newServiceName.trim() || addMutation.isPending}
                  >
                    {addMutation.isPending && (
                      <Spinner className="h-4 w-4 mr-2" />
                    )}
                    Add
                  </Button>
                </DialogFooter>
                {addMutation.isError && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {addMutation.error instanceof Error
                        ? addMutation.error.message
                        : "Failed to add service"}
                    </AlertDescription>
                  </Alert>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {configsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="h-6 w-6" />
          </div>
        ) : !configs || configs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Server className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No services configured for monitoring.</p>
            <p className="text-sm mt-1">
              Click "Add Service" to start monitoring a service.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Check</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.map((config) => {
                const latestStatus = getLatestStatus(config.serviceName);
                return (
                  <TableRow key={config.id}>
                    <TableCell className="font-mono">
                      {config.serviceName}
                    </TableCell>
                    <TableCell>
                      {latestStatus ? (
                        <Badge variant={getStatusBadgeVariant(latestStatus.state)}>
                          {latestStatus.state}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Unknown</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {latestStatus
                        ? formatRelativeTime(latestStatus.timestamp)
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={config.enabled}
                        onCheckedChange={() => handleToggleEnabled(config)}
                        disabled={updateMutation.isPending}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <ConfirmationModal
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={!isOnline}
                              title="Restart service"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          }
                          title="Restart Service"
                          message={`Are you sure you want to restart "${config.serviceName}"? This may cause temporary service interruption.`}
                          confirmText="Restart"
                          isDestructive
                          isLoading={restartMutation.isPending}
                          onConfirm={async () => {
                            await restartMutation.mutateAsync(config.serviceName);
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(config)}
                          title="Edit service"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <ConfirmationModal
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete service"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          }
                          title="Delete Service Monitor"
                          message={`Are you sure you want to stop monitoring "${config.serviceName}"? This will not affect the service itself.`}
                          confirmText="Delete"
                          isDestructive
                          isLoading={deleteMutation.isPending}
                          onConfirm={async () => {
                            await deleteMutation.mutateAsync(config.id);
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Service</DialogTitle>
              <DialogDescription>
                Update the service name for this monitor.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="editServiceName">Service Name</Label>
                <Input
                  id="editServiceName"
                  value={editServiceName}
                  onChange={(e) => setEditServiceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEditService();
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleEditService}
                disabled={!editServiceName.trim() || updateMutation.isPending}
              >
                {updateMutation.isPending && <Spinner className="h-4 w-4 mr-2" />}
                Save
              </Button>
            </DialogFooter>
            {updateMutation.isError && (
              <Alert variant="destructive" className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {updateMutation.error instanceof Error
                    ? updateMutation.error.message
                    : "Failed to update service"}
                </AlertDescription>
              </Alert>
            )}
          </DialogContent>
        </Dialog>

        {!isOnline && (
          <p className="text-xs text-muted-foreground mt-4">
            ⚠️ Service actions are only available when the node is online.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
