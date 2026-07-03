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

## Suggested sprint cut

- **Must (P1/P2):** CR-01, CR-02, CR-03, CR-07, CR-08
- **Should (P2/P3):** CR-04, CR-05, CR-06
- **Stretch:** CR-09
- **Done:** CR-10
