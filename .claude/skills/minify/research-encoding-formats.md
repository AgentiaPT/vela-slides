# Research: compression-encoding hypotheses for LLM instruction files

Source: Opus research agent, 2026-08-13. Full report, lightly formatted.

## 0. Framing

The object being optimized is not "text length" but *reliable retrieval-and-execution under distraction*. An instruction file competes with tool output, code, and conversation for attention. Two failure modes matter:

- **Comprehension failure** — the model misparses a compressed line.
- **Salience failure** — the model parses it fine but doesn't *act* on it, because compression stripped the emphasis/redundancy that made the rule feel binding.

Salience failure is the underrated one. Much of what looks like "filler" in a good CLAUDE.md ("**Mandatory**", "this is permanent and applies to every future change", "when in doubt, full read") is not information — it is *priority marking*. Delete it and the token count drops with no measurable comprehension loss on a quiz, yet compliance drops in a live agent loop. Any eval that scores comprehension rather than compliance will systematically over-recommend aggressive compression.

## 1. Ranked candidate strategies

Reduction figures are rough, relative to an *already-dense* file like this repo's CLAUDE.md; a verbose file would yield 2-3x more.

| # | Strategy | Reduction | Risk | Verdict |
|---|---|---|---|---|
| 8 | Hybrid: compress mechanical, preserve normative | 15-30% | Low | **Primary** |
| 1 | Prose trimming (full sentences kept) | 10-20% | Low | Fallback / always-on baseline |
| 6 | Reference-by-pointer (lazy loading) | 20-50% on paper | Medium | Big remaining lever, but shifts cost to tool calls |
| 5 | Table/bullet restructuring | 3-8% marginal | Low | Mostly exhausted in this repo |
| 3 | Structured pseudo-code / DSL | 20-35% | Medium-High | Only for genuinely enumerable content |
| 4 | Shorthand + legend | 15-25% | High | Not recommended |
| 2 | Caveman / telegraphic English | 15-25% | High | Not recommended |
| 7 | Emoji/glyph substitution | 0-5%, often negative | High | Reject |

### Notes on the risky ones

**#2 Telegraphic English.** No strong public evidence that function-word deletion is safe for instruction-following; good first-principles reason to expect harm. Models are trained overwhelmingly on fluent text; fluent sequences sit in high-density training regions where next-token prediction (and the internal "what is being asked" representation) is most reliable. Telegraphic text is OOD-ish. Savings are also smaller than they look — articles/auxiliaries are cheap single tokens, often BPE-merged with neighbors. Worse: dropping function words destroys exactly the words that encode logical structure ("unless", "only", "before", "never", "except", "must not"). **Hard rule: no automated function-word deletion.**

**#4 Legend/glossary shorthand.** Splits definition from use across long distances; under attention dilution mid-session, a lookup 400 lines away may get skipped or hallucinated. Repeated full terms are self-reinforcing retrieval anchors. Acceptable only for terms already used in the codebase itself (real filenames/symbols), never invented codes.

**#7 Emoji/glyphs.** Multi-byte, often 2-4 tokens each, semantically vague. Reject outright — except already-present ✅/❌ pairs, which do genuine do/don't marking cheaply.

**#3 DSL/pseudo-code.** Works where content is actually a lookup (routing tables, command lists, exit codes, dir trees). Fails where content is a judgment call — a DSL forces spurious commitment and loses caveats like "when in doubt, write less."

**#6 Reference-by-pointer.** Biggest untapped lever by raw tokens, but only fires if the trigger condition is legible and the model spends a tool call. Anything **unconditionally binding** must stay inline — a rule the agent might not load is a rule that will sometimes be violated. Pointers are for depth-on-demand, never for obligations.

## 2. What new levers remain (repo already uses tables/bullets/pointers)

1. **Cross-file dedup** — biggest real win. Rules restated in CLAUDE.md, SKILL.md, secure-coding skill cost tokens once per loaded file. One canonical home per rule; elsewhere, one line + pointer. Exception: obligations — intentional redundancy there is cheap insurance.
2. **Rationale pruning** — trim "why" explanations to a clause, keep directive verbatim.
3. **Table cell compression** — prose fragments in cells → symbol lists + paths. ~20-30% off tables, near-zero risk (tables are lookup content).
4. **Example collapsing** — one illustrative example instead of several.
5. **Section-header consolidation** — merge near-duplicate CRITICAL/MANDATORY sections without weakening any rule; never downgrade modal verbs (MUST→should is a semantic edit, not compression).
6. Whitespace/formatting: negligible, skip.

## 3. Recommended primary strategy + fallback ladder

**Primary — "Tiered hybrid."** Classify every block before touching it:

- **Tier N (normative/judgment)**: security disclosure discipline, minimal-diff policy, version-bump gate, disambiguation logic, anything with unless/except/only/never/must not/before/after/when-in-doubt/otherwise/instead-of. Compress nothing beyond literal duplicate removal. Must survive byte-identical or near-identical.
- **Tier M (mechanical/enumerable)**: routing tables, command lists, dir trees, constants, exit codes. Compress hard (~30-40%): symbol-only cells, drop connective prose, DSL where genuinely a lookup.
- **Tier E (explanatory)**: rationale/background/examples/restated context. Trim or move out-of-line via pointer (~30-50%).

**Fallback ladder** (escalate only with eval evidence at each rung):
1. Aggressive Tier-E deletion (no rationale, one example max).
2. Cross-file dedup with pointers for non-obligation content.
3. Prose→DSL conversion for Tier-M content still in sentences.
4. *(Last resort, expect regression)* Telegraphic style within Tier-M cells only — never Tier N.

## 4. Prompt caching

Shorter file = smaller marginal saving on cache reads (~10% of base rate already); real win is context budget/attention, not $. Don't iteratively re-minify in prod — churn invalidates the cached prefix.

## 5. Proposed evaluation protocol addition

- **Target 20-30% reduction on first pass, not 50-60%.** First 20-30% comes almost entirely from Tier E/M — genuinely redundant material. Beyond ~35% starts cutting into Tier N / salience markers — silent failure mode, shows up only probabilistically across many sessions.
- **Floor**: <10% reduction ⇒ file was already optimal, stop.
- **Score compliance, not comprehension.** N≥20 real tasks per variant measuring: version-bump compliance, secure-coding-read compliance, minimal-diff adherence, routing accuracy, turns, tokens, test pass rate. A quiz over the compressed file proves nothing.
- **≥3 tasks that specifically trip a conditional/exception rule** per target (security-adjacent change, tempting drive-by refactor, skill-dir edit needing version bump).
- **Sample repeatedly** — compliance regressions are probabilistic; one passing run is not evidence.

## 6. Highest-cost failure mode: silently dropped conditional/exception logic

Must be blocked mechanically, not by good intentions:

- Never delete/paraphrase sentences containing: unless, except, only, never, must not, do not, before, after, when in doubt, otherwise, instead of. Compression of such a sentence requires human review.
- Never merge a rule with its exception into one line.
- Never downgrade modal verbs (MUST→should, NEVER→avoid, MANDATORY→recommended are semantic edits, not compression).
- Never move an unconditional obligation behind a pointer.
- Never let a legend/abbreviation stand between the reader and a security rule.
- **Diff gate**: assert the set of imperative/prohibitive sentences (regex on trigger words above) is preserved 1:1 pre/post-minify. Any drop fails the minify run.

This repo's Security-Fix Disclosure Discipline, Minimal-diff policy, and version-bump requirement are Tier N in full — should come out of `/minify` byte-identical, and the skill should say so explicitly rather than relying on a classifier to notice.
