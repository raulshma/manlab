/**
 * RemoteFileBrowser - Remote file browser with full-system access.
 *
 * Uses @cubone/react-file-manager for the UI.
 * Session is created server-side (no policy allowlist) and is short-lived.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileManager } from "@cubone/react-file-manager";
import "@cubone/react-file-manager/dist/style.css";

import {
  createSystemFileBrowserSession,
  listFileBrowserEntries,
  readFileBrowserContent,
} from "@/api";

import type { FileBrowserEntry } from "@/types";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

import { AlertCircle, Clock, Download, Folder } from "lucide-react";

type SystemFileBrowserSession = {
  sessionId: string;
  nodeId: string;
  rootPath: string;
  maxBytesPerRead: number;
  expiresAt: string;
};

interface RemoteFileBrowserProps {
  nodeId: string;
  nodeStatus?: string;
  /**
   * Auto-open a system session when nodeId changes and node is online.
   * Defaults to true (matches "click node => show file browser").
   */
  autoOpen?: boolean;
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

export function RemoteFileBrowser({
  nodeId,
  nodeStatus = "Online",
  autoOpen = true,
}: RemoteFileBrowserProps) {
  const queryClient = useQueryClient();

  const isOnline = nodeStatus === "Online";

  const [session, setSession] = useState<SystemFileBrowserSession | null>(null);
  const [expiryCountdown, setExpiryCountdown] = useState<string>("");
  const [openError, setOpenError] = useState<string | null>(null);
  const [autoOpenBlocked, setAutoOpenBlocked] = useState<boolean>(false);
  const autoOpenAttemptedForNodeIdRef = useRef<string | null>(null);

  // Navigation/path in the remote virtual FS.
  const [currentPath, setCurrentPath] = useState<string>("/");

  // File preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState<string>("");
  const [previewPath, setPreviewPath] = useState<string>("");
  const [previewText, setPreviewText] = useState<string>("");
  const [previewTruncated, setPreviewTruncated] = useState<boolean>(false);

  // Reset session when node changes
  useEffect(() => {
    setSession(null);
    setCurrentPath("/");
    setOpenError(null);
    setAutoOpenBlocked(false);
    autoOpenAttemptedForNodeIdRef.current = null;
  }, [nodeId]);

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
    mutationFn: async () => {
      const resp = await createSystemFileBrowserSession(nodeId);
      return resp as SystemFileBrowserSession;
    },
    onSuccess: (newSession) => {
      setSession(newSession);
      setCurrentPath(newSession.rootPath || "/");
      setOpenError(null);
      setAutoOpenBlocked(false);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to open file browser";
      setOpenError(msg);

      // If the server is denying access because the agent hasn't enabled the feature,
      // stop auto-open attempts until the user explicitly retries.
      if (
        /file browser feature is disabled|feature is not available|agent has not reported its capabilities/i.test(msg)
      ) {
        setAutoOpenBlocked(true);
      }

      toast.error(msg);
    },
  });

  // Auto-open when online
  useEffect(() => {
    if (!autoOpen) return;
    if (!isOnline) return;
    if (session) return;
    if (createSessionMutation.isPending) return;
    if (autoOpenBlocked) return;

    // Avoid duplicate calls in React StrictMode/dev double-invocation.
    if (autoOpenAttemptedForNodeIdRef.current === nodeId) return;
    autoOpenAttemptedForNodeIdRef.current = nodeId;

    createSessionMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, isOnline, nodeId, autoOpenBlocked]);

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

  const listTruncated = Boolean(listQuery.data?.truncated);

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

  const initialPathForUi = effectivePath === "/" ? "" : effectivePath;

  if (!isOnline) {
    return (
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Folder className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">File Browser</div>
            <div className="text-xs text-muted-foreground">Node is offline.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Folder className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">File Browser</div>
            <div className="text-xs text-muted-foreground">Direct system access (session-scoped)</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {session && (
            <Badge
              variant={expiryCountdown === "Expired" ? "destructive" : "outline"}
              className="flex items-center gap-1"
            >
              <Clock className="h-3 w-3" />
              {expiryCountdown}
            </Badge>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSession(null);
              setCurrentPath("/");
            }}
            disabled={!session}
          >
            Close
          </Button>

          <Button
            size="sm"
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending}
          >
            {createSessionMutation.isPending ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Opening…
              </>
            ) : (
              "Open"
            )}
          </Button>
        </div>
      </div>

      <div className="p-4">
        {!session ? (
          <div className="space-y-3">
            {createSessionMutation.isError && openError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="text-sm">{openError}</div>
                  {autoOpenBlocked && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      This node is online, but the agent is not allowing the file browser.
                      Enable it in the agent configuration (e.g. set <span className="font-mono">MANLAB_ENABLE_FILE_BROWSER=true</span>)
                      and restart the agent.
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="text-sm text-muted-foreground">Open a session to start browsing.</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Root: <span className="font-mono">{session.rootPath}</span> · Current:{" "}
              <span className="font-mono">{effectivePath}</span>
              {listTruncated && (
                <span className="ml-2 text-amber-600">(showing a bounded subset)</span>
              )}
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

            <div className="min-h-[70vh]">
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
                height="70vh"
                width="100%"
              />
            </div>
          </div>
        )}
      </div>

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
    </div>
  );
}
