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

import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEU = os.path.join(ROOT, "vela-neutralino")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
