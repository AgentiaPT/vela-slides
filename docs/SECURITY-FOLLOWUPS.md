# Security follow-ups (deferred hardening)

These are **defense-in-depth improvements**, not open vulnerabilities. The
deck→render attack surface (an untrusted deck rendered in the app) is closed and
was re-verified by repeated adversarial review. The items below further harden the
**CI recurrence guards** (which protect against a future regression re-introducing a
closed issue) and add belt-and-suspenders around a couple of non-deck paths.

Keep the *Security-Fix Disclosure Discipline* (see `SECURITY.md`) when acting on
these: describe the class and the fix, never reproduction detail.

## 1. Behavioral "real-bundle" guard for the SVG sanitizer invariant
The recurrence guards today are (a) a static lint over the part-files, (b) a node
test that runs the real sanitizer extracted from source, and (c) an un-skippable
in-browser battery that runs the real bundle. Layers (a) and (b) are, like any
static / fragment-based check, inherently incomplete against a *dynamic*
re-introduction expressed in code they don't model. The strongest single guard is a
CI check that **executes the real, complete bundle and asserts the sanitizer
invariant directly** (e.g. that the SVG tag allowlist does not admit `style`, and
that a `<style>` payload is stripped). That makes the assertion independent of how
any re-introduction is spelled and independent of the editable test bodies. Worth
adding as the authoritative layer so the static lint can remain a fast, best-effort
backstop rather than the last line.

## 2. Clip the SVG-block render sink like the other two
The two diagram sinks (chat / study-notes) wrap their sanitized SVG in an
`overflow:hidden` box; the general `svg` block sink does not, and the inline-style
filter allows `transform`. Today this is **not exploitable** — positioning
(`position`/`inset`/`z-index`) is denied, so overflowing paint stays *under* the app
chrome and cannot intercept or cover it — but giving the svg-block inner container
`overflow:hidden` (and/or adding `transform` to the inline-style denylist) would make
all three sinks uniform and remove the "future sink placed outside a clip box" foot-gun.
A small lint asserting every `sanitizeSvgMarkup` sink sits in a clip box would keep it
that way.

## 3. Reserved-key filter on AI tool-arg merges (engine)
The Vera engine merges model **tool-call arguments** into slide state with a raw
object merge. This is off the deck→render path (only reachable from AI output, not
from deck data), so it is not a deck vulnerability — but filtering reserved keys
(`__proto__` / `constructor` / `prototype`) on that merge, or using a null-prototype
copy, is cheap defense-in-depth for the AI path.

## 4. Minor: node sanitizer-suite duplicate check is comment-blind
The node sanitizer suite counts sanitizer definitions on raw source and fails if it
finds more than one. A future *doc comment* that reproduced a full construct verbatim
could trip a false "duplicate" — it fails safe (loud), not open, so this is a
developer-experience nicety, not a security gap. Comment-stripping before the count
would remove the papercut.
