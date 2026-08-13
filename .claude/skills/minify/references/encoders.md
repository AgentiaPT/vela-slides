# Encoders — per-class recipes

Read before STEP 4. Each card: how to recognize the class, what to do, a
worked example, and the check that catches the class's characteristic mistake.

Worked examples below are measured with
`scripts/minify-check.py measure`. Two of them compress far less than the
class budget suggests — that is deliberate. The budgets come from verbose
real-world sources; a source that is already tight yields less, and the honest
result is the smaller number, not a forced cut.

## Canonical vocabulary

Use these labels and only these. Consistency across minified files is worth
more than a locally cuter notation, because the labels are what a future
editor imitates when appending.

| Label | Holds | Notes |
|---|---|---|
| `SCOPE:` | what/where/who the rule governs | keep quantifiers verbatim |
| `RULE:` | the binding requirement | carry MUST / MUST NOT / SHOULD / MAY unchanged |
| `DO:` | required or allowed specifics | `;`-separated list |
| `NEVER:` | prohibitions | `;`-separated; stays negative |
| `EXCEPT:` | carve-outs, conditions that suspend the rule | **never merged into `RULE:`** — its own line is what stops it being absorbed |
| `IF:` / `THEN:` / `ELSE IF:` | conditional logic | one predicate per line |
| `STEP n:` | ordered procedure step | numbering is a citable identifier |
| `GATE:` | blocking pre/postcondition | must read as blocking, not advisory |
| `TEST:` | how to check compliance | the operational version of the rule |
| `WHY:` | rationale | kept, condensed; never silently dropped |
| `SEE:` | pointer to the canonical statement | for dedup that survives review |

**Symbols: default to keywords.** `→` for "then/implies" is the only glyph
worth its legend line. A wider symbol inventory saves ~1 token per use and
costs a legend, ambiguity for both reader and maintainer, and a dialect that
decays on the first hand-edit. `THEN` is unambiguous to everyone; `∀` is not.

## A — routing / lookup tables

**Recognize:** rows mapping a task or symbol to a location. Payload is mostly
literal identifiers. Already near the information floor.

