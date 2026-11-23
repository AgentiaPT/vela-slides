#!/usr/bin/env python3
"""Security-invariant locks for the Neutralino desktop AI integration.

These tests parse source files (no Node/Go/Docker needed) so the desktop
hardening cannot silently regress in CI:

  * the webview is never granted process-spawn capability;
  * the only spawner is the Go gatekeeper, and it can launch nothing but the
    two whitelisted agent binaries, with all tools disabled and no shell;
  * the extension is wired Node-free (a compiled binary, not `node ...`).

Run:  python tests/test_vela.py  (suite)  or  python tests/test_desktop.py
"""

import glob
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEU = os.path.join(ROOT, "vela-neutralino")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


# Entries the runtime (or its bundled client library, which is fetched by
# `neu update` and is not checked into this repo — see checksums/) needs at
# boot time but that never appear as a `Neutralino.<ns>.<method>(` call site
# in our own source: the official client library calls these internally as
# part of its init/extension-readiness handshake. Documented in SECURITY.md
# layer 2. Keep this list minimal and named — it is the ONLY escape hatch
# from the "allowlist must be a subset of methods we can see called" check
# below, so anything added here must be justified in SECURITY.md too.
# extensions.getStats: client init / extension-readiness handshake.
# debug.log: the client library's internal error handler writes to the fixed
#   runtime log file (logging.writeToLogFile is enabled). It takes a message,
#   not a path — no arbitrary-path capability — so admitting it does not
#   re-open the file-write class this allowlist confines.
BOOT_HANDSHAKE_EXCEPTIONS = {"extensions.getStats", "debug.log"}


def find_called_native_methods():
    """Return the set of "<namespace>.<method>" pairs actually invoked as
    `Neutralino.<namespace>.<method>(` across the webview's own JS source
    (resources/js/*.js). Deliberately source-level (no Node/Neutralino
    runtime needed) so this runs in plain CI."""
    calls = set()
    pattern = re.compile(r"Neutralino\.([a-zA-Z]+)\.([a-zA-Z]+)\(")
    for path in sorted(glob.glob(os.path.join(NEU, "resources", "js", "*.js"))):
        with open(path, encoding="utf-8") as f:
            src = f.read()
        for ns, method in pattern.findall(src):
            calls.add(f"{ns}.{method}")
    return calls


