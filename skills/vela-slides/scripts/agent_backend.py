#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
agent_backend.py — Local AI backend for Vela.

Routes Vera's AI calls (part-engine.jsx `callClaudeAPI`) to the `claude` CLI
(Claude Code, print mode) running in the current environment, instead of the
Anthropic HTTP API. This lets `vela server` — and the offline render harness —
drive Vera end to end using whatever Claude Code auth the machine already has,
with no API key wired into the artifact.

This is the Python counterpart of the hardened Neutralino gatekeeper
(vela-neutralino/extensions/agent/main.go). It speaks the loopback "channel"
protocol the monolith already knows: the webview POSTs a
`{action:"complete", system, messages, ...}` transcript to `/action` and gets
back `{ok, reply}` (see part-engine.jsx, the `VELA_CHANNEL_PORT` branch).

SECURITY POSTURE (mirrors the Go gatekeeper — keep them in lock-step):
  - The binary is a constant (`claude`); the prompt is DATA only, handed to the
    child on stdin. os/exec-style argv (no shell) means the prompt can never be
    reinterpreted as a command.
  - The agent runs in print mode with EVERY tool disabled
    (--disallowed-tools ...), so it is a pure text completion: it cannot read or
    write files, run bash, or reach the network on its own.
  - The channel server binds loopback only.

Usage:
  python3 agent_backend.py serve [--port N] [--host H]   # run the channel server
  python3 agent_backend.py complete < payload.json       # one-shot (stdin JSON -> stdout JSON)
  python3 agent_backend.py check                          # report claude availability
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The agent binary Vela is allowed to launch. Constant — never taken from a
# request (matches the Go gatekeeper's provider allowlist).
AGENT_BIN = os.environ.get("VELA_AGENT_BIN", "claude")

# Every tool disabled: the agent is a text completer, nothing more. Kept
# character-for-character in sync with vela-neutralino/extensions/agent/main.go.
DISALLOWED_TOOLS = "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task"

DEFAULT_TIMEOUT = 180       # seconds; a normal completion
CREATE_TIMEOUT = 300        # seconds; "create" calls generate whole decks

_ANSI_RE = re.compile("\x1b\\[[0-9;]*[A-Za-z]")
_BRAILLE_RE = re.compile("[⠀-⣿]")


def _strip_chrome(s):
    """Strip ANSI escapes and spinner braille from CLI stdout (fallback path)."""
    s = _ANSI_RE.sub("", s or "")
    s = _BRAILLE_RE.sub("", s)
    return s.strip()


def _content_to_string(content):
    """A message's content is usually a plain string; keep multipart content as
    its JSON form so nothing is silently dropped (mirrors contentToString)."""
    if isinstance(content, str):
        return content
    return json.dumps(content, ensure_ascii=False)


def serialise_messages(messages):
    """Flatten the conversation turns into one prompt the CLI reads on stdin.
    Vera's own system prompt is passed separately via --system-prompt, so it is
    NOT wrapped in here — only the user/assistant turns. Single-turn calls (the
    common Vera case) collapse to just the user content."""
    msgs = messages or []
    if len(msgs) == 1 and (msgs[0].get("role") or "user") == "user":
        return _content_to_string(msgs[0].get("content"))
    parts = []
    for m in msgs:
        role = (m.get("role") or "USER").upper()
        parts.append("<" + role + ">\n" + _content_to_string(m.get("content")) + "\n</" + role + ">")
    return "\n\n".join(parts)


def _claude_args(system):
    """Locked argument template for `claude`. Vera's instructions go through the
    real --system-prompt (replacing Claude Code's default agent prompt, so Vera
    behaviour drives the model); the conversation itself goes on stdin. No flag
    ever grants a tool."""
    args = ["-p", "--output-format", "json", "--disallowed-tools", DISALLOWED_TOOLS]
    # In print mode with every tool disabled there is nothing to prompt for, but
    # a non-root desktop still benefits from the belt-and-suspenders flag (parity
    # with the Neutralino gatekeeper). Claude refuses it under root/sudo, so skip
    # it there — the disallowed-tools lock already makes this a pure completion.
    if getattr(os, "geteuid", lambda: 1)() != 0:
        args.insert(3, "--dangerously-skip-permissions")
    if system:
        args += ["--system-prompt", system]
    return args


def _parse_claude(stdout):
    """Parse `claude --output-format json` output into {reply, model, stats}.
    Falls back to the raw (de-chromed) text if it is not the expected JSON."""
    try:
        env = json.loads(stdout)
    except (ValueError, TypeError):
        return {"reply": _strip_chrome(stdout), "model": "claude-code", "stats": {}}
    usage = env.get("usage") or {}
    model = env.get("model") or "claude-code"
    return {
        "reply": env.get("result", ""),
        "model": model,
        "stats": {
            "model": model,
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "cache_read_tokens": usage.get("cache_read_input_tokens", 0),
            "cache_create_tokens": usage.get("cache_creation_input_tokens", 0),
            "cost_usd": env.get("total_cost_usd", 0),
        },
    }


def resolve_agent_bin():
    """Resolve the agent binary NAME to an absolute path, or None if not on PATH.
    (The Go gatekeeper additionally refuses world-writable resolutions; here the
    server is loopback-only and dev-facing, so PATH resolution is sufficient.)"""
    return shutil.which(AGENT_BIN)


