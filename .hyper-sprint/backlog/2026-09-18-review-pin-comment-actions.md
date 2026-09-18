# Follow-up — a comment action drops a pinned review row

**This is a gap in sprint "lantern"'s OWN new code, not a pre-existing bug.** It is recorded here,
unfixed, only because the user chose to close the sprint after its final validation round. It is the
one known open item from that sprint and should be the first thing a later sprint picks up.

Found by the final blind round (2026-09-18) as a source-level observation. It was NOT reproduced in a
browser, but the code path was confirmed directly.

## What is wrong

Review mode keeps a row listed after the author hides it, so the author can undo the hide in place.
That mark is held against the slide's **object identity** in a `WeakSet` (`_velaReviewKeep`,
`src/parts/part-reducer.jsx`). The design has a known condition: any action that builds a NEW slide
object must carry the mark across, or the row silently disappears from the review list.

`UPDATE_SLIDE` does this correctly:

```
return velaReviewKeepHas(s) ? velaReviewKeepAdd(next) : next;
```

The five comment actions do not. `ADD_COMMENT`, `UPDATE_COMMENT`, `RESOLVE_COMMENT`,
`REOPEN_COMMENT` and `REMOVE_COMMENT` (`src/parts/part-reducer.jsx`, about lines 377-407) each build
a new slide object and return it without the mark.

## Effect

With review mode on, hiding a slide keeps its row listed. Adding, editing, resolving, reopening or
deleting a comment on that slide then replaces the slide object, the mark is lost, and the row
disappears — so the author can no longer unhide it in place. That is exactly the defect the pin was
added to prevent, reachable through a different door.

## Maintainer actions

1. Carry the mark in all five comment actions, the same way `UPDATE_SLIDE` does.
2. Better: stop repeating the idiom. Give the reducer one helper that replaces a slide and preserves
   its marks, and route every slide-replacing action through it. The current shape needs every future
   action author to remember an invisible rule, which is how this gap appeared in the first place.
3. Add a regression test per slide-replacing action, not only for the ones known today.

## Smaller observations from the same round

- In review mode, clicking a hidden kept row does not open that slide — the editor moves to the next
  slide that needs review. This follows the skip rule, but it makes the row look inert. The author
  cannot edit a hidden slide's text from its row without leaving review mode.
- After a cross-module drag of a hidden slide, the editor selects it and the canvas counter reads
  `04 / 20` — a hidden slide gets a position number inside a count that excludes it. Cosmetic.
- Duplicating a hidden kept row adds no visible row in review mode. Correct by design (the copy is
  hidden and unmarked), but the operation gives no feedback. Whether the copy reaches the stored deck
  was not confirmed.
- `MOVE_SLIDE` in the reducer has no UI caller; only tests dispatch it. Slide rows carry no up/down
  glyphs, so a slide moves only by drag or by "Move to section…". Either wire it up or remove it.
