/**
 * DownloadProgressPanel - Collapsible panel showing download progress.
 * Displays at the bottom of the file browser with progress bars, speed, and ETA.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9
 */

import { useEffect, useRef, useState } from "react";
import { useDownload } from "@/DownloadContext";
import type { DownloadItem, DownloadStatus } from "@/types";
import {
  formatBytes,
  formatSpeed,
  formatDuration,
  calculateProgress,
} from "@/lib/download-utils";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Progress,
  ProgressTrack,
  ProgressIndicator,
} from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  ChevronDown,
  ChevronUp,
  Download,
  X,
  RotateCcw,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  FileArchive,
  File,
} from "lucide-react";

interface DownloadProgressPanelProps {
  /** Position of the panel. Defaults to "bottom". */
  position?: "bottom" | "sidebar";
  /** Maximum height of the panel content. Defaults to "300px". */
  maxHeight?: string;
}

/**
 * Returns the appropriate icon for a download status.
 */
function getStatusIcon(status: DownloadStatus, type: "single" | "zip") {
  switch (status) {
    case "queued":
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case "preparing":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case "downloading":
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "cancelled":
      return <X className="h-4 w-4 text-muted-foreground" />;
    default:
      return type === "zip" ? (
        <FileArchive className="h-4 w-4 text-muted-foreground" />
      ) : (
        <File className="h-4 w-4 text-muted-foreground" />
      );
  }
}

/**
 * Returns a human-readable status label.
 */
function getStatusLabel(status: DownloadStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing...";
    case "downloading":
      return "Downloading";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

/**
 * Returns the badge variant for a download status.
 */
function getStatusBadgeVariant(
  status: DownloadStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "destructive";
    case "downloading":
    case "preparing":
      return "secondary";
    default:
      return "outline";
  }
}

/**
 * Individual download item row component.
 */
