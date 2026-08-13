---
name: minify
version: 1.0
description: >-
  Compress a Markdown instruction file — CLAUDE.md, a SKILL.md, a prompt, a policy
  or reference doc — into fewer tokens without losing any rule, exception,
  quantifier or cross-reference. Use when asked to minify, compress, shorten,
  condense, tighten or "reduce the token cost of" an instruction/spec/prompt
  document. Encodes prose as Typed Rule Blocks, budgets the cut per content class
  instead of a flat ratio, predicts each file's achievable yield from its own
  measured density, and rejects any output that drops an extracted constraint.
---

# minify

Rewrite an instruction document so it costs fewer tokens and still says exactly
the same thing. **Fewer tokens is the goal; losing a rule is the failure.** The
two are measured separately and reported separately — they are never averaged
into one number.

`scripts/minify.py` is the instrument. It never edits a file and never decides.
It measures, enumerates, and reports; you do the rewriting; it proves whether
the result kept every constraint.

```bash
python3 .claude/skills/minify/scripts/minify.py --help
```

---

## The pipeline — six steps, in order

### 1. Predict this file's yield *before* touching it

```bash
minify.py predict <source>
```

> `frozen 23.4% · function-word 47.2% -> prose-rate band 24-35%`
> `predicted reduction: 18.4-26.8%`

**State the predicted range out loud before you start**, then treat it as the
target. Different files have wildly different headroom: measured achievable cuts
run from ~7% (a file that is already telegraphic, or is mostly URLs and code) to
~27% (normal-density normative prose). Two measurable inputs explain almost all
of that spread:

```
expected_reduction ≈ (1 − frozen_fraction) × prose_reduction_rate(function_word_ratio)
```

**Never quote a flat percentage** — not in the plan, not in the report, not in
this skill's own text. A fixed target is wrong on most real files. "Predicted
18–27%, delivered 21%" is honest and checkable; "typically 20%+" is not.

### 2. Plan the budget per content class

```bash
minify.py plan <source>
```

Prints bytes per class, the allowed cut for each, and the largest sections.
Compression rate is **per class, never file-wide**:

| | class | budget |
|---|---|---|
| C1 | verbatim invariants (code, URLs, exact strings) | **0%** |
| C2 | routing / lookup tables | 0–5% |
| C3 | hard constraints | 10–15% |
| C4 | sequential procedures & gates | 10–15% |
| C5 | conditional triage / booleans | 5–10% |
| C6 | rationale & war stories | 10–20% |
| C7 | orientation / background | 20–30% |

C7 is where the bytes are. C1/C2 are where the damage is. Full taxonomy with
worked examples: `references/content-classes.md`.

### 3. Take the constraint inventory — mandatory, before any edit

```bash
minify.py inventory <source> -o /tmp/inv.json
```

Every normative statement gets a stable id (`K001`…), a modality, its
quantifiers, its class, and its atoms. **This file is the contract.** Step 6
checks the minified text against it, one constraint at a time. Skipping this
step means you have no evidence you did not lose something, and self-reporting
"nothing was lost" is not evidence.

### 4. Rewrite as Typed Rule Blocks

Prose → labelled fields, one claim per line:

```
RULE sec-disclosure. Permanent — every future change, not just the current one.
WHEN public-facing text about a security fix.
SCOPE `VELA_CHANGELOG` · commit msg · PR title/body · any other public doc.
MUST high level only; MUST NOT include detail that helps reproduce the issue.
NEVER working payload · exact bypass token · step-by-step repro.
TEST reader could copy a string and trigger the bug ⇒ too much ⇒ generalize.
EXC precise mechanics MAY go to a non-public channel (private advisory).
TIE in doubt ⇒ write less.
```

Fields: `WHEN SCOPE MUST "MUST NOT" NEVER SHOULD MAY DO EXC WHY TEST REF EVID
GATE ELSE TIE NOTE RULE PATH`. Values are telegraphic — drop articles,
copulas and connectives, keep every content word that distinguishes this rule
from a neighbouring one. Full spec, legend and rewrite recipe:
`references/trb-format.md`.

Three rules that hold everywhere in step 4:

- **Modality is data, not tone.** `MUST` / `SHOULD` / `MAY` / `NEVER` are
  distinct and must survive as distinct. Flattening a document to one uniform
  imperative voice destroys the priority ordering the reader needs.
- **Quantifiers get *more* explicit, not fewer.** `any` · `all` · `only` ·
  `both` · `except` · `regardless` · `at least` — if the source implies one,
  the minified text states it. This is what earns a positive structure score.
- **Byte-frozen zones are copied byte-for-byte** (step 5).

### 5. Never touch these

| Frozen | Why |
|---|---|
| Fenced code blocks, inline code spans | A command that no longer runs is worse than a long command. |
| **URLs**, markdown link destinations `[t](url)`, link-reference definitions `[label]: url` | You cannot reword a URL. "Tidying" one silently breaks it. |
| SKILL.md frontmatter `name` and **`description`** | The `description` is the retrieval trigger. Compressing it can stop the skill being invoked at all — a failure that is invisible until someone notices the skill never fires. |
| Numeric literals, thresholds, version numbers | `≥3` and `≥30` differ by a factor of ten and by zero prose bytes. |
| Anything cited by name, heading or number elsewhere | See reference-graph integrity below. |

