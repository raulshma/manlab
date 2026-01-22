const REALTIME_KEY = "manlab:network:realtime";
const NOTIFY_KEY = "manlab:network:notifications";
const REALTIME_EVENT = "manlab:network:realtime";
const NOTIFY_EVENT = "manlab:network:notifications";

function getBooleanPreference(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  const raw = localStorage.getItem(key);
  if (raw === null) return defaultValue;
  return raw === "true";
}

export function isRealtimeEnabled(): boolean {
  return getBooleanPreference(REALTIME_KEY, true);
}

export function isNotificationsEnabled(): boolean {
  return getBooleanPreference(NOTIFY_KEY, true);
}

export function setRealtimeEnabled(value: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(REALTIME_KEY, String(value));
  window.dispatchEvent(new Event(REALTIME_EVENT));
}

export function setNotificationsEnabled(value: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NOTIFY_KEY, String(value));
  window.dispatchEvent(new Event(NOTIFY_EVENT));
}

export function subscribeRealtimePreference(callback: (enabled: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback(isRealtimeEnabled());
  window.addEventListener(REALTIME_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(REALTIME_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function subscribeNotificationPreference(callback: (enabled: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback(isNotificationsEnabled());
  window.addEventListener(NOTIFY_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(NOTIFY_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}