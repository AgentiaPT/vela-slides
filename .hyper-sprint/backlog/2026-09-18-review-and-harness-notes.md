# Follow-up — review-flag semantics, and two harness defects

Found by the blind hunts of sprint "lantern" (2026-09-18). **Out of scope for that sprint** by the
user's decision to close after the final round. Recorded here for a later sprint.

## 1. An approval survives a content change (design question, low)

Steps: approve a slide (`slide-review-check` goes false to true), then change its content — for
example paste a block into it. Observed: the block count went 11 to 13 and `isSlideApproved` stayed
`true`, so review mode never brings the changed slide back for a second look.

No specification text says an approval must reset, so this is a design question and not a defect. But
it weakens the feature's purpose: the point of review mode is to stop an author re-reading work they
already signed off, and a slide that changed after sign-off arguably needs another look.

Decide the intended rule, then make the code and the tooltip agree. Options: keep the approval
(current behaviour, simplest); clear it on any content change; or mark it "approved, then edited" and
let the author choose.

## 2. The `galleryState` verb reads test-ids that do not exist (harness defect, medium)

`.hyper-sprint/vela-verbs.mjs`'s `galleryState` counts `[data-hidden-overlay]` and
`[data-hidden-badge]`. Neither test-id occurs anywhere in `src/parts/*.jsx`, so the verb always
reports `0`.

This is worse than a dead verb: it produces a confident FALSE finding. Two separate hunters nearly
reported "a hidden slide is not marked at all in the gallery" on the strength of it, and only avoided
it by reading the source and looking at a screenshot. A verb that silently returns a plausible wrong
number will eventually cost a real sprint a wrong fix.

Either emit those test-ids in the gallery renderer, or change the verb to read what the gallery
actually renders.

## 3. `vrun <job> --reset` silently ignores `--reset` (harness defect, low)

`.claude/skills/burst-bug-hunter/assets/vrun` parses only `$1`, so a `--reset` passed after the job
path is dropped without a warning. A worker lost time to state leaking between runs before finding
this. Either honour the flag in any position, or fail loudly on an unrecognised argument.

Workaround until then, already recorded in the shared drive recipe: run `vrun --reset` on its own.

## 4. Driver note worth keeping

The first `[data-block-type]` node on the shipped demo deck is a zero-width `spacer`, so hovering
"the first block" never opens the block hover toolbar. A hunter's first copy/paste burst returned
`hasCopy:false` for exactly this reason and proved nothing. Hover a real block instead. Consider
giving the verb library a `hoverRealBlock` helper so each new hunt does not re-pay this.
