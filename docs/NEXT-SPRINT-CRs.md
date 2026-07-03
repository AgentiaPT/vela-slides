# Vela Slides — Next-Sprint Change Requests

**Author:** Product review (PM pass)
**Date:** 2026-07-03
**Build reviewed:** `VELA_VERSION 12.79` · SKILL.md `12.79` (in sync)
**How this was produced:** ran the test suites, built the offline render of
`examples/vela-demo.vela`, and drove the live app in a real browser (Playwright
CLI) — home/list view, an interior data slide, Present mode, mobile width, and the
in-app UI-test battery.

## Health snapshot

| Signal | Result | Note |
|--------|--------|------|
| `tests/test_vela.py` | **351 pass / 2 fail** | Both failures are the jsdom node security suites — **environment-only** (jsdom not installed locally; CI installs it). Not a regression. → CR-04 |
| In-app UI battery (`__velaRunUITests`) | **149 pass / 17 fail** | 8 failures are **real test drift** (CR-01); ~9 are AI-gated tests with no offline guard (CR-02). |
| `concat.py` template sync | ✅ in sync | 16,374 lines / 1.2 MB / 13 parts. |
| Open GitHub issues | 0 | This backlog is net-new. |

**Legend** — Priority: P1 (fix this sprint) · P2 (should) · P3 (nice-to-have).
Confidence: 🟢 verified in a running browser · 🟡 observed via screenshot/source.

---

## A. Defects & quality

### VELA-CR-01 · In-app UI-test battery has drifted from the real UI · P1 · 🟢
Eight of the 17 battery failures are **stale selectors that fail against the real
DOM**, not offline-harness artifacts — so the battery is both giving false red *and*
would mask a genuine regression in these areas.
- **7 "Review" tests** search for a header button whose text contains `"Review"`, but
  the button was renamed to **`💬 Comments`**. Verified live: no button matches
  `/review/i`; the button is `"💬 Comments"`.
- **1 "Slide counter" test** (`Slide counter shows valid format`) scans only
  `<span>` elements, but the counter now renders inside a `<div>` (`"01 / 28"`).
  Verified live: zero matching spans; the counter is a leaf `<div>`.

**Fix:** update the 7 Review-suite selectors to `Comments`/`💬`; broaden the counter
test to the element that actually holds the counter. **Acceptance:** battery green in a
real browser for all non-AI suites. **Effort:** S.

### VELA-CR-02 · AI-dependent UI tests have no "AI unavailable" guard · P2 · 🟢
~9 battery tests (Vera AI ×6, "Chat input visible", "Batch prompt input", plus the
AI-gated bits) fail whenever AI is unavailable — i.e. **every offline render and every
keyless artifact**. A clean offline run therefore shows 17 red, which buries real
failures (see CR-01) and trains reviewers to ignore the battery.
**Fix:** gate these tests on `velaAIAvailable()` and skip-with-reason when false, or
split them into a clearly-labelled "AI required" suite that the offline runner
reports separately. **Acceptance:** offline battery run shows 0 unexpected failures;
AI tests report as *skipped*, not *failed*. **Effort:** S–M.

### VELA-CR-03 · Edit affordances leak into Present mode · P2 · 🟢
In Present mode (verified: `<header>` removed = presenting) the title slide still
renders **3 dashed "+" edit-placeholder markers** in the block gutter next to the
heading and subtitle (visible in the presenter screenshot). Edit/add affordances
should be fully suppressed while presenting.
**Fix:** ensure the inline "+"/add-element placeholders are hidden when
`fullscreen`/presentation is active. **Acceptance:** a presented slide shows zero
edit affordances. **Effort:** S.

### VELA-CR-04 · `jsdom` is not a dev-dependency — local test run shows a scary "2 failed" · P3 (DX) · 🟢
`python3 tests/test_vela.py` reports **2 failed** on a fresh checkout because
`test_svg_mxss.cjs` / `test_data_image_uri.cjs` exit 2 when `jsdom` is missing. The
runner does print a hint, but the headline count reads as a regression and costs every
new contributor a detour.
**Fix:** add `jsdom` as a proper `devDependency` (locked, per the repo's supply-chain
policy) **or** have the runner detect-and-*skip* these suites with an explicit
`SKIPPED (jsdom not installed)` line so the pass/fail headline stays honest.
**Acceptance:** fresh `python3 tests/test_vela.py` is all-green or clearly-skipped, no
raw "failed". **Effort:** S.

---

## B. UX polish

### VELA-CR-05 · Presenter slide counter is low-contrast and collides · P3 · 🟡
Bottom-right `01 / 28` in Present mode is tiny and very low-contrast on the dark
theme, and sits under a faint stray "+" (related to CR-03). Presenters glance here for
position — it should be legible from across a room.
**Fix:** bump size/contrast (or a subtle pill) and de-collide from the "+".
**Effort:** S.

