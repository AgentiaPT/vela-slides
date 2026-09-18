# Spec screenshot findings

Source images: `vela next sprint_ficheiros/`. Only the `.jpg` files hold real
screenshot content (image002–image018, 9 files). All `.png` files in the
folder are Word-export spacer/theme artifacts (`image001.png`, `image003.png`,
etc.) and were not opened, per instructions.

No app version string is visible in any image.

## image002 -> CR2

Not a screenshot of the Vela app UI. It is a screenshot of a chat/agent log
(dark terminal-style panel) discussing the slide-background gradient bug.
Visible text includes:
- "The main cause is confirmed: five slides placed gradients in `bg`, so
  sanitization dropped them and exposed the light fallback. Your remaining
  slide-3 issue is separate: the callout body color is explicit, but its
  title uses a different color field/default. I will have the deck worker
  correct that exact callout title with slide 3."
- "Write demo-dec" / "One remaining user-observed defect: slide 3 ('By the
  Numbers') callout title color"
- "The five gradient-field defects are fixed. The remaining slide-3 callout
  title issue is now a focused correction and proof request, with no
  further full-deck rerun."
- A user question at 14:32: "that bg issue is relevant, how was it solved?
  should we annotate for a later sprint?"
- Reply: "It was solved at the bg schema boundary: each affected slide now
  uses a valid solid `bg` fallback and puts the gradient in `bgGradient`.
  The sanitizer was correct to reject a gradient in `bg`, but validation
  failed to warn, so the deck degraded silently. I will log that
  valid/migration gap for a later sprint."
- "Todo added — Validating slide gradient placement"

This is developer/agent evidence for CR2, not a defect screenshot. It
confirms the exact defect CR2 describes: a gradient value placed in the
`bg` field is silently dropped by the sanitizer, the slide falls back to a
default (light) color, and no validation step warns about it. The fix
direction named here (move the value to `bgGradient`, keep `bg` solid,
and add validation) matches CR2's ask ("validate.py must detect it").

## image004 -> CR2

Same chat/log style screenshot, continuation of the image002 conversation.
Visible text:
- "Todo added — Validating slide gradient placement"
- "Solved by changing:"
  - `"bg": "#0f172a"`
  - `"bgGradient": "linear-gradient(...)"`
- "The sanitizer behaved correctly, but validation did not warn before
  silently dropping the invalid `bg`. I logged a later-sprint task for
  precise validation, safe migration, and regression tests."

Confirms the concrete before/after deck-JSON fix pattern for CR2: a bad
deck had a gradient string directly in `bg`; the fix moves it into the
`bgGradient` key and sets `bg` to a valid solid hex fallback
(`#0f172a`). This is the exact shape `validate.py` needs to detect and
flag pre-emptively.

## image006 -> CR4

