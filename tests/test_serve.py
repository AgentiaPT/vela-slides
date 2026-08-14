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
import re
import shutil
import sys
import tempfile
import threading
import time
import unicodedata
import unittest
from urllib.parse import quote

# ── Path setup ────────────────────────────────────────────────────────
# serve.py / agent_backend.py / local.html are dev-only tooling under
# tools/vela-dev/; the app source part-files live in src/parts/, and only the
# built monolith (vela.jsx) ships from the skill dir.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(REPO_ROOT, "tools", "vela-dev", "scripts")
TEMPLATE_PATH = os.path.join(REPO_ROOT, "skills", "vela-slides", "app", "vela.jsx")
LOCAL_HTML_PATH = os.path.join(REPO_ROOT, "tools", "vela-dev", "local.html")

sys.path.insert(0, SCRIPTS_DIR)

import serve as serve_mod

# Root bypasses file permission checks, so "this file is not writable" cannot be
# expressed to it — open(path, "w") on a 0444 file succeeds for root too, which
# is exactly what the server's writability pre-check now mirrors. Tests that
# depend on a write being refused are meaningless (and fail) under root.
RUNNING_AS_ROOT = hasattr(os, "geteuid") and os.geteuid() == 0
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

        # bump() guarantees each caller a unique, gap-free version; it does NOT
        # guarantee the order threads later append into `versions` matches the
        # order they were handed a version (the append is a separate critical
        # section). So assert the real invariant — the multiset of returned
        # versions is exactly the consecutive range — not the append order.
        self.assertEqual(len(versions), 20)
        self.assertEqual(sorted(versions), list(range(2, 22)),
                         "Concurrent bumps must yield unique, gap-free versions")


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

    # -- Link escapes on the deck sinks --
    # Realpath containment sees a symlink but CANNOT see a hard link: a hard
    # link to a file outside the served folder resolves inside it. So the deck
    # sinks must not write through, or read out of, a linked entry either.

    def _link_deck(self, maker, name, outside_name, content="OUTSIDE"):
        outside_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside_dir, ignore_errors=True)
        outside = os.path.join(outside_dir, outside_name)
        with open(outside, "w", encoding="utf-8") as f:
            f.write(content)
        link = os.path.join(self._tmpdir, name)
        try:
            maker(outside, link)
        except (OSError, NotImplementedError):
            self.skipTest("filesystem/platform cannot create this link type")
        self.addCleanup(lambda: os.path.exists(outside) and os.unlink(outside))
        self.addCleanup(lambda: os.path.exists(link) and os.unlink(link))
        return outside, link

    def test_save_through_hardlinked_deck_does_not_escape(self):
        outside, link = self._link_deck(os.link, "hl-save.vela", "hl-save-victim.txt")
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/hl-save.vela", body=payload)
        # A multiply-linked destination is refused outright, matching the read
        # path — never written through, never silently detached.
        self.assertNotEqual(status, 200)
        with open(outside, encoding="utf-8") as f:
            self.assertEqual(f.read(), "OUTSIDE", "save wrote through a hard link")
        with open(link, encoding="utf-8") as f:
            self.assertEqual(f.read(), "OUTSIDE", "refused save still changed the entry")

    def test_save_through_symlinked_deck_does_not_write_through(self):
        # Containment already blocks a symlink pointing outside, so aim it at a
        # deck INSIDE the folder: the check passes, and only the writer decides
        # whether the other deck gets clobbered.
        target = self._write_temp_deck("sl-target.vela", {"deckTitle": "TARGET", "lanes": []})
        link = os.path.join(self._tmpdir, "sl-save.vela")
        try:
            os.symlink(target, link)
        except (OSError, NotImplementedError):
            self.skipTest("platform cannot create symlinks")
        self.addCleanup(lambda: os.path.exists(link) and os.unlink(link))
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        fetch(self._port, "POST", "/save/sl-save.vela", body=payload)
        with open(target, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["deckTitle"], "TARGET",
                             "save wrote through a symlink into another deck")

    def test_serving_a_hardlinked_deck_does_not_leak_it(self):
        # The planted content is a canary MARKER, not a real credential — the
        # test writes it outside the folder on purpose to prove it never leaks.
        canary = json.dumps({"deckTitle": "SUPERSECRET", "lanes": []})
        self._link_deck(os.link, "hl-read.vela", "hl-read-victim.json", canary)
        status, _, body = fetch(self._port, "GET", "/deck/hl-read.vela")
        self.assertNotIn(b"SUPERSECRET", body)
        self.assertEqual(status, 409)  # refused at the reader, with a reason

    def test_listing_skips_hardlinked_decks(self):
        canary = json.dumps({"deckTitle": "SUPERSECRET", "lanes": []})
        self._link_deck(os.link, "hl-list.vela", "hl-list-victim.json", canary)
        status, _, body = fetch(self._port, "GET", "/api/decks")
        self.assertEqual(status, 200)
        self.assertNotIn(b"SUPERSECRET", body)

    # -- Control characters in deck names --

    def test_control_characters_in_deck_name_rejected(self):
        # CR/LF split an HTTP status line into forged headers; ESC/BEL rewrite
        # the operator's terminal. Neither belongs in a filename.
        v = VelaHTTPHandler._validate_deck_name
        for bad in ("a\r\nX-Injected: 1\r\nz.vela", "a\nb.vela", "a\x1b[2Jb.vela",
                    "a\x07b.vela", "a\x00b.vela", "a\x7fb.vela"):
            self.assertFalse(v(bad), f"accepted control chars: {bad!r}")
        self.assertTrue(v("normal-deck.vela"))
        self.assertTrue(v("Präsentation-Daten.vela"))  # printable unicode still fine
        # Emoji are category So, which the glyph-forging allowlist rejects
        # (fail-closed: a name is an identifier, not prose).
        self.assertFalse(v("Präsentation-📊.vela"))

    @unittest.skipIf(RUNNING_AS_ROOT, "root bypasses file permission checks")
    def test_save_error_does_not_reach_the_status_line(self):
        # Even if a name slipped through, the reason phrase must stay static:
        # http.server writes it into the status line without escaping.
        path = self._write_temp_deck("ro-msg.vela")
        os.chmod(path, 0o444)
        self.addCleanup(os.chmod, path, 0o644)
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        conn = http.client.HTTPConnection("127.0.0.1", self._port, timeout=5)
        conn.request("POST", "/save/ro-msg.vela", body=payload,
                     headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        self.assertEqual(resp.status, 500)
        self.assertNotIn("ro-msg", resp.reason)
        conn.close()

    def test_console_safe_escapes_terminal_control(self):
        out = serve_mod.console_safe("deck\x1b[2J\x07\nname.vela")
        for ch in ("\x1b", "\x07", "\n"):
            self.assertNotIn(ch, out)
        self.assertIn("deck", out)
        self.assertEqual(serve_mod.console_safe("Präsentation-📊"), "Präsentation-📊")
        self.assertLess(len(serve_mod.console_safe("x" * 500)), 200)

    def test_oversized_deck_is_refused_not_parsed(self):
        big = os.path.join(self._tmpdir, "huge.vela")
        with open(big, "w", encoding="utf-8") as f:
            json.dump({"deckTitle": "H", "lanes": [], "pad": "x" * (serve_mod.MAX_DECK_BYTES + 1024)}, f)
        self.addCleanup(os.unlink, big)
        status, _, body = fetch(self._port, "GET", "/deck/huge.vela")
        self.assertEqual(status, 409)
        status, _, listing = fetch(self._port, "GET", "/api/decks")
        self.assertNotIn(b"huge.vela", listing)

    def test_payload_cap_counts_bytes_not_characters(self):
        # The expanded-payload cap is a BYTE limit; multi-byte UTF-8 content
        # must not slip past a character-length check.
        deck = self._write_temp_deck("bytes.vela",
                                     {"deckTitle": "€" * 64, "lanes": []})
        self.addCleanup(os.unlink, deck)
        old = serve_mod.MAX_DECK_PAYLOAD
        serve_mod.MAX_DECK_PAYLOAD = 100  # < byte length, > char length of the JSON
        self.addCleanup(setattr, serve_mod, "MAX_DECK_PAYLOAD", old)
        status, _, _ = fetch(self._port, "GET", "/deck/bytes.vela")
        self.assertEqual(status, 409)

    def test_deck_too_large_after_expansion_is_409_not_500(self):
        # A deck refused during HTML building (size cap, bad structure) is a
        # property of the FILE, not a server fault.
        deck = self._write_temp_deck("expands.vela")
        self.addCleanup(os.unlink, deck)
        old = serve_mod.MAX_DECK_PAYLOAD
        serve_mod.MAX_DECK_PAYLOAD = 4
        self.addCleanup(setattr, serve_mod, "MAX_DECK_PAYLOAD", old)
        status, _, _ = fetch(self._port, "GET", "/deck/expands.vela")
        self.assertEqual(status, 409)

    def test_entry_writable_honours_more_than_the_owner_bit(self):
        # os.access-based check: owner-writable file is writable, an all-bits-off
        # file is not (S_IWUSR alone would also wrongly refuse group/other-writable
        # decks owned by someone else, which cannot be simulated single-uid).
        path = self._write_temp_deck("perm.vela")
        self.addCleanup(os.unlink, path)
        self.addCleanup(os.chmod, path, 0o644)
        os.chmod(path, 0o200)  # write-only for owner: still writable
        self.assertTrue(serve_mod.entry_writable(path))
        if getattr(os, "geteuid", lambda: 1)() != 0:  # root bypasses permission bits
            os.chmod(path, 0o444)
            self.assertFalse(serve_mod.entry_writable(path))

    def test_poll_for_an_unknown_deck_allocates_nothing(self):
        before = len(self._server._deck_trackers)
        for i in range(25):
            status, _, _ = fetch(self._port, "GET", f"/poll/ghost{i}.vela?v=0")
            self.assertEqual(status, 404)
        self.assertEqual(len(self._server._deck_trackers), before,
                         "polling unknown names allocated per-name state")

    def test_non_ascii_token_is_rejected_not_crashed(self):
        # hmac.compare_digest raises TypeError on a non-ASCII str, before routing.
        self.assertFalse(serve_mod.token_equal("é", "secret"))
        self.assertFalse(serve_mod.token_equal(None, "secret"))
        self.assertFalse(serve_mod.token_equal("secret", "sécret"))
        self.assertTrue(serve_mod.token_equal("s3cret", "s3cret"))

    def test_no_request_name_can_touch_a_file_outside_the_folder(self):
        """Evidence for the py/path-injection class CodeQL reports here.

        Deck names reach os.open/os.stat/os.replace, so a scanner sees request
        data in a path expression. What it cannot model: the name is rejected if
        it carries a separator or traversal, and the open is then made RELATIVE
        to a directory descriptor pinned at startup — so no name can name an
        entry outside that directory. This asserts that end to end instead of
        asserting it in a comment."""
        outside_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside_dir, ignore_errors=True)
        canary = os.path.join(outside_dir, "canary.vela")
        with open(canary, "w", encoding="utf-8") as f:
            json.dump({"deckTitle": "OUTSIDE-CANARY"}, f)
        before_outside = sorted(os.listdir(outside_dir))
        before_home = sorted(os.listdir(self._tmpdir))

        rel = os.path.relpath(canary, self._tmpdir)
        hostile = [
            "../canary.vela", "..%2Fcanary.vela", "....//canary.vela",
            "%2e%2e%2fcanary.vela", "..%5Ccanary.vela", "sub/../../canary.vela",
            rel, rel.replace("/", "%2F"), canary, canary.lstrip("/"),
            "/etc/passwd", "..%252Fcanary.vela", "a%00../canary.vela",
            "\uff0e\uff0e\uff0fcanary.vela", "\u2024\u2024\u2215canary.vela",
            "\u202e../canary.vela", ".vela.env", "../.vela.env",
            "%EF%BC%8E%EF%BC%8E%EF%BC%8Fcanary.vela",
            "%00../canary.vela", "..;/canary.vela", "./../canary.vela",
            "a%00../canary.vela", "%0d%0a../canary.vela",
        ]
        payload = json.dumps({"type": "deck_save",
                              "deck": {"deckTitle": "PATH-INJECTION-MARKER", "lanes": []}})
        # Percent-encode anything the client library refuses to put in a request
        # line (raw non-ASCII, control bytes) so the SERVER is what decodes it.
        hostile = [n if n.isascii() else quote(n, safe="%/") for n in hostile]
        for name in hostile:
            for verb, path, body in (("GET", f"/deck/{name}", None),
                                     ("GET", f"/poll/{name}?v=0", None),
                                     ("POST", f"/save/{name}", payload)):
                status, _, _ = fetch(self._port, verb, path, body=body)
                self.assertGreaterEqual(status, 400, f"{verb} {path} was accepted")

        # CONTROL: a legitimate name on the same endpoints still works, so the
        # 4xx results above are the guards, not a broken harness.
        self.assertEqual(fetch(self._port, "GET", "/deck/sample.vela")[0], 200)
        self.assertEqual(fetch(self._port, "POST", "/save/sample.vela", body=payload)[0], 200)

        # Nothing outside the served folder was created, removed or rewritten...
        self.assertEqual(sorted(os.listdir(outside_dir)), before_outside)
        with open(canary, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["deckTitle"], "OUTSIDE-CANARY")
        # ...and no stray entry appeared inside it either.
        self.assertEqual(sorted(os.listdir(self._tmpdir)), before_home)

    def test_deck_names_cannot_lie_in_the_listing(self):
        # The File column is rendered verbatim and is the identity the listing is
        # trusted against, so a name must not be able to imitate another one.
        v = VelaHTTPHandler._validate_deck_name
        for label, ch in (("unassigned (Cn)", "\u2065"), ("private use (Co)", "\ue0b0"),
                          ("blank glyph", "\u2800"), ("emoji (So)", "\U0001f4ca"),
                          ("solidus overlay", "\u0338"), ("box diagonal", "\u2571"),
                          ("zero-width space (Cf)", "\u200b")):
            self.assertFalse(v(f"report{ch}.vela"), f"{label} accepted in a deck name")
        # A slash-drawing character that NFKC folds into an innocent one must be
        # judged on the form the user actually sees, not the folded form.
        self.assertFalse(v("report\u2f03.vela"), "folding let a slash lookalike through")
        # ...and stacked marks (Zalgo) cannot be used to hide the real extension.
        self.assertFalse(v("report\u0300\u0301\u0302.vela"))

    def test_ordinary_names_in_any_script_still_work(self):
        # The rules above must not cost users their own language: these all carry
        # combining marks or non-ASCII punctuation and are perfectly ordinary.
        v = VelaHTTPHandler._validate_deck_name
        for label, name in (("ascii", "report.vela"), ("caret", "report^2.vela"),
                            ("latin nfc", "caf\u00e9.vela"),
                            ("latin nfd (macOS form)", "cafe\u0301.vela"),
                            ("hindi", "\u0930\u093f\u092a\u094b\u0930\u094d\u091f.vela"),
                            ("thai", "\u0e23\u0e32\u0e22\u0e07\u0e32\u0e19.vela"),
                            ("hebrew+niqqud", "\u05d3\u05bc\u05d5\u05d7.vela"),
                            ("arabic+harakat", "\u062a\u064e\u0642\u0631\u064a\u0631.vela"),
                            ("cjk", "\u4f1a\u8b70.vela"), ("cyrillic", "\u043e\u0442\u0447\u0451\u0442.vela")):
            self.assertTrue(v(name), f"{label} deck name was refused")

    def test_save_refuses_a_symlinked_deck_entry(self):
        # An atomic replace would silently destroy a link the user made, and the
        # read path already refuses one.
        target = self._write_temp_deck("sym-target.vela", {"deckTitle": "TARGET", "lanes": []})
        link = os.path.join(self._tmpdir, "sym-alias.vela")
        try:
            os.symlink(target, link)
        except (OSError, NotImplementedError):
            self.skipTest("platform cannot create symlinks")
        self.addCleanup(lambda: os.path.lexists(link) and os.unlink(link))
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/sym-alias.vela", body=payload)
        self.assertEqual(status, 409)
        self.assertTrue(os.path.islink(link), "the save destroyed a symlinked entry")
        with open(target, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["deckTitle"], "TARGET")

    def test_refused_save_answers_like_the_refused_read(self):
        # Same file property, same class of answer on both verbs.
        outside, _ = self._link_deck(os.link, "hl-status.vela", "hl-status-victim.txt")
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        self.assertEqual(fetch(self._port, "GET", "/deck/hl-status.vela")[0], 409)
        self.assertEqual(fetch(self._port, "POST", "/save/hl-status.vela", body=payload)[0], 409)
        with open(outside, encoding="utf-8") as f:
            self.assertEqual(f.read(), "OUTSIDE")

    # -- Deck file mode / atomicity --

    def test_save_preserves_a_private_decks_mode(self):
        # An atomic replace needs no write permission on the FILE, so without an
        # explicit carry-over a deck the user made private would come back
        # world-readable on the next browser save.
        path = self._write_temp_deck("private.vela")
        os.chmod(path, 0o600)
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/private.vela", body=payload)
        self.assertEqual(status, 200)
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)

    @unittest.skipIf(RUNNING_AS_ROOT, "root bypasses file permission checks")
    def test_save_refuses_a_read_only_deck(self):
        path = self._write_temp_deck("readonly.vela", {"deckTitle": "KEEP", "lanes": []})
        os.chmod(path, 0o444)
        self.addCleanup(os.chmod, path, 0o644)
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        status, _, _ = fetch(self._port, "POST", "/save/readonly.vela", body=payload)
        self.assertEqual(status, 500)
        with open(path, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["deckTitle"], "KEEP")

    @unittest.skipIf(RUNNING_AS_ROOT, "root bypasses file permission checks")
    def test_failed_save_does_not_publish_the_edit(self):
        # A save that never reached disk must not be pushed to other tabs.
        path = self._write_temp_deck("lost.vela", {"deckTitle": "ONDISK", "lanes": []})
        os.chmod(path, 0o444)
        self.addCleanup(os.chmod, path, 0o644)
        payload = json.dumps({"type": "deck_save",
                              "deck": {"deckTitle": "NEVER-SAVED", "lanes": []}})
        fetch(self._port, "POST", "/save/lost.vela", body=payload)
        self.assertNotEqual(
            (self._server.get_deck_data("lost.vela") or {}).get("deckTitle"),
            "NEVER-SAVED", "an unsaved edit was published to other clients")

    def test_save_does_not_carry_special_mode_bits(self):
        # S_IMODE keeps setuid/setgid/sticky; a file the server creates and owns
        # must never inherit them from the entry it replaces.
        path = self._write_temp_deck("sgid.vela")
        os.chmod(path, 0o2644)
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        fetch(self._port, "POST", "/save/sgid.vela", body=payload)
        self.assertEqual(os.stat(path).st_mode & 0o7000, 0)

    def test_save_leaves_no_temp_files_behind(self):
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        fetch(self._port, "POST", "/save/sample.vela", body=payload)
        leftovers = [n for n in os.listdir(self._tmpdir) if n.startswith(".vela-save-")]
        self.assertEqual(leftovers, [])

    def test_concurrent_saves_never_widen_deck_permissions(self):
        # write_deck_json must not read-modify-write the process umask: another
        # thread inside that window creates world-writable files.
        names = [f"conc{i}.vela" for i in range(12)]
        for n in names:
            self._write_temp_deck(n)
        payload = json.dumps({"type": "deck_save", "deck": SAMPLE_DECK})
        threads = [threading.Thread(target=fetch,
                                    args=(self._port, "POST", f"/save/{n}"),
                                    kwargs={"body": payload}) for n in names]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=20)
        modes = {os.stat(os.path.join(self._tmpdir, n)).st_mode & 0o777 for n in names}
        # Compare against what the server decided once at import — asserting a
        # hardcoded 0o644 would fail on a machine with a different umask.
        self.assertEqual(modes, {serve_mod.DECK_FILE_MODE}, f"unexpected modes: {modes}")

    def test_vendor_js_is_not_loaded_from_the_served_folder(self):
        # /vendor/babel.min.js is executed in the authenticated page origin, so
        # it must never come from project-directory content.
        nm = os.path.join(self._tmpdir, "node_modules", "@babel", "standalone")
        os.makedirs(nm, exist_ok=True)
        self.addCleanup(shutil.rmtree, os.path.join(self._tmpdir, "node_modules"),
                        ignore_errors=True)
        with open(os.path.join(nm, "babel.min.js"), "w", encoding="utf-8") as f:
            f.write("/*PROJECT-SUPPLIED-JS*/")
        srv = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=0)
        saved = dict(VelaHTTPHandler.static_files)
        try:
            srv._load_vendor_files()
            body = VelaHTTPHandler.static_files.get("/vendor/babel.min.js", (b"", ""))[0]
        finally:
            VelaHTTPHandler.static_files = saved
        self.assertNotIn(b"PROJECT-SUPPLIED-JS", body)

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

    def test_symlink_outside_folder_not_listed(self):
        """SECURITY (F2): the /api/decks listing must apply the SAME realpath
        containment as /deck/. A deck-named symlink resolving OUTSIDE the served
        folder must not appear in the listing at all — otherwise it leaks the
        target's byte size (a universal existence/size oracle for any file the
        server can read) and, for a JSON target, its deckTitle."""
        outside_dir = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(outside_dir, ignore_errors=True))
        outside_deck = os.path.join(outside_dir, "confidential.vela")
        sentinel = "LEAKED_SECRET_TITLE_F2"
        with open(outside_deck, "w", encoding="utf-8") as f:
            json.dump({"deckTitle": sentinel, "lanes": []}, f)
        outside_plain = os.path.join(outside_dir, "private.bin")
        with open(outside_plain, "w", encoding="utf-8") as f:
            f.write("x" * 3)  # any readable non-JSON file — size-oracle target

        made = []
        for target, linkname in ((outside_deck, "innocuous.vela"), (outside_plain, "readme.vela")):
            lp = os.path.join(self._tmpdir, linkname)
            try:
                os.symlink(target, lp)
            except OSError:
                self.skipTest("Cannot create symlinks on this filesystem")
            made.append(lp)
        self.addCleanup(lambda: [os.unlink(p) for p in made if os.path.lexists(p)])

        status, _, body = fetch(self._port, "GET", "/api/decks")
        self.assertEqual(status, 200)
        self.assertNotIn(sentinel.encode(), body, "escaping symlink deckTitle leaked in listing")
        self.assertNotIn(b"innocuous.vela", body, "escaping symlink must not be listed")
        self.assertNotIn(b"readme.vela", body, "escaping non-JSON symlink must not be listed")

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
        # _build_html_for_deck takes the PARSED deck: the caller reads it through
        # the symlink-proof descriptor so nothing downstream re-opens by path.
        server = VelaLocalServer(self._tmpdir, port=0, no_open=True, channel_port=0)
        html = server._build_html_for_deck(VELA_EXPORT_DECK, "export.vela").decode("utf-8")
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

        orig_run = agent_backend.subprocess.run
        orig_bin = agent_backend.resolve_agent_bin
        agent_backend.subprocess.run = fake_run
        agent_backend.resolve_agent_bin = lambda: "/usr/bin/claude-fake"  # CI has no claude
        try:
            agent_backend.run_completion("SECRET-SYSTEM-PROMPT", [{"role": "user", "content": "hi"}])
        finally:
            agent_backend.subprocess.run = orig_run
            agent_backend.resolve_agent_bin = orig_bin
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
        # /action auth is now MANDATORY: make_channel_server always has a token
        # (auto-generated when none is passed). Capture it so the happy-path posts
        # authenticate; negative tests pass token=None to prove rejection.
        cls.token = cls.server._token
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        agent_backend.run_completion = cls._orig
        agent_backend.stop_channel_server(cls.server)

    _NO_TOKEN = object()

    def _post(self, path, body, origin=None, token=_NO_TOKEN):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = origin
        tok = self.token if token is self._NO_TOKEN else token
        if tok:
            headers["x-vela-token"] = tok
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

    def test_null_origin_without_token_rejected(self):
        # SECURITY (F3, CWE-346): Origin: null is forgeable by ANY site (a
        # sandboxed iframe / data:/file: page), so it must not grant access. A
        # null-origin caller with no token is rejected — the mandatory unforgeable
        # token, not the Origin, is the boundary. This is the drive-by hole a
        # random web page previously used against the tokenless channel.
        status, _, _ = self._post("/action", {
            "action": "complete", "messages": [{"role": "user", "content": "x"}],
        }, origin="null", token=None)
        self.assertEqual(status, 401)

    def test_null_origin_with_token_allowed(self):
        # The one legitimate null-origin caller (the file:// render harness)
        # authenticates with the token and still works.
        status, data, _ = self._post("/action", {
            "action": "complete", "messages": [{"role": "user", "content": "ping"}],
        }, origin="null", token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["reply"], "STUB:ping")

    def test_action_unknown_action(self):
        status, data, _ = self._post("/action", {"action": "delete_everything"})
        self.assertEqual(status, 400)
        self.assertFalse(json.loads(data)["ok"])

    def test_unknown_path_404(self):
        status, _, _ = self._post("/nope", {})
        self.assertEqual(status, 404)

    def test_cors_allows_loopback_origin(self):
        # An allowed origin (file:// harness null, or a localhost page) gets a
        # CORS grant so its fetch can read the response. The value is a constant
        # "*" (access control is done by the guard + token, not the CORS value).
        _, _, r = self._post("/action", {
            "action": "complete", "messages": [{"role": "user", "content": "x"}],
        }, origin="null")
        self.assertEqual(r.getheader("Access-Control-Allow-Origin"), "*")

    def test_options_preflight(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("OPTIONS", "/action", headers={"Origin": "http://localhost:3030"})
        r = conn.getresponse()
        self.assertEqual(r.status, 204)
        self.assertEqual(r.getheader("Access-Control-Allow-Origin"), "*")
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


class TestRuntimeFileLinks(unittest.TestCase):
    """The runtime file (.vela.env) is created in the process CWD — a project
    directory Vela does not own. A pre-existing entry there is untrusted: these
    assert Vela never dereferences it, in either direction.

    Without the no-follow/exclusive-create handling, the write path truncates
    and overwrites whatever the entry points at (a token-bearing write outside
    the project) and the read path parses an arbitrary file's bytes."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.proj = os.path.join(self.tmp, "proj")
        self.outside = os.path.join(self.tmp, "outside.txt")
        os.mkdir(self.proj)
        with open(self.outside, "w", encoding="utf-8") as f:
            f.write("MARKER")
        with open(os.path.join(self.proj, "sample.vela"), "w", encoding="utf-8") as f:
            json.dump(SAMPLE_DECK, f)
        self.server = VelaLocalServer(self.proj, port=0, no_open=True, channel_port=0)
        self._cwd = os.getcwd()
        os.chdir(self.proj)
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.addCleanup(os.chdir, self._cwd)

    @property
    def _rt(self):
        return os.path.join(self.proj, ".vela.env")

    def _assert_outside_untouched(self):
        with open(self.outside, encoding="utf-8") as f:
            self.assertEqual(f.read(), "MARKER",
                             "runtime write escaped the project directory")

    def _supports(self, maker):
        try:
            maker()
        except (OSError, NotImplementedError, AttributeError):
            self.skipTest("filesystem/platform cannot create this link type")

    # -- write path --

    def test_symlinked_runtime_file_is_not_followed(self):
        self._supports(lambda: os.symlink(self.outside, self._rt))
        self.server._write_runtime_info()
        self._assert_outside_untouched()
        self.assertFalse(os.path.islink(self._rt))
        with open(self._rt, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["port"], 0)  # our own fresh file

    def test_dangling_symlink_runtime_file_is_not_followed(self):
        ghost = os.path.join(self.tmp, "ghost.txt")
        self._supports(lambda: os.symlink(ghost, self._rt))
        self.server._write_runtime_info()
        self.assertFalse(os.path.exists(ghost), "write created the link target")
        self.assertFalse(os.path.islink(self._rt))

    def test_hardlinked_runtime_file_is_not_followed(self):
        self._supports(lambda: os.link(self.outside, self._rt))
        self.server._write_runtime_info()
        self._assert_outside_untouched()
        self.assertEqual(os.stat(self._rt).st_nlink, 1, "wrote through a hard link")

    def test_normal_write_still_replaces_a_plain_runtime_file(self):
        with open(self._rt, "w", encoding="utf-8") as f:
            f.write("stale contents")
        self.server._write_runtime_info()
        with open(self._rt, encoding="utf-8") as f:
            info = json.load(f)
        self.assertEqual(info["pid"], os.getpid())
        self.assertIn("token", info)

    @unittest.skipIf(sys.platform == "win32", "POSIX permission bits")
    def test_runtime_file_is_created_owner_only(self):
        self.server._write_runtime_info()
        self.assertEqual(os.stat(self._rt).st_mode & 0o777, 0o600)

    def test_directory_in_the_way_is_not_deleted(self):
        os.mkdir(self._rt)
        with open(os.path.join(self._rt, "keep.txt"), "w", encoding="utf-8") as f:
            f.write("user data")
        self.server._write_runtime_info()  # must fail closed, not clobber
        self.assertTrue(os.path.isdir(self._rt))
        self.assertTrue(os.path.exists(os.path.join(self._rt, "keep.txt")))

    # -- read path --

    def test_symlinked_runtime_file_is_not_read(self):
        with open(self.outside, "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "port": 1234}, f)
        self._supports(lambda: os.symlink(self.outside, self._rt))
        self.assertIsNone(self.server._read_runtime_info())

    def test_non_regular_runtime_file_is_not_read(self):
        self._supports(lambda: os.mkfifo(self._rt))
        self.assertIsNone(self.server._read_runtime_info())

    def test_hostile_pid_values_are_rejected(self):
        # A non-int pid crashes os.kill/tasklist; a non-positive one makes
        # os.kill() signal a process GROUP (-1 = every process this user owns).
        for bad in (-1, 0, "1234", True, [1], None, 12.5):
            with open(self._rt, "w", encoding="utf-8") as f:
                json.dump({"pid": bad, "port": 0}, f)
            self.assertIsNone(self.server._read_runtime_info()["pid"],
                              f"pid {bad!r} was accepted")
            self.server._cleanup_stale_server()  # must not raise

    def test_oversized_runtime_file_is_not_parsed(self):
        # An unbounded json.load() on a file this process does not own lets the
        # project directory choose how much memory Vela allocates at startup.
        pad = "A" * (VelaLocalServer.RUNTIME_MAX_BYTES + 1024)
        with open(self._rt, "w", encoding="utf-8") as f:
            json.dump({"pid": 1, "port": 0, "pad": pad}, f)
        self.assertIsNone(self.server._read_runtime_info())

    def test_planted_pid_cannot_kill_an_unrelated_process(self):
        # The runtime file names a kill TARGET, and _retry_after_stale_kill runs
        # on the ordinary busy-port path. The PID must be verified (right process
        # kind AND actually holding the port), never trusted from the file.
        # NB: claim a free ephemeral port rather than hardcoding one — a fixed
        # port could be held by an unrelated process on the machine running this
        # suite, and the port-holder fallback would then kill it for real.
        # Assert the DECISION, with kills stubbed out: driving the real fallback
        # would run `lsof -ti :PORT`, which also matches client sockets, and
        # SIGKILL whichever unrelated process happens to hold that port on the
        # machine running this suite.
        import subprocess
        from unittest import mock
        victim = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        self.addCleanup(victim.wait)
        self.addCleanup(victim.kill)
        self.server.port = 3030
        with open(self._rt, "w", encoding="utf-8") as f:
            json.dump({"pid": victim.pid, "port": 3030}, f)
        self.assertFalse(self.server._is_our_stale_server(victim.pid, 3030),
                         "an unrelated live process was accepted as our stale server")
        with mock.patch.object(serve_mod.os, "kill") as killed, \
                mock.patch.object(serve_mod.subprocess, "run") as ran:
            ran.return_value = subprocess.CompletedProcess([], 0, stdout="", stderr="")
            try:
                self.server._retry_after_stale_kill(VelaHTTPHandler)
            except Exception:
                pass  # the kill decision is the subject, not the rebind
        self.assertNotIn(victim.pid, [c.args[0] for c in killed.call_args_list],
                         "a process named only by the runtime file was signalled")
        self.assertIsNone(victim.poll())

    @unittest.skipUnless(
        all(fn in os.supports_dir_fd for fn in (os.open, os.stat, os.unlink, os.rmdir)),
        "platform has no dir_fd-relative calls")
    def test_runtime_writes_stay_in_the_pinned_directory(self):
        # No-follow/exclusive-create only constrain the final path component, so
        # the directory itself must be pinned — otherwise a swap above the file
        # relocates the token write. Changing CWD stands in for that swap.
        self.server._write_runtime_info()
        elsewhere = os.path.join(self.tmp, "elsewhere")
        os.mkdir(elsewhere)
        os.chdir(elsewhere)
        self.server._write_runtime_info()
        self.assertFalse(os.path.exists(os.path.join(elsewhere, ".vela.env")),
                         "runtime write followed the moved directory")
        self.assertTrue(os.path.exists(self._rt))

    @unittest.skipIf(os.name == "nt", "POSIX-only fallback gating")
    def test_rmdir_fallback_does_not_run_on_posix(self):
        # POSIX unlink removes symlinks itself, so a failed unlink is never "it
        # was a link" — running rmdir anyway deletes a real directory that raced
        # into place after the stat.
        from unittest import mock
        os.symlink(self.tmp, self._rt)
        with mock.patch.object(serve_mod.os, "unlink",
                               side_effect=PermissionError("simulated race")), \
                mock.patch.object(serve_mod.os, "rmdir") as rmdir:
            self.server._discard_runtime_entry(".vela.env")
        self.assertEqual(rmdir.call_args_list, [], "rmdir fallback ran on POSIX")

    def test_missing_cwd_never_raises(self):
        # Startup and atexit cleanup both address the runtime file; if the
        # directory is gone, os.getcwd() itself fails and an escaping error
        # would abort the server rather than degrade to "no runtime file".
        gone = os.path.join(self.proj, "gone")
        os.mkdir(gone)
        os.chdir(gone)
        os.rmdir(gone)
        self.server._write_runtime_info()
        self.assertIsNone(self.server._read_runtime_info())
        self.server._cleanup_stale_server()
        self.server._remove_runtime_files()
        os.chdir(self.proj)

    def test_corrupt_runtime_file_is_ignored(self):
        for junk in ("not json", "[1,2,3]", '"str"', ""):
            with open(self._rt, "w", encoding="utf-8") as f:
                f.write(junk)
            self.assertIsNone(self.server._read_runtime_info())

class TestDeckNameCodeDataSeparation(FolderServerTestBase):
    """Deck filenames are attacker-influenced (decks are shared artifacts), so
    a name must never reach a code context.

    The server-side guard (names validated before listing) is covered by
    TestSecurity. These cover the second layer: the browser page must not mix
    code and data at all, so the guard being the *only* thing standing between
    a filename and execution is not a state this page can return to.

    They pin the INVARIANT rather than any one payload — a test that only
    pinned one quoting trick would pass against the next one.
    """

    _extra_files = {
        "apostrophe'.vela": SAMPLE_DECK,
        'double".vela': SAMPLE_DECK,
        "angle<>.vela": SAMPLE_DECK,
        "backtick`.vela": SAMPLE_DECK,
        "clean-name.vela": SAMPLE_DECK,
        # A name whose percent-encoded form contains a query delimiter: it is
        # listed, so it must also serve. Decoding before stripping the query
        # would truncate it and break the listing/serving agreement.
        "question?mark.vela": SAMPLE_DECK,
    }

    def test_listing_only_exposes_servable_names(self):
        """Every listed name must pass the guard the serving routes enforce."""
        _, _, body = fetch(self._port, "GET", "/api/decks")
        names = [d["name"] for d in json.loads(body)["decks"]]
        self.assertIn("clean-name.vela", names)  # the listing still works
        for name in names:
            self.assertTrue(
                VelaHTTPHandler._validate_deck_name(name),
                f"listing exposed a name the serving routes would reject: {name!r}",
            )

    @unittest.skipUnless(TEMPLATES_EXIST, "template files required")
    def test_listed_names_are_actually_servable(self):
        """Every listed row serves when clicked — listing and serving agree.

        Asserts 200 rather than 'not 400': a rejection is a rejection whatever
        its status code, so a weaker assertion would let listing/serving drift
        back apart unnoticed.
        """
        _, _, body = fetch(self._port, "GET", "/api/decks")
        names = [d["name"] for d in json.loads(body)["decks"]]
        self.assertIn("question?mark.vela", names)  # the drift case is covered
        for name in names:
            status, _, _ = fetch(self._port, "GET", "/deck/" + quote(name))
            self.assertEqual(status, 200, f"listed but not servable: {name!r}")

    def test_browser_page_has_no_inline_event_handlers(self):
        """No inline on*= attribute — data can never land in a code context."""
        _, _, body = fetch(self._port, "GET", "/")
        html = body.decode("utf-8")
        self.assertNotRegex(html, r"(?i)\son[a-z]+\s*=",
                            "browser page must bind behaviour via addEventListener")

    def test_browser_page_has_no_inline_script(self):
        """Client code is external, so the page can run without 'unsafe-inline'."""
        _, _, body = fetch(self._port, "GET", "/")
        html = body.decode("utf-8")
        self.assertNotRegex(html, r"(?is)<script(?![^>]*\ssrc=)[^>]*>\s*\S",
                            "browser page must not contain an inline <script> body")
        self.assertIn('src="/browser.js"', html)

    def test_browser_csp_forbids_inline_script(self):
        """The strict policy is what makes the above structural, not stylistic."""
        for path in ("/", "/browser.js"):
            _, hdrs, _ = fetch(self._port, "GET", path)
            csp = hdrs["content-security-policy"]
            self.assertIn("script-src 'self'", csp)
            self.assertNotIn("unsafe-inline", csp.split("style-src")[0])
            self.assertNotIn("unsafe-eval", csp)

    @unittest.skipUnless(TEMPLATES_EXIST, "template files required")
    def test_app_page_keeps_its_own_policy(self):
        """The stricter browser policy must not leak onto the app page."""
        _, hdrs, _ = fetch(self._port, "GET", "/deck/sample.vela")
        self.assertIn("unsafe-eval", hdrs["content-security-policy"])

    def test_client_never_builds_markup_from_deck_data(self):
        """Rendering goes through nodes, not string-concatenated HTML."""
        with open(os.path.join(os.path.dirname(SCRIPTS_DIR), "browser.js"),
                  encoding="utf-8") as f:
            js = f.read()
        # Strip comments first — the file's own docs name these sinks to
        # explain why they are avoided, which would otherwise self-trip.
        code = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
        code = re.sub(r"^\s*//.*$", "", code, flags=re.M)
        for sink in ("innerHTML", "outerHTML", "document.write", "insertAdjacentHTML", "eval("):
            self.assertNotIn(sink, code, f"browser.js must not use {sink}")
        self.assertIn("addEventListener", code)
        self.assertIn("textContent", code)


class TestDeckFileAccessContainment(FolderServerTestBase):
    """Deck reads and writes must refuse a symlinked leaf ATOMICALLY.

    Realpath containment alone is check-then-use: a local process can swap a
    deck-named symlink between the check and the open and redirect the operation
    outside the served folder (CWE-22/59/367). These pin the atomic guarantee, so
    a future by-path open cannot quietly reopen that window.
    """

    def _outside(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        return d

    def _link(self, link_name, target):
        path = os.path.join(self._tmpdir, link_name)
        if os.path.lexists(path):
            os.unlink(path)
        try:
            os.symlink(target, path)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable on this platform")
        self.addCleanup(lambda: os.path.lexists(path) and os.unlink(path))
        return path

    def test_open_deck_fd_refuses_symlink_even_when_target_is_inside(self):
        """The leaf itself must be refused — not merely targets that escape.

        This is the property that closes the race: if an in-folder symlink were
        accepted, it could be re-pointed outside after the containment check.
        """
        self._link("alias.vela", os.path.join(self._tmpdir, "sample.vela"))
        with self.assertRaises(OSError):
            VelaHTTPHandler._open_deck_fd(self._tmpdir, "alias.vela")

    def test_open_deck_fd_refuses_symlink_for_write(self):
        """Two independent layers refuse this: realpath containment rejects an
        outward target (ValueError) and O_NOFOLLOW rejects the symlink itself
        (OSError). Accept either — what must never happen is the write landing."""
        outside = self._outside()
        self._link("wlink.vela", os.path.join(outside, "target.json"))
        with self.assertRaises((ValueError, OSError)):
            VelaHTTPHandler._open_deck_fd(self._tmpdir, "wlink.vela", write=True)
        self.assertFalse(os.path.exists(os.path.join(outside, "target.json")),
                         "write followed a symlink out of the served folder")

    def test_save_through_symlink_is_refused_over_http(self):
        outside = self._outside()
        target = os.path.join(outside, "PWNED.json")
        self._link("race.vela", target)
        status, _, _ = fetch(self._port, "POST", "/save/race.vela",
                             body=json.dumps({"type": "deck_save", "deck": SAMPLE_DECK}),
                             headers={"Content-Type": "application/json"})
        self.assertNotEqual(status, 200)
        self.assertFalse(os.path.exists(target), "arbitrary write escaped the folder")

    def test_serve_through_symlink_is_refused_over_http(self):
        self._link("ralias.vela", os.path.join(self._tmpdir, "sample.vela"))
        status, _, _ = fetch(self._port, "GET", "/deck/ralias.vela")
        self.assertNotEqual(status, 200, "a symlinked deck was served")

    def test_listing_and_serving_agree_about_symlinks(self):
        """Neither lists nor serves them — the two views cannot diverge."""
        self._link("balias.vela", os.path.join(self._tmpdir, "sample.vela"))
        _, _, body = fetch(self._port, "GET", "/api/decks")
        listed = [d["name"] for d in json.loads(body)["decks"]]
        self.assertNotIn("balias.vela", listed)
        status, _, _ = fetch(self._port, "GET", "/deck/balias.vela")
        self.assertNotEqual(status, 200)

    def _hardlink(self, link_name, target):
        path = os.path.join(self._tmpdir, link_name)
        try:
            os.link(target, path)
        except (OSError, NotImplementedError, AttributeError):
            self.skipTest("hardlinks unavailable on this filesystem")
        self.addCleanup(lambda: os.path.exists(path) and os.unlink(path))
        return path

    def test_hardlinked_deck_is_refused(self):
        """O_NOFOLLOW rejects a SYMlink only. A hardlink is an ordinary entry
        inside the folder sharing an inode with a file outside it — containment,
        O_NOFOLLOW and S_ISREG all pass, so the link count must be checked."""
        outside = self._outside()
        target = os.path.join(outside, "secret.vela")
        with open(target, "w", encoding="utf-8") as f:
            json.dump({"deckTitle": "OUTSIDE", "lanes": []}, f)
        self._hardlink("hl.vela", target)
        with self.assertRaises(OSError):
            VelaHTTPHandler._open_deck_fd(self._tmpdir, "hl.vela")

    def test_hardlinked_write_does_not_truncate_the_target(self):
        """The ordering matters: O_TRUNC destroys the file AT open(), before any
        check can run. The guard is only meaningful if truncation happens after
        the inode is accepted — so the victim's content must survive intact."""
        outside = self._outside()
        target = os.path.join(outside, "victim.conf")
        with open(target, "w", encoding="utf-8") as f:
            f.write("IMPORTANT-ORIGINAL-CONTENT")
        self._hardlink("hlw.vela", target)

        status, _, _ = fetch(self._port, "POST", "/save/hlw.vela",
                             body=json.dumps({"type": "deck_save", "deck": SAMPLE_DECK}),
                             headers={"Content-Type": "application/json"})
        self.assertNotEqual(status, 200)
        with open(target, encoding="utf-8") as f:
            self.assertEqual(f.read(), "IMPORTANT-ORIGINAL-CONTENT",
                             "hardlinked target was truncated or overwritten")

    def test_hardlinked_deck_is_neither_listed_nor_served(self):
        outside = self._outside()
        target = os.path.join(outside, "hidden.vela")
        with open(target, "w", encoding="utf-8") as f:
            json.dump({"deckTitle": "OUTSIDE", "lanes": []}, f)
        self._hardlink("hlr.vela", target)

        _, _, body = fetch(self._port, "GET", "/api/decks")
        listed = [d["name"] for d in json.loads(body)["decks"]]
        self.assertNotIn("hlr.vela", listed)
        self.assertIn("sample.vela", listed, "healthy decks must still be listed")
        status, _, served = fetch(self._port, "GET", "/deck/hlr.vela")
        self.assertNotEqual(status, 200)
        self.assertNotIn(b"OUTSIDE", served)

    def test_served_root_is_resolved_once_at_startup(self):
        """O_NOFOLLOW guards the leaf, not a parent component.

        If the served root stayed a symlink it would be re-resolved on every
        request, and re-pointing it between the containment check and the open
        redirects reads and writes elsewhere — demonstrated before this was
        pinned. Asserting the resolved root is the deterministic form of that
        race test.
        """
        real_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, real_dir, ignore_errors=True)
        link_dir = os.path.join(tempfile.mkdtemp(), "served-link")
        self.addCleanup(shutil.rmtree, os.path.dirname(link_dir), ignore_errors=True)
        try:
            os.symlink(real_dir, link_dir)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable on this platform")

        srv = VelaLocalServer(link_dir, port=0, no_open=True, channel_port=0)
        self.assertEqual(srv.folder_path, os.path.realpath(real_dir),
                         "served root must be resolved, not left as a symlink")

    def test_write_still_creates_a_new_deck(self):
        """The hardening must not break save-as-new (O_CREAT path)."""
        status, _, _ = fetch(self._port, "POST", "/save/brand-new.vela",
                             body=json.dumps({"type": "deck_save", "deck": SAMPLE_DECK}),
                             headers={"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        self.assertTrue(os.path.isfile(os.path.join(self._tmpdir, "brand-new.vela")))


class TestDeckLabelSpoofing(FolderServerTestBase):
    """`deckTitle` comes from inside the deck JSON and passes no name validation,
    yet it is the listing's most prominent label — so it is a spoofing surface."""

    _extra_files = {
        "rtlo-title.vela": {"deckTitle": "Q3-report‮gpj.vela", "lanes": []},
        "pad-title.vela": {"deckTitle": "harmless.pdf" + " " * 40 + "​.vela", "lanes": []},
        "num-title.vela": {"deckTitle": 5, "lanes": []},
        "obj-title.vela": {"deckTitle": {"a": 1}, "lanes": []},
        "long-title.vela": {"deckTitle": "A" * 5000, "lanes": []},
    }

    def _titles(self):
        _, _, body = fetch(self._port, "GET", "/api/decks")
        return {d["name"]: d["title"] for d in json.loads(body)["decks"]}

    def test_titles_carry_no_format_or_bidi_controls(self):
        for name, title in self._titles().items():
            self.assertIsInstance(title, str, f"{name}: non-string title reached the client")
            for ch in title:
                self.assertNotEqual(unicodedata.category(ch), "Cf",
                                    f"{name}: format/bidi control survived in {title!r}")

    def test_whitespace_runs_collapsed(self):
        self.assertNotIn("   ", self._titles()["pad-title.vela"])

    def test_non_string_titles_fall_back_to_the_filename(self):
        t = self._titles()
        self.assertEqual(t["num-title.vela"], "num-title.vela")
        self.assertEqual(t["obj-title.vela"], "obj-title.vela")

    def test_title_length_is_bounded(self):
        self.assertLessEqual(len(self._titles()["long-title.vela"]), 200)


class TestLabelSpoofingCategories(unittest.TestCase):
    """The first version of the label filter denylisted single categories and was
    bypassed through five separate channels. These pin the category-allowlist
    behaviour that replaced it, and pin that ordinary text still survives — a
    filter that mangles legitimate titles would just be turned off."""

    def _label(self, value):
        return VelaHTTPHandler._display_label(value, "FALLBACK")

    def test_blank_but_not_isspace_glyphs_cannot_hide_a_suffix(self):
        """str.split() only splits on isspace(); these render blank but are not."""
        for blank in ("⠀", "ㅤ", "ᅟ", "᠎", " "):
            out = self._label("safe.pdf" + blank * 30 + "REAL.exe")
            self.assertNotIn(blank, out, f"{blank!r} survived")
            self.assertNotIn("  ", out, f"{blank!r} left a run that hides the suffix")
            self.assertIn("REAL.exe", out)

    def test_combining_marks_are_stripped(self):
        self.assertEqual(self._label("in҉⃝voice" + "̶" * 10), "invoice")
        self.assertEqual(self._label("safe̸deck"), "safedeck")  # overlay "slash"

    def test_control_characters_are_stripped(self):
        out = self._label("bad\x1b[31m\x00\x07\x7f-deck")
        for ch in "\x1b\x00\x07\x7f":
            self.assertNotIn(ch, out)

    def test_format_and_bidi_controls_are_stripped(self):
        self.assertNotIn("‮", self._label("Q3-report‮gpj.vela"))

    def test_ordinary_text_survives_intact(self):
        for text in ("Café Résumé Ünïcödé", "日本語のデッキ", "Q3 Report (final) — v2"):
            self.assertEqual(self._label(text), text)


class TestPerNameStateIsNotAllocatedFreely(FolderServerTestBase):
    """Per-name server state must only exist for decks that really exist.
    Allocating it for any syntactically valid name lets a caller pin unbounded
    state, and recording a save before authorizing it leaves the cache holding
    content that was never written to disk."""

    def test_poll_for_unknown_deck_does_not_allocate_a_tracker(self):
        name = "never-seen-before.vela"
        status, _, _ = fetch(self._port, "GET", f"/poll/{name}?v=0")
        self.assertEqual(status, 404)
        self.assertIsNone(self._server.peek_tracker(name),
                          "polling an unknown name allocated permanent state")

    def test_unusable_name_is_rejected_before_any_state_is_touched(self):
        long_name = "Z" * 300 + ".vela"
        self.assertFalse(VelaHTTPHandler._validate_deck_name(long_name))
        status, _, _ = fetch(self._port, "POST", f"/save/{long_name}",
                             body=json.dumps({"type": "deck_save", "deck": SAMPLE_DECK}),
                             headers={"Content-Type": "application/json"})
        self.assertEqual(status, 400)
        self.assertIsNone(self._server.get_deck_data(long_name),
                          "a refused save left its payload in the cache")

    def test_refused_save_does_not_cache_the_payload(self):
        """A symlinked target is refused at open; nothing about it may persist."""
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)
        link = os.path.join(self._tmpdir, "refused.vela")
        try:
            os.symlink(os.path.join(outside, "t.json"), link)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable on this platform")
        self.addCleanup(lambda: os.path.lexists(link) and os.unlink(link))

        status, _, _ = fetch(self._port, "POST", "/save/refused.vela",
                             body=json.dumps({"type": "deck_save", "deck": SAMPLE_DECK}),
                             headers={"Content-Type": "application/json"})
        self.assertNotEqual(status, 200)
        self.assertIsNone(self._server.get_deck_data("refused.vela"),
                          "a refused save cached content that was never written")


class TestAuthRejectsUndecodableTokens(unittest.TestCase):
    """compare_digest raises TypeError on non-ASCII str, and it runs before any
    validation — so an unauthenticated request could take the handler down with
    no response at all. Needs a server with auth ENABLED; the shared fixture
    runs with --no-auth, where every request is allowed and this cannot be seen.
    """

    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.mkdtemp()
        with open(os.path.join(cls._tmpdir, "sample.vela"), "w", encoding="utf-8") as f:
            json.dump(SAMPLE_DECK, f)
        cls._server = VelaLocalServer(cls._tmpdir, port=0, no_open=True,
                                      channel_port=0, token="TESTTOKEN")
        VelaHTTPHandler.server_ref = cls._server
        cls._httpd = ThreadedHTTPServer(("127.0.0.1", 0), VelaHTTPHandler)
        cls._port = cls._httpd.server_address[1]
        threading.Thread(target=cls._httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls._httpd.shutdown()
        shutil.rmtree(cls._tmpdir, ignore_errors=True)

    def test_non_ascii_bearer_is_refused_cleanly(self):
        status, _, _ = fetch(self._port, "GET", "/api/decks",
                             headers={"Authorization": "Bearer é"})
        self.assertIn(status, (401, 403))

    def test_non_ascii_url_token_is_refused_cleanly(self):
        status, _, _ = fetch(self._port, "GET", "/?token=%C3%A9")
        self.assertIn(status, (401, 403))

    def test_correct_token_still_authenticates(self):
        status, _, _ = fetch(self._port, "GET", "/api/decks",
                             headers={"Authorization": "Bearer TESTTOKEN"})
        self.assertEqual(status, 200)


class TestVendorAssetTrust(unittest.TestCase):
    """Vendor assets are served as executable JavaScript under a CSP whose
    script-src includes 'self', so they must come only from the trusted install
    root. Searching the served folder or launch cwd let a planted regular file
    run as a first-class page script — no symlink, no race — which bypasses
    every deck sanitizer at once."""

    MARKER = b"__PLANTED_VENDOR_PAYLOAD__"

    def _plant(self, base):
        d = os.path.join(base, "node_modules", "@babel", "standalone")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "babel.min.js"), "wb") as f:
            f.write(self.MARKER)

    def _vendor_bodies(self):
        return b"".join(body for body, _ in VelaHTTPHandler.static_files.values())

    def test_served_folder_node_modules_is_not_loaded(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        served = os.path.join(root, "served"); os.makedirs(served)
        self._plant(served)

        prev = dict(VelaHTTPHandler.static_files)
        self.addCleanup(lambda: VelaHTTPHandler.static_files.update(prev))
        VelaHTTPHandler.static_files.clear()

        VelaLocalServer(served, port=0, no_open=True, channel_port=0)._load_vendor_files()
        self.assertNotIn(self.MARKER, self._vendor_bodies(),
                         "a planted vendor asset was served as executable JS")

    def test_launch_cwd_node_modules_is_not_loaded(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        served = os.path.join(root, "served"); os.makedirs(served)
        self._plant(root)

        prev = dict(VelaHTTPHandler.static_files)
        self.addCleanup(lambda: VelaHTTPHandler.static_files.update(prev))
        VelaHTTPHandler.static_files.clear()

        cwd = os.getcwd()
        os.chdir(root)
        try:
            VelaLocalServer(served, port=0, no_open=True, channel_port=0)._load_vendor_files()
        finally:
            os.chdir(cwd)
        self.assertNotIn(self.MARKER, self._vendor_bodies(),
                         "a vendor asset from the launch cwd was served as executable JS")


class TestDeckReadIsBounded(unittest.TestCase):
    """The listing re-reads every deck on each poll, so an unbounded read lets
    one planted oversized file load repeatedly into memory."""

    def test_oversized_deck_is_refused(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        path = os.path.join(root, "big.vela")
        with open(path, "w", encoding="utf-8") as f:
            f.write('{"deckTitle":"' + "A" * 4096 + '","lanes":[]}')

        original = VelaHTTPHandler._DECK_MAX_BYTES
        VelaHTTPHandler._DECK_MAX_BYTES = 512  # smaller than the file
        self.addCleanup(setattr, VelaHTTPHandler, "_DECK_MAX_BYTES", original)

        fd = VelaHTTPHandler._open_deck_fd(root, "big.vela")
        with self.assertRaises(ValueError):
            VelaHTTPHandler._read_deck_json(fd)

    def test_normal_deck_still_reads(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        with open(os.path.join(root, "ok.vela"), "w", encoding="utf-8") as f:
            json.dump(SAMPLE_DECK, f)
        fd = VelaHTTPHandler._open_deck_fd(root, "ok.vela")
        self.assertEqual(VelaHTTPHandler._read_deck_json(fd)["deckTitle"],
                         SAMPLE_DECK["deckTitle"])


class TestRuntimeFileWrite(unittest.TestCase):
    """.vela.env carries the auth token and is written into the launch cwd —
    which for the usual `serve.py .` IS the served folder, so the same process
    that plants hostile decks can pre-plant this name."""

    def _run_in(self, cwd, decks, token="TESTTOKEN"):
        srv = VelaLocalServer(decks, port=8998, no_open=True, channel_port=0, token=token)
        prev = os.getcwd()
        os.chdir(cwd)
        try:
            srv._write_runtime_info()
        finally:
            os.chdir(prev)
        return srv

    def test_planted_symlink_is_not_followed(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        cwd = os.path.join(root, "cwd"); os.makedirs(cwd)
        decks = os.path.join(root, "decks"); os.makedirs(decks)
        victim = os.path.join(root, "victim.txt")
        with open(victim, "w", encoding="utf-8") as f:
            f.write("IMPORTANT-USER-FILE")
        try:
            os.symlink(victim, os.path.join(cwd, ".vela.env"))
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable on this platform")

        self._run_in(cwd, decks)

        with open(victim, encoding="utf-8") as f:
            body = f.read()
        self.assertEqual(body, "IMPORTANT-USER-FILE", "symlink target was overwritten")
        self.assertNotIn("TESTTOKEN", body, "auth token written through a symlink")
        written = os.path.join(cwd, ".vela.env")
        self.assertFalse(os.path.islink(written), "runtime file is still a symlink")
        self.assertEqual(os.stat(written).st_mode & 0o777, 0o600)

    def test_normal_write_still_works(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        decks = os.path.join(root, "decks"); os.makedirs(decks)
        self._run_in(root, decks)
        with open(os.path.join(root, ".vela.env"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["token"], "TESTTOKEN")


class TestDeckNameSpoofingRejected(unittest.TestCase):
    """The File column renders the name verbatim as the identity a user falls back
    on, so deceptive characters are rejected at validation rather than rewritten —
    rewriting would make the column disagree with the real filename."""

    def test_blank_glyph_names_rejected(self):
        for blank in ("⠀", "ㅤ", "ᅟ"):
            self.assertFalse(VelaHTTPHandler._validate_deck_name(f"report{blank * 3}.vela"))

    def test_stacked_combining_marks_rejected(self):
        self.assertFalse(VelaHTTPHandler._validate_deck_name("in̶҉voice.vela"))

    def test_control_characters_rejected(self):
        self.assertFalse(VelaHTTPHandler._validate_deck_name("bad\x1b[31m.vela"))

    def test_separator_lookalikes_rejected_by_role_not_by_list(self):
        """An enumerated list of slash lookalikes was bypassed by characters
        nobody enumerated. These render pixel-identical to real separators and
        must be refused because of what they ARE, not because they were listed."""
        # Escapes, not literals: these characters are invisible or easily
        # normalised away by an editor, which would silently defang the test.
        for label, name in (
            ("box-drawing diagonal", "reports╱2024╱final.vela"),
            ("combining overlay", "s̸e̸c̸.vela"),
            ("modifier colon", "etc꞉shadow.vela"),
            ("ogham space", "a b.vela"),
        ):
            self.assertFalse(VelaHTTPHandler._validate_deck_name(name), label)

    def test_ordinary_names_still_accepted(self):
        """A filter that rejected real filenames would be turned off, so the
        cost of the allowlist has to stay bounded to genuinely odd input."""
        for name in ("normal.vela", "café.vela", "日本語.vela",
                     "my deck (v2).vela", "презентация.vela", "عرض.vela",
                     "q3-2024_final.vela"):
            self.assertTrue(VelaHTTPHandler._validate_deck_name(name), name)


class TestUnservableNamesNeverListed(FolderServerTestBase):
    """A name that cannot be turned into a request path must not be listed:
    the client throws on it and the whole listing would go down with it."""

    def test_undecodable_filename_is_not_listed(self):
        raw = os.path.join(os.fsencode(self._tmpdir), b"bad\xd8\xff.vela")
        try:
            with open(raw, "wb") as f:
                f.write(b'{"deckTitle":"weird","lanes":[]}')
        except OSError:
            self.skipTest("filesystem rejects undecodable names")
        self.addCleanup(lambda: os.path.exists(raw) and os.unlink(raw))

        status, _, body = fetch(self._port, "GET", "/api/decks")
        self.assertEqual(status, 200)
        names = [d["name"] for d in json.loads(body)["decks"]]
        self.assertIn("sample.vela", names, "healthy decks must still be listed")
        for n in names:
            n.encode("utf-8")  # raises if a surrogate slipped through

    def test_validator_rejects_surrogates(self):
        self.assertFalse(VelaHTTPHandler._validate_deck_name("bad\udcd8.vela"))


if __name__ == "__main__":
    print(f"\n{'='*60}")
    print(f"  Vela Local Server Tests")
    print(f"{'='*60}\n")
    unittest.main(verbosity=2)