### VELA-CR-06 · Inconsistent visibility of inline add-affordances in the editor · P3 · 🟡
v12.78 made the slide-level `+ add` *hover-reveal*, but block-level affordances
(e.g. `+ Add step` on a steps block) still render **always-visible** in the editor.
The mixed model looks unfinished. **Fix:** one consistent hover-reveal (or pinned)
policy across slide-level and block-level add affordances. **Effort:** S–M.

---

## C. Feature / roadmap (verified gaps)

### VELA-CR-07 · PowerPoint (.pptx) export · P2 · 🟢
Current export menu: **Vela (.vela), PDF, Markdown, JSON copy/paste** — no editable
`.pptx`. This is the #1 interchange format business/enterprise users expect for
handing a deck to colleagues who don't use Vela. **Scope:** map the 27 block types to
PPTX shapes/placeholders (a lossy-but-useful first cut is fine). **Effort:** L.

### VELA-CR-08 · Dedicated presenter / speaker view · P2 · 🟢
Presentation goes fullscreen, and speaker/study notes exist in the data model, but
there is **no dual-screen presenter view** — current slide + next-slide preview +
speaker notes + elapsed/segment timer on the presenter's screen while the audience
sees only the slide. This is table-stakes for live talks. **Effort:** M–L.

### VELA-CR-09 · Slide transitions / build animations · P3 · 🟡
No slide-to-slide transition or per-block build/reveal option today (only thumbnail
smooth-scroll). A small, tasteful set (deck-level fade/slide; optional per-block
reveal) would raise the "finished product" feel. **Effort:** M.

---

## D. Process improvement — *applied in this change*

### VELA-CR-10 · Skill-trigger routing so ad-hoc browser work reaches the Playwright CLI · DONE 🟢
During this review I initially drove exploration with the committed `vela-drive.js`
scripts instead of the interactive Playwright CLI. Root cause: the **`vela-live-render`**
skill description and the CLAUDE.md "Running the app live" section (which comes *first*,
with ready-to-run `shot`/`uitests` commands) both claim the exact ad-hoc trigger
phrases — *"visually verify UX changes", "reproduce a reported bug", "screenshot a
feature"* — that should route to **`playwright-cli-setup`**. The "these scripts are for
repeatable/committed automation only" rule lived only in prose in a *second* section,
i.e. not at the point of decision.
**Applied here:** narrowed `vela-live-render`'s description to repeatable/committed
automation and added a routing banner pointing ad-hoc work to the CLI; strengthened
`playwright-cli-setup`'s description as *the default* for ad-hoc/interactive work; and
added a decision rule + "code-based scripts = repeatable only" callout at the top of
the CLAUDE.md section. (Docs/skills only — no `skills/vela-slides/` change, so no
`VELA_VERSION` bump.)

---

## E. Round-2 interactive testing notes (Playwright CLI)

A second live pass drove gallery, Present mode, Brand, New-deck, and inline editing.
New, verified observations:

- **Inline editing works with no AI** 🟢 — single-click on any text block enters a
  `contentEditable` editor (verified: `contentEditables:1`, active element editable).
  Important: the OSS/no-key experience is a usable editor, not a dead app. Keep this
  front-and-centre (see CR-11).
- **CR-03 is broader than "+" markers** 🟢 — in the header-less Present state the
  focused heading also shows a **dashed block-selection outline** and a bottom-right
  **pencil/edit icon**, i.e. the full block-edit chrome, not just add affordances.
  (Caveat: offline `file://` render doesn't engage the real Fullscreen API; confirm
  in the actual artifact — but the DOM evidence is consistent.)
- **Gallery is presentation-only** 🟡 — the `🗂` grid/gallery (verified working: 136
  tiles) is reachable **only inside Present mode**; there's no overview/grid from the
  editor. A grid overview while *editing* is a common expectation → CR-12.
- **Branding panel is solid** 🟢 — header rule, logo upload, footer L/C/R, colors,
  image-compression sliders, slide rules all render and respond.

### VELA-CR-11 · Disambiguate the AI-gated bottom "✏️ Edit" button · P3 · 🟢
The bottom-toolbar `✏️ Edit` / `✨ Improve` / `🎲 Variants` / `🔄 Batch` are disabled
when AI is unavailable — correct — but "Edit" being greyed out reads as *"editing is
off"* even though single-click inline editing works fine. Rename to `⚡ AI Edit` (or
`Quick Edit`) so the disabled state doesn't imply the editor is dead. **Effort:** S.

### VELA-CR-12 · Grid / gallery overview from the editor · P3 · 🟡
Expose the existing `GalleryView` from the editor (not just Present mode) as a
deck-overview/reorder surface. Reuses working code. **Effort:** S–M.

---

## F. ⭐ "Share & Present" sprint — one sprint, 3 senior engineers

Goal: convert *"someone found Vela on GitHub"* into *"they starred, shared, and came
back."* Stars for a presentation tool come from three moments this sprint targets —
**share it virally**, **present it professionally**, and **the one-prompt wow demo**.

