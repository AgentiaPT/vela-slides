#!/usr/bin/env python3
"""Tests for Vela Local Server (serve.py).

Comprehensive test suite covering:
  - DeckVersionTracker: version bumping, reload flags, long-poll wait
  - FileWatcher: polling, change detection, ignore suppression
  - Folder mode routing: GET/POST for all endpoints
  - Security: path traversal, symlink escape, payload limits, XSS, info leakage
  - Content types and cache headers
  - HTML generation with deck injection
  - Edge cases: concurrency, invalid payloads, empty state
"""

import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest

# ── Path setup ────────────────────────────────────────────────────────
SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "skills", "vela-slides", "scripts")
SKILL_DIR = os.path.dirname(SCRIPTS_DIR)
TEMPLATE_PATH = os.path.join(SKILL_DIR, "app", "vela.jsx")
LOCAL_HTML_PATH = os.path.join(SKILL_DIR, "app", "local.html")

sys.path.insert(0, SCRIPTS_DIR)

from serve import (
    DeckVersionTracker,
    FileWatcher,
    VelaHTTPHandler,
    VelaLocalServer,
    ThreadedHTTPServer,
)
import agent_backend


# ── Fixtures ──────────────────────────────────────────────────────────
SAMPLE_DECK = {
    "deckTitle": "Test Deck",
    "lanes": [{
        "title": "Main",
        "items": [{
            "title": "Test Module",
            "status": "todo",
            "importance": "must",
            "slides": [{
                "bg": "#0f172a",
                "color": "#e2e8f0",
                "accent": "#3b82f6",
                "duration": 60,
                "blocks": [{"type": "heading", "text": "Hello World"}]
            }]
        }]
    }]
}

VELA_EXPORT_DECK = {
    "_vela": True,
    "data": SAMPLE_DECK,
}

BARE_SLIDES_DECK = {
    "deckTitle": "Bare",
    "slides": [{"bg": "#000", "duration": 30, "blocks": []}]
}

TEMPLATES_EXIST = os.path.exists(TEMPLATE_PATH) and os.path.exists(LOCAL_HTML_PATH)


