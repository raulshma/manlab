/**
 * FileBrowserPanel - Legacy remote file browser (policy-based access).
 * Uses @cubone/react-file-manager for the UI.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileManager } from "@cubone/react-file-manager";
import "@cubone/react-file-manager/dist/style.css";

import { RemoteFileBrowser } from "@/components/RemoteFileBrowser";

import {
  fetchFileBrowserPolicies,
  upsertFileBrowserPolicy,
  deleteFileBrowserPolicy,
  createFileBrowserSession,
  listFileBrowserEntries,
  readFileBrowserContent,
} from "../api";

import type {
  FileBrowserPolicy,
  FileBrowserSession,
  FileBrowserEntry,
} from "../types";

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
import { ConfirmationModal } from "./ConfirmationModal";

import {
  AlertCircle,
  Clock,
  Folder,
  Plus,
  Settings,
  Trash2,
  Edit2,
  Download,
} from "lucide-react";

interface FileBrowserPanelProps {
  nodeId: string;
  nodeStatus?: string;
  /**
   * "panel": compact (Node Tools tab)
   * "page": future expansion
   */
  variant?: "panel" | "page";
}

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

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function downloadBytes(bytes: Uint8Array, filename: string, contentType: string) {
  // Materialize a real ArrayBuffer (not SharedArrayBuffer) for BlobPart typing.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function filenameFromPath(path: string): string {
  const parts = (path ?? "").split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? "file";
  return name.replace(/[^a-z0-9._-]+/gi, "-");
}

function isLikelyTextFile(name: string): boolean {
  const lower = (name ?? "").toLowerCase();
  return [
    ".txt",
    ".log",
    ".json",
    ".xml",
    ".yaml",
    ".yml",
    ".ini",
    ".conf",
    ".md",
    ".csv",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".cs",
    ".ps1",
    ".sh",
    ".bat",
    ".cmd",
    ".env",
  ].some((ext) => lower.endsWith(ext));
}

