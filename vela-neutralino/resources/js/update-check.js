// Update notifier — checks a static manifest on GitHub for new versions.
//
// Fetches once per 24 hours, fire-and-forget after Vela mounts. Never blocks
// startup, fails silently on network errors. Shows a dismissible modal if a
// newer version exists, with elevated prominence when the current version is
// below the minimum safe version.
//
// The release URL is hardcoded from the version string — it is NOT read from
// the manifest. This eliminates path-traversal and reduces the manifest
// poisoning surface. See SECURITY.md layer 7.
//
// Pure DOM, textContent-only (no innerHTML). Follows deck-warning.js pattern.

const MANIFEST_URL =
  "https://raw.githubusercontent.com/agentiapt/vela-slides/main/vela-neutralino/update-manifest.json";
const RELEASE_URL_PREFIX =
  "https://github.com/agentiapt/vela-slides/releases/tag/v";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SECURITY_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MANIFEST_BYTES = 10240;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

let checking = false;

// ---------------------------------------------------------------------------
// Semver helpers
// ---------------------------------------------------------------------------

function parseSemver(str) {
  if (typeof str !== "string") return null;
  const s = str.replace(/^v/, "");
  if (!SEMVER_RE.test(s)) return null;
  return s.split(".").map(Number);
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

function validateManifest(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { latest, minSafeVersion } = raw;
  if (typeof latest !== "string" || typeof minSafeVersion !== "string") return null;
  if (!parseSemver(latest) || !parseSemver(minSafeVersion)) return null;
  return { latest, minSafeVersion };
}

// ---------------------------------------------------------------------------
// Release URL builder
// ---------------------------------------------------------------------------

function buildReleaseUrl(version) {
  if (version.includes("..")) return null;
  const raw = RELEASE_URL_PREFIX + version;
  try {
    const resolved = new URL(raw).href;
    if (!resolved.startsWith("https://github.com/agentiapt/vela-slides/")) return null;
    if (resolved.includes("..")) return null;
    return resolved;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function shouldCheck(config) {
  if (config.checkForUpdates === false) return false;
  const last = config.lastUpdateCheck;
  if (typeof last === "number" && Date.now() - last < CHECK_INTERVAL_MS) return false;
  return true;
}

function isSecurityDismissed(config, minSafeVersion) {
  const d = config.dismissedSecurity;
  if (!d || typeof d !== "object") return false;
  if (d.version !== minSafeVersion) return false;
  if (typeof d.ts !== "number") return false;
  return Date.now() - d.ts < SECURITY_DISMISS_MS;
}

// ---------------------------------------------------------------------------
// Modal UI
// ---------------------------------------------------------------------------

let stylesInstalled = false;

function installStyles() {
  if (stylesInstalled) return;
  stylesInstalled = true;
  const s = document.createElement("style");
  s.textContent = `
    #vela-update-notice { position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.55); display: none; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
    #vela-update-notice.open { display: flex; }
    #vela-update-notice .box { background: #0f172a; border-radius: 14px; width: min(480px, 90vw); padding: 22px 24px; box-shadow: 0 24px 60px rgba(0,0,0,0.55); color: #e2e8f0; }
    #vela-update-notice .box.normal { border: 1px solid #3b82f6; }
    #vela-update-notice .box.security { border: 1px solid #dc2626; }
    #vela-update-notice h2 { font-size: 16px; font-weight: 700; margin: 0 0 6px; letter-spacing: 0.01em; }
    #vela-update-notice h2.normal { color: #60a5fa; }
    #vela-update-notice h2.security { color: #f87171; }
    #vela-update-notice .sub { font-size: 12px; color: #94a3b8; margin-bottom: 12px; font-family: ui-monospace, monospace; }
    #vela-update-notice p { font-size: 13px; line-height: 1.55; color: #cbd5e1; margin: 0 0 10px; }
    #vela-update-notice .callout { font-size: 13px; line-height: 1.55; color: #fde68a; border-left: 2px solid #f59e0b; padding: 8px 12px; margin: 10px 0 14px; background: rgba(245,158,11,0.08); border-radius: 0 6px 6px 0; }
    #vela-update-notice .url-text { font-size: 11px; color: #94a3b8; font-family: ui-monospace, monospace; word-break: break-all; padding: 8px 10px; background: rgba(255,255,255,0.04); border-radius: 6px; margin-top: 8px; user-select: all; cursor: text; }
    #vela-update-notice .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; }
    #vela-update-notice button { font-size: 13px; padding: 8px 16px; border-radius: 7px; cursor: pointer; font-family: inherit; font-weight: 600; }
    #vela-update-notice button.primary { border: 1px solid #3b82f6; background: #3b82f6; color: #fff; }
    #vela-update-notice button.primary:hover { background: #60a5fa; border-color: #60a5fa; }
    #vela-update-notice button.primary.security { border-color: #dc2626; background: #dc2626; }
    #vela-update-notice button.primary.security:hover { background: #ef4444; border-color: #ef4444; }
    #vela-update-notice button.ghost { border: 1px solid #334155; background: transparent; color: #94a3b8; }
    #vela-update-notice button.ghost:hover { border-color: #64748b; color: #cbd5e1; }
    #vela-update-notice button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
  `;
  document.head.appendChild(s);
}

function showUpdateModal(info, isSecurity) {
  installStyles();
  return new Promise((resolve) => {
    let host = document.getElementById("vela-update-notice");
    if (host) host.remove();
    host = document.createElement("div");
    host.id = "vela-update-notice";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");

    const box = document.createElement("div");
    box.className = "box " + (isSecurity ? "security" : "normal");

    const h2 = document.createElement("h2");
    h2.className = isSecurity ? "security" : "normal";
    h2.textContent = isSecurity ? "Security Update Required" : "Update Available";
    box.appendChild(h2);

    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = isSecurity
      ? "Minimum safe version: v" + info.minSafeVersion + " — you have v" + info.current
      : "Vela v" + info.latest + " is available — you have v" + info.current;
    box.appendChild(sub);

    if (isSecurity) {
      const callout = document.createElement("div");
      callout.className = "callout";
      callout.textContent =
        "Your version of Vela is below the minimum safe version. Please update to continue safely.";
      box.appendChild(callout);
    } else {
      const p = document.createElement("p");
      p.textContent = "A new version is ready.";
      box.appendChild(p);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    const dismiss = document.createElement("button");
    dismiss.className = "ghost";
    dismiss.textContent = isSecurity ? "Continue anyway" : "Remind me later";
    dismiss.onclick = () => { cleanup(); resolve("dismiss"); };
    actions.appendChild(dismiss);

    const view = document.createElement("button");
    view.className = "primary" + (isSecurity ? " security" : "");
    view.textContent = "View release";
    view.onclick = () => {
      const w = window.open(info.releaseUrl, "_blank");
      if (!w) {
        // window.open blocked — show the URL as copyable text
        const fallback = document.createElement("div");
        fallback.className = "url-text";
        fallback.textContent = info.releaseUrl;
        box.appendChild(fallback);
        return;
      }
      cleanup();
      resolve("navigate");
    };
    actions.appendChild(view);

    box.appendChild(actions);
    host.appendChild(box);
    document.body.appendChild(host);

    setTimeout(() => { try { view.focus(); } catch {} }, 30);
    requestAnimationFrame(() => host.classList.add("open"));

    host.addEventListener("click", (e) => {
      if (e.target === host) { cleanup(); resolve("dismiss"); }
    });

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup();
        resolve("dismiss");
      }
    }
    document.addEventListener("keydown", onKey, true);

    function cleanup() {
      document.removeEventListener("keydown", onKey, true);
      host.classList.remove("open");
      setTimeout(() => { try { host.remove(); } catch {} }, 150);
    }
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// opts.force (manual "Check for updates" from the About dialog) bypasses the
// 24h throttle and prior dismissals, and the returned status lets the caller
// tell the user the outcome. Returns: "update" | "uptodate" | "error" |
// "skipped" | "checking".
export async function checkForUpdate(configStore, opts = {}) {
  if (checking) return "checking";
  checking = true;
  try {
    return await _check(configStore, !!opts.force);
  } finally {
    checking = false;
  }
}

async function _check(configStore, force = false) {
  const config = await configStore.get();
  if (!force && !shouldCheck(config)) return "skipped";

  const current = typeof NL_APPVERSION === "string" ? NL_APPVERSION : null;
  if (!current || !parseSemver(current)) return "error";

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  let res;
  try {
    res = await fetch(MANIFEST_URL, { signal: ac.signal });
  } catch { clearTimeout(timer); return "error"; } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return "error";

  const cl = res.headers.get("content-length");
  if (cl && Number(cl) > MAX_MANIFEST_BYTES) return "error";

  const text = await res.text();
  if (text.length > MAX_MANIFEST_BYTES) return "error";

  let parsed;
  try { parsed = JSON.parse(text); } catch { return "error"; }
  const manifest = validateManifest(parsed);
  if (!manifest) return "error";

  await configStore.patch({ lastUpdateCheck: Date.now() });

  if (compareSemver(current, manifest.latest) >= 0) return "uptodate";

  const releaseUrl = buildReleaseUrl(manifest.latest);
  if (!releaseUrl) return "error";

  const isSecurity = compareSemver(current, manifest.minSafeVersion) < 0;

  // A forced manual check always surfaces an available update, even one the user
  // dismissed earlier; the background check still honours dismissals.
  if (!force) {
    if (!isSecurity) {
      if (config.dismissedVersion === manifest.latest) return "update";
    } else {
      if (isSecurityDismissed(config, manifest.minSafeVersion)) return "update";
    }
  }

  const result = await showUpdateModal(
    { latest: manifest.latest, minSafeVersion: manifest.minSafeVersion, current, releaseUrl },
    isSecurity
  );

  if (result === "dismiss") {
    if (isSecurity) {
      await configStore.patch({
        dismissedSecurity: { version: manifest.minSafeVersion, ts: Date.now() },
      });
    } else {
      await configStore.patch({ dismissedVersion: manifest.latest });
    }
  }
  return "update";
}
