import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPendingUpdates, approvePendingUpdate, approveSystemUpdate, rejectSystemUpdate } from "@/api";
import { toast } from "sonner";
import { CheckCircle, XCircle, Clock, Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PendingUpdatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PendingUpdatesModal({ open, onOpenChange }: PendingUpdatesModalProps) {
  const queryClient = useQueryClient();

  const { data: pendingData, isLoading } = useQuery({
    queryKey: ["pendingUpdates"],
    queryFn: fetchPendingUpdates,
    enabled: open,
  });

  const approveAgentMutation = useMutation({
    mutationFn: (nodeId: string) => approvePendingUpdate(nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pendingUpdates"] });
      toast.success("Agent update approved and started");
    },
    onError: (error: Error) => {
      toast.error(`Failed to approve agent update: ${error.message}`);
    },
  });

  const approveSystemMutation = useMutation({
    mutationFn: (updateId: string) => approveSystemUpdate(updateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pendingUpdates"] });
      toast.success("System update approved and started");
    },
    onError: (error: Error) => {
      toast.error(`Failed to approve system update: ${error.message}`);
    },
  });

  const rejectSystemMutation = useMutation({
    mutationFn: ({ updateId, reason }: { updateId: string; reason?: string }) =>
      rejectSystemUpdate(updateId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pendingUpdates"] });
      toast.success("System update rejected");
    },
    onError: (error: Error) => {
      toast.error(`Failed to reject system update: ${error.message}`);
    },
  });

  const agentCount = pendingData?.agentUpdates.length ?? 0;
  const systemCount = pendingData?.systemUpdates.length ?? 0;
  const hasUpdates = (agentCount + systemCount) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Pending Update Approvals</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasUpdates ? (
          <div className="flex flex-col items-center justify-center py-8">
            <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
            <p className="text-muted-foreground">No pending updates</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Tabs defaultValue={agentCount > 0 ? "agent" : "system"} className="space-y-4">
              <TabsList>
                <TabsTrigger value="agent">
                  Agent Updates
                  {agentCount > 0 && <Badge variant="secondary" className="ml-2">{agentCount}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="system">
                  System Updates
                  {systemCount > 0 && <Badge variant="secondary" className="ml-2">{systemCount}</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="agent" className="space-y-3 mt-4">
                {agentCount === 0 ? (
                  <div className="text-center text-muted-foreground py-4">
                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    <p className="text-sm">No pending agent updates</p>
                  </div>
                ) : (
                  pendingData?.agentUpdates.map((update) => (
                    <div key={update.nodeId} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-semibold">{update.hostname}</h4>
                          <p className="text-sm text-muted-foreground">Node ID: {update.nodeId}</p>
                        </div>
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Pending
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex-1">
                          <div className="text-xs text-muted-foreground mb-1">Current Version</div>
                          <div className="font-mono text-xs">{update.currentVersion}</div>
                        </div>
                        <div className="text-xl text-muted-foreground">→</div>
                        <div className="flex-1">
                          <div className="text-xs text-muted-foreground mb-1">Pending Version</div>
                          <div className="font-mono text-xs font-semibold text-green-600">
                            {update.pendingVersion}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-end">
                        <Button
                          onClick={() => approveAgentMutation.mutate(update.nodeId)}
                          disabled={approveAgentMutation.isPending}
                          size="sm"
                          className="gap-2"
                        >
                          {approveAgentMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle className="h-4 w-4" />
                          )}
                          Approve
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="system" className="space-y-3 mt-4">
                {systemCount === 0 ? (
                  <div className="text-center text-muted-foreground py-4">
                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    <p className="text-sm">No pending system updates</p>
                  </div>
                ) : (
                  pendingData?.systemUpdates.map((update) => (
                    <div key={update.updateId} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-semibold">{update.hostname}</h4>
                          <p className="text-sm text-muted-foreground">Node ID: {update.nodeId}</p>
                        </div>
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Pending
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">Type:</span>
                          <Badge variant="secondary">{update.updateType}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Packages:</span>
                          <span className="font-medium">{update.packageCount}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Created:</span>
                          <span>{new Date(update.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          onClick={() => approveSystemMutation.mutate(update.updateId)}
                          disabled={approveSystemMutation.isPending}
                          size="sm"
                          variant="default"
                          className="gap-2"
                        >
                          {approveSystemMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle className="h-4 w-4" />
                          )}
                          Approve
                        </Button>
                        <Button
                          onClick={() => rejectSystemMutation.mutate({ updateId: update.updateId })}
                          disabled={rejectSystemMutation.isPending}
                          size="sm"
                          variant="outline"
                          className="gap-2"
                        >
                          {rejectSystemMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