function DownloadItemRow({
  download,
  onCancel,
  onRetry,
  onDismiss,
}: {
  download: DownloadItem;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const progress =
    download.totalBytes && download.totalBytes > 0
      ? calculateProgress(download.transferredBytes, download.totalBytes)
      : 0;

  const isActive =
    download.status === "queued" ||
    download.status === "preparing" ||
    download.status === "downloading";
  const isCompleted = download.status === "completed";
  const isFailed = download.status === "failed";
  const isCancelled = download.status === "cancelled";

  // Build tooltip content with additional details
  const tooltipContent = (
    <div className="space-y-1 text-xs">
      <div>
        <span className="text-muted-foreground">Source: </span>
        <span className="font-mono">{download.paths.join(", ")}</span>
      </div>
      {download.totalBytes && (
        <div>
          <span className="text-muted-foreground">Total size: </span>
          <span>{formatBytes(download.totalBytes)}</span>
        </div>
      )}
      <div>
        <span className="text-muted-foreground">Transferred: </span>
        <span>{formatBytes(download.transferredBytes)}</span>
      </div>
      {download.startedAt && (
        <div>
          <span className="text-muted-foreground">Started: </span>
          <span>{new Date(download.startedAt).toLocaleTimeString()}</span>
        </div>
      )}
      {download.error && (
        <div className="text-destructive">
          <span className="text-muted-foreground">Error: </span>
          <span>{download.error}</span>
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 hover:bg-muted/50 transition-colors">
            {/* Status icon */}
            <div className="shrink-0">
              {getStatusIcon(download.status, download.type)}
            </div>

            {/* File info and progress */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">
                    {download.filename}
                  </span>
                  {download.type === "zip" && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0">
                      ZIP
                    </Badge>
                  )}
                </div>
                <Badge variant={getStatusBadgeVariant(download.status)} className="text-xs">
                  {getStatusLabel(download.status)}
                </Badge>
              </div>

              {/* Progress bar for active downloads */}
              {isActive && (
                <div className="space-y-1">
                  <Progress value={progress} className="h-1.5">
                    <ProgressTrack className="h-1.5">
                      <ProgressIndicator />
                    </ProgressTrack>
                  </Progress>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {download.totalBytes
                        ? `${formatBytes(download.transferredBytes)} / ${formatBytes(download.totalBytes)}`
                        : formatBytes(download.transferredBytes)}
                    </span>
                    <div className="flex items-center gap-2">
                      {download.speed > 0 && (
                        <span>{formatSpeed(download.speed)}</span>
                      )}
                      {download.eta !== null && download.eta > 0 && (
                        <span>ETA: {formatDuration(download.eta)}</span>
                      )}
                      {progress > 0 && <span>{progress}%</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* Error message for failed downloads */}
              {isFailed && download.error && (
                <div className="text-xs text-destructive truncate">
                  {download.error}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="shrink-0 flex items-center gap-1">
              {/* Cancel button for active/queued downloads - Requirements: 7.5 */}
              {isActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel(download.id);
                  }}
                  title="Cancel download"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}

              {/* Retry button for failed downloads - Requirements: 7.7 */}
              {isFailed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(download.id);
                  }}
                  title="Retry download"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}

              {/* Dismiss button for completed/cancelled downloads - Requirements: 7.6 */}
              {(isCompleted || isCancelled) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(download.id);
                  }}
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * DownloadProgressPanel component.
 * Displays a collapsible panel at the bottom of the file browser showing download progress.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9
 */
export function DownloadProgressPanel({
  position = "bottom",
  maxHeight = "300px",
}: DownloadProgressPanelProps) {
  const {
    downloads,
    activeCount,
    cancelDownload,
    retryDownload,
    clearCompleted,
    removeDownload,
  } = useDownload();

  const [isOpen, setIsOpen] = useState(false);
  const prevActiveCountRef = useRef(0);

  // Auto-expand when a download becomes active - Requirements: 7.2
  // Only expand when activeCount increases (new download started)
  useEffect(() => {
    // Check if activeCount increased since last render
    if (activeCount > prevActiveCountRef.current) {
      // Use setTimeout to avoid synchronous setState in effect
      // This is intentional - we want to auto-expand when downloads start
      const timeoutId = setTimeout(() => setIsOpen(true), 0);
      prevActiveCountRef.current = activeCount;
      return () => clearTimeout(timeoutId);
    }
    // Always update the ref after comparison
    prevActiveCountRef.current = activeCount;
  }, [activeCount]);

  // Count completed/failed/cancelled downloads for clear button
  const completedCount = downloads.filter(
    (d) =>
      d.status === "completed" ||
      d.status === "failed" ||
      d.status === "cancelled"
  ).length;

  // Don't render if no downloads
  if (downloads.length === 0) {
    return null;
  }

  const handleCancel = async (downloadId: string) => {
    try {
      await cancelDownload(downloadId);
    } catch {
      // Error is handled in context
    }
  };

  const handleRetry = async (downloadId: string) => {
    try {
      await retryDownload(downloadId);
    } catch {
      // Error is handled in context
    }
  };

  const handleDismiss = (downloadId: string) => {
    removeDownload(downloadId);
  };

  const handleClearCompleted = () => {
    clearCompleted();
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={`border-t border-border bg-background ${
        position === "bottom" ? "fixed bottom-0 left-0 right-0 z-50" : ""
      }`}
    >
      {/* Trigger header - Requirements: 7.1, 7.8 */}
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2 cursor-pointer hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Downloads</span>
          {/* Badge count for active downloads when collapsed - Requirements: 7.8 */}
          {activeCount > 0 && (
            <Badge variant="default" className="text-xs px-1.5 py-0">
              {activeCount}
            </Badge>
          )}
          {!isOpen && completedCount > 0 && activeCount === 0 && (
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              {completedCount} done
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Clear all completed button - Requirements: 7.9 */}
          {completedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleClearCompleted();
              }}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear completed
            </Button>
          )}
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CollapsibleTrigger>

      {/* Content panel - Requirements: 7.3 */}
      <CollapsibleContent>
        <div
          className="px-4 pb-3 space-y-2 overflow-y-auto"
          style={{ maxHeight }}
        >
          {downloads.map((download) => (
            <DownloadItemRow
              key={download.id}
              download={download}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
