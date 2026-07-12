# Coverage-Gap Report — AI Engine (Vera) + Local Server + Desktop/Go Gatekeeper

Slice owner scope:
- `src/parts/part-engine.jsx` — the Vera AI engine (ReAct loop, 22 tool handlers, API transport, cost tracking).
- `tools/vela-dev/scripts/serve.py` + `tools/vela-dev/scripts/agent_backend.py` — local preview server and the `--ai` loopback channel.
- `vela-neutralino/extensions/agent/main.go` (+ siblings) — the desktop gatekeeper security contract.

Tests cross-referenced: `tests/test_serve.py`, `tests/test_desktop.py`, `vela-neutralino/extensions/agent/main_test.go`, plus `tests/test_image_preserve.cjs` (run via `tests/test_vela.py`).

---

## 1. Stack execution results (actual runs, this checkout)

All three CI commands for this slice are **GREEN**. Counts below are from live runs.

| Command | Result | Tests | Failures | Skips |
|---|---|---|---|---|
| `python3 -m unittest tests.test_serve -v` | **OK** | **121** | 0 | 0 |
| `python3 -m unittest tests.test_desktop -v` | **OK** | **28** | 0 | 0 |
| `cd vela-neutralino/extensions/agent && go test -v ./...` | **PASS** | **20** top-level funcs (`ok vela-agent 0.018s`) | 0 | 0 |

Notes:
- `test_serve` ran in 11.1s. The one POSIX-gated test (`test_resolve_agent_bin_rejects_world_writable`) executed (Linux), so **no skips** this run. On a non-POSIX host it would report 1 skip.
- Benign stderr noise printed by tests but asserted as handled: `[save] Error: Expecting value...` (malformed/negative Content-Length tests) and `[sync] ... no longer resolves inside the folder — skipping` (watcher-containment test). These are expected, not failures.
- `TestBackendParity` (Go↔Python lockdown parity) passed and did **not** skip — the Go source is present in this checkout.

**CI wiring confirmed** (`.github/workflows/ci.yml`): CI runs `test_vela.py --unit`, `--integration`, `test_serve`, `test_desktop`, and `go test -v ./...`. CI does **NOT** run the browser UI battery (`__velaRunUITests()` / `vela-drive.js uitests`) nor the `vela-drive.js ai` harness mode. This is the crux of the engine gap below.

---

## 2. AI engine tool coverage matrix

The 22 Vera tools are **not** JSON-schema objects — they are a prose list in the system prompt (`part-engine.jsx:478-501`) and dispatched by a single `switch (name)` in `executeTool()` (`part-engine.jsx:183-437`). Because `part-engine.jsx` is browser-only JSX, **no CI test executes `executeTool` or any tool handler.** The only automated exercise of these tools is the in-app UI battery (`part-uitest.jsx`), which is **not run in CI** and whose tool tests are `requiresAI:true` (they degrade to a *skip* when AI is unavailable — `part-uitest.jsx:90-96`).

Legend: ✅ real behavior asserted in CI · 🟡 partial / indirect / non-CI only · ❌ no automated test of the handler.

| # | Tool | Handler line | Automated test? | Where | Notes |
|---|------|-----|------|-------|-------|
| 1 | `add_lane` | 201 | ❌ | — | dup-lane guard, insert logic untested in CI |
| 2 | `add_item` | 206 | ❌ | — | importance defaulting untested |
| 3 | `batch_add_items` | 212 | ❌ | — | batch loop untested |
| 4 | `remove_item` | 219 | ❌ | — | fuzzy `findItem` match untested |
| 5 | `remove_lane` | 220 | ❌ | — | cascade item-count message untested |
| 6 | `rename_item` | 221 | ❌ | — | |
| 7 | `rename_lane` | 222 | ❌ | — | |
| 8 | `move_item` | 223 | ❌ | — | cross-lane move + missing-target path untested |
| 9 | `update_status` | 224 | ❌ | — | `signed-off` → `signedOffAt` timestamp untested |
| 10 | `set_importance` | 225 | ❌ | — | |
| 11 | `set_slides` | 226 | ❌ | — | jump-link return shape untested |
| 12 | `add_slide` | 227 | ❌ | — | |
| 13 | `edit_slide` | 228 | 🟡 | `test_image_preserve.cjs` (indirect) | The `edit_slide` merge path calls `preserveImages`/`restoreKeepOriginal`; **those two helpers are unit-tested** (see §5) but the `edit_slide` case dispatch, block-count merge-vs-replace branch, and patch semantics are **not** exercised. |
| 14 | `add_image_to_slide` | 277 | ❌ | — | attached-image indexing untested |
| 15 | `clear_all` | 285 | ❌ | — | |
| 16 | `set_branding` | 286 | ❌ | — | field allowlist / merge untested |
| 17 | `find_slides` | 294 | ❌ | — | query + block_type + property_missing filters untested |
| 18 | `find_replace` | 344 | ❌ | — | case-insensitive scope (`all`/`module:`/`lane:`) untested |
| 19 | `deck_stats` | 361 | 🟡 | `part-uitest.jsx:756` (`requiresAI`, non-CI, skipped w/o AI) | Only reachable via live AI harness; never runs in CI. |
| 20 | `batch_restyle` | 401 | ❌ | — | scope resolution + `block_patch` targeting untested |
| 21 | `list_comments` | 419 | ❌ | — | status filter / comment collection untested |
| 22 | `resolve_comment` | 431 | ❌ | — | id lookup untested |

