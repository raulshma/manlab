import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertCircle,
  RefreshCw,
  Shield,
  Package,
  Settings,
  AlertTriangle,
} from "lucide-react";
import {
  fetchSystemUpdateSettings,
  updateSystemUpdateSettings,
  checkSystemUpdates,
  createSystemUpdate,
} from "@/api";
import type {
  SystemUpdateSettings,
  SystemUpdateAvailability,
} from "@/types";
import { useConfirm } from "@/hooks/useConfirm";

interface SystemUpdateSettingsPanelProps {
  nodeId: string;
}

export function SystemUpdateSettingsPanel({ nodeId }: SystemUpdateSettingsPanelProps) {
  const { data: settings, isLoading } = useSWR(
    ["systemUpdate", nodeId],
    () => fetchSystemUpdateSettings(nodeId),
    { refreshInterval: 30000 }
  );

  const { data: availability, mutate: mutateAvailability } = useSWR<SystemUpdateAvailability | null>(
    settings?.enabled ? ["systemUpdateAvailability", nodeId] : null,
    () => checkSystemUpdates(nodeId),
    { refreshInterval: 60000 }
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [localSettings, setLocalSettings] = useState<SystemUpdateSettings | null>(null);
  const { alert, alertState, handleAlertConfirm } = useConfirm();

  const handleSave = async () => {
    if (!localSettings) return;
    setIsSaving(true);
    try {
      await updateSystemUpdateSettings(nodeId, localSettings);
      mutate(["systemUpdate", nodeId]);
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheck = async () => {
    setIsChecking(true);
    try {
      const result = await checkSystemUpdates(nodeId);
      mutateAvailability(result);
    } catch (error) {
      console.error("Failed to check updates:", error);
    } finally {
      setIsChecking(false);
    }
  };

  const handleCreateUpdate = async () => {
    try {
      await createSystemUpdate(nodeId, {
        includeSecurityUpdates: settings?.includeSecurityUpdates,
        includeFeatureUpdates: settings?.includeFeatureUpdates,
        includeDriverUpdates: settings?.includeDriverUpdates,
      });
      mutate(["systemUpdate", nodeId]);
    } catch (error: unknown) {
      console.error("Failed to create update:", error);
      await alert({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create update",
        confirmText: "OK",
      });
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading system update settings...</div>;
  }

  if (!settings) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load system update settings</AlertDescription>
      </Alert>
    );
  }

  const currentSettings = localSettings || settings;

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>System Updates</CardTitle>
              <CardDescription>
                Manage automatic operating system updates for this node
              </CardDescription>
            </div>
            <Switch
              checked={currentSettings.enabled}
              onCheckedChange={(checked) => {
                const updated = { ...currentSettings, enabled: checked };
                setLocalSettings(updated);
                updateSystemUpdateSettings(nodeId, updated).then(() => {
                  mutate(["systemUpdate", nodeId]);
                  setLocalSettings(null);
                });
              }}
            />
          </div>
        </CardHeader>
      </Card>

      {currentSettings.enabled && (
        <>
          {/* Available Updates Alert */}
          {availability && availability.hasUpdates && (
            <Alert className="border-blue-200 bg-blue-50">
              <Package className="h-4 w-4" />
              <AlertDescription className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <strong>Updates Available</strong>
                    <p className="text-sm mt-1">
                      {availability.packages.length} package(s) available
                      {availability.securityUpdates > 0 && (
                        <span className="ml-2">
                          <Badge variant="destructive" className="text-xs">
                            {availability.securityUpdates} security
                          </Badge>
                        </span>
                      )}
                    </p>
                  </div>
                  <Button onClick={handleCreateUpdate} size="sm">
                    Create Update
                  </Button>
                </div>
                {availability.rebootRequired && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    A reboot is pending from a previous update
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Update Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Update Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Check Interval */}
              <div className="space-y-2">
                <Label htmlFor="checkInterval">Check Interval (minutes)</Label>
                <Input
                  id="checkInterval"
                  type="number"
                  min="30"
                  value={currentSettings.checkIntervalMinutes}
                  onChange={(e) =>
                    setLocalSettings({
                      ...currentSettings,
                      checkIntervalMinutes: Math.max(30, parseInt(e.target.value) || 30),
                    })
                  }
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  How often to check for available updates (minimum: 30 minutes)
                </p>
              </div>

              {/* Maintenance Window */}
              <div className="space-y-2">
                <Label htmlFor="maintenanceWindow">Maintenance Window (UTC)</Label>
                <Input
                  id="maintenanceWindow"
                  placeholder="HH:MM-HH:MM (e.g., 02:00-04:00)"
                  value={currentSettings.maintenanceWindow || ""}
                  onChange={(e) =>
                    setLocalSettings({ ...currentSettings, maintenanceWindow: e.target.value })
                  }
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Time window in UTC when updates are allowed (leave empty for any time)
                </p>
              </div>

              {/* Scheduled Day of Week */}
              <div className="space-y-2">
                <Label htmlFor="dayOfWeek">Scheduled Day</Label>
                <select
                  id="dayOfWeek"
                  className="w-full px-3 py-2 border rounded-md"
                  value={currentSettings.scheduledDayOfWeek ?? ""}
                  onChange={(e) =>
                    setLocalSettings({
                      ...currentSettings,
                      scheduledDayOfWeek: e.target.value === "" ? null : parseInt(e.target.value),
                    })
                  }
                  disabled={isSaving}
                >
                  <option value="">Any day</option>
                  <option value="0">Monday</option>
                  <option value="1">Tuesday</option>
                  <option value="2">Wednesday</option>
                  <option value="3">Thursday</option>
                  <option value="4">Friday</option>
                  <option value="5">Saturday</option>
                  <option value="6">Sunday</option>
                </select>
              </div>

              {/* Update Types */}
              <div className="space-y-3">
                <Label className="text-base">Update Types</Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="security"
                      checked={currentSettings.includeSecurityUpdates}
                      onCheckedChange={(checked) =>
                        setLocalSettings({ ...currentSettings, includeSecurityUpdates: !!checked })
                      }
                      disabled={isSaving}
                    />
                    <Label htmlFor="security" className="flex items-center gap-2 cursor-pointer">
                      <Shield className="h-4 w-4 text-red-500" />
                      Security updates
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="feature"
                      checked={currentSettings.includeFeatureUpdates}
                      onCheckedChange={(checked) =>
                        setLocalSettings({ ...currentSettings, includeFeatureUpdates: !!checked })
                      }
                      disabled={isSaving}
                    />
                    <Label htmlFor="feature" className="flex items-center gap-2 cursor-pointer">
                      <Package className="h-4 w-4 text-blue-500" />
                      Feature updates
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="driver"
                      checked={currentSettings.includeDriverUpdates}
                      onCheckedChange={(checked) =>
                        setLocalSettings({ ...currentSettings, includeDriverUpdates: !!checked })
                      }
                      disabled={isSaving}
                    />
                    <Label htmlFor="driver" className="flex items-center gap-2 cursor-pointer">
                      <RefreshCw className="h-4 w-4 text-green-500" />
                      Driver updates
                    </Label>
                  </div>
                </div>
              </div>

              {/* Auto-approve Settings */}
              <div className="space-y-3 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="autoApprove">Auto-approve Updates</Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically approve updates without manual intervention
                    </p>
                  </div>
                  <Switch
                    id="autoApprove"
                    checked={currentSettings.autoApproveUpdates}
                    onCheckedChange={(checked) =>
                      setLocalSettings({ ...currentSettings, autoApproveUpdates: checked })
                    }
                    disabled={isSaving}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="autoReboot">Auto-reboot if Needed</Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically reboot after updates if required
                    </p>
                  </div>
                  <Switch
                    id="autoReboot"
                    checked={currentSettings.autoRebootIfNeeded}
                    onCheckedChange={(checked) =>
                      setLocalSettings({ ...currentSettings, autoRebootIfNeeded: checked })
                    }
                    disabled={isSaving}
                  />
                </div>

                {/* Discord notification toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="discordNotification" className="flex items-center gap-2">
                      Discord Notifications
                    </Label>
                    {!currentSettings.discordNotificationsAvailable && (
                      <p className="text-xs text-muted-foreground">
                        Configure Discord notifications in global settings to enable per-node notifications
                      </p>
                    )}
                  </div>
                  <Switch
                    id="discordNotification"
                    checked={!currentSettings.disableDiscordNotification}
                    onCheckedChange={(checked) =>
                      setLocalSettings({ ...currentSettings, disableDiscordNotification: !checked })
                    }
                    disabled={isSaving || !currentSettings.discordNotificationsAvailable}
                  />
                </div>
              </div>

              {/* Manual Check Button */}
              <div className="pt-4 border-t">
                <Button
                  onClick={handleCheck}
                  disabled={isChecking}
                  variant="outline"
                  className="w-full"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isChecking ? "animate-spin" : ""}`} />
                  {isChecking ? "Checking..." : "Check for Updates"}
                </Button>
              </div>

              {/* Save Button */}
              {localSettings && (
                <div className="pt-4 border-t">
                  <Button onClick={handleSave} disabled={isSaving} className="w-full">
                    {isSaving ? "Saving..." : "Save Settings"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={alertState.isOpen} onOpenChange={(open) => !open && handleAlertConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alertState.title}</AlertDialogTitle>
            {alertState.description && (
              <AlertDialogDescription>{alertState.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleAlertConfirm}>
              {alertState.confirmText || "OK"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