class NeutralinoConfigInvariants(unittest.TestCase):
    def setUp(self):
        self.cfg = json.loads(read("vela-neutralino", "neutralino.config.json"))

    def test_no_spawn_process_in_allowlist(self):
        allow = self.cfg["nativeAllowList"]
        for forbidden in ("os.spawnProcess", "os.updateSpawnedProcess", "os.*", "*"):
            self.assertNotIn(
                forbidden, allow,
                f"{forbidden} must never be in nativeAllowList — it re-opens XSS->RCE",
            )

    def test_extension_declared(self):
        self.assertIs(self.cfg.get("enableExtensions"), True)
        ids = [e.get("id") for e in self.cfg.get("extensions", [])]
        self.assertIn("ai.vela.agent", ids)

    def test_extensions_messaging_not_granted(self):
        # The client init needs read-only extensions.getStats; the webview must
        # NOT be able to message/send to the extension (it uses loopback HTTP).
        allow = self.cfg["nativeAllowList"]
        self.assertIn("extensions.getStats", allow)
        for forbidden in ("extensions.dispatch", "extensions.broadcast", "extensions.*"):
            self.assertNotIn(forbidden, allow)

    def test_extension_command_is_node_free(self):
        ext = next(e for e in self.cfg["extensions"] if e["id"] == "ai.vela.agent")
        cmds = [ext.get("commandLinux", ""), ext.get("commandDarwin", ""), ext.get("commandWindows", "")]
        for c in cmds:
            self.assertIn("extensions/agent/vela-agent", c)
            self.assertNotIn("node", c, "gatekeeper must be a compiled binary, not node")

    # ── F-2: no FS/OS-capable namespace wildcard may ever re-enter the list ──
    def test_no_namespace_wildcard_for_fs_or_os_capable_namespaces(self):
        # A wildcard admits every current AND future method in a namespace —
        # including path-writing primitives (window.snapshot, window.setIcon,
        # os.spawnProcess, filesystem writers, storage bulk ops) that have
        # nothing to do with why the namespace was granted. Every entry must
        # be a single enumerated "<namespace>.<method>", never a wildcard.
        allow = self.cfg["nativeAllowList"]
        forbidden_wildcards = (
            "window.*", "storage.*", "filesystem.*", "os.*", "app.*",
            "events.*", "extensions.*", "*",
        )
        for forbidden in forbidden_wildcards:
            self.assertNotIn(
                forbidden, allow,
                f"{forbidden} must never be in nativeAllowList — it re-admits "
                "every method in the namespace, including path-writing ones "
                "fs-guard never wraps (F-2)",
            )

    def test_window_snapshot_and_seticon_not_admitted(self):
        # F-2 (confirmed, High): Neutralino.window.snapshot(path) writes a PNG
        # to ANY caller-supplied absolute path — a native primitive that
        # bypasses the fs-guard's filesystem-only confinement entirely, since
        # fs-guard only wraps Neutralino.filesystem.*. window.setIcon is the
        # sibling path-READ primitive. Neither is ever called by the shell
        # (see WindowNamespaceMatchesActualUsage below) — they must never be
        # admitted to the native bridge.
        allow = self.cfg["nativeAllowList"]
        self.assertNotIn("window.snapshot", allow)
        self.assertNotIn("window.setIcon", allow)

    def test_allowlist_is_subset_of_actually_called_methods(self):
        # Deny-by-default: every allowlisted "<ns>.<method>" must correspond
        # to a real `Neutralino.<ns>.<method>(` call site in our own JS, or be
        # one of the small, named, documented boot-handshake exceptions the
        # client library makes internally (see BOOT_HANDSHAKE_EXCEPTIONS).
        # This is what stops an unused FS/OS-capable method from ever being
        # silently re-admitted: add it to the allowlist without a real call
        # site, and this test fails.
        allow = set(self.cfg["nativeAllowList"])
        called = find_called_native_methods()
        unused = allow - called - BOOT_HANDSHAKE_EXCEPTIONS
        self.assertEqual(
            unused, set(),
            f"nativeAllowList admits methods with no call site and no "
            f"documented boot-handshake exception: {sorted(unused)}",
        )

    def test_window_namespace_matches_actual_usage(self):
        # Narrower companion to the subset check above, pinned to the exact
        # set F-2 was opened against — fails loudly (not just "a diff") if
        # window.* usage drifts without the allowlist being updated to match.
        allow = self.cfg["nativeAllowList"]
        window_entries = {e for e in allow if e.startswith("window.")}
        expected = {
            "window.setFullScreen", "window.exitFullScreen", "window.maximize",
            "window.unmaximize", "window.isMaximized", "window.focus",
            "window.setTitle",  # CR16 title sync (window-glue.js); string only, no path
        }
        self.assertEqual(window_entries, expected)


class WebviewNeverSpawns(unittest.TestCase):
    def test_no_spawn_in_bridge_or_boot(self):
        # Guard against an actual call (a "(" follows), not comment mentions of
        # the API name explaining why it is avoided.
        for rel in ("resources/js/agents-bridge.js", "resources/js/nl-boot.js"):
            src = read("vela-neutralino", *rel.split("/"))
            self.assertNotIn("spawnProcess(", src, f"{rel} must not call spawnProcess")
            self.assertNotIn("updateSpawnedProcess(", src, f"{rel} must not call updateSpawnedProcess")