A cropped slide-list / gallery-view thumbnail row. Visible content:
- Thumbnail labeled "2 Da Prompt ao Output" (a slide with an illustration:
  a target icon, a stack-of-books icon, and a text box reading "Contexto
  Relevante -> Melhor Resposta").
- Partial next row "3 Problem..." (slide 3, cut off).
- To the right of the "Da Prompt ao Output" row: a small outlined
  rectangle icon and an "X" icon, with a tooltip label "Delete slide"
  showing above the X.
- A red rectangle (added by the brief author, not part of the app) is
  drawn around the empty outlined-rectangle icon immediately to the left
  of the delete "X".

This matches CR4: only a delete ("X") action is present per slide row; the
red annotation marks the empty slot next to it where a "hide slide" action
icon should be added, so hide sits next to delete as CR4 requests.

## image008 -> CR5

A data/content block showing a pricing table, rendered as exported output
(vector PDF export, consistent with CR5's "pdf-vector" area). Visible text:
- Column headers "DETAIL" and "PRICE (EX..." (truncated).
- Rows: "14h · all prep & materials" -> a boxed value showing a Euro sign
  followed by "2,170"; "14h · second group" -> boxed "€1,630"; "8h · min
  1h blocks" -> boxed "€1,000".
- A large summary number: a boxed Euro sign next to "3,800", with caption
  "BOTH COHORTS (28h)".

Four separate red boxes are drawn around each Euro sign ("€"), and only
the Euro sign — not the surrounding digits — is boxed each time. The
Euro glyph visibly renders thinner and at a different weight/size than
the adjacent numerals, consistent with CR5's "stretched/thin, wrong glyph
metrics" defect in vector PDF export. The defect is isolated to the "€"
character specifically; the digits next to it look normal.

## image010 -> CR10

A small cropped toolbar strip (top-right corner region of the app, light
background), 5 icons in a row: a boat/vessel-style app-logo icon, a
monitor/display icon, a red rectangle around a very faint icon (barely
distinguishable from the background — only a hint of gray line art is
visible), a small circular icon, and an expand/collapse-arrows icon at
the far right.

This matches CR10: the gallery-view icon at top right is present in the
DOM/layout but renders with such low contrast against the toolbar
background that it is effectively invisible. The red box marks exactly
which icon position this is.

## image012 -> CR12 -> corrected to CR11

(Kept at CR11 per the given mapping — content matches CR11, not a
different CR.) A small cropped toolbar strip similar to image010: a red
rectangle around a nearly-invisible icon (only a faint diagonal stroke is
visible, suggesting a pencil/edit icon rendered at very low opacity or
wrong color), followed by a blue monitor/display icon, a light gray
cloud-like icon, and a small icon at the far right partly cut off.

This matches CR11: the edit icon in presenter mode (top right) is
present but shows "only intermittently" — here it is rendered nearly
invisible (very low contrast against the background), which explains why
the user perceives it as not showing.

## image014 -> CR15

A full-bleed slide background screenshot. The slide shows a hand-drawn
illustration style with a banner reading "AGENTES DE IA" and a large
headline "O PODER PERIGOSO DOS AGENTES" ("The Dangerous Power of Agents",
Portuguese), plus decorative icons (a person, a coin/money icon, a
lightbulb/idea icon). An orange horizontal accent bar runs along the very
top edge of the slide (branding top line).

A red rectangle is drawn in the top-right corner of the slide, on top of
the orange accent bar, around a small scalloped/wavy fragment — the only
visible remnant of the block hover toolbar. The toolbar is clipped by the
top edge of the slide/viewport so only a sliver of its bottom edge (a
wavy or dotted texture) pokes into view; the rest of the toolbar (icons,
buttons) is cut off above the visible slide area.

This matches CR15 exactly: when an image/illustration fills the slide,
the block toolbar for that full-bleed image block is anchored above the
block's top edge, which is also the top of the visible canvas, so most of
the toolbar renders off-screen and only a thin clipped strip remains
clickable.

## image016 -> CR16

**This is a Neutralino desktop window.** It shows OS/app window chrome:
top line has a small blue flag/sail app icon followed by the text
"Vela Slides", then a red handwritten annotation "-here" placed
immediately after "Vela Slides" (added by the brief author to mark where
the deck title should be inserted). Directly below that title-bar line is
an in-app header row reading "✓ Saved" and the deck title "Como ligar"
("How to connect", Portuguese).

**Quoted title bar text: "Vela Slides"** (with the red "-here" annotation
pointing to where "- Como ligar" or similar should be appended).

This matches CR16: the Neutralino window title currently reads only
"Vela Slides" with no deck title appended; the fix should make it read
"Vela Slides - <Deck Title>" (e.g. "Vela Slides - Como ligar") without
duplicating "Vela Slides".

## image018 -> CR17

A two-column list of AI tool integrations on a dark background. Left
column: "ChatGPT" (chatgpt.com) with a chat-bubble icon, "Claude"
(claude.ai) with a circular icon, "Lovable" (lovable.dev) with a heart
icon. Right column: "Google Stitch (Beta)" (stitch.withgoogle.com) with a
palette icon, "Google AI Studio" (aistudio.google.com) with a square
icon, "Docker Sandboxes" (docker.com/products/docker-sandboxes) with a
small icon.

Each item name is a hyperlink, but the link's visible highlight/underline
box does not cover the full label text. Instead it overlaps only the
trailing letters of each word: "Cha[tGPT]" — only "tGPT" is
highlighted/colored, not "Cha"; "Cla[ude]" — only "ude" is highlighted;
"Lov[able]" — only "able" is highlighted; "Google Stitch ([Beta])" — only
"Beta" is highlighted/boxed. The highlighted region is shifted to the
right relative to the text it is meant to decorate, consistent with
CR17's description: inline links overlapping the final part of the word
instead of sitting under the whole intended anchor text, and/or landing
too far to the right.

This matches CR17: the inline-link decoration/hit-region in text blocks
is horizontally mispositioned, clipping onto only the trailing characters
of each linked word rather than spanning the full link text.

## Mapping verification summary

All 8 given image-to-CR mappings were checked against actual image
content and confirmed correct. No remapping was needed. image002 and
image004 are chat/log screenshots (evidence trail) rather than app-UI
screenshots, but they unambiguously document the CR2 defect and its fix,
so the CR2 mapping stands.
