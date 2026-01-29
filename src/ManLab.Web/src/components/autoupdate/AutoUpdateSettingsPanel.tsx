/**
 * AutoUpdateSettingsPanel component for managing automatic agent updates.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Settings,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAutoUpdateSettings,
  updateAutoUpdateSettings,
  triggerAutoUpdateCheck,
  approvePendingUpdate,
  disableAutoUpdate,
} from "@/api";
import type { UpdateAutoUpdateSettingsRequest } from "@/types";

interface AutoUpdateSettingsPanelProps {
  nodeId: string;
}

export function AutoUpdateSettingsPanel({ nodeId }: AutoUpdateSettingsPanelProps) {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<string>("stable");
  const [maintenanceWindow, setMaintenanceWindow] = useState<string>("");
  const [approvalMode, setApprovalMode] = useState<"automatic" | "manual">("manual");
  const [disableDiscordNotification, setDisableDiscordNotification] = useState<boolean>(false);

  // Fetch auto-update settings
  const {
    data: settings,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["autoUpdate", nodeId],
    queryFn: () => fetchAutoUpdateSettings(nodeId),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Update settings mutation
  const updateMutation = useMutation({
    mutationFn: (newSettings: UpdateAutoUpdateSettingsRequest) =>
      updateAutoUpdateSettings(nodeId, newSettings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autoUpdate", nodeId] });
    },
  });

  // Trigger check mutation
  const checkMutation = useMutation({
    mutationFn: () => triggerAutoUpdateCheck(nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autoUpdate", nodeId] });
    },
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: () => approvePendingUpdate(nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autoUpdate", nodeId] });
    },
  });

  // Disable mutation
  const disableMutation = useMutation({
    mutationFn: () => disableAutoUpdate(nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autoUpdate", nodeId] });
    },
  });

  // Initialize form when settings load
  if (settings && !isLoading) {
    // Update local state when settings change
    if (channel !== settings.channel) setChannel(settings.channel);
    if (maintenanceWindow !== (settings.maintenanceWindow || "")) {
      setMaintenanceWindow(settings.maintenanceWindow || "");
    }
    if (approvalMode !== settings.approvalMode) {
      setApprovalMode(settings.approvalMode);
    }
    if (disableDiscordNotification !== (settings.disableDiscordNotification ?? false)) {
      setDisableDiscordNotification(settings.disableDiscordNotification ?? false);
    }
  }

  const handleSave = () => {
    updateMutation.mutate({
      enabled: true,
      channel,
      maintenanceWindow: maintenanceWindow || undefined,
      approvalMode,
      disableDiscordNotification,
    });
  };

  const handleToggle = (enabled: boolean) => {
    if (enabled) {
      updateMutation.mutate({
        enabled: true,
        channel,
        maintenanceWindow: maintenanceWindow || undefined,
        approvalMode,
        disableDiscordNotification,
      });
    } else {
      disableMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load auto-update settings.{" "}
          {error instanceof Error && error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (!settings) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>No auto-update settings found.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with enable toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Auto-Update Settings</h3>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={settings.enabled}
            onCheckedChange={handleToggle}
            disabled={updateMutation.isPending || disableMutation.isPending}
          />
          <Label className="text-sm text-muted-foreground">
            {settings.enabled ? "Enabled" : "Disabled"}
          </Label>
        </div>
      </div>

      {/* Pending update alert */}
      {settings.enabled && settings.pendingVersion && (
        <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
          <Clock className="h-4 w-4 text-blue-600" />
          <AlertDescription className="flex items-center justify-between">
            <div>
              <span className="font-medium">Update pending approval:</span>{" "}
              Version {settings.pendingVersion} is ready to install
            </div>
            <Button
              size="sm"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              Approve Update
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Last error alert */}
      {settings.enabled && settings.lastError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div>
              <span className="font-medium">Last update failed:</span>{" "}
              {settings.lastError}
            </div>
            {settings.failureCount > 0 && (
              <div className="text-xs mt-1 opacity-80">
                Failure count: {settings.failureCount}/5
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Settings */}
      {settings.enabled && (
        <div className="space-y-4 pl-8 border-l-2 border-muted">
          {/* Channel selection */}
          <div className="space-y-2">
            <Label htmlFor="channel">Update Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v ?? "stable")}>
              <SelectTrigger id="channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stable">Stable</SelectItem>
                <SelectItem value="beta">Beta</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Stable channel receives tested releases. Beta channel receives
              pre-release versions.
            </p>
          </div>

          {/* Maintenance window */}
          <div className="space-y-2">
            <Label htmlFor="maintenanceWindow">Maintenance Window (UTC)</Label>
            <Input
              id="maintenanceWindow"
              type="text"
              placeholder="e.g., 02:00-04:00"
              value={maintenanceWindow}
              onChange={(e) => setMaintenanceWindow(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional time window for updates in HH:MM-HH:MM format (UTC).
              Leave empty for any time.
            </p>
          </div>

          {/* Approval mode */}
          <div className="space-y-2">
            <Label htmlFor="approvalMode">Approval Mode</Label>
            <Select
              value={approvalMode}
              onValueChange={(v) => setApprovalMode(v as "automatic" | "manual")}
            >
              <SelectTrigger id="approvalMode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual Approval</SelectItem>
                <SelectItem value="automatic">Automatic</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {approvalMode === "manual"
                ? "Updates require manual approval before installation."
                : "Updates are installed automatically when available."}
            </p>
          </div>

          {/* Discord notification toggle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="discordNotification" className="flex items-center gap-2">
                  Discord Notifications
                </Label>
                {!settings.discordNotificationsAvailable && (
                  <p className="text-xs text-muted-foreground">
                    Configure Discord notifications in global settings to enable per-node notifications
                  </p>
                )}
              </div>
              <Switch
                id="discordNotification"
                checked={!disableDiscordNotification}
                onCheckedChange={(checked) => setDisableDiscordNotification(!checked)}
                disabled={updateMutation.isPending || !settings.discordNotificationsAvailable}
              />
            </div>
          </div>

          {/* Save button */}
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            size="sm"
          >
            {updateMutation.isPending ? (
              <>
                <Spinner className="w-4 h-4 mr-2" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </Button>
        </div>
      )}

      {/* Status information */}
      {settings.enabled && (
        <div className="pl-8 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>
              Last check:{" "}
              {settings.lastCheckAt
                ? new Date(settings.lastCheckAt).toLocaleString()
                : "Never"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle className="w-4 h-4" />
            <span>
              Last update:{" "}
              {settings.lastUpdateAt
                ? new Date(settings.lastUpdateAt).toLocaleString()
                : "Never"}
            </span>
          </div>
        </div>
      )}

      {/* Manual check button */}
      {settings.enabled && (
        <div className="pl-8">
          <Button
            variant="outline"
            size="sm"
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending}
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${checkMutation.isPending ? "animate-spin" : ""}`}
            />
            {checkMutation.isPending ? "Checking..." : "Check for Updates Now"}
          </Button>
        </div>
      )}
    </div>
  );
}
