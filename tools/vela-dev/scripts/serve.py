#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Local Server — Two-way live editing in browser.

Serves the Vela app with deck JSON files. Supports two modes:
  - Folder mode: browse and open any deck in a directory (Jupyter-style)
  - File mode:   serve a single deck file (legacy)

File changes push to browser via long-polling. Browser edits save back via POST.

Usage:
  python3 serve.py <folder>     [--port 3030] [--no-open]
  python3 serve.py <deck.vela>  [--port 3030] [--no-open]
"""

import hashlib
import errno
import hmac
import http.cookies
import http.server
import json
import os
import re
import secrets
import socket
import stat
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.parse
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import unquote, quote


# ── Security ──────────────────────────────────────────────────────────
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]", "0.0.0.0"}
DECK_EXT = ".vela"  # Only files with this extension are listed/served/accepted
MAX_THREADS = 20


# ── Paths & imports ───────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))          # tools/vela-dev/scripts
DEV_DIR = os.path.dirname(SCRIPT_DIR)                             # tools/vela-dev
REPO_ROOT = os.path.dirname(os.path.dirname(DEV_DIR))            # repo root
SKILL_DIR = os.path.join(REPO_ROOT, "skills", "vela-slides")    # lean shipped skill
# vela.py / assemble.py stay in the lean skill; import them from there.
sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))
sys.path.insert(0, SCRIPT_DIR)  # sibling dev-tool modules (agent_backend)
from vela import expand_deck as _expand_compact_deck
from assemble import escape_for_script_context
TEMPLATE_PATH = os.path.join(SKILL_DIR, "app", "vela.jsx")       # shipped monolith
LOCAL_HTML_PATH = os.path.join(DEV_DIR, "local.html")            # dev preview shell
BROWSER_JS_PATH = os.path.join(DEV_DIR, "browser.js")            # folder-browser client code

# Content-Security-Policy for the local dev server. The hosted Claude.ai
# artifact runs inside a sandboxed iframe whose CSP already blocks outbound
# requests; the local server is a top-level page with no such backstop, so a
# deck-supplied value that slipped any client sanitizer could fire a real
# external request here. The key egress channels are pinned: img-src is
# same-origin + inline data only (no external image beacons), and connect-src
# is a closed allowlist (no fetch/XHR/beacon/WebSocket to attacker hosts).
# script-src/style-src stay permissive enough for the in-browser toolchain the
# app legitimately needs — every external origin below is a fixed, known
# third-party dependency of the app, not attacker-controlled:
#   - script: esm.sh (React/lucide via importmap), unpkg (Babel CDN fallback;
#     /vendor → 'self' when vendored), cdnjs (html2canvas for PDF export),
#     'unsafe-eval' for Babel's runtime JSX transpile, 'unsafe-inline' for the
#     inline bootstrap scripts.
#   - style: 'unsafe-inline' (all Vela styling is inline) + fonts.googleapis.com
#     (@import of the Google Fonts stylesheet).
#   - font: 'self' data: + fonts.gstatic.com (the actual font files).
#   - img: 'self' data: only.
#   - connect: 'self', api.anthropic.com (Vera engine), the localhost
#     hot-reload/Claude channel (a separate port), and esm.sh module sourcemaps.
# To tighten further on a machine that never uses in-browser Vera, drop
# api.anthropic.com from connect-src.
CSP_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh https://unpkg.com https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://api.anthropic.com https://esm.sh http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
])

# The folder browser is a separate, self-contained page: static markup plus a
# single same-origin script. It needs none of the app's in-browser toolchain,
# so it does not inherit the app's permissive policy — it gets a strict one.
# Without 'unsafe-inline' in script-src, an injected event-handler attribute
# cannot execute even if markup-building were ever reintroduced here; that is
# the point of keeping this policy separate rather than reusing CSP_POLICY.
BROWSER_CSP = "; ".join([
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",  # the page's own <style> block; cannot execute JS
    "img-src 'self' data:",              # inline SVG favicon
    "connect-src 'self'",                # only /api/decks
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
])


# ── Version tracker for long-polling ──────────────────────────────────
class DeckVersionTracker:
    """Tracks deck version for long-poll clients."""

    def __init__(self):
        self._lock = threading.Lock()
        self._version = 1
        self._event = threading.Event()
        self._reload = False

    @property
    def version(self):
        with self._lock:
            return self._version

    @property
    def needs_reload(self):
        with self._lock:
            if self._reload:
                self._reload = False
                return True
            return False

    def bump(self, reload=False):
        with self._lock:
            self._version += 1
            v = self._version
            if reload:
                self._reload = True
        self._event.set()
        self._event = threading.Event()  # reset for next wait
        return v

    def wait_for_change(self, client_version, timeout=25):
        """Block until version changes or timeout. Returns True if changed."""
        if client_version < self.version:
            return True  # already behind
        evt = self._event
        return evt.wait(timeout=timeout)


# ── File browser HTML ─────────────────────────────────────────────────
def build_browser_js():
    """Return the folder-browser client code, served as an external script.

    Kept out of the HTML so the browser page can run under BROWSER_CSP with no
    'unsafe-inline' in script-src.
    """
    with open(BROWSER_JS_PATH, "r", encoding="utf-8") as f:
        return f.read()


def build_browser_html():
    """Return the HTML for the Jupyter-style deck file browser."""
    return r"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vela Slides — Decks</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⛵</text></svg>" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; min-height: 100vh; }
    body { background: #0f172a; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif; }

    .header { padding: 32px 40px 24px; border-bottom: 1px solid #1e293b; }
    .header-row { display: flex; align-items: center; gap: 16px; }
    .header .boat { font-size: 36px; }
    .header .title { font-size: 22px; font-weight: 700; letter-spacing: 3px; }
    .header .subtitle { font-size: 13px; color: #64748b; margin-top: 6px; }

    .toolbar { display: flex; align-items: center; gap: 12px; padding: 16px 40px; border-bottom: 1px solid #1e293b; }
    .search-box { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 8px 14px; color: #e2e8f0; font-size: 14px; font-family: system-ui; outline: none; width: 280px; transition: border-color 0.15s; }
    .search-box:focus { border-color: #3b82f6; }
    .search-box::placeholder { color: #475569; }
    .toolbar .deck-count { font-size: 13px; color: #64748b; font-family: 'SF Mono', 'Fira Code', monospace; flex: 1; }
    .btn { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 8px 16px; color: #e2e8f0; font-size: 13px; cursor: pointer; transition: border-color 0.15s, background 0.15s; font-family: system-ui; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover { border-color: #3b82f6; background: #1e293b; }
    .btn-primary { background: #3b82f6; border-color: #3b82f6; }
    .btn-primary:hover { background: #2563eb; }

    .deck-list { padding: 0 40px 40px; }
    table { width: 100%; border-collapse: collapse; }
    th { position: sticky; top: 0; background: #0f172a; text-align: left; padding: 12px 16px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #1e293b; cursor: pointer; user-select: none; white-space: nowrap; }
    th:hover { color: #94a3b8; }
    th .sort-arrow { font-size: 10px; margin-left: 4px; opacity: 0.5; }
    th.sorted { color: #3b82f6; }
    th.sorted .sort-arrow { opacity: 1; }
    td { padding: 10px 16px; border-bottom: 1px solid #1e293b20; font-size: 14px; white-space: nowrap; }
    tr.deck-row { cursor: pointer; transition: background 0.12s; }
    tr.deck-row:hover { background: #1e293b; }
    td.col-title { max-width: 400px; overflow: hidden; text-overflow: ellipsis; }
    td.col-title a { color: #e2e8f0; text-decoration: none; font-weight: 600; }
    td.col-title a:hover { color: #3b82f6; }
    td.col-file { color: #94a3b8; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
    td.col-slides { text-align: right; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; }
    td.col-size { text-align: right; color: #94a3b8; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
    td.col-modified { color: #94a3b8; font-size: 13px; }
    td.col-badge { text-align: center; }
    .deck-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #1e293b; color: #94a3b8; border: 1px solid #334155; }

    .empty-state { text-align: center; padding: 80px 20px; color: #475569; }
    .empty-state .icon { font-size: 48px; margin-bottom: 16px; }
    .empty-state .msg { font-size: 15px; }

    .loading { text-align: center; padding: 60px; color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-row">
      <div class="boat">⛵</div>
      <div>
        <div class="title">VELA</div>
        <div class="subtitle" id="folder-path"></div>
      </div>
    </div>
  </div>
  <div class="toolbar">
    <input type="text" class="search-box" id="search-input" placeholder="Search decks…" />
    <span class="deck-count" id="deck-count"></span>
  </div>
  <div id="deck-list" class="deck-list">
    <div class="loading">Loading decks…</div>
  </div>

  <!-- Client code lives in an external same-origin file (tools/vela-dev/browser.js)
       so this page can run with no 'unsafe-inline' in script-src. Do not inline it. -->
  <script src="/browser.js" defer></script>
</body>
</html>"""


# One credential compare for both local servers. It lives in agent_backend
# (which also runs standalone, so it cannot depend on this module) and is
# imported here rather than copied — a second copy is how these two drift.
from agent_backend import token_equal  # noqa: E402  (path set up above)


# ── Deck file I/O ─────────────────────────────────────────────────────
# The umask is process-global, so reading it (the only way to sample it) is a
# read-modify-write that cannot be made thread-safe. Do it ONCE here, at import,
# while the process is still single-threaded; the server then applies the result
# with fchmod and never touches the process umask again. Doing it per write let
# concurrent saves observe the temporarily-zeroed umask and create decks that
# were readable and writable by everyone.
_UMASK = os.umask(0)
os.umask(_UMASK)
DECK_FILE_MODE = 0o666 & ~_UMASK  # what a plain open(path, "w") would have made
MAX_DECK_BYTES = 32 * 1024 * 1024    # a deck file we are willing to read
MAX_DECK_PAYLOAD = 64 * 1024 * 1024  # ...and to serialise into a page after expansion
SAVE_TMP_PREFIX = ".vela-save-"   # write_deck_json's temp; swept at startup
SAVE_TMP_SUFFIX = ".tmp"


def console_safe(text, limit=160):
    """Render untrusted text for the operator's terminal.

    Deck names and OS error strings carry project-directory content, and a
    terminal executes what it is sent: escape sequences clear the screen, retitle
    the window, or forge a reassuring log line the operator then believes. Escape
    every non-printable and cap the length. (Names reaching the HTTP layer are
    rejected outright by _validate_deck_name — this is the console's own guard,
    which also covers text that never passed through it, such as OS errors.)"""
    text = str(text)
    out = "".join(c if c.isprintable() or c == " " else f"\\x{ord(c):02x}"
                  for c in text[:limit])
    return out + ("…" if len(text) > limit else "")


def pin_dir(path):
    """Open a directory to use as a dir_fd anchor, or None where unsupported.

    SECURITY (CWE-59/61/367): no-follow flags and containment checks constrain
    only the FINAL path component — every by-path call re-resolves the
    directories above it, so replacing a directory NAME relocates the whole
    operation, however carefully the leaf was guarded. Resolving the directory
    once and addressing entries relative to that descriptor pins the path: the
    folder we list, read and write stays the one the server started on, whatever
    its name comes to refer to later. Windows has no dir_fd-relative calls, so
    callers there fall back to by-path access, which the leaf guards still
    cover."""
    # NB: os.replace is deliberately not probed here — it takes src_dir_fd /
    # dst_dir_fd rather than dir_fd, so it never appears in supports_dir_fd.
    # write_deck_json falls back to the by-path rename if renameat is missing.
    needed = (os.open, os.stat, os.unlink)
    if not all(fn in os.supports_dir_fd for fn in needed):
        return None
    try:
        return os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return None

