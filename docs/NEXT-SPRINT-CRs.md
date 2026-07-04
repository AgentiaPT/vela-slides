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
**Research + PoC:** see `docs/POWERPOINT-EXPORT-RESEARCH.md` (design, 3 alternatives,
recommendation, and a working spike in `spike/pptx/` proving native-editable output).

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

## F. ⭐ Sprint — moved to `.hyper-sprint/`

The self-contained sprint definition now lives at
**`.hyper-sprint/sprint-2026-07-03-1-tradewinds.md`** ("Share & Present", codename
*Tradewinds*) — scope only, no delivery plan, intended to be run by coding agents.
This document (`docs/NEXT-SPRINT-CRs.md`) remains the **CR catalogue and findings**
that the sprint draws from.

In-scope for the sprint: standalone HTML export + attribution, CR-03, CR-05, CR-08,
CR-12, CR-06, CR-11, deck-from-source, CR-09, and hardening CR-01/CR-02/CR-04.
Out (backlog): CR-13 (BYO-key AI), CR-07 (PPTX). Full detail and verify conditions are
in the sprint doc.

---

## G. Backlog (deferred features)

### VELA-CR-13 · Bring-Your-Own-Key AI (provider-agnostic)  · P2 feature · 🟢
*Pulled from the sprint per decision.* Add a third branch to the single
`callClaudeAPI` chokepoint (part-engine.jsx:17) for a **user-supplied key** (Anthropic
+ OpenAI-compatible + local Ollama), entered in a settings dialog, stored
**browser-local only** ("your key never leaves this device"); `velaAIAvailable()`
flips true when a key is present. Unlocks Vera/Improve/Variants/Batch — and the
deck-from-source item — for **keyless OSS cloners**. Highest adoption leverage of any single
item; revisit as the headline of the next sprint. **Effort:** M.

### VELA-CR-07 · PowerPoint (.pptx) export
Editable PPTX interchange (see §C). Swap in for the standalone-HTML export if the
target audience is enterprise/business rather than OSS-viral.

---

## Sprint contents (index)

> Authoritative sprint doc: **`.hyper-sprint/sprint-2026-07-03-1-tradewinds.md`**.
> This is a quick index into the catalogue above.

**In scope**
- Standalone HTML export + "Made with Vela" attribution
- CR-03 · edit chrome leaking into Present mode
- CR-05 · presenter counter legibility
- CR-08 · dedicated presenter/speaker view
- CR-12 · gallery/overview from the editor
- CR-06 · add-affordance visibility consistency
- CR-11 · disambiguate the AI-gated "Edit" button
- Deck-from-source (README/URL/PDF → deck)
- CR-09 · slide transitions / build animations
- CR-01 · UI-battery selector drift
- CR-02 · AI-test offline guard
- CR-04 · jsdom dev-dependency

**Backlog (not this sprint)**
- CR-13 · Bring-Your-Own-Key AI (pulled from sprint)
- CR-07 · PowerPoint (.pptx) export

**Done**
- CR-10 · skill-trigger routing