def fetch(port, method, path, body=None, headers=None):
    """HTTP helper -- returns (status, headers_dict, body_bytes)."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    hdrs = headers or {}
    if body and "Content-Type" not in hdrs:
        hdrs["Content-Type"] = "application/json"
    try:
        conn.request(method, path, body=body, headers=hdrs)
    except BrokenPipeError:
        pass  # Server closed before we finished sending (e.g. 413)
    resp = conn.getresponse()
    data = resp.read()
    status = resp.status
    resp_headers = {k.lower(): v for k, v in resp.getheaders()}
    conn.close()
    return status, resp_headers, data


# ── Base class for folder-mode server tests ──────────────────────────
class FolderServerTestBase(unittest.TestCase):
    """Shared setup: creates a temp dir with sample decks and starts a
    folder-mode HTTP server.  Subclasses get cls._port, cls._server,
    cls._tmpdir, and cls._httpd ready to use."""

    _tmpdir = None
    _httpd = None
    _port = None
    _server = None
    _extra_files = {}  # Override in subclass: {name: content_bytes_or_dict}

    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.mkdtemp()
        # Write the default sample deck
        with open(os.path.join(cls._tmpdir, "sample.vela"), "w", encoding="utf-8") as f:
            json.dump(SAMPLE_DECK, f)
        # Write any extra files the subclass declared
        for name, content in cls._extra_files.items():
            path = os.path.join(cls._tmpdir, name)
            if isinstance(content, dict):
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(content, f)
            else:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)

        cls._server = VelaLocalServer(cls._tmpdir, port=0, no_open=True, channel_port=0, no_auth=True)
        cls._server._load_vendor_files()

        VelaHTTPHandler.server_ref = cls._server
        VelaHTTPHandler.static_files = {}

        cls._httpd = ThreadedHTTPServer(("127.0.0.1", 0), VelaHTTPHandler)
        cls._port = cls._httpd.server_address[1]
        cls._thread = threading.Thread(target=cls._httpd.serve_forever, daemon=True)
        cls._thread.start()

    @classmethod
    def tearDownClass(cls):
        if cls._httpd:
            cls._httpd.shutdown()
        if cls._tmpdir:
            shutil.rmtree(cls._tmpdir, ignore_errors=True)

    # Helper for tests that create temp files inside the served folder
    def _write_temp_deck(self, name, data=None):
        """Write a deck file in _tmpdir and register cleanup."""
        path = os.path.join(self._tmpdir, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data or SAMPLE_DECK, f)
        self.addCleanup(lambda p=path: os.unlink(p) if os.path.exists(p) else None)
        return path


# ── 1. DeckVersionTracker ─────────────────────────────────────────────
class TestDeckVersionTracker(unittest.TestCase):
    """Test the long-poll version tracker used for browser sync."""

    def test_initial_version_is_1(self):
        t = DeckVersionTracker()
        self.assertEqual(t.version, 1)

    def test_bump_increments(self):
        t = DeckVersionTracker()
        t.bump()
        self.assertEqual(t.version, 2)
        t.bump()
        self.assertEqual(t.version, 3)

    def test_bump_reload_flag(self):
        t = DeckVersionTracker()
        t.bump(reload=True)
        self.assertTrue(t.needs_reload)

    def test_needs_reload_resets_after_read(self):
        t = DeckVersionTracker()
        t.bump(reload=True)
        self.assertTrue(t.needs_reload)
        self.assertFalse(t.needs_reload)

    def test_wait_returns_true_when_behind(self):
        t = DeckVersionTracker()
        t.bump()  # version=2
        result = t.wait_for_change(1, timeout=0.1)
        self.assertTrue(result)

    def test_wait_blocks_then_returns_on_bump(self):
        """A waiting client unblocks when another thread bumps the version."""
        t = DeckVersionTracker()

        def bumper():
            time.sleep(0.3)
            t.bump()

        threading.Thread(target=bumper, daemon=True).start()
        start = time.time()
        result = t.wait_for_change(1, timeout=5)
        elapsed = time.time() - start
        self.assertTrue(result)
        self.assertLess(elapsed, 3.0, "Should unblock well before timeout")

    def test_wait_timeout_returns_false(self):
        t = DeckVersionTracker()
        result = t.wait_for_change(1, timeout=0.3)
        self.assertFalse(result)

    def test_bump_returns_new_version(self):
        t = DeckVersionTracker()
        v = t.bump()
        self.assertEqual(v, 2)

    def test_concurrent_bumps_are_sequential(self):
        """Multiple threads bumping should produce strictly increasing versions."""
        t = DeckVersionTracker()
        versions = []
        lock = threading.Lock()

        def bump_worker():
            v = t.bump()
            with lock:
                versions.append(v)

        threads = [threading.Thread(target=bump_worker) for _ in range(20)]
        for th in threads:
            th.start()
        for th in threads:
            th.join(timeout=5)

        self.assertEqual(len(versions), 20)
        self.assertEqual(sorted(versions), versions,
                         "Versions should be strictly increasing")
        self.assertEqual(len(set(versions)), 20,
                         "All versions should be unique")


# ── 2. FileWatcher ────────────────────────────────────────────────────
class TestFileWatcher(unittest.TestCase):
    """Test the polling-based file watcher with anti-echo logic."""

    def _make_file(self, content='{"v":1}'):
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
        f.write(content)
        f.close()
        self.addCleanup(lambda: os.unlink(f.name) if os.path.exists(f.name) else None)
        return f.name

    def test_detects_change(self):
        path = self._make_file()
        changes = []
        watcher = FileWatcher(path, lambda: changes.append(1), interval=0.1)
        watcher.start()
        self.addCleanup(watcher.stop)
        time.sleep(0.3)
        with open(path, "w", encoding="utf-8") as f:
            f.write('{"v":2}')
        time.sleep(0.8)
        self.assertGreater(len(changes), 0)

    def test_ignore_next_suppresses(self):
        path = self._make_file()
        changes = []
        watcher = FileWatcher(path, lambda: changes.append(1), interval=0.1)
        watcher.start()
        self.addCleanup(watcher.stop)
        time.sleep(0.3)
        watcher.ignore_next(2.0)
        with open(path, "w", encoding="utf-8") as f:
            f.write('{"v":2}')
        time.sleep(0.8)
        self.assertEqual(len(changes), 0)

    def test_no_change_no_callback(self):
        path = self._make_file()
        changes = []
        watcher = FileWatcher(path, lambda: changes.append(1), interval=0.1)
        watcher.start()
        self.addCleanup(watcher.stop)
        time.sleep(0.5)
        self.assertEqual(len(changes), 0)

    def test_stop_halts_polling(self):
        path = self._make_file()
        changes = []
        watcher = FileWatcher(path, lambda: changes.append(1), interval=0.1)
        watcher.start()
        watcher.stop()
        time.sleep(0.2)
        with open(path, "w", encoding="utf-8") as f:
            f.write('{"v":2}')
        time.sleep(0.5)
        self.assertEqual(len(changes), 0)

    def test_detects_multiple_changes(self):
        path = self._make_file()
        changes = []
        watcher = FileWatcher(path, lambda: changes.append(1), interval=0.1)
        watcher.start()
        self.addCleanup(watcher.stop)
        time.sleep(0.3)
        for i in range(3):
            with open(path, "w", encoding="utf-8") as f:
                f.write(f'{{"v":{i+2}}}')
            time.sleep(0.4)
        self.assertGreaterEqual(len(changes), 2,
                                "Should detect at least 2 of 3 rapid changes")


# ── 3. Folder Mode Routing ────────────────────────────────────────────
class TestFolderModeRouting(FolderServerTestBase):
    """Test all HTTP endpoints when running in folder mode."""

    _extra_files = {"readme.txt": "not a deck"}

    def test_root_returns_html(self):
        status, _, body = fetch(self._port, "GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<!DOCTYPE html>", body)
        self.assertIn(b"Vela Slides", body)

    def test_root_via_index_html(self):
        status, _, body = fetch(self._port, "GET", "/index.html")
        self.assertEqual(status, 200)
        self.assertIn(b"<!DOCTYPE html>", body)

    def test_root_content_type(self):
        _, hdrs, _ = fetch(self._port, "GET", "/")
        self.assertIn("text/html", hdrs["content-type"])

    def test_api_decks_returns_json(self):
        status, hdrs, body = fetch(self._port, "GET", "/api/decks")
        self.assertEqual(status, 200)
        self.assertIn("application/json", hdrs["content-type"])
        data = json.loads(body)
        self.assertIn("decks", data)
        self.assertIn("folder", data)

    def test_api_decks_metadata_fields(self):
        _, _, body = fetch(self._port, "GET", "/api/decks")
        data = json.loads(body)
        deck = next(d for d in data["decks"] if d["name"] == "sample.vela")
        self.assertEqual(deck["title"], "Test Deck")
        self.assertEqual(deck["slides"], 1)
        self.assertIn("size", deck)
        self.assertIn("modified", deck)
        self.assertFalse(deck["compact"])

    def test_api_decks_ignores_non_vela(self):
        _, _, body = fetch(self._port, "GET", "/api/decks")
        names = [d["name"] for d in json.loads(body)["decks"]]
        self.assertNotIn("readme.txt", names)

    @unittest.skipUnless(TEMPLATES_EXIST, "template files required")
    def test_serve_deck_returns_html(self):
        status, hdrs, body = fetch(self._port, "GET", "/deck/sample.vela")
        self.assertEqual(status, 200)
        self.assertIn("text/html", hdrs["content-type"])
        self.assertIn(b"Test Deck", body)

    def test_serve_deck_not_found_404(self):
        status, _, _ = fetch(self._port, "GET", "/deck/nonexistent.vela")
        self.assertEqual(status, 404)

    @unittest.skipUnless(TEMPLATES_EXIST, "template files required")
    def test_serve_deck_url_encoded_name(self):
        self._write_temp_deck("my deck.vela")
        status, _, _ = fetch(self._port, "GET", "/deck/my%20deck.vela")
        self.assertEqual(status, 200)

    def test_poll_returns_json(self):
        status, hdrs, body = fetch(self._port, "GET", "/poll/sample.vela?v=0")
        self.assertEqual(status, 200)
        self.assertIn("application/json", hdrs["content-type"])
        data = json.loads(body)
        self.assertIn("type", data)
        self.assertIn("version", data)

    def test_poll_immediate_when_behind(self):
        tracker = self._server.get_tracker("sample.vela")
        tracker.bump()
        start = time.time()
        status, _, _ = fetch(self._port, "GET", "/poll/sample.vela?v=0")
        elapsed = time.time() - start
        self.assertEqual(status, 200)
        self.assertLess(elapsed, 2.0, "Should return immediately when behind")

    def test_poll_returns_deck_update_on_change(self):
        """When version changes with new deck data, poll returns deck_update."""
        tracker = self._server.get_tracker("sample.vela")
        self._server.set_deck_data("sample.vela", SAMPLE_DECK)
        tracker.bump()
        _, _, body = fetch(self._port, "GET", "/poll/sample.vela?v=1")
        data = json.loads(body)
        self.assertEqual(data["type"], "deck_update")
        self.assertIn("deck", data)

    def test_poll_returns_reload_on_reload_bump(self):
        """When bumped with reload=True, poll returns reload type."""
        tracker = self._server.get_tracker("sample.vela")
        tracker.bump(reload=True)
        _, _, body = fetch(self._port, "GET", "/poll/sample.vela?v=1")
        data = json.loads(body)
        self.assertEqual(data["type"], "reload")

    def test_save_valid_deck_ok(self):
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, body = fetch(self._port, "POST", "/save/sample.vela", body=payload)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body).get("ok"))

    def test_save_writes_to_disk(self):
        self._write_temp_deck("save-target.vela")
        modified = json.loads(json.dumps(SAMPLE_DECK))
        modified["deckTitle"] = "Saved to Disk"
        payload = json.dumps({"type": "deck_save", "deck": modified})
        fetch(self._port, "POST", "/save/save-target.vela", body=payload)
        with open(os.path.join(self._tmpdir, "save-target.vela"), "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["deckTitle"], "Saved to Disk")

    def test_save_invalid_json_400(self):
        status, _, _ = fetch(self._port, "POST", "/save/sample.vela",
                             body=b"not json at all{{{")
        self.assertEqual(status, 400)

    def test_unknown_get_404(self):
        status, _, _ = fetch(self._port, "GET", "/nonexistent")
        self.assertEqual(status, 404)

    def test_unknown_post_404(self):
        status, _, _ = fetch(self._port, "POST", "/nonexistent", body=b"{}")
        self.assertEqual(status, 404)

    def test_head_returns_405_or_501(self):
        """HEAD/OPTIONS on known paths -- server should not crash."""
        conn = http.client.HTTPConnection("127.0.0.1", self._port, timeout=5)
        conn.request("HEAD", "/")
        resp = conn.getresponse()
        resp.read()
        conn.close()
        # BaseHTTPRequestHandler returns 501 for unimplemented methods
        self.assertIn(resp.status, (200, 405, 501))



# ── 5. Security ───────────────────────────────────────────────────────
class TestSecurity(FolderServerTestBase):
    """Security tests: path traversal, symlinks, payload limits, XSS, info leakage.

    THIS IS THE MOST IMPORTANT TEST CLASS.
    """

    # -- DNS rebinding protection (Host header) --

    def test_valid_host_localhost_allowed(self):
        """Requests with Host: localhost should be allowed."""
        status, _, _ = fetch(self._port, "GET", "/",
                             headers={"Host": f"localhost:{self._port}"})
        self.assertEqual(status, 200)

    def test_valid_host_127_allowed(self):
        """Requests with Host: 127.0.0.1 should be allowed."""
        status, _, _ = fetch(self._port, "GET", "/",
                             headers={"Host": f"127.0.0.1:{self._port}"})
        self.assertEqual(status, 200)

    def test_invalid_host_rejected(self):
        """Requests with a non-localhost Host should be rejected (DNS rebinding)."""
        status, _, _ = fetch(self._port, "GET", "/",
                             headers={"Host": "evil.attacker.com"})
        self.assertEqual(status, 403)

    def test_invalid_host_rebinding_rejected(self):
        """Simulate DNS rebinding: Host is attacker domain pointing to 127.0.0.1."""
        status, _, _ = fetch(self._port, "GET", "/api/decks",
                             headers={"Host": "rebind.attacker.com:3030"})
        self.assertEqual(status, 403)

    def test_empty_host_rejected(self):
        """An empty Host header is rejected (v12.71: closes the falsy-host gap
        in the DNS-rebind guard; a real browser always sends one)."""
        status, _, _ = fetch(self._port, "GET", "/", headers={"Host": ""})
        self.assertEqual(status, 403)

    def test_missing_host_rejected(self):
        """A request with NO Host header at all (skip_host) is rejected too --
        http.client auto-adds Host unless skip_host is set, so this exercises the
        genuinely-missing case the empty-string test cannot."""
        conn = http.client.HTTPConnection("127.0.0.1", self._port, timeout=10)
        conn.putrequest("GET", "/", skip_host=True)
        conn.endheaders()
        resp = conn.getresponse()
        status = resp.status
        resp.read()
        conn.close()
        self.assertEqual(status, 403)

    def test_ipv6_loopback_host_allowed(self):
        """IPv6 loopback Host "[::1]:port" is parsed correctly (brackets kept) and
        allowed -- a naive split(':') would mangle it to "[" and wrongly 403."""
        status, _, _ = fetch(self._port, "GET", "/",
                             headers={"Host": f"[::1]:{self._port}"})
        self.assertEqual(status, 200)

    # -- Path traversal on /deck/ --

    def test_deck_dotdot_400(self):
        status, _, _ = fetch(self._port, "GET", "/deck/..%2Fetc%2Fpasswd")
        self.assertEqual(status, 400)

    def test_deck_slash_400(self):
        status, _, _ = fetch(self._port, "GET", "/deck/sub/deck.vela")
        self.assertEqual(status, 400)

    def test_deck_backslash_400(self):
        """Backslash in deck name should be rejected."""
        status, _, _ = fetch(self._port, "GET", "/deck/..\\etc\\passwd")
        self.assertEqual(status, 400)

    def test_deck_encoded_dotdot_400(self):
        """Percent-encoded traversal: %2e%2e%2f should be decoded then blocked."""
        status, _, _ = fetch(self._port, "GET", "/deck/%2e%2e%2fetc%2fpasswd")
        self.assertEqual(status, 400)

    def test_deck_double_encoded_traversal(self):
        """Double-encoded traversal (%252e%252e) -- server does one unquote,
        so %2e%2e remains literal.  Must not return 200 in any case."""
        status, _, _ = fetch(self._port, "GET", "/deck/%252e%252e%252fetc")
        self.assertNotEqual(status, 200,
                            "Double-encoded traversal must not succeed")

    def test_deck_unicode_slash_lookalike_rejected(self):
        """Unicode separator lookalikes (U+2215 DIVISION SLASH) must be rejected
        at validation (400), not just resolve to a missing file (404).  The 400
        is what distinguishes the fix from the pre-fix passthrough.  v12.64."""
        status, _, _ = fetch(self._port, "GET", "/deck/a%E2%88%95b.vela")
        self.assertEqual(status, 400)

    def test_deck_rtlo_bidi_rejected(self):
        """RTLO (U+202E) and other bidi/format controls must be rejected at
        validation (400).  Filename spoofing anti-spoofing.  v12.64."""
        status, _, _ = fetch(self._port, "GET", "/deck/a%E2%80%AEb.vela")
        self.assertEqual(status, 400)

    def test_validate_deck_name_unit(self):
        """Direct unit coverage of _validate_deck_name Unicode hardening (v12.64)."""
        v = VelaHTTPHandler._validate_deck_name
        # legitimate names (incl. accented latin used in pt-PT) still allowed
        self.assertTrue(v("My Deck.vela"))
        self.assertTrue(v("Apresentação.vela"))
        # ASCII traversal / separators still blocked
        self.assertFalse(v("../etc/passwd"))
        self.assertFalse(v("a/b"))
        # Unicode lookalikes + bidi controls blocked
        self.assertFalse(v("a∕b.vela"))   # division slash
        self.assertFalse(v("a⁄b.vela"))   # fraction slash
        self.assertFalse(v("a․․b"))  # one-dot leaders
        self.assertFalse(v("a／b"))         # fullwidth solidus (NFKC -> '/')
        self.assertFalse(v("evil‮gnp.vela"))  # RTLO spoof
        self.assertFalse(v(""))
        self.assertFalse(v("   "))

    # -- Path traversal on /save/ --

    def test_save_dotdot_400(self):
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/../../../etc/shadow", body=payload)
        self.assertEqual(status, 400)

    def test_save_slash_400(self):
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/sub/deck.vela", body=payload)
        self.assertEqual(status, 400)

    # -- Path traversal on /poll/ (DOCUMENTS MISSING VALIDATION) --

    def test_poll_dotdot_rejected(self):
        """Path traversal in /poll/ must be rejected."""
        status, _, _ = fetch(self._port, "GET", "/poll/..%2F..%2Fetc%2Fpasswd?v=0")
        self.assertEqual(status, 400)

    def test_poll_slash_rejected(self):
        """Slashes in /poll/ deck name must be rejected."""
        status, _, _ = fetch(self._port, "GET", "/poll/sub/deck.vela?v=0")
        self.assertEqual(status, 400)

    # -- Symlink escape --

    def test_symlink_outside_folder(self):
        """A symlink pointing outside the folder should NOT serve the target."""
        outside_dir = tempfile.mkdtemp()
        outside_file = os.path.join(outside_dir, "secret.txt")
        with open(outside_file, "w", encoding="utf-8") as f:
            f.write("SECRET DATA")
        self.addCleanup(lambda: shutil.rmtree(outside_dir, ignore_errors=True))

        link_path = os.path.join(self._tmpdir, "escape.vela")
        try:
            os.symlink(outside_file, link_path)
        except OSError:
            self.skipTest("Cannot create symlinks on this filesystem")
        self.addCleanup(lambda: os.unlink(link_path) if os.path.exists(link_path) else None)

        status, _, body = fetch(self._port, "GET", "/deck/escape.vela")
        # The target isn't valid JSON, so _build_html_for_deck errors (500)
        self.assertIn(status, (403, 404, 500),
                      "Symlink to outside file should not return 200")
        self.assertNotIn(b"SECRET DATA", body,
                         "Must not leak content of files outside the folder")

    def test_symlink_to_valid_json_outside_folder_blocked(self):
        """A symlink to a valid JSON deck outside the folder must be blocked."""
        outside_dir = tempfile.mkdtemp()
        outside_deck = os.path.join(outside_dir, "outside.vela")
        with open(outside_deck, "w", encoding="utf-8") as f:
            json.dump({"deckTitle": "Escaped!", "lanes": [{"title": "X", "items": [
                {"title": "M", "status": "todo", "importance": "must",
                 "slides": [{"bg": "#000", "blocks": []}]}
            ]}]}, f)
        self.addCleanup(lambda: shutil.rmtree(outside_dir, ignore_errors=True))

        link_path = os.path.join(self._tmpdir, "symlinked.vela")
        try:
            os.symlink(outside_deck, link_path)
        except OSError:
            self.skipTest("Cannot create symlinks on this filesystem")
        self.addCleanup(lambda: os.unlink(link_path) if os.path.exists(link_path) else None)

        status, _, body = fetch(self._port, "GET", "/deck/symlinked.vela")
        self.assertEqual(status, 403, "Symlink escaping folder must return 403")
        self.assertNotIn(b"Escaped!", body)

    def test_watcher_reread_enforces_folder_containment(self):
        """The live-reload file-watcher re-reads a deck after it changes. That
        re-read must enforce the same folder containment as the HTTP read/write
        paths: if the watched path comes to resolve outside the served folder,
        its contents must not be cached or pushed to clients."""
        outside_dir = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(outside_dir, ignore_errors=True))
        outside_file = os.path.join(outside_dir, "outside.json")
        sentinel = "OUTSIDE_FOLDER_SENTINEL_DATA"
        with open(outside_file, "w", encoding="utf-8") as f:
            json.dump({"secret": sentinel}, f)

        name = "watched-containment.vela"
        deck_path = os.path.join(self._tmpdir, name)
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(SAMPLE_DECK, f)
        self.addCleanup(lambda: os.unlink(deck_path) if os.path.exists(deck_path) else None)

        # Arm the watcher on the legitimate in-folder file, as a real deck open does.
        self._server._ensure_watcher(name)
        watcher = self._server.get_watcher(name)
        # Keep the shared class-scoped server clean for other tests.
        self.addCleanup(lambda: self._server._deck_trackers.pop(name, None))
        self.addCleanup(lambda: self._server._deck_cache.pop(name, None))
        self.addCleanup(lambda: self._server._deck_watchers.pop(name, None))
        if watcher is None:
            self.skipTest("watcher not started on this platform")
        self.addCleanup(watcher.stop)

        # Replace the watched path so it now resolves outside the served folder.
        os.unlink(deck_path)
        try:
            os.symlink(outside_file, deck_path)
        except OSError:
            self.skipTest("Cannot create symlinks on this filesystem")

        # Drive the production re-read callback directly (deterministic, no thread timing).
        watcher.callback()

        cached = self._server.get_deck_data(name)
        leaked = json.dumps(cached) if cached is not None else ""
        self.assertNotIn(sentinel, leaked,
                         "Watcher re-read must not cache contents resolving outside the folder")

    # -- Payload limits --

    def test_save_oversized_413(self):
        huge = "x" * 6_000_000
        status, _, _ = fetch(self._port, "POST", "/save/sample.vela",
                             body=huge.encode(),
                             headers={"Content-Type": "application/json",
                                      "Content-Length": str(len(huge))})
        self.assertEqual(status, 413)

    # -- Content-Length edge cases --

    def test_save_malformed_content_length_no_crash(self):
        """Non-numeric Content-Length is handled gracefully via _safe_content_length."""
        conn = http.client.HTTPConnection("127.0.0.1", self._port, timeout=5)
        try:
            conn.request("POST", "/save/sample.vela", body=b"{}",
                         headers={"Content-Type": "application/json",
                                  "Content-Length": "abc"})
            resp = conn.getresponse()
            resp.read()
        except Exception:
            pass  # Request may fail client-side; we only care the server survives
        finally:
            conn.close()

        # Server must still be alive
        status, _, _ = fetch(self._port, "GET", "/")
        self.assertEqual(status, 200, "Server should survive malformed Content-Length")

    def test_save_negative_content_length_no_crash(self):
        """Negative Content-Length should not crash the server."""
        try:
            conn = http.client.HTTPConnection("127.0.0.1", self._port, timeout=5)
            conn.request("POST", "/save/sample.vela", body=b"{}",
                         headers={"Content-Type": "application/json",
                                  "Content-Length": "-1"})
            resp = conn.getresponse()
            resp.read()
            conn.close()
        except Exception:
            pass  # Request may fail client-side; we only care the server survives

        status, _, _ = fetch(self._port, "GET", "/")
        self.assertEqual(status, 200, "Server should survive negative Content-Length")

    # -- XSS --

    def test_folder_path_not_in_browser_html(self):
        """Static browser HTML (GET /) must not embed the server's fs path."""
        _, _, body = fetch(self._port, "GET", "/")
        self.assertNotIn(self._tmpdir.encode(), body)

    def test_api_decks_no_absolute_path(self):
        """The /api/decks response must not leak the absolute folder path."""
        _, _, body = fetch(self._port, "GET", "/api/decks")
        data = json.loads(body)
        self.assertNotEqual(data["folder"], self._tmpdir,
                            "Must not leak absolute folder path")
        # Should return only the basename
        self.assertEqual(data["folder"], os.path.basename(self._tmpdir))


