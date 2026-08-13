---
name: minify
version: 1.0
description: Compress Claude-facing instruction files — CLAUDE.md, AGENTS.md, SKILL.md files, reference docs, rule/memory files, system prompts — into materially fewer tokens while keeping downstream agent behavior identical. Use this skill whenever someone asks to minify, compress, shrink, slim down, tighten, condense, "token-diet", or reduce the context cost of an instruction file; whenever they say a CLAUDE.md or SKILL.md has grown too long, bloated, or is eating too much context; or whenever they want a denser rewrite of any document that Claude itself reads as instructions rather than as prose for humans. Applies a class-aware policy — verbatim commands, paths, symbols and SKILL.md frontmatter frozen; rule blocks rewritten as labelled fields; procedures and triage logic as IF/THEN pseudocode — then reports measured byte and token reduction plus an explicit list of anything it flagged for human review instead of deciding silently. Not for compressing user-facing README or marketing copy, source code, or data files.
---

# Minify

Instruction files are read by an agent on every task, so their token cost is
paid over and over — but they are also the only thing standing between that
agent and a class of expensive mistakes. That asymmetry sets the whole
posture of this skill: **a minified file that is 40% smaller and drops one
exception clause is a loss, not a win.** Under-compressing is recoverable;
silently narrowing a rule is not, because nothing downstream will announce it.

The core move is not "write it shorter." It is: **classify each region by what
kind of instruction it is, then apply the encoder that fits that class** —
because a routing table, a hard prohibition, a procedure, and a war story have
completely different compressible slack and completely different failure modes.
Blanket compression of the whole file at one ratio is how the small words that
carry the constraint get eaten.

Two transforms are genuinely dangerous and are therefore **proposed, never
applied**: deleting rationale, and rewriting a prohibition as a positive. Both
look like obvious cleanups in a diff. Both change what the agent does on cases
the file never lists. See `references/verification.md` for why.

## Read this first

- `references/encoders.md` — the per-class recipes (what each class looks
  like, its encoder, its budget, its hazard) plus worked before/after
  examples and the canonical field/symbol legend. **Read it before STEP 4**;
  it is where the actual rewriting technique lives.
- `references/verification.md` — the failure catalogue: the specific ways a
  minified file passes a human skim while behaving differently, each with how
  to detect it. Read it before STEP 6, or earlier if the file is
  constraint-heavy (security rules, release gates, disclosure policies).

## Scope check — is this file even a candidate?

```
IF target is user-facing (README, marketing, changelog, tutorial prose)
   THEN decline: this skill optimizes for an agent reader, not a human one
IF target is source code, data, or a lockfile          THEN decline
IF target is < ~60 lines                               THEN decline: the
   legend plus field labels cost more than the prose they replace (measured:
   a 26-line file GREW 12.7% under full treatment)
IF target is mostly fenced spec / DSL / command listings (class B)
   THEN report the projected ceiling and ask before proceeding
```

Being asked to minify a file this skill cannot usefully shrink is a normal
outcome. Say so with the measured reason. Do not manufacture a reduction by
cutting content the freeze list protects.

**If the caller names a target** ("get it under 10 KB", "cut it by half"),
treat it as advisory and the freeze list as binding. Compress to the point
where the next cut would breach a freeze rule, then stop and report the
shortfall with what it would cost to close it. A number someone picked before
reading the file is not evidence about what the file can lose; delivering the
number by quietly dropping an exception clause is the exact failure this skill
exists to prevent.

## The freeze list — hard, non-negotiable

Every row is something a compressor naturally treats as slack and every row
changes behavior when touched. These are not defaults to weigh against size;
they bound the search space.

| Frozen | Why touching it breaks things |
|---|---|
| Fenced code blocks — byte-identical, info string and blank lines included | They are the spec, not a description of it. A "tidied" command is a broken instruction that reads fine. |
| Inline code spans holding paths, commands, flags, symbols, constants, globs, DSL keys, exact strings | Same. `SAFE_BLOCK_KEYS`, `--lockfile-only`, `NN / NN`, `960×540` are payload the agent copies verbatim. |
| Every file path and URL, fenced or not | A path is a lookup key. Shortening `src/parts/part-imports.jsx` to "the imports part" makes the agent grep instead of open. |
| **YAML frontmatter — all of it, byte-identical.** Above all `description` | `description` is a *retrieval key*, not documentation: it decides whether the skill loads at all. Compressing its trigger phrases makes the skill silently stop firing — and any eval that names the skill explicitly will never see the failure. |
| Heading text, heading level, heading order; any numbering others cite ("principle 7", "§3.2") | Frozen identifiers. Other files, CI scripts and hooks cite headings by title. Position also drives attention, so reordering changes salience even when nothing cites it. |
| Modal strength: MUST / MUST NOT / SHOULD / SHOULD NOT / MAY / NEVER / ALWAYS | The hardness ordering *is* the information. Flattening a MUST NOT into an undifferentiated bullet turns a prohibition into a tip. |
| Quantifiers and scope words: every, each, any, all, only, no, none, at least, at most | "no deck-supplied value may…" ≠ "deck values must not…". The first is universal; the second invites exceptions. |
| Exception clauses: except…, unless…, only if/when…, other than…, does not apply to… | Tiny in tokens, maximal in effect, and shaped exactly like filler. Give each one its own `EXCEPT:` field so nothing can absorb it. |
| Negative polarity — a prohibition stays negative | See the flag protocol below. |
| Numbers, thresholds, versions, counts, exit codes | "361 tests", "~300 lines", "exit 4" are checkable facts. Rounding them off makes the agent guess. |