Frozen spans are counted, not compressed: they raise the frozen fraction, which
*lowers* the predicted yield in step 1. A link-heavy file that gives up 8% has
done as well as a prose file that gives up 25%.

### 6. Verify — both verdicts

```bash
minify.py verify <source> <minified> --inventory /tmp/inv.json [--root .] [--attest a.json]
```

Exit codes (repo convention): `0` ok · `1` size below this file's prediction ·
`2` usage · `3` not found · `4` structure/gate rejection — **do not ship** ·
`5` inventory does not match the source it was taken from.

---

## The two verdicts

They are printed as two blocks and never combined.

```
========================================================================
VERDICT 1/2 — SIZE
========================================================================
  bytes         913 -> 797  (+12.7% cut)
  tokens        wordpunct 301 -> 274 (9.0%)   byterate 228 -> 199 (12.7%)
  achieved cut  9.0%  (lower of two stdlib proxies; not a real tokenizer)
  predicted     18.4-26.8%  = (1 - frozen 23.4%) x prose-rate 24-35% at function-word 47.2%
  density       frozen 23.4% (code-only 0.0%) · function-word 47.2%
  reference     the flat >= 20% bar is reported, not gated on: not met
  RESULT        BELOW-PREDICTION  (this file was predicted to give up 18.4-26.8%; it gave up 9.0%)

========================================================================
VERDICT 2/2 — STRUCTURE
========================================================================
  constraints   7 inventoried | 7 present | 0 attested | 0 review | 0 lost
  atoms         0 failures (verbatim spans / numeric literals)
  references    5 edges before -> 5 after · 0 dropped · 0 unresolved (0 resolution-checked)
  frontmatter   PASS
  explicitness  +9 explicit quantifier/modality tokens
  score         structure_score = explicit_gain(9) - constraints_lost(0) = 9   (must be >= 0)
  RESULT        PASS
```

**SIZE** — one of `FAIL-GREW` · `IMPLAUSIBLE` · `BELOW-PREDICTION` ·
`MET-PREDICTION` · `ABOVE-PREDICTION`. The achieved cut is the *lower* of two
stdlib token proxies, so the number is conservative; byte reduction and token
reduction are not the same thing and both are shown. The old flat ≥20% bar is
printed for continuity only — it is reported, never gated on.

**STRUCTURE** — `PASS` or `REJECTED`. Rejected whenever a constraint is lost or
left in `review`, whenever a frozen atom changed, whenever a reference edge
disappeared, whenever the frontmatter moved, or whenever
`explicit_gain − constraints_lost` goes negative.

**A `REJECTED` structure verdict is not shippable at any size.** Do not offer
the output "with a caveat" — fix the file or restore the text.

---

## Judgement calls the instrument leaves to you

- **`review` items** mean a constraint was matched only weakly — usually a
  genuine rewrite the matcher cannot follow. Either restore the distinctive
  wording, or attest it — `--attest attest.json`, a JSON file mapping
  `"K005": {"line": 9, "why": "…"}`. An
  attestation is refused if the line it points at carries under half the
  constraint's distinctive tokens, and is **not applicable at all** while any
  mechanical defect is outstanding — a lost URL or a drifted number is a
  measured fact, not a judgement call.
- **`BELOW-PREDICTION` with a clean structure verdict is a legitimate outcome.**
  It usually means the verifier stopped you: restoring the tokens that cleared
  two `review` items costs bytes. Report both numbers and say which one you
  chose to protect. Do not buy the prediction back by deleting a constraint.
- **Reference-graph integrity.** If the source says "principle 3", "see
  `references/themes.md`", or cites a heading by name, that pointer must still
  resolve afterwards. `--root <dir>` additionally checks the target exists on
  disk. Renaming a heading the rest of the corpus links to breaks other files,
  not this one.

## Report format

State, in this order: the predicted range and where it came from; the achieved
cut against it; the constraint tally (`N inventoried / N present / N lost`); and
any judgement call you made. Describe the result factually — "predicted 18–27%,
delivered 21% at 47/47 constraints surviving". No superlatives, no unbacked
comparatives, no claim that is not a number the tool printed.

## Fixtures and self-test

```bash
python3 .claude/skills/minify/scripts/minify.py selftest      # 16 cases
```

`fixtures/` holds three hand-verified known-good minifications, a link-heavy
file, and one deliberately damaged variant per failure class (dropped exception,
flattened quantifier, truncated scope list, numeric drift, dropped
cross-reference, weakened modality, compressed frontmatter description, tidied
URL, output that grew). Every damaged variant must be rejected for its own
specific reason. Run `selftest` after any change to `scripts/`.

## Further reading

- `references/trb-format.md` — encoding spec, field legend, worked before/after.
- `references/content-classes.md` — C1–C7 taxonomy, budgets, how to classify.
- `references/failure-modes.md` — every known way this goes wrong and the check
  that catches it.
