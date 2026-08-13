# Failure modes

Every known way a minification goes wrong, and the check that catches it.
Twelve are mechanical — `minify.py verify` finds them and rejects. Ten are
judgement calls the instrument cannot make; they are listed anyway, because
knowing a check does not exist is the point.

Column *Detected by* names the exact defect string the tool prints, so a
rejection can be read back to this table.

## Mechanically detected

| # | Failure | Detected by |
|---|---|---|
| **R1** | **Quantifier & modality erosion.** MUST/NEVER/SHOULD/MAY flattened to a uniform imperative; "any"/"all"/"only" dropped. | `modality-weakened:X->Y`, `quantifier-erosion:<q>` |
| **R2** | **Dropped exception clauses.** The carve-out is deleted and the rule silently becomes absolute. | `exception-clause-lost`, constraint `lost` |
| **R3** | **Negation→positive rewriting that narrows a prohibition.** "never do X" becomes "prefer Y", which permits X. | `polarity-flipped`, `hedge-hardened:-><M>` |
| **R6** | **Reference breakage.** A cited file, heading or numbered item no longer exists or is no longer cited. | `reference-dropped:<target>`, `REFS dropped [...]`, `unresolved` (with `--root`) |
| **R7** | **Frontmatter `description` compressed.** It is a retrieval key: shrink it and the skill may stop being invoked, invisibly. | `frontmatter REJECTED` — any change to `name` or `description` |
| **R8** | **Verbatim payload corruption.** A command, path, code span or URL was retyped, tidied or truncated. | `verbatim-span-lost[Vnnn]: '<span>'`, `verbatim-missing:` |
| **R11** | **Byte reduction ≠ token reduction.** Telegraphic separators (`·`, `⇒`) cut bytes but can add tokens. | Both proxies printed; achieved cut is the **lower** of the two |
| **R12** | **Scope-list truncation.** A five-item `SCOPE` quietly becomes three items plus "etc.". | `enum-item-missing:<item>`, `verbatim-span-lost` for coded items |
| **R13** | **Example-set erosion.** Worked examples are calibration anchors, not decoration; dropping half changes where the reader draws the line. | `enum-item-missing`, `parenthetical-lost` |
| **R14** | **Conjunction/disjunction flattening.** `ANY of` becoming `ALL of`, or a disjunction becoming a vague list. | `quantifier-erosion:any` / `:all` / `:both` / `:neither` |
| **R15** | **Default-vs-hard-rule collapse.** A hedged default hardening into a hard rule, or a hard rule softening into a preference. | `hedge-hardened:-><M>`, `modality-weakened:MUST->SHOULD` |
| **R16** | **Numeric and threshold drift.** A rounded or "tidied" number is a different rule. | `numeric-drift:<n>`, `numeric-literal-lost: <n>` |

Two more mechanical guards sit on the size side:

- **Output grew** → `FAIL-GREW`. A "minification" that added bytes.
- **Implausible cut** → `IMPLAUSIBLE` at >60%. No measured probe compressed
  faithfully anywhere near that far, so a number that large means content was
  deleted rather than compressed. The structure verdict then names what.
- Additional flags, printed but not gating: the two token proxies disagreeing by
  more than 5 points, a byte cut overstating the token cut by more than 5
  points, a prediction extrapolated below the lowest calibrated density band,
  and a file more than 50% frozen (small reachable prize however well rewritten).

## Not mechanically detected — your judgement

| # | Failure | What to do instead |
|---|---|---|
| **R4** | **Salience loss from deduplication or reordering.** A rule repeated three times in the source was emphasised on purpose; folding it to one mention makes it easier to miss even though it is still "present". | Keep at least one high-salience marker (heading, `CRITICAL`, position near the top) for anything the source repeated. Presence ≠ salience, and the survival check only measures presence. |
| **R5** | **Rationale removal breaking generalisation.** The rule survives; the reason it exists does not, so the reader cannot apply it to a novel case. | C6 budget is 10–20% and marked critical for this reason. Compress narrative, keep the causal link and the number (`EVID`). |
| **R10** | **Human-edit dialect drift.** Months of hand-edits to a TRB file gradually re-introduce prose, so the format decays. | Re-run `plan` / `predict` periodically; the density numbers show drift before it is visible. |
| **R17** | **Ordering-as-semantics.** Some sequences *are* the content — build orders, dependency chains, gate sequences. Reordering for readability changes meaning. | Never reorder inside C4. Keep ordinals stable so "step 3" still points at step 3. |
| **R18** | **Conditional-scope leakage.** A rule scoped to one branch becomes global (or vice versa) because the scoping clause was folded away. | Keep `WHEN`/`SCOPE` as their own lines. A constraint whose scope moved often still matches on tokens and passes — this is a real gap. |
| **R19** | **Position effects.** Identical rules are followed at different rates depending on where they sit in the file. Minification moves things. | Do not relocate a constraint across sections while minifying. Change one thing at a time. |
| **R20** | **Eval contamination.** Measuring a minification with the same instrument or the same fixtures used to tune it. | Hold out real files from the fixture set. `selftest` proves the detectors work; it does not prove a new file was minified well. |
| **R21** | **Register/tone shift.** TRB reads as terse and mechanical; this shifts how the reader (human or model) weighs the text, independently of content. | Real effect, not measurable here. Prefer TRB for constraint-dense files; leave narrative onboarding docs in prose. |
| **R22** | **Verbosity and judge bias.** Longer text is systematically rated better by both human and model reviewers, which biases any "is the minified version as good?" comparison. | This is why size and structure are two verdicts and never one score, and why the structure verdict is a constraint tally rather than a rating. |
| **R9** | **Self-report is not evidence.** "I checked, nothing was lost" is a claim, not a measurement. | The inventory is taken *before* any edit and hashed against the source; `verify` refuses a mismatched inventory (exit 5). Never report survival without an inventory-backed run. |

## The attestation escape hatch, and its floor

A genuine restructuring can leave a constraint present but unmatchable — the
matcher is lexical. That produces `review`, which rejects. You may attest:

`--attest` takes the path to a JSON file mapping constraint id → `{line, why}`:

```json
{ "K005": { "line": 9, "why": "merged into the SCOPE line above" } }
```

```bash
minify.py verify src.md out.md --inventory inv.json --attest attest.json
```

Two floors keep this from becoming a rubber stamp:

1. The attested line must carry **≥50% of the constraint's distinctive tokens**.
   Pointing at a vaguely related line is refused.
2. Attestation is **not applicable at all** while any mechanical defect is
   outstanding. A lost URL or a drifted number is a measured fact, not a
   judgement call — it has to be fixed in the file, and it can never be
   attested away.

## Reading a rejection

```
    K006  LOST     coverage=0.31  match=L11
      defects: quantifier-erosion:only · exception-clause-lost
    ATOM LOST  verbatim-span-lost[V009]: 'assemble.py'
```

`coverage` is the share of the constraint's distinctive tokens found in the best
matching window of the minified file. Below ~0.55 the constraint is treated as
lost; between 0.55 and 0.80 it is `review`. The fix is almost always to restore
the specific tokens named in the defects — not to rewrite the line again from
scratch, and not to lower the bar.