**Engine functions beyond the tool switch — also uncovered in CI:**

| Function | Line | Test? | Notes |
|---|---|---|---|
| `callClaudeAPI()` (transport: desktop `__velaAgentSend`, channel, artifact API; timeout/abort; stats) | 17 | ❌ | 3 transport branches + trust-gate deny path all untested |
| `callVera()` ReAct loop (12-iter, tool caps `MAX_TOOLS_PER_TURN=16`, `MAX_TOTAL_TOOLS=40`, `MAX_MESSAGES_BYTES`, history dedup/alternation, jump dedup) | 1032 | ❌ | **Biggest gap — see §5.** The cost-amplification caps (labeled `SECURITY (H5)`) have no regression test. |
| `callVeraStep()` / `parseJSONResponse()` | 980 / 91 | ❌ | JSON-in-fence extraction, null fallback untested |
| `setupLateReplyRecovery()` (SSE late-reply, executes tool_calls off-loop) | 988 | ❌ | Re-runs `executeTool` on SSE payload; entirely untested |
| `callVeraTeacher()` (streaming SSE parse, `---QUESTIONS---` split) | 628 | 🟡 | UI test `requiresAI` only; streaming parser untested in CI |
| `generateAiSlide()` (JSON extraction + `sanitizeSlide`) | 1180 | ❌ | fence-strip + regex-recover fallback untested |
| `callSlideDesignAPI()` improve/variants + `restoreImageSrcs` | 727 / 97 | 🟡 | `restoreImageSrcs` **is** unit-tested (§5); the API wrapper is not |
| `stripImageSrcs` / `replacePastedImage` | 155 / 173 | ❌ | image placeholder round-trip untested (only `preserveImages`/`restoreImageSrcs` covered) |
| `velaSessionStats` cost tracking | 37/60/76… | ❌ | token accounting / model attribution untested |

**Bottom line:** Of 22 engine tools, **0 have direct CI coverage**; 1 (`edit_slide`) is partially protected via its image-helpers, 1 (`deck_stats`) is touched only by a non-CI AI harness test. The entire ReAct orchestration and API transport layer is **CI-untested**.

---

## 3. Server endpoint coverage matrix (`serve.py` + `agent_backend.py`)

`serve.py` routes (`_route_folder_get` @514, `_route_folder_post` @529). The `--ai` channel is a **separate** loopback server built by `agent_backend.make_channel_server` (not a serve.py route).

