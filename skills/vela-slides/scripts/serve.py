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
  python3 serve.py <deck.json>  [--port 3030] [--no-open]
"""

import hashlib
import hmac
import http.cookies
import http.server
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.parse
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import unquote, quote


# ── Security ──────────────────────────────────────────────────────────
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]", "0.0.0.0"}
MAX_THREADS = 20


# ── Paths ──────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
TEMPLATE_PATH = os.path.join(SKILL_DIR, "app", "vela.jsx")
LOCAL_HTML_PATH = os.path.join(SKILL_DIR, "app", "local.html")


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

    .drop-overlay { position: fixed; inset: 0; background: rgba(59, 130, 246, 0.1); border: 3px dashed #3b82f6; z-index: 9999; display: none; align-items: center; justify-content: center; }
    .drop-overlay.active { display: flex; }
    .drop-overlay .label { font-size: 20px; font-weight: 600; color: #3b82f6; background: #0f172a; padding: 20px 40px; border-radius: 12px; }

    #upload-input { display: none; }
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
    <input type="text" class="search-box" id="search-input" placeholder="Search decks…" oninput="filterList()" />
    <span class="deck-count" id="deck-count"></span>
    <button class="btn" onclick="refreshList()">↻ Refresh</button>
    <button class="btn btn-primary" onclick="document.getElementById('upload-input').click()">+ Import deck</button>
    <input type="file" id="upload-input" accept=".json" multiple onchange="handleUpload(this.files)" />
  </div>
  <div id="deck-list" class="deck-list">
    <div class="loading">Loading decks…</div>
  </div>
  <div class="drop-overlay" id="drop-overlay">
    <div class="label">Drop deck JSON files here</div>
  </div>

  <script>
    var listEl = document.getElementById('deck-list');
    var countEl = document.getElementById('deck-count');
    var folderEl = document.getElementById('folder-path');
    var searchEl = document.getElementById('search-input');
    var allDecks = [];
    var sortCol = 'modified';
    var sortAsc = false;

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function formatDate(iso) {
      var d = new Date(iso);
      var now = new Date();
      var diff = (now - d) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
      return d.toLocaleDateString();
    }

    function sortDecks(decks) {
      var col = sortCol;
      return decks.slice().sort(function(a, b) {
        var va, vb;
        if (col === 'title') { va = (a.title || a.name).toLowerCase(); vb = (b.title || b.name).toLowerCase(); }
        else if (col === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
        else if (col === 'slides') { va = a.slides; vb = b.slides; }
        else if (col === 'size') { va = a.size; vb = b.size; }
        else { va = a.modified; vb = b.modified; }
        if (va < vb) return sortAsc ? -1 : 1;
        if (va > vb) return sortAsc ? 1 : -1;
        return 0;
      });
    }

    function setSort(col) {
      if (sortCol === col) { sortAsc = !sortAsc; }
      else { sortCol = col; sortAsc = col === 'title' || col === 'name'; }
      renderList();
    }

    function arrow(col) {
      if (sortCol !== col) return '<span class="sort-arrow">⇅</span>';
      return '<span class="sort-arrow">' + (sortAsc ? '▲' : '▼') + '</span>';
    }

    function esc(s) { if (!s) return ''; var el = document.createElement('span'); el.textContent = s; return el.innerHTML; }

    function filterList() { renderList(); }

    function renderList() {
      var q = searchEl.value.toLowerCase().trim();
      var filtered = allDecks;
      if (q) {
        filtered = allDecks.filter(function(d) {
          return (d.title || '').toLowerCase().indexOf(q) !== -1 || d.name.toLowerCase().indexOf(q) !== -1;
        });
      }
      var sorted = sortDecks(filtered);
      countEl.textContent = (q ? sorted.length + '/' : '') + allDecks.length + ' deck' + (allDecks.length !== 1 ? 's' : '');

      if (sorted.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><div class="icon">' + (q ? '🔍' : '📂') + '</div><div class="msg">' + (q ? 'No decks match "' + q.replace(/</g,'&lt;') + '"' : 'No deck files found. Import a .json deck to get started.') + '</div></div>';
        return;
      }

      var cls = function(c) { return sortCol === c ? ' class="sorted"' : ''; };
      var html = '<table><thead><tr>';
      html += '<th' + cls('title') + ' onclick="setSort(\'title\')">Title ' + arrow('title') + '</th>';
      html += '<th' + cls('name') + ' onclick="setSort(\'name\')">File ' + arrow('name') + '</th>';
      html += '<th' + cls('slides') + ' onclick="setSort(\'slides\')" style="text-align:right">Slides ' + arrow('slides') + '</th>';
      html += '<th' + cls('size') + ' onclick="setSort(\'size\')" style="text-align:right">Size ' + arrow('size') + '</th>';
      html += '<th' + cls('modified') + ' onclick="setSort(\'modified\')">Modified ' + arrow('modified') + '</th>';
      html += '<th style="width:60px"></th>';
      html += '</tr></thead><tbody>';
      sorted.forEach(function(d) {
        var url = '/deck/' + encodeURIComponent(d.name);
        html += '<tr class="deck-row" onclick="window.location=\'' + url + '\'">';
        html += '<td class="col-title"><a href="' + url + '">' + esc(d.title || d.name) + '</a></td>';
        html += '<td class="col-file">' + esc(d.name) + '</td>';
        html += '<td class="col-slides">' + d.slides + '</td>';
        html += '<td class="col-size">' + formatSize(d.size) + '</td>';
        html += '<td class="col-modified" title="' + d.modified + '">' + formatDate(d.modified) + '</td>';
        html += '<td class="col-badge">' + (d.compact ? '<span class="deck-badge">compact</span>' : '') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      listEl.innerHTML = html;
    }

    function refreshList() {
      fetch('/api/decks')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          folderEl.textContent = data.folder;
          allDecks = data.decks;
          renderList();
        })
        .catch(function(e) {
          listEl.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><div class="msg">Error loading decks: ' + e.message + '</div></div>';
        });
    }

    function uploadFiles(files) {
      var promises = [];
      for (var i = 0; i < files.length; i++) {
        (function(file) {
          promises.push(
            file.text().then(function(text) {
              return fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, content: text })
              }).then(function(r) { return r.json(); });
            })
          );
        })(files[i]);
      }
      Promise.all(promises).then(function(results) {
        var errors = results.filter(function(r) { return !r.ok; });
        if (errors.length) alert('Some files failed to import: ' + errors.map(function(r) { return r.error; }).join(', '));
        refreshList();
      });
    }

    function handleUpload(fileList) {
      if (!fileList.length) return;
      uploadFiles(fileList);
      document.getElementById('upload-input').value = '';
    }

    // Drag & drop
    var dropOverlay = document.getElementById('drop-overlay');
    var dragCounter = 0;
    document.addEventListener('dragenter', function(e) { e.preventDefault(); dragCounter++; dropOverlay.classList.add('active'); });
    document.addEventListener('dragleave', function(e) { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active'); } });
    document.addEventListener('dragover', function(e) { e.preventDefault(); });
    document.addEventListener('drop', function(e) {
      e.preventDefault();
      dragCounter = 0;
      dropOverlay.classList.remove('active');
      var files = [];
      for (var i = 0; i < e.dataTransfer.files.length; i++) {
        if (e.dataTransfer.files[i].name.endsWith('.json')) files.push(e.dataTransfer.files[i]);
      }
      if (files.length) uploadFiles(files);
    });

    // Focus search on Ctrl+F / Cmd+F
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); searchEl.focus(); searchEl.select(); }
      if (e.key === 'Escape' && document.activeElement === searchEl) { searchEl.value = ''; filterList(); searchEl.blur(); }
    });

    refreshList();
  </script>
</body>
</html>"""


