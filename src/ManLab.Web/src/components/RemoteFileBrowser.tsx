/**
 * RemoteFileBrowser - Remote file browser with SSH/SFTP support.
 *
 * Uses @cubone/react-file-manager for the UI.
 * Prefers SSH/SFTP downloads using stored onboarding credentials when available.
 * Falls back to agent-based file browser when SSH is not configured.
 * 
 * Requirements: 8.1, 8.8 - Multi-select mode with checkbox selection
 * Requirements: 2.1, 2.2 - Download actions integration
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileManager } from "@cubone/react-file-manager";
import "@cubone/react-file-manager/dist/style.css";

import {
  createSystemFileBrowserSession,
  listFileBrowserEntries,
  readFileBrowserContent,
  fetchSshDownloadStatus,
  listSshFiles,
  downloadSshFile,
  downloadSshZip,
} from "@/api";

import type { FileBrowserEntry, SshDownloadStatusResponse, SshFileEntry } from "@/types";

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
import { FileBrowserSelectionToolbar } from "@/components/FileBrowserSelectionToolbar";
import { DownloadConfirmationDialog, type DownloadConfirmationRequest } from "@/components/DownloadConfirmationDialog";
import { useDownload } from "@/DownloadContext";
import { shouldShowConfirmation } from "@/lib/download-utils";

import { AlertCircle, Clock, Download, Folder, Server } from "lucide-react";

// Local storage key for selection preference on navigation
const SELECTION_PREFERENCE_KEY = "manlab:file_browser_preserve_selection";

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

/**
 * Selection state for multi-select mode.
 * Requirements: 8.1
 */
interface SelectionState {
  /** Set of selected file/folder paths */
  selectedPaths: Set<string>;
  /** Whether multi-select mode is active */
  selectionMode: boolean;
}

/**
 * Loads selection preference from localStorage.
 * Requirements: 8.8
 */