def agent_available():
    """True if the agent CLI is present and answers --version."""
    binpath = resolve_agent_bin()
    if not binpath:
        return {"available": False, "version": None, "bin": AGENT_BIN}
    try:
        out = subprocess.run([binpath, "--version"], capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return {"available": False, "version": None, "bin": AGENT_BIN}
    m = re.search(r"\d+\.\d+(?:\.\d+)?", _strip_chrome(out.stdout))
    return {"available": bool(m), "version": m.group(0) if m else None, "bin": AGENT_BIN}


def run_completion(system, messages, call_type="chat", timeout=None):
    """Run one completion through `claude -p`. Returns a dict shaped for the
    channel response: {ok, reply, model, stats} or {ok:false, error}."""
    binpath = resolve_agent_bin()
    if not binpath:
        return {"ok": False, "error": f"agent binary not found: {AGENT_BIN}"}
    if timeout is None:
        timeout = CREATE_TIMEOUT if call_type == "create" else DEFAULT_TIMEOUT
    prompt = serialise_messages(messages)
    try:
        proc = subprocess.run(
            [binpath] + _claude_args(system),
            input=prompt, capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"{AGENT_BIN} timed out after {timeout}s"}
    except OSError as e:
        return {"ok": False, "error": f"{AGENT_BIN} failed to start: {e}"}
    if proc.returncode != 0:
        err = (proc.stderr or "").strip() or f"exit {proc.returncode}"
        return {"ok": False, "error": f"{AGENT_BIN} failed: {err[:400]}"}
    parsed = _parse_claude(proc.stdout)
    return {"ok": True, "reply": parsed["reply"], "model": parsed["model"], "stats": parsed["stats"]}


# ── Loopback channel server ────────────────────────────────────────────────
# Speaks the protocol part-engine.jsx already uses in local mode:
#   POST /action  {action:"complete", system, messages, temperature, max_tokens,
#                  _callType}  ->  {ok:true, reply:"..."}
#   GET  /health  -> {ok:true}
#   GET  /events  -> keep-alive SSE (the frontend only opens this to recover a
#                    LATE reply after a timeout; we answer /action synchronously,
#                    so this just stays open and never has to push one).

class _ChannelHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # quiet — the server prints its own lines
        pass

    def _cors(self):
        origin = self.headers.get("Origin")
        # Loopback-only server; echo the caller's origin (a serve.py page on
        # another localhost port, or a file:// harness whose origin is "null").
        self.send_header("Access-Control-Allow-Origin", origin or "*")
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "agent": AGENT_BIN})
        elif self.path == "/events":
            self._serve_events()
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def _serve_events(self):
        # Minimal keep-alive SSE. We always answer /action synchronously, so no
        # "reply" event is ever pushed here; this endpoint exists only so the
        # frontend's EventSource (late-reply recovery) connects cleanly instead
        # of erroring/reconnecting in a loop.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(b": vela channel\n\n")
            self.wfile.flush()
            stop = getattr(self.server, "_stop_event", None)
            while not (stop and stop.is_set()):
                if stop and stop.wait(15):
                    break
                self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def do_POST(self):
        if self.path != "/action":
            self._json(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > 16 * 1024 * 1024:
            self._json(413, {"ok": False, "error": "payload too large"})
            return
        try:
            req = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, TypeError):
            self._json(400, {"ok": False, "error": "bad json"})
            return
        action = req.get("action", "complete")
        if action != "complete":
            self._json(400, {"ok": False, "error": f"unknown action: {action}"})
            return
        result = run_completion(
            req.get("system", ""), req.get("messages", []),
            call_type=req.get("_callType", "chat"),
        )
        self._json(200 if result.get("ok") else 500, result)


def make_channel_server(port=8787, host="127.0.0.1"):
    """Build (but do not start) the loopback channel server. Returns the server;
    read the actual port from `server.server_address[1]` (pass 0 for ephemeral)."""
    httpd = ThreadingHTTPServer((host, port), _ChannelHandler)
    httpd.daemon_threads = True
    httpd._stop_event = threading.Event()
    return httpd


def start_channel_server(port=8787, host="127.0.0.1"):
    """Start the channel server in a daemon thread. Returns (server, thread)."""
    httpd = make_channel_server(port, host)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, thread


def stop_channel_server(httpd):
    """Signal any open SSE stream to close, then shut the server down."""
    try:
        httpd._stop_event.set()
    except AttributeError:
        pass
    httpd.shutdown()
    httpd.server_close()


# ── CLI ─────────────────────────────────────────────────────────────────────
def _cli(argv):
    cmd = argv[0] if argv else ""
    if cmd == "check":
        info = agent_available()
        print(json.dumps(info))
        return 0 if info["available"] else 1
    if cmd == "complete":
        try:
            payload = json.loads(sys.stdin.read() or "{}")
        except ValueError as e:
            print(json.dumps({"ok": False, "error": f"bad json: {e}"}))
            return 1
        result = run_completion(
            payload.get("system", ""), payload.get("messages", []),
            call_type=payload.get("_callType", "chat"),
        )
        print(json.dumps(result))
        return 0 if result.get("ok") else 1
    if cmd == "serve":
        port = 8787
        host = "127.0.0.1"
        if "--port" in argv:
            port = int(argv[argv.index("--port") + 1])
        if "--host" in argv:
            host = argv[argv.index("--host") + 1]
        httpd = make_channel_server(port, host)
        actual = httpd.server_address[1]
        info = agent_available()
        status = f"{info['bin']} {info['version']}" if info["available"] else f"{info['bin']} NOT FOUND"
        print(f"⛵ Vela AI channel on http://{host}:{actual}  (agent: {status})", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping channel...")
        finally:
            stop_channel_server(httpd)
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
