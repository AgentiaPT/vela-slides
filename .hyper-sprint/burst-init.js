// burst-init.js — Vela-specific pre-boot init injected by the burst-bug-hunter server
// (config: initScript). Installs an in-memory async window.storage polyfill so the
// save-status / persistence path is exercisable in the offline render (no host storage).
// The small write delay makes the Saving -> Saved transition observable.
(() => {
  const m = {};
  window.__vmem = m;
  window.storage = {
    get: (k) => Promise.resolve(m[k] != null ? { value: m[k] } : null),
    set: (k, v) => new Promise((r) => setTimeout(() => { m[k] = v; r(); }, 300)),
    delete: (k) => { delete m[k]; return Promise.resolve(); },
  };
})();