# ── HTTP handler ──────────────────────────────────────────────────────
class VelaHTTPHandler(http.server.BaseHTTPRequestHandler):
    # Single-deck mode (legacy)
    html_content = b""
    static_files = {}
    version_tracker = None
    server_ref = None

    # ── Security helpers ───────────────────────────────────────────

    def _check_host(self):
        """DNS rebinding protection: reject requests from non-localhost Host."""
        host = (self.headers.get("Host") or "").split(":")[0].strip()
        if host and host not in ALLOWED_HOSTS:
            self.send_error(403, "Forbidden: invalid Host header")
            return False
        return True

    @staticmethod
    def _validate_deck_name(name):
        """Return True if deck name is safe (no traversal, no slashes, no null bytes,
        no characters that could break JS/HTML string contexts)."""
        return ("/" not in name and "\\" not in name and ".." not in name
                and "\x00" not in name and "'" not in name and '"' not in name
                and "<" not in name and ">" not in name and "`" not in name
                and name.strip())

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
            if hmac.compare_digest(url_token, srv._auth_token):
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
            if hmac.compare_digest(auth_header[7:], srv._auth_token):
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
        self.send_error(401, "Authentication required. Open the URL with ?token= printed at server startup.")
        return False

    def _check_origin(self):
        """Defense-in-depth: reject cross-origin POST/mutating requests."""
        origin = self.headers.get("Origin", "")
        if not origin:
            return True  # same-origin requests omit Origin
        host_part = origin.split("//", 1)[-1].split(":")[0].split("/")[0]
        if host_part in ALLOWED_HOSTS:
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

    def end_headers(self):
        """Override to inject security headers into all responses."""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    # ── Routing ────────────────────────────────────────────────────

    def do_GET(self):
        if not self._check_host():
            return
        if not self._check_auth():
            return
        srv = self.server_ref
        if srv and srv.folder_mode:
            self._route_folder_get()
        else:
            self._route_single_get()

    def do_POST(self):
        if not self._check_host():
            return
        if not self._check_auth():
            return
        if not self._check_origin():
            return
        srv = self.server_ref
        if srv and srv.folder_mode:
            self._route_folder_post()
        else:
            self._route_single_post()

    # ── Folder mode routing ───────────────────────────────────────────

    def _route_folder_get(self):
        if self.path == "/" or self.path == "/index.html":
            content = build_browser_html().encode("utf-8")
            self._serve(content, "text/html; charset=utf-8")
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
        elif self.path == "/api/upload":
            self._handle_upload()
        else:
            self.send_error(404)

    def _handle_list_decks(self):
        srv = self.server_ref
        decks = []
        for name in sorted(os.listdir(srv.folder_path)):
            if not name.endswith(".json"):
                continue
            fpath = os.path.join(srv.folder_path, name)
            if not os.path.isfile(fpath):
                continue
            stat = os.stat(fpath)
            # Try to read deck metadata
            title = name
            slide_count = 0
            is_compact = False
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and data.get("_vela") and "data" in data:
                    data = data["data"]
                title = data.get("deckTitle") or data.get("T") or name
                is_compact = "_" in data or "S" in data
                if "lanes" in data:
                    for lane in data["lanes"]:
                        for item in lane.get("items", []):
                            slide_count += len(item.get("slides", []))
                elif "S" in data:
                    # Compact format — S is slides or lanes
                    slide_count = sum(
                        len(item.get("slides", item.get("s", [])))
                        for lane in (data["S"] if isinstance(data["S"], list) else [])
                        for item in (lane.get("items", lane.get("I", [])) if isinstance(lane, dict) else [])
                    )
                elif "slides" in data:
                    slide_count = len(data["slides"])
            except Exception:
                pass  # Corrupt or unreadable JSON — skip metadata, still list the file

            decks.append({
                "name": name,
                "title": title,
                "slides": slide_count,
                "size": stat.st_size,
                "modified": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_mtime)),
                "compact": is_compact,
            })
        response = json.dumps({"folder": os.path.basename(srv.folder_path), "decks": decks}).encode("utf-8")
        self._serve(response, "application/json; charset=utf-8")

    def _handle_serve_deck(self):
        """GET /deck/<name> — serve Vela app with this deck loaded."""
        srv = self.server_ref
        deck_name = unquote(self.path[len("/deck/"):])

        # Strip query string
        if "?" in deck_name:
            deck_name = deck_name.split("?", 1)[0]

        # Security: no path traversal
        if not self._validate_deck_name(deck_name):
            self.send_error(400, "Invalid deck name")
            return

        try:
            deck_path = self._safe_deck_path(srv.folder_path, deck_name)
        except ValueError:
            self.send_error(403, "Access denied")
            return

        if not os.path.isfile(deck_path):
            self.send_error(404, "Deck not found")
            return

        try:
            html = srv._build_html_for_deck(deck_path, deck_name)
            self._serve(html, "text/html; charset=utf-8")
        except Exception as e:
            print(f"[error] Building HTML for {deck_name}: {e}")
            self.send_error(500, "Error loading deck")

    def _handle_deck_poll(self):
        """GET /poll/<name>?v=N — long-poll for a specific deck."""
        srv = self.server_ref
        rest = self.path[len("/poll/"):]
        if "?" in rest:
            deck_name = unquote(rest.split("?", 1)[0])
        else:
            deck_name = unquote(rest)

        if not self._validate_deck_name(deck_name):
            self.send_error(400, "Invalid deck name")
            return

        tracker = srv.get_tracker(deck_name)
        if not tracker:
            self.send_error(404, "Deck not tracked")
            return

        self._poll_response(tracker, lambda: srv.get_deck_data(deck_name))

    def _handle_deck_save(self):
        """POST /save/<name> — browser sends deck updates for a specific deck."""
        srv = self.server_ref
        deck_name = unquote(self.path[len("/save/"):])

        if not self._validate_deck_name(deck_name):
            self.send_error(400, "Invalid deck name")
            return

        try:
            deck, error_sent = self._read_save_payload()
            if error_sent:
                return
            if deck:
                try:
                    deck_path = self._safe_deck_path(srv.folder_path, deck_name)
                except ValueError:
                    self.send_error(403, "Access denied")
                    return
                srv.set_deck_data(deck_name, deck)
                watcher = srv.get_watcher(deck_name)
                if watcher:
                    watcher.ignore_next(2.0)
                with open(deck_path, "w", encoding="utf-8") as f:
                    json.dump(deck, f, ensure_ascii=False, indent=2)
                tracker = srv.get_tracker(deck_name)
                if tracker:
                    tracker.bump()
                print(f"[sync] Browser edit → saved {deck_name}")
            self._json_response(200, {"ok": True})
        except Exception as e:
            if not isinstance(e, BrokenPipeError):
                print(f"[save] Error: {e}")
                self.send_error(400, "Invalid request")

    def _handle_upload(self):
        """POST /api/upload — import a deck JSON file into the folder."""
        content_length = self._safe_content_length()
        if content_length > 10_000_000:
            self.send_error(413, "Payload too large")
            return

        body = self.rfile.read(content_length)
        try:
            parsed = json.loads(body)
            filename = parsed.get("filename", "")
            content_str = parsed.get("content", "")

            if not filename.endswith(".json"):
                filename = filename + ".json"

            # Security: sanitize filename
            filename = os.path.basename(filename)
            if not filename or filename.startswith("."):
                self._json_response(400, {"ok": False, "error": "Invalid filename"})
                return
            if not self._validate_deck_name(filename):
                self._json_response(400, {"ok": False, "error": "Invalid filename characters"})
                return

            # Validate it's valid JSON with deck-like structure
            deck_data = json.loads(content_str)
            if not isinstance(deck_data, dict):
                self._json_response(400, {"ok": False, "error": "Not a valid deck (must be JSON object)"})
                return

            srv = self.server_ref
            try:
                dest = self._safe_deck_path(srv.folder_path, filename)
            except ValueError:
                self._json_response(403, {"ok": False, "error": "Access denied"})
                return

            # Write formatted
            with open(dest, "w", encoding="utf-8") as f:
                json.dump(deck_data, f, ensure_ascii=False, indent=2)

            print(f"[import] Saved {filename} ({os.path.getsize(dest)} bytes)")
            self._json_response(200, {"ok": True, "name": filename})
        except json.JSONDecodeError:
            self._json_response(400, {"ok": False, "error": "Invalid JSON content"})
        except Exception as e:
            print(f"[upload] Error: {e}")
            self._json_response(500, {"ok": False, "error": "Upload failed"})

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

    # ── Single-deck mode routing (legacy) ─────────────────────────────

    def _route_single_get(self):
        if self.path.startswith("/poll"):
            self._handle_poll()
        elif self.path == "/" or self.path == "/index.html":
            self._serve(self.html_content, "text/html; charset=utf-8")
        elif self.path == "/deck.json":
            data = json.dumps(self.server_ref._deck_data, ensure_ascii=False, indent=2).encode("utf-8")
            self._serve(data, "application/json; charset=utf-8")
        elif self.path in self.static_files:
            content, ctype = self.static_files[self.path]
            self._serve(content, ctype, cache="max-age=86400")
        else:
            self.send_error(404)

    def _route_single_post(self):
        if self.path == "/save":
            self._handle_save()
        else:
            self.send_error(404)

    # ── Shared helpers ────────────────────────────────────────────────

    def _serve(self, content, content_type, cache="no-cache"):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(content)
        # BrokenPipeError propagates to process_request_thread which handles it.

    def _handle_poll(self):
        """Long-poll: block until deck changes, then return new deck (single mode)."""
        self._poll_response(self.version_tracker, lambda: self.server_ref._deck_data)

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

    def _handle_save(self):
        """Handle POST /save — browser sends deck updates."""
        try:
            deck, error_sent = self._read_save_payload()
            if error_sent:
                return
            if deck:
                self.server_ref._deck_data = deck
                self.server_ref.file_watcher.ignore_next(2.0)
                self.server_ref._write_deck(deck)
                self.version_tracker.bump()
                print(f"[sync] Browser edit → saved to file")
            self._json_response(200, {"ok": True})
        except Exception as e:
            if not isinstance(e, BrokenPipeError):
                print(f"[save] Error: {e}")
                self.send_error(400, "Invalid request")

    def log_message(self, fmt, *args):
        pass  # quiet


