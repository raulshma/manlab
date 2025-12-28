/**
 * LogViewerPanel - Remote log viewer with policy-based access.
 * Allows viewing log files on nodes using configured policies.
 */

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchLogViewerPolicies,
  upsertLogViewerPolicy,
  deleteLogViewerPolicy,
  createLogViewerSession,
  readLogContent,
  tailLogContent,
} from "../api";
import type { LogViewerPolicy, LogViewerSession } from "../types";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmationModal } from "./ConfirmationModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  Plus,
  FileText,
  Trash2,
  Edit2,
  Clock,
  Settings,
} from "lucide-react";

interface LogViewerPanelProps {
  nodeId: string;
  nodeStatus?: string;
}

// Helper to format countdown timer
function formatCountdown(expiresAt: string): string {
  const expiresDate = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiresDate.getTime() - now.getTime();

  if (diffMs <= 0) return "Expired";

  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function LogViewerPanel({
  nodeId,
  nodeStatus = "Online",
}: LogViewerPanelProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"viewer" | "policies">("viewer");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [session, setSession] = useState<LogViewerSession | null>(null);
  const [logContent, setLogContent] = useState<string>("");
  const [viewMode, setViewMode] = useState<"read" | "tail">("read");
  const [expiryCountdown, setExpiryCountdown] = useState<string>("");

  // Keep UI buffers bounded to avoid runaway memory usage.
  const MAX_LOG_BUFFER_CHARS = 100 * 1024;
  const truncateTail = (text: string) =>
    text.length > MAX_LOG_BUFFER_CHARS
      ? "[...output truncated...]\n" + text.slice(-MAX_LOG_BUFFER_CHARS)
      : text;

  // Policy management
  const [addPolicyDialogOpen, setAddPolicyDialogOpen] = useState(false);
  const [editPolicyDialogOpen, setEditPolicyDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<LogViewerPolicy | null>(null);
  const [newPolicyName, setNewPolicyName] = useState("");
  const [newPolicyPath, setNewPolicyPath] = useState("");
  const [newPolicyMaxBytes, setNewPolicyMaxBytes] = useState("65536");

  const logContentRef = useRef<HTMLPreElement>(null);

  // Fetch policies
  const { data: policies, isLoading: policiesLoading } = useQuery({
    queryKey: ["logViewerPolicies", nodeId],
    queryFn: () => fetchLogViewerPolicies(nodeId),
  });

  // One-click helper: create/select the built-in agent self-log policy.
  // The agent resolves the pseudo-path "@agent" to its own log file.
  const ensureAgentPolicyMutation = useMutation({
    mutationFn: async () => {
      const existing = policies?.find((p) => p.path === "@agent");
      if (existing) return existing;

      return upsertLogViewerPolicy(nodeId, null, {
        displayName: "ManLab Agent",
        path: "@agent",
        maxBytesPerRequest: 65536,
      });
    },
    onSuccess: (policy) => {
      queryClient.invalidateQueries({ queryKey: ["logViewerPolicies", nodeId] });
      setSelectedPolicyId(policy.id);
      setActiveTab("viewer");
    },
  });

  // Expiry countdown timer - uses interval to update countdown, not sync setState
  useEffect(() => {
    if (!session) return;

    const updateCountdown = () => {
      const countdown = formatCountdown(session.expiresAt);
      setExpiryCountdown(countdown);
      if (countdown === "Expired") {
        setSession(null);
        setLogContent("");
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [session]);

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: (policyId: string) => createLogViewerSession(nodeId, policyId),
    onSuccess: (newSession) => {
      setSession(newSession);
      setLogContent("");
    },
  });

  // Read log mutation
  const readMutation = useMutation({
    mutationFn: () => {
      if (!session) throw new Error("No session");
      return readLogContent(nodeId, session.sessionId);
    },
    onSuccess: (response) => {
      setLogContent(truncateTail(response.content ?? ""));
      if (logContentRef.current) {
        logContentRef.current.scrollTop = logContentRef.current.scrollHeight;
      }
    },
  });

  // Tail log mutation
  const tailMutation = useMutation({
    mutationFn: () => {
      if (!session) throw new Error("No session");
      return tailLogContent(nodeId, session.sessionId, undefined, 10);
    },
    onSuccess: (response) => {
      setLogContent((prev) => {
        const combined = prev + (response.content ?? "");
        return truncateTail(combined);
      });
      if (logContentRef.current) {
        logContentRef.current.scrollTop = logContentRef.current.scrollHeight;
      }
    },
  });

  // Policy CRUD mutations
  const addPolicyMutation = useMutation({
    mutationFn: () =>
      upsertLogViewerPolicy(nodeId, null, {
        displayName: newPolicyName,
        path: newPolicyPath,
        maxBytesPerRequest: parseInt(newPolicyMaxBytes, 10),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logViewerPolicies", nodeId] });
      setNewPolicyName("");
      setNewPolicyPath("");
      setNewPolicyMaxBytes("65536");
      setAddPolicyDialogOpen(false);
    },
  });

  const updatePolicyMutation = useMutation({
    mutationFn: () => {
      if (!editingPolicy) throw new Error("No policy to edit");
      return upsertLogViewerPolicy(nodeId, editingPolicy.id, {
        displayName: newPolicyName,
        path: newPolicyPath,
        maxBytesPerRequest: parseInt(newPolicyMaxBytes, 10),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logViewerPolicies", nodeId] });
      setEditingPolicy(null);
      setEditPolicyDialogOpen(false);
    },
  });

  const deletePolicyMutation = useMutation({
    mutationFn: (policyId: string) => deleteLogViewerPolicy(nodeId, policyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["logViewerPolicies", nodeId] });
    },
  });

  const handleStartViewing = () => {
    if (selectedPolicyId) {
      createSessionMutation.mutate(selectedPolicyId);
    }
  };

  const handleRead = () => {
    setViewMode("read");
    readMutation.mutate();
  };

  const handleTail = () => {
    setViewMode("tail");
    tailMutation.mutate();
  };

  const openEditPolicyDialog = (policy: LogViewerPolicy) => {
    setEditingPolicy(policy);
    setNewPolicyName(policy.displayName);
    setNewPolicyPath(policy.path);
    setNewPolicyMaxBytes(policy.maxBytesPerRequest.toString());
    setEditPolicyDialogOpen(true);
  };

  const isOnline = nodeStatus === "Online";
  const isLoading = readMutation.isPending || tailMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Log Viewer</CardTitle>
              <CardDescription>
                View log files from this node using configured policies
              </CardDescription>
            </div>
          </div>
          {session && (
            <Badge variant="outline" className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {expiryCountdown}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "viewer" | "policies")}>
          <TabsList className="mb-4">
            <TabsTrigger value="viewer">Viewer</TabsTrigger>
            <TabsTrigger value="policies">
              <Settings className="h-4 w-4 mr-1" />
              Policies
            </TabsTrigger>
          </TabsList>

          <TabsContent value="viewer">
            {!session ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Select
                    value={selectedPolicyId}
                    onValueChange={(v) => setSelectedPolicyId(v ?? "")}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue>
                        {selectedPolicyId
                          ? policies?.find((p) => p.id === selectedPolicyId)?.displayName ?? "Select a log policy..."
                          : "Select a log policy..."}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {policies?.map((policy) => (
                        <SelectItem key={policy.id} value={policy.id}>
                          {policy.displayName} ({policy.path})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleStartViewing}
                    disabled={
                      !selectedPolicyId ||
                      !isOnline ||
                      createSessionMutation.isPending
                    }
                  >
                    {createSessionMutation.isPending && (
                      <Spinner className="h-4 w-4 mr-2" />
                    )}
                    View Log
                  </Button>
                </div>
                {(!policies || policies.length === 0) && !policiesLoading && (
                  <p className="text-sm text-muted-foreground">
                    No log policies configured. Go to the Policies tab to add one.
                  </p>
                )}
                {createSessionMutation.isError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {createSessionMutation.error instanceof Error
                        ? createSessionMutation.error.message
                        : "Failed to create session"}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{session.displayName}</Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      {session.path}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={viewMode === "read" ? "default" : "outline"}
                      size="sm"
                      onClick={handleRead}
                      disabled={isLoading}
                    >
                      {readMutation.isPending && <Spinner className="h-3 w-3 mr-1" />}
                      Read
                    </Button>
                    <Button
                      variant={viewMode === "tail" ? "default" : "outline"}
                      size="sm"
                      onClick={handleTail}
                      disabled={isLoading}
                    >
                      {tailMutation.isPending && <Spinner className="h-3 w-3 mr-1" />}
                      Tail
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSession(null);
                        setLogContent("");
                      }}
                    >
                      Close
                    </Button>
                  </div>
                </div>
                <pre
                  ref={logContentRef}
                  className="bg-muted p-4 rounded-lg text-xs font-mono whitespace-pre-wrap overflow-auto max-h-96 min-h-48"
                >
                  {logContent || (
                    <span className="text-muted-foreground">
                      Click "Read" or "Tail" to load log content...
                    </span>
                  )}
                </pre>
                {(readMutation.isError || tailMutation.isError) && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {(readMutation.error || tailMutation.error) instanceof Error
                        ? (readMutation.error || tailMutation.error)?.message
                        : "Failed to load log content"}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="policies">
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="mr-2"
                  onClick={() => ensureAgentPolicyMutation.mutate()}
                  disabled={ensureAgentPolicyMutation.isPending}
                >
                  {ensureAgentPolicyMutation.isPending && (
                    <Spinner className="h-4 w-4 mr-2" />
                  )}
                  ManLab Agent Logs
                </Button>
                <Dialog open={addPolicyDialogOpen} onOpenChange={setAddPolicyDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Policy
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Log Viewer Policy</DialogTitle>
                      <DialogDescription>
                        Configure access to a log file on this node.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="policyName">Display Name</Label>
                        <Input
                          id="policyName"
                          placeholder="e.g., System Logs"
                          value={newPolicyName}
                          onChange={(e) => setNewPolicyName(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="policyPath">File Path</Label>
                        <Input
                          id="policyPath"
                          placeholder="e.g., /var/log/syslog"
                          className="font-mono"
                          value={newPolicyPath}
                          onChange={(e) => setNewPolicyPath(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="policyMaxBytes">Max Bytes per Request</Label>
                        <Input
                          id="policyMaxBytes"
                          type="number"
                          value={newPolicyMaxBytes}
                          onChange={(e) => setNewPolicyMaxBytes(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setAddPolicyDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={() => addPolicyMutation.mutate()}
                        disabled={
                          !newPolicyName.trim() ||
                          !newPolicyPath.trim() ||
                          addPolicyMutation.isPending
                        }
                      >
                        {addPolicyMutation.isPending && <Spinner className="h-4 w-4 mr-2" />}
                        Add
                      </Button>
                    </DialogFooter>
                    {addPolicyMutation.isError && (
                      <Alert variant="destructive" className="mt-2">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          {addPolicyMutation.error instanceof Error
                            ? addPolicyMutation.error.message
                            : "Failed to add policy"}
                        </AlertDescription>
                      </Alert>
                    )}
                  </DialogContent>
                </Dialog>
              </div>

              {policiesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : !policies || policies.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No log viewer policies configured.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {policies.map((policy) => (
                    <div
                      key={policy.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div>
                        <div className="font-medium">{policy.displayName}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {policy.path}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditPolicyDialog(policy)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <ConfirmationModal
                          trigger={
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          }
                          title="Delete Policy"
                          message={`Are you sure you want to delete the policy "${policy.displayName}"?`}
                          confirmText="Delete"
                          isDestructive
                          isLoading={deletePolicyMutation.isPending}
                          onConfirm={async () => {
                            await deletePolicyMutation.mutateAsync(policy.id);
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {ensureAgentPolicyMutation.isError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {ensureAgentPolicyMutation.error instanceof Error
                      ? ensureAgentPolicyMutation.error.message
                      : "Failed to create agent log policy"}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Edit Policy Dialog */}
        <Dialog open={editPolicyDialogOpen} onOpenChange={setEditPolicyDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Policy</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="editPolicyName">Display Name</Label>
                <Input
                  id="editPolicyName"
                  value={newPolicyName}
                  onChange={(e) => setNewPolicyName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="editPolicyPath">File Path</Label>
                <Input
                  id="editPolicyPath"
                  className="font-mono"
                  value={newPolicyPath}
                  onChange={(e) => setNewPolicyPath(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="editPolicyMaxBytes">Max Bytes per Request</Label>
                <Input
                  id="editPolicyMaxBytes"
                  type="number"
                  value={newPolicyMaxBytes}
                  onChange={(e) => setNewPolicyMaxBytes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPolicyDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => updatePolicyMutation.mutate()}
                disabled={
                  !newPolicyName.trim() ||
                  !newPolicyPath.trim() ||
                  updatePolicyMutation.isPending
                }
              >
                {updatePolicyMutation.isPending && <Spinner className="h-4 w-4 mr-2" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {!isOnline && (
          <p className="text-xs text-muted-foreground mt-4">
            ⚠️ Log viewing is only available when the node is online.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
