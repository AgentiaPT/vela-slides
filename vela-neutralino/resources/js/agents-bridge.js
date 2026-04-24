// Agents bridge: routes Vera's callClaudeAPI() calls to a local CLI coding
// agent instead of the Anthropic API. PR3 ships with one adapter — Claude
// Code in `--print` mode — wired behind a pluggable `AgentBackend`
// interface so Copilot CLI and Codex CLI can be added as separate files
// without touching this module or the monolith.
//
// Contract (mirrors vela-channel's /action payload so the monolith's
// existing channel branch shape is reused):
//   send({ system, messages, temperature, max_tokens, _callType })
//     → Promise<{ text, request_id, stats? }>
//
// Each call spawns a fresh subprocess (stateless). Vera's ReAct loop keeps
// multi-turn state in the React tree, so we don't need to maintain a CLI
// session between calls.

// ---------------------------------------------------------------------------
// Prompt serialisation
// ---------------------------------------------------------------------------
//
// CLI agents accept a single prompt string, not an Anthropic-format messages
// array. We collapse {system, messages} into a role-tagged transcript the
// underlying Claude model can read. The format is deliberately plain ASCII
// so it survives shell / stdin encoding on Windows and WSL alike.

function serialiseConversation(system, messages) {
  const parts = [];
  if (system) parts.push(`<SYSTEM>\n${system}\n</SYSTEM>`);
  for (const m of messages || []) {
    const role = (m.role || "user").toUpperCase();
    const content = typeof m.content === "string"
      ? m.content
      : JSON.stringify(m.content);
    parts.push(`<${role}>\n${content}\n</${role}>`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Process helper
// ---------------------------------------------------------------------------
//
// Neutralino exposes a one-shot subprocess API. spawnProcess returns a pid
// and future stdOut/stdErr/exit events arrive via `spawnedProcess`. We wrap
// that into a Promise so callers get a clean async/await.

async function runProcess(cmdLine, stdinText, { timeoutMs = 120000 } = {}) {
  const started = performance.now();
  const proc = await Neutralino.os.spawnProcess(cmdLine);
  let out = "", err = "", exitCode = null, timedOut = false;

  const done = new Promise((resolve) => {
    const handler = (evt) => {
      const d = evt && evt.detail;
      if (!d || d.id !== proc.id) return;
      if (d.action === "stdOut") out += d.data;
      else if (d.action === "stdErr") err += d.data;
      else if (d.action === "exit") {
        exitCode = Number(d.data);
        Neutralino.events.off("spawnedProcess", handler);
        resolve();
      }
    };
    Neutralino.events.on("spawnedProcess", handler);
  });

  if (stdinText != null) {
    await Neutralino.os.updateSpawnedProcess(proc.id, "stdIn", stdinText);
    await Neutralino.os.updateSpawnedProcess(proc.id, "stdInEnd");
  }

  const timer = setTimeout(async () => {
    timedOut = true;
    try { await Neutralino.os.updateSpawnedProcess(proc.id, "exit"); } catch {}
  }, timeoutMs);

  await done;
  clearTimeout(timer);

  return {
    stdout: out,
    stderr: err,
    exitCode,
    timedOut,
    elapsedMs: Math.round(performance.now() - started),
  };
}

// ---------------------------------------------------------------------------
// ClaudeCodeBackend
// ---------------------------------------------------------------------------
//
// Invokes `claude -p` (print mode) with the conversation on stdin and
// `--output-format json` for a single structured response envelope we can
// parse deterministically. Filesystem / bash tools are explicitly disabled
// so Claude Code plays the Claude-chat role Vera expects and doesn't
// wander off to read files. `--dangerously-skip-permissions` is required
// for fully non-interactive runs (no approval prompts).
//
// availability check: `claude --version` with a short timeout. Returns
// true iff exit code is 0.

class ClaudeCodeBackend {
  constructor() {
    this.id = "claude-code";
    this.label = "Claude Code";
    this._avail = null; // cached tri-state: null=unknown, true/false=known
    this._version = null; // captured from `claude --version`
    this._lastModel = null; // populated after the first successful send()
  }

  info() {
    return {
      id: this.id,
      label: this.label,
      available: !!this._avail,
      version: this._version,
      model: this._lastModel,
    };
  }

  async available({ refresh = false } = {}) {
    if (this._avail != null && !refresh) return this._avail;
    try {
      const r = await runProcess("claude --version", null, { timeoutMs: 10000 });
      this._avail = r.exitCode === 0 && /\d+\.\d+/.test(r.stdout);
      if (this._avail) {
        const m = r.stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
        this._version = m ? m[1] : null;
      }
    } catch {
      this._avail = false;
    }
    return this._avail;
  }

  async send({ system, messages, temperature, max_tokens, _callType }) {
    const prompt = serialiseConversation(system, messages);
    const args = [
      "claude",
      "-p",
      "--output-format", "json",
      "--dangerously-skip-permissions",
      // Disable all filesystem/shell/web tools so Claude Code behaves as a
      // pure chat completion endpoint. Vera expects a plain text (often
      // JSON-with-tool_calls) reply and drives its own tool loop.
      "--disallowed-tools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task",
    ];
    const cmd = args.join(" ");

    const timeoutMs = Math.max(30000, _callType === "create" ? 300000 : 180000);
    const r = await runProcess(cmd, prompt, { timeoutMs });

    if (r.timedOut) {
      throw new Error(`claude -p timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    if (r.exitCode !== 0) {
      throw new Error(
        `claude -p exited ${r.exitCode}: ${r.stderr.slice(0, 400) || r.stdout.slice(0, 400)}`
      );
    }

    // The json envelope looks like:
    //   { type: "result", subtype: "success", result: "…assistant text…",
    //     session_id, total_cost_usd, usage: {...}, ... }
    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      // Fallback — treat stdout as raw text (some older builds print plain).
      parsed = { result: r.stdout };
    }
    const text = parsed.result != null ? String(parsed.result) : "";
    if (parsed.model) this._lastModel = parsed.model;

    return {
      text,
      request_id: parsed.session_id || `cc-${Date.now()}`,
      stats: {
        model: parsed.model || "claude-code",
        duration_ms: r.elapsedMs,
        input_tokens: parsed.usage?.input_tokens || 0,
        output_tokens: parsed.usage?.output_tokens || 0,
        cache_read_tokens: parsed.usage?.cache_read_input_tokens || 0,
        cache_create_tokens: parsed.usage?.cache_creation_input_tokens || 0,
        cost_usd: parsed.total_cost_usd || 0,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Registry + public API
// ---------------------------------------------------------------------------

const backends = {
  "claude-code": new ClaudeCodeBackend(),
  // Future: copilot-cli, codex-cli, mcp-channel.
};

let active = backends["claude-code"];

export const agents = {
  list() { return Object.values(backends).map((b) => ({ id: b.id, label: b.label })); },
  active() { return active; },
  info() { return active.info ? active.info() : { id: active.id, label: active.label }; },
  pick(id) {
    if (!backends[id]) throw new Error(`unknown backend: ${id}`);
    active = backends[id];
  },
  async available() { return active.available({ refresh: false }); },
  async refreshAvailability() { return active.available({ refresh: true }); },
  async send(payload) { return active.send(payload); },
};