class GatekeeperInvariants(unittest.TestCase):
    def setUp(self):
        self.go = read("vela-neutralino", "extensions", "agent", "main.go")

    def test_binary_allowlist_is_exactly_two(self):
        bins = re.findall(r'Bin:\s*"([^"]+)"', self.go)
        self.assertEqual(sorted(bins), ["claude", "copilot"])

    def test_no_shell_invocation(self):
        # os/exec with an argv array — never a shell. Guard against /bin/sh -c.
        self.assertIn("exec.CommandContext", self.go)
        self.assertNotIn('"-c"', self.go)
        self.assertNotIn("/bin/sh", self.go)
        self.assertNotIn("cmd.exe", self.go)

    def test_all_tools_disabled(self):
        # Check the quoted argument literals (real args), not comment mentions.
        # claude: positive allowlist of NOTHING + no MCP + no settings sources.
        self.assertIn('"--tools", ""', self.go)
        self.assertIn('"--strict-mcp-config"', self.go)
        self.assertIn('"--setting-sources", ""', self.go)
        self.assertIn('"--deny-tool"', self.go)         # copilot
        self.assertNotIn('"--allow-all-tools"', self.go)
        self.assertNotIn('"--allow-tool"', self.go)
        # With no tools there is nothing to permit — the dangerous bypass must be
        # gone from the launch args entirely.
        self.assertNotIn('"--dangerously-skip-permissions"', self.go)

    def test_token_auth_present(self):
        self.assertIn("x-vela-token", self.go)
        self.assertIn("subtle.ConstantTimeCompare", self.go)

    def test_binds_loopback_only(self):
        self.assertIn('"127.0.0.1:0"', self.go)

    def test_agent_binary_resolved_to_absolute_path(self):
        # exec.LookPath trusts PATH; a shim planted earlier in PATH (or in a
        # world-writable dir) would otherwise run with --dangerously-skip-
        # permissions. The name must resolve to a verified absolute path, and
        # the child must be launched by that path — not the bare name.
        self.assertIn("resolveAgentBin(", self.go)
        self.assertIn("filepath.IsAbs", self.go)
        self.assertIn("checkBinaryTrusted(", self.go)
        self.assertIn("exec.CommandContext(ctx, binPath", self.go)

    def test_cors_is_origin_pinned_not_wildcard(self):
        # CORS must be pinned to this window's loopback origin, never a wildcard,
        # so a leaked token cannot be replayed from a browser page on another
        # origin. Dropping the origin gate re-opens that replay path.
        self.assertIn("allowedOrigin(", self.go)
        self.assertNotIn('"Access-Control-Allow-Origin", "*"', self.go)

    def test_self_terminates_on_parent_exit(self):
        # Neutralino never kills extension processes (upstream #1299) — the
        # gatekeeper must self-terminate or it orphans. Two independent signals
        # must remain: stdin EOF (primary, immune to ephemeral-port reuse) and
        # the loopback port watch (fallback). Dropping either re-opens the
        # orphan-process leak.
        self.assertIn("close(stdinClosed)", self.go)   # stdin EOF closes the channel
        self.assertIn("<-stdinClosed", self.go)        # a watcher waits on it
        self.assertIn("portOpen(", self.go)            # port-watch fallback retained
        # Windows-primary: block on the app process HANDLE. Neutralino spawns the
        # extension via a cmd.exe wrapper that inherits the app's server socket
        # (defeating the port watch) and blocks on the agent (defeating the ppid
        # poll) — only the app process's death is a true "window closed" signal.
        self.assertIn("watchParentExit(dir)", self.go)

    def test_early_stdin_close_is_ignored(self):
        # A platform that closes stdin almost immediately after handing off the
        # handshake (rather than holding it open for the app's lifetime) must
        # not be mistaken for "parent exited" — that would self-terminate the
        # gatekeeper at launch. The grace window must stay in place.
        self.assertIn("5*time.Second", self.go)
        self.assertIn("stdin closed early", self.go)

    def test_handshake_files_keyed_by_nlport_suffix(self):
        # Each Vela window's gatekeeper must key its port/token files by the
        # window's Neutralino port, so two windows never collide on one
        # handshake file.
        self.assertIn('"agent-ext"+suffix+".port"', self.go)
        self.assertIn('"agent-ext"+suffix+".token"', self.go)

    def test_reaps_child_process_tree_on_shutdown(self):
        # claude/copilot spawn their own node subtree; os/exec's ctx-cancel kills
        # only the direct child, so the rest would orphan when the window closes.
        # Each spawn is bound to a tree, and the shutdown path reaps live trees
        # before exiting. Dropping either re-opens the orphan-process leak.
        self.assertIn("newChildTree(", self.go)  # every spawn is tree-scoped
        self.assertIn("trackTree(", self.go)     # live trees are registered
        self.assertIn("reapChildren()", self.go) # shutdown tears them down


