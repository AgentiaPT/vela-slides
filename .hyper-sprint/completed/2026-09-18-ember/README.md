# Sprint "ember" — silent-mode smoke test

**Date:** 2026-09-18 · **Branch:** `claude/keen-bohr-70l6lu` · **Sprint HEAD at start:** `9b3b759`
**Mode:** silent (`--silent`) · **Scope:** documentation only — no app code, no `VELA_VERSION` bump

Purpose: exercise the `hyper-sprint` silent-mode contract end to end at the smallest possible
scale (`references/silent-mode.md` §6). Three change requests, one per silent-mode path:
**ship**, **decide**, **park**.

---

## 1. Scope and outcome

| CR | Request | Path | Outcome |
|---|---|---|---|
| CR-1 | Repair the archive index table; add a check script | ship | **Done** — `c92335c`, corrected in `28f76a4` |
| CR-2 | Make the index easier to scan | decide | **Done** — `c92335c` (see §5) |
| CR-3 | Link each row to its live cost dashboard | park | **Parked** (see §6) |

**2 / 3 CRs done · blind gate NOT clean · 1 parked.**

The index itself is correct and the blind reviewer confirmed both shipped CRs as user-visible
outcomes. The gate is reported as **not clean** because round 2, which had to confirm the
round-1 fix, never returned a verdict. §7 states exactly what is and is not proven.

---

## 2. Agentic burndown

Work remaining = open CRs + agent-found defects. A blind round *adds* scope when it finds
something, so the curve rises before it falls.

| Point | Open CRs | Agent-found defects | Work remaining |
|---|---|---|---|
| Sprint start | 3 | 0 | 3 |
| After intake — CR-3 parked | 2 | 0 | 2 |
| After cluster C1 landed (`c92335c`) | 0 | 0 | 0 |
| Blind gate round 1 verdict | 0 | **5** | **5** |
| After the gate fix (`28f76a4`) | 0 | 0 | 0 |
| Blind gate round 2 | 0 | not returned | unconfirmed |

Right-sizing (principle 11): this sprint has no drivable UI surface, so it ran no app build,
no offline render and no `burst-bug-hunter` engine. The gate was **scaled**, not relaxed — a
fresh blind reviewer per round, given only the CR text, the two files at the reviewed commit
and the check script, and never this sprint's history.

---

## 3. Stats

| | |
|---|---|
| Change requests | 3 (2 shipped, 1 parked) |
| Clusters | 1 (`C1`, single file-locality group) |
| Commits | 4 (`c92335c` CR work, `98b80ac` round-1 review, `28f76a4` gate fix, `0d08c8d` tidy-up) plus this archive |
| Files changed | 2 (`.hyper-sprint/completed/README.md`, `.hyper-sprint/check-completed-index.py`) |
| Blind gate rounds | 2 (round 1 DEFECTS FOUND, round 2 not returned) |
| Blind reviewers | 2 separate sessions, neither given sprint history |

---

## 4. Before / after

The change is text, so the proof medium is the text itself rather than a screenshot. There is
no `img/` directory because there is nothing to render.

### Before — `.hyper-sprint/completed/README.md` at `9b3b759`

```markdown
| Date | Codename | Theme | Report |
|---|---|---|---|
| 2026-08-08 | Palisade | Deck-data super-hardening: ingress allowlist + reserved namespace + bounded recursion, encoder-gated CSS accent, desktop save integrity, test-hook strip from release, script-injection escape parity, CI drift guards (v13.22) | [README](./2026-08-08-palisade/README.md) |
| 2026-07-23 | Clarity | UX-clarification: gallery title cards, TOC collapse/expand, desktop save reliability, balanced image-paste grid, consistent AI animation — discovery-driven for ambiguous CRs (v13.20) | [README](./2026-07-23-clarity/README.md) |
| 2026-07-13 | Panorama | Deck-editor UX: first-slide, centered text, fixed viewport, multi-select copy, TOC context menu, move picker (v13.11) | [README](./2026-07-13-panorama/README.md) |
| 2026-07-11 | Lifeboat | Export crash + dialog/toolbar/storage UX (v13.1) | [README](./2026-07-11-lifeboat/README.md) |
| 2026-07-06 | Envoy | Native PowerPoint (.pptx) export | [README](./2026-07-06-envoy/README.md) |
| 2026-08-08 | [palisade](2026-08-08-palisade/) | deck-data hardening v13.22 (7 phases) | ✅ clean | $105.83 |
```

