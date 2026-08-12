# Sprint "sigil" — plan (2026-08-12)

## Original request (verbatim summary of the change request)

> Change Request — Palette resolution fails silently and ships broken decks
> Repo: AgentiaPT/vela-slides · Version observed: skill v13.36, repo @ f39fb57 · Type: Bug (correctness + silent failure) · Severity: High · Filed: 2026-08-12
>
> An LLM-authored compact deck that writes the colour palette as `"C":{"A":"#3B82F6"}` instead of `"C":{"$A":"#3B82F6"}` has its entire palette silently discarded. Every `$A…$Z` reference survives expansion as a literal string (`"color": "$A"`). `deck validate` reports 0 errors, `deck ship` emits a .jsx; the deck renders with invisible headings and invisible icons.
>
> Three defects:
> - **A** — Palette keys silently dropped unless they start with `$` (sigil-sensitive filter in `expand_deck`, `scripts/vela.py`).
> - **B** — Nothing detects unresolved `$X` tokens after expansion (the load-bearing defect).
> - **C** — `validate.py` auto-expands only on `"S"`, never on `"G"` — standalone validation of sectioned compact decks is meaningless.
>
> Proposed changes (§4): 4.1 normalise palette keys (accept both spellings, warn on bare, hard-error on unusable `C`); 4.2 assert no unresolved tokens after expansion (hard error on ship/expand, error entry in validate; `--allow-unresolved` escape hatch); 4.3 validate resolved colours against a permissive CSS grammar (warning only); 4.4 single source of truth for compact detection (`is_compact` shared by both modules); 4.5 docs (SKILL.md, references/formats.md, deck init skeleton).
>
> Acceptance criteria (§5, verbatim — workers/validators receive these):
> 1. `"C":{"A":"#3B82F6"}` resolves identically to `"C":{"$A":"#3B82F6"}`, emitting one warning naming the normalised key.
> 2. `"C":{}` or `C` with only non-string values → hard error, non-zero exit, no .jsx written.
> 3. A deck referencing `$M` with no `$M` in `C` → hard error listing the JSON path of each occurrence.
> 4. `deck ship` never writes an artifact containing a string value equal to `^\$[A-Za-z]{1,2}$` outside `_TEXT_KEYS`, unless `--allow-unresolved` is passed.
> 5. `validate.py <deck>` produces identical slide/block counts for G-form, S-form, turbo and full-format renderings of the same deck.
> 6. Literal `#hex` inside `studyNotes.text`, `markup` and glossary is byte-identical before and after expansion (guards existing invariant test).
> 7. A hand-authored `"$A"`-form deck ships byte-identically to today — zero behaviour change on the happy path.
>
> Tests (§6): test_palette_bare_keys_normalised, test_palette_present_but_empty_errors, test_unresolved_alias_blocks_ship, test_unresolved_alias_allows_prose, test_resolved_colors_grammar, test_validate_expands_G_form, test_is_compact_parity, fixture tests/fixtures/palette-bare-keys.json.
>
> Rollout order (§7): 4.4 + 4.5 first → 4.1 + 4.2 together → 4.3 last. Minor version bump. Changelog: "Palette keys without the $ sigil no longer silently discard the whole palette; unresolved colour aliases now fail the build instead of shipping."
>
> Out of scope (§8): reworking the compact DSL palette syntax; renderer-side fallback for invalid CSS colours.

## Sprint context

- Base: `origin/main` @ `527b94a` (CR observed at `f39fb57`; main has moved — recon re-verified claims at HEAD).
- Sprint branch: `claude/palette-resolution-silent-fail-c67wj9` (reset onto latest main).
- Baseline: 503/503 tests green, `concat.py` clean.
- Surface: **CLI-level** (Python scripts in `skills/vela-slides/scripts/`, docs, tests). No app-code behaviour change; browser render used only for before/after proof shots of the incident symptom.

## Clustering & routing

One cluster — all five proposed changes are interdependent edits to `vela.py` + `validate.py` + docs + tests (same files; splitting would collide). One implementation worker (best model, high effort), working directly on the sprint branch (no parallel worktrees needed for a single cluster).

| Item | Scope | Est. |
|---|---|---|
| W1 | 4.4 compact-detection unification + 4.5 docs + 4.1 palette normalisation + 4.2 unresolved-alias gate + 4.3 colour grammar + all §6 tests + fixture + VELA_VERSION/changelog bump | ~1 worker session |
| Proof | before/after render shots of incident deck (sub-agent) | small |
| Gate | blind validation: 1 per-CR verifier (acceptance §5 verbatim, CLI-driven) + 1 broad adversarial hunter (best model, max effort, blind) | 2 agents |

## Stop rule (agreed with config)

Blind best-model validation round finds zero in-scope defects: all 7 acceptance criteria confirmed by agents that never saw the sprint history, driving the real CLI at HEAD. Proof artifact: this folder's `README.md` sprint report (agentic burndown + before/after screenshots + cost). Recorded demo deck: not requested — Markdown report is the deliverable (config's demo-deck line predates the skill's report default; verify surface here is CLI, not browser).

## What happened vs plan

- Recon confirmed all three defects at HEAD and surfaced two things the CR missed: `deck init` itself documented bare palette keys (live defect-A generator, G-form output), and `dividerColor` doesn't exist while `numberColor`/`titleColor`/`textColor`/`dotColor` do — `_COLOR_KEYS` was corrected accordingly.
- Single-cluster plan held: one implementation worker landed all five changes + 21 tests in one commit (`6394aa4`), all 7 acceptance criteria verified.
- Blind round 1: verifier PASSed everything, but the adversarial hunter found **12 defects** — 7 in-scope hardening gaps in the new code (headline: partial-overlap alias `$AB` bypassing the hard gate via substring substitution), 5 verified pre-existing at base `527b94a` and reported as follow-ups. One fix-round worker (`7b3f169`) + regression tests (suites 534 + 65).
- Blind round 2 (fresh agent): clean — gate closed after 2 rounds (plan assumed 1–2).
- Stop-rule deviation (recorded in report): CLI surface → blind rounds drove the real CLI, not the browser burst engine; proof = Markdown report with browser-rendered before/after shots.
- Cost: $47.11 total, hub $9.74 (21%), 0 images pinned in hub.