class ProcTreeReaperInvariants(unittest.TestCase):
    """The spawned agent's whole process tree must die with the gatekeeper.

    os/exec kills only the direct child; claude/copilot launch a node subtree
    that would otherwise orphan when the desktop window closes. Windows binds
    the tree to a Job Object (kill-on-close); Unix puts each agent in its own
    process group and SIGKILLs the group.
    """

    def test_windows_uses_kill_on_close_job_object(self):
        go = read("vela-neutralino", "extensions", "agent", "procwatch_windows.go")
        self.assertIn("AssignProcessToJobObject", go)
        self.assertIn("KILL_ON_JOB_CLOSE", go)
        self.assertIn("TerminateJobObject", go)
        # Handle-based parent watch — immune to PID reuse (unlike the ppid poll).
        self.assertIn("WaitForSingleObject", go)

    def test_windows_watches_app_ancestor_not_shell(self):
        # Neutralino launches the extension through a cmd.exe wrapper, so the
        # immediate parent is an immortal shell. The watch must walk PAST the
        # shell to the real app process, or it never fires and the gatekeeper
        # orphans. Lock the shell-skipping resolver in place.
        go = read("vela-neutralino", "extensions", "agent", "procwatch_windows.go")
        self.assertIn("resolveAppAncestor", go)
        self.assertIn("shellWrappers", go)
        self.assertIn('"cmd.exe"', go)  # the wrapper that must be skipped

    def test_unix_kills_the_process_group(self):
        go = read("vela-neutralino", "extensions", "agent", "procwatch_unix.go")
        self.assertIn("Setpgid", go)
        self.assertIn("Kill(-", go)  # negative pid == signal the whole group

    def test_unix_rejects_world_writable_agent_binary(self):
        # The absolute-path resolver refuses a binary in a world-writable file or
        # (non-sticky) dir, where a local account could swap in a shim. The
        # world-writable bit + sticky exception must stay in the check.
        go = read("vela-neutralino", "extensions", "agent", "procwatch_unix.go")
        self.assertIn("checkBinaryTrusted", go)
        self.assertIn("0o002", go)          # world-writable bit is the trigger
        self.assertIn("ModeSticky", go)     # sticky dirs (e.g. /tmp) are exempt

    def test_windows_binary_trust_check_present(self):
        go = read("vela-neutralino", "extensions", "agent", "procwatch_windows.go")
        self.assertIn("checkBinaryTrusted", go)  # no-op, but must exist to build


class AgentsBridgeInvariants(unittest.TestCase):
    def setUp(self):
        self.js = read("vela-neutralino", "resources", "js", "agents-bridge.js")

    def test_handshake_prefers_window_nlport_suffix(self):
        # Must prefer the NL_PORT-keyed handshake file over the legacy
        # unsuffixed name, matching the gatekeeper's own keying (main.go).
        self.assertIn("window.NL_PORT", self.js)
        self.assertIn("suffixes.push", self.js)

    def test_401_resets_cached_handshake(self):
        # A stale/rotated token must not be cached forever — 401 must clear it
        # so the next call re-reads the handshake files.
        self.assertIn("handshake = null", self.js)

    def test_send_routes_through_active_provider_only(self):
        # send() must refuse to call the extension with no provider selected,
        # rather than defaulting to some provider id.
        self.assertIn('throw new Error("No AI provider selected")', self.js)