Defects visible above: `palisade` on two rows; a **5-cell** row against a 4-column header, so
its trailing cell never renders; that row also breaks the newest-first date order.

### After

One row per sprint, four cells per row, dates descending, one terse line per Theme. The
committed check script enforces all three properties. Independently measured by the round-1
reviewer on the committed file:

```
3 4 cells :: ['Date', 'Codename', 'Theme', 'Report']
4 4 cells :: ['---', '---', '---', '---']
5 4 cells :: ['2026-08-08', 'Palisade', ...]
6 4 cells :: ['2026-07-23', 'Clarity', ...]
7 4 cells :: ['2026-07-13', 'Panorama', ...]
8 4 cells :: ['2026-07-11', 'Lifeboat', ...]
9 4 cells :: ['2026-07-06', 'Envoy', ...]

dates: ['2026-08-08', '2026-07-23', '2026-07-13', '2026-07-11', '2026-07-06']
strictly descending: True
```

Theme cells measured at 32–83 characters with zero multi-clause sentences, in a uniform
`Area: item, item, item (vXX.XX)` shape — the round-1 reviewer's literal CR-2 finding.

### New — `.hyper-sprint/check-completed-index.py`

Python 3 standard library only. Asserts on the committed file that (a) every row of the table
has exactly 4 cells, (b) every sprint folder under `.hyper-sprint/completed/` is linked from
exactly one data row and every row links to a folder that exists, (c) data rows are sorted by
date, newest first. Exit 0 pass, 1 fail, one `FAIL: …` line per violation on stderr.

---

## 5. Assumptions and unilateral decisions

Silent mode has no escape hatch. Every decision below was taken by the orchestrator alone, on
the most conservative, smallest-diff reading.

- **CR-2 — "make the index easier to scan"** carries no acceptance criteria beyond "easier
  than before". Read as: **shorten each Theme cell to one terse line**, keeping the same four
  columns, the same five rows and the same links. No column added, no row removed, no link
  changed, because any of those is a larger diff than the request supports. *If wrong:* the
  full theme sentences are preserved in each sprint's own `README.md`, so re-wording the
  Theme column is a one-file edit with no data lost.

- **Proof medium — text instead of screenshots.** The default proof artifact embeds
  before/after screenshots. This change has no rendered surface, so §4 shows the before and
  after verbatim and no `img/` directory exists. *If wrong:* the verbatim blocks are the
  complete evidence; there is nothing further to capture for a text file.

- **Gate shape — one blind reviewer per round, no burst engine.** The `burst-bug-hunter`
  engine and its `deadline` file drive a live browser. With no drivable surface, each round
  ran as one fresh session that saw only the CR text, the two files at the reviewed commit
  and the check script, with an instruction to keep hunting for at least three further
  minutes. *If wrong:* re-run any round against the recorded SHA; the reviewer prompt is
  reproducible from §7.

- **Delegation — implementation was not delegated.** This session exposed no in-process
  sub-agent tool, so the two-file edit was made in the main context and the **gate** — the
  part that must not be self-judged — was delegated to separate, genuinely blind sessions.
  *If wrong:* re-run in a session that exposes the sub-agent tool; nothing in the committed
  result depends on where the edit was typed.

