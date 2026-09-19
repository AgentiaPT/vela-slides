# Sprint lantern — before / after screenshots

This file is a fragment. Its image links use the path `img/<name>.png`, so put
the text into a document in the parent folder
(`.hyper-sprint/completed/2026-09-18-lantern/`).

All shots come from the offline render harness at a 1280x720 window, unless a
section tells you a different width. "Before" is the sprint base commit
`702256ff`. "After" is the sprint head. Some shots are zoomed. A zoomed shot
keeps the true pixels of the app; only the scale is larger.

Two changes are new features (CR7 review mode and CR6 copy and paste). A new
feature has no "before" state, so these two sections show "after" shots only.
Each such section says so.

## CR4 — Hide control in the gallery row

| Before | After |
|---|---|
| ![gallery row before](img/cr04-gallery-hide-before.png) | ![gallery row after](img/cr04-gallery-hide-after.png) |

The pointer is at the same position in both shots. Before, the slide row has
only the delete control (x). After, an eye control is beside the delete
control. The eye control hides the slide and shows it again.

## CR10 / CR11 — Top-right controls in the presenter

| Before | After |
|---|---|
| ![presenter chrome before](img/cr10-11-presenter-chrome-before.png) | ![presenter chrome after](img/cr10-11-presenter-chrome-after.png) |

The shots show the top-right corner of a slide in the presenter. Before, the
gallery control (the folder shape) is almost the same color as the slide
behind it. The edit control (the pencil) has no background of its own. After,
both controls sit on a dark chip. The gallery glyph is white. The controls are
readable on any slide.

## CR13 — Editor / Gallery switcher in the header

| Before | After |
|---|---|
| ![header before](img/cr13-view-switcher-before.png) | ![header after](img/cr13-view-switcher-after.png) |

Before, the header has no view control between "Brand" and "Present". After, an
"Editor | Gallery" switcher is beside the "Present" control.

## Header and bottom toolbar at a 600 px window width

| Before | After |
|---|---|
| ![600 px before](img/narrow-600px-before.png) | ![600 px after](img/narrow-600px-after.png) |

The window is 600 px wide in both shots. Before, the header controls after
"New" are outside the window, and the bottom toolbar is cut at both edges. A
measurement in the same run found 8 controls outside the window: Import,
Export, the tour control, Comments, Vera, Move, Delete and Overview. After,
both rows wrap, and the same measurement found 0 controls outside the window.

## CR8 — Accent bar at height 0

| Before — height 0 | After — height 0 | After — height 6 px |
|---|---|---|
| ![accent zero before](img/cr08-accent-zero-before.png) | ![accent zero after](img/cr08-accent-zero-after.png) | ![accent 6 px after](img/cr08-accent-6px-after.png) |

In the first shot the branding readout shows "0px", but a blue bar is still
across the top of the slide. In the second shot the readout shows "0px" and no
bar is on the slide. The third shot shows the same build at 6 px, where the bar
is present. The bar is thus fully controlled by the height value.

## CR9 — Branding settings in a right-hand pane

| Before | After |
|---|---|
| ![branding before](img/cr09-branding-pane-before.png) | ![branding after](img/cr09-branding-pane-after.png) |

Before, the branding settings are a full-width strip below the toolbar, and
they push the slide down. After, the settings are a pane on the right side. The
slide stays beside the pane, so you see the effect of each setting immediately.

## CR7 — Review mode (new feature — after only)

This feature is new. There is no "before" state.

| Not approved | Approved |
|---|---|
| ![review check off](img/cr07-review-check-off-after.png) | ![review check on](img/cr07-review-check-on-after.png) |

A check control is at the top-left corner of the slide. The control is a thin
outline when the slide is not approved. The control is a green disc when the
slide is approved. The "Review" control is at the top of the slide list.

![review filtered list](img/cr07-review-filtered-after.png)

Review mode is on in this shot. The control reads "Review ON · 16 left · exit".
The approved slides are no longer in the list. The "Product Story" section
reads "all 3 approved".

![review banner](img/cr07-review-banner-after.png)

When you approve all slides, a banner reads "All 21 slides approved." The
"Clear all" control in the banner removes all approvals.

## CR14 — Delete control on a slide row of the outline

| Before | After |
|---|---|
| ![toc row before](img/cr14-toc-delete-before.png) | ![toc row after](img/cr14-toc-delete-after.png) |

The shots are a 6x zoom of three slide rows in the outline. Before, each row has
only the eye control. After, each row also has a delete control (x), the same
control that a section row already had.

## CR15 — Block toolbar on a full-bleed block

| Before | After |
|---|---|
| ![block toolbar before](img/cr15-block-toolbar-before.png) | ![block toolbar after](img/cr15-block-toolbar-after.png) |

The shots are the top-right corner of a slide that one image fills. Before, the
toolbar is above the top edge of the slide and past its right edge. A
measurement in the same run gave a toolbar top of 59 px against a slide top of
67 px. After, the toolbar moves inward and is fully inside the slide: a toolbar
top of 77 px against a slide top of 73 px.

## CR17 — Link mark on a label that wraps

| Before | After |
|---|---|
| ![link mark before](img/cr17-link-mark-before.png) | ![link mark after](img/cr17-link-mark-after.png) |

The first bullet has a long linked label that wraps to two lines. Before, the
link mark is at the right edge of the block, at the vertical centre of the
paragraph. It has no relation to the text. After, the link mark is immediately
after the last word of the label, on the last line.

## CR6 — Copy and paste of a block (new feature — after only)

This feature is new. There is no "before" state.

![paste marker](img/cr06-paste-marker-after.png)

The pointer is on the paste control of the second block. A blue marker line
shows where the copied block will go. The marker is below the block that the
pointer is on.

![block toolbar](img/cr06-block-toolbar-after.png)

This is an 8x zoom of the same toolbar. The copy control is the fourth control.
The paste control is the fifth control. The paste control is blue, and it is
present only after a copy.
