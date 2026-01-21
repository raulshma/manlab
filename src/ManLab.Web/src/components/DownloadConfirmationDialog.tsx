/**
 * DownloadConfirmationDialog - Confirmation dialog for large file downloads.
 * Shows before starting downloads > 100MB or zip downloads.
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import { useState, useCallback } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  formatBytes,
  formatDuration,
  setConfirmationDisabled,
  calculateEstimatedDownloadTime,
} from "@/lib/download-utils";
import { Download, FileArchive, AlertTriangle } from "lucide-react";

export interface DownloadConfirmationRequest {
  /** Total size in bytes (if known) */
  totalBytes: number | null;
  /** Whether this is a zip download */
  isZip: boolean;
  /** Number of files being downloaded */
  fileCount: number;
  /** Filename or description for display */
  filename: string;
}

export interface DownloadConfirmationDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Download request details */
  request: DownloadConfirmationRequest | null;
  /** Callback when user confirms the download */
  onConfirm: () => void;
  /** Callback when user cancels the download */
  onCancel: () => void;
}

/**
 * DownloadConfirmationDialog component.
 * Shows a confirmation dialog before starting large downloads.
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */
export function DownloadConfirmationDialog({
  open,
  onOpenChange,
  request,
  onConfirm,
  onCancel,
}: DownloadConfirmationDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const handleConfirm = useCallback(() => {
    // Save preference if "Don't ask again" is checked
    // Requirements: 9.6, 9.7
    if (dontAskAgain) {
      setConfirmationDisabled(true);
    }
    onConfirm();
  }, [dontAskAgain, onConfirm]);

  const handleCancel = useCallback(() => {
    setDontAskAgain(false);
    onCancel();
  }, [onCancel]);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      setDontAskAgain(false);
    }
    onOpenChange(newOpen);
  }, [onOpenChange]);

  if (!request) {
    return null;
  }

  const { totalBytes, isZip, fileCount, filename } = request;
  const estimatedSeconds = calculateEstimatedDownloadTime(totalBytes);

  // Determine the icon and title based on download type
  const Icon = isZip ? FileArchive : Download;
  const title = isZip ? "Download as Zip Archive" : "Download Large File";

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <AlertDialogTitle className="text-lg">{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-3">
            {/* Main message */}
            <p>
              {isZip ? (
                <>
                  You are about to download{" "}
                  <span className="font-medium text-foreground">
                    {fileCount} {fileCount === 1 ? "item" : "items"}
                  </span>{" "}
                  as a zip archive.
                </>
              ) : (
                <>
                  You are about to download{" "}
                  <span className="font-medium text-foreground">{filename}</span>.
                </>
              )}
            </p>

            {/* Size and time estimate - Requirements: 9.3, 9.4 */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              {totalBytes !== null && totalBytes > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total size:</span>
                  <span className="font-medium">{formatBytes(totalBytes)}</span>
                </div>
              )}
              {estimatedSeconds !== null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Estimated time:</span>
                  <span className="font-medium">~{formatDuration(estimatedSeconds)}</span>
                </div>
              )}
              {totalBytes === null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Size unknown - download may take a while</span>
                </div>
              )}
            </div>

            {/* Warning for very large downloads */}
            {totalBytes !== null && totalBytes > 1024 * 1024 * 1024 && (
              <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  This is a large download ({formatBytes(totalBytes)}). 
                  Make sure you have enough disk space.
                </span>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex-col sm:flex-row gap-4">
          {/* Don't ask again checkbox - Requirements: 9.6 */}
          <div className="flex items-center gap-2 mr-auto">
            <Checkbox
              id="dont-ask-again"
              checked={dontAskAgain}
              onCheckedChange={(checked) => setDontAskAgain(checked === true)}
            />
            <Label
              htmlFor="dont-ask-again"
              className="text-sm text-muted-foreground cursor-pointer"
            >
              Don't ask again
            </Label>
          </div>

          {/* Action buttons - Requirements: 9.5 */}
          <div className="flex gap-2">
            <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              <Icon className="h-4 w-4 mr-2" />
              Download
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
