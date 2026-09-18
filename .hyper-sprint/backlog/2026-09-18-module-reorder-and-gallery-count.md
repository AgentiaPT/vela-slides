# Follow-up — dead module move controls, and a gallery count that disagrees

Found by the blind hunts of sprint "lantern" (2026-09-18). **Not fixed in that sprint**: both are
pre-existing, and no change request touched them. The repo's minimal-diff policy keeps an adjacent
find out of an unrelated change. Recorded here so each becomes its own change.

## 1. The module "Move up" and "Move down" glyphs do nothing (medium)

Steps: in the editor TOC, click the down glyph (title "Move down") on a module row. Repeat.
Observed: the module order does not change. Before and after, the order stays
"Product Story, Semantic Building Blocks, Live Editor, Present Like a Pro, Four Levels of AI
Editing, Get It Now — It's Free". Clicks were driven both by a real mouse click on the glyph
rectangle and by `element.click()`; both report a click and no state change.

The control still looks live: computed style `{"op":"0.7","cursor":"pointer","color":"rgb(148, 163, 184)"}`.

Cause: `part-list.jsx` dispatches `{type:"REORDER", id, dir}`, and the reducer in
`part-reducer.jsx` swaps items only INSIDE one lane. The shipped demo deck stores one module per
lane (6 lanes, 1 item each), so the swap can never apply. `isFirst` / `isLast` are computed from the
FLATTENED all-module list, so the glyph never disables itself and gives no feedback.

Dragging the same module row DOES work and moves modules across lanes, which proves the click path
is the broken one, not the underlying reorder.

Maintainer actions:
1. Make `REORDER` move a module across lanes, the way the drag path already does.
2. Derive `isFirst` / `isLast` from the same structure the action operates on, so a control that
   cannot act is disabled rather than silently inert.

## 2. The gallery slide count includes hidden slides (low)

Steps: hide one slide from its TOC row, then open the gallery.
Observed: the gallery header reads "GALLERY 21 slides" while the application header reads
"⏱18m · 20sl · 6§ · 1⊘". Every export agrees with the header, not with the gallery — a Markdown
export drops from 9373 to 8706 bytes and omits the hidden title, and a PPTX export writes exactly
20 slide parts.

Cause: `part-slides.jsx` renders `allSlides.filter(s => !s.isTitleCard).length` with no hidden filter.

Related, same surface: a hidden slide's gallery tile is not dimmed or badged. It renders at full
brightness with the same border and caption as its neighbours; only a small caption icon changes.
The TOC row for the same slide IS dimmed at opacity 0.5. The two views should agree.

Maintainer action: exclude hidden slides from the gallery count, and mark a hidden tile the way the
TOC marks a hidden row.