class ThreadedHTTPServer(http.server.HTTPServer):
    """HTTP server with a bounded thread pool to prevent DoS via thread exhaustion."""
    daemon_threads = True

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

    def _file_hash(self):
        try:
            with open(self.path, "rb") as f:
                return hashlib.sha256(f.read()).hexdigest()
        except Exception:
            return ""

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
                print(f"[watch] Error: {e}")
            time.sleep(self.interval)


# ── Main server ────────────────────────────────────────────────────────
class VelaLocalServer:
    def __init__(self, path, port=3030, host="127.0.0.1", channel_port=0, no_open=False,
                 no_auth=False, token=None):
        self.port = port
        self.host = host
        self.channel_port = channel_port
        self.no_open = no_open
        self._vendor_available = False

        # Auth state
        self._no_auth = no_auth
        self._auth_token = token or os.environ.get("VELA_TOKEN") or secrets.token_urlsafe(32)
        self._sessions = set()
        self._sessions_lock = threading.Lock()

        # Detect mode: folder vs single file
        abs_path = os.path.abspath(path)
        if os.path.isdir(abs_path):
            self.folder_mode = True
            self.folder_path = abs_path
            self.deck_path = None
            self._deck_data = None
            self.file_watcher = None
            self.version_tracker = None
            # Per-deck state for folder mode
            self._deck_trackers = {}    # name → DeckVersionTracker
            self._deck_watchers = {}    # name → FileWatcher
            self._deck_cache = {}       # name → dict (deck data)
            self._lock = threading.Lock()
        else:
            self.folder_mode = False
            self.folder_path = None
            self.deck_path = abs_path
            self._deck_data = None
            self.version_tracker = DeckVersionTracker()
            self.file_watcher = None

    # ── Per-deck state management (folder mode) ──────────────────────

    def get_tracker(self, deck_name):
        with self._lock:
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
                    fpath = os.path.join(self.folder_path, name)
                    with open(fpath, "r", encoding="utf-8") as f:
                        new_data = json.load(f)
                    self.set_deck_data(name, new_data)
                    self.get_tracker(name).bump()
                    print(f"[sync] {name} changed → pushed to browser")
                except Exception as e:
                    print(f"[sync] Error reading {name}: {e}")

            watcher = FileWatcher(deck_path, on_change)
            watcher.start()
            self._deck_watchers[deck_name] = watcher

    # ── HTML building ────────────────────────────────────────────────

    @staticmethod
    def _normalize_deck(data):
        """Unwrap Vela export format and normalize bare slides → lanes."""
        if isinstance(data, dict) and data.get("_vela") and "data" in data:
            data = data["data"]
        if isinstance(data, dict) and "slides" in data and "lanes" not in data:
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
        marker = "const STARTUP_PATCH = null;"
        if marker not in vela_jsx:
            raise RuntimeError("STARTUP_PATCH marker not found in template")
        deck_json_str = deck_json_str.replace("</", "<\\/")
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
        vela_jsx = vela_jsx.replace("const VELA_CHANNEL_PORT = 0;", f"const VELA_CHANNEL_PORT = {self.channel_port};", 1)

        # Assemble HTML
        html = html_template.replace("__VELA_JSX_PLACEHOLDER__", vela_jsx)
        html = html.replace("__VELA_CHANNEL_PORT__", str(self.channel_port))
        html = html.replace("'__VELA_DECK_PATH__'", json.dumps(deck_label))

        if self._vendor_available:
            html = html.replace("https://unpkg.com/@babel/standalone@7.24.0/babel.min.js", "/vendor/babel.min.js")

        return html

    def _build_html_for_deck(self, deck_path, deck_name):
        """Build the Vela app HTML for a specific deck file (folder mode)."""
        with open(deck_path, "r", encoding="utf-8") as f:
            deck_data = self._normalize_deck(json.load(f))

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

    def _build_html(self):
        """Build HTML for single-deck mode."""
        html = self._prepare_html(self._deck_data, os.path.basename(self.deck_path))
        return html.encode("utf-8")

    # ── Vendor files ─────────────────────────────────────────────────

    def _load_vendor_files(self):
        self._vendor_available = False
        search_dirs = [
            self.folder_path or os.path.dirname(self.deck_path),
            os.getcwd(),
            os.path.dirname(os.path.dirname(SKILL_DIR)),
        ]
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

    def _read_deck(self):
        with open(self.deck_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write_deck(self, data):
        with open(self.deck_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _on_file_change(self):
        try:
            new_data = self._read_deck()
            self._deck_data = new_data
            self.version_tracker.bump()
            print(f"[sync] File changed → pushed to browser")
        except Exception as e:
            print(f"[sync] Error reading file: {e}")

    def _open_browser(self, url):
        webbrowser.open(url)

    def _retry_after_stale_kill(self, handler_class):
        """Kill the stale process on our port and retry binding."""
        import subprocess
        print(f"  [port]   Port {self.port} in use — killing stale process...")
        # Try reading PID from .vela.json first (most reliable)
        runtime_path = os.path.join(os.getcwd(), ".vela.json")
        killed = False
        try:
            with open(runtime_path, encoding="utf-8") as f:
                info = json.load(f)
            stale_pid = info.get("pid")
            if stale_pid and info.get("port") == self.port:
                os.kill(stale_pid, 9)
                killed = True
                print(f"  [port]   Killed stale PID {stale_pid}")
        except (OSError, json.JSONDecodeError, ProcessLookupError):
            pass
        # Fallback: use lsof to find the process
        if not killed:
            try:
                result = subprocess.run(["lsof", "-ti", f":{self.port}"], capture_output=True, text=True, timeout=3)
                for pid_str in result.stdout.strip().split("\n"):
                    if pid_str.strip():
                        try:
                            os.kill(int(pid_str.strip()), 9)
                            killed = True
                            print(f"  [port]   Killed stale PID {pid_str.strip()}")
                        except (ProcessLookupError, ValueError):
                            pass
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass
        if not killed:
            print(f"  [port]   ERROR: Could not free port {self.port}. Is another service using it?", file=sys.stderr)
            sys.exit(1)
        import time
        time.sleep(0.5)
        try:
            return ThreadedHTTPServer((self.host, self.port), handler_class)
        except OSError:
            print(f"  [port]   ERROR: Port {self.port} still in use after kill.", file=sys.stderr)
            sys.exit(1)

    # ── Run ──────────────────────────────────────────────────────────

    def _write_runtime_info(self):
        """Write runtime info file (.vela.json) with auth token, port, pid.
        Mode 0o600 ensures only the current user can read the token.
        Also writes legacy .vela.pid for backward compat."""
        info = {
            "pid": os.getpid(),
            "port": self.port,
            "host": self.host,
            "mode": "folder" if self.folder_mode else "single",
        }
        if not self._no_auth:
            info["token"] = self._auth_token
        runtime_path = os.path.join(os.getcwd(), ".vela.json")
        try:
            fd = os.open(runtime_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump(info, f, indent=2)
            # Verify permissions were actually applied (drvfs/9p mounts ignore them)
            actual = os.stat(runtime_path).st_mode & 0o777
            if actual != 0o600 and not self._no_auth:
                print(f"  [auth]   WARNING: Cannot enforce file permissions on this filesystem.")
                print(f"           .vela.json token is readable by other users ({oct(actual)}).")
        except OSError as e:
            print(f"  [auth]   WARNING: Could not write runtime file: {e}")
        # Legacy pidfile
        pidfile = os.path.join(os.getcwd(), ".vela.pid")
        with open(pidfile, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))

    def _on_template_change(self):
        """Template rebuilt (concat.py ran) — signal all open decks to reload."""
        print(f"[hot] Template changed → reloading browsers")
        if self.folder_mode:
            with self._lock:
                for tracker in self._deck_trackers.values():
                    tracker.bump(reload=True)
        else:
            self.version_tracker.bump(reload=True)

    def _start_template_watcher(self):
        """Watch vela.jsx for changes (triggered by concat.py)."""
        self._template_watcher = FileWatcher(TEMPLATE_PATH, self._on_template_change)
        self._template_watcher.start()
        print(f"  [hot]    Watching template for hot reload")

    def run(self):
        self._write_runtime_info()
        if self.folder_mode:
            self._run_folder()
        else:
            self._run_single()

    def _run_folder(self):
        if not os.path.isdir(self.folder_path):
            print(f"ERROR: Directory not found: {self.folder_path}", file=sys.stderr)
            sys.exit(1)

        self._load_vendor_files()

        VelaHTTPHandler.server_ref = self

        try:
            httpd = ThreadedHTTPServer((self.host, self.port), VelaHTTPHandler)
        except OSError as e:
            if e.errno == 98:  # Address already in use
                httpd = self._retry_after_stale_kill(VelaHTTPHandler)
            else:
                raise

        # Template hot reload
        self._start_template_watcher()

        # Count decks
        deck_count = len([f for f in os.listdir(self.folder_path) if f.endswith(".json") and os.path.isfile(os.path.join(self.folder_path, f))])

        base_url = f"http://localhost:{self.port}"
        auth_url = base_url if self._no_auth else f"{base_url}/?token={self._auth_token}"
        print(f"\n  ⛵ Vela Local Server")
        print(f"  ────────────────────────────────────")
        print(f"  Folder:  {self.folder_path}")
        print(f"  Decks:   {deck_count} JSON files")
        print(f"  URL:     {auth_url}")
        print(f"  Mode:    Folder browser (Jupyter-style)")
        print(f"  Sync:    Long-poll + POST (per-deck)")
        if self._no_auth:
            print(f"  Auth:    DISABLED (--no-auth)")
        else:
            print(f"  Auth:    Token (copy URL above to authenticate)")
        if self.channel_port:
            print(f"  Channel: http://localhost:{self.channel_port} (Claude Code bridge)")
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
            httpd.shutdown()

    def _run_single(self):
        if not os.path.exists(self.deck_path):
            print(f"ERROR: File not found: {self.deck_path}", file=sys.stderr)
            sys.exit(1)

        try:
            self._deck_data = self._normalize_deck(self._read_deck())
        except json.JSONDecodeError as e:
            print(f"ERROR: Invalid JSON in {self.deck_path}: {e}", file=sys.stderr)
            sys.exit(1)

        self._load_vendor_files()

        html_content = self._build_html()
        VelaHTTPHandler.html_content = html_content
        VelaHTTPHandler.version_tracker = self.version_tracker
        VelaHTTPHandler.server_ref = self

        try:
            httpd = ThreadedHTTPServer((self.host, self.port), VelaHTTPHandler)
        except OSError as e:
            if e.errno == 98:  # Address already in use
                httpd = self._retry_after_stale_kill(VelaHTTPHandler)
            else:
                raise

        self.file_watcher = FileWatcher(self.deck_path, self._on_file_change)
        self.file_watcher.start()

        # Template hot reload
        self._start_template_watcher()

        total_slides = sum(
            len(item.get("slides", []))
            for lane in self._deck_data.get("lanes", [])
            for item in lane.get("items", [])
        )

        base_url = f"http://localhost:{self.port}"
        auth_url = base_url if self._no_auth else f"{base_url}/?token={self._auth_token}"
        print(f"\n  ⛵ Vela Local Server")
        print(f"  ────────────────────────────────────")
        print(f"  Deck:    {os.path.basename(self.deck_path)} ({total_slides} slides)")
        print(f"  URL:     {auth_url}")
        print(f"  Mode:    Local (AI features disabled)")
        print(f"  Sync:    Long-poll + POST (single port)")
        if self._no_auth:
            print(f"  Auth:    DISABLED (--no-auth)")
        else:
            print(f"  Auth:    Token (copy URL above to authenticate)")
        if self.channel_port:
            print(f"  Channel: http://localhost:{self.channel_port} (Claude Code bridge)")
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
            self.file_watcher.stop()
            self._template_watcher.stop()
            httpd.shutdown()


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Vela Local Server — live two-way editing")
    parser.add_argument("path", help="Path to deck JSON file or folder of decks")
    parser.add_argument("--port", type=int, default=3030, help="HTTP port (default: 3030)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1, use 0.0.0.0 for LAN access)")
    parser.add_argument("--channel-port", type=int, default=8787, help="Channel server port (default: 8787, 0 to disable)")
    parser.add_argument("--no-open", action="store_true", help="Don't open browser automatically")
    parser.add_argument("--no-auth", action="store_true", help="Disable token authentication (NOT RECOMMENDED)")
    parser.add_argument("--token", default=None, help="Use a specific auth token (default: auto-generated, or VELA_TOKEN env var)")
    args = parser.parse_args()

    server = VelaLocalServer(args.path, port=args.port, host=args.host, channel_port=args.channel_port,
                             no_open=args.no_open, no_auth=args.no_auth, token=args.token)
    server.run()


if __name__ == "__main__":
    main()