function loadSelectionPreference(): boolean {
  try {
    const stored = localStorage.getItem(SELECTION_PREFERENCE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

/**
 * Saves selection preference to localStorage.
 * Requirements: 8.8
 */
function saveSelectionPreference(preserve: boolean): void {
  try {
    localStorage.setItem(SELECTION_PREFERENCE_KEY, String(preserve));
  } catch {
    // Ignore storage errors
  }
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

  // SSH mode - prefer SSH when available
  const [useSshMode, setUseSshMode] = useState<boolean>(true);
  const [sshStatus, setSshStatus] = useState<SshDownloadStatusResponse | null>(null);
  const [sshError, setSshError] = useState<string | null>(null);

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

  // Multi-select state - Requirements: 8.1
  const [selectionState, setSelectionState] = useState<SelectionState>({
    selectedPaths: new Set(),
    selectionMode: false,
  });
  
  // Selection preference for navigation - Requirements: 8.8
  const [preserveSelectionOnNav, setPreserveSelectionOnNav] = useState<boolean>(() => 
    loadSelectionPreference()
  );

  // Download confirmation dialog state - Requirements: 9.1, 9.2
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationRequest, setConfirmationRequest] = useState<DownloadConfirmationRequest | null>(null);
  const pendingDownloadRef = useRef<{ paths: string[]; asZip: boolean } | null>(null);

  // Download context for triggering downloads - Requirements: 2.1, 2.2
  const { queueDownload, executeDownload } = useDownload();

  // Check SSH availability when node changes
  const sshStatusQuery = useQuery({
    queryKey: ["sshDownloadStatus", nodeId],
    queryFn: () => fetchSshDownloadStatus(nodeId),
    enabled: !!nodeId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  // Update SSH status when query completes
  useEffect(() => {
    if (sshStatusQuery.data) {
      setSshStatus(sshStatusQuery.data);
      setSshError(null);
      // Auto-enable SSH mode if available
      if (sshStatusQuery.data.available && sshStatusQuery.data.hasCredentials) {
        setUseSshMode(true);
      }
    } else if (sshStatusQuery.error) {
      setSshError(sshStatusQuery.error instanceof Error ? sshStatusQuery.error.message : "Failed to check SSH status");
    }
  }, [sshStatusQuery.data, sshStatusQuery.error]);

  // Determine if SSH is usable
  const sshAvailable = sshStatus?.available && sshStatus?.hasCredentials;

  // Reset session when node changes
  useEffect(() => {
    setSession(null);
    setCurrentPath("/");
    setOpenError(null);
    setAutoOpenBlocked(false);
    autoOpenAttemptedForNodeIdRef.current = null;
    setSshError(null);
    // Clear selection when node changes
    setSelectionState({
      selectedPaths: new Set(),
      selectionMode: false,
    });
  }, [nodeId]);

  // Expiry countdown timer (only for agent-based sessions)
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

  // Auto-open when online (only for agent mode when SSH is not available)
  useEffect(() => {
    if (!autoOpen) return;
    if (!isOnline) return;
    
    // If SSH is available, we don't need a session
    if (sshAvailable && useSshMode) return;
    
    if (session) return;
    if (createSessionMutation.isPending) return;
    if (autoOpenBlocked) return;

    // Avoid duplicate calls in React StrictMode/dev double-invocation.
    if (autoOpenAttemptedForNodeIdRef.current === nodeId) return;
    autoOpenAttemptedForNodeIdRef.current = nodeId;

    createSessionMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, isOnline, nodeId, autoOpenBlocked, sshAvailable, useSshMode]);

  const effectivePath = useMemo(() => {
    // react-file-manager uses "" as root; we map that to "/".
    const p = (currentPath ?? "").trim();
    return p ? p : "/";
  }, [currentPath]);

  // SSH-based file listing query
  const sshListQuery = useQuery({
    queryKey: ["sshFileBrowserList", nodeId, effectivePath],
    queryFn: () => listSshFiles(nodeId, effectivePath, 5000),
    enabled: sshAvailable && useSshMode,
    refetchOnWindowFocus: false,
  });

  // Agent-based file listing query (fallback)
  const agentListQuery = useQuery({
    queryKey: ["fileBrowserList", nodeId, session?.sessionId, effectivePath],
    queryFn: () => {
      if (!session) throw new Error("No session");
      return listFileBrowserEntries(nodeId, session.sessionId, effectivePath, 5000);
    },
    enabled: !!session && (!sshAvailable || !useSshMode),
    refetchOnWindowFocus: false,
  });

  // Use whichever query is active
  const listQuery = (sshAvailable && useSshMode) ? sshListQuery : agentListQuery;
  const listTruncated = Boolean(listQuery.data?.truncated);

  // Convert SSH entries to FileBrowserEntry format for consistency
  const filesForUi = useMemo(() => {
    if (sshAvailable && useSshMode && sshListQuery.data) {
      // Convert SshFileEntry to FileBrowserEntry format
      return sshListQuery.data.entries.map((f: SshFileEntry) => ({
        name: f.name,
        isDirectory: f.isDirectory,
        path: f.path,
        updatedAt: f.lastModified ?? undefined,
        size: f.size ?? undefined,
      }));
    }
    
    // Agent-based entries
    const entries: FileBrowserEntry[] = agentListQuery.data?.entries ?? [];
    return entries.map((f) => ({
      ...f,
      updatedAt: f.updatedAt ?? undefined,
      size: f.size ?? undefined,
    }));
  }, [sshAvailable, useSshMode, sshListQuery.data, agentListQuery.data]);

  /**
   * Selects all items in the current directory.
   * Requirements: 8.6
   */
  const selectAll = useCallback(() => {
    setSelectionState(() => {
      const newSelected = new Set<string>();
      filesForUi.forEach(file => newSelected.add(file.path));
      return {
        selectedPaths: newSelected,
        selectionMode: newSelected.size > 0,
      };
    });
  }, [filesForUi]);

  /**
   * Clears all selections.
   * Requirements: 8.7
   */
  const clearSelection = useCallback(() => {
    setSelectionState({
      selectedPaths: new Set(),
      selectionMode: false,
    });
  }, []);

  /**
   * Handles folder navigation with selection preference.
   * Requirements: 8.8
   */
  const handleFolderChange = useCallback((newPath: string) => {
    if (!preserveSelectionOnNav) {
      // Clear selection when navigating
      setSelectionState({
        selectedPaths: new Set(),
        selectionMode: false,
      });
    }
    setCurrentPath(newPath || "/");
  }, [preserveSelectionOnNav]);

  /**
   * Updates selection preference and saves to localStorage.
   * Requirements: 8.8
   */
  const updateSelectionPreference = useCallback((preserve: boolean) => {
    setPreserveSelectionOnNav(preserve);
    saveSelectionPreference(preserve);
  }, []);

  /**
   * Starts an SSH download (direct from server via SFTP).
   */
  const handleSshDownload = useCallback(async (paths: string[], asZip: boolean) => {
    try {
      if (asZip || paths.length > 1) {
        // Download as zip (server streams the zip directly)
        toast.loading("Downloading zip via SSH...", { id: `ssh-zip-${nodeId}` });

        const response = await downloadSshZip(nodeId, paths);
        const blob = await response.blob();

        // Extract filename from Content-Disposition if available
        const contentDisposition = response.headers.get("Content-Disposition");
        let filename = "download.zip";
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }
        } else if (paths.length === 1) {
          // Fall back to a reasonable default consistent with server behavior
          filename = `${filenameFromPath(paths[0])}.zip`;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success(`Downloaded ${filename}`, { id: `ssh-zip-${nodeId}` });
      } else {
        // Single file download
        const path = paths[0];
        const filename = filenameFromPath(path);
        
        toast.loading(`Downloading ${filename}...`, { id: `ssh-download-${path}` });
        
        const response = await downloadSshFile(nodeId, path);
        const blob = await response.blob();
        
        // Trigger browser download
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        toast.success(`Downloaded ${filename}`, { id: `ssh-download-${path}` });
      }
      
      // Clear selection after starting download
      clearSelection();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to download via SSH";
      toast.error(message);
    }
  }, [nodeId, clearSelection]);

  /**
   * Starts a download via the download context (agent-based fallback).
   * Requirements: 2.1, 2.2
   */
  const handleAgentDownload = useCallback(async (paths: string[], asZip: boolean) => {
    if (!session) {
      toast.error("No active session");
      return;
    }

    try {
      const downloadId = await queueDownload({
        nodeId,
        sessionId: session.sessionId,
        paths,
        asZip,
      });
      
      // Start executing the download
      await executeDownload(downloadId);
      
      // Clear selection after starting download
      clearSelection();
      
      toast.success(asZip ? "Zip download started" : "Download started");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start download";
      toast.error(message);
    }
  }, [session, nodeId, queueDownload, executeDownload, clearSelection]);

  /**
   * Starts a download - uses SSH if available, otherwise falls back to agent.
   * Requirements: 2.1, 2.2
   */
  const handleStartDownload = useCallback(async (paths: string[], asZip: boolean) => {
    if (sshAvailable && useSshMode) {
      await handleSshDownload(paths, asZip);
    } else {
      await handleAgentDownload(paths, asZip);
    }
  }, [sshAvailable, useSshMode, handleSshDownload, handleAgentDownload]);

  /**
   * Handles confirmation dialog confirm action.
   * Requirements: 9.5
   */
  const handleConfirmDownload = useCallback(() => {
    if (pendingDownloadRef.current) {
      const { paths, asZip } = pendingDownloadRef.current;
      handleStartDownload(paths, asZip);
      pendingDownloadRef.current = null;
    }
    setConfirmationOpen(false);
    setConfirmationRequest(null);
  }, [handleStartDownload]);

  /**
   * Handles confirmation dialog cancel action.
   * Requirements: 9.5
   */
  const handleCancelConfirmation = useCallback(() => {
    pendingDownloadRef.current = null;
    setConfirmationOpen(false);
    setConfirmationRequest(null);
  }, []);

  // Get selected items from paths - Requirements: 8.2
  const selectedItems = useMemo(() => {
    return filesForUi.filter(file => selectionState.selectedPaths.has(file.path));
  }, [filesForUi, selectionState.selectedPaths]);

  const readMutation = useMutation({
    mutationFn: async (file: FileBrowserEntry) => {
      const name = filenameFromPath(file.path);

      // SSH mode - download via SFTP
      if (sshAvailable && useSshMode) {
        if (isLikelyTextFile(name)) {
          // For text files in SSH mode, download and preview
          const response = await downloadSshFile(nodeId, file.path);
          const blob = await response.blob();
          const text = await blob.text();
          
          return { 
            mode: "preview" as const, 
            name, 
            text,
            truncated: false,
            path: file.path
          };
        }
        
        // Binary file - trigger direct download
        const response = await downloadSshFile(nodeId, file.path);
        const blob = await response.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        
        return { mode: "download" as const, name, bytes, path: file.path };
      }

      // Agent-based mode (fallback)
      if (!session) throw new Error("No session");

      // Text files: fetch a single chunk for preview.
      if (isLikelyTextFile(name)) {
        const resp = await readFileBrowserContent(
          nodeId,
          session.sessionId,
          file.path,
          session.maxBytesPerRead,
          0
        );

        return { mode: "preview-agent" as const, name, resp };
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
      // SSH mode text preview
      if (data.mode === "preview") {
        setPreviewTitle(data.name);
        setPreviewPath(data.path || "");
        setPreviewText(data.text);
        setPreviewTruncated(data.truncated);
        setPreviewOpen(true);
        return;
      }

      // Agent mode text preview
      if (data.mode === "preview-agent") {
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

      // Binary download
      downloadBytes(data.bytes, data.name, "application/octet-stream");
      toast.success(`Downloaded ${data.name}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to read file");
    },
  });

  const initialPathForUi = effectivePath === "/" ? "" : effectivePath;

  // Determine if we're ready to show the file browser
  const isReady = (sshAvailable && useSshMode) || !!session;

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
    <div className="rounded-md border border-border bg-card file-browser-wrapper">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Folder className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">File Browser</div>
            <div className="text-xs text-muted-foreground">
              {sshAvailable && useSshMode 
                ? `SSH/SFTP via ${sshStatus?.host || "onboarding credentials"}`
                : "Direct system access (session-scoped)"}
            </div>
            {sshError && !sshAvailable && (
              <div className="text-xs text-destructive">SSH unavailable: {sshError}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* SSH mode badge */}
          {sshAvailable && (
            <Badge
              variant={useSshMode ? "default" : "outline"}
              className="flex items-center gap-1 cursor-pointer"
              onClick={() => setUseSshMode(!useSshMode)}
            >
              <Server className="h-3 w-3" />
              SSH {useSshMode ? "On" : "Off"}
            </Badge>
          )}

          {/* Session countdown for agent mode */}
          {session && !useSshMode && (
            <Badge
              variant={expiryCountdown === "Expired" ? "destructive" : "outline"}
              className="flex items-center gap-1"
            >
              <Clock className="h-3 w-3" />
              {expiryCountdown}
            </Badge>
          )}

          {/* Agent mode controls - only show when not using SSH */}
          {(!sshAvailable || !useSshMode) && (
            <>
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
            </>
          )}
        </div>
      </div>

      <div className="p-4">
        {!isReady ? (
          <div className="space-y-3">
            {sshStatusQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4" />
                Checking SSH availability...
              </div>
            )}
            
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
            ) : !sshAvailable && !session ? (
              <div className="text-sm text-muted-foreground">Open a session to start browsing.</div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {sshAvailable && useSshMode ? (
                <>
                  SSH Mode · Current: <span className="font-mono">{effectivePath}</span>
                </>
              ) : (
                <>
                  Root: <span className="font-mono">{session?.rootPath || "/"}</span> · Current:{" "}
                  <span className="font-mono">{effectivePath}</span>
                </>
              )}
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

            {/* Selection toolbar - Requirements: 8.2 */}
            <FileBrowserSelectionToolbar
              selectedItems={selectedItems}
              allItems={filesForUi}
              onDownloadSelected={() => {
                // Download single selected file - Requirements: 2.1
                const file = selectedItems.find(item => !item.isDirectory);
                if (!file) return;
                if (!sshAvailable && !useSshMode && !session) return;
                
                const totalBytes = file.size ?? null;
                const filename = filenameFromPath(file.path);
                
                // Check if confirmation is needed - Requirements: 9.1
                if (shouldShowConfirmation(totalBytes, false)) {
                  pendingDownloadRef.current = { paths: [file.path], asZip: false };
                  setConfirmationRequest({
                    totalBytes,
                    isZip: false,
                    fileCount: 1,
                    filename,
                  });
                  setConfirmationOpen(true);
                } else {
                  // Start download directly
                  handleStartDownload([file.path], false);
                }
              }}
              onDownloadAsZip={() => {
                // Download selected items as zip - Requirements: 2.2
                if (selectedItems.length === 0) return;
                if (!sshAvailable && !useSshMode && !session) return;
                
                const paths = selectedItems.map(item => item.path);
                const totalBytes = selectedItems.reduce((sum, item) => {
                  if (!item.isDirectory && item.size != null) {
                    return sum + item.size;
                  }
                  return sum;
                }, 0);
                
                // Generate filename for zip
                const now = new Date();
                const timestamp = now.toISOString().replace(/[-:T]/g, '').substring(0, 15);
                const filename = selectedItems.length === 1 
                  ? `${filenameFromPath(selectedItems[0].path)}.zip`
                  : `download_${timestamp}.zip`;
                
                // Check if confirmation is needed - Requirements: 9.2
                if (shouldShowConfirmation(totalBytes, true)) {
                  pendingDownloadRef.current = { paths, asZip: true };
                  setConfirmationRequest({
                    totalBytes: totalBytes > 0 ? totalBytes : null,
                    isZip: true,
                    fileCount: selectedItems.length,
                    filename,
                  });
                  setConfirmationOpen(true);
                } else {
                  // Start download directly
                  handleStartDownload(paths, true);
                }
              }}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              preserveSelectionOnNav={preserveSelectionOnNav}
              onPreserveSelectionChange={updateSelectionPreference}
              disabled={!isReady}
            />

            <div className="min-h-[70vh] file-browser-host">
              <FileManager
                files={filesForUi}
                isLoading={listQuery.isFetching}
                initialPath={initialPathForUi}
                onFolderChange={handleFolderChange}
                onFileOpen={(file: FileBrowserEntry) => {
                  if (file.isDirectory) {
                    handleFolderChange(file.path);
                    return;
                  }
                  readMutation.mutate(file);
                }}
                onRefresh={() => {
                  if (sshAvailable && useSshMode) {
                    queryClient.invalidateQueries({
                      queryKey: ["sshFileBrowserList", nodeId],
                    });
                  } else if (session) {
                    queryClient.invalidateQueries({
                      queryKey: ["fileBrowserList", nodeId, session.sessionId],
                    });
                  }
                }}
                onDownload={(items: FileBrowserEntry[]) => {
                  // Update selection state when items are selected via FileManager
                  const newSelected = new Set(items.map(item => item.path));
                  setSelectionState({
                    selectedPaths: newSelected,
                    selectionMode: newSelected.size > 0,
                  });
                  
                  // If single file, download directly
                  const first = items?.find((i) => !i.isDirectory);
                  if (!first) {
                    toast.error("Select a file to download.");
                    return;
                  }
                  if (items.length > 1) {
                    // For multiple items, use zip download
                    handleStartDownload(items.map(i => i.path), true);
                    return;
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

      {/* Download confirmation dialog - Requirements: 9.1, 9.2, 9.5 */}
      <DownloadConfirmationDialog
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        request={confirmationRequest}
        onConfirm={handleConfirmDownload}
        onCancel={handleCancelConfirmation}
      />
    </div>
  );
}