# ── 5b. Cross-origin / CSRF protection on mutating requests ───────────
class TestOriginCsrf(FolderServerTestBase):
    """Mutating POST /save must only accept requests from the server's own
    origin (scheme + host + port).

    A page on another loopback port shares the host-scoped session cookie
    (cookies are not port-scoped), so a host-only origin check is not
    sufficient — the full origin must match.
    """

    def _payload(self, title="Origin Test"):
        deck = json.loads(json.dumps(SAMPLE_DECK))
        deck["deckTitle"] = title
        return json.dumps({"type": "deck_save", "deck": deck})

    def test_same_origin_save_accepted(self):
        """Origin matching the server's scheme+host+port is accepted."""
        self._write_temp_deck("origin-ok.vela")
        status, _, _ = fetch(self._port, "POST", "/save/origin-ok.vela",
                             body=self._payload(),
                             headers={"Origin": f"http://127.0.0.1:{self._port}"})
        self.assertEqual(status, 200)

    def test_missing_origin_accepted(self):
        """Same-origin XHR and non-browser clients omit Origin — still accepted."""
        self._write_temp_deck("origin-none.vela")
        status, _, _ = fetch(self._port, "POST", "/save/origin-none.vela",
                             body=self._payload())
        self.assertEqual(status, 200)

    def test_different_port_origin_rejected(self):
        """Same host, different port must be rejected (cookies are not port-scoped)."""
        self._write_temp_deck("origin-port.vela")
        status, _, _ = fetch(self._port, "POST", "/save/origin-port.vela",
                             body=self._payload("ATTACK"),
                             headers={"Origin": "http://127.0.0.1:5173"})
        self.assertEqual(status, 403)

    def test_localhost_different_port_origin_rejected(self):
        """A different loopback host/port combination must be rejected."""
        self._write_temp_deck("origin-lh.vela")
        status, _, _ = fetch(self._port, "POST", "/save/origin-lh.vela",
                             body=self._payload("ATTACK"),
                             headers={"Origin": f"http://localhost:{self._port + 1}"})
        self.assertEqual(status, 403)

    def test_foreign_origin_rejected(self):
        """A non-loopback origin must be rejected."""
        self._write_temp_deck("origin-evil.vela")
        status, _, _ = fetch(self._port, "POST", "/save/origin-evil.vela",
                             body=self._payload("ATTACK"),
                             headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403)

    def test_rejected_origin_does_not_write(self):
        """A rejected cross-origin save must leave the deck file untouched."""
        path = self._write_temp_deck("origin-intact.vela")
        with open(path, encoding="utf-8") as f:
            before = f.read()
        fetch(self._port, "POST", "/save/origin-intact.vela",
              body=self._payload("ATTACK"),
              headers={"Origin": "http://127.0.0.1:5173"})
        with open(path, encoding="utf-8") as f:
            after = f.read()
        self.assertEqual(before, after)

    def test_text_plain_save_rejected(self):
        """text/plain avoids a CORS preflight — saves must require application/json."""
        self._write_temp_deck("origin-ct.vela")
        status, _, _ = fetch(self._port, "POST", "/save/origin-ct.vela",
                             body=self._payload("ATTACK"),
                             headers={"Origin": f"http://127.0.0.1:{self._port}",
                                      "Content-Type": "text/plain"})
        self.assertEqual(status, 415)

    def test_text_plain_save_does_not_write(self):
        """A rejected non-JSON save must leave the deck file untouched."""
        path = self._write_temp_deck("origin-ct-intact.vela")
        with open(path, encoding="utf-8") as f:
            before = f.read()
        fetch(self._port, "POST", "/save/origin-ct-intact.vela",
              body=self._payload("ATTACK"),
              headers={"Origin": f"http://127.0.0.1:{self._port}",
                       "Content-Type": "text/plain"})
        with open(path, encoding="utf-8") as f:
            after = f.read()
        self.assertEqual(before, after)


