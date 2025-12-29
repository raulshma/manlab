import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchNodeSettings,
  upsertNodeSettings,
  triggerSystemUpdate,
  shutdownSystem,
  restartSystem,
} from "../../api";
import { ConfirmationModal } from "../ConfirmationModal";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, Power } from "lucide-react";

interface NodeSettingsTabProps {
  nodeId: string;
  nodeStatus: string;
  hostname: string;
}

export function NodeSettingsTab({ nodeId, nodeStatus, hostname }: NodeSettingsTabProps) {
  const queryClient = useQueryClient();

  // Fetch per-node settings
  const { data: nodeSettings } = useQuery({
    queryKey: ["nodeSettings", nodeId],
    queryFn: () => fetchNodeSettings(nodeId),
    refetchInterval: 30000,
  });

  const currentChannel =
    nodeSettings?.find((s) => s.key === "agent.update.channel")?.value ??
    "stable";

  const updateChannelMutation = useMutation({
    mutationFn: (channel: string) =>
      upsertNodeSettings(nodeId, [
        {
          key: "agent.update.channel",
          value: channel,
          category: "Updates",
          description: "Distribution channel used for agent updates (stable/beta).",
        },
      ]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nodeSettings", nodeId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => triggerSystemUpdate(nodeId),
  });

  const systemShutdownMutation = useMutation({
    mutationFn: (delaySeconds: number = 0) =>
      shutdownSystem(nodeId, delaySeconds),
  });

  const systemRestartMutation = useMutation({
    mutationFn: (delaySeconds: number = 0) =>
      restartSystem(nodeId, delaySeconds),
  });

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
      {/* Update Settings */}
      <h2 className="text-lg font-semibold text-foreground">General Settings</h2>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-sm">Update Channel</CardTitle>
              <CardDescription>
                Controls which agent update track this node follows.
              </CardDescription>
            </div>
            <div className="min-w-45">
              <Select
                value={currentChannel}
                onValueChange={(value) => {
                  if (value === null) return;
                  updateChannelMutation.mutate(value);
                }}
                disabled={updateChannelMutation.isPending}
              >
                <SelectTrigger className="h-9 w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">stable</SelectItem>
                  <SelectItem value="beta">beta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {updateChannelMutation.isError && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {updateChannelMutation.error instanceof Error
                  ? updateChannelMutation.error.message
                  : "Failed to update channel"}
              </AlertDescription>
            </Alert>
          )}
          {updateChannelMutation.isSuccess && (
            <Alert className="mt-3">
              <AlertDescription>Update channel saved.</AlertDescription>
            </Alert>
          )}
        </CardHeader>
      </Card>

      {/* System Actions */}
      <h2 className="text-lg font-semibold text-foreground pt-4">System Actions</h2>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">System Update</CardTitle>
              <CardDescription>
                Run system package updates on this node.
              </CardDescription>
            </div>
            <ConfirmationModal
              trigger={
                <Button
                  variant="secondary"
                  disabled={nodeStatus !== "Online"}
                >
                  Update System
                </Button>
              }
              title="Confirm System Update"
              message={`Are you sure you want to run a system update on "${hostname}"? This may require a reboot and could cause temporary service interruption.`}
              confirmText="Run Update"
              isDestructive
              isLoading={updateMutation.isPending}
              onConfirm={async () => {
                await updateMutation.mutateAsync();
              }}
            />
          </div>
          {nodeStatus !== "Online" && (
            <p className="text-xs text-muted-foreground mt-3">
              ⚠️ System actions are only available when the node is online.
            </p>
          )}
        </CardHeader>
      </Card>

      {/* System Power Control */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Power className="h-4 w-4" />
                System Power Control
              </CardTitle>
              <CardDescription>
                Shutdown or restart the entire machine.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <ConfirmationModal
                trigger={
                  <Button
                    variant="destructive"
                    disabled={nodeStatus !== "Online"}
                  >
                    Shutdown
                  </Button>
                }
                title="Shutdown System"
                message={`Are you sure you want to SHUTDOWN the machine "${hostname}"? This will power off the machine and it will need to be manually powered back on or woken via Wake-on-LAN.`}
                confirmText="Shutdown Now"
                isDestructive
                isLoading={systemShutdownMutation.isPending}
                onConfirm={async () => {
                  await systemShutdownMutation.mutateAsync(0);
                }}
              />
              <ConfirmationModal
                trigger={
                  <Button
                    variant="secondary"
                    disabled={nodeStatus !== "Online"}
                  >
                    Restart
                  </Button>
                }
                title="Restart System"
                message={`Are you sure you want to RESTART the machine "${hostname}"? This will reboot the entire machine.`}
                confirmText="Restart Now"
                isDestructive
                isLoading={systemRestartMutation.isPending}
                onConfirm={async () => {
                  await systemRestartMutation.mutateAsync(0);
                }}
              />
            </div>
          </div>
          {(systemShutdownMutation.isSuccess || systemRestartMutation.isSuccess) && (
            <Alert className="mt-3">
              <AlertDescription>
                {systemShutdownMutation.isSuccess
                  ? "Shutdown command sent. Machine will shut down."
                  : "Restart command sent. Machine will reboot."}
              </AlertDescription>
            </Alert>
          )}
          {(systemShutdownMutation.isError || systemRestartMutation.isError) && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {systemShutdownMutation.error instanceof Error
                  ? systemShutdownMutation.error.message
                  : systemRestartMutation.error instanceof Error
                  ? systemRestartMutation.error.message
                  : "Failed to send power command"}
              </AlertDescription>
            </Alert>
          )}
        </CardHeader>
      </Card>
    </div>
  );
}