## Process

### STEP 1 — snapshot and place the output

```
snapshot original (git-tracked or copy to <name>.orig)
write minified to a NEW path — default <stem>.min<ext>, or the path the caller names
GATE: never overwrite the original in the same step as the rewrite
```

The original must survive as a baseline: without it there is nothing to
measure against, nothing to A/B, and no way to undo a bad cut. If the caller
wants in-place replacement, do it as a separate, explicit second step after
verification passes.

### STEP 2 — cross-reference scan, before any edit

```bash
python3 .claude/skills/minify/scripts/minify-check.py xref <target> --root . [--exclude <dir>]
```

This lists which headings other files cite, which files point at the target,
and what numbered references exist. Run it **first**, because the result
constrains the restructuring you are allowed to do — discovering afterwards
that CI parses a heading you merged is a rollback, not a fix.

Matching is deliberately over-inclusive; confirm each hit. Treat any cited
heading as frozen. If a heading looks like it must change anyway, that is a
flag for the human (FLAG-X), not a decision to make alone.

### STEP 3 — classify into a region map

Walk the file top to bottom and label every region with one class. Regions are
contiguous and the map must cover the whole file — an unlabelled region is one
you will compress by reflex. Record it as a small table (heading → class →
planned encoder → budget) and keep it; it becomes part of the self-report.

| Class | What it is | Encoder | Budget | Main hazard |
|---|---|---|---|---|
| **A** Routing / lookup tables | "where X lives", symbol→file rows | Light: trim cell glue only | ~10-15% | Cells that smuggle a conditional ("read Y first") get columnized away |
| **B** Verbatim invariants | commands, trees, CLI grammar, DSL/key maps, schemas | **None. Frozen.** | 0% | Any edit at all |
| **C** Hard constraints | scope + rule + DO/DON'T + tie-breaker, written as paragraphs | Labelled fields + telegraphic prose inside them | 35-45% | Losing an exception or a modal while reshaping |
| **D** Sequential procedures & gates | phases, ordered steps, stop rules, retries | `STEP n:` / `GATE:` pseudocode | 35-50% | Gate polarity and ordering are load-bearing |
| **E** Conditional triage | "full read required if ANY of: …" | `IF <predicate> THEN <action>`, one predicate per line | 40-60% local | AND/OR ambiguity; a THEN branch read as advisory |
| **F** Rationale, evidence, war stories | "we shipped this bug once", measured costs, repeated emphasis | Condense duplicated *evidence* only; **keep every imperative** | flag-gated | Rationale is what generalizes a rule to the unlisted case |
| **G** Orientation / background | "what this project is", architecture narrative | Telegraphic prose | 30-40% | Deleting context the rest of the file assumes |

Budgets are expectations for sanity-checking, not targets to hit. A class C
region that only compresses 20% because it is already tight is a correct
result; forcing it to 40% is not.

### STEP 4 — encode, region by region

Read `references/encoders.md` now. Work one region at a time and keep the
file's structure fixed: same headings, same order, same section boundaries.
Minification is a *within-region* rewrite. Merging sections, moving a rule to
a better home, or reordering for flow are separate proposals — they change
salience and dangle citations, and they make the diff unreviewable.

The telegraphic rules that apply inside every non-frozen class:

**Delete:** articles; copulas where the predicate is unambiguous; expletive
*there is / it is*; hedges (*generally, typically, in most cases, you might
want to*); discourse connectives (*however, that said, in other words*);
meta-commentary about the document itself; second mentions of a noun the
field label already establishes.

**Keep, always:** modals; quantifiers; negators; **prepositions** (they encode
the relation — "sanitize X before Y" inverts without them); exception
conjunctions; temporal/ordering words (before, after, first, then, until);
identifiers and literals; the subject of each rule, restated rather than
pronoun-chained across lines.

**Stop compressing a line when** the next cut would remove one of the "keep"
items, make the actor or object ambiguous, produce something a maintainer
could not confidently hand-edit, or require the reader to look at a different
line to know what this one governs. Telegraphic ≠ cryptic: the target is a
terse imperative, not a keyword soup.

### STEP 5 — legend

If the minified file introduces notation the original did not use — field
labels, `IF/THEN`, `→` — put a short fixed legend near the top, before the
first use.