| Route / feature | serve.py loc | Covered? | Representative test(s) | Gaps |
|---|---|---|---|---|
| `GET /` and `/index.html` (browser HTML) | 514 | ✅ | `test_root_returns_html`, `test_root_via_index_html`, `test_root_content_type` | — |
| `GET /api/decks` (listing + metadata) | 517 | ✅ | `test_api_decks_returns_json`, `_metadata_fields`, `_ignores_non_vela`, `_no_absolute_path`, `test_empty_folder_api_decks` | — |
| `GET /deck/<name>` (serve app w/ deck) | 519 | ✅ | `test_serve_deck_returns_html`, `_not_found_404`, `_url_encoded_name` | — |
| `GET /poll/<name>` (long-poll versioning) | 521 | ✅ | `test_poll_*` (immediate, deck-update, reload, multi-client, concurrent) | — |
| `POST /save/<name>` (deck write-back) | 530 | ✅ | `test_save_valid_deck_ok`, `_writes_to_disk`, `_invalid_json_400`, `_without_lanes_not_written`, `_non_dict_not_written`, `_wrong_type_ignored` | — |
| Static files | 523 | 🟡 | reached via `test_root`/headers | no direct per-asset content-type assertion beyond html/json |
| Host header / DNS-rebinding guard (`_check_host`) | 496 | ✅ | `TestSecurity` host suite (localhost/127/IPv6 allowed; foreign/empty/missing/rebind rejected) | — |
| Auth gate (`_check_auth`) | 498/505 | 🟡 | exercised via `no_auth=True` fixtures; **the token-required path is not directly asserted for serve.py** (channel token IS, see below) | serve.py's own `_channel_token`/auth token acceptance/rejection not directly tested |
| Origin/CSRF gate (`_check_origin`) | 507 | ✅ | `TestOriginCsrf` (same-origin ok; diff-port, foreign, text/plain rejected; rejected save leaves file untouched) | — |
| Path traversal / name validation (`_validate_deck_name`) | — | ✅ | `TestSecurity` (dotdot, slash, backslash, %2e/%252e, unicode-slash, RTLO/bidi, unit test) | — |
| Symlink containment | — | ✅ | `test_symlink_outside_folder`, `_to_valid_json_outside_folder_blocked`, `test_watcher_reread_enforces_folder_containment` | — |
| Content-Length hardening | 675 | ✅ | `test_save_oversized_413`, `_malformed_content_length`, `_negative_content_length` | — |
| Security headers / cache / content-types | 826 | ✅ | `TestContentTypes` (headers present, no-cache dynamic, json ctype) | — |
| HTML generation / XSS escaping | 855 | ✅ | `test_prepare_html_*` (deck embed, `</script>` escape, jsx-body neutralize, no placeholders, bare-slides/vela-export normalize) | — |
| Deck version tracker | 153 | ✅ | `TestDeckVersionTracker` (7 tests: bump, reload flag, wait/timeout, concurrent) | — |
| File watcher | 234 | ✅ | `TestFileWatcher` (detect, ignore-next, no-change, stop, multi-change) | — |
| **AI channel wiring in server** | — | ✅ | `TestServeChannelIntegration` (off-by-default, disabled@port0, start/stop, health) + `test_prepare_html_channel_port_injected_when_ai_enabled` / `_ai_off_by_default` | — |
| Channel `POST /action` (`agent_backend`) | — | ✅ | `TestAgentBackendChannel.test_action_complete`, `_unknown_action`, `_unknown_path_404` | run_completion is **stubbed** — no real agent spawn asserted end-to-end |
| Channel `GET /health` | — | ✅ | `test_health`, `test_health_open_without_token` | — |
| Channel CORS/preflight/Origin/Host guards | — | ✅ | `test_cors_allows_loopback_origin`, `_options_preflight`, `_forbidden_origin_rejected`, `_origin_prefix_bypass_rejected`, `_forbidden_host_rejected`, `_make_channel_server_forces_loopback` | — |
| Channel token gate | — | ✅ | `TestAgentBackendChannelToken` (missing/wrong→401, correct→200, health open) | — |
| `agent_backend` prompt/arg/parse | — | ✅ | `TestAgentBackendSerialisation` (serialise, `_claude_args` lockdown, system-by-file, canonical-origin CRLF block, missing-binary, world-writable reject, parse json/ansi) | — |
| **`/events` SSE endpoint** (late-reply channel) | — | ❌ | none | `part-engine.jsx:992` opens `EventSource(.../events)`; no test covers the channel's SSE emit path |
| `--ai` end-to-end vs real `claude` (harness `ai` mode) | — | ❌ (by design) | not in CI | `vela-drive.js ai` exists but is **never run in CI** |

Server-side coverage is **strong** (121 tests). The residual server gaps are the `/events` SSE path and serve.py's own auth-token acceptance path.

---

## 4. Gatekeeper coverage (Go `main.go` + desktop invariants)

### Go unit tests (`main_test.go`, 20 funcs — run in CI via `go test`)

