# Sprint "palisade" — plan (2026-08-08)

Branch: `claude/harden-deck-data-ingress-7uoi4p` (base: `ux-updates-15`, PR #115 = ux-updates-15 → main).
Constraint: no pushes until full gate green; no functionality regressions; sub-agents on opus/sonnet only.

## Original prompt (verbatim)

> we need to super harden according to this plan, open pr is #115
> dont commit until everything is passing, ensure no functionality is affected
> use .hyper sprint, you are the orchestrator and accountable, dont use fable for sub agents, too expensive

Followed by the 7-phase hardening plan:
- **Phase 1** — Deck-data ingress allowlist (SAFE_SLIDE_KEYS / SAFE_BLOCK_KEYS, `_`-prefix reserved namespace, numeric clamps at ingress + sink, recursion depth cap ≤4, register `imageCols` in validate.py / block-schema.md / compact+turbo maps)
- **Phase 2** — CSS sink: `cssColor()`-gate `--vera-accent`, `@property` type registration, keep `var()` fallbacks, SECURITY.md posture update
- **Phase 3** — Desktop shell (deck-io.js): read-back save verification (tri-state), exact-text echo guard, bounded watcher reads (5MB cap, stat-before-read), single audited FS entry point, basename-only renderer payload, no-arg flushNow, WATCHER_IGNORE_MS back to 400ms, storage-shim error-message-only logging
- **Phase 4** — Strip test hooks from production bundle (`__velaTestHooks` gated object, build-time strip in concat.py, battery updated)
- **Phase 5** — Script-context injection parity (replacer-function marker substitution, U+2028/2029 escapes, one shared `escapeForScriptContext()`, audit other replaces)
- **Phase 6** — CI: key-drift lint (6.1), no-`__velaTest`-in-release assertion (6.2), escape-parity assertion (6.3), wired into ci.yml (6.4)
- **Phase 7** — Docs (SECURITY.md, block-schema.md), VELA_VERSION → 13.22, changelog, SKILL.md sync

## Baseline (readiness, measured)

- `python3 tests/test_vela.py`: **430 passed, 0 failed**
- All 22 `tests/*.cjs` Node suites: **green** (jsdom 30.0.1 provisioned via `npm ci --ignore-scripts`)
- `concat.py`: template in sync
- VELA_VERSION: 13.21

## Clusters (file-disjoint where possible; parallel worktrees)

| Cluster | Plan phases | Model | Files owned |
|---|---|---|---|
| A | 1 + 6.1 | opus | part-imports.jsx (sanitizer region), part-blocks.jsx, validate.py, block-schema.md, lint.py, test_reducer.cjs, part-test.jsx |
| B | 2 | sonnet | part-slides.jsx:2369, part-imports.jsx (getCss region), docs/SECURITY.md (§custom props), test_css_exfil.cjs |
| C | 3 | opus | deck-io.js, storage-shim.js, nl-boot.js (flushNow region), part-app.jsx (watcher-consumer region), test_deck_io_save.cjs |
| D | 4 | opus | part-app.jsx (hook region), part-uitest.jsx, concat.py, vela-drive.js (test-mode init) |
| E | 5 | sonnet | nl-boot.js (STARTUP_PATCH region), render-offline.js (both copies), new shared escape module, test_vela.py additions |
| F | 6.2–6.4 | sonnet | ci.yml, lint.py assertions (after A, D, E merge) |
| G | 7 | sonnet | SECURITY.md, block-schema.md final pass, VELA_VERSION/CHANGELOG, SKILL.md (after all merges) |

Version bump centralized in G (avoids merge conflicts on the same lines).
Regenerated `skills/vela-slides/app/vela.jsx` conflicts resolved by re-running concat.py at each merge.

## Waves

1. Readiness browser smoke (burst-bug-hunter harness) ∥ A ∥ B ∥ C ∥ D ∥ E (parallel worktrees)
2. Sequential merges, full suite green between each; then F
3. G (docs + version); full local gate (python + all .cjs + UI battery headless)
4. Blind gate: 3 blind opus verifiers (ingress+CSS / desktop-shell+injection / hooks+CI) + 1 broad opus hunter via burst-bug-hunter engine w/ enforced deadline; any in-scope finding → fix → fresh round
5. Report + archive; then per-phase commits + push (only after everything green)

## Stop rule

Blind round (engine-enforced ≥3 min hunt) surfaces zero in-scope defects + all 7 phases confirmed present + Markdown sprint report with frame-checked screenshots. Recorded demo deck: skipped (cost; changes are non-visual hardening) — noted for user.