- **Gate delivery channel.** The blind sessions had no readable reply channel back to the
  orchestrator, so each was asked to commit its verdict to a file on the sprint branch. That
  instruction adds nothing to what is under review. Round 1's verdict is archived beside this
  report as `blind-gate-round-1.md`. *If wrong:* the verdict file is the reviewer's own
  words, committed by the reviewer, and can be checked against commit `98b80ac`.

- **Closing with an unreturned round.** Round 2 was dispatched twice against `0d08c8d` and
  produced no verdict inside its registered wait. The silent-mode liveness rule makes the
  expiry action "proceed and ship honestly", so the sprint closes with the gate marked **NOT
  clean** rather than waiting or quietly claiming success. *If wrong — and to close it out:*
  re-run the round-2 prompt against the current HEAD; nothing else is outstanding.

---

## 6. Parked / blocked

- **CR-3 — "Link each sprint row to its live cost dashboard."** There is no live cost
  dashboard. A repository-wide search for the phrase matches only the sprint request itself;
  no dashboard service, URL or endpoint exists here, and cost figures live inside each
  sprint's archived report rather than behind a link. Satisfying the wording literally would
  mean inventing a URL and committing a dead link to a public repository. Not attempted.
  *To unblock:* name the dashboard's URL pattern, or accept a link to the **Cost** section of
  each sprint's own archived report instead — a one-line change per row.

---

## 7. Blind gate

Both rounds were blind: a fresh session, checked out at one commit, given only the verbatim CR
text, the two in-scope files and an instruction to hunt. Neither was told a sprint was running,
what had been changed, how many rounds had run, or what an earlier round had found.

### Round 1 — commit `c92335c` — **DEFECTS FOUND** (5 in scope)

Full verdict, in the reviewer's own words: **[`blind-gate-round-1.md`](./blind-gate-round-1.md)**.

The index itself passed. The **check script** that CR-1 commissioned did not assert what CR-1
words:

1. A pipe row placed after a blank line was exempt from all three assertions — the literal
   CR-1 malformation passed silently if reintroduced that way. Blocking.
2. The header and separator rows were exempt from the 4-cell rule, although a mismatch there
   stops the table rendering at all.
3. Assertion (b) counted a folder name as a substring of the joined row text, so a folder
   named only in prose satisfied "appears on exactly one row" while its row was gone.
4. The same substring counting failed a correct index when one folder name is a prefix of
   another.
5. Occurrences were counted as rows, so one folder named twice inside a single row produced a
   factually wrong failure message.

### Fix — commit `28f76a4`

The script now walks every pipe line of the file, applies the cell-count rule to the header
and separator as well, and resolves each row to its sprint folder through the row's link
target instead of substring counting. Re-verified locally against twelve adversarial
mutations, each on a throwaway copy: the five reviewer cases, the four the CR names, a row
linking to a missing folder, a wrong-cell-count row, and the good file. Every broken input
fails and the good input passes.

### Round 2 — commit `0d08c8d` — **not returned**

Round 2 was dispatched twice to confirm the fix and to hunt again. Neither dispatch produced a
verdict inside its registered wait. Its findings are therefore **unknown**, not clean.

**What this means, stated plainly.** CR-1 and CR-2 are confirmed as user-visible outcomes by
an independent reviewer. The corrected check script is verified only by the orchestrator's own
mutation run, not by a blind one. That is why the status line reads `blind gate NOT clean`.
The one outstanding action is a round-2 rerun.

---

## 8. Cost

Measured with `.claude/skills/hyper-sprint/assets/sprint-cost.py --audit` at the mid-sprint
checkpoint. The figure covers every transcript in this project session directory, so it
includes work beyond the sprint itself; it is reported as measured rather than estimated, and
it excludes the two remote reviewer sessions, whose transcripts are not local.

| Agent | Cost | Cache-read tokens | Calls |
|---|---|---|---|
| orchestrator (main) | $7.33 | 8,660,313 | 84 |
| local sub-agent | $2.04 | 1,736,832 | 24 |
| **Total** | **$9.37** | 10,397,145 (95% of all tokens) | |