**Do:** trim connective glue inside cells ("— the `switch` statement that
handles it" → "`switch (block.type)`"). Drop repeated column-name echoes.
Keep every identifier. Budget ~10-15%; if a table gives more than that, check
what you removed.

**Never:** columnize away a cell that contains an *instruction* rather than a
location. Routing tables quietly accumulate conditionals — "read the security
skill first", "if you touch either, keep them identical" — and pressure to
make cells uniform strips exactly those.

```
Before | Sanitization / a new field | src/parts/part-imports.jsx | `SAFE_SLIDE_KEYS`,
       | `sanitizeBlock` … . Read `.claude/skills/vela-secure-coding/SKILL.md` first |
After  | same row, glue trimmed, and the "Read … first" clause KEPT VERBATIM     |
```

**Check:** every conditional that was in a cell is still in a cell.

## B — verbatim invariants

**Recognize:** fenced commands, directory trees, CLI grammar, key maps, block
catalogues, schemas, exact error strings.

**Do:** nothing. 0%. Copy byte-for-byte.

The temptation is real — trees and command lists are visually bulky and look
like the biggest win on the page. They are the spec itself; a reformatted tree
is a wrong tree. If a file is mostly class B, its ceiling is low, and saying so
is the correct output.

**Check:** `minify-check verify` reports every fenced block as verbatim.

## C — hard constraints (scope + rule + allow/deny)

**Recognize:** a paragraph or section that establishes *who/what it applies to*,
*a requirement*, *things to do*, *things not to do*, and often a tie-breaker.
The highest compression-per-unit-risk class, because the latent structure is
already there — it is just wrapped in sentences.

**Do:** lift it into the labelled fields. The field set doubles as a checklist:
an empty `EXCEPT:` where the prose had a carve-out is visible in a way a missing
clause in a paragraph never is.

Measured: 976 → 723 B (**-25.9%**, est. tokens -23.5%) on the example below.
Hand-probes on more verbose real sections reached -45%.

```
BEFORE (prose)
Any public-facing text about a security fix must not include detail that helps
reproduce the issue in the wild. This applies to changelog entries, commit
messages, PR titles and bodies, code review comments, and any other document
that ends up publicly exposed. For any security-related change, describe it at
a high level only: you should state the class of issue, the severity, the
affected area, what the fix does, and that regression tests were added. Do not
include working payloads or example attack strings, the exact bypass token,
step-by-step reproduction, precise maps of where the gap was, or chained
exploit references that amount to a recipe. The rule of thumb is that if a
reader could copy a string or follow the steps to trigger the bug, it is too
much and you should generalize it. Precise mechanics belong in non-public
channels, or, where genuinely needed for maintenance, in in-code comments,
which are maintainer-facing and not surfaced in release notes.

AFTER (labelled fields)
SCOPE: every public-exposed text about a security fix — changelog, commit msg,
PR title/body, review comments, any other public doc.
RULE: MUST NOT include detail sufficient to reproduce the issue in the wild.
DO: class of issue; severity; affected area; what the fix does; that
regression tests were added.
NEVER: working payloads or example attack strings; the exact bypass token;
step-by-step repro; maps of where the gap was; chained exploit references.
TEST: could a reader copy a string or follow the steps and trigger it? Then
generalize.
EXCEPT: precise mechanics MAY live in non-public channels, or in in-code
comments where genuinely needed for maintenance (maintainer-facing, never
surfaced in release notes).
```

Note what survived: `MUST NOT` (not "avoid"), `every` (not "public text"),
`MAY` in the exception (not "can"), and the whole tie-breaker as `TEST:`. The
exception got its own field precisely because in the original it was the last
clause of the last sentence — the position a compressor trims first.

**Check:** for each field, ask what the prose said that this field does not
hold. Then check the reverse: does any field now say something broader than the
prose did? Widening is as wrong as dropping.

`minify-check verify` on this very example returns four REVIEW lines — and
they are all fair. `SHOULD` 2 → 0 (both were non-binding "you should" phrasings
that became `DO:` and `TEST:` fields), `ONLY` 1 → 0 ("high level only" became
`RULE: MUST NOT include detail sufficient to…"), and the universal-quantifier
family 3 → 2 (three separate "any …" scopes were consolidated into one
`SCOPE:` line). Each needs one sentence of justification in the report. That
is the intended workload: a faithful rewrite still produces review items, and
answering them is how the erosion gets caught.

## D — sequential procedures and gates

**Recognize:** phases, ordered steps, stop rules, retry logic, "do this before
that". Narrated in prose with the ordering carried by connectives.

**Do:** `STEP n:` per step, `GATE:` for anything blocking. One line per atomic
action. Preserve the original numbering if anything cites it.

Measured: 751 → 412 B (**-45.1%**, est. tokens -38.7%).

```
BEFORE
Start with the cheap offline checks, which take under a second and give you no
excuse to skip them. If a manifest is unwatched or the two root lockfiles have
drifted, these are structural problems that make everything downstream
untrustworthy, so you should fix them before looking at versions at all. Once
that is clean, move on to finding out what is actually available, which takes
about ten seconds and needs the network. Note that you have to install the
trees first, because otherwise the audit half of the run reports nothing at
all — and an uninstalled tree is silence rather than a clean bill of health.
Finally, run the supply-chain vetting stage. This adds provenance, publisher
identity and install-hook deltas for each eligible target.

AFTER
STEP 1: offline checks (<1s). Unwatched manifest? Lockfile drift?
  GATE: both are structural — fix before looking at any version.
STEP 2: availability scan (~10s, network).
  GATE: install the trees first. Uninstalled tree = silence, NOT a clean bill
  of health — the audit half reports nothing.
STEP 3: supply-chain vetting. Adds provenance, publisher identity, install-hook
  deltas per eligible target.
```

The "uninstalled tree is silence, not a clean bill of health" line is rationale
and it stayed. It is the difference between an agent that reruns the install
and one that reports a clean audit it never actually ran.

**Check:** gate polarity (does the GATE still *block*, or has it become a
note?), ordering, and every precondition. A `GATE:` that reads as advisory is
the characteristic failure of this class.

## E — conditional triage

**Recognize:** genuine boolean logic in prose — "full read required if your
change does ANY of: …", "the quick path is enough when …".

**Do:** `IF <predicate> THEN <action>`, one predicate per line, with the
quantifier over the predicate list (`ANY of` / `ALL of`) made explicit. The
main win here is not size but disambiguation: prose triage lists routinely
leave AND/OR unresolved, and writing them out forces the question.

Measured: 373 → 290 B (**-22.3%**) — modest, because the source was already
tight. Verbose triage sections give much more.

```
BEFORE
The quick path is enough when your change only touches static application
chrome or editor UI. But a full read of this skill is mandatory if your change
does any of the following: touches deck values or anything derived from them,
modifies a sanitizer or an allowlist, adds or changes an exporter, or touches
server or native code. When you are in doubt, do the full read.

AFTER
IF change touches ANY of: deck values or anything derived from them; a
sanitizer or allowlist; an exporter; server or native code
  THEN full read of this skill is MANDATORY.
ELSE IF change touches ONLY static app chrome / editor UI
  THEN quick path is enough.
IF in doubt THEN full read.
```

`ANY`, `ONLY`, `MANDATORY` and the in-doubt default all survive. Dropping the
last line would leave the two branches non-exhaustive and hand the ambiguous
case to the agent's discretion — the exact case the line exists for.

**Check:** predicates unchanged in number and scope; AND/OR explicit; the
default/fallback branch still present; THEN clauses phrased as actions, not
observations.

## F — rationale, evidence, war stories

**Recognize:** "we shipped this bug once"; measured costs; the same point made
three times in different sections; parenthetical evidence.

This is the biggest raw bucket in most instruction files and the biggest trap.
Two facts pull against each other: duplicated anecdotes are the most obviously
cuttable text in the file, and rationale plus repetition is what makes an agent
generalize a rule to a case the file never listed, and measurably raises
adherence. So the policy is asymmetric on purpose:

```
Repeated IMPERATIVE ("never pull a screenshot into the hub")
  → KEEP every occurrence. Do not consolidate. Salience is the point.
Repeated EVIDENCE (the same cost figure / anecdote, 2nd+ occurrence)
  → candidate for a SEE: back-reference. FLAG-R. Do not apply.
First occurrence of any rationale
  → KEEP. Condense wording; do not remove the causal claim.
Rationale attached to a rule with no other justification
  → KEEP verbatim-ish. It is doing the most work of any line in the file.
```

```
BEFORE (3rd occurrence in the file)
Remember that the orchestrator does not do implementation work itself. On the
last run this mattered: the session spent $59.74 across 375 turns, and the
cache-read rate of 94% only held because the hub stayed small.

AFTER (proposed, FLAG-R — not applied)
RULE: orchestrator does NOT implement. (SEE: §Phases for the cost evidence.)
```

The imperative survives at full strength; only the third telling of the
evidence becomes a pointer. Even this is flagged, because if the author
repeated it three times it may have been because it was being violated.

**Check:** count imperatives before and after — the count must not drop. Then
ask of each remaining rule: could an agent facing an analogous-but-unlisted
case still infer the right call? If the answer changed, restore the rationale.

## G — orientation and background

**Recognize:** "what this project is", architecture narrative, tour-of-the-repo
prose. Partly inferable from the repo itself.

**Do:** telegraphic prose. Keep the facts an agent cannot cheaply derive
(invariants, non-obvious relationships, the canonical name for a thing); drop
the tutorial framing and the restatements of defaults.

```
BEFORE  The build is a simple concatenation step. There is no bundler
        involved — instead, a small Python script joins the part-files
        together in a fixed dependency order, which takes about 10ms.
AFTER   Build: Python stdlib concatenation, fixed dependency order (~10ms).
        No bundler.
```

**Check:** the rest of the file does not assume a fact you just deleted. This
class is where "inferable from the repo" reasoning is most defensible and where
it is most often wrong — the agent's prior is not the same as the repo's
convention.

## When a region does not fit one class

Split it. A section that is a rule plus its procedure plus its war story is
three regions with three encoders, not one compromise encoder. Mixed regions
compressed at one ratio are where exceptions get lost — the exception belongs
to the rule half, and the war-story half is what set the ratio.