# SECURITY (CWE-59/61/367): the served folder is the user's project, so a
# deck-named ENTRY in it is untrusted even when its name passed validation.
# Realpath containment (_safe_deck_path) sees a symlink but CANNOT see a hard
# link — a hard link to a file outside the folder resolves inside it — and
# re-opening by path after the check re-resolves the name, so a swap between
# check and open escapes containment anyway. Both directions go through the two
# functions below, and neither ever writes through, or reads out of, an entry it
# did not verify on the descriptor it is using.

def read_deck_json(path, dir_fd=None):
    """Read + parse a deck file. Raises OSError/ValueError on anything unusable.

    Opens no-follow, then takes the content from the SAME descriptor it
    verified, so the bytes cannot come from a re-resolved path. A link count
    above one means the inode is reachable under another name (possibly outside
    the folder): treated as an escape, not as a deck."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    kwargs = {"dir_fd": dir_fd} if dir_fd is not None else {}
    if os.name == "nt":
        # No O_NOFOLLOW on Windows: reject reparse points by name up front so
        # this reader is not weaker than the runtime-file one.
        wst = os.stat(path, follow_symlinks=False, **kwargs)
        if getattr(wst, "st_file_attributes", 0) & 0x400:  # REPARSE_POINT
            raise OSError(f"Refusing to read a reparse point: {path}")
    fd = os.open(path, flags, **kwargs)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_nlink > 1:
            raise OSError(f"Not a plain, single-linked file: {path}")
        # Size-gate on the descriptor: parsing is what costs memory, and the
        # folder chooses the file. A real deck is orders of magnitude smaller.
        if st.st_size > MAX_DECK_BYTES:
            raise OSError(f"Deck file exceeds {MAX_DECK_BYTES} bytes: {path}")
        f = os.fdopen(fd, "r", encoding="utf-8")
    except BaseException:
        # fdopen takes ownership, so the fd may already be closed here; a second
        # close would raise EBADF and mask the real error.
        try:
            os.close(fd)
        except OSError:
            pass
        raise
    with f:
        # Bounded read, not json.load(f): the entry can grow between the fstat
        # above and this read, so the cap must be enforced on the bytes actually
        # taken — same shape as the other two readers.
        payload = f.buffer.read(MAX_DECK_BYTES + 1)
    if len(payload) > MAX_DECK_BYTES:
        raise OSError(f"Deck file exceeds {MAX_DECK_BYTES} bytes: {path}")
    return json.loads(payload.decode("utf-8"))


def entry_writable(path, dir_fd=None, folder=None):
    """Report whether the current user may write the existing entry.

    Advisory pre-check for write_deck_json (the write itself is an atomic
    replace, which only needs directory permission): it preserves what
    open(path, "w") used to enforce. os.access honours group/other write bits
    and root — checking only the owner bit (S_IWUSR) would wrongly refuse a
    deck writable via group/other permissions. faccessat flags are applied
    only where the platform supports them; the caller has already stat'd the
    entry no-follow and rejected links, so this stays a permissions check.
    CodeQL flags the os.access as py/path-injection, but every caller reaches
    it only after _validate_deck_name + _safe_deck_path containment (same
    unmodeled-sanitizer limitation noted on _safe_deck_path).
    """
    kwargs = {}
    if dir_fd is not None:
        if os.access in os.supports_dir_fd:
            kwargs["dir_fd"] = dir_fd
        else:
            path = os.path.join(folder or ".", path)
    if os.access in os.supports_effective_ids:
        kwargs["effective_ids"] = True
    if os.access in os.supports_follow_symlinks:
        kwargs["follow_symlinks"] = False
    return os.access(path, os.W_OK, **kwargs)


def write_deck_json(path, deck, dir_fd=None, folder=None):
    """Write a deck file by atomic replace, never through the existing entry.

    The payload lands in a freshly created temp file in the same folder and is
    then os.replace()d onto the name. rename swaps the directory ENTRY, so a
    symlink or hard link sitting there is detached instead of written through,
    and there is no window in which the name is re-resolved for the write.
    Readers also never observe a half-written deck."""
    kwargs = {"dir_fd": dir_fd} if dir_fd is not None else {}
    if folder is None:
        folder = os.path.dirname(path) or "."
    tmp = None
    # Replacing an entry does not need write permission on the FILE, only on the
    # directory — so an atomic replace would happily overwrite a deck the user
    # deliberately made read-only, which open(path, "w") could not. Keep the old
    # promise, and carry the existing file's own mode over to the replacement so
    # a private deck does not quietly become world-readable on the next save.
    mode = DECK_FILE_MODE
    try:
        dst = os.stat(path, follow_symlinks=False, **kwargs)
    except OSError:
        dst = None
    if dst is not None and stat.S_ISLNK(dst.st_mode):
        # The replace below would silently destroy a link the user made, and the
        # read path already refuses one — same reasoning as the hard-link branch.
        raise PermissionError(f"Deck file is a link: {path}")
    if dst is not None and stat.S_ISREG(dst.st_mode):
        if dst.st_nlink > 1:
            # A hard link shares its inode with another name, possibly outside
            # the folder. The atomic replace below would not write through it,
            # but silently detaching a link the user made is its own surprise —
            # refuse, matching the read path's multiply-linked refusal.
            raise PermissionError(f"Deck file is multiply-linked: {path}")
        if not entry_writable(path, dir_fd=dir_fd, folder=folder):
            raise PermissionError(f"Deck file is read-only: {path}")
        mode = stat.S_IMODE(dst.st_mode) & 0o777  # never carry setuid/setgid/sticky
    # Create the temp exclusively ourselves rather than via mkstemp, so it can be
    # made relative to the pinned directory, and so its mode is set through the
    # DESCRIPTOR. A by-path chmod here would follow a link planted at the temp
    # name in the (untrusted) folder and change the mode of a file elsewhere.
    for _ in range(8):
        cand = f"{SAVE_TMP_PREFIX}{secrets.token_hex(8)}{SAVE_TMP_SUFFIX}"
        tmp_arg = cand if dir_fd is not None else os.path.join(folder, cand)
        try:
            fd = os.open(tmp_arg, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, **kwargs)
            tmp = tmp_arg
            break
        except FileExistsError:
            continue
    if tmp is None:
        raise OSError(f"Could not create a temp file for {path}")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(deck, f, ensure_ascii=False, indent=2)
            # Apply the mode decided above — the replaced file's own mode, or
            # what a plain open(path, "w") would have produced for a new file.
            # fchmod, so it can only ever apply to the file we just created.
            if hasattr(os, "fchmod"):
                os.fchmod(f.fileno(), mode)
        if dir_fd is not None:
            try:
                os.replace(tmp, path, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
            except NotImplementedError:  # no renameat on this platform
                os.replace(os.path.join(folder, tmp), os.path.join(folder, path))
        else:
            os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp, **kwargs)
        except OSError:
            pass
        raise


# ── HTTP handler ──────────────────────────────────────────────────────
class VelaHTTPHandler(http.server.BaseHTTPRequestHandler):
    static_files = {}
    server_ref = None

    # ── Security helpers ───────────────────────────────────────────

    def _check_host(self):
        """DNS rebinding protection: reject requests from non-localhost Host."""
        raw = (self.headers.get("Host") or "").strip()
        # Parse the hostname while preserving a bracketed IPv6 literal and its
        # brackets (so "[::1]:port" matches the "[::1]" entry in ALLOWED_HOSTS
        # instead of collapsing to "[" under a naive split on ":"); for ordinary
        # host:port forms, drop the :port suffix. Compare case-insensitively.
        if raw.startswith("["):
            host = raw[:raw.index("]") + 1] if "]" in raw else raw
        else:
            host = raw.split(":")[0]
        host = host.strip().lower()
        # Reject a missing/empty Host too: a real browser always sends one, so an
        # empty Host can only come from a hand-crafted client (which gains nothing
        # cross-origin here), and rejecting it closes the falsy-host gap in the
        # DNS-rebind guard. (v12.71)
        if host not in ALLOWED_HOSTS:
            self.send_error(403, "Forbidden: invalid Host header")
            return False
        return True

    @staticmethod
    def _validate_deck_name(name):
        """Return True if deck name is safe (no traversal, no slashes, no null bytes,
        no characters that could break JS/HTML string contexts)."""
        if not isinstance(name, str) or not name.strip():
            return False
        # A name longer than the filesystem allows can never identify a real
        # deck: every open fails with ENAMETOOLONG. Rejecting it here keeps
        # unusable names from reaching per-name server state at all.
        if len(name.encode("utf-8", "surrogatepass")) > 255:
            return False
        # NFKC-fold first so fullwidth separators/dots (／ ＼ ．) collapse to ASCII
        # and get caught by the checks below; then reject bidi/format controls
        # (e.g. RTLO U+202E filename spoofing) and the Unicode separator/dot
        # lookalikes NFKC does NOT fold (division/fraction slash, set-minus, dot
        # leaders). The realpath check in _safe_deck_path() is the containment
        # guarantee; this prevents deceptive names slipping into the listing.
        raw_name = name
        name = unicodedata.normalize("NFKC", name)
        if any(unicodedata.category(c) == "Cf" for c in name):
            return False
        # Control characters (Cc) and DEL: CR/LF split an HTTP status line into
        # forged headers, and ESC/BEL rewrite the operator's terminal. Neither
        # belongs in a filename, so reject them here rather than at each sink.
        if any(unicodedata.category(c) == "Cc" for c in name) or "\x7f" in name:
            return False
        if any(c in "⁄∕∖⧸⧹․‥…。｡" for c in name):
            return False
        # Reject lone surrogates. os.listdir() surfaces undecodable filename bytes
        # as surrogates (surrogateescape), and such a name cannot be encoded into
        # a request path or valid JSON at all — so it could be LISTED but never
        # fetched, and encodeURIComponent() throws on it client-side, taking the
        # whole listing down with it. Listing only what can actually be served is
        # the invariant; drop these at the same gate as every other bad name.
        if any(0xD800 <= ord(c) <= 0xDFFF for c in name):
            return False
        # The File column shows the name VERBATIM — it is the identity the user
        # checks when a title looks wrong, so it must not be able to lie either.
        # A name is an identifier, not prose, so deceptive characters are REJECTED
        # here rather than rewritten (rewriting would make the column disagree
        # with the real filename, which is its own kind of lie).
        #   Cc      — control chars; also escape sequences into terminals/logs
        #   Me      — enclosing marks
        #   2+ Mn   — stacked combining marks (Zalgo); a single legitimate mark
        #             stays allowed so non-Latin filenames still work
        #   blanks  — glyphs that render empty but are not str.isspace(), used to
        #             push the real extension out of view
        if any(c in VelaHTTPHandler._BLANK_GLYPHS for c in name):
            return False
        # Category allowlist, expressed as its complement. An enumerated list of
        # slash lookalikes was bypassed by characters nobody thought to enumerate,
        # so reject by ROLE instead: nothing whose purpose is to modify or draw a
        # glyph may appear in a name.
        #   Me       — enclosing marks
        #   Lm/Sk    — modifier letters/symbols, e.g. the modifier colon
        #   So       — "other symbols", which includes the box-drawing diagonals
        #              that render pixel-identical to a slash
        #   Cc/Cf    — controls and format chars, which also inject escapes into
        #              logs/terminals and reorder the displayed name
        #   Co/Cs/Cn — private-use, surrogate and UNASSIGNED codepoints. These
        #              have no agreed glyph, and the ones a browser draws at ZERO
        #              width make a listing row indistinguishable from an honest
        #              deck's — the exact lie this block exists to prevent. The
        #              title filter already rejects them; names now match it.
        # Zs other than ASCII space is rejected too (the Ogham space draws a dash).
        # TRADE-OFF: this also rejects emoji in filenames (they are So). Such a
        # deck is simply not listed or served until renamed — fail-closed, and the
        # name is the identity the whole listing is trusted against.
        #
        # Checked on the RAW name as well as the folded one: NFKC turns several
        # rejected characters into innocent ones (a Kangxi radical that draws a
        # slash folds to an ordinary ideograph), so folding first would let the
        # displayed glyph escape the rule that exists to police it. ASCII is
        # exempt — the deceptive-glyph problem is a non-ASCII one, and the
        # explicit character checks below still police ASCII (`^` is category Sk
        # and is an ordinary filename character).
        for form in (raw_name, name):
            for c in form:
                if c.isascii():
                    continue
                cat = unicodedata.category(c)
                if cat in ("Me", "Lm", "Sk", "So", "Cc", "Cf", "Co", "Cs", "Cn"):
                    return False
                if cat == "Zs":
                    return False
                if c in "\u0337\u0338":
                    # Solidus overlays draw a slash THROUGH the previous glyph,
                    # forging a separator. Rejected wherever they appear, unlike
                    # combining marks in general (below).
                    return False
        # Combining marks (Mn/Mc) are judged on the FOLDED form only. They are
        # required by Devanagari, Thai, Hebrew, Arabic and Bengali filenames, and
        # a filesystem that stores names decomposed (macOS) puts one in every
        # accented Latin name — rejecting them outright makes those decks
        # unservable. What is actually deceptive is STACKING (Zalgo), which the
        # folded form still shows, so cap consecutive marks instead.
        marks = 0
        for c in name:
            if unicodedata.category(c) in ("Mn", "Mc"):
                marks += 1
                if marks >= 2:
                    return False
            else:
                marks = 0
        return ("/" not in name and "\\" not in name and ".." not in name
                and "\x00" not in name and "'" not in name and '"' not in name
                and "<" not in name and ">" not in name and "`" not in name
                and bool(name.strip()))

    # Deck titles are attacker-controlled: unlike the filename, `deckTitle` comes
    # from inside the deck JSON and passes through no name validation at all.
    # It is the listing's most prominent label, so it is a spoofing surface —
    # bidi/format controls can make a row read as a different, benign file, and a
    # non-string value breaks the client's search/sort. Normalize it here, at the
    # one place titles enter the listing.
    _TITLE_MAX = 200

    # Characters that render blank or zero-width but are NOT str.isspace(), so
    # " ".join(s.split()) leaves them intact: braille blank, the Hangul fillers
    # (and their NFKC targets), Mongolian vowel separator, Khmer inherent vowels,
    # no-break space. Runs of these push a label's real suffix out of view just as
    # effectively as spaces, so they must be folded to whitespace before collapsing.
    _BLANK_GLYPHS = " ᠎⠀ᅟᅠㅤﾠ឴឵"

    # Unicode categories a display label may never contain. Denylisting single
    # characters is what let the first version of this be bypassed; this is a
    # category allowlist expressed as its complement — every codepoint is dropped
    # unless its category is absent from here.
    #   C* — control, format (bidi/RTLO), private-use, surrogate, unassigned
    #   Mn/Me — combining marks: stacking produces Zalgo, and a single overlay
    #           (e.g. combining long solidus) draws a slash the filter never sees
    _LABEL_REJECT_CATEGORIES = frozenset(("Cc", "Cf", "Co", "Cs", "Cn", "Mn", "Me"))

    @classmethod
    def _display_label(cls, value, fallback):
        """Return a safe display label for the deck listing.

        The title comes from inside the deck JSON and is the listing's most
        prominent, clickable label — so it must not be able to impersonate another
        file. NFKC-fold first, drop every character in a rejected category, fold
        blank-rendering glyphs to real spaces, collapse runs, bound length, and
        fall back when nothing usable remains. The client renders labels via
        textContent, so this is anti-spoofing, not anti-XSS.

        RESIDUAL: cross-script homoglyphs (Cyrillic 'а' for Latin 'a') are not
        folded — that needs confusables data and is disproportionate here. The
        File column shows the real filename and the link target is the real path,
        so the title is never the only identity the user can check.
        """
        if not isinstance(value, str):
            return fallback  # numbers/objects/lists are not labels
        text = unicodedata.normalize("NFKC", value)
        out = []
        for ch in text:
            category = unicodedata.category(ch)
            if category in cls._LABEL_REJECT_CATEGORIES:
                continue
            out.append(" " if ch in cls._BLANK_GLYPHS or category == "Zs" else ch)
        cleaned = " ".join("".join(out).split())[:cls._TITLE_MAX]
        return cleaned or fallback

    # Largest deck we will read into memory. The listing re-reads EVERY .vela in
    # the folder on each poll, so without a cap one planted multi-gigabyte file
    # drives sustained memory and CPU load on every refresh. One cap, shared
    # with the module-level readers, so the two paths cannot drift.
    _DECK_MAX_BYTES = MAX_DECK_BYTES

    @classmethod
    def _read_deck_json(cls, fd):
        """Parse a deck from an owned descriptor, bounded in size.

        Takes ownership of fd (closes it), mirroring os.fdopen.
        """
        with os.fdopen(fd, "r", encoding="utf-8") as f:
            payload = f.read(cls._DECK_MAX_BYTES + 1)
        if len(payload) > cls._DECK_MAX_BYTES:
            raise ValueError("deck exceeds the maximum readable size")
        return json.loads(payload)

    @classmethod
    def _open_deck_fd(cls, folder, name, write=False, dir_fd=None):
        """Open a deck file by NAME and return an OS file descriptor.

        SINGLE FILE-ACCESS POINT for name-keyed deck reads.

        SECURITY (CWE-22/59/367): _safe_deck_path() realpath-validates but returns
        the UNRESOLVED join path, so any caller that then opens BY PATH resolves the
        leaf a second time — a local process can swap a deck-named symlink between
        the check and the open and redirect the read or write outside the served
        folder. Realpath containment alone cannot close that window; only refusing
        the symlink atomically at open() can. When `dir_fd` (the pinned served
        folder — see pin_dir) is given, the open is made RELATIVE to it, so the
        directories above the deck cannot be swapped either.

        Callers MUST operate on the returned descriptor and MUST NOT re-open by
        path — re-opening reintroduces the exact race this closes.

        Saves do NOT come through here: write_deck_json() replaces the entry
        atomically via a temp file instead of writing through it. The write=True
        branch exists for callers that need the same guarded open with truncate
        semantics on an existing entry.

        Raises ValueError if the name escapes the folder; OSError if the entry is a
        symlink (ELOOP), a hard link, is missing, or is not a regular file.
        """
        path = cls._safe_deck_path(folder, name)  # containment for the parent dirs
        if write:
            # NOTE: deliberately NO O_TRUNC here. O_TRUNC destroys the file at
            # open(), before any check can run — so truncation would happen even
            # for an entry we are about to refuse. Truncate below, after the
            # inode passes every guard.
            flags = os.O_WRONLY | os.O_CREAT
        else:
            # O_NONBLOCK so a fifo entry cannot hang the handler.
            flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)  # refuse a symlinked leaf, atomically
        kwargs = {"dir_fd": dir_fd} if dir_fd is not None else {}
        target = name if dir_fd is not None else path
        if os.name == "nt":
            # O_NOFOLLOW does not exist on Windows, so the flag above is a no-op
            # there and a symlink or junction WOULD be followed. Reject reparse
            # points by name first — weaker than an atomic no-follow open, but it
            # keeps this path from being weaker than read_deck_json, which has
            # carried the same check since before it was the single access point.
            wst = os.stat(target, follow_symlinks=False, **kwargs)
            if getattr(wst, "st_file_attributes", 0) & 0x400:  # REPARSE_POINT
                raise OSError(f"Refusing to read a reparse point: {name}")
        fd = os.open(target, flags, 0o600, **kwargs)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode):
                raise OSError(f"not a regular file: {name}")
            # Refuse multiply-linked inodes. O_NOFOLLOW only rejects a SYMlink; a
            # HARDlink is an ordinary directory entry inside the folder whose
            # realpath stays inside, so containment, O_NOFOLLOW and S_ISREG all
            # pass while the inode is shared with a file outside the folder —
            # reading it exfiltrates that file and writing it destroys it. A deck
            # the server owns has exactly one link; anything else is refused.
            if st.st_nlink != 1:
                raise OSError(f"refusing multiply-linked file: {name}")
            if write:
                os.ftruncate(fd, 0)  # safe now: the inode passed every guard
        except BaseException:
            os.close(fd)
            raise
        return fd

    def _deck_name_from_path(self, prefix):
        """Decode the deck name out of a request path beginning with `prefix`.

        SINGLE PARSING POINT for the three name-taking routes, so they cannot
        disagree with each other or with the listing.

        The query string is stripped from the RAW path *before* percent-decoding.
        Only a literal '?' delimits a query, so an encoded one belongs to the
        filename and must survive; decoding first would truncate such a name and
        make an entry the listing legitimately exposes unservable.
        """
        raw = self.path[len(prefix):]
        if "?" in raw:
            raw = raw.split("?", 1)[0]
        return unquote(raw)

    @staticmethod
    def _safe_deck_path(folder, name):
        """Resolve a deck path and verify it stays inside the folder.

        Security: resolves symlinks via realpath then checks containment with
        startswith(folder + sep).  _validate_deck_name() rejects '..', '/', '\\',
        and other traversal characters upstream; this is the belt-and-suspenders
        check.  CodeQL flags the callers as py/path-injection because its static
        analysis does not model any Python path-containment check as a sanitizer
        (known limitation — see github/codeql#10948, #17226).

        Returns the joined path on success, raises ValueError on traversal.
        """
        joined = os.path.join(folder, name)
        real_path = os.path.realpath(joined)
        real_folder = os.path.realpath(folder)
        if not real_path.startswith(real_folder + os.sep) and real_path != real_folder:
            raise ValueError(f"Path escapes folder: {name}")
        return joined

    def _check_auth(self):
        """Validate token or session cookie. Returns True if authorized.
        Returns False if response was already sent (redirect or error)."""
        srv = self.server_ref
        if not srv or srv._no_auth:
            return True

        # 1. URL token: ?token=xxx → validate, set cookie, redirect to strip token
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        url_token = qs.get("token", [None])[0]
        if url_token:
            if token_equal(url_token, srv._auth_token):
                session_id = secrets.token_urlsafe(24)
                with srv._sessions_lock:
                    srv._sessions.add(session_id)
                self.send_response(302)
                cookie = http.cookies.SimpleCookie()
                cookie["vela_session"] = session_id
                cookie["vela_session"]["httponly"] = True
                cookie["vela_session"]["samesite"] = "Strict"
                cookie["vela_session"]["path"] = "/"
                self.send_header("Set-Cookie", cookie["vela_session"].OutputString())
                clean_path = parsed.path or "/"
                self.send_header("Location", clean_path)
                self.end_headers()
                return False  # redirect sent
            else:
                self.send_error(403, "Invalid token")
                return False

        # 2. Authorization header: Bearer xxx (for API/programmatic access)
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            if token_equal(auth_header[7:], srv._auth_token):
                return True
            self.send_error(403, "Invalid token")
            return False

        # 3. Session cookie
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            cookie = http.cookies.SimpleCookie()
            try:
                cookie.load(cookie_header)
            except http.cookies.CookieError:
                pass
            else:
                morsel = cookie.get("vela_session")
                if morsel:
                    with srv._sessions_lock:
                        if morsel.value in srv._sessions:
                            return True

        # 4. Not authenticated
        self.send_error(401, "Authentication required. Read token from .vela.env or open the auto-launched browser.")
        return False

    def _check_origin(self):
        """Reject cross-origin mutating requests (CSRF protection).

        A same-origin request either omits Origin (same-origin XHR / non-browser
        clients) or sends one whose scheme, host, AND port exactly match the
        server it was sent to.  We compare Origin against this request's own Host
        header — the target the browser actually connected to — so a page on
        another loopback port cannot forge writes by riding the host-scoped
        session cookie (cookies are not port-scoped, and SameSite treats
        different ports as same-site).  Host is validated as loopback upstream by
        _check_host(); the local server is always plain http.
        """
        origin = self.headers.get("Origin")
        if not origin:
            return True  # same-origin requests may omit Origin
        if origin == "http://" + (self.headers.get("Host") or ""):
            return True
        self.send_error(403, "Forbidden: invalid Origin")
        return False

    def _safe_content_length(self, default=0):
        """Parse Content-Length header safely, returning default on bad input."""
        raw = self.headers.get("Content-Length", str(default))
        try:
            val = int(raw)
            return max(val, 0)  # treat negative as 0
        except (ValueError, TypeError):
            return default

    # Per-response CSP override. Defaults to the app policy; the folder-browser
    # routes opt into the stricter BROWSER_CSP. Reset at the top of every
    # request because handler instances are reused across keep-alive requests.
    _csp = None

    def end_headers(self):
        """Override to inject security headers into all responses."""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", self._csp or CSP_POLICY)
        super().end_headers()

    # ── Routing ────────────────────────────────────────────────────

    def do_GET(self):
        self._csp = None  # handler instances are reused across keep-alive requests
        if not self._check_host():
            return
        if not self._check_auth():
            return
        self._route_folder_get()

    def do_POST(self):
        self._csp = None  # handler instances are reused across keep-alive requests
        if not self._check_host():
            return
        if not self._check_auth():
            return
        if not self._check_origin():
            return
        self._route_folder_post()

    # ── Folder mode routing ───────────────────────────────────────────

    def _route_folder_get(self):
        if self.path == "/" or self.path == "/index.html":
            self._csp = BROWSER_CSP
            content = build_browser_html().encode("utf-8")
            self._serve(content, "text/html; charset=utf-8")
        elif self.path == "/browser.js":
            self._csp = BROWSER_CSP
            self._serve(build_browser_js().encode("utf-8"),
                        "text/javascript; charset=utf-8")
        elif self.path == "/api/decks":
            self._handle_list_decks()
        elif self.path.startswith("/deck/"):
            self._handle_serve_deck()
        elif self.path.startswith("/poll/"):
            self._handle_deck_poll()
        elif self.path in self.static_files:
            content, ctype = self.static_files[self.path]
            self._serve(content, ctype, cache="max-age=86400")
        else:
            self.send_error(404)

    def _route_folder_post(self):
        if self.path.startswith("/save/"):
            self._handle_deck_save()
        else:
            self.send_error(404)

    def _handle_list_decks(self):
        srv = self.server_ref
        decks = []
        for name in sorted(os.listdir(srv.folder_fd if srv.folder_fd is not None
                                      else srv.folder_path)):
            if not name.endswith(DECK_EXT):
                continue
            # SECURITY (containment + no check/use race, CWE-22/59/367): a
            # deck-named symlink to a file outside the served folder would leak
            # its size and (for JSON) its deckTitle, and swapping the entry
            # between a check and an open wins a TOCTOU race that no static
            # containment test can close. The shared symlink-proof open (see
            # _open_deck_fd) refuses a linked entry ATOMICALLY at the leaf, and
            # fstat on the returned fd means size AND content come from the very
            # object we opened, never a re-resolved path. The open is relative
            # to the pinned folder descriptor, so the directories above it
            # cannot be swapped either.
            if not self._validate_deck_name(name):
                srv.note_skipped_deck(name, "name contains characters that are not allowed")
                continue
            try:
                fd = self._open_deck_fd(srv.folder_path, name, dir_fd=srv.folder_fd)
            except (ValueError, OSError):
                srv.note_skipped_deck(name, "outside the folder, a link, or unreadable")
                continue
            try:
                st = os.fstat(fd)
                if st.st_size > MAX_DECK_BYTES:
                    os.close(fd)
                    srv.note_skipped_deck(name, "larger than the deck size limit")
                    continue
            except OSError:
                os.close(fd)
                continue
            # os.fdopen takes ownership of the fd and closes it.
            title = name
            slide_count = 0
            is_compact = False
            try:
                data = self._read_deck_json(fd)  # bounded; takes the fd
                if isinstance(data, dict) and data.get("_vela") and "data" in data:
                    data = data["data"]
                title = self._display_label(data.get("deckTitle") or data.get("n") or name, name)
                is_compact = "n" in data and ("G" in data or "S" in data)
                if "lanes" in data:
                    for lane in data["lanes"]:
                        for item in lane.get("items", []):
                            slide_count += len(item.get("slides", []))
                elif "G" in data:
                    # Compact grouped format — G is sections, each with S slides
                    for group in data["G"]:
                        if isinstance(group, dict):
                            slide_count += len(group.get("S", []))
                elif "S" in data:
                    # Compact flat format — S is slides list
                    slide_count = len(data["S"]) if isinstance(data["S"], list) else 0
                elif "slides" in data:
                    slide_count = len(data["slides"])
            except Exception:
                pass  # Corrupt or unreadable JSON — skip metadata, still list the file

            decks.append({
                "name": name,
                "title": title,
                "slides": slide_count,
                "size": st.st_size,
                "modified": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
                "compact": is_compact,
            })
        response = json.dumps({"folder": os.path.basename(srv.folder_path), "decks": decks}).encode("utf-8")
        self._serve(response, "application/json; charset=utf-8")

    def _handle_serve_deck(self):
        """GET /deck/<name> — serve Vela app with this deck loaded."""
        srv = self.server_ref
        deck_name = self._deck_name_from_path("/deck/")

        # Security: no path traversal, enforce .vela extension
        if not self._validate_deck_name(deck_name):
            self.send_error(400, "Invalid deck name")
            return
        if not deck_name.endswith(DECK_EXT):
            self.send_error(403, "Only .vela files can be served")
            return

        # Read through a symlink-proof descriptor, relative to the pinned folder,
        # and hand the PARSED deck on, so nothing downstream re-opens by path
        # (see _open_deck_fd).
        try:
            fd = self._open_deck_fd(srv.folder_path, deck_name, dir_fd=srv.folder_fd)
        except ValueError:
            self.send_error(403, "Access denied")
            return
        except FileNotFoundError:
            self.send_error(404, "Deck not found")
            return
        except OSError as e:
            # The open refuses links and non-plain files. That is a property of
            # the FILE, not a server fault, and it is invisible from the browser
            # — so name it and give the remedy rather than a bare 500.
            print(f"[error] Refusing to serve {console_safe(deck_name)}: {console_safe(e)}")
            self.send_error(409, "Deck not served: it is a link, or shares its "
                                 "contents with another name. Copy it to a plain "
                                 "file (cp deck.vela copy.vela) and open that.")
            return

        try:
            raw_deck = self._read_deck_json(fd)  # bounded; takes the fd
        except ValueError as e:
            # Oversized or malformed content is a property of the FILE, not a
            # server fault — 409, mirroring the link/non-plain-file refusals.
            print(f"[error] Refusing to serve {console_safe(deck_name)}: {console_safe(e)}")
            self.send_error(409, "Deck not served: the file is too large or is "
                                 "not valid deck JSON.")
            return
        except Exception as e:
            print(f"[error] Reading {console_safe(deck_name)}: {console_safe(e)}")
            self.send_error(500, "Error loading deck")
            return

        try:
            html = srv._build_html_for_deck(raw_deck, deck_name)
            self._serve(html, "text/html; charset=utf-8")
        except ValueError as e:
            # Normalization/expansion rejecting the deck (bad structure, or the
            # expanded payload blowing the size cap) is a property of the FILE,
            # not a server fault — 409, mirroring the read-path refusals.
            print(f"[error] Refusing to serve {console_safe(deck_name)}: {console_safe(e)}")
            self.send_error(409, "Deck not served: the deck data is too large "
                                 "or is not a valid deck.")
        except Exception as e:
            print(f"[error] Building HTML for {console_safe(deck_name)}: {console_safe(e)}")
            self.send_error(500, "Error loading deck")

    def _handle_deck_poll(self):
        """GET /poll/<name>?v=N — long-poll for a specific deck."""
        srv = self.server_ref
        deck_name = self._deck_name_from_path("/poll/")

        if not self._validate_deck_name(deck_name):
            self.send_error(400, "Invalid deck name")
            return
        if not deck_name.endswith(DECK_EXT):
            self.send_error(403, "Only .vela files can be polled")
            return

        # Look up WITHOUT creating. get_tracker() allocates on miss, which made
        # the 404 below unreachable and let any syntactically valid name pin a
        # tracker in memory for the process's lifetime.
        tracker = srv.peek_tracker(deck_name)
        if not tracker:
            self.send_error(404, "Deck not tracked")
            return

        self._poll_response(tracker, lambda: srv.get_deck_data(deck_name))

    def _handle_deck_save(self):
        """POST /save/<name> — browser sends deck updates for a specific deck."""
        srv = self.server_ref
        deck_name = self._deck_name_from_path("/save/")

        if not self._validate_deck_name(deck_name):
            self.send_error(400, "Invalid deck name")
            return
        if not deck_name.endswith(DECK_EXT):
            self.send_error(403, "Only .vela files can be saved")
            return

        # Require JSON: blocks "simple" cross-origin POSTs (text/plain, etc.)
        # that skip the CORS preflight. Defense-in-depth alongside _check_origin.
        ctype = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if ctype != "application/json":
            self.send_error(415, "Saves require Content-Type: application/json")
            return

        try:
            deck, error_sent = self._read_save_payload()
            if error_sent:
                return
            if deck:
                # Authorize BEFORE recording anything: only a write that actually
                # reached disk may touch shared state — publishing an edit that
                # never landed makes every other tab believe a lost save.
                try:
                    deck_path = self._safe_deck_path(srv.folder_path, deck_name)
                except ValueError:
                    self.send_error(403, "Access denied")
                    return
                watcher = srv.get_watcher(deck_name)
                if watcher:
                    watcher.ignore_next(2.0)
                # Atomic replace via a temp file (see write_deck_json): a symlink
                # or hard link sitting at the name is detached instead of written
                # through, readers never observe a half-written deck, and the
                # write is relative to the pinned folder descriptor.
                try:
                    write_deck_json(
                        deck_name if srv.folder_fd is not None else deck_path,
                        deck, dir_fd=srv.folder_fd, folder=srv.folder_path)
                except PermissionError as e:
                    # The entry itself is refused (a link, multiply linked, or
                    # not writable) — a property of the FILE, not a server fault,
                    # so answer as the read path does instead of claiming 500.
                    print(f"[save] Refusing to write {console_safe(deck_name)}: "
                          f"{console_safe(e)}")
                    self.send_error(409, "Deck not saved: it is a link, shares its "
                                         "contents with another name, or is not "
                                         "writable. Copy it to a plain file.")
                    return
                except OSError as e:
                    # Report the real reason instead of a generic 400, and leave
                    # the in-memory deck alone.
                    print(f"[save] Could not write {console_safe(deck_name)}: "
                          f"{console_safe(e)}")
                    # Static reason phrase: send_error writes `message` straight
                    # into the status line, so nothing untrusted may reach it.
                    self.send_error(500, "Could not write deck (see server console)")
                    return
                srv.set_deck_data(deck_name, deck)  # now it matches what is on disk
                tracker = srv.get_tracker(deck_name)
                if tracker:
                    tracker.bump()
                print(f"[sync] Browser edit → saved {console_safe(deck_name)}")
            self._json_response(200, {"ok": True})
        except Exception as e:
            if not isinstance(e, BrokenPipeError):
                print(f"[save] Error: {console_safe(e)}")
                self.send_error(400, "Invalid request")

    def _json_response(self, code, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_save_payload(self, max_size=5_000_000):
        """Read and parse a deck save request body.

        Returns (deck_dict, error_sent):
            - (deck, False) if a valid deck with lanes was found
            - (None, False) if valid JSON but not a deck save or missing lanes
            - (None, True) if an error response was already sent (413)
        """
        content_length = self._safe_content_length()
        if content_length > max_size:
            self.send_error(413, "Payload too large")
            return None, True
        body = self.rfile.read(content_length)
        parsed = json.loads(body)
        if parsed.get("type") != "deck_save":
            return None, False
        deck = parsed.get("deck")
        if deck and isinstance(deck, dict) and "lanes" in deck:
            return deck, False
        return None, False

    # ── Shared helpers ────────────────────────────────────────────────

    def _serve(self, content, content_type, cache="no-cache"):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(content)
        # BrokenPipeError propagates to process_request_thread which handles it.

    def _poll_response(self, tracker, get_deck_data):
        """Shared long-poll response builder for both modes."""
        client_version = 0
        if "?" in self.path:
            for p in self.path.split("?", 1)[1].split("&"):
                if p.startswith("v="):
                    try:
                        client_version = int(p[2:])
                    except ValueError:
                        pass

        changed = tracker.wait_for_change(client_version, timeout=25)

        if changed and tracker.needs_reload:
            response = {"type": "reload", "version": tracker.version}
        elif changed and client_version > 0:
            response = {"type": "deck_update", "version": tracker.version, "deck": get_deck_data()}
        else:
            response = {"type": "current", "version": tracker.version}

        self._serve(json.dumps(response).encode("utf-8"), "application/json; charset=utf-8")

    def log_message(self, fmt, *args):
        pass  # quiet


class ThreadedHTTPServer(http.server.HTTPServer):
    """HTTP server with a bounded thread pool to prevent DoS via thread exhaustion."""
    daemon_threads = True
    # On Windows, SO_REUSEADDR (set by HTTPServer's allow_reuse_address) lets a
    # second process silently bind an already-in-use port, so a busy port never
    # raises EADDRINUSE and the fallback can't kick in. Disable reuse there and
    # request exclusive use so busy ports are detected. On Unix keep reuse to
    # avoid TIME_WAIT bind failures on quick restarts.
    allow_reuse_address = (sys.platform != "win32")

    def server_bind(self):
        if sys.platform == "win32":
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            except (AttributeError, OSError):
                pass
        super().server_bind()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pool = ThreadPoolExecutor(max_workers=MAX_THREADS)

    def process_request(self, request, client_address):
        self._pool.submit(self.process_request_thread, request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)

    def server_close(self):
        super().server_close()
        if hasattr(self, "_pool"):
            self._pool.shutdown(wait=False)


# ── File watcher (polling) ─────────────────────────────────────────────
class FileWatcher:
    def __init__(self, path, callback, interval=0.5):
        self.path = os.path.abspath(path)
        self.callback = callback
        self.interval = interval
        self._last_mtime = 0
        self._last_hash = ""
        self._running = False
        self._ignore_until = 0
        self._thread = None

    def start(self):
        self._last_mtime = os.path.getmtime(self.path)
        self._last_hash = self._file_hash()
        self._running = True
        self._thread = threading.Thread(target=self._poll, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def ignore_next(self, seconds=1.5):
        self._ignore_until = time.time() + seconds

    # A watched path lives inside the served folder, so a local process can
    # replace it with a symlink to a fifo (a blocking open hangs this thread) or
    # to /dev/zero (an unbounded read exhausts memory). This hash is only used for
    # change detection — the content actually served is re-read through
    # read_deck_json — so it needs the same open discipline, plus a size cap.
    MAX_HASH_BYTES = 64 * 1024 * 1024

    def _file_hash(self):
        """Hash the watched file, refusing anything that is not a plain file.

        SECURITY: the watched entry sits in a project directory, so it may have
        been replaced since the watcher was armed. O_NOFOLLOW keeps a link from
        redirecting the read outside the folder; O_NONBLOCK plus the S_ISREG
        check keep a fifo from parking this thread inside open() (it runs while
        the server lock is held, so a block there wedges every deck endpoint);
        and the cap keeps an oversized file from being pulled into memory."""
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        try:
            fd = os.open(self.path, flags)
        except OSError:
            return ""
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_size > self.MAX_HASH_BYTES:
                return ""
            h = hashlib.sha256()
            while True:
                chunk = os.read(fd, 1 << 16)
                if not chunk:
                    break
                h.update(chunk)
            return h.hexdigest()
        except OSError:
            return ""
        finally:
            try:
                os.close(fd)
            except OSError:
                pass

    def _poll(self):
        while self._running:
            try:
                mtime = os.path.getmtime(self.path)
                if mtime != self._last_mtime:
                    self._last_mtime = mtime
                    if time.time() < self._ignore_until:
                        self._last_hash = self._file_hash()
                    else:
                        new_hash = self._file_hash()
                        if new_hash != self._last_hash:
                            self._last_hash = new_hash
                            self.callback()
            except FileNotFoundError:
                pass
            except Exception as e:
                print(f"[watch] Error: {console_safe(e)}")
            time.sleep(self.interval)


# ── Main server ────────────────────────────────────────────────────────
class VelaLocalServer:
    def __init__(self, path, port=3030, host="127.0.0.1", channel_port=0, no_open=False,
                 no_auth=False, token=None, replace=False, ai_enabled=False):
        self.port = port
        self.host = host
        self.channel_port = channel_port
        # AI is OFF by default. The channel spawns the user's `claude` CLI (its
        # credentials / spend), so it is strictly opt-in — only started when the
        # operator passes `--ai` (or the harness/dev tooling requests it). When
        # disabled, the served page gets VELA_CHANNEL_PORT=0 so velaAIAvailable()
        # is false and the AI UI stays inert.
        self.ai_enabled = ai_enabled
        self.no_open = no_open
        self._vendor_available = False
        self._force_kill = replace
        self._channel_server = None  # loopback AI channel (agent_backend), if started
        # Per-server token gating the AI channel's /action. Injected into the
        # rendered page (itself behind serve.py auth) and handed to the channel
        # in-process — never on argv — so another local user cannot spend this
        # user's `claude` credits via the loopback endpoint.
        self._channel_token = secrets.token_urlsafe(32)

        # Auth state
        self._no_auth = no_auth
        self._auth_token = token or os.environ.get("VELA_TOKEN") or secrets.token_urlsafe(32)
        self._sessions = set()
        self._sessions_lock = threading.Lock()

        # Runtime-file directory, pinned on first use (see _runtime_dir_fd).
        self._dir_fd = None
        self._dir_fd_unsupported = False

        # Always folder mode — if a file is passed, use its parent directory.
        # SECURITY: resolve the served root ONCE, here, with realpath rather than
        # abspath. O_NOFOLLOW in read_deck_json/write_deck_json refuses a
        # symlinked LEAF, but it cannot protect a parent component: if the root
        # itself stayed a symlink it would be re-resolved on every request, and a
        # local process could re-point it between the containment check and the
        # open to redirect reads and writes into another directory. Pinning the
        # resolved root closes that window for every path derived from it.
        abs_path = os.path.realpath(path)
        if os.path.isfile(abs_path):
            self.folder_path = os.path.dirname(abs_path)
        else:
            self.folder_path = abs_path
        # Deck folder pinned once (see pin_dir): every list/read/write below is
        # done relative to this descriptor, so swapping a directory name above
        # the deck files cannot relocate them.
        self.folder_fd = pin_dir(self.folder_path)

        # Per-deck state
        self._skipped_decks = set()   # names already explained by note_skipped_deck
        self._deck_trackers = {}    # name → DeckVersionTracker
        self._deck_watchers = {}    # name → FileWatcher
        self._deck_cache = {}       # name → dict (deck data)
        self._lock = threading.Lock()

    def note_skipped_deck(self, name, reason):
        """Explain, once per name, why a file in the folder is not listed —
        otherwise a deck the user can see on disk just vanishes silently."""
        with self._lock:
            if name in self._skipped_decks:
                return
            self._skipped_decks.add(name)
        print(f"  [decks]  Skipping {console_safe(name)}: {reason}")

    def sweep_save_temps(self):
        """Remove our own leftover save temporaries (a save killed mid-write
        leaves one). unlink never dereferences, so a planted entry using our
        prefix is removed rather than followed."""
        try:
            names = os.listdir(self.folder_fd if self.folder_fd is not None
                               else self.folder_path)
        except OSError:
            return
        kwargs = {"dir_fd": self.folder_fd} if self.folder_fd is not None else {}
        for name in names:
            if name.startswith(SAVE_TMP_PREFIX) and name.endswith(SAVE_TMP_SUFFIX):
                try:
                    os.unlink(name if self.folder_fd is not None
                              else os.path.join(self.folder_path, name), **kwargs)
                except OSError:
                    pass

    # ── Per-deck state management (folder mode) ──────────────────────

    def peek_tracker(self, deck_name):
        """Return an existing tracker, or None. Never allocates."""
        return self.get_tracker(deck_name, create=False)

    def get_tracker(self, deck_name, create=True):
        with self._lock:
            if deck_name not in self._deck_trackers and not create:
                return None
            if deck_name not in self._deck_trackers:
                self._deck_trackers[deck_name] = DeckVersionTracker()
            return self._deck_trackers[deck_name]

    def get_watcher(self, deck_name):
        with self._lock:
            return self._deck_watchers.get(deck_name)

    def get_deck_data(self, deck_name):
        with self._lock:
            return self._deck_cache.get(deck_name)

    def set_deck_data(self, deck_name, data):
        with self._lock:
            self._deck_cache[deck_name] = data

    def _ensure_watcher(self, deck_name):
        """Start a file watcher for a deck if not already watching."""
        with self._lock:
            if deck_name in self._deck_watchers:
                return
            deck_path = os.path.join(self.folder_path, deck_name)
            if not os.path.isfile(deck_path):
                return

            def on_change(name=deck_name):
                try:
                    # Re-open through the shared symlink-proof descriptor on every
                    # re-read. The watched path may resolve differently than when the
                    # watcher was armed, and this fires on filesystem events an
                    # attacker can trigger — so it needs the same atomic guarantee as
                    # the HTTP routes, not just a realpath check followed by open().
                    try:
                        fpath = VelaHTTPHandler._safe_deck_path(self.folder_path, name)
                    except ValueError:
                        print(f"[sync] {console_safe(name)} no longer resolves inside the folder — skipping")
                        return
                    new_data = read_deck_json(
                        name if self.folder_fd is not None else fpath,
                        dir_fd=self.folder_fd)
                    self.set_deck_data(name, new_data)
                    self.get_tracker(name).bump()
                    print(f"[sync] {console_safe(name)} changed → pushed to browser")
                except Exception as e:
                    print(f"[sync] Error reading {console_safe(name)}: {console_safe(e)}")

            # Claim the slot under the lock, but do NOT start the watcher here:
            # start() reads and hashes the file, and holding the lock across that
            # I/O blocks every deck endpoint (get_tracker/get_deck_data/save).
            watcher = FileWatcher(deck_path, on_change)
            self._deck_watchers[deck_name] = watcher
        watcher.start()

    # ── HTML building ────────────────────────────────────────────────

    @staticmethod
    def _normalize_deck(data):
        """Unwrap Vela export format, expand compact → full lanes format."""
        if isinstance(data, dict) and data.get("_vela") and "data" in data:
            data = data["data"]
        # Compact format (has "n" + "G"/"S") → expand to full lanes
        if isinstance(data, dict) and "n" in data and ("G" in data or "S" in data):
            import copy
            data = _expand_compact_deck(copy.deepcopy(data))
        elif isinstance(data, dict) and "slides" in data and "lanes" not in data:
            title = data.get("deckTitle", "Presentation")
            data = {
                "deckTitle": title,
                "lanes": [{"title": "Main", "items": [{"title": title, "status": "todo", "importance": "must", "slides": data["slides"]}]}]
            }
        return data

    def _prepare_html(self, deck_data, deck_label):
        """Build the Vela app HTML with deck data injected.

        Args:
            deck_data: deck dict (must already be normalized)
            deck_label: display name for the deck (basename, no path)
        Returns:
            HTML string (not yet encoded to bytes)
        """
        with open(LOCAL_HTML_PATH, "r", encoding="utf-8") as f:
            html_template = f.read()
        with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
            vela_jsx = f.read()

        # Inject deck data into STARTUP_PATCH
        deck_json_str = json.dumps(deck_data, ensure_ascii=False, separators=(",", ":"))
        # Expansion (compact → full, alias resolution) is a multiplier, so the
        # input cap alone does not bound this. Check the expanded payload before
        # it is escaped and spliced into a ~1.5 MB template. The cap is in
        # BYTES: the character-length test alone would undercount multi-byte
        # UTF-8 content, so it only short-circuits the (up to 4×) encode.
        if (len(deck_json_str) > MAX_DECK_PAYLOAD
                or len(deck_json_str.encode("utf-8")) > MAX_DECK_PAYLOAD):
            raise ValueError(f"Expanded deck exceeds {MAX_DECK_PAYLOAD} bytes")
        marker = "const STARTUP_PATCH = null;"
        if marker not in vela_jsx:
            raise RuntimeError("STARTUP_PATCH marker not found in template")
        deck_json_str = escape_for_script_context(deck_json_str)
        vela_jsx = vela_jsx.replace(marker, f"const STARTUP_PATCH = {deck_json_str};", 1)

        # Strip ES module imports → UMD globals
        vela_jsx = re.sub(r'^import\s+\{[^}]+\}\s+from\s+"react";\s*$', '', vela_jsx, flags=re.MULTILINE)
        vela_jsx = re.sub(r'^import\s+\{[^}]+\}\s+from\s+"lucide-react";\s*$', '', vela_jsx, flags=re.MULTILINE)
        vela_jsx = re.sub(r'^import\s+\*\s+as\s+\w+\s+from\s+"lucide-react";\s*$', '', vela_jsx, flags=re.MULTILINE)
        vela_jsx = re.sub(r'^export\s+default\s+function\s+', 'function ', vela_jsx, flags=re.MULTILINE)
        umd_shim = (
            "const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;\n"
            "const _LucideAll = window.lucideReact;\n"
            "const { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown } = window.lucideReact;\n"
        )
        vela_jsx = umd_shim + vela_jsx

        # Enable local mode
        vela_jsx = vela_jsx.replace("const VELA_LOCAL_MODE = false;", "const VELA_LOCAL_MODE = true;", 1)
        # AI channel is injected ONLY when enabled (--ai); otherwise the page gets
        # port 0 → velaAIAvailable() is false → the AI UI is inert.
        eff_port = self.channel_port if self.ai_enabled else 0
        vela_jsx = vela_jsx.replace("const VELA_CHANNEL_PORT = 0;", f"const VELA_CHANNEL_PORT = {eff_port};", 1)
        if self.ai_enabled:
            # token_urlsafe is [A-Za-z0-9_-] only — safe to inline in a JS string.
            vela_jsx = vela_jsx.replace('const VELA_CHANNEL_TOKEN = "";', f'const VELA_CHANNEL_TOKEN = "{self._channel_token}";', 1)

        # Neutralize HTML script-data tokens inside the JS source before it is
        # inlined into <script type="text/babel">. vela.jsx legitimately holds
        # literal "</script>" and "<!--" substrings (uitest sanitizer payloads);
        # the HTML tokenizer would act on them — the first "</script" closes the
        # block early, ejecting the rest of the source as live HTML (rendering it
        # as text and executing the embedded test payloads). Backslash-breaking
        # the token is a no-op inside JS string/regex literals (the runtime value
        # is byte-identical) but hides the sequence from the HTML parser. The
        # deck JSON injected above is handled separately by
        # escape_for_script_context (a JSON-string escaper — not applicable to JS
        # source, which must keep its literal "<" / ">").
        vela_jsx = re.sub(r"</(?=script)", r"<\\/", vela_jsx, flags=re.IGNORECASE)
        vela_jsx = vela_jsx.replace("<!--", "<\\!--")

        # Assemble HTML
        html = html_template.replace("__VELA_JSX_PLACEHOLDER__", vela_jsx)
        html = html.replace("__VELA_CHANNEL_PORT__", str(eff_port))
        html = html.replace("'__VELA_DECK_PATH__'", json.dumps(deck_label))

        if self._vendor_available:
            html = html.replace("https://unpkg.com/@babel/standalone@7.24.0/babel.min.js", "/vendor/babel.min.js")

        return html

    def _build_html_for_deck(self, raw_deck, deck_name):
        """Build the Vela app HTML for a deck already read from disk (folder mode).

        Takes the PARSED deck rather than a path: the caller reads it through
        a symlink-proof descriptor (_open_deck_fd / read_deck_json), so this
        must never re-open by path (that would resolve the leaf again and
        reopen the TOCTOU window).
        """
        deck_data = self._normalize_deck(raw_deck)

        self.set_deck_data(deck_name, deck_data)
        self._ensure_watcher(deck_name)

        html = self._prepare_html(deck_data, deck_name)

        # Patch sync URLs to include deck name for folder mode
        safe_name = quote(deck_name, safe="")
        html = html.replace("fetch('/poll?v='", f"fetch('/poll/{safe_name}?v='")
        html = html.replace("fetch('/poll?v=0')", f"fetch('/poll/{safe_name}?v=0')")
        html = html.replace("fetch('/save',", f"fetch('/save/{safe_name}',")

        # Home link overlay for folder mode navigation
        home_link = (
            '<a href="/" title="Back to decks" id="vela-home-link" style="'
            'position:fixed;top:0;left:0;width:44px;height:44px;z-index:10000;'
            'display:flex;align-items:center;justify-content:center;'
            'text-decoration:none;cursor:pointer;'
            '"></a>'
        )
        html = html.replace("</body>", home_link + "</body>")

        return html.encode("utf-8")

    # ── Vendor files ─────────────────────────────────────────────────

    def _load_vendor_files(self):
        self._vendor_available = False
        # SECURITY: only ever load executable vendor assets from the trusted
        # install root. This previously searched the served folder and the launch
        # cwd first — both directories the threat model treats as attacker-
        # writable — and whatever it found was served at /vendor/... as
        # application/javascript under a CSP whose script-src includes 'self'. A
        # planted node_modules therefore ran as a first-class page script with
        # full same-origin access, bypassing every deck sanitizer entirely: no
        # symlink, no race, just a regular file in a planted directory. The old
        # realpath check only prevented a symlink escaping node_modules; it said
        # nothing about whether that node_modules could be trusted at all.
        search_dirs = [os.path.dirname(os.path.dirname(SKILL_DIR))]
        vendor_map = {
            "/vendor/babel.min.js": ("@babel/standalone/babel.min.js", "application/javascript"),
        }
        for base_dir in search_dirs:
            nm = os.path.join(base_dir, "node_modules")
            if not os.path.isdir(nm):
                continue
            for serve_path, (nm_path, ctype) in vendor_map.items():
                full = os.path.join(nm, nm_path)
                real_full = os.path.realpath(full)
                real_nm = os.path.realpath(nm)
                if not real_full.startswith(real_nm + os.sep):
                    continue  # Reject symlink escape
                if os.path.isfile(real_full):
                    with open(real_full, "rb") as f:
                        VelaHTTPHandler.static_files[serve_path] = (f.read(), ctype)
                    self._vendor_available = True
            if self._vendor_available:
                print(f"  [vendor] Loaded Babel from {nm}")
                break
        if not self._vendor_available:
            print(f"  [vendor] Using CDN for Babel (install @babel/standalone for offline)")

    # ── Helpers ──────────────────────────────────────────────────────

    def _open_browser(self, url):
        webbrowser.open(url)

    def _retry_after_stale_kill(self, handler_class):
        """Try to free the requested port by killing a stale process on it, then
        rebind. Returns the bound server on success, or None if the port could
        not be freed (the caller then falls back to another port)."""
        import subprocess
        print(f"  [port]   Port {self.port} in use — killing stale process...")
        # Try reading PID from .vela.env first (most reliable)
        info = self._read_runtime_info() or {}
        killed = False
        stale_pid = info.get("pid")
        # SECURITY: never signal the file-supplied PID on the file's say-so —
        # this runs on the ordinary busy-port path, not just under --replace.
        # _is_our_stale_server() applies the SAME verification as
        # _cleanup_stale_server(): the PID must be a live Python process actually
        # bound to the port before it may be signalled. Anything unverified falls
        # through to the OS-discovered port holder below — which applies the same
        # verification, because "the OS named it" says nothing about whether the
        # process is ours to kill.
        if (info.get("port") == self.port
                and self._is_our_stale_server(stale_pid, self.port)):
            try:
                os.kill(stale_pid, 9)
                killed = True
                print(f"  [port]   Killed stale PID {stale_pid}")
            except OSError:
                pass
        # Fallback: ask the OS who holds the port. SECURITY/SAFETY: a PID from
        # the OS is not automatically ours — the query can name an unrelated
        # service, and (without a listen filter) even a CLIENT connected to that
        # port, such as the user's browser. Signal only what verifies as a
        # previous Vela server; otherwise leave it alone and let the caller fall
        # back to the next free port. --replace is the operator's explicit
        # opt-out for the unverified case.
        if not killed:
            try:
                if sys.platform == "win32":
                    result = subprocess.run(
                        ["netstat", "-ano"], capture_output=True, text=True, timeout=5)
                    for line in result.stdout.splitlines():
                        if f":{self.port}" in line and "LISTENING" in line:
                            parts = line.split()
                            pid_str = parts[-1]
                            try:
                                pid = int(pid_str)
                            except ValueError:
                                break
                            if not (self._force_kill
                                    or self._is_our_stale_server(pid, self.port)):
                                print(f"  [port]   Port {self.port} is held by PID {pid}, "
                                      f"which is not a Vela server — leaving it alone "
                                      f"(use --replace to override).")
                                break
                            try:
                                subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                                               capture_output=True, timeout=5)
                                killed = True
                                print(f"  [port]   Killed stale PID {pid}")
                            except (subprocess.TimeoutExpired, ValueError):
                                pass
                            break
                else:
                    result = subprocess.run(
                        ["lsof", "-ti", "-a", "-sTCP:LISTEN", "-i", f":{self.port}"],
                        capture_output=True, text=True, timeout=3)
                    for pid_str in result.stdout.strip().split("\n"):
                        if not pid_str.strip():
                            continue
                        try:
                            pid = int(pid_str.strip())
                        except ValueError:
                            continue
                        if not (self._force_kill
                                or self._is_our_stale_server(pid, self.port)):
                            print(f"  [port]   Port {self.port} is held by PID {pid}, "
                                  f"which is not a Vela server — leaving it alone "
                                  f"(use --replace to override).")
                            continue
                        try:
                            os.kill(pid, 9)
                            killed = True
                            print(f"  [port]   Killed stale PID {pid}")
                        except OSError:
                            pass
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass
        if not killed:
            print(f"  [port]   Could not free port {self.port} (another service may be using it).")
            return None
        import time
        time.sleep(0.5)
        try:
            return ThreadedHTTPServer((self.host, self.port), handler_class)
        except OSError:
            print(f"  [port]   Port {self.port} still in use after kill.")
            return None

    def _bind_server(self, handler_class):
        """Bind the HTTP server to self.port. If the port is busy, first try to
        reclaim it from a stale/previous Vela server; if it is still busy (e.g.
        held by an unrelated process), fall back to the next free port. Updates
        self.port to the port actually bound, so the printed URL and runtime
        file always match where the server is listening."""
        requested = self.port
        try:
            return ThreadedHTTPServer((self.host, requested), handler_class)
        except OSError as e:
            # errno names, not numbers: EADDRINUSE is 98 on Linux, 48 on macOS,
            # 10048 on Windows — a hardcoded list aborts instead of reclaiming.
            if e.errno not in (errno.EADDRINUSE, errno.EACCES, 10048, 10013):
                raise
        # Requested port busy — try to reclaim it from a stale process.
        httpd = self._retry_after_stale_kill(handler_class)
        if httpd is not None:
            return httpd
        # Still busy — scan for the next available port.
        for candidate in range(requested + 1, requested + 21):
            try:
                httpd = ThreadedHTTPServer((self.host, candidate), handler_class)
                print(f"  [port]   Port {requested} unavailable — falling back to port {candidate}")
                self.port = candidate
                return httpd
            except OSError:
                continue
        print(f"  [port]   ERROR: No free port in range {requested}-{requested + 20}.", file=sys.stderr)
        sys.exit(1)

    # ── Run ──────────────────────────────────────────────────────────

    RUNTIME_FILE = ".vela.env"
    RUNTIME_MAX_BYTES = 64 * 1024  # ours is ~200 B; cap what we will parse

    def _runtime_dir_fd(self):
        """Descriptor for the directory the runtime file lives in, resolved once
        and cached, or None where the platform has no dir_fd-relative calls.

        SECURITY: O_NOFOLLOW/O_EXCL constrain only the FINAL path component. The
        parent is re-resolved on every open, so swapping a parent directory
        redirects the write — token included — out of the project even though the
        inode we create is fresh. Resolving the directory once and addressing the
        file relative to that descriptor pins the WHOLE path: every create, stat
        and unlink below lands in the directory the server actually started in,
        whatever happens to the names above it afterwards."""
        if self._dir_fd is None and not self._dir_fd_unsupported:
            needed = (os.open, os.stat, os.unlink, os.rmdir)
            if not all(fn in os.supports_dir_fd for fn in needed):
                self._dir_fd_unsupported = True  # Windows: fall back to paths
                return None
            try:
                self._dir_fd = os.open(os.getcwd(),
                                       os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            except OSError:
                return None  # transient (e.g. the CWD is gone) — retry next call
        return self._dir_fd

    def _runtime_target(self, name):
        """(target, kwargs) addressing `name` in the runtime directory —
        dir_fd-relative where supported, else the plain absolute path.

        Never raises: os.getcwd() itself fails if the directory was removed out
        from under the process, and this is called from cleanup and startup
        paths where that must degrade to a failed open, not an escaping error."""
        dfd = self._runtime_dir_fd()
        if dfd is not None:
            return name, {"dir_fd": dfd}
        try:
            return os.path.join(os.getcwd(), name), {}
        except OSError:
            return name, {}  # no CWD to resolve — the open below fails closed

    # SECURITY (CWE-59/61/367): the runtime file lives in the process CWD — the
    # user's project/worktree, i.e. content Vela does not own and an attacker may
    # have authored (a cloned repo, a shared checkout). Any pre-existing
    # `.vela.env` is therefore untrusted input, both as a directory entry and as
    # bytes: if the entry is a symlink/junction/other link, opening it by path
    # makes Vela read or — far worse — TRUNCATE AND OVERWRITE a file outside the
    # project, and in authenticated mode that write puts a live auth token in a
    # file the attacker chose. Every touch of this file goes through the helpers
    # below and fails CLOSED: reads open O_NOFOLLOW and take content from the
    # SAME fd (no re-resolved path, no check/use race); writes first destroy the
    # existing directory ENTRY (unlink/rmdir act on the entry, never on its
    # target) and then create exclusively, so the write can only land on an inode
    # this process just made. Never relax this into "check then open by path".

    def _read_runtime_info(self):
        """Read + validate the runtime file. Returns {"pid", "port"} (values are
        positive ints or None), or None when there is nothing usable.

        Fields are type-checked rather than trusted: the file is attacker-
        authorable, and a non-int pid would crash the callers' os.kill/tasklist
        while a non-positive one would make os.kill() signal a whole process
        group (-1 = every process this user can signal)."""
        target, kwargs = self._runtime_target(self.RUNTIME_FILE)
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        try:
            # O_NOFOLLOW does not exist on Windows, so the open there would
            # follow a symlink or junction. Reject reparse points up front
            # instead: weaker than an atomic no-follow open (the check is by
            # name), but it closes the static case the flag covers elsewhere.
            if os.name == "nt":
                wst = os.stat(target, follow_symlinks=False, **kwargs)
                if getattr(wst, "st_file_attributes", 0) & 0x400:  # REPARSE_POINT
                    return None
            fd = os.open(target, flags, **kwargs)
        except OSError:
            return None  # absent, a link (ELOOP), or unreadable
        try:
            st = os.fstat(fd)
            # Size-gate BEFORE parsing: json.load() on a file this process does
            # not own would otherwise pull an attacker-chosen number of bytes
            # into memory. Our own file is ~200 bytes; anything near the cap is
            # not ours. Checked on the fd, so it describes what we will read.
            if not stat.S_ISREG(st.st_mode) or st.st_size > self.RUNTIME_MAX_BYTES:
                os.close(fd)
                return None  # fifo/device/directory, or implausibly large
            f = os.fdopen(fd, "r", encoding="utf-8")
        except OSError:
            # fdopen takes ownership of the fd, so it may already be closed here
            # — a second close would raise EBADF straight out of startup.
            try:
                os.close(fd)
            except OSError:
                pass
            return None
        try:
            with f:
                # Bounded read, not json.load(f): the file can grow between the
                # fstat above and this read, so the cap is enforced on the bytes
                # we actually take, never on a size we sampled earlier.
                raw = f.buffer.read(self.RUNTIME_MAX_BYTES + 1).decode("utf-8")
            if len(raw) > self.RUNTIME_MAX_BYTES:
                return None
            info = json.loads(raw)
        except (OSError, ValueError, UnicodeDecodeError, RecursionError):
            return None  # unreadable, not UTF-8, not JSON, or nested to exhaustion
        if not isinstance(info, dict):
            return None
        pid, port = info.get("pid"), info.get("port")
        return {
            "pid": pid if isinstance(pid, int) and not isinstance(pid, bool) and pid > 0 else None,
            "port": port if (isinstance(port, int) and not isinstance(port, bool)
                             and 0 < port <= 65535) else None,
        }

    def _discard_runtime_entry(self, name):
        """Delete any existing entry WITHOUT dereferencing it, so a planted link
        is destroyed instead of followed. A real directory is left alone — the
        exclusive create then fails and the caller writes nothing."""
        target, kwargs = self._runtime_target(name)
        try:
            st = os.stat(target, follow_symlinks=False, **kwargs)
        except OSError:
            return  # nothing there (or unreadable) — the exclusive create decides
        if stat.S_ISDIR(st.st_mode):
            return
        try:
            os.unlink(target, **kwargs)
        except OSError:
            # POSIX unlink removes every non-directory entry INCLUDING symlinks,
            # so a failure here is never "it was a link". Only Windows needs the
            # rmdir fallback (directory symlinks / junctions). Attempting it on
            # POSIX would delete a real directory that raced into place after the
            # stat above — exactly what the S_ISDIR guard exists to prevent.
            if os.name == "nt":
                try:
                    os.rmdir(target, **kwargs)
                except OSError:
                    pass

    def _create_runtime_file(self):
        """Return a write fd for a freshly created runtime file (mode 0o600).

        O_CREAT|O_EXCL refuses to open an existing entry at all — including a
        symlink, dangling or not — so this either creates our own inode or
        raises. O_NOFOLLOW is belt-and-braces for the same guarantee."""
        self._discard_runtime_entry(self.RUNTIME_FILE)
        target, kwargs = self._runtime_target(self.RUNTIME_FILE)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        return os.open(target, flags, 0o600, **kwargs)

    @staticmethod
    def _is_pid_alive(pid):
        """Check if a process with the given PID is still running."""
        try:
            if sys.platform == "win32":
                import subprocess as _sp
                r = _sp.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                            capture_output=True, text=True, timeout=3)
                return str(pid) in r.stdout
            else:
                os.kill(pid, 0)
                return True
        except (OSError, subprocess.TimeoutExpired):
            return False

    def _is_our_stale_server(self, pid, port):
        """True only if `pid` is plausibly a previous Vela server on `port`.

        SECURITY: the PID reaching both callers comes from the runtime file in a
        directory Vela does not own, i.e. it names a kill TARGET chosen by
        whoever wrote that file. Confirming the process kind AND that it really
        holds the port is what keeps a planted file from turning either path into
        an arbitrary-process kill. One copy, so the two callers cannot drift."""
        return bool(pid) and self._is_python_process(pid) and self._pid_holds_port(pid, port)

    def _kill_pid(self, pid):
        """Kill a process by PID (platform-aware)."""
        try:
            if sys.platform == "win32":
                import subprocess as _sp
                _sp.run(["taskkill", "/PID", str(pid), "/F"],
                        capture_output=True, timeout=5)
            else:
                os.kill(pid, 9)
            return True
        except (OSError, subprocess.TimeoutExpired):
            return False

    @staticmethod
    def _is_python_process(pid):
        """Verify a PID belongs to a Python process (guards against PID recycling)."""
        try:
            if sys.platform == "win32":
                import subprocess as _sp
                r = _sp.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                            capture_output=True, text=True, timeout=3)
                return "python" in r.stdout.lower()
            else:
                with open(f"/proc/{pid}/comm", "r") as f:
                    return "python" in f.read().lower()
        except (OSError, subprocess.TimeoutExpired):
            return False

    @staticmethod
    def _pid_holds_port(pid, port):
        """Verify a PID is actually listening on the given port (netstat/lsof cross-check)."""
        try:
            import subprocess as _sp
            if sys.platform == "win32":
                r = _sp.run(["netstat", "-ano"], capture_output=True, text=True, timeout=5)
                for line in r.stdout.splitlines():
                    if f":{port}" in line and "LISTENING" in line and line.strip().endswith(str(pid)):
                        return True
            else:
                # The state filter matters: a bare port selection also matches
                # sockets whose REMOTE port is `port` — i.e. every client
                # connected to the server, which is not holding the port at all.
                # -a is required: lsof ORs selection filters without it, and the
                # state filter needs -i to apply.
                r = _sp.run(["lsof", "-ti", "-a", "-sTCP:LISTEN", "-i", f":{port}"],
                            capture_output=True, text=True, timeout=3)
                return str(pid) in r.stdout.split()
        except (OSError, subprocess.TimeoutExpired):
            pass
        return False

    def _cleanup_stale_server(self):
        """Read existing .vela.env — if the PID is dead, clean up. If alive and
        confirmed to be a Vela server on our port, kill it.
        Must run BEFORE _write_runtime_info."""
        info = self._read_runtime_info()
        if info is None:
            return  # no file, a link, or corrupt — nothing to clean

        stale_pid = info["pid"]
        stale_port = info["port"]
        if not stale_pid:
            return

        if not self._is_pid_alive(stale_pid):
            print(f"  [port]   Cleaned up stale runtime (PID {stale_pid} dead)")
            self._remove_runtime_files()
            return

        if stale_port == self.port:
            # PID alive + port matches .vela.env — but verify both:
            # 1. It's actually a Python process (guards PID recycling)
            # 2. It's actually bound to the port (guards stale .vela.env)
            if not self._is_our_stale_server(stale_pid, stale_port):
                print(f"  [port]   PID {stale_pid} is not a Vela server on port {stale_port} "
                      f"(recycled PID or stale runtime) — cleaning up")
                self._remove_runtime_files()
                return
            # Confirmed: Python process holding our port — stop it first so we
            # can reuse the same port cleanly ("stop any existing servers first").
            print(f"  [port]   Stopping previous Vela server (PID {stale_pid}, port {stale_port})...")
            self._kill_pid(stale_pid)
            time.sleep(0.5)
            self._remove_runtime_files()

    def _write_runtime_info(self):
        """Write .vela.env with auth token, port, pid.
        Mode 0o600 ensures only the current user can read the token."""
        info = {
            "pid": os.getpid(),
            "port": self.port,
            "host": self.host,
            "mode": "folder",
        }
        if not self._no_auth:
            info["token"] = self._auth_token
        try:
            fd = self._create_runtime_file()
        except OSError as e:
            # Reached when the existing entry could not be replaced (unwritable
            # directory, immutable file, a directory in the way). Continuing
            # without a runtime file is the safe outcome — the alternative is
            # writing a token through something we do not own.
            print(f"  [auth]   WARNING: Could not replace {self.RUNTIME_FILE} ({e})"
                  f" — continuing without a runtime file.")
            return
        try:
            f = os.fdopen(fd, "w", encoding="utf-8")
        except OSError as e:
            os.close(fd)
            print(f"  [auth]   WARNING: Could not write runtime file: {e}")
            return
        try:
            with f:
                json.dump(info, f, indent=2)
                # Report on the object we actually wrote (fstat on our own fd),
                # never on a path that could resolve elsewhere by now.
                actual = os.fstat(f.fileno()).st_mode & 0o777
        except OSError as e:
            print(f"  [auth]   WARNING: Could not write runtime file: {e}")
            return
        if actual != 0o600 and not self._no_auth:
            print(f"  [auth]   WARNING: Cannot enforce file permissions on this filesystem.")
            print(f"           {self.RUNTIME_FILE} token is readable by other users ({oct(actual)}).")

    def _remove_runtime_files(self):
        """Remove runtime files (.vela.env, .vela.pid).

        os.unlink removes the directory entry itself and never dereferences it,
        so this cannot touch whatever a planted link pointed at."""
        for name in (self.RUNTIME_FILE, ".vela.pid"):
            target, kwargs = self._runtime_target(name)
            try:
                os.unlink(target, **kwargs)
            except OSError:
                pass

    def _register_cleanup(self):
        """Register atexit + signal handlers to clean up runtime files on exit."""
        import atexit
        atexit.register(self._remove_runtime_files)

        def _signal_handler(signum, frame):
            self._remove_runtime_files()
            sys.exit(0)

        import signal
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, _signal_handler)
            except (OSError, ValueError):
                pass  # some signals unavailable on Windows

    def _on_template_change(self):
        """Template rebuilt (concat.py ran) — signal all open decks to reload."""
        print(f"[hot] Template changed → reloading browsers")
        with self._lock:
            for tracker in self._deck_trackers.values():
                tracker.bump(reload=True)

    def _start_template_watcher(self):
        """Watch vela.jsx for changes (triggered by concat.py)."""
        self._template_watcher = FileWatcher(TEMPLATE_PATH, self._on_template_change)
        self._template_watcher.start()
        print(f"  [hot]    Watching template for hot reload")

    def run(self):
        self._cleanup_stale_server()
        self._run_folder()

    def _run_folder(self):
        if not os.path.isdir(self.folder_path):
            print(f"ERROR: Directory not found: {self.folder_path}", file=sys.stderr)
            sys.exit(1)

        self.sweep_save_temps()
        self._load_vendor_files()

        VelaHTTPHandler.server_ref = self

        httpd = self._bind_server(VelaHTTPHandler)
        # Binding may have fallen back to a different port — sync self.port to the
        # actual bound port so the URL, banner, and runtime file all agree.
        self.port = httpd.server_address[1]

        # Port bound successfully — write runtime info and register cleanup
        self._write_runtime_info()
        self._register_cleanup()

        # Template hot reload
        self._start_template_watcher()

        # Local AI channel — routes Vera's AI calls to the `claude` CLI so the
        # served deck can use AI with no Anthropic API key (part-engine.jsx's
        # VELA_CHANNEL_PORT branch). Best-effort: a bind failure or missing
        # agent never blocks the deck browser itself.
        self._channel_status = self._start_channel()

        # Count decks
        deck_count = len([f for f in os.listdir(self.folder_path) if f.endswith(DECK_EXT) and os.path.isfile(os.path.join(self.folder_path, f))])

        base_url = f"http://localhost:{self.port}"
        auth_url = base_url if self._no_auth else f"{base_url}/?token={self._auth_token}"

        print(f"\n  ⛵ Vela Local Server")
        print(f"  ────────────────────────────────────")
        print(f"  Folder:  {self.folder_path}")
        print(f"  Decks:   {deck_count} .vela files")
        print(f"  Port:    {self.port}")
        print(f"  Mode:    Folder browser (Jupyter-style)")
        if self._no_auth:
            print(f"  Auth:    DISABLED (--no-auth)")
        else:
            print(f"  Auth:    Token (see {self.RUNTIME_FILE}, or check browser)")
        if self.ai_enabled:
            print(f"  AI:      ENABLED — Vera runs the local `claude` CLI (its credentials/spend)")
            print(f"           Channel: http://127.0.0.1:{self.channel_port} (loopback, token-gated)  {self._channel_status}")
        else:
            print(f"  AI:      off (opt-in with --ai)")
        if self.host == "0.0.0.0" and self._no_auth:
            print(f"  ⚠️  WARNING: Listening on all interfaces WITHOUT authentication!")
            print(f"     Anyone on your network can read/write decks.")
        print(f"  ────────────────────────────────────")
        print(f"  Press Ctrl+C to stop\n")

        if not self.no_open:
            self._open_browser(auth_url)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Stopping server...")
        finally:
            self._template_watcher.stop()
            with self._lock:
                for w in self._deck_watchers.values():
                    w.stop()
            self._stop_channel()
            httpd.shutdown()
            self._remove_runtime_files()

    def _start_channel(self):
        """Start the loopback AI channel on self.channel_port. Returns a short
        status string for the banner. Never raises — the deck browser must come
        up even if the agent CLI is absent or the port is busy.

        No-op unless AI was explicitly enabled (--ai): the channel spawns the
        user's `claude`, so it must never start implicitly."""
        if not self.ai_enabled:
            return "OFF (enable with --ai)"
        if not self.channel_port:
            return ""
        try:
            import agent_backend
        except ImportError as e:
            return f"(disabled: {e})"
        try:
            # Force loopback even if serve.py is on 0.0.0.0: the channel spawns
            # the user's `claude`, so it must never be exposed on the LAN. A
            # remote browser couldn't use it anyway (it fetches its own 127.0.0.1).
            self._channel_server, _ = agent_backend.start_channel_server(self.channel_port, "127.0.0.1", self._channel_token)
        except OSError as e:
            self._channel_server = None
            return f"(disabled: {e})"
        info = agent_backend.agent_available()
        return f"(agent: {info['bin']} {info['version']})" if info["available"] else f"(agent {info['bin']} NOT FOUND)"

    def _stop_channel(self):
        if self._channel_server is not None:
            try:
                import agent_backend
                agent_backend.stop_channel_server(self._channel_server)
            except Exception:
                pass
            self._channel_server = None




def main():
    import argparse
    parser = argparse.ArgumentParser(description="Vela Local Server — Jupyter-style deck browser with live two-way editing")
    parser.add_argument("path", help="Folder of decks, or a deck JSON file (uses its parent folder)")
    parser.add_argument("--port", type=int, default=3030, help="HTTP port (default: 3030)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1, use 0.0.0.0 for LAN access)")
    parser.add_argument("--ai", action="store_true",
                        help="Enable Vera AI via the local `claude` CLI (OFF by default). "
                             "Spawns claude as a tool-sandboxed text completion on a loopback, "
                             "token-gated channel. Opt-in: it uses your Claude Code credentials/spend.")
    parser.add_argument("--channel-port", type=int, default=8787, help="AI channel port when --ai is set (default: 8787)")
    parser.add_argument("--no-open", action="store_true", help="Don't open browser automatically")
    parser.add_argument("--no-auth", action="store_true", help="Disable token authentication (NOT RECOMMENDED)")
    parser.add_argument("--token", default=None, help="Use a specific auth token (default: auto-generated, or VELA_TOKEN env var)")
    parser.add_argument("--replace", action="store_true", help="Replace existing server on the same port (kills it)")
    args = parser.parse_args()

    server = VelaLocalServer(args.path, port=args.port, host=args.host, channel_port=args.channel_port,
                             no_open=args.no_open, no_auth=args.no_auth, token=args.token,
                             replace=args.replace, ai_enabled=args.ai)
    server.run()


if __name__ == "__main__":
    main()
