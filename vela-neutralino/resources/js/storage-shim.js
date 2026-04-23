// window.storage shim for the Vela monolith.
//
// In the Claude.ai artifact runtime, window.storage is provided by the host
// and persists across sessions (the same API Claude's artifact proxy uses).
// Vela reads/writes a handful of keys — primarily "vela-deck" and per-module
// dirty markers. In Neutralino we mirror the API against Neutralino.storage
// so state survives app restarts. If Neutralino APIs are unavailable (for
// example while this file is still loading), we fall back to localStorage so
// Vela's initial reads don't throw — the localStorage values are later
// mirrored into Neutralino.storage once it comes online.
//
// Shape matches artifact behaviour: { value: string } | null on get.

(() => {
  const ready = new Promise((resolve) => {
    if (window.NL_TOKEN) return resolve();
    window.addEventListener("nl-ready", resolve, { once: true });
  });

  const has = (key) => new Promise((r) => {
    if (!window.Neutralino || !Neutralino.storage) return r(false);
    Neutralino.storage.getKeys().then((keys) => r(keys.includes(key))).catch(() => r(false));
  });

  window.storage = {
    async get(key) {
      try {
        await ready;
        if (await has(key)) {
          const value = await Neutralino.storage.getData(key);
          return { value };
        }
      } catch { /* fall through */ }
      const v = localStorage.getItem(key);
      return v != null ? { value: v } : null;
    },
    async set(key, value) {
      const str = typeof value === "string" ? value : JSON.stringify(value);
      try { localStorage.setItem(key, str); } catch {}
      try {
        await ready;
        await Neutralino.storage.setData(key, str);
      } catch { /* localStorage already captured it */ }
    },
    async delete(key) {
      try { localStorage.removeItem(key); } catch {}
      try {
        await ready;
        await Neutralino.storage.setData(key, null);
      } catch {}
    },
  };
})();
