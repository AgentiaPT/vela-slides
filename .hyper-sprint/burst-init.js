// burst-init.js — Vela-specific pre-boot init injected by the burst-bug-hunter server
// (config: initScript). Installs an in-memory async window.storage polyfill so the
// persistence path is exercisable offline. The small write delay makes completion
// observable after the app's autosave debounce.
(() => {
  const m = {};
  window.__vmem = m;
  window.storage = {
    get: (k) => Promise.resolve(m[k] != null ? { value: m[k] } : null),
    set: (k, v) => new Promise((r) => setTimeout(() => { m[k] = v; r(); }, 300)),
    delete: (k) => { delete m[k]; return Promise.resolve(); },
  };
})();
