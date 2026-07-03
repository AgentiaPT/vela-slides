# Sprint 2026-07-03-1 · ⭐ Tradewinds

**Theme:** Share & Present — make Vela's output spread.
**Codename:** *Tradewinds* — the steady winds that carried sails across oceans; this
sprint is about carrying Vela decks out into the world.
**Reviewed build:** `VELA_VERSION 12.79` · SKILL.md `12.79`.
**Runner:** coding agents. **CR division:** decided separately — this document is
**scope only**, with no engineer/agent assignment, ownership, or sequencing.

---

## Why this sprint

Goal: convert *"someone found Vela on GitHub"* into *"they starred, shared, and came
back."* Stars for a presentation tool come from three moments this sprint targets —
**share it virally**, **present it professionally**, and **the one-prompt wow demo** —
plus a small **hardening** pass so the repo reads as maintained on first visit.

> **Scope decision — Bring-Your-Own-Key AI is OUT of this sprint** (backlog CR-13).
> Consequence: the *deck-from-source* item runs on the **existing** AI paths only
> (Claude.ai artifact proxy + desktop agent-bridge) — it works in those runtimes but
> **not for a keyless OSS cloner** until CR-13 ships. The demo still drives stars
> regardless of where the viewer can run it. **The in-scope items have no dependency
> between them.**

Each item below carries its intent and a concrete **Verify** condition so it can be
picked up independently. Findings were confirmed against a running build — 🟢 verified
live in a browser, 🟡 observed via screenshot/source.

---

## In scope

### 1 · Share it anywhere — Standalone HTML export + present-mode polish

Productize the existing `render-offline.js` recipe into an in-app
**Export → "Standalone HTML"**: one self-contained `.html` (deck + vendored UMD +
safely-inlined transpiled app) that opens offline anywhere and drops straight onto
GitHub Pages or into an email. Add a toggleable **"Made with Vela ⛵"** footer for an
attribution loop. Note the known trap from the render recipe: never inline the monolith
as `text/babel` (XSS-test strings contain `</script>` and truncate the block) — inline
the *transpiled* app safely.

Bundled defects on the same surface:

- **CR-03 · Edit chrome leaks into Present mode** 🟢 — in the header-less Present state
  the focused block still shows a **dashed selection outline**, **"+" add affordances**,
  and a **pencil/edit icon** (verified: `header` removed, `dashedPlus:3`). This must never
  appear in a shared/presented deck — it *is* the output. *(Caveat: the offline `file://`
  render doesn't engage the real Fullscreen API; confirm in the live artifact — DOM
  evidence is consistent.)*

  ![CR-03 — edit chrome (dashed selection box + "+" affordances) visible in Present mode](img/present-mode-chrome-leak.png)

- **CR-05 · Presenter counter legibility** 🟡 — the bottom-right `01 / 28` in Present
  mode is tiny/low-contrast and collides with a stray "+". Bump size/contrast and
  de-collide.

**Verify:** exported file opens in a fresh, network-less browser; arrows navigate; zero
edit chrome on any slide; counter legible.

### 2 · Present it professionally — Presenter view + editor overview

*Entirely AI-independent — lands cleanly even without CR-13.*

- **CR-08 · Dedicated presenter/speaker view** 🟢 — current slide + next-slide preview +
  speaker notes + elapsed/segment timer. Notes exist in the data model
  (`slide.studyNotes`, the NOTES row) but there is no dual-screen presenter surface —
  table-stakes for live talks.
- **CR-12 · Gallery/overview from the editor** 🟡 — the working `GalleryView` (verified:
  136 tiles) is currently reachable **only inside Present mode**. Expose it from the
  editor as a grid overview-and-reorder surface. Reuses existing code.
- **CR-06 · Add-affordance visibility consistency** 🟡 — v12.78 made slide-level `+ add`
  hover-reveal, but block-level affordances (e.g. `+ Add step`) are still always-visible.
  One consistent policy.
- **CR-11 · Disambiguate the AI-gated "✏️ Edit" button** 🟢 — the bottom-toolbar
  `✏️ Edit` is disabled when AI is unavailable, which reads as *"editing is off"* even
  though **single-click inline editing works fine** (verified: `contentEditables:1`).
  Rename to `⚡ AI Edit` / `Quick Edit`.

**Verify:** presenter view shows next-slide + notes + running timer; gallery opens from
the editor and reorders slides; disabled AI button no longer implies the editor is dead.

### 3 · One-prompt wow — Deck-from-source + slide transitions

- **Deck-from-source** 🟢 — **"Generate deck from…"** a pasted README / URL / PDF-text →
  a full Vela deck in one shot. *"Turn your repo README into a pitch deck"* is the tweet
  that gets posted. Runs on the existing AI paths (see scope note); the single
  `callClaudeAPI` chokepoint (`part-engine.jsx:17`) already centralizes the call.
- **CR-09 · Slide transitions / build animations** 🟡 — none today beyond thumbnail
  smooth-scroll. A small, tasteful set (deck-level fade/slide; optional per-block reveal)
  so both generated decks and the shared HTML from item 1 feel finished.

**Verify:** paste a real README (in an AI-enabled runtime) → coherent deck; a deck-level
transition plays on slide advance.

### 4 · Shared hardening — repo looks healthy to a visitor

Cheap quality fixes; a first-time visitor judges trust by green CI and a clean test run.
Each requires a `VELA_VERSION` bump per the repo rule.

- **CR-01 · UI-battery selector drift** 🟢 — 8 in-app battery tests fail against the
  *real* DOM (not offline-harness artifacts): 7 search for a `"Review"` button that is
  now **`💬 Comments`**; 1 counter test scans `<span>` but the counter renders in a
  `<div>`. False red that would also mask a real regression. Update the selectors.
- **CR-02 · AI-test offline guard** 🟢 — ~9 battery tests fail whenever AI is unavailable
  (every offline render / keyless artifact), burying real failures. Gate on
  `velaAIAvailable()` and skip-with-reason, or split into an "AI required" suite.
- **CR-04 · jsdom dev-dependency** 🟢 — fresh `python3 tests/test_vela.py` reports "2
  failed" only because `jsdom` is missing for two node security suites. Add it as a
  locked devDependency, or make the runner skip-with-message so the headline stays honest.

**Verify:** battery green in a real browser for all non-AI suites; offline battery shows
0 unexpected failures (AI tests *skipped*, not *failed*); fresh `test_vela.py` all-green
or clearly-skipped.

---

## Explicitly NOT in this sprint (backlog)

- **CR-13 · Bring-Your-Own-Key AI** 🟢 — a third branch on `callClaudeAPI` for a
  user-supplied key (Anthropic / OpenAI-compatible / local Ollama), browser-local only.
  Highest single adoption lever — natural headline for the next sprint. *Pulled from
  this sprint by decision.*
- **CR-07 · PowerPoint (.pptx) export** — swap in for the standalone-HTML export instead
  if the target audience turns out enterprise/business rather than OSS-viral.

---

## Reference — reviewed app

The review drove the live app in a real browser (Playwright CLI). The editor and
branding surfaces are solid; the defects above are the sprint's cleanup targets.

| Editor (home) | Branding panel |
|---|---|
| ![Editor home](img/editor-home.png) | ![Branding panel](img/branding-panel.png) |

Full CR catalogue, health snapshot, and round-by-round findings: **`docs/NEXT-SPRINT-CRs.md`**.