# ── 6. Content Types and Headers ─────────────────────────────────────
class TestContentTypes(FolderServerTestBase):
    """Test HTTP response content types and cache headers."""

    def test_html_content_type(self):
        _, hdrs, _ = fetch(self._port, "GET", "/")
        self.assertIn("text/html", hdrs["content-type"])

    def test_json_content_type(self):
        _, hdrs, _ = fetch(self._port, "GET", "/api/decks")
        self.assertIn("application/json", hdrs["content-type"])

    def test_cache_no_cache_on_dynamic(self):
        _, hdrs, _ = fetch(self._port, "GET", "/")
        self.assertEqual(hdrs.get("cache-control"), "no-cache")

    def test_security_headers_present(self):
        """All responses must include security headers."""
        _, hdrs, _ = fetch(self._port, "GET", "/")
        self.assertEqual(hdrs.get("x-content-type-options"), "nosniff")
        self.assertEqual(hdrs.get("x-frame-options"), "DENY")

    def test_save_response_json_content_type(self):
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        _, hdrs, _ = fetch(self._port, "POST", "/save/sample.vela", body=payload)
        self.assertIn("application/json", hdrs["content-type"])


# ── 7. HTML Generation ───────────────────────────────────────────────
@unittest.skipUnless(TEMPLATES_EXIST, "template files required")
class TestHTMLGeneration(unittest.TestCase):
    """Test HTML generation with deck data injection."""

    _tmpdir = None

    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.mkdtemp()

    @classmethod
    def tearDownClass(cls):
        if cls._tmpdir:
            shutil.rmtree(cls._tmpdir, ignore_errors=True)

    def _make_server(self, deck_data, channel_port=0, ai_enabled=False):
        """Helper to create a folder-mode server and write a deck file."""
        deck_path = os.path.join(self._tmpdir, "gen.vela")
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(deck_data, f)
        server = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=channel_port,
                                 no_auth=True, ai_enabled=ai_enabled)
        return server

    def test_prepare_html_contains_deck(self):
        server = self._make_server(SAMPLE_DECK)
        html = server._prepare_html(SAMPLE_DECK, "gen.vela")
        self.assertIn("Test Deck", html)
        self.assertIn("Hello World", html)

    def test_prepare_html_local_mode_enabled(self):
        server = self._make_server(SAMPLE_DECK)
        html = server._prepare_html(SAMPLE_DECK, "gen.vela")
        self.assertIn("VELA_LOCAL_MODE = true", html)
        self.assertNotIn("VELA_LOCAL_MODE = false", html)

    def test_prepare_html_no_remaining_placeholders(self):
        server = self._make_server(SAMPLE_DECK)
        html = server._prepare_html(SAMPLE_DECK, "gen.vela")
        self.assertNotIn("__VELA_JSX_PLACEHOLDER__", html)
        self.assertNotIn("__VELA_CHANNEL_PORT__", html)
        self.assertNotIn("__VELA_DECK_PATH__", html)

    def test_prepare_html_xss_escape_script_close(self):
        """Deck with '</script>' in title must be escaped to prevent XSS."""
        malicious_deck = json.loads(json.dumps(SAMPLE_DECK))
        malicious_deck["deckTitle"] = 'Test</script><script>alert(1)</script>'
        server = self._make_server(malicious_deck)
        html = server._prepare_html(malicious_deck, "gen.vela")
        self.assertNotIn('</script><script>alert(1)', html,
                         "Raw </script> must be escaped in injected deck JSON")

    def test_prepare_html_jsx_body_script_close_neutralized(self):
        """The vela.jsx *source body* contains literal '</script>' and '<!--'
        substrings (uitest sanitizer payloads). Inlined into
        <script type="text/babel">, the first '</script' would close the block
        early — ejecting the rest of the source as live HTML and executing the
        embedded payloads. They must be backslash-broken (a no-op at JS runtime).
        Distinct from the deck-JSON path, which escape_for_script_context handles."""
        server = self._make_server(SAMPLE_DECK)
        html = server._prepare_html(SAMPLE_DECK, "gen.vela")
        # No raw closer payload survives in the body...
        self.assertNotIn("<script>alert(1)</script>", html,
                         "raw </script in JS body would close the babel block early")
        self.assertNotIn("<!--<img src=x onerror=alert(1)>", html,
                         "raw <!-- in JS body could derail the script-data parser")
        # ...the backslash-broken forms are present (byte-identical at runtime).
        self.assertIn("<script>alert(1)<\\/script>", html)
        self.assertIn("<\\!--<img src=x onerror=alert(1)>", html)

    def test_build_html_for_deck_bare_slides_normalized(self):
        """Deck with only 'slides' (no 'lanes') should be auto-wrapped."""
        deck_path = os.path.join(self._tmpdir, "bare.vela")
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(BARE_SLIDES_DECK, f)
        server = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=0)
        html = server._build_html_for_deck(deck_path, "bare.vela").decode("utf-8")
        self.assertIn("lanes", html)
        self.assertIn("Bare", html)

    def test_build_html_for_deck_vela_export_unwrapped(self):
        """Deck in _vela export format should be unwrapped automatically."""
        deck_path = os.path.join(self._tmpdir, "export.vela")
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(VELA_EXPORT_DECK, f)
        server = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=0)
        html = server._build_html_for_deck(deck_path, "export.vela").decode("utf-8")
        self.assertIn("Test Deck", html)

    def test_prepare_html_channel_port_injected_when_ai_enabled(self):
        server = self._make_server(SAMPLE_DECK, channel_port=9999, ai_enabled=True)
        html = server._prepare_html(SAMPLE_DECK, "gen.vela")
        self.assertIn("VELA_CHANNEL_PORT = 9999", html)
        # Token is injected only in AI mode (page is behind serve.py auth).
        self.assertNotIn('VELA_CHANNEL_TOKEN = "";', html)

    def test_prepare_html_ai_off_by_default(self):
        # Default (no --ai): the channel must NOT be wired into the page, even if
        # a channel_port is configured. Port 0 → velaAIAvailable() is false.
        server = self._make_server(SAMPLE_DECK, channel_port=9999, ai_enabled=False)
        html = server._prepare_html(SAMPLE_DECK, "gen.vela")
        self.assertIn("VELA_CHANNEL_PORT = 0", html)
        self.assertNotIn("VELA_CHANNEL_PORT = 9999", html)
        self.assertIn('VELA_CHANNEL_TOKEN = "";', html)  # left empty


