# Silent mode — full contract, enforcement checklist, and the smoke test

Silent mode is **opt-in per invocation** and **off by default**. The summary lives in
SKILL.md §Silent mode; this file holds the enforcement detail and the small-scale test.

## 1. What turns it on

Any of these in the invocation: `--silent`, `silent mode`, `silent sprint`, `run this dark`,
`only give me the final report`, `don't report back until the end`. Nothing else turns it on
— not `.hyper-sprint/config.md`, not a previous sprint, not an inference from a terse prompt.
If you are not sure the caller asked for it, **run a normal sprint** (a chatty sprint wastes
tokens; a wrongly-silent sprint loses the user their steering window).

Record the mode in `sprint.json` as `"silent": true` so the archive is self-describing.

## 2. The one message

The sprint produces exactly one user-visible message, sent last, after the archive is
committed **and pushed**:

```
[Sprint "<codename>" report](https://github.com/<owner>/<repo>/tree/<branch>/.hyper-sprint/completed/<YYYY-MM-DD>-<codename>)
<N>/<M> CRs done · blind gate <clean|N rounds> · <K> parked
```

Rules that make it work in a thread the user opens cold:
- Push before you send. An unpushed link 404s and the user has no other information.
- Markdown link, never backticks, never a bare path (§sprint-archive.md).
- The second line is the whole status. If the sprint failed, it still ships — e.g.
  `0/6 CRs done · blind gate NOT run · 6 parked`. Never dress up a failure as a success.

## 3. Suppression checklist (what "silent" actually forbids)

The orchestrator must NOT, between invocation and the final message:

| Forbidden | Instead |
|---|---|
| Any assistant prose to the user | Nothing. Go straight to the next tool call. |
| `AskUserQuestion`, or a question in prose | Decide conservatively, or park. §4 |
| Phase / plan / cluster announcements | Write them to the plan file (Phase 2) only. |
| Per-merge steering updates (principle 13) | Nothing. |
| `SendUserFile`, screenshots, attachments | Nothing. Shots go to the archive `img/`. |
| Mid-sprint cost notes | Run the checkpoint, keep the number, report it in the archive. |
| Progress pings and check-ins *to the user* | Nothing. |
| A self-wake used only for the liveness beat | **Allowed and required** — internal machinery, emits nothing (§4b). |
| Inline confirmation re-drives | Zero — the normal "one for the whole sprint" budget is 0. |
| A dispatch without the output contract | Never — every sub-agent gets its prohibitions verbatim (principle 18). |

What is **unchanged**: every tool call, every sub-agent, the task tracker, the plan file, the
blind gate, the suite runs, the commits. Silent mode suppresses *output to the user*, not
work and not verification.

## 4. Decide-or-park (the no-escape-hatch rule)

Every decision a normal sprint would escalate is resolved here by the orchestrator alone.

**Decide** when a conservative reading exists. Pick the smallest-diff interpretation that
satisfies the acceptance text literally. Do not invent scope, do not "improve" the CR, do not
pick the ambitious reading because it is nicer. Log it:

> **Assumptions & unilateral decisions**
> - **CR-4** — spec says "make the footer configurable" without naming the surface. Read as
>   the existing deck-level `branding.footer` field only; did not add a per-slide override.
>   *If wrong:* the per-slide case is a one-file follow-up in `part-branding.jsx`.

Each entry names the CR, the ambiguity, the reading taken, and **how to reverse it**. That
last part is what makes a silent sprint safe to hand over.

**Park** when no conservative reading is defensible, the change is impossible in this
environment, or it needs a package/credential/decision that is genuinely not yours. Parking is
not failure — it is the correct outcome for an under-specified CR. Log it:

> **Parked / blocked**
> - **CR-7** — needs an undeclared npm package (`sharp`) for image resizing; package policy
>   requires approval and silent mode cannot ask. Not attempted. *To unblock:* approve the
>   package, or accept a canvas-based resize (~1 day).

Parking one CR never stops the others. A sprint where every CR parks still writes, commits,
pushes and links its report.

## 4b. Liveness — silent mode is where a stall is fatal

Principle 17's live beat applies to every sprint, but silent mode is the one where a stall
produces **no signal whatsoever**: no message, no report, no link. The user learns nothing,
possibly for hours. So in silent mode the beat is not optional and the rules tighten:

- **Every wait is registered with a deadline and an expiry action** before you start waiting.
  A silent sprint may never block on something that cannot time out.
- **The expiry action is always "proceed and ship honestly"**, never "keep waiting". A gate
  that will not return becomes `blind gate NOT clean` in the report and in the status line —
  it does not become silence.
- **The beat needs a timer, and silent mode permits it.** The suppression table bans pings
  and check-ins *to the user*; a self-wake scheduled only to run the beat is internal
  machinery and is explicitly allowed. While the hub waits on one long validator it has no
  natural turn boundary, so without that timer the cadence cannot run at all — and a
  blocking sleep instead would be the unbounded wait principle 17 forbids.
- **The beat emits nothing to the user.** Not the beat, not a detected stall, not the
  recovery. All of it goes to the report: a stalled-and-replaced worker or an expired gate
  belongs in *Assumptions & unilateral decisions*, because that is exactly what it is.
- **Judge movement, not status.** See principle 17 for the concrete traps — a `RUNNING`
  session at zero tokens, a vanished dependency behind a healthy poller, a self-matching
  wait loop.

Rule of thumb: in silent mode, ask of every wait — *if the thing I am waiting for died right
now, how long until I notice, and what do I ship?* If either answer is "never", it is a bug.

## 5. Terminal states (all of them ship a report)

| State | Report content | Final line |
|---|---|---|
| All CRs done, gate clean | normal full report | `8/8 CRs done · blind gate clean · 0 parked` |
| Some parked | full report + Parked section | `6/8 CRs done · blind gate clean · 2 parked` |
| Gate never came back clean | report + the surviving findings, verbatim | `8/8 CRs done · blind gate NOT clean · 0 parked` |
| Environment dead at readiness | short report: what was probed, what failed, what it needs | `0/8 CRs done · blind gate NOT run · 8 parked` |

The failure reports are the short ones, not the missing ones. Scope, what was attempted, the
literal error, and what would unblock it — half a page is enough.

## 6. Small-scale smoke test (use this before trusting a big silent sprint)

A one-CR silent sprint that exercises the whole contract for a few minutes:

1. Write a trivial, unambiguous CR to `.hyper-sprint/sprint-<date>-smoke.md` — a
   documentation or comment-level change with a testable acceptance line, so the sprint
   cannot legitimately need a question. Add one deliberately under-specified sub-point so
   the *Assumptions* path is exercised too.
2. Invoke: `/hyper-sprint --silent .hyper-sprint/sprint-<date>-smoke.md`.
3. Let it run without replying.
4. Assert the contract afterwards:
   - **exactly one** assistant message in the thread, and it is the two-line link block;
   - `.hyper-sprint/completed/<date>-<codename>/README.md` exists, is committed and pushed;
   - the link in the message resolves (not a 404);
   - `sprint.json` has `"silent": true`;
   - the report carries *Assumptions & unilateral decisions* (non-empty, from the
     under-specified sub-point) and *Parked / blocked* (may be empty, must be present);
   - no `AskUserQuestion` call anywhere in the transcript;
   - no attestation in the report or `sprint.json` that was written before the act it
     describes (no `VERDICT_JSON`/`TODO` placeholders, no "pushed" claimed while untracked);
   - every wait the run registered had a deadline and a defined expiry action (§4b).

A failure on any assertion is a skill bug, not a sprint bug — fix the skill before running a
real silent sprint.
