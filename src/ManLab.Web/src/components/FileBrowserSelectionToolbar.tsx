/**
 * FileBrowserSelectionToolbar - Toolbar for file browser selection actions.
 * Shows when items are selected, displays count and size, provides download actions.
 * 
 * Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { useMemo } from "react";
import type { FileBrowserEntry } from "@/types";
import { formatBytes } from "@/lib/download-utils";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import {
  Download,
  FileArchive,
  X,
  CheckSquare,
  Square,
} from "lucide-react";

export interface FileBrowserSelectionToolbarProps {
  /** Currently selected items */
  selectedItems: FileBrowserEntry[];
  /** All items in the current directory (for select all) */
  allItems: FileBrowserEntry[];
  /** Callback when "Download Selected" is clicked (single file) */
  onDownloadSelected: () => void;
  /** Callback when "Download as Zip" is clicked (multiple items or folders) */
  onDownloadAsZip: () => void;
  /** Callback when "Select All" is clicked */
  onSelectAll: () => void;
  /** Callback when "Clear Selection" is clicked */
  onClearSelection: () => void;
  /** Whether to preserve selection on navigation */
  preserveSelectionOnNav: boolean;
  /** Callback to update selection preference */
  onPreserveSelectionChange: (preserve: boolean) => void;
  /** Whether downloads are currently disabled (e.g., no session) */
  disabled?: boolean;
}

/**
 * FileBrowserSelectionToolbar component.
 * Displays selection actions when items are selected in the file browser.
 * 
 * Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */
export function FileBrowserSelectionToolbar({
  selectedItems,
  allItems,
  onDownloadSelected,
  onDownloadAsZip,
  onSelectAll,
  onClearSelection,
  preserveSelectionOnNav,
  onPreserveSelectionChange,
  disabled = false,
}: FileBrowserSelectionToolbarProps) {
  // Calculate selection stats - Requirements: 8.3
  const selectionStats = useMemo(() => {
    const fileCount = selectedItems.filter(item => !item.isDirectory).length;
    const folderCount = selectedItems.filter(item => item.isDirectory).length;
    const totalSize = selectedItems.reduce((sum, item) => {
      // Only count file sizes, folders don't have accurate sizes
      if (!item.isDirectory && item.size != null) {
        return sum + item.size;
      }
      return sum;
    }, 0);
    
    return {
      fileCount,
      folderCount,
      totalCount: selectedItems.length,
      totalSize,
      hasKnownSize: selectedItems.some(item => !item.isDirectory && item.size != null),
    };
  }, [selectedItems]);

  // Determine which download button to show - Requirements: 8.4, 8.5
  const showDownloadSelected = selectionStats.totalCount === 1 && selectionStats.fileCount === 1;
  const showDownloadAsZip = selectionStats.totalCount > 1 || selectionStats.folderCount > 0;

  // Check if all items are selected
  const allSelected = allItems.length > 0 && selectedItems.length === allItems.length;

  // Don't render if nothing is selected
  if (selectedItems.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-4 rounded-md border border-border bg-muted/50 px-3 py-2">
      {/* Selection info - Requirements: 8.3 */}
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="text-xs">
          {selectionStats.totalCount} selected
        </Badge>
        
        {/* Show breakdown if mixed selection */}
        {selectionStats.fileCount > 0 && selectionStats.folderCount > 0 && (
          <span className="text-xs text-muted-foreground">
            ({selectionStats.fileCount} file{selectionStats.fileCount !== 1 ? 's' : ''}, 
            {' '}{selectionStats.folderCount} folder{selectionStats.folderCount !== 1 ? 's' : ''})
          </span>
        )}
        
        {/* Show total size when known */}
        {selectionStats.hasKnownSize && selectionStats.totalSize > 0 && (
          <span className="text-xs text-muted-foreground">
            {formatBytes(selectionStats.totalSize)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Preserve selection checkbox - Requirements: 8.8 */}
        <Tooltip>
          <TooltipTrigger className="flex items-center gap-1.5 mr-2 cursor-pointer">
            <Checkbox
              id="preserve-selection"
              checked={preserveSelectionOnNav}
              onCheckedChange={(checked) => onPreserveSelectionChange(checked === true)}
              className="h-3.5 w-3.5"
            />
            <Label 
              htmlFor="preserve-selection" 
              className="text-xs text-muted-foreground cursor-pointer"
            >
              Keep selection
            </Label>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Preserve selection when navigating folders</p>
          </TooltipContent>
        </Tooltip>

        {/* Select All / Deselect All - Requirements: 8.6, 8.7 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={allSelected ? onClearSelection : onSelectAll}
            >
              {allSelected ? (
                <>
                  <Square className="h-3.5 w-3.5 mr-1" />
                  <span className="text-xs">Deselect All</span>
                </>
              ) : (
                <>
                  <CheckSquare className="h-3.5 w-3.5 mr-1" />
                  <span className="text-xs">Select All</span>
                </>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">
              {allSelected ? "Clear all selections" : "Select all items in current folder"}
            </p>
          </TooltipContent>
        </Tooltip>

        {/* Clear Selection - Requirements: 8.7 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={onClearSelection}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              <span className="text-xs">Clear</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">Clear selection</p>
          </TooltipContent>
        </Tooltip>

        {/* Download Selected (single file) - Requirements: 8.4 */}
        {showDownloadSelected && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                className="h-7"
                onClick={onDownloadSelected}
                disabled={disabled}
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">Download</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Download selected file</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Download as Zip (multiple items or folders) - Requirements: 8.5 */}
        {showDownloadAsZip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                className="h-7"
                onClick={onDownloadAsZip}
                disabled={disabled}
              >
                <FileArchive className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">Download as Zip</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">
                Download {selectionStats.totalCount} item{selectionStats.totalCount !== 1 ? 's' : ''} as a zip archive
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
