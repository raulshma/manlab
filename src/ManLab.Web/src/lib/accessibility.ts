/**
 * Accessibility Utilities for Network Scanning Tools
 * Provides screen reader announcements, focus management, and ARIA helpers.
 */

// ============================================================================
// Live Region Announcements
// ============================================================================

let liveRegion: HTMLDivElement | null = null;
let politeRegion: HTMLDivElement | null = null;

/**
 * Initialize a live region for screen reader announcements.
 * Creates two regions: one for assertive (urgent) and one for polite announcements.
 */
function ensureLiveRegions(): { assertive: HTMLDivElement; polite: HTMLDivElement } {
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "assertive");
    liveRegion.setAttribute("aria-atomic", "true");
    liveRegion.className =
      "sr-only fixed -left-[9999px] w-[1px] h-[1px] overflow-hidden";
    document.body.appendChild(liveRegion);
  }

  if (!politeRegion) {
    politeRegion = document.createElement("div");
    politeRegion.setAttribute("role", "status");
    politeRegion.setAttribute("aria-live", "polite");
    politeRegion.setAttribute("aria-atomic", "true");
    politeRegion.className =
      "sr-only fixed -left-[9999px] w-[1px] h-[1px] overflow-hidden";
    document.body.appendChild(politeRegion);
  }

  return { assertive: liveRegion, polite: politeRegion };
}

/**
 * Announce a message to screen readers.
 * @param message - The message to announce
 * @param priority - "assertive" for urgent messages, "polite" for non-urgent
 */
export function announce(
  message: string,
  priority: "assertive" | "polite" = "polite"
): void {
  if (typeof document === "undefined") return;

  const regions = ensureLiveRegions();
  const region = priority === "assertive" ? regions.assertive : regions.polite;

  // Clear and re-set to trigger announcement
  region.textContent = "";
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

/**
 * Announce scan progress to screen readers.
 * Throttled to avoid overwhelming announcements.
 */
let lastProgressAnnouncement = 0;
const PROGRESS_THROTTLE_MS = 5000;

export function announceProgress(
  percentComplete: number,
  found: number,
  total: number,
  scanType: string = "Scan"
): void {
  const now = Date.now();
  if (now - lastProgressAnnouncement < PROGRESS_THROTTLE_MS) return;
  lastProgressAnnouncement = now;

  const rounded = Math.round(percentComplete);
  if (rounded === 100) {
    announce(`${scanType} complete. ${found} items found.`, "assertive");
  } else if (rounded % 25 === 0) {
    announce(
      `${scanType} ${rounded}% complete. ${found} of ${total} items processed.`,
      "polite"
    );
  }
}

/**
 * Announce a scan event (start, completion, failure).
 */
export function announceScanEvent(
  event: "started" | "completed" | "failed",
  scanType: string,
  details?: string
): void {
  const messages: Record<typeof event, string> = {
    started: `${scanType} started${details ? `. ${details}` : ""}`,
    completed: `${scanType} completed${details ? `. ${details}` : ""}`,
    failed: `${scanType} failed${details ? `. ${details}` : ""}`,
  };

  announce(messages[event], event === "failed" ? "assertive" : "polite");
}

/**
 * Announce discovery of a new item.
 */
export function announceDiscovery(itemType: string, itemName: string): void {
  announce(`${itemType} discovered: ${itemName}`, "polite");
}

// ============================================================================
// Focus Management
// ============================================================================

/**
 * Focus the first focusable element within a container.
 */
export function focusFirstElement(container: HTMLElement | null): void {
  if (!container) return;

  const focusable = container.querySelector<HTMLElement>(
    'button, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  focusable?.focus();
}

/**
 * Trap focus within a container (for modals/dialogs).
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableElements = container.querySelectorAll<HTMLElement>(
    'button, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement?.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement?.focus();
    }
  };

  container.addEventListener("keydown", handleKeyDown);
  firstElement?.focus();

  return () => {
    container.removeEventListener("keydown", handleKeyDown);
  };
}

// ============================================================================
// Keyboard Navigation
// ============================================================================

/**
 * Handle arrow key navigation for lists/grids.
 */
export function handleArrowNavigation(
  e: React.KeyboardEvent,
  currentIndex: number,
  totalItems: number,
  onNavigate: (newIndex: number) => void,
  columns: number = 1
): void {
  let newIndex = currentIndex;

  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      newIndex = Math.max(0, currentIndex - columns);
      break;
    case "ArrowDown":
      e.preventDefault();
      newIndex = Math.min(totalItems - 1, currentIndex + columns);
      break;
    case "ArrowLeft":
      e.preventDefault();
      newIndex = Math.max(0, currentIndex - 1);
      break;
    case "ArrowRight":
      e.preventDefault();
      newIndex = Math.min(totalItems - 1, currentIndex + 1);
      break;
    case "Home":
      e.preventDefault();
      newIndex = 0;
      break;
    case "End":
      e.preventDefault();
      newIndex = totalItems - 1;
      break;
    default:
      return;
  }

  if (newIndex !== currentIndex) {
    onNavigate(newIndex);
  }
}

/**
 * Handle Enter/Space key activation.
 */
export function handleActivation(
  e: React.KeyboardEvent,
  onActivate: () => void
): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onActivate();
  }
}