class TrustGateInvariants(unittest.TestCase):
    """The desktop AI confirm must fire once per app launch — always."""

    def setUp(self):
        self.js = read("vela-neutralino", "resources", "js", "trust.js")

    def test_confirms_once_per_session(self):
        # A single in-memory flag gates the whole session: prompt once, then
        # AI stays enabled until the app restarts.
        self.assertIn("sessionConfirmed", self.js)
        self.assertIn('if (sessionConfirmed) return "allow"', self.js)

    def test_persisted_trust_does_not_bypass_prompt(self):
        # A persisted trust.json entry must NOT silently enable AI without a
        # prompt — the user asked to confirm AI use once per session always.
        # Guard against the old bypass (set the session flag + allow inline on
        # a persisted-deck hit) ever returning.
        self.assertNotIn('{ sessionConfirmed = true; return "allow"; }', self.js)

    def test_multi_provider_picker_wired(self):
        # When more than one agent is installed, the modal must let the user
        # pick before enabling — wired back to the shared provider switcher.
        self.assertIn("vela-agent-pick", self.js)
        self.assertIn("window.__velaSelectProvider", self.js)


class AIAvailabilityEventContractInvariants(unittest.TestCase):
    """The 'vela-agent-update' event name must match on both ends of the
    boot-time wiring, or the monolith's AI-gated buttons silently never
    refresh from their initial (disabled) state."""

    def test_event_name_matches_across_boot_and_monolith(self):
        boot_js = read("vela-neutralino", "resources", "js", "nl-boot.js")
        imports_jsx = read("src", "parts", "part-imports.jsx")
        self.assertIn('dispatchEvent(new Event("vela-agent-update"))', boot_js)
        self.assertIn('"vela-agent-update"', imports_jsx)
        self.assertIn("useAIAvailable", imports_jsx)


class FullscreenBridgeEscapeInvariants(unittest.TestCase):
    """Vela owns Escape in Present mode (zoom / gallery / presenter view /
    dialog close first). A bridge-level Escape listener runs before Vela and
    always leaves OS fullscreen, so Present exits on every Esc."""

    def test_bridge_does_not_handle_escape(self):
        boot_js = read("vela-neutralino", "resources", "js", "nl-boot.js")
        start = boot_js.index("function installFullscreenBridge")
        end = boot_js.index("\n}\n", start)
        self.assertNotRegex(boot_js[start:end], r'e\.key\s*===\s*["\']Escape["\']')

    def test_vela_exits_present_on_escape(self):
        panel = read("src", "parts", "part-slidepanel.jsx")
        # Open modals are tracked in an app-owned registry (not a page-wide
        # attribute query that deck-supplied markup could satisfy).
        self.assertRegex(panel, r'e\.key === "Escape" && fullscreen && VELA_OPEN_CHROME\.modals\.size === 0')
        self.assertNotIn('querySelector("[data-vela-modal]")', panel)
        modals = read("src", "parts", "part-app-modals.jsx")
        self.assertIn("VELA_OPEN_CHROME.modals.add(", modals)
        self.assertIn("VELA_OPEN_CHROME.modals.delete(", modals)


class FsGuardHardeningInvariants(unittest.TestCase):
    """Source locks for the filesystem-guard hardening. The behavioral suite
    (tests/test_fs_guard.cjs) executes the real module; these assert the guard
    is wired the hardened way so the desktop file-access caps cannot regress by
    editing the source out."""

    def setUp(self):
        self.js = read("vela-neutralino", "resources", "js", "fs-guard.js")

    def test_capability_is_frozen(self):
        # The exported guard must be frozen so same-realm script cannot swap out
        # allow()/install() to neutralize the guard.
        self.assertIn("Object.freeze(fsGuard)", self.js)

    def test_allow_refuses_volume_shallow_and_system_roots(self):
        # allow() must reject a whole-volume root, a shallow single-segment POSIX
        # root, AND a nested OS-critical system subtree before pushing to the
        # allowlist.
        self.assertIn("isVolumeRoot(n) || isShallowRoot(n) || isSystemRoot(n)", self.js)
        self.assertIn("function isShallowRoot", self.js)
        self.assertIn("function isSystemRoot", self.js)
        # Home roots must NOT be denylisted (a legitimate ~/.vela lives there).
        for home in ("/home", "/Users", "/root"):
            self.assertNotIn(f'"{home}"', self.js.split("SYSTEM_ROOTS")[1].split("]")[0])

    def test_traversal_segment_still_rejected(self):
        # Defense-in-depth traversal guard must remain in underRoot().
        self.assertIn('n.split("/").includes("..")', self.js)