export function LegacyFileBrowserPanel({
  nodeId,
  nodeStatus = "Online",
  variant = "panel",
}: FileBrowserPanelProps) {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"browser" | "policies">("browser");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [session, setSession] = useState<FileBrowserSession | null>(null);
  const [expiryCountdown, setExpiryCountdown] = useState<string>("");

  // Navigation/path in the remote virtual FS.
  const [currentPath, setCurrentPath] = useState<string>("/");

  // Policy management
  const [addPolicyDialogOpen, setAddPolicyDialogOpen] = useState(false);
  const [editPolicyDialogOpen, setEditPolicyDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<FileBrowserPolicy | null>(null);
  const [newPolicyName, setNewPolicyName] = useState("");
  const [newPolicyRootPath, setNewPolicyRootPath] = useState("");
  const [newPolicyMaxBytes, setNewPolicyMaxBytes] = useState("32768");

  // File preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState<string>("");
  const [previewPath, setPreviewPath] = useState<string>("");
  const [previewText, setPreviewText] = useState<string>("");
  const [previewTruncated, setPreviewTruncated] = useState<boolean>(false);

  const isOnline = nodeStatus === "Online";

  const { data: policies, isLoading: policiesLoading } = useQuery({
    queryKey: ["fileBrowserPolicies", nodeId],
    queryFn: () => fetchFileBrowserPolicies(nodeId),
  });

  const selectedPolicy = useMemo(() => {
    if (!policies || !selectedPolicyId) return null;
    return policies.find((p) => p.id === selectedPolicyId) ?? null;
  }, [policies, selectedPolicyId]);

  // Expiry countdown timer
  useEffect(() => {
    if (!session) return;

    const updateCountdown = () => {
      const countdown = formatCountdown(session.expiresAt);
      setExpiryCountdown(countdown);
      if (countdown === "Expired") {
        setSession(null);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [session]);

  const createSessionMutation = useMutation({
    mutationFn: (policyId: string) => createFileBrowserSession(nodeId, policyId),
    onSuccess: (newSession) => {
      setSession(newSession);
      setCurrentPath(newSession.rootPath || "/");
      setActiveTab("browser");
    },
  });

  const effectivePath = useMemo(() => {
    // react-file-manager uses "" as root; we map that to "/".
    const p = (currentPath ?? "").trim();
    return p ? p : "/";
  }, [currentPath]);

  const listQuery = useQuery({
    queryKey: ["fileBrowserList", nodeId, session?.sessionId, effectivePath],
    queryFn: () => {
      if (!session) throw new Error("No session");
      return listFileBrowserEntries(nodeId, session.sessionId, effectivePath, 5000);
    },
    enabled: !!session,
    refetchOnWindowFocus: false,
  });

  const filesForUi = useMemo(() => {
    const entries: FileBrowserEntry[] = listQuery.data?.entries ?? [];

    return entries.map((f) => ({
      ...f,
      updatedAt: f.updatedAt ?? undefined,
      size: f.size ?? undefined,
    }));
  }, [listQuery.data]);

  const readMutation = useMutation({
    mutationFn: async (file: FileBrowserEntry) => {
      if (!session) throw new Error("No session");

      const name = filenameFromPath(file.path);

      // Text files: fetch a single chunk for preview.
      if (isLikelyTextFile(name)) {
        const resp = await readFileBrowserContent(
          nodeId,
          session.sessionId,
          file.path,
          session.maxBytesPerRead,
          0
        );
        return { mode: "preview" as const, name, resp };
      }

      // Binary files: fetch all chunks and download.
      const chunkSize = session.maxBytesPerRead || 32 * 1024;
      const chunks: Uint8Array[] = [];
      let offset = 0;

      for (let i = 0; i < 50_000; i++) {
        const resp = await readFileBrowserContent(
          nodeId,
          session.sessionId,
          file.path,
          chunkSize,
          offset
        );
        const result = resp.result;
        if (!result) {
          throw new Error(resp.error || "Failed to read file");
        }

        const bytesChunk = base64ToUint8Array(result.contentBase64 || "");
        chunks.push(bytesChunk);
        offset += bytesChunk.length;

        if (!result.truncated) break;
        if (bytesChunk.length === 0) {
          throw new Error("Agent returned an empty chunk while more data remained.");
        }
      }

      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const out = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) {
        out.set(c, pos);
        pos += c.length;
      }

      return { mode: "download" as const, name, bytes: out, path: file.path };
    },
    onSuccess: (data) => {
      if (data.mode === "preview") {
        const result = data.resp.result;
        if (!result) {
          throw new Error(data.resp.error || "Failed to read file");
        }

        const bytes = base64ToUint8Array(result.contentBase64 || "");
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        setPreviewTitle(data.name);
        setPreviewPath(result.path || "");
        setPreviewText(text);
        setPreviewTruncated(Boolean(result.truncated));
        setPreviewOpen(true);
        return;
      }

      downloadBytes(data.bytes, data.name, "application/octet-stream");
      toast.success(`Downloaded ${data.name}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to read file");
    },
  });

  const addPolicyMutation = useMutation({
    mutationFn: () =>
      upsertFileBrowserPolicy(nodeId, null, {
        displayName: newPolicyName,
        rootPath: newPolicyRootPath,
        maxBytesPerRead: parseInt(newPolicyMaxBytes, 10),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fileBrowserPolicies", nodeId] });
      setNewPolicyName("");
      setNewPolicyRootPath("");
      setNewPolicyMaxBytes("32768");
      setAddPolicyDialogOpen(false);
    },
  });

  const updatePolicyMutation = useMutation({
    mutationFn: () => {
      if (!editingPolicy) throw new Error("No policy to edit");
      return upsertFileBrowserPolicy(nodeId, editingPolicy.id, {
        displayName: newPolicyName,
        rootPath: newPolicyRootPath,
        maxBytesPerRead: parseInt(newPolicyMaxBytes, 10),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fileBrowserPolicies", nodeId] });
      setEditingPolicy(null);
      setEditPolicyDialogOpen(false);
    },
  });

  const deletePolicyMutation = useMutation({
    mutationFn: (policyId: string) => deleteFileBrowserPolicy(nodeId, policyId),
    onSuccess: (_data, policyId) => {
      queryClient.invalidateQueries({ queryKey: ["fileBrowserPolicies", nodeId] });
      if (selectedPolicyId && selectedPolicyId === policyId) {
        setSelectedPolicyId("");
      }
    },
  });

  const handleStartBrowsing = () => {
    if (!selectedPolicyId) return;
    createSessionMutation.mutate(selectedPolicyId);
  };

  const initialPathForUi = effectivePath === "/" ? "" : effectivePath;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">File Browser</CardTitle>
              <CardDescription>
                Browse remote files (policy-based, session-scoped)
              </CardDescription>
            </div>
          </div>
          {session && (
            <Badge
              variant={expiryCountdown === "Expired" ? "destructive" : "outline"}
              className="flex items-center gap-1"
            >
              <Clock className="h-3 w-3" />
              {expiryCountdown}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "browser" | "policies")}>
          <TabsList className="mb-4">
            <TabsTrigger value="browser">Browser</TabsTrigger>
            <TabsTrigger value="policies">
              <Settings className="h-4 w-4 mr-1" />
              Policies
            </TabsTrigger>
          </TabsList>

          <TabsContent value="browser">
            {!session ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Select value={selectedPolicyId} onValueChange={(v) => setSelectedPolicyId(v ?? "")}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {selectedPolicy
                          ? `${selectedPolicy.displayName} (${selectedPolicy.rootPath})`
                          : "Select a policy…"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(policies ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.displayName} ({p.rootPath})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    onClick={handleStartBrowsing}
                    disabled={!isOnline || !selectedPolicyId || createSessionMutation.isPending}
                  >
                    {createSessionMutation.isPending ? (
                      <>
                        <Spinner className="h-4 w-4 mr-2" />
                        Opening…
                      </>
                    ) : (
                      <>Open</>
                    )}
                  </Button>
                </div>

                {(!policies || policies.length === 0) && !policiesLoading && (
                  <p className="text-sm text-muted-foreground">
                    No file browser policies configured. Go to the Policies tab to add one.
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

                {!isOnline && (
                  <p className="text-xs text-muted-foreground">
                    ⚠️ File browsing is only available when the node is online.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    Root: <span className="font-mono">{session.rootPath}</span> · Current:{" "}
                    <span className="font-mono">{effectivePath}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSession(null);
                      setCurrentPath("/");
                    }}
                  >
                    Close
                  </Button>
                </div>

                {(listQuery.isError || readMutation.isError) && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {listQuery.error instanceof Error
                        ? listQuery.error.message
                        : readMutation.error instanceof Error
                          ? readMutation.error.message
                          : "File browser error"}
                    </AlertDescription>
                  </Alert>
                )}

                <div className={variant === "page" ? "min-h-[70vh]" : "min-h-105"}>
                  <FileManager
                    files={filesForUi}
                    isLoading={listQuery.isFetching}
                    initialPath={initialPathForUi}
                    onFolderChange={(p: string) => setCurrentPath(p || "/")}
                    onFileOpen={(file: FileBrowserEntry) => {
                      if (file.isDirectory) {
                        setCurrentPath(file.path);
                        return;
                      }
                      readMutation.mutate(file);
                    }}
                    onRefresh={() => {
                      if (!session) return;
                      queryClient.invalidateQueries({
                        queryKey: ["fileBrowserList", nodeId, session.sessionId],
                      });
                    }}
                    onDownload={(items: FileBrowserEntry[]) => {
                      const first = items?.find((i) => !i.isDirectory);
                      if (!first) {
                        toast.error("Select a file to download.");
                        return;
                      }
                      if (items.length > 1) {
                        toast.message("Downloading one file at a time for now.");
                      }
                      readMutation.mutate(first);
                    }}
                    permissions={{
                      create: false,
                      upload: false,
                      move: false,
                      copy: false,
                      rename: false,
                      delete: false,
                      download: true,
                    }}
                    enableFilePreview={false}
                    layout="list"
                    height={variant === "page" ? "70vh" : 420}
                    width="100%"
                  />
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="policies">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Allowlist roots as virtual paths (Unix: <span className="font-mono">/var/log</span>, Windows:
                  <span className="font-mono"> /C/Users</span>)
                </div>

                <Dialog open={addPolicyDialogOpen} onOpenChange={setAddPolicyDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Policy
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add File Browser Policy</DialogTitle>
                      <DialogDescription>
                        Configure access to a folder tree on this node.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="fbPolicyName">Display Name</Label>
                        <Input
                          id="fbPolicyName"
                          placeholder="e.g., Home" 
                          value={newPolicyName}
                          onChange={(e) => setNewPolicyName(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="fbPolicyRoot">Root Path (virtual)</Label>
                        <Input
                          id="fbPolicyRoot"
                          placeholder="e.g., /home/user or /C/Users"
                          className="font-mono"
                          value={newPolicyRootPath}
                          onChange={(e) => setNewPolicyRootPath(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="fbPolicyMax">Max Bytes Per Read</Label>
                        <Input
                          id="fbPolicyMax"
                          placeholder="262144"
                          className="font-mono"
                          value={newPolicyMaxBytes}
                          onChange={(e) => setNewPolicyMaxBytes(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          This is a per-request bound for file reads.
                        </p>
                      </div>
                    </div>

                    <DialogFooter>
                      <Button
                        onClick={() => addPolicyMutation.mutate()}
                        disabled={addPolicyMutation.isPending}
                      >
                        {addPolicyMutation.isPending ? (
                          <>
                            <Spinner className="h-4 w-4 mr-2" />
                            Saving…
                          </>
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </DialogFooter>

                    {addPolicyMutation.isError && (
                      <Alert variant="destructive" className="mt-2">
                        <AlertDescription>
                          {addPolicyMutation.error instanceof Error
                            ? addPolicyMutation.error.message
                            : "Failed to save policy"}
                        </AlertDescription>
                      </Alert>
                    )}
                  </DialogContent>
                </Dialog>
              </div>

              <div className="space-y-2">
                {(policies ?? []).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.displayName}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {p.rootPath} · max {p.maxBytesPerRead} bytes
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingPolicy(p);
                          setNewPolicyName(p.displayName);
                          setNewPolicyRootPath(p.rootPath);
                          setNewPolicyMaxBytes(String(p.maxBytesPerRead));
                          setEditPolicyDialogOpen(true);
                        }}
                      >
                        <Edit2 className="h-4 w-4 mr-1" />
                        Edit
                      </Button>

                      <ConfirmationModal
                        title="Delete Policy?"
                        message="This removes the allowlist entry. Existing sessions will expire normally."
                        trigger={
                          <Button variant="destructive" size="sm">
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        }
                        confirmText="Delete"
                        isDestructive
                        onConfirm={() => deletePolicyMutation.mutate(p.id)}
                      />
                    </div>
                  </div>
                ))}

                {(!policies || policies.length === 0) && !policiesLoading && (
                  <div className="text-sm text-muted-foreground">No policies yet.</div>
                )}
              </div>

              <Dialog open={editPolicyDialogOpen} onOpenChange={setEditPolicyDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Policy</DialogTitle>
                    <DialogDescription>Update the allowlisted root and limits.</DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="fbPolicyNameEdit">Display Name</Label>
                      <Input
                        id="fbPolicyNameEdit"
                        value={newPolicyName}
                        onChange={(e) => setNewPolicyName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="fbPolicyRootEdit">Root Path (virtual)</Label>
                      <Input
                        id="fbPolicyRootEdit"
                        className="font-mono"
                        value={newPolicyRootPath}
                        onChange={(e) => setNewPolicyRootPath(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="fbPolicyMaxEdit">Max Bytes Per Read</Label>
                      <Input
                        id="fbPolicyMaxEdit"
                        className="font-mono"
                        value={newPolicyMaxBytes}
                        onChange={(e) => setNewPolicyMaxBytes(e.target.value)}
                      />
                    </div>
                  </div>

                  <DialogFooter>
                    <Button
                      onClick={() => updatePolicyMutation.mutate()}
                      disabled={updatePolicyMutation.isPending}
                    >
                      {updatePolicyMutation.isPending ? (
                        <>
                          <Spinner className="h-4 w-4 mr-2" />
                          Saving…
                        </>
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </DialogFooter>

                  {updatePolicyMutation.isError && (
                    <Alert variant="destructive" className="mt-2">
                      <AlertDescription>
                        {updatePolicyMutation.error instanceof Error
                          ? updatePolicyMutation.error.message
                          : "Failed to update policy"}
                      </AlertDescription>
                    </Alert>
                  )}
                </DialogContent>
              </Dialog>

              {deletePolicyMutation.isError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {deletePolicyMutation.error instanceof Error
                      ? deletePolicyMutation.error.message
                      : "Failed to delete policy"}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between gap-2">
                <span className="truncate">{previewTitle}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!session) return;
                    const path = previewPath || "";
                    if (!path) {
                      const bytes = new TextEncoder().encode(previewText);
                      downloadBytes(bytes, previewTitle || "file.txt", "text/plain;charset=utf-8");
                      return;
                    }

                    try {
                      const chunkSize = session.maxBytesPerRead || 32 * 1024;
                      const chunks: Uint8Array[] = [];
                      let offset = 0;

                      for (let i = 0; i < 50_000; i++) {
                        const resp = await readFileBrowserContent(
                          nodeId,
                          session.sessionId,
                          path,
                          chunkSize,
                          offset
                        );
                        const result = resp.result;
                        if (!result) throw new Error(resp.error || "Failed to read file");

                        const bytesChunk = base64ToUint8Array(result.contentBase64 || "");
                        chunks.push(bytesChunk);
                        offset += bytesChunk.length;

                        if (!result.truncated) break;
                        if (bytesChunk.length === 0) {
                          throw new Error("Agent returned an empty chunk while more data remained.");
                        }
                      }

                      const total = chunks.reduce((sum, c) => sum + c.length, 0);
                      const out = new Uint8Array(total);
                      let pos = 0;
                      for (const c of chunks) {
                        out.set(c, pos);
                        pos += c.length;
                      }

                      downloadBytes(out, previewTitle || "file.txt", "application/octet-stream");
                      toast.success(`Downloaded ${previewTitle || "file"}`);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed to download file");
                    }
                  }}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
              </DialogTitle>
              <DialogDescription>
                {previewTruncated ? "Preview is truncated to the configured max bytes." : ""}
              </DialogDescription>
            </DialogHeader>

            <pre className="max-h-[60vh] overflow-auto rounded bg-muted/30 p-3 text-xs whitespace-pre-wrap">
              {previewText}
            </pre>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/**
 * FileBrowserPanel is now a thin wrapper around the system-session based browser.
 *
 * The older policy-based UI is still available as `LegacyFileBrowserPanel`, but
 * the product path is the dedicated `/files` page + direct system sessions.
 */
export function FileBrowserPanel({
  nodeId,
  nodeStatus = "Online",
}: FileBrowserPanelProps) {
  return <RemoteFileBrowser nodeId={nodeId} nodeStatus={nodeStatus} autoOpen />;
}