// ============================================================================
// ARIA Helpers
// ============================================================================

/**
 * Generate ARIA attributes for a progress indicator.
 */
export function getProgressAriaProps(
  value: number,
  label: string
): Record<string, string | number> {
  return {
    role: "progressbar",
    "aria-valuenow": Math.round(value),
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-label": label,
    "aria-valuetext": `${Math.round(value)}% complete`,
  };
}

/**
 * Generate ARIA attributes for a list container.
 */
export function getListAriaProps(
  label: string,
  itemCount: number
): Record<string, string | number> {
  return {
    role: "list",
    "aria-label": label,
    "aria-describedby": `${itemCount} items`,
  };
}

/**
 * Generate ARIA attributes for a list item.
 */
export function getListItemAriaProps(
  index: number,
  total: number
): Record<string, string | number> {
  return {
    role: "listitem",
    "aria-posinset": index + 1,
    "aria-setsize": total,
  };
}

/**
 * Generate ARIA attributes for a status badge.
 */
export function getStatusAriaProps(
  status: string,
  type: "success" | "error" | "warning" | "info" = "info"
): Record<string, string> {
  return {
    role: "status",
    "aria-live": type === "error" ? "assertive" : "polite",
    "aria-label": `Status: ${status}`,
  };
}

// ============================================================================
// Reduced Motion
// ============================================================================

/**
 * Check if the user prefers reduced motion.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Get transition duration respecting reduced motion preference.
 */
export function getAccessibleDuration(normalDurationMs: number): number {
  return prefersReducedMotion() ? 0 : normalDurationMs;
}

// ============================================================================
// Color Contrast Helpers
// ============================================================================

/**
 * Ensure text has sufficient contrast for the given status.
 * Returns CSS classes for WCAG AA compliant text colors.
 */
export function getContrastSafeStatusColor(
  status: "success" | "error" | "warning" | "info"
): string {
  const colors: Record<typeof status, string> = {
    success: "text-green-600 dark:text-green-400",
    error: "text-red-600 dark:text-red-400",
    warning: "text-amber-600 dark:text-amber-400",
    info: "text-blue-600 dark:text-blue-400",
  };
  return colors[status];
}

/**
 * Get high contrast variant of a status color for backgrounds.
 */
export function getContrastSafeStatusBg(
  status: "success" | "error" | "warning" | "info"
): string {
  const colors: Record<typeof status, string> = {
    success: "bg-green-100 dark:bg-green-900/30",
    error: "bg-red-100 dark:bg-red-900/30",
    warning: "bg-amber-100 dark:bg-amber-900/30",
    info: "bg-blue-100 dark:bg-blue-900/30",
  };
  return colors[status];
}