```
> Legend — `RULE:` binding requirement · `EXCEPT:` carve-out (never merged into RULE)
> · `DO:`/`NEVER:` allow/deny lists · `STEP n:`/`GATE:` ordered step, blocking check
> · `WHY:` rationale · `SEE:` canonical statement elsewhere
```

Include only labels the file actually uses. The legend is not decoration: a
dense file invites appends in the old verbose style, and within a few edits it
becomes a mixed dialect that is neither compact nor consistent. The legend is
what a future editor imitates. Use the canonical label set from
`references/encoders.md` rather than inventing per-file variants — consistency
across minified files is worth more than a locally cuter notation.

### STEP 6 — verify

```bash
python3 .claude/skills/minify/scripts/minify-check.py report <orig> <min>
```

HARD findings must be fixed before delivering — each is a frozen item that
moved. REVIEW findings each need an explicit justification in the self-report;
"the count dropped because the same rule was stated twice and I kept both
statements" is a justification, silence is not.

Then do the pass the script cannot: read `references/verification.md` and walk
its checklist against the diff. Static checks catch deletions. They cannot see
a rule that still parses and now means something narrower — a scope quietly
widened from "deck-supplied values" to "values", a gate that became a
suggestion, an AND that became an OR.

### STEP 7 — self-report

Emit the report below. Two things it must never do: claim behavioral
equivalence (nothing here tested that), or bury the flags. Models
systematically overestimate their own compliance, so the report's job is to
expose decisions for review, not to reassure.

## Flag, don't decide

Three things are surfaced as proposals. For each, **the minified file keeps the
original behavior** — the flag describes an *additional* change available if a
human approves it. This is what makes the delivered file safe by default, and
it is why the report separates "achieved" from "available with approval".

**FLAG-R (rationale cut).** Rationale is the highest-risk class to delete
because rules without a *why* get followed literally and never extended to the
analogous case the file did not list. Repetition is often deliberate salience
engineering, not waste. So: **never delete a repeated imperative** — keep
every restatement of the instruction itself. Only *supporting evidence* on a
second or later occurrence is a candidate for condensing to a back-reference,
and even that gets flagged. State what would be cut, why it looks redundant,
and what generalization could be lost if it is wrong.

**FLAG-N (negation rewrite).** Turning "never X" into "always Y" is tempting —
models comply with positive instructions more reliably — but it narrows the
prohibition whenever Y is only one of several ways to satisfy it. Propose the
positive form *in addition to* the prohibition, never as a replacement, and let
the human decide.

**FLAG-X (ambiguous cross-reference).** Any heading, number, or pointer where
minification would be cleaner if it changed, and something else may cite it.
Include what cites it (from STEP 2) and what would need updating in lockstep.

**Content that looks wrong is also a flag, not a fix.** Minification will
surface stale paths, contradictions between two sections, and rules that no
longer match the repo. Fixing them inside the same rewrite makes the diff
unreviewable — nobody can tell a compression from a semantic edit, and the
whole value of the delivered file rests on that distinction being auditable.
Note them for a separate change.

## Self-report template

```markdown
## Minify report — <file>

**Achieved:** <bytes before> → <bytes after> (**-X.X%**); est. tokens
<before> → <after> (**-X.X%**).
Token counts are a heuristic proxy — no Claude tokenizer is available here, so
both files are measured the same way and only the *ratio* is meaningful.
Bytes are exact.

**Available with approval:** additional ~<N> bytes if the FLAG-R/FLAG-N items
below are accepted. Not applied.

### Region map
| Section | Class | Encoder | Before → After | Δ |
|---|---|---|---|---|

### Flagged for human review — not applied
| ID | Type | Location | Proposal | Risk if accepted wrongly |
|---|---|---|---|---|
(FLAG-R…, FLAG-N…, FLAG-X…; or "none")

### Invariant checks
<minify-check report output: HARD must be empty; each REVIEW line justified>

### What this report does not establish
Behavioral equivalence is unverified. These are structural checks plus my own
reading; the only evidence that the minified file drives the same agent
behavior is an eval that scores *observed behavior* on real tasks. Recommended
before adopting: <the specific rules in this file most worth testing>.
```

## Multiple files

Do the full process per file — classification is per-file work and batching it
is how a policy from one file gets applied to another where it does not fit.
Then give one combined report: a row per file plus the average reduction across
them. Report the average and the spread; a 40%/8% pair is a different result
from 24%/24% and the difference is usually that one file was mostly class B.

## Cheat sheet

```
STEP 1 snapshot; write to a new path
STEP 2 xref BEFORE editing; cited headings are frozen
STEP 3 region map covering 100% of the file; one class per region
STEP 4 encode within regions; structure and order unchanged
STEP 5 legend if new notation
STEP 6 minify-check report; HARD = fix, REVIEW = justify; then the manual checklist
STEP 7 self-report with flags exposed and equivalence explicitly unclaimed
GATE:  when in doubt, keep the words. Under-compression is a smaller error
       than a rule that quietly got narrower.
```
