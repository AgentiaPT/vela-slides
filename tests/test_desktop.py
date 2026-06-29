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
        self.assertIn('"--disallowed-tools"', self.go)  # claude
        self.assertIn('"--deny-tool"', self.go)         # copilot
        self.assertNotIn('"--allow-all-tools"', self.go)
        self.assertNotIn('"--allow-tool"', self.go)

    def test_token_auth_present(self):
        self.assertIn("x-vela-token", self.go)
        self.assertIn("subtle.ConstantTimeCompare", self.go)

    def test_binds_loopback_only(self):
        self.assertIn('"127.0.0.1:0"', self.go)

    def test_self_terminates_on_parent_exit(self):
        # Neutralino never kills extension processes (upstream #1299) — the
        # gatekeeper must self-terminate or it orphans. Two independent signals
        # must remain: stdin EOF (primary, immune to ephemeral-port reuse) and
        # the loopback port watch (fallback). Dropping either re-opens the
        # orphan-process leak.
        self.assertIn("close(stdinClosed)", self.go)   # stdin EOF closes the channel
        self.assertIn("<-stdinClosed", self.go)        # a watcher waits on it
        self.assertIn("portOpen(", self.go)            # port-watch fallback retained


if __name__ == "__main__":
    unittest.main(verbosity=2)
