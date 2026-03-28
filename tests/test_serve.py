#!/usr/bin/env python3
"""Tests for Vela Local Server (serve.py).

Comprehensive test suite covering:
  - DeckVersionTracker: version bumping, reload flags, long-poll wait
  - FileWatcher: polling, change detection, ignore suppression
  - Folder mode routing: GET/POST for all endpoints
  - Single-deck mode routing: GET/POST for all endpoints
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
        with open(os.path.join(cls._tmpdir, "sample.json"), "w") as f:
            json.dump(SAMPLE_DECK, f)
        # Write any extra files the subclass declared
        for name, content in cls._extra_files.items():
            path = os.path.join(cls._tmpdir, name)
            if isinstance(content, dict):
                with open(path, "w") as f:
                    json.dump(content, f)
            else:
                with open(path, "w") as f:
                    f.write(content)

        cls._server = VelaLocalServer(cls._tmpdir, port=0, no_open=True, channel_port=0, no_auth=True)
        cls._server._load_vendor_files()

        VelaHTTPHandler.server_ref = cls._server
        VelaHTTPHandler.html_content = b""
        VelaHTTPHandler.version_tracker = None
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
        with open(path, "w") as f:
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
        with open(path, "w") as f:
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
        with open(path, "w") as f:
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
        with open(path, "w") as f:
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
            with open(path, "w") as f:
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
        deck = next(d for d in data["decks"] if d["name"] == "sample.json")
        self.assertEqual(deck["title"], "Test Deck")
        self.assertEqual(deck["slides"], 1)
        self.assertIn("size", deck)
        self.assertIn("modified", deck)
        self.assertFalse(deck["compact"])

    def test_api_decks_ignores_non_json(self):
        _, _, body = fetch(self._port, "GET", "/api/decks")
        names = [d["name"] for d in json.loads(body)["decks"]]
        self.assertNotIn("readme.txt", names)

    @unittest.skipUnless(TEMPLATES_EXIST, "template files required")
    def test_serve_deck_returns_html(self):
        status, hdrs, body = fetch(self._port, "GET", "/deck/sample.json")
        self.assertEqual(status, 200)
        self.assertIn("text/html", hdrs["content-type"])
        self.assertIn(b"Test Deck", body)

    def test_serve_deck_not_found_404(self):
        status, _, _ = fetch(self._port, "GET", "/deck/nonexistent.json")
        self.assertEqual(status, 404)

    @unittest.skipUnless(TEMPLATES_EXIST, "template files required")
    def test_serve_deck_url_encoded_name(self):
        self._write_temp_deck("my deck.json")
        status, _, _ = fetch(self._port, "GET", "/deck/my%20deck.json")
        self.assertEqual(status, 200)

    def test_poll_returns_json(self):
        status, hdrs, body = fetch(self._port, "GET", "/poll/sample.json?v=0")
        self.assertEqual(status, 200)
        self.assertIn("application/json", hdrs["content-type"])
        data = json.loads(body)
        self.assertIn("type", data)
        self.assertIn("version", data)

    def test_poll_immediate_when_behind(self):
        tracker = self._server.get_tracker("sample.json")
        tracker.bump()
        start = time.time()
        status, _, _ = fetch(self._port, "GET", "/poll/sample.json?v=0")
        elapsed = time.time() - start
        self.assertEqual(status, 200)
        self.assertLess(elapsed, 2.0, "Should return immediately when behind")

    def test_poll_returns_deck_update_on_change(self):
        """When version changes with new deck data, poll returns deck_update."""
        tracker = self._server.get_tracker("sample.json")
        self._server.set_deck_data("sample.json", SAMPLE_DECK)
        tracker.bump()
        _, _, body = fetch(self._port, "GET", "/poll/sample.json?v=1")
        data = json.loads(body)
        self.assertEqual(data["type"], "deck_update")
        self.assertIn("deck", data)

    def test_poll_returns_reload_on_reload_bump(self):
        """When bumped with reload=True, poll returns reload type."""
        tracker = self._server.get_tracker("sample.json")
        tracker.bump(reload=True)
        _, _, body = fetch(self._port, "GET", "/poll/sample.json?v=1")
        data = json.loads(body)
        self.assertEqual(data["type"], "reload")

    def test_save_valid_deck_ok(self):
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, body = fetch(self._port, "POST", "/save/sample.json", body=payload)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body).get("ok"))

    def test_save_writes_to_disk(self):
        self._write_temp_deck("save-target.json")
        modified = json.loads(json.dumps(SAMPLE_DECK))
        modified["deckTitle"] = "Saved to Disk"
        payload = json.dumps({"type": "deck_save", "deck": modified})
        fetch(self._port, "POST", "/save/save-target.json", body=payload)
        with open(os.path.join(self._tmpdir, "save-target.json"), "r") as f:
            data = json.load(f)
        self.assertEqual(data["deckTitle"], "Saved to Disk")

    def test_save_invalid_json_400(self):
        status, _, _ = fetch(self._port, "POST", "/save/sample.json",
                             body=b"not json at all{{{")
        self.assertEqual(status, 400)

    def test_upload_valid_deck(self):
        payload = json.dumps({
            "filename": "uploaded.json",
            "content": json.dumps(SAMPLE_DECK)
        })
        status, _, body = fetch(self._port, "POST", "/api/upload", body=payload)
        self.addCleanup(lambda: os.unlink(os.path.join(self._tmpdir, "uploaded.json"))
                        if os.path.exists(os.path.join(self._tmpdir, "uploaded.json")) else None)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body).get("ok"))

    def test_upload_creates_file(self):
        payload = json.dumps({
            "filename": "created.json",
            "content": json.dumps(SAMPLE_DECK)
        })
        path = os.path.join(self._tmpdir, "created.json")
        self.addCleanup(lambda: os.unlink(path) if os.path.exists(path) else None)
        fetch(self._port, "POST", "/api/upload", body=payload)
        self.assertTrue(os.path.exists(path))
        with open(path, "r") as f:
            data = json.load(f)
        self.assertEqual(data["deckTitle"], "Test Deck")

    def test_upload_adds_json_extension(self):
        """Filename without .json should get it appended."""
        payload = json.dumps({
            "filename": "no-ext",
            "content": json.dumps(SAMPLE_DECK)
        })
        path = os.path.join(self._tmpdir, "no-ext.json")
        self.addCleanup(lambda: os.unlink(path) if os.path.exists(path) else None)
        status, _, body = fetch(self._port, "POST", "/api/upload", body=payload)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body).get("name"), "no-ext.json")
        self.assertTrue(os.path.exists(path))

    def test_upload_invalid_json_400(self):
        payload = json.dumps({
            "filename": "bad.json",
            "content": "not valid json {{{"
        })
        status, _, _ = fetch(self._port, "POST", "/api/upload", body=payload)
        self.assertEqual(status, 400)

    def test_upload_non_dict_400(self):
        payload = json.dumps({
            "filename": "array.json",
            "content": json.dumps([1, 2, 3])
        })
        status, _, _ = fetch(self._port, "POST", "/api/upload", body=payload)
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


# ── 4. Single Mode Routing ────────────────────────────────────────────
@unittest.skipUnless(TEMPLATES_EXIST, "template files required")
class TestSingleModeRouting(unittest.TestCase):
    """Test all HTTP endpoints when running in single-deck mode (legacy)."""

    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.mkdtemp()
        deck_path = os.path.join(cls._tmpdir, "single.json")
        with open(deck_path, "w") as f:
            json.dump(SAMPLE_DECK, f)

        cls._server = VelaLocalServer(deck_path, port=0, no_open=True, channel_port=0, no_auth=True)
        cls._server._deck_data = SAMPLE_DECK
        cls._server.file_watcher = FileWatcher(deck_path, lambda: None)

        html_content = cls._server._build_html()
        VelaHTTPHandler.html_content = html_content
        VelaHTTPHandler.version_tracker = cls._server.version_tracker
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

    def test_root_returns_html(self):
        status, hdrs, body = fetch(self._port, "GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<!DOCTYPE html>", body)

    def test_deck_json_endpoint(self):
        status, hdrs, body = fetch(self._port, "GET", "/deck.json")
        self.assertEqual(status, 200)
        self.assertIn("application/json", hdrs["content-type"])
        data = json.loads(body)
        self.assertEqual(data["deckTitle"], "Test Deck")

    def test_poll_returns_json(self):
        status, _, body = fetch(self._port, "GET", "/poll?v=0")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertIn("type", data)
        self.assertIn("version", data)

    def test_save_valid_deck(self):
        modified = json.loads(json.dumps(SAMPLE_DECK))
        modified["deckTitle"] = "Single Save Test"
        payload = json.dumps({"type": "deck_save", "deck": modified})
        status, _, body = fetch(self._port, "POST", "/save", body=payload)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body).get("ok"))
        # Restore
        self._server._deck_data = SAMPLE_DECK

    def test_save_oversized_413(self):
        huge = "x" * 6_000_000
        status, _, _ = fetch(self._port, "POST", "/save",
                             body=huge.encode(),
                             headers={"Content-Type": "application/json",
                                      "Content-Length": str(len(huge))})
        self.assertEqual(status, 413)

    def test_unknown_path_404(self):
        status, _, _ = fetch(self._port, "GET", "/nonexistent")
        self.assertEqual(status, 404)

    def test_post_to_wrong_path_404(self):
        status, _, _ = fetch(self._port, "POST", "/api/upload", body=b"{}")
        self.assertEqual(status, 404)


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

    # -- Path traversal on /deck/ --

    def test_deck_dotdot_400(self):
        status, _, _ = fetch(self._port, "GET", "/deck/..%2Fetc%2Fpasswd")
        self.assertEqual(status, 400)

    def test_deck_slash_400(self):
        status, _, _ = fetch(self._port, "GET", "/deck/sub/deck.json")
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

    # -- Path traversal on /save/ --

    def test_save_dotdot_400(self):
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/../../../etc/shadow", body=payload)
        self.assertEqual(status, 400)

    def test_save_slash_400(self):
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/sub/deck.json", body=payload)
        self.assertEqual(status, 400)

    # -- Path traversal on /poll/ (DOCUMENTS MISSING VALIDATION) --

    def test_poll_dotdot_rejected(self):
        """Path traversal in /poll/ must be rejected."""
        status, _, _ = fetch(self._port, "GET", "/poll/..%2F..%2Fetc%2Fpasswd?v=0")
        self.assertEqual(status, 400)

    def test_poll_slash_rejected(self):
        """Slashes in /poll/ deck name must be rejected."""
        status, _, _ = fetch(self._port, "GET", "/poll/sub/deck.json?v=0")
        self.assertEqual(status, 400)

    # -- Symlink escape --

    def test_symlink_outside_folder(self):
        """A symlink pointing outside the folder should NOT serve the target."""
        outside_dir = tempfile.mkdtemp()
        outside_file = os.path.join(outside_dir, "secret.txt")
        with open(outside_file, "w") as f:
            f.write("SECRET DATA")
        self.addCleanup(lambda: shutil.rmtree(outside_dir, ignore_errors=True))

        link_path = os.path.join(self._tmpdir, "escape.json")
        try:
            os.symlink(outside_file, link_path)
        except OSError:
            self.skipTest("Cannot create symlinks on this filesystem")
        self.addCleanup(lambda: os.unlink(link_path) if os.path.exists(link_path) else None)

        status, _, body = fetch(self._port, "GET", "/deck/escape.json")
        # The target isn't valid JSON, so _build_html_for_deck errors (500)
        self.assertIn(status, (403, 404, 500),
                      "Symlink to outside file should not return 200")
        self.assertNotIn(b"SECRET DATA", body,
                         "Must not leak content of files outside the folder")

    def test_symlink_to_valid_json_outside_folder_blocked(self):
        """A symlink to a valid JSON deck outside the folder must be blocked."""
        outside_dir = tempfile.mkdtemp()
        outside_deck = os.path.join(outside_dir, "outside.json")
        with open(outside_deck, "w") as f:
            json.dump({"deckTitle": "Escaped!", "lanes": [{"title": "X", "items": [
                {"title": "M", "status": "todo", "importance": "must",
                 "slides": [{"bg": "#000", "blocks": []}]}
            ]}]}, f)
        self.addCleanup(lambda: shutil.rmtree(outside_dir, ignore_errors=True))

        link_path = os.path.join(self._tmpdir, "symlinked.json")
        try:
            os.symlink(outside_deck, link_path)
        except OSError:
            self.skipTest("Cannot create symlinks on this filesystem")
        self.addCleanup(lambda: os.unlink(link_path) if os.path.exists(link_path) else None)

        status, _, body = fetch(self._port, "GET", "/deck/symlinked.json")
        self.assertEqual(status, 403, "Symlink escaping folder must return 403")
        self.assertNotIn(b"Escaped!", body)

    # -- Payload limits --

    def test_save_oversized_413(self):
        huge = "x" * 6_000_000
        status, _, _ = fetch(self._port, "POST", "/save/sample.json",
                             body=huge.encode(),
                             headers={"Content-Type": "application/json",
                                      "Content-Length": str(len(huge))})
        self.assertEqual(status, 413)

    def test_upload_oversized_413(self):
        huge = "x" * 11_000_000
        status, _, _ = fetch(self._port, "POST", "/api/upload",
                             body=huge.encode(),
                             headers={"Content-Type": "application/json",
                                      "Content-Length": str(len(huge))})
        self.assertEqual(status, 413)

    # -- Content-Length edge cases --

    def test_save_malformed_content_length_no_crash(self):
        """Non-numeric Content-Length is handled gracefully via _safe_content_length."""
        conn = http.client.HTTPConnection("127.0.0.1", self._port, timeout=5)
        try:
            conn.request("POST", "/save/sample.json", body=b"{}",
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
            conn.request("POST", "/save/sample.json", body=b"{}",
                         headers={"Content-Type": "application/json",
                                  "Content-Length": "-1"})
            resp = conn.getresponse()
            resp.read()
            conn.close()
        except Exception:
            pass  # Request may fail client-side; we only care the server survives

        status, _, _ = fetch(self._port, "GET", "/")
        self.assertEqual(status, 200, "Server should survive negative Content-Length")

    # -- Upload filename sanitization --

    def test_upload_dotfile_rejected(self):
        payload = json.dumps({
            "filename": ".hidden.json",
            "content": json.dumps(SAMPLE_DECK)
        })
        status, _, body = fetch(self._port, "POST", "/api/upload", body=payload)
        self.assertEqual(status, 400)
        self.assertFalse(json.loads(body).get("ok"))

    def test_upload_traversal_stripped(self):
        """Filename '../../evil.json' is sanitized to 'evil.json' via basename."""
        payload = json.dumps({
            "filename": "../../evil.json",
            "content": json.dumps(SAMPLE_DECK)
        })
        path = os.path.join(self._tmpdir, "evil.json")
        self.addCleanup(lambda: os.unlink(path) if os.path.exists(path) else None)
        status, _, body = fetch(self._port, "POST", "/api/upload", body=payload)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body).get("name"), "evil.json")

    def test_upload_empty_filename_rejected(self):
        payload = json.dumps({
            "filename": "",
            "content": json.dumps(SAMPLE_DECK)
        })
        status, _, _ = fetch(self._port, "POST", "/api/upload", body=payload)
        self.assertEqual(status, 400)

    def test_upload_overwrite_existing(self):
        """DOCUMENTS CURRENT BEHAVIOR: uploading with the same name silently
        overwrites.  No conflict check is performed."""
        original_path = self._write_temp_deck("overwrite-test.json",
                                               {"deckTitle": "Original", "lanes": []})
        payload = json.dumps({
            "filename": "overwrite-test.json",
            "content": json.dumps({"deckTitle": "Overwritten", "lanes": []})
        })
        status, _, _ = fetch(self._port, "POST", "/api/upload", body=payload)
        self.assertEqual(status, 200)
        with open(original_path, "r") as f:
            data = json.load(f)
        self.assertEqual(data["deckTitle"], "Overwritten",
                         "Upload silently overwrites (documented behavior)")

    # -- Error info leakage --

    def test_upload_error_no_stacktrace(self):
        """Error responses must not contain Python tracebacks or internal details."""
        payload = json.dumps({
            "filename": "test.json",
            "content": "not json at all"
        })
        status, _, body = fetch(self._port, "POST", "/api/upload", body=payload)
        self.assertEqual(status, 400)
        body_str = body.decode("utf-8", errors="replace")
        self.assertNotIn("Traceback", body_str)
        self.assertNotIn("File \"/", body_str)
        # Error message should be generic
        data = json.loads(body_str)
        self.assertEqual(data.get("error"), "Invalid JSON content")

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
        _, hdrs, _ = fetch(self._port, "POST", "/save/sample.json", body=payload)
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

    def _make_server(self, deck_data):
        """Helper to create a single-mode server with given deck data."""
        deck_path = os.path.join(self._tmpdir, "gen.json")
        with open(deck_path, "w") as f:
            json.dump(deck_data, f)
        server = VelaLocalServer(deck_path, port=0, no_open=True, channel_port=0, no_auth=True)
        server._deck_data = deck_data
        return server

    def test_build_html_contains_deck(self):
        html = self._make_server(SAMPLE_DECK)._build_html().decode("utf-8")
        self.assertIn("Test Deck", html)
        self.assertIn("Hello World", html)

    def test_build_html_local_mode_enabled(self):
        html = self._make_server(SAMPLE_DECK)._build_html().decode("utf-8")
        self.assertIn("VELA_LOCAL_MODE = true", html)
        self.assertNotIn("VELA_LOCAL_MODE = false", html)

    def test_build_html_no_remaining_placeholders(self):
        html = self._make_server(SAMPLE_DECK)._build_html().decode("utf-8")
        self.assertNotIn("__VELA_JSX_PLACEHOLDER__", html)
        self.assertNotIn("__VELA_CHANNEL_PORT__", html)
        self.assertNotIn("__VELA_DECK_PATH__", html)

    def test_build_html_xss_escape_script_close(self):
        """Deck with '</script>' in title must be escaped to prevent XSS."""
        malicious_deck = json.loads(json.dumps(SAMPLE_DECK))
        malicious_deck["deckTitle"] = 'Test</script><script>alert(1)</script>'
        html = self._make_server(malicious_deck)._build_html().decode("utf-8")
        self.assertNotIn('</script><script>alert(1)', html,
                         "Raw </script> must be escaped in injected deck JSON")

    def test_build_html_bare_slides_normalized(self):
        """Deck with only 'slides' (no 'lanes') should be auto-wrapped."""
        deck_path = os.path.join(self._tmpdir, "bare.json")
        with open(deck_path, "w") as f:
            json.dump(BARE_SLIDES_DECK, f)
        server = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=0)
        html = server._build_html_for_deck(deck_path, "bare.json").decode("utf-8")
        self.assertIn("lanes", html)
        self.assertIn("Bare", html)

    def test_build_html_vela_export_unwrapped(self):
        """Deck in _vela export format should be unwrapped automatically."""
        deck_path = os.path.join(self._tmpdir, "export.json")
        with open(deck_path, "w") as f:
            json.dump(VELA_EXPORT_DECK, f)
        server = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=0)
        html = server._build_html_for_deck(deck_path, "export.json").decode("utf-8")
        self.assertIn("Test Deck", html)

    def test_build_html_channel_port_injected(self):
        deck_path = os.path.join(self._tmpdir, "gen.json")
        with open(deck_path, "w") as f:
            json.dump(SAMPLE_DECK, f)
        server = VelaLocalServer(deck_path, port=0, no_open=True, channel_port=9999, no_auth=True)
        server._deck_data = SAMPLE_DECK
        html = server._build_html().decode("utf-8")
        self.assertIn("VELA_CHANNEL_PORT = 9999", html)


# ── 8. Edge Cases ────────────────────────────────────────────────────
class TestEdgeCases(FolderServerTestBase):
    """Edge case tests: concurrency, invalid payloads, empty state."""

    def test_concurrent_saves(self):
        """Multiple threads saving simultaneously should not corrupt data."""
        self._write_temp_deck("concurrent.json")
        errors = []

        def save_worker(i):
            try:
                deck = json.loads(json.dumps(SAMPLE_DECK))
                deck["deckTitle"] = f"Concurrent {i}"
                payload = json.dumps({"type": "deck_save", "deck": deck})
                status, _, _ = fetch(self._port, "POST", "/save/concurrent.json", body=payload)
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
        with open(os.path.join(self._tmpdir, "concurrent.json"), "r") as f:
            data = json.load(f)
        self.assertIn("deckTitle", data)

    def test_poll_multiple_clients(self):
        """Multiple poll requests waiting, then one bump -- all should return."""
        tracker = self._server.get_tracker("sample.json")
        current_version = tracker.version
        results = []

        def poll_worker():
            try:
                status, _, _ = fetch(self._port, "GET",
                                     f"/poll/sample.json?v={current_version}")
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
        self._write_temp_deck("no-lanes.json")
        deck_path = os.path.join(self._tmpdir, "no-lanes.json")
        mtime_before = os.path.getmtime(deck_path)
        time.sleep(0.05)

        payload = json.dumps({"type": "deck_save", "deck": {"deckTitle": "No Lanes"}})
        status, _, _ = fetch(self._port, "POST", "/save/no-lanes.json", body=payload)
        self.assertEqual(status, 200)

        mtime_after = os.path.getmtime(deck_path)
        self.assertEqual(mtime_before, mtime_after,
                         "File should not be modified when deck has no 'lanes'")

    def test_save_non_dict_deck_not_written(self):
        """POST with deck as a list should be silently ignored."""
        self._write_temp_deck("non-dict.json")
        deck_path = os.path.join(self._tmpdir, "non-dict.json")
        mtime_before = os.path.getmtime(deck_path)
        time.sleep(0.05)

        payload = json.dumps({"type": "deck_save", "deck": [1, 2, 3]})
        status, _, _ = fetch(self._port, "POST", "/save/non-dict.json", body=payload)
        self.assertEqual(status, 200)

        mtime_after = os.path.getmtime(deck_path)
        self.assertEqual(mtime_before, mtime_after)

    def test_save_wrong_type_field_ignored(self):
        """POST with type != 'deck_save' should be silently ignored."""
        self._write_temp_deck("wrong-type.json")
        deck_path = os.path.join(self._tmpdir, "wrong-type.json")
        mtime_before = os.path.getmtime(deck_path)
        time.sleep(0.05)

        payload = json.dumps({"type": "other", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/wrong-type.json", body=payload)
        self.assertEqual(status, 200)

        mtime_after = os.path.getmtime(deck_path)
        self.assertEqual(mtime_before, mtime_after)

    def test_upload_very_long_filename(self):
        """OS-level filename length limit should produce a clean error, not crash."""
        long_name = "a" * 300 + ".json"
        payload = json.dumps({
            "filename": long_name,
            "content": json.dumps(SAMPLE_DECK)
        })
        status, _, _ = fetch(self._port, "POST", "/api/upload", body=payload)
        # OS returns ENAMETOOLONG -- server should catch it and return 500
        self.assertIn(status, (200, 500),
                      "Very long filename: should succeed or return 500 (not crash)")
        # Clean up if somehow created
        path = os.path.join(self._tmpdir, long_name)
        if os.path.exists(path):
            os.unlink(path)

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
        self._write_temp_deck("race.json")
        tracker = self._server.get_tracker("race.json")
        current_v = tracker.version
        poll_results = []
        save_results = []

        def poller():
            status, _, body = fetch(self._port, "GET",
                                    f"/poll/race.json?v={current_v}")
            poll_results.append(status)

        def saver():
            time.sleep(0.2)
            deck = json.loads(json.dumps(SAMPLE_DECK))
            deck["deckTitle"] = "Race Save"
            payload = json.dumps({"type": "deck_save", "deck": deck})
            status, _, _ = fetch(self._port, "POST", "/save/race.json", body=payload)
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


if __name__ == "__main__":
    print(f"\n{'='*60}")
    print(f"  Vela Local Server Tests")
    print(f"{'='*60}\n")
    unittest.main(verbosity=2)
