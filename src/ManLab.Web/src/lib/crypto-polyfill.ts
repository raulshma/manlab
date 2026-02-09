function fallbackRandomUUID() {
  const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return uuid;
}

(function ensureRandomUUID() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const globalAny: any =
      typeof globalThis !== "undefined"
        ? globalThis
        : typeof window !== "undefined"
        ? window
        : typeof self !== "undefined"
        ? self
        : Function("return this")();

    if (!globalAny.crypto) {
      try {
        Object.defineProperty(globalAny, "crypto", {
          value: {},
          writable: true,
          configurable: true,
        });
      } catch {
        // Ignore defineProperty failures
        return;
      }
    }

    // If crypto exists but randomUUID is missing
    if (typeof globalAny.crypto.randomUUID !== "function") {
      try {
        // Try direct assignment first
        globalAny.crypto.randomUUID = fallbackRandomUUID;
      } catch {
        // Ignore assignment failures
      }

      // Check if assignment worked
      if (typeof globalAny.crypto.randomUUID !== "function") {
        try {
          // Try defining property if assignment failed (e.g. read-only object)
          Object.defineProperty(globalAny.crypto, "randomUUID", {
            value: fallbackRandomUUID,
            configurable: true,
            writable: true,
            enumerable: true,
          });
        } catch (e) {
          console.warn("Failed to polyfill crypto.randomUUID via defineProperty:", e);
        }
      }
    }
  } catch (e) {
    console.error("Error in crypto-polyfill:", e);
  }
})();
