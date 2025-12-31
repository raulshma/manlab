/**
 * Download Context for managing file downloads with progress tracking.
 * Provides download queue management, progress updates via SignalR, and browser download triggering.
 * 
 * Requirements: 1.7, 1.8, 4.1, 4.2, 4.3, 4.5, 4.6
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useSignalR } from "./SignalRContext";
import type {
  DownloadItem,
  DownloadStatus,
  DownloadProgressEvent,
  DownloadStatusChangedEvent,
  CreateDownloadRequest,
  CreateDownloadResponse,
} from "./types";
import { calculateEta } from "./lib/download-utils";

const API_BASE = "/api";
const SESSION_STORAGE_KEY = "manlab:download_queue";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Request to queue a new download.
 */
export interface QueueDownloadRequest {
  nodeId: string;
  sessionId: string;
  paths: string[];
  asZip?: boolean;
}

/**
 * Download context value interface.
 */
interface DownloadContextValue {
  /** All downloads in the queue (queued, active, completed, failed). */
  downloads: DownloadItem[];
  /** Number of currently active downloads. */
  activeCount: number;
  /** Queue a new download. Returns the download ID. */
  queueDownload: (request: QueueDownloadRequest) => Promise<string>;
  /** Cancel an active or queued download. */
  cancelDownload: (downloadId: string) => Promise<void>;
  /** Retry a failed download. */
  retryDownload: (downloadId: string) => Promise<void>;
  /** Clear all completed downloads from the queue. */
  clearCompleted: () => void;
  /** Remove a specific download from the queue. */
  removeDownload: (downloadId: string) => void;
  /** Start executing a queued download (fetch and trigger browser download). */
  executeDownload: (downloadId: string) => Promise<void>;
}

/**
 * Cancellation controller for active downloads.
 */
interface DownloadController {
  abortController: AbortController;
  retryCount: number;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

/**
 * Props for the Download provider component.
 */
interface DownloadProviderProps {
  children: ReactNode;
}

/**
 * Generates a filename for a download based on paths.
 */
function generateFilename(paths: string[], asZip: boolean): string {
  if (paths.length === 1 && !asZip) {
    const path = paths[0];
    const lastSlash = path.lastIndexOf('/');
    return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
  }

  if (paths.length === 1) {
    const path = paths[0];
    const lastSlash = path.lastIndexOf('/');
    const name = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    return `${name}.zip`;
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T]/g, '').substring(0, 15);
  return `download_${timestamp}.zip`;
}

/**
 * Loads download queue from sessionStorage.
 */
function loadQueueFromStorage(): DownloadItem[] {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DownloadItem[];
      // Filter out any downloads that were in progress (they can't be resumed)
      return parsed.filter(d => 
        d.status === 'completed' || 
        d.status === 'failed' || 
        d.status === 'cancelled'
      );
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Saves download queue to sessionStorage.
 */
function saveQueueToStorage(downloads: DownloadItem[]): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(downloads));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

/**
 * Download Provider component.
 * Manages the download queue and coordinates with SignalR for progress updates.
 */
export function DownloadProvider({ children }: DownloadProviderProps) {
  const { connection } = useSignalR();
  const [downloads, setDownloads] = useState<DownloadItem[]>(() => loadQueueFromStorage());
  
  // Track speed calculation state
  const speedTrackingRef = useRef<Map<string, { lastBytes: number; lastTime: number }>>(new Map());
  
  // Track active download controllers for cancellation
  const downloadControllersRef = useRef<Map<string, DownloadController>>(new Map());

  // Ref to access the latest downloads synchronously (avoids stale closure issues)
  const downloadsRef = useRef<DownloadItem[]>(downloads);
  useEffect(() => {
    downloadsRef.current = downloads;
  }, [downloads]);

  // Persist queue to sessionStorage when it changes
  useEffect(() => {
    saveQueueToStorage(downloads);
  }, [downloads]);

  // Calculate active count
  const activeCount = downloads.filter(d => 
    d.status === 'queued' || 
    d.status === 'preparing' || 
    d.status === 'downloading'
  ).length;

  /**
   * Updates a download item in the queue.
   */
  const updateDownload = useCallback((downloadId: string, updates: Partial<DownloadItem>) => {
    setDownloads(prev => prev.map(d => 
      d.id === downloadId ? { ...d, ...updates } : d
    ));
  }, []);

  /**
   * Handles download progress events from SignalR.
   */
  const handleDownloadProgress = useCallback((event: DownloadProgressEvent) => {
    const { downloadId, bytesTransferred, totalBytes, speedBytesPerSec, estimatedSecondsRemaining } = event;
    
    // Calculate local speed if server didn't provide it
    let speed = speedBytesPerSec;
    if (!speed || speed <= 0) {
      const tracking = speedTrackingRef.current.get(downloadId);
      const now = Date.now();
      if (tracking) {
        const timeDelta = (now - tracking.lastTime) / 1000;
        const bytesDelta = bytesTransferred - tracking.lastBytes;
        if (timeDelta > 0) {
          speed = bytesDelta / timeDelta;
        }
      }
      speedTrackingRef.current.set(downloadId, { lastBytes: bytesTransferred, lastTime: now });
    }

    // Calculate ETA if not provided
    const remaining = totalBytes - bytesTransferred;
    const eta = estimatedSecondsRemaining ?? calculateEta(remaining, speed);

    updateDownload(downloadId, {
      status: 'downloading',
      transferredBytes: bytesTransferred,
      totalBytes: totalBytes > 0 ? totalBytes : null,
      speed: speed > 0 ? speed : 0,
      eta,
    });
  }, [updateDownload]);

  /**
   * Handles download status change events from SignalR.
   */
  const handleDownloadStatusChanged = useCallback((event: DownloadStatusChangedEvent) => {
    const { downloadId, status, error } = event;
    
    const updates: Partial<DownloadItem> = {
      status,
      error,
    };

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.completedAt = new Date().toISOString();
      // Clean up speed tracking and controllers
      speedTrackingRef.current.delete(downloadId);
      downloadControllersRef.current.delete(downloadId);
    }

    updateDownload(downloadId, updates);
  }, [updateDownload]);

  // Register SignalR event handlers
  useEffect(() => {
    if (!connection) return;

    const progressHandler = (
      downloadId: string,
      bytesTransferred: number,
      totalBytes: number,
      speedBytesPerSec: number,
      estimatedSecondsRemaining: number | null
    ) => {
      handleDownloadProgress({
        downloadId,
        bytesTransferred,
        totalBytes,
        speedBytesPerSec,
        estimatedSecondsRemaining,
      });
    };

    const statusHandler = (
      downloadId: string,
      status: DownloadStatus,
      error: string | null
    ) => {
      handleDownloadStatusChanged({
        downloadId,
        status,
        error,
      });
    };

    connection.on("DownloadProgress", progressHandler);
    connection.on("DownloadStatusChanged", statusHandler);

    return () => {
      connection.off("DownloadProgress", progressHandler);
      connection.off("DownloadStatusChanged", statusHandler);
    };
  }, [connection, handleDownloadProgress, handleDownloadStatusChanged]);

  /**
   * Fetches a chunk with retry logic.
   * Requirements: 1.7
   */
  const fetchChunkWithRetry = useCallback(async (
    url: string,
    signal: AbortSignal,
    downloadId: string
  ): Promise<Response> => {
    const controller = downloadControllersRef.current.get(downloadId);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) {
        throw new DOMException("Download cancelled", "AbortError");
      }

      try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        // Reset retry count on success
        if (controller) {
          controller.retryCount = 0;
        }
        return response;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < MAX_RETRIES) {
          // Wait before retrying with exponential backoff
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          if (controller) {
            controller.retryCount = attempt + 1;
          }
        }
      }
    }

    throw lastError || new Error("Failed to fetch chunk after retries");
  }, []);

  /**
   * Executes a download by streaming from the server and triggering browser download.
   * Requirements: 1.7, 1.8, 4.3
   */
  const executeDownload = useCallback(async (downloadId: string): Promise<void> => {
    // Use downloadsRef to get current state (avoids stale closure)
    const download = downloadsRef.current.find(d => d.id === downloadId);
    if (!download) {
      throw new Error("Download not found");
    }

    // Only execute queued or preparing downloads
    if (download.status !== 'queued' && download.status !== 'preparing') {
      return;
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();
    downloadControllersRef.current.set(downloadId, {
      abortController,
      retryCount: 0,
    });

    // Initialize speed tracking
    speedTrackingRef.current.set(downloadId, { lastBytes: 0, lastTime: Date.now() });

    try {
      // Update status to downloading
      updateDownload(downloadId, { status: 'downloading' });

      // Stream the download from the server
      const streamUrl = `${API_BASE}/downloads/${downloadId}/stream`;
      const response = await fetchChunkWithRetry(streamUrl, abortController.signal, downloadId);

      // Get content info from headers
      const contentLength = response.headers.get('Content-Length');
      const contentDisposition = response.headers.get('Content-Disposition');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : null;

      // Extract filename from Content-Disposition if available
      let filename = download.filename;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      if (totalBytes) {
        updateDownload(downloadId, { totalBytes });
      }

      // Read the response as a stream and collect chunks
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const chunks: Uint8Array[] = [];
      let transferredBytes = 0;
      let lastProgressUpdate = Date.now();

      while (true) {
        if (abortController.signal.aborted) {
          reader.cancel();
          throw new DOMException("Download cancelled", "AbortError");
        }

        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        transferredBytes += value.length;

        // Update progress (throttle to avoid too many updates)
        const now = Date.now();
        if (now - lastProgressUpdate > 100) { // Update every 100ms
          const tracking = speedTrackingRef.current.get(downloadId);
          let speed = 0;
          if (tracking) {
            const timeDelta = (now - tracking.lastTime) / 1000;
            const bytesDelta = transferredBytes - tracking.lastBytes;
            if (timeDelta > 0) {
              speed = bytesDelta / timeDelta;
            }
            speedTrackingRef.current.set(downloadId, { lastBytes: transferredBytes, lastTime: now });
          }

          const remaining = (totalBytes ?? 0) - transferredBytes;
          const eta = calculateEta(remaining, speed);

          updateDownload(downloadId, {
            transferredBytes,
            speed,
            eta,
          });
          lastProgressUpdate = now;
        }
      }

      // Assemble chunks into a single blob
      // Requirements: 1.8
      const blob = new Blob(chunks as BlobPart[], { 
        type: download.type === 'zip' ? 'application/zip' : 'application/octet-stream' 
      });

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Mark as completed
      updateDownload(downloadId, {
        status: 'completed',
        transferredBytes: blob.size,
        completedAt: new Date().toISOString(),
      });

    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        // Download was cancelled
        updateDownload(downloadId, {
          status: 'cancelled',
          completedAt: new Date().toISOString(),
        });
      } else {
        // Download failed
        const errorMessage = error instanceof Error ? error.message : String(error);
        updateDownload(downloadId, {
          status: 'failed',
          error: errorMessage,
          completedAt: new Date().toISOString(),
        });
      }
    } finally {
      // Clean up
      speedTrackingRef.current.delete(downloadId);
      downloadControllersRef.current.delete(downloadId);
    }
  }, [updateDownload, fetchChunkWithRetry]);

  /**
   * Creates a download on the server and adds it to the queue.
   */
  const queueDownload = useCallback(async (request: QueueDownloadRequest): Promise<string> => {
    const { nodeId, sessionId, paths, asZip } = request;

    // Create download on server
    const serverRequest: CreateDownloadRequest = {
      sessionId,
      paths,
      asZip,
    };

    // Get SignalR connection ID to include in request for progress forwarding
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (connection?.connectionId) {
      headers["X-SignalR-ConnectionId"] = connection.connectionId;
    }

    const response = await fetch(`${API_BASE}/devices/${nodeId}/downloads`, {
      method: "POST",
      headers,
      body: JSON.stringify(serverRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create download: ${errorText || response.statusText}`);
    }

    const result: CreateDownloadResponse = await response.json();

    // Create download item
    const downloadItem: DownloadItem = {
      id: result.downloadId,
      nodeId,
      sessionId,
      paths,
      filename: result.filename || generateFilename(paths, asZip ?? paths.length > 1),
      type: (asZip ?? paths.length > 1) ? 'zip' : 'single',
      status: (result.status?.toLowerCase() as DownloadStatus) || 'queued',
      totalBytes: result.totalBytes,
      transferredBytes: 0,
      speed: 0,
      eta: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    // Add to queue
    setDownloads(prev => [...prev, downloadItem]);

    // Initialize speed tracking
    speedTrackingRef.current.set(result.downloadId, { lastBytes: 0, lastTime: Date.now() });

    return result.downloadId;
  }, [connection]);

  /**
   * Cancels an active or queued download.
   */
  const cancelDownload = useCallback(async (downloadId: string): Promise<void> => {
    // Use downloadsRef to get current state (avoids stale closure)
    const download = downloadsRef.current.find(d => d.id === downloadId);
    if (!download) {
      throw new Error("Download not found");
    }

    // Only cancel if not already completed/failed/cancelled
    if (download.status === 'completed' || download.status === 'failed' || download.status === 'cancelled') {
      return;
    }

    // Abort any in-progress fetch
    const controller = downloadControllersRef.current.get(downloadId);
    if (controller) {
      controller.abortController.abort();
    }

    // Cancel on server
    const response = await fetch(`${API_BASE}/downloads/${downloadId}`, {
      method: "DELETE",
    });

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      throw new Error(`Failed to cancel download: ${errorText || response.statusText}`);
    }

    // Update local state
    updateDownload(downloadId, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });

    // Clean up speed tracking and controllers
    speedTrackingRef.current.delete(downloadId);
    downloadControllersRef.current.delete(downloadId);
  }, [updateDownload]);

  /**
   * Retries a failed download.
   */
  const retryDownload = useCallback(async (downloadId: string): Promise<void> => {
    // Use downloadsRef to get current state (avoids stale closure)
    const download = downloadsRef.current.find(d => d.id === downloadId);
    if (!download) {
      throw new Error("Download not found");
    }

    if (download.status !== 'failed') {
      throw new Error("Can only retry failed downloads");
    }

    // Remove the failed download
    setDownloads(prev => prev.filter(d => d.id !== downloadId));

    // Queue a new download with the same parameters
    await queueDownload({
      nodeId: download.nodeId,
      sessionId: download.sessionId,
      paths: download.paths,
      asZip: download.type === 'zip',
    });
  }, [queueDownload]);

  /**
   * Clears all completed downloads from the queue.
   */
  const clearCompleted = useCallback(() => {
    setDownloads(prev => prev.filter(d => 
      d.status !== 'completed' && 
      d.status !== 'failed' && 
      d.status !== 'cancelled'
    ));
  }, []);

  /**
   * Removes a specific download from the queue.
   */
  const removeDownload = useCallback((downloadId: string) => {
    setDownloads(prev => prev.filter(d => d.id !== downloadId));
    speedTrackingRef.current.delete(downloadId);
  }, []);

  return (
    <DownloadContext.Provider
      value={{
        downloads,
        activeCount,
        queueDownload,
        cancelDownload,
        retryDownload,
        clearCompleted,
        removeDownload,
        executeDownload,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
}

/**
 * Hook to access the Download context.
 * Throws an error if used outside of DownloadProvider.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useDownload(): DownloadContextValue {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error("useDownload must be used within a DownloadProvider");
  }
  return context;
}