_JS_REGEX_BEFORE = set("(,=:[!&|?{};+-*%<>~^")
_JS_REGEX_WORDS = {"return", "typeof", "case", "in", "of", "void", "delete", "new", "throw", "yield", "await", "else"}


def strip_js_comments(src):
    """Remove block and line comments. A small scanner: it skips strings,
    template literals and regex literals, so a "//" or "/*" inside them is
    kept, and the code after such a string is kept too. Limits (enough for our
    shell files, see test_strip_js_comments_keeps_code_after_a_string_with_slashes):
    a "${...}" in a template literal is not parsed, and a "/" is taken as a
    regex start only after an operator, a bracket or a keyword."""
    out = []
    i, n = 0, len(src)
    prev, word = "", ""  # last code character and last word, for the regex rule
    while i < n:
        c = src[i]
        if c in "'\"`":
            j = i + 1
            while j < n and src[j] != c and (c == "`" or src[j] != "\n"):
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1])
            i, prev, word = j + 1, c, ""
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
            out.append(" ")
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
            continue
        if c == "/" and (prev == "" or prev in _JS_REGEX_BEFORE or word in _JS_REGEX_WORDS):
            j, in_class = i + 1, False
            while j < n and src[j] != "\n" and (in_class or src[j] != "/"):
                if src[j] == "\\":
                    j += 1
                elif src[j] == "[":
                    in_class = True
                elif src[j] == "]":
                    in_class = False
                j += 1
            if j < n and src[j] == "/":
                out.append(src[i:j + 1])
                i, prev, word = j + 1, "/", ""
                continue
        if c.isalnum() or c in "_$":
            j = i
            while j < n and (src[j].isalnum() or src[j] in "_$"):
                j += 1
            word = src[i:j]
            out.append(word)
            i, prev = j, "a"
            continue
        out.append(c)
        if not c.isspace():
            prev, word = c, ""
        i += 1
    return "".join(out)


