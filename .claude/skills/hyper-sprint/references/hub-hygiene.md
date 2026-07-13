# Hub hygiene — payloads to disk, pointers + verdicts in the hub

The orchestrator's context is the most expensive context in the run: everything that
lands in it is **re-sent and re-billed as a cache-read on every subsequent turn**, for
the rest of the session. A sub-agent's *return value* is the one thing that's
unavoidably pinned there — which makes what a sub-agent chooses to return the single
biggest lever on total cost. This reference is the enforceable version of "payloads to
disk, pointers in the hub" (SKILL.md operating principle 3): a concrete do/don't list,
plus how to re-drive by exception without re-opening the hub.

*(Example run: in one measured sprint the orchestrator was ~62% of total spend, and
~96% of its tokens were cache-reads — the hub had absorbed worker diffs, screenshots,
and reference docs directly instead of holding pointers to them. That is an
illustrative data point, not a target to reproduce — the mechanism generalizes to any
sprint regardless of size.)*

## The rule

**Nothing large or re-readable goes in the orchestrator's own turns.** If a sub-agent
produced it and it's more than a few lines, it goes to a file; the sub-agent's return
value is a compact verdict plus that file's path. The orchestrator reads the file back
only when it has a specific reason to (an exception), and even then in a *disposable*
context — not its own.

## Do

- **Trust a worker's pasted summary.** A worker returns: files changed, tests added,
  `suite: pass|fail`, and a one-line verdict. That's the artifact the orchestrator
  keeps. The full diff lives in the worktree/commit, not in the orchestrator's turn.
- **Delegate re-verification.** If a worker's result looks uncertain, spawn a **cheap,
  disposable sub-agent** whose only job is to re-run the canonical verify command (or
  re-drive one specific surface) and return `pass|fail` + a one-line reason. The
  orchestrator never re-opens the diff itself to check.
- **Delegate frame-checks.** "Does this screenshot show the feature" is answered by a
  sub-agent that looks at the image and returns a verdict — the image itself never
  needs to enter the orchestrator's context.
- **Delegate one-off lookups.** A single fact buried in a large reference (a price, a
  config flag's default, one line of a spec) is fetched by a sub-agent that returns
  just that fact, not the document.
- **Point at files for anything large a sub-agent produced**: recon maps, validator
  observation logs, readiness entrypoint files. The orchestrator's job is routing those
  pointers to whichever *other* sub-agent needs the detail next — it rarely needs to
  read the detail itself.
- **Pick a `Write`-capable agent type for any "write your findings to a file" task.** An
  agent type without `Write` (e.g. `Explore`) can't deposit to disk — it has no choice but
  to return everything inline, which is the exact anti-pattern this whole doc exists to
  prevent. Check the type before dispatch, not after the findings are already sitting in
  the hub.
- **Send steering updates as files/links, not inline blobs.** A "here's the new
  feature" update to the user can reference a screenshot path; it doesn't require the
  image to be pasted into the orchestrator's own context to be shared.
- **Batch dispatch, don't drip it.** Give a worker a whole cluster (every issue sharing its
  file set) as one fat, self-contained objective rather than one dispatch round-trip per
  issue — on a long sprint with a big issue list, dispatch granularity is what drives turn
  count up, independent of how small each payload is. Fan out independent clusters in
  parallel instead of dispatching them one at a time.

## Don't

- Don't read a worker's raw diff into the main loop "just to double check" — that's
  exactly the re-verification a cheap sub-agent should do instead.
- Don't view screenshots or watch recordings directly in the orchestrator context —
  delegate the look, keep the verdict.
- Don't load a large doc (a pricing page, a big reference file, a full spec) into the
  hub to extract one number — delegate the extraction.
- Don't paste a validator's full observation log into the orchestrator's turn — the
  validator writes it to a file and returns `pass|fail` + defect list + path; the
  orchestrator only opens the file to **adjudicate a genuine contradiction** between
  two validators, and even then in a scratch context, not by re-reading it every turn
  after.
- Don't hand-write and inline bespoke driver scripts in the main context. Call the
  repo-provided driver, or delegate the drive to a sub-agent that returns a verdict —
  an inline script is itself a payload that gets re-read every later turn.

## Re-driving by exception, cheaply

The default is: worker says pass → orchestrator believes it. The exception path exists
for when a worker flags its own uncertainty, or two results disagree. Even then, the
fix is **not** "orchestrator reads everything to decide" — it's a fresh, narrowly-scoped,
cheap sub-agent that:

1. Reads only what it needs (the one file, the one diff, the one screenshot).
2. Re-runs or re-inspects the specific claim in question.
3. Returns a bare verdict (`pass|fail` + one-line reason).

That sub-agent's context is discarded when it's done. The orchestrator's context never
grows to hold the thing it was checking — only the verdict.

## Why this is the biggest lever

Cache-read tokens are billed at a steep discount per token, but the orchestrator's
context is read on **every single subsequent turn** for the rest of the sprint. A
screenshot or diff pasted in early gets re-billed dozens or hundreds of times over a
long session — dwarfing the one-time cost of a sub-agent looking at it once and
returning a verdict. Keeping the hub small is not a nice-to-have; over a long sprint
it is usually the largest single cost control available, bigger than model choice on
any individual task.
