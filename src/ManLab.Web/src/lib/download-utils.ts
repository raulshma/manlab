/**
 * Download utility functions for formatting bytes, speed, duration, and progress calculations.
 * These utilities support the enhanced file download feature with live progress tracking.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 9.3
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const BYTES_PER_UNIT = 1024;

/**
 * Formats a byte count into a human-readable string with appropriate unit suffix.
 * Uses binary units (1 KB = 1024 bytes).
 * 
 * @param bytes - The number of bytes to format (must be non-negative)
 * @returns A formatted string like "1.5 MB" or "0 B"
 * 
 * Requirements: 1.2, 1.4, 9.3
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  
  if (bytes === 0) {
    return '0 B';
  }

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT)),
    BYTE_UNITS.length - 1
  );
  
  const value = bytes / Math.pow(BYTES_PER_UNIT, unitIndex);
  const unit = BYTE_UNITS[unitIndex];
  
  // Use 2 decimal places for values < 10, 1 decimal for < 100, 0 for >= 100
  let decimals: number;
  if (value < 10) {
    decimals = 2;
  } else if (value < 100) {
    decimals = 1;
  } else {
    decimals = 0;
  }
  
  return `${value.toFixed(decimals)} ${unit}`;
}

/**
 * Formats a transfer speed (bytes per second) into a human-readable string.
 * 
 * @param bytesPerSec - The transfer speed in bytes per second
 * @returns A formatted string like "1.5 MB/s" or "0 B/s"
 * 
 * Requirements: 1.2
 */
export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) {
    return '0 B/s';
  }
  
  return `${formatBytes(bytesPerSec)}/s`;
}

/**
 * Formats a duration in seconds into a human-readable string.
 * Shows hours:minutes:seconds for durations >= 1 hour,
 * minutes:seconds for durations >= 1 minute,
 * and just seconds for shorter durations.
 * 
 * @param seconds - The duration in seconds
 * @returns A formatted string like "1:23:45", "5:30", or "45s"
 * 
 * Requirements: 9.3
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0s';
  }
  
  const totalSeconds = Math.ceil(seconds);
  
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Calculates download progress as a percentage.
 * Returns a value between 0 and 100, clamped and floored.
 * 
 * @param transferred - Bytes transferred so far
 * @param total - Total bytes to transfer
 * @returns Progress percentage (0-100), or 0 if total is 0 or invalid
 * 
 * Requirements: 1.1, 1.3
 */
export function calculateProgress(transferred: number, total: number): number {
  if (!Number.isFinite(transferred) || !Number.isFinite(total)) {
    return 0;
  }
  
  if (total <= 0 || transferred < 0) {
    return 0;
  }
  
  const percentage = Math.floor((transferred / total) * 100);
  return Math.max(0, Math.min(100, percentage));
}

/**
 * Calculates estimated time remaining for a download.
 * 
 * @param remaining - Remaining bytes to transfer
 * @param speed - Current transfer speed in bytes per second
 * @returns Estimated seconds remaining, or null if calculation is not possible
 * 
 * Requirements: 1.3
 */
export function calculateEta(remaining: number, speed: number): number | null {
  if (!Number.isFinite(remaining) || !Number.isFinite(speed)) {
    return null;
  }
  
  if (remaining <= 0) {
    return 0;
  }
  
  if (speed <= 0) {
    return null;
  }
  
  return Math.ceil(remaining / speed);
}

// ============================================================================
// Download Confirmation Utilities
// Requirements: 9.1, 9.2, 9.7
// ============================================================================

/** Threshold for showing confirmation dialog (100MB) */
export const LARGE_FILE_THRESHOLD_BYTES = 100 * 1024 * 1024;

/** Typical transfer rate assumption for ETA calculation (10 MB/s) */
export const TYPICAL_TRANSFER_RATE_BYTES_PER_SEC = 10 * 1024 * 1024;

/** localStorage key for "Don't ask again" preference */
const DONT_ASK_AGAIN_KEY = "manlab:download_confirmation_disabled";

/**
 * Checks if a download should show a confirmation dialog.
 * Returns true if:
 * - Single file > 100MB
 * - Zip download (multiple items or folders)
 * AND user hasn't disabled confirmations.
 * 
 * Requirements: 9.1, 9.2, 9.7
 */
export function shouldShowConfirmation(
  totalBytes: number | null,
  isZip: boolean
): boolean {
  // Check if user has disabled confirmations
  if (isConfirmationDisabled()) {
    return false;
  }

  // Show for zip downloads (multiple items or folders)
  // Requirements: 9.2
  if (isZip) {
    return true;
  }

  // Show for large files (> 100MB)
  // Requirements: 9.1
  if (totalBytes !== null && totalBytes > LARGE_FILE_THRESHOLD_BYTES) {
    return true;
  }

  return false;
}

/**
 * Checks if the user has disabled download confirmations.
 * Requirements: 9.7
 */
export function isConfirmationDisabled(): boolean {
  try {
    return localStorage.getItem(DONT_ASK_AGAIN_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Sets the "Don't ask again" preference.
 * Requirements: 9.7
 */
export function setConfirmationDisabled(disabled: boolean): void {
  try {
    if (disabled) {
      localStorage.setItem(DONT_ASK_AGAIN_KEY, "true");
    } else {
      localStorage.removeItem(DONT_ASK_AGAIN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Calculates estimated download time based on typical transfer rates.
 * Requirements: 9.4
 */
export function calculateEstimatedDownloadTime(totalBytes: number | null): number | null {
  if (totalBytes === null || totalBytes <= 0) {
    return null;
  }
  return Math.ceil(totalBytes / TYPICAL_TRANSFER_RATE_BYTES_PER_SEC);
}
