# Content classes C1–C7

A flat compression ratio is the single most reliable way to break an
instruction file. The same 20% cut that harmlessly removes background prose
destroys a lookup table. Every unit of the document gets a class, and every
class gets its own budget.

`minify.py plan <source>` does this automatically and prints bytes per class,
allowed cut per class, and the largest sections. The classifier is a heuristic —
read its output and override it where it is wrong.

| Class | Content | Budget | Risk if over-cut |
|---|---|---|---|
| **C1** | Verbatim invariants | **0%** | critical |
| **C2** | Routing / lookup tables | 0–5% | high |
| **C3** | Hard constraints | 10–15% | high |
| **C4** | Sequential procedures & gates | 10–15% | medium-high |
| **C5** | Conditional triage / booleans | 5–10% | critical |
| **C6** | Rationale & war stories | 10–20% | critical |
| **C7** | Orientation / background | 20–30% | low |

---

## C1 — verbatim invariants · budget 0%

Commands, code spans, fenced blocks, file paths, **URLs, markdown link
destinations `[text](url)`, link-reference definitions `[label]: url`**,
version strings, numeric thresholds, exact quoted example strings, error
messages the reader will grep for.

Copied byte for byte. Not retyped, not "tidied", not shortened. A shortened URL
is a dead URL; a rounded threshold is a different rule.

C1 is measured, not compressed, and it is the dominant term in the yield
prediction: a file that is 40% frozen has at most 60% of itself available. This
is why link-heavy and example-heavy documents legitimately give up far less than
prose documents, and why judging them against the same percentage is wrong.

> Counting only code spans as frozen — and treating URLs as compressible prose —
> understates C1 badly. On one measured file the frozen fraction moved from 5.0%
> to 37.5% once link machinery was counted, which is the difference between
> "this file has plenty of headroom" and "this file is nearly all payload".

## C2 — routing / lookup tables · budget 0–5%

"Where does X live" tables, symbol→file maps, exit-code tables, key maps,
glossaries. The reader arrives with a specific key and needs the row.

Rows are indivisible. You may compress the *column headers* and the surrounding
paragraph; you may not merge two rows, drop the "rare" row, or replace a set of
examples with "etc.". A missing row sends the reader on a tree scan, which costs
far more tokens than the row saved.

## C3 — hard constraints · budget 10–15%

MUST / MUST NOT / NEVER / SHOULD / MAY statements, security rules, policy.
This is what the whole exercise exists to protect.

TRB pays for itself best here: the prose glue around a constraint ("It is
important that you always remember to…") is pure overhead, while the constraint
itself is nearly incompressible. Every quantifier, every exception clause, every
modality token survives. When in doubt in C3, cut less.

## C4 — sequential procedures & gates · budget 10–15%

Numbered steps, stage lists, build pipelines, "do this before that", blocking
checks and their failure branches.

**Order is semantics.** Reordering steps to make them read better changes what
the document says. Keep the ordinals — a reader who is told "run step 3" needs
step 3 to still be step 3. Failure branches (`ELSE`) are load-bearing: a gate
with no stated consequence gets skipped.

## C5 — conditional triage / booleans · budget 5–10%

"If A and B but not C, then…", triage sections, decision tables, scoping rules
with multiple arms.

The lowest budget outside C1/C2, because these compress *badly*: the words that
look like filler (`and`, `or`, `unless`, `either`, `both`, `only`, `at least`)
are the logic. Flattening a disjunction of five conditions into "in these
cases" silently changes which cases. Prefer explicit operators — `ANY of` /
`ALL of` / `ONLY IF BOTH` — which are both shorter and less ambiguous than the
prose they replace.

## C6 — rationale & war stories · budget 10–20%

Why a rule exists. Measurements, incidents, cost figures, "this happened once
and here is what it cost".

Marked **critical** despite the mid-range budget, and this is the class agents
get wrong most often — rationale *looks* like padding. It is not. A rule whose
reason has been deleted is a rule that gets argued with, worked around, or
"improved" by the next reader. Compress the storytelling; keep the number, the
outcome, and the causal link. `EVID` exists for exactly this: one line, the
measurement, no narrative.

## C7 — orientation / background · budget 20–30%

Intros, restatements of the heading, transitions, motivational framing,
"as mentioned above", second sentences that rephrase the first, emphasis
markup, headings' worth of preamble before the actual content.

The largest budget and the largest available byte pool in most real files.
Nearly all of a good minification's yield comes from C7 plus the glue removed
from C3–C6. If the plan shows a small C7, the file is already dense and the
prediction will be correspondingly low — that is information, not a problem to
solve by cutting into C3.

---

## How the classifier decides

In order, first match wins:

1. Markdown table → **C2**
2. Conditional marker (`if`/`when`/`unless`/…) **and** ≥2 distinct quantifiers → **C5**
3. Constraint hint (`critical`, `must`, `never`, `non-negotiable`, ✅/❌, …) **and** a detected modality → **C3**
4. Procedure hint (`phase`, `step`, `gate`, `first`, `order`, `pipeline`, …) **and** the unit is ordered/a list/a heading → **C4**
5. Rationale hint (`why`, `because`, `measured`, `rationale`, `$`, `otherwise`, …) → **C6**
6. Any detected modality → **C3**
7. Otherwise → **C7**

Verbatim spans are extracted before classification and added to C1 wholesale, so
a code-heavy C7 paragraph does not inherit a 30% budget over its own code.

The classifier is deliberately conservative in one direction: an ambiguous unit
carrying any modality lands in C3 (10–15%) rather than C7 (20–30%). Misfiling a
background sentence as a constraint costs a few bytes; the reverse costs a rule.