class ReconnectRecoverySourcePins(unittest.TestCase):
    """Source-level pins for the sleep/hibernate recovery change (nl-socket.js,
    sync-conflict.js, deck-io.js). The behaviour is tested in
    tests/test_nl_reconnect.cjs and tests/test_sync_conflict.cjs. These pins fail
    when a change widens the native surface by accident: a new native method, a
    looser CSP, a mode other than "window" or a reusable token, a new
    filesystem.readFile call site (also through an alias, a bracket access or a
    destructured name), an HTML sink in a shell script, a console or native call
    in nl-socket.js, a debug.log call of ours, or a resync wait that is shorter
    than the app save debounce. Comments are removed before each search."""

    JS = os.path.join(NEU, "resources", "js")

    # The exact allowlist at the time of the change. A new entry must be a
    # deliberate change that updates this list and SECURITY.md.
    EXPECTED_ALLOW_LIST = [
            "app.exit",
            "window.focus",
            "window.setTitle",
            "window.setFullScreen",
            "window.exitFullScreen",
            "window.maximize",
            "window.unmaximize",
            "window.isMaximized",
            "os.showFolderDialog",
            "os.getEnv",
            "filesystem.readFile",
            "filesystem.writeFile",
            "filesystem.readDirectory",
            "filesystem.createDirectory",
            "filesystem.getStats",
            "filesystem.createWatcher",
            "filesystem.removeWatcher",
            "filesystem.remove",
            "filesystem.move",
            "storage.getKeys",
            "storage.getData",
            "storage.setData",
            "events.on",
            "events.off",
            "extensions.getStats",
            "debug.log"
    ]

    EXPECTED_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:* wss://localhost:* http://localhost:* https://localhost:* https://raw.githubusercontent.com/agentiapt/vela-slides/main/vela-neutralino/update-manifest.json; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"

    def js(self, name):
        return read("vela-neutralino", "resources", "js", name)

    def test_native_allow_list_is_unchanged(self):
        cfg = json.loads(read("vela-neutralino", "neutralino.config.json"))
        self.assertEqual(cfg["nativeAllowList"], self.EXPECTED_ALLOW_LIST)

    def test_csp_is_unchanged(self):
        html = read("vela-neutralino", "resources", "index.html")
        m = re.search(r'http-equiv="Content-Security-Policy"\s+content="([^"]*)"', html)
        self.assertIsNotNone(m, "CSP meta tag not found")
        self.assertEqual(m.group(1), self.EXPECTED_CSP)

    def test_window_mode_and_one_time_token(self):
        cfg = json.loads(read("vela-neutralino", "neutralino.config.json"))
        self.assertEqual(cfg.get("defaultMode"), "window")
        self.assertEqual(cfg.get("tokenSecurity"), "one-time")

    # Every shell script of ours (the pinned client library neutralino.js is
    # excluded). An explicit list: a glob that finds nothing (a moved folder)
    # would make every loop below pass without a check.
    EXPECTED_SHELL_JS = [
        "agents-bridge.js", "config-store.js", "deck-io.js", "deck-warning.js",
        "fs-guard.js", "nl-boot.js", "nl-socket.js", "script-escape.js",
        "storage-shim.js", "sync-conflict.js", "trust.js", "update-check.js",
        "window-glue.js",
    ]

    def test_shell_js_file_set_is_the_expected_list(self):
        found = sorted(
            os.path.basename(p) for p in glob.glob(os.path.join(self.JS, "*.js"))
            if os.path.basename(p) != "neutralino.js")
        self.assertEqual(found, sorted(self.EXPECTED_SHELL_JS))

    def shell_sources(self):
        out = {}
        for name in self.EXPECTED_SHELL_JS:
            with open(os.path.join(self.JS, name), encoding="utf-8") as f:
                out[name] = strip_js_comments(f.read())
        self.assertEqual(len(out), len(self.EXPECTED_SHELL_JS))
        return out

    def test_strip_js_comments_keeps_code_after_a_string_with_slashes(self):
        src = ('const a = "x // y"; readFile(a); // gone\n'
               "const u = 'http://h/p'; const r = /[\"']\\/\\//g; keep2();\n"
               "const t = `a // b`; keep3(); /* gone2 */ keep4();\n"
               "const q = 4 / 2; keep5(); // gone3\n")
        out = strip_js_comments(src)
        for kept in ("readFile(a);", '"x // y"', "'http://h/p'", "keep2();", "`a // b`",
                     "keep3();", "keep4();", "4 / 2", "keep5();"):
            self.assertIn(kept, out)
        for gone in ("gone", "gone2", "gone3"):
            self.assertNotIn(gone, out)

    # The read sites at the time of the change. deck-io.js reads every deck
    # through readDeckText (one place to audit); fs-guard.js names the methods
    # it guards. A new site must be a deliberate change that updates this map.
    EXPECTED_READ_TOKENS = {
        "agents-bridge.js": 2,
        "config-store.js": 1,
        "deck-io.js": 1,
        "fs-guard.js": 2,
        "trust.js": 1,
    }

    def test_read_file_sites_across_shell_js(self):
        # Count the bare names, so a call through an alias (fsx.readFile), a
        # bracket access (fs["readFile"]) or a destructured name ({ readFile })
        # also counts.
        got = {}
        for name, src in self.shell_sources().items():
            n = len(re.findall(r"\bread(?:Binary)?File\b", src))
            if n:
                got[name] = n
        self.assertEqual(got, self.EXPECTED_READ_TOKENS)
        dm = re.findall(r"Neutralino\.filesystem\.readFile\(", self.shell_sources()["deck-io.js"])
        self.assertEqual(len(dm), 1, "deck-io.js must call readFile in exactly one place")

    def test_filesystem_is_not_aliased_outside_fs_guard(self):
        # A reference to the filesystem namespace that is not a direct method
        # call (an alias, a bracket access, a destructuring) can hide a read
        # from the pin above. Only fs-guard.js wraps the namespace.
        alias = re.compile(
            r"\bfilesystem\b(?!\s*\.\s*[A-Za-z_$][\w$]*\s*\()"
            r"|\bNeutralino\s*\[|\[\s*[\"'`]filesystem[\"'`]\s*\]")
        for name, src in self.shell_sources().items():
            hits = alias.findall(src)
            if name == "fs-guard.js":
                self.assertEqual(len(hits), 2, "fs-guard.js filesystem references changed")
            else:
                self.assertEqual(hits, [], f"{name} references Neutralino.filesystem other than by a direct call")

    def test_shell_js_has_no_html_sink(self):
        sinks = re.compile(
            r"\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|\bdocument\s*\.\s*write(?:ln)?\b"
            r"|\bcreateContextualFragment\b|\bDOMParser\b|\bsrcdoc\b|\bsetHTMLUnsafe\b"
            r"|\bparseHTMLUnsafe\b|\bsetHTML\b|\bouterText\s*=|\bjavascript:")
        for name, src in self.shell_sources().items():
            m = sinks.search(src)
            self.assertIsNone(m, f"{name} uses an HTML sink: {m.group(0) if m else ''}")

    def test_nl_socket_has_no_console_and_no_native_call(self):
        # The connect URL holds the token: the module has no console call at all,
        # and it makes no native call (it only owns the socket).
        # Comments are removed first: the header comment names Neutralino.init().
        src = strip_js_comments(self.js("nl-socket.js"))
        self.assertNotIn("console.", src)
        self.assertNotIn("Neutralino.", src)

    def test_debug_log_call_sites_are_unchanged(self):
        # debug.log is in the allowlist for the client library only. No file of
        # ours may call it (the pinned client file is excluded).
        total = 0
        for name in self.EXPECTED_SHELL_JS:
            with open(os.path.join(self.JS, name), encoding="utf-8") as f:
                total += len(re.findall(r"\bdebug\.log\s*\(", f.read()))
        self.assertEqual(total, 0)

    def test_resync_wait_is_longer_than_the_app_save_debounce(self):
        # resync waits so that the last edit before a drop reaches deck-io first.
        m = re.search(r"const\s+RESYNC_QUIET_MS\s*=\s*(\d+)\s*;", self.js("deck-io.js"))
        self.assertIsNotNone(m, "RESYNC_QUIET_MS not found in deck-io.js")
        app = read("src", "parts", "part-app.jsx")
        d = re.search(r"flushLocalStateRef\.current\?\.\(null\),\s*(\d+)\)", app)
        self.assertIsNotNone(d, "app save debounce not found in part-app.jsx")
        self.assertGreater(int(m.group(1)), int(d.group(1)))

    def test_heartbeat_bound_is_longer_than_the_native_call_bound(self):
        # The runtime answers native calls one at a time, so a heartbeat can
        # wait behind a slow disk call that deck-io bounds by
        # NATIVE_CALL_TIMEOUT_MS. A shorter heartbeat bound takes that wait as
        # a dead socket and drops a healthy connection.
        hb = re.search(r"const\s+HEARTBEAT_TIMEOUT_MS\s*=\s*(\d+)\s*;", self.js("nl-socket.js"))
        nc = re.search(r"const\s+NATIVE_CALL_TIMEOUT_MS\s*=\s*(\d+)\s*;", self.js("deck-io.js"))
        self.assertIsNotNone(hb, "HEARTBEAT_TIMEOUT_MS not found in nl-socket.js")
        self.assertIsNotNone(nc, "NATIVE_CALL_TIMEOUT_MS not found in deck-io.js")
        self.assertGreater(int(hb.group(1)), int(nc.group(1)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