| Invariant / function | Go test | Status |
|---|---|---|
| Provider allowlist (`providerAllowed`) | `TestProviderAllowlist` | ✅ |
| `claude` launched with all tools disabled (`--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, no bypass flags) | `TestSendArgsClaudeDisablesAllTools` | ✅ |
| `copilot` denies every tool | `TestSendArgsCopilotDeniesEveryTool` | ✅ |
| Agent binary resolution: reject missing / require absolute / reject world-writable | `TestResolveAgentBin{RejectsMissing,Absolute,RejectsWorldWritable}` | ✅ |
| Conversation serialisation | `TestSerialiseConversation` | ✅ |
| Output parsing + chrome/ANSI strip | `TestParseClaudeAndStripChrome` | ✅ |
| Port parse, token compare (constant-time) | `TestParsePort`, `TestTokensMatch` | ✅ |
| HTTP server auth + routing | `TestServerAuthAndRouting` | ✅ |
| Origin allow logic | `TestAllowedOrigin` | ✅ |
| Provider detection | `TestDetectProvider` | ✅ |
| Subprocess exec: binary-not-found, real subprocess, timeout | `TestExecAgent{BinaryNotFound,RealSubprocess,Timeout}` | ✅ |
| JSON writer, vela dir, nlPort handshake (valid/malformed) | `TestWriteJSON`, `TestVelaDir`, `TestReadNlPort{ValidHandshake,MalformedHandshake}` | ✅ |

### Desktop source-invariant tests (`test_desktop.py`, 28 — run in CI)

Covered: neutralino config (no `os.spawnProcess`/`os.*`/`*` in allowlist; node-free compiled extension; `extensions.dispatch/broadcast` not granted); gatekeeper invariants (all tools disabled, loopback-only bind, CORS origin-pinned not wildcard, token auth present, binary allowlist is exactly two, no shell invocation, absolute binary path, early-stdin-close ignored, self-terminate on parent exit, reap child tree on shutdown, handshake keyed by nlPort suffix); proc-tree reaper (unix kills process group, rejects world-writable binary, windows job-object kill-on-close / binary-trust / app-ancestor watch); trust gate (confirm once per session, persisted trust still prompts, multi-provider picker wired); agents-bridge (401 resets handshake, prefers window nlPort suffix, send routes through active provider only); webview-never-spawns (no spawn in bridge/boot); AI-availability event-name contract parity.

### Cross-backend parity (`test_serve.py::TestBackendParity`, run in CI)

✅ Go and Python launch the **same** locked-down `claude` (matching `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`); neither weakens the sandbox (no `--dangerously-skip-permissions`/`--disallowed-tools`/`--allow-all-tools`/`--allow-tool`); both deliver Vera's prompt as the authoritative system prompt (Python by file, Go by argv). This is the anti-drift lock the CLAUDE.md references.

### Gatekeeper gaps

- 🟡 **`execAgent` runtime behavior with a real provider** is only smoke-tested (`TestExecAgentRealSubprocess` uses a stand-in). The actual parse of a real `claude`/`copilot` envelope is unit-tested against fixtures, not a live binary — acceptable, but the *live* contract is unverified in CI (expected).
- 🟡 Windows-specific reaper paths are asserted by **source inspection** (`test_desktop.py` greps for the job-object / kill-on-close code), not executed — reasonable given CI is Linux, but a logic regression that keeps the string would pass.
- ❌ The `agents-bridge.js` / `nl-boot.js` / `trust.js` webview JS is validated only by regex source-invariants, never executed.

---

## 5. Detailed gaps (ranked)

### G1 — [STRUCTURAL, HIGHEST] Vera ReAct loop + all 22 tool handlers have zero CI execution
`part-engine.jsx:183` (`executeTool`) and `part-engine.jsx:1032`/loop-body `:1093` (`callVera`). None of the 22 tool handlers, and none of the loop's control logic, run in any CI test. This is the single largest coverage hole in the slice.

What a test should assert (all pure-function, no network needed — `executeTool(name, input, ws, [])` mutates a plain `ws={lanes,branding}` and returns a string or `{text, jump}`):
- Each tool's happy path + not-found path (`Item "X" not found.`, `Lane "X" not found.`, dup-lane guard @202).
- `find_replace` @344 scope resolution (`all` / `module:Name` / `lane:Name`) and case-insensitivity; and that it returns jump links (the prompt warns callers not to follow it with `set_slides`).
- `batch_restyle` @401 scope + `block_patch` type-targeting; in-place mutation.
- `find_slides` @294 combined filters (`query`+`block_type`, `property_missing`).
- `deck_stats` @361 aggregation (slide count, total time, block distribution, quality issues).
- `edit_slide` @228 block-count merge-vs-replace branch and patch merge semantics.
- **Security caps (labeled `SECURITY (H5)` in source):** `MAX_TOOLS_PER_TURN=16` truncation (`:1101`), `MAX_TOTAL_TOOLS=40` stop (`:1109`), `MAX_MESSAGES_BYTES` bound (`:1146`). These are anti-cost-amplification guards against prompt injection and currently have **no regression test** — a refactor could silently raise/remove a cap. This is the highest-value security assertion to add.

Feasibility: **high / quick win.** A Node harness identical in shape to the existing `tests/test_image_preserve.cjs` (which already `eval`-extracts functions out of `part-engine.jsx`) could extract `executeTool` + its helpers and drive all 22 tools against fixture decks — no browser, no AI, CI-friendly. This is the recommended fix.

### G2 — [HIGH] API transport layer (`callClaudeAPI` @17) untested
Three transport branches — desktop `window.__velaAgentSend` (@23, incl. `__velaTrustGate` **deny** path @29), local channel (@51), artifact API (@67) — plus abort/timeout handling and `velaSessionStats` accounting. None executed. The trust-gate deny path (throws "AI is disabled for this deck") is a security-relevant behavior with no test. Feasibility: medium (needs fetch/`window` stubs).

### G3 — [MEDIUM] SSE late-reply recovery (`setupLateReplyRecovery` @988) untested — and it re-runs `executeTool`
On channel timeout, an `EventSource` to `/events` (@992) receives a late reply and **executes tool_calls off the main loop** (@1012-1024) — a second, unguarded path into `executeTool` (the per-turn/total caps in G1 are **not** applied here). No test covers it, and the corresponding server `/events` SSE emit path is also untested (§3). A test should assert late-reply tool execution mutates the deck and that malformed SSE payloads are ignored (`catch {}` @1026).

### G4 — [MEDIUM] JSON response parsing / slide extraction untested
`parseJSONResponse` @91 (fenced-JSON strip + brace-extraction fallback + null on failure) and `generateAiSlide` @1180 (fence strip, regex-recover fallback, `sanitizeSlide`). These parse untrusted model output — malformed-input robustness is exactly what a unit test should pin. Quick win (pure functions).

### G5 — [MEDIUM] Vera chat history normalization untested
`callVera` @1053-1083: undo/redo marker truncation, last-10-turn window, consecutive same-role merge, leading-assistant drop, trailing-user drop (API alternation requirement). Subtle logic that breaks the API contract if wrong; no test.

### G6 — [LOW] Streaming parsers untested
`callVeraTeacher` @662-698 (SSE `content_block_delta` accumulation, usage capture, `---QUESTIONS---` split) and the teacher channel branch. UI-test only, `requiresAI`, non-CI.

### G7 — [LOW] serve.py auth-token acceptance path
serve.py fixtures use `no_auth=True`; the server's own token-required accept/reject path (distinct from the channel token, which IS tested) is not directly asserted.

### G8 — [LOW] Windows reaper + webview JS are source-grep-only
`test_desktop.py` validates Windows job-object/reaper logic and `agents-bridge.js`/`trust.js`/`nl-boot.js` by regex, not execution. Acceptable for a Linux CI, but a logic bug that preserves the matched string would pass.

---

## 6. Quick wins vs deep gaps

**Quick wins (pure functions, no network/browser, model existing `test_image_preserve.cjs`):**
1. **G1 — Node harness extracting `executeTool` + helpers**, driving all 22 tools + the `SECURITY (H5)` caps against fixture decks. Highest value, low effort, closes the biggest hole. *(Do this first.)*
2. **G4 — `parseJSONResponse` / `generateAiSlide` extraction tests** for malformed model output.
3. **G3 — late-reply tool-execution + malformed-SSE-payload** assertions (reuse the G1 harness; note the caps gap).

**Deep gaps (need stubs / harness that CI doesn't currently run):**
1. **G2 — `callClaudeAPI` 3-branch transport + trust-gate deny** (fetch/`window` mocking).
2. **G5 — chat-history normalization** (fixture conversation → expected message array).
3. **Live `--ai` end-to-end** (`vela-drive.js ai`, `/events` SSE) — real `claude` spawn; intentionally out of CI, but the only path that proves the full ReAct loop + channel + gatekeeper together.

**Already well-covered (no action):** serve.py routing/security/CSRF/traversal/versioning/watcher (121 tests), the agent_backend channel + token + lockdown args, the Go gatekeeper subprocess/auth/allowlist, the desktop source-invariants, and the Go↔Python anti-drift parity lock.

---

### One-line takeaway
The **server and gatekeeper layers are thoroughly tested** (169 CI tests, all green), but the **entire Vera AI engine in `part-engine.jsx` — the ReAct loop, all 22 tool handlers, API transport, and the H5 cost-amplification security caps — has effectively no CI-level automated coverage.** The single most valuable addition is a Node extraction harness (modeled on the existing `test_image_preserve.cjs`) that drives `executeTool` and the loop's security caps without a browser or a live model.