# ── 8. Edge Cases ────────────────────────────────────────────────────
class TestEdgeCases(FolderServerTestBase):
    """Edge case tests: concurrency, invalid payloads, empty state."""

    def test_concurrent_saves(self):
        """Multiple threads saving simultaneously should not corrupt data."""
        self._write_temp_deck("concurrent.vela")
        errors = []

        def save_worker(i):
            try:
                deck = json.loads(json.dumps(SAMPLE_DECK))
                deck["deckTitle"] = f"Concurrent {i}"
                payload = json.dumps({"type": "deck_save", "deck": deck})
                status, _, _ = fetch(self._port, "POST", "/save/concurrent.vela", body=payload)
                if status != 200:
                    errors.append(f"Thread {i}: status {status}")
            except Exception as e:
                errors.append(f"Thread {i}: {e}")

        threads = [threading.Thread(target=save_worker, args=(i,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        self.assertEqual(len(errors), 0, f"Concurrent save errors: {errors}")

        # File must be valid JSON afterward
        with open(os.path.join(self._tmpdir, "concurrent.vela"), "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("deckTitle", data)

    def test_poll_multiple_clients(self):
        """Multiple poll requests waiting, then one bump -- all should return."""
        tracker = self._server.get_tracker("sample.vela")
        current_version = tracker.version
        results = []

        def poll_worker():
            try:
                status, _, _ = fetch(self._port, "GET",
                                     f"/poll/sample.vela?v={current_version}")
                results.append(status)
            except Exception:
                results.append(-1)

        threads = [threading.Thread(target=poll_worker) for _ in range(5)]
        for t in threads:
            t.start()

        time.sleep(0.3)
        tracker.bump()

        for t in threads:
            t.join(timeout=5)

        self.assertEqual(len(results), 5)
        self.assertTrue(all(r == 200 for r in results),
                        f"All poll clients should get 200, got: {results}")

    def test_save_without_lanes_not_written(self):
        """POST with deck missing 'lanes' should be silently ignored."""
        self._write_temp_deck("no-lanes.vela")
        deck_path = os.path.join(self._tmpdir, "no-lanes.vela")
        mtime_before = os.path.getmtime(deck_path)
        time.sleep(0.05)

        payload = json.dumps({"type": "deck_save", "deck": {"deckTitle": "No Lanes"}})
        status, _, _ = fetch(self._port, "POST", "/save/no-lanes.vela", body=payload)
        self.assertEqual(status, 200)

        mtime_after = os.path.getmtime(deck_path)
        self.assertEqual(mtime_before, mtime_after,
                         "File should not be modified when deck has no 'lanes'")

    def test_save_non_dict_deck_not_written(self):
        """POST with deck as a list should be silently ignored."""
        self._write_temp_deck("non-dict.vela")
        deck_path = os.path.join(self._tmpdir, "non-dict.vela")
        mtime_before = os.path.getmtime(deck_path)
        time.sleep(0.05)

        payload = json.dumps({"type": "deck_save", "deck": [1, 2, 3]})
        status, _, _ = fetch(self._port, "POST", "/save/non-dict.vela", body=payload)
        self.assertEqual(status, 200)

        mtime_after = os.path.getmtime(deck_path)
        self.assertEqual(mtime_before, mtime_after)

    def test_save_wrong_type_field_ignored(self):
        """POST with type != 'deck_save' should be silently ignored."""
        self._write_temp_deck("wrong-type.vela")
        deck_path = os.path.join(self._tmpdir, "wrong-type.vela")
        mtime_before = os.path.getmtime(deck_path)
        time.sleep(0.05)

        payload = json.dumps({"type": "other", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/wrong-type.vela", body=payload)
        self.assertEqual(status, 200)

        mtime_after = os.path.getmtime(deck_path)
        self.assertEqual(mtime_before, mtime_after)

    def test_empty_folder_api_decks(self):
        """An empty folder should return an empty decks list."""
        empty_dir = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(empty_dir, ignore_errors=True))
        empty_server = VelaLocalServer(empty_dir, port=0, no_open=True, channel_port=0, no_auth=True)
        empty_server._load_vendor_files()

        # Swap server_ref briefly
        old_ref = VelaHTTPHandler.server_ref
        VelaHTTPHandler.server_ref = empty_server
        try:
            _, _, body = fetch(self._port, "GET", "/api/decks")
            data = json.loads(body)
            self.assertEqual(len(data["decks"]), 0)
        finally:
            VelaHTTPHandler.server_ref = old_ref

    def test_concurrent_poll_and_save(self):
        """Real-world race: polls waiting while saves come in."""
        self._write_temp_deck("race.vela")
        tracker = self._server.get_tracker("race.vela")
        current_v = tracker.version
        poll_results = []
        save_results = []

        def poller():
            status, _, body = fetch(self._port, "GET",
                                    f"/poll/race.vela?v={current_v}")
            poll_results.append(status)

        def saver():
            time.sleep(0.2)
            deck = json.loads(json.dumps(SAMPLE_DECK))
            deck["deckTitle"] = "Race Save"
            payload = json.dumps({"type": "deck_save", "deck": deck})
            status, _, _ = fetch(self._port, "POST", "/save/race.vela", body=payload)
            save_results.append(status)

        poll_threads = [threading.Thread(target=poller) for _ in range(3)]
        save_thread = threading.Thread(target=saver)

        for t in poll_threads:
            t.start()
        save_thread.start()

        for t in poll_threads:
            t.join(timeout=10)
        save_thread.join(timeout=10)

        self.assertTrue(all(r == 200 for r in save_results))
        self.assertTrue(all(r == 200 for r in poll_results),
                        f"All polls should return 200, got: {poll_results}")


# ── AI channel backend (agent_backend.py) ─────────────────────────────
class TestAgentBackendSerialisation(unittest.TestCase):
    """Prompt/arg/parse logic — no real `claude` spawn."""

    def test_single_user_turn_collapses(self):
        # The common Vera case: one user message -> raw content, no role tags.
        self.assertEqual(
            agent_backend.serialise_messages([{"role": "user", "content": "hello"}]),
            "hello",
        )

    def test_multi_turn_is_role_tagged(self):
        out = agent_backend.serialise_messages([
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "yo"},
        ])
        self.assertIn("<USER>", out)
        self.assertIn("<ASSISTANT>", out)

    def test_non_string_content_kept_as_json(self):
        out = agent_backend.serialise_messages([{"role": "user", "content": [{"type": "text", "text": "x"}]}])
        self.assertIn('"type"', out)

    def test_args_lock_down_every_capability(self):
        args = agent_backend._claude_args("/tmp/sys.txt")
        self.assertIn("-p", args)
        self.assertIn("--output-format", args)
        # Positive allowlist of NOTHING (stronger than a denylist).
        self.assertEqual(args[args.index("--tools") + 1], "")
        # No MCP servers, no user/project settings (hooks/plugins/permissions).
        self.assertIn("--strict-mcp-config", args)
        self.assertEqual(args[args.index("--setting-sources") + 1], "")
        # With no tools there is nothing to permit — the dangerous bypass and any
        # denylist/allow flag must be absent.
        for bad in ("--dangerously-skip-permissions", "--disallowed-tools", "--allow-all-tools"):
            self.assertNotIn(bad, args)

    def test_system_prompt_passed_by_file_never_argv(self):
        # The system prompt is delivered by FILE PATH, so no request value ever
        # reaches the command line (CodeQL: no uncontrolled command line).
        args = agent_backend._claude_args("/tmp/vera-sys.txt")
        self.assertIn("--system-prompt-file", args)
        self.assertEqual(args[args.index("--system-prompt-file") + 1], "/tmp/vera-sys.txt")
        self.assertNotIn("--system-prompt", args)  # never the argv-value form

    def test_no_system_prompt_when_empty(self):
        self.assertNotIn("--system-prompt-file", agent_backend._claude_args(None))

    def test_canonical_origin_rebuilds_and_blocks_crlf(self):
        c = agent_backend._canonical_allowed_origin
        # Allowed origins are rebuilt from parsed parts (exact echo for these).
        self.assertEqual(c("http://localhost:3030"), "http://localhost:3030")
        self.assertEqual(c("http://127.0.0.1:8811"), "http://127.0.0.1:8811")
        self.assertEqual(c("null"), "null")
        # Not echoed: absent, foreign, look-alike, non-http.
        for bad in (None, "", "https://evil.com", "http://localhost.evil.com", "file://x"):
            self.assertIsNone(c(bad))
        # A CR/LF-laced Origin can never reach the response header.
        self.assertIsNone(c("http://localhost\r\nSet-Cookie: x=1"))

    def test_run_completion_keeps_system_off_argv(self):
        # End-to-end: whatever the caller sends as `system`, run_completion must
        # never place it on the child's argv — it goes to a temp file.
        seen = {}

        def fake_run(argv, **kw):
            seen["argv"] = argv
            # the system prompt must be in the temp file, not on argv
            sf = argv[argv.index("--system-prompt-file") + 1]
            with open(sf, encoding="utf-8") as f:
                seen["file"] = f.read()
            return type("P", (), {"returncode": 0, "stdout": '{"result":"ok"}', "stderr": ""})()

        orig = agent_backend.subprocess.run
        agent_backend.subprocess.run = fake_run
        try:
            agent_backend.run_completion("SECRET-SYSTEM-PROMPT", [{"role": "user", "content": "hi"}])
        finally:
            agent_backend.subprocess.run = orig
        self.assertNotIn("SECRET-SYSTEM-PROMPT", seen["argv"])
        self.assertIn("--system-prompt-file", seen["argv"])
        self.assertEqual(seen["file"], "SECRET-SYSTEM-PROMPT")

    def test_parse_claude_json(self):
        out = agent_backend._parse_claude(json.dumps({
            "result": "ANSWER", "model": "claude-x",
            "usage": {"input_tokens": 5, "output_tokens": 3},
        }))
        self.assertEqual(out["reply"], "ANSWER")
        self.assertEqual(out["model"], "claude-x")
        self.assertEqual(out["stats"]["input_tokens"], 5)

    def test_parse_claude_non_json_fallback(self):
        out = agent_backend._parse_claude("plain text\x1b[0m answer")
        self.assertEqual(out["reply"], "plain text answer")  # ANSI stripped
        self.assertEqual(out["model"], "claude-code")

    def test_run_completion_missing_binary(self):
        orig = agent_backend.resolve_agent_bin
        agent_backend.resolve_agent_bin = lambda: None
        try:
            r = agent_backend.run_completion("s", [{"role": "user", "content": "x"}])
            self.assertFalse(r["ok"])
            self.assertIn("not found", r["error"])
        finally:
            agent_backend.resolve_agent_bin = orig

    @unittest.skipUnless(os.name == "posix", "world-writable bits are POSIX-only")
    def test_resolve_agent_bin_rejects_world_writable(self):
        # A PATH-planted / world-writable `claude` shim must not be launched.
        d = tempfile.mkdtemp()
        try:
            binp = os.path.join(d, "claude")
            with open(binp, "w") as f:
                f.write("#!/bin/sh\n")
            os.chmod(binp, 0o777)  # world-writable file → untrusted
            orig = agent_backend.shutil.which
            agent_backend.shutil.which = lambda name: binp
            try:
                self.assertIsNone(agent_backend.resolve_agent_bin())
                os.chmod(binp, 0o755)  # now trusted (dir is 0700)
                self.assertEqual(agent_backend.resolve_agent_bin(), binp)
            finally:
                agent_backend.shutil.which = orig
        finally:
            shutil.rmtree(d, ignore_errors=True)


class TestAgentBackendChannel(unittest.TestCase):
    """The loopback channel HTTP contract part-engine.jsx speaks. run_completion
    is stubbed so no real agent is launched."""

    @classmethod
    def setUpClass(cls):
        cls._orig = agent_backend.run_completion
        agent_backend.run_completion = staticmethod(
            lambda system, messages, **kw: {"ok": True, "reply": "STUB:" + (messages[0]["content"] if messages else ""), "model": "stub", "stats": {}}
        )
        cls.server = agent_backend.make_channel_server(port=0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        agent_backend.run_completion = cls._orig
        agent_backend.stop_channel_server(cls.server)

    def _post(self, path, body, origin=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = origin
        conn.request("POST", path, json.dumps(body), headers)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, data, r

    def test_health(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", "/health")
        r = conn.getresponse()
        self.assertEqual(r.status, 200)
        self.assertTrue(json.loads(r.read())["ok"])
        conn.close()

    def test_action_complete(self):
        status, data, _ = self._post("/action", {
            "action": "complete", "system": "SYS",
            "messages": [{"role": "user", "content": "ping"}],
        })
        self.assertEqual(status, 200)
        body = json.loads(data)
        self.assertTrue(body["ok"])
        self.assertEqual(body["reply"], "STUB:ping")

    def test_action_unknown_action(self):
        status, data, _ = self._post("/action", {"action": "delete_everything"})
        self.assertEqual(status, 400)
        self.assertFalse(json.loads(data)["ok"])

    def test_unknown_path_404(self):
        status, _, _ = self._post("/nope", {})
        self.assertEqual(status, 404)

    def test_cors_echoes_origin(self):
        # A file:// harness sends Origin: null; a serve.py page sends its
        # localhost origin. Both must be echoed so the browser fetch succeeds.
        _, _, r = self._post("/action", {
            "action": "complete", "messages": [{"role": "user", "content": "x"}],
        }, origin="null")
        self.assertEqual(r.getheader("Access-Control-Allow-Origin"), "null")

    def test_options_preflight(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("OPTIONS", "/action", headers={"Origin": "http://localhost:3030"})
        r = conn.getresponse()
        self.assertEqual(r.status, 204)
        self.assertEqual(r.getheader("Access-Control-Allow-Origin"), "http://localhost:3030")
        self.assertIn("POST", r.getheader("Access-Control-Allow-Methods"))
        # The token header is non-simple, so the preflight MUST allow it or the
        # browser blocks the real POST ("Failed to fetch").
        self.assertIn("x-vela-token", r.getheader("Access-Control-Allow-Headers"))
        conn.close()

    def test_forbidden_origin_rejected(self):
        # A random website the user is browsing must not be able to drive the
        # channel (drive-by cost/abuse) — rejected before any spawn.
        status, data, r = self._post("/action", {
            "action": "complete", "messages": [{"role": "user", "content": "x"}],
        }, origin="https://evil.example.com")
        self.assertEqual(status, 403)
        self.assertIsNone(r.getheader("Access-Control-Allow-Origin"))

    def test_origin_prefix_bypass_rejected(self):
        # A host that merely STARTS WITH "localhost"/"127.0.0.1" must not pass the
        # loopback check (this was a naive-startswith bug — now parsed exactly).
        for bad in ("http://localhost.evil.com", "http://127.0.0.1.evil.com", "http://localhostx"):
            status, _, _ = self._post("/action", {
                "action": "complete", "messages": [{"role": "user", "content": "x"}],
            }, origin=bad)
            self.assertEqual(status, 403, f"{bad} must be rejected")

    def test_forbidden_host_rejected(self):
        # DNS-rebinding: a malicious domain resolving to 127.0.0.1 is refused by
        # the Host check even though the socket is loopback.
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.putrequest("GET", "/health", skip_host=True)
        conn.putheader("Host", "evil.example.com")
        conn.endheaders()
        r = conn.getresponse()
        self.assertEqual(r.status, 403)
        conn.close()

    def test_make_channel_server_forces_loopback(self):
        # Even asked to bind all interfaces, the channel stays on loopback.
        srv = agent_backend.make_channel_server(port=0, host="0.0.0.0")
        try:
            self.assertEqual(srv.server_address[0], "127.0.0.1")
        finally:
            srv.server_close()


class TestAgentBackendChannelToken(unittest.TestCase):
    """A token-gated channel: /action needs the token (another local user can't
    spend the victim's `claude`); /health stays open."""

    @classmethod
    def setUpClass(cls):
        cls._orig = agent_backend.run_completion
        agent_backend.run_completion = staticmethod(lambda system, messages, **kw: {"ok": True, "reply": "OK", "stats": {}})
        cls.server = agent_backend.make_channel_server(port=0, token="s3cret-token")
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        agent_backend.run_completion = cls._orig
        agent_backend.stop_channel_server(cls.server)

    def _post(self, token):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["x-vela-token"] = token
        conn.request("POST", "/action", json.dumps({"action": "complete", "messages": []}), headers)
        r = conn.getresponse()
        r.read()
        conn.close()
        return r.status

    def test_missing_token_rejected(self):
        self.assertEqual(self._post(None), 401)

    def test_wrong_token_rejected(self):
        self.assertEqual(self._post("nope"), 401)

    def test_correct_token_accepted(self):
        self.assertEqual(self._post("s3cret-token"), 200)

    def test_health_open_without_token(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", "/health")
        self.assertEqual(conn.getresponse().status, 200)
        conn.close()


class TestServeChannelIntegration(unittest.TestCase):
    """VelaLocalServer wiring of the channel (start/stop, disabled when port 0)."""

    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.mkdtemp()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls._tmpdir, ignore_errors=True)

    def test_channel_off_by_default(self):
        # AI must be OFF unless explicitly enabled — even with a channel_port set.
        srv = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=8787, no_auth=True)
        self.assertFalse(srv.ai_enabled)
        self.assertIn("OFF", srv._start_channel())
        self.assertIsNone(srv._channel_server)

    def test_channel_disabled_when_port_zero(self):
        srv = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=0, no_auth=True, ai_enabled=True)
        self.assertEqual(srv._start_channel(), "")
        self.assertIsNone(srv._channel_server)

    def test_channel_starts_and_stops(self):
        import socket
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        free_port = s.getsockname()[1]
        s.close()
        srv = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=free_port, no_auth=True, ai_enabled=True)
        status = srv._start_channel()
        try:
            self.assertIsNotNone(srv._channel_server)
            self.assertIn("agent", status)  # "(agent: ...)" or "(agent ... NOT FOUND)"
            bound = srv._channel_server.server_address[1]
            conn = http.client.HTTPConnection("127.0.0.1", bound, timeout=5)
            conn.request("GET", "/health")
            self.assertEqual(conn.getresponse().status, 200)
            conn.close()
        finally:
            srv._stop_channel()
            self.assertIsNone(srv._channel_server)


class TestBackendParity(unittest.TestCase):
    """The Python channel backend and the Neutralino Go gatekeeper launch the
    SAME `claude` with the SAME lockdown. These assert the two sources cannot
    silently drift on the security-critical contract — if you change one, this
    fails until the other matches."""

    @classmethod
    def setUpClass(cls):
        go_path = os.path.abspath(os.path.join(os.path.dirname(SCRIPTS_DIR), "..", "..",
                                  "vela-neutralino", "extensions", "agent", "main.go"))
        if os.path.exists(go_path):
            with open(go_path, encoding="utf-8") as f:
                cls.go = f.read()
        else:
            cls.go = None
        cls.py = agent_backend._claude_args("SYS")

    def _require_go(self):
        if self.go is None:
            self.skipTest("Go gatekeeper source not present in this checkout")

    def test_python_and_go_lockdown_flags_match(self):
        self._require_go()
        # Each hardening flag must appear in BOTH backends (Go quoted-literal form
        # and Python arg list). If either drops one, the two have drifted.
        self.assertEqual(self.py[self.py.index("--tools") + 1], "")
        self.assertIn('"--tools", ""', self.go)
        self.assertIn("--strict-mcp-config", self.py)
        self.assertIn('"--strict-mcp-config"', self.go)
        self.assertEqual(self.py[self.py.index("--setting-sources") + 1], "")
        self.assertIn('"--setting-sources", ""', self.go)

    def test_neither_backend_weakens_the_sandbox(self):
        self._require_go()
        for bad in ("--dangerously-skip-permissions", "--disallowed-tools",
                    "--allow-all-tools", "--allow-tool"):
            self.assertNotIn(bad, self.py, f"Python backend must not use {bad}")
            self.assertNotIn(f'"{bad}"', self.go, f"Go gatekeeper must not use {bad}")

    def test_both_deliver_system_as_authoritative_prompt(self):
        # Both backends make Vera's instructions the real system prompt (not
        # inline text). The TRANSPORT intentionally differs: Python passes it by
        # FILE (--system-prompt-file) so no request value touches the argv (CodeQL
        # uncontrolled-command-line); the Go desktop passes --system-prompt (argv
        # is not a web-response concern there). Neither may regress to inline.
        self._require_go()
        self.assertIn("--system-prompt-file", self.py)
        self.assertNotIn("--system-prompt", self.py)  # value form never on argv
        self.assertIn('"--system-prompt"', self.go)


if __name__ == "__main__":
    print(f"\n{'='*60}")
    print(f"  Vela Local Server Tests")
    print(f"{'='*60}\n")
    unittest.main(verbosity=2)
