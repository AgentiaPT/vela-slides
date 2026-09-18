# Vela "next sprint" — change requests (verbatim source: brief.txt)

CR1  [neutralino/server] Opening a deck mutates it: lane/module IDs + timestamps regenerated
     at ingress even with no user edit. Confirm, root-cause, decide valid-or-bug, fix.
     Quote: "Vela regenerates lane and module IDs at ingress".
CR2  [validate] Slide bg with a gradient: no validation that gradients cannot be on bg;
     colors silently fall back to default and wreck slide visuals. validate.py must detect it.
CR3  [layout] Image left/right of content is top-aligned with zero top margin/padding; should
     align with the overall content block. Confirm, root-cause, make it great. (May be partly fixed.)
CR4  [gallery] Show the hide-slide action next to the delete action in gallery view.
CR5  [pdf-vector] Some chars render stretched/thin (wrong glyph metrics) in vector PDF export.
     Check PPTX for the same defect.
CR6  [ux-research] Copy/paste of items (blocks). Needs UX research: how paste picks a target location.
CR7  [feature] Review mode: toggleable checkmark on a slide; cycle/show only unchecked slides so
     approved ones drop out of the rotation. Editor mode only.
CR8  [branding] Cannot remove the top brand line — 0 px still renders a visible line.
CR9  [branding] Move branding config panel to a right-hand side pane; current layout is unprofessional.
CR10 [gallery] Gallery-view icon at top right is not visible while showing.
CR11 [presenter] Edit icon (top right) in presenter mode shows only intermittently.
CR12 [neutralino] HTML export errors: "Identifier 'useState' has already been declared" —
     the Neutralino UMD shim redeclares React bindings already declared by the app.
CR13 [ux-research] View switching (presenter | editor | gallery) is hidden/undiscoverable.
     Overview button below the slide is the wrong place; promote near Present.
CR14 [toc] Editor TOC slide rows need a delete action (sections have one; slides only hide/unhide).
CR15 [ux-research] When an image fills the slide, the block toolbar is clipped at the top and is
     nearly unclickable. Research the best UX alternative.
CR16 [neutralino] Window title should be "Vela Slides - <Deck Title>", without repeating "Vela Slides".
CR17 [text] Inline links in text blocks land wrong: overlapping trailing words, or far to the right.
     Stress-test; must be pixel-consistent in all cases.
CR18 [neutralino] Regaining window focus (alt-tab) leaves the keyboard dead until a click inside.
     Applies to presenter, editor and gallery. Keyboard must work the instant focus returns.
CR19 [neutralino] After every new build, first app start shows AI integration "offline" even after a
     rescan; only a full close+restart fixes it. Root-cause and fix.
