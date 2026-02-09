function fallbackRandomUUID(): `${string}-${string}-${string}-${string}-${string}` {
  const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return uuid as `${string}-${string}-${string}-${string}-${string}`;
}

(function ensureRandomUUID() {
  try {
    const globalAny = globalThis as typeof globalThis & {
      crypto?: Crypto & { randomUUID?: () => string };
    };

    if (globalAny.crypto && typeof globalAny.crypto.randomUUID === "function") {
      return;
    }

    const cryptoObj = globalAny.crypto ?? ({} as Crypto & { randomUUID?: Crypto["randomUUID"] });

    if (typeof cryptoObj.randomUUID !== "function") {
      try {
        cryptoObj.randomUUID = fallbackRandomUUID;
      } catch {
        // Ignore assignment failures (read-only crypto object)
      }
    }

    if (!globalAny.crypto) {
      try {
        Object.defineProperty(globalAny, "crypto", {
          value: cryptoObj,
          configurable: true,
          writable: true,
        });
      } catch {
        // Ignore defineProperty failures
      }
    }
  } catch {
    // Ignore unexpected errors to avoid breaking app startup
  }
})();
