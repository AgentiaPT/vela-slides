# Follow-up — comment identity is not allowlisted at ingress

Found by the security hunt of sprint "lantern" (2026-09-18). **Not fixed in that sprint**: no
change request touched the comments subsystem, and the repo's minimal-diff policy keeps an
adjacent find out of an unrelated change. Recorded here so it becomes its own change.

## What is wrong

Sprint "lantern" gave lane ids and module ids a strict identity gate at ingress (`adoptDeckId` in
`src/parts/part-imports.jsx`: type check first, `[A-Za-z0-9_-]{1,40}` charset, uniqueness against a
shared reservation set, fail closed to a fresh `uid()`). Comment ids did not get the same gate.
`sanitizeComment` applies only a length clamp — no charset test and no uniqueness test.

Observed from the real `validateAndSanitizeDeck` on a deck with crafted comment ids: all five ids
survived unchanged, including two that were identical, two that were empty, and one shaped like a
relative path.

## Why it matters

Every comment action in `src/parts/part-reducer.jsx` (`UPDATE_COMMENT`, `RESOLVE_COMMENT`,
`REOPEN_COMMENT`, `REMOVE_COMMENT`) matches on id equality across the whole list, so it acts on
EVERY comment that carries that id. With two comments sharing one id, a single delete removed both:
three comments went to one. `CommentsPanel` in `src/parts/part-app-modals.jsx` also uses the id as
the React list key and the selection key, so the two rows share one checkbox state.

This is silent data loss driven by deck content. A duplicate id does not need a hostile deck — a
merge or a copy path can produce one.

## Maintainer actions

1. Route comment ids through `adoptDeckId` with a per-item reservation set. Keep the fail-closed
   rule: replace a non-conforming or repeated id, never pass it through.
2. Defence in depth: make the comment reducer actions act on the first match only.
3. Teach `skills/vela-slides/scripts/validate.py` the comment shape. The string `comment` does not
   occur in that file today, so comment objects pass the author-side gate unchecked while the app
   accepts and persists them. The author gate and the runtime gate must agree.

## Smaller notes from the same hunt

- `clean.comments.slice(0, MAX_COMMENTS).map(sanitizeComment)` (two call sites in
  `part-imports.jsx`) passes the array index as a second argument. Nothing breaks today because
  `sanitizeComment` reads one parameter, but this is the exact shape the repo's own rule list warns
  about. An arrow wrapper matches the convention used elsewhere.
- Comment `createdAt` and `resolvedAt` are length-clamped strings with no format check, so a deck
  can put free text where a timestamp is expected.
- `cssUrl` coerces any shape to a string before its scheme test, unlike its colour siblings which
  type-check first. Its one caller receives a value ingress has already dropped when unsafe, so this
  is a consistency gap in a defence-in-depth layer, not a demonstrated hole.