> **Scope decision:** Bring-Your-Own-Key AI (the "try it in 60 seconds" adoption
> unlock) has been **pulled from this sprint to the backlog → CR-13**. Consequence:
> Track 3's deck-from-source runs on the **existing** AI paths only (Claude.ai artifact
> proxy + desktop agent-bridge), so it works in those runtimes but **not for a keyless
> OSS cloner** until CR-13 ships. The demo GIF still drives stars regardless of where
> the viewer can run it. The three tracks below are fully **independent — no shared
> dependency edge** now that A is out.

### Track 1 · *Share it anywhere* — Standalone HTML export + present-mode polish  (Eng 1)
A presentation tool grows through the decks people share. Productize the existing
`render-offline.js` recipe into an in-app **Export → "Standalone HTML"**: one
self-contained `.html` (deck + vendored UMD + safely-inlined transpiled app) that
opens offline anywhere and drops straight onto GitHub Pages or into an email. Add a
toggleable **"Made with Vela ⛵"** footer → attribution loop. **Ship CR-03** here
(edit chrome must never appear in a shared/presented deck — it's the actual output)
and **CR-05** (presenter counter legibility) as same-surface polish.
**Why it drives stars:** every shared deck becomes a growth vector with built-in
attribution. **Verify:** exported file opens in a fresh, network-less browser; arrows
navigate; zero edit chrome; counter legible. **Effort:** M (+ CR-03/05 small).

### Track 2 · *Present it professionally* — Presenter view + editor overview  (Eng 2)
Ship the **dedicated presenter/speaker view** (CR-08): current slide + next-slide
preview + speaker notes + elapsed/segment timer — table-stakes for live talks that's
currently missing. Bundle the AI-independent editor wins: expose the working
`GalleryView` as a **grid/overview-and-reorder surface from the editor** (CR-12), and
land the affordance-consistency + label polish (**CR-06**, **CR-11**).
**Why it drives stars:** closes the credibility gap for anyone who'd present live, and
makes the editor feel finished on first open — all with **zero AI dependency**, so it
lands cleanly even without CR-13. **Verify:** presenter view shows next-slide + notes
+ running timer; gallery opens from the editor and reorders slides. **Effort:** M–L.

### Track 3 · *One-prompt wow* — Deck-from-source + slide transitions  (Eng 3)
The hero, screenshot-able moment: **"Generate deck from…"** a pasted README / URL /
PDF-text → a full Vela deck in one shot. *"Turn your repo README into a pitch deck"*
is the tweet that gets posted. Runs on the existing AI paths (see scope note). Pair it
with **slide transitions / build animations** (CR-09) so both the generated deck and
the shared HTML from Track 1 feel like a finished product.
**Why it drives stars:** produces the demo GIF that spreads, and raises the perceived
polish of every deck. **Verify:** paste a real README (in an AI-enabled runtime) →
coherent deck; a deck-level transition plays on slide advance. **Effort:** M–L.

### Shared hardening (all three, ~½ day each) — *repo looks healthy to a visitor*
A first-time visitor judges trust by green CI and a clean test run. Land the cheap
quality fixes so the repo reads as maintained: **CR-01** (battery drift), **CR-02**
(AI-test offline guard), **CR-04** (jsdom dev-dep). Each requires a `VELA_VERSION`
bump per the repo rule.

### Sequencing & fit
No cross-track dependency — all three start day 1 and run in parallel. Each track is a
single coherent surface (export / presenter+gallery / generation+transitions) plus a
small polish tail, with shared hardening threaded throughout. Comfortably one sprint;
Track 2 (AI-independent) is the safest to fully complete if scope tightens.

---

## G. Backlog (deferred features)

### VELA-CR-13 · Bring-Your-Own-Key AI (provider-agnostic)  · P2 feature · 🟢
*Pulled from the sprint per decision.* Add a third branch to the single
`callClaudeAPI` chokepoint (part-engine.jsx:17) for a **user-supplied key** (Anthropic
+ OpenAI-compatible + local Ollama), entered in a settings dialog, stored
**browser-local only** ("your key never leaves this device"); `velaAIAvailable()`
flips true when a key is present. Unlocks Vera/Improve/Variants/Batch — and Track 3's
deck-from-source — for **keyless OSS cloners**. Highest adoption leverage of any single
item; revisit as the headline of the next sprint. **Effort:** M.

### VELA-CR-07 · PowerPoint (.pptx) export
Editable PPTX interchange (see §C). Swap into Track 1 instead of standalone-HTML if the
target audience is enterprise/business rather than OSS-viral.

---

## Suggested sprint cut

- **⭐ Star sprint (headline):** Track 1 (standalone export + CR-03/05), Track 2
  (presenter view + CR-12/06/11), Track 3 (deck-from-source + CR-09 transitions)
- **Shared hardening (in-sprint):** CR-01, CR-02, CR-04
- **Backlog:** CR-13 (BYO-key AI — pulled from sprint), CR-07 (PPTX export)
- **Done:** CR-10 (skill-trigger routing)