Context-bloat audit: **0 images pinned in the hub** (principle 3 holds), largest pinned
tool-result about 3,053 tokens, peak context 137,598.

---

## 9. Bugs found and fixed

| # | Found by | Bug | Status |
|---|---|---|---|
| 1 | CR-1 intake | Duplicate `palisade` row in the index | Fixed — `c92335c` |
| 2 | CR-1 intake | 5-cell row against a 4-column header; trailing cell never renders | Fixed — `c92335c` |
| 3 | CR-1 intake | Rows not in newest-first date order | Fixed — `c92335c`, now enforced by the check script |
| 4 | Blind round 1 | Check script exempted a row placed after a blank line | Fixed — `28f76a4` |
| 5 | Blind round 1 | Check script exempted the header and separator rows | Fixed — `28f76a4` |
| 6 | Blind round 1 | Folder-to-row matching was a substring count, so a row could vanish undetected | Fixed — `28f76a4` |
| 7 | Blind round 1 | Same substring count failed a correct index on prefix-colliding folder names | Fixed — `28f76a4` |
| 8 | Blind round 1 | Occurrences counted as rows, giving a wrong failure message | Fixed — `28f76a4` |

---

## 10. Out of scope — found, not fixed

The round-1 reviewer listed eight items in its own out-of-scope bucket. None failed the gate.

Left alone, as the rule requires:

1. Equal adjacent dates were accepted by the original `>` comparison.
2. A single-element list comprehension on the folder-matching line was redundant.
3. A legitimately empty archive (no folders, no rows) fails with `no data rows found`.

Swept in by the round-1 fix rather than left alone, recorded here for honesty:

4. A row pointing at a directory that does not exist is now reported. It came with rewriting
   folder matching to use the row's link target — the same change that fixes in-scope
   defects 6 and 7 — and could not be separated from it.
5. A missing index file now prints a clean `FAIL:` line instead of a traceback.
6. Non-sprint directories under `completed/` no longer fail the check, since folders are
   matched by the `YYYY-MM-DD-name` shape.
7. The script carried a shebang without the executable bit; it is now executable.

Items 4 to 7 widened the agreed diff. The rule that makes this explicit (principle 16) landed
on the branch after the fix commit; had it been in force at the time, items 5 to 7 belonged in
the list above, not in the commit.

---

## 11. Silent-mode contract self-check (`references/silent-mode.md` §6)

| Assertion | Result |
|---|---|
| Exactly one assistant message, the two-line link block | Yes |
| `.hyper-sprint/completed/2026-09-18-ember/README.md` committed and pushed | Yes |
| Link resolves | Yes |
| `sprint.json` has `"silent": true` | Yes |
| *Assumptions and unilateral decisions* present and non-empty | Yes — §5, six entries |
| *Parked / blocked* present | Yes — §6, CR-3 |
| No question asked at any point | Yes — none |
| Failure reported honestly rather than dressed up | Yes — `blind gate NOT clean`, §7 |
| No attestation written before the act it describes | Yes — see the note |

**Note on the two commit/push rows, and a correction.** An earlier revision of this file
called those rows a premature attestation and claimed they were true only because the parent
session committed the archive. **That was wrong.** This sprint committed and pushed its own
archive in `4762cea` at 23:35:48Z; the parent session committed `6feb543` twenty-nine seconds
later, having seen the directory untracked a moment before and not realising the close-out
was already in flight. The erroneous finding came from that race, not from anything the
sprint did.

The rows themselves are not a principle-17 violation. A report cannot state that it is
committed without the sentence existing before the commit — the claim and the act cannot be
ordered any other way. Principle 17 targets attestations that ship *unfulfilled*, such as the
literal `VERDICT_JSON` placeholder an early draft of `sprint.json` carried; that one was
replaced with real round data before anything was committed, which is the rule working.

Kept in place rather than deleted: a corrected record is worth more than a clean one.
