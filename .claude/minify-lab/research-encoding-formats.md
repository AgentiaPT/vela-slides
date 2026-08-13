# Research — Reduced-Instruction Encoding Formats for `/minify`

**Phase 1 deliverable.** Author: research sub-agent (opus). Date: 2026-08-13.
**Scope:** recommend a candidate encoding format for compressing agent
instruction files with no loss of needed semantics, grounded in (a) real
prompt-compression literature and (b) hand-minification of real sections of
this repo's own instruction files.

**Corpus read in full (unmodified — this phase is research only):**

| File | Bytes | Lines |
|---|---:|---:|
| `/home/user/vela-slides/CLAUDE.md` | 18,301 | 284 |
| `/home/user/vela-slides/.claude/skills/vela-secure-coding/SKILL.md` | 17,634 | 261 |
| `/home/user/vela-slides/.claude/skills/hyper-sprint/SKILL.md` | 33,907 | 425 |
| **total** | **69,842** | **970** |

---

## 0. Headline findings (read this if you read nothing else)

1. **This corpus is already pre-compressed.** Measured function-word (stopword)
   ratio is **21.5% / 24.5% / 27.5%** for the three files, against **~44%** for
   ordinary English prose. The author has already been writing telegraphically.
   A "telegraphic rewrite" pass therefore has far less headroom here than the
   compression literature (which benchmarks on verbose natural context) implies.
2. **A sixth of the corpus is legally incompressible.** Verbatim-invariant spans
   (fenced blocks + inline-code: commands, paths, symbol names, DSL syntax) are
   **33.9%** of CLAUDE.md, **19.7%** of the secure-coding skill, **5.6%** of
   hyper-sprint — **16.5% of the corpus**. Not one byte of it may change.
3. **Five hand-minification probes on real sections yield a pooled 10.3% byte
   reduction** (8,566 → 7,687 B), 9.2% on the prose-only portion. Pushing one
   probe to maximum aggression reached only **18.3%**.
4. **Projected whole-corpus reduction from rewriting alone: ~7.6%.** Adding
   aggressive (and risky) restatement pruning gets to a realistic **~13–15%**.
5. **⇒ The ≥20% gate does NOT clear on this corpus.** See §5 for the honest
   numbers, the conditions under which it *would* clear, and what I recommend
   the project do about the gate rather than about the approach.
6. **The #1 approach is still worth building** — but its value proposition on
   this repo is **correctness and enforceability, not bytes**. Probe B cut only
   4.6% of bytes while turning three implicit quantifiers (`ANY of` / `BOTH` /
   `regardless of path`) into explicit ones. That is a real defect-prevention
   win independent of token count, and it is the thing the eval harness should
   be built to detect.

---

## 1. Literature review

### 1.1 Verification status — read this before quoting any number below

The container's egress goes through an agent proxy; **arXiv PDFs were not
fetched directly**. Everything in this section is **snippet-level evidence from
web search results only**. Per the phase-1 brief, every external numeric claim
below is tagged:

> **⚠️ UNVERIFIED — pending citation-check, snippet-level only.**

Phase 3 (citation verification) must re-derive each number from the primary
source before any of it is quoted in the `/minify` skill, a PR body, or any
public-facing text. **No claim in this document is load-bearing for the
recommendation** — the recommendation rests on §3's measured probes. Where I
could not find a real source for a claim, I have not cited one.

### 1.2 What the literature actually covers — and the domain gap

The prompt-compression literature is overwhelmingly about compressing
**retrieved context and demonstrations** for a *single inference*, optimizing a
downstream task metric (QA accuracy, ROUGE). Our problem is different in four
ways that matter:

| Literature setting | Our setting |
|---|---|
| Compress *context/evidence* | Compress *normative policy* (rules, gates, prohibitions) |
| Success = task metric on a benchmark | Success = **identical rule-following behavior** across an open-ended task distribution |
| Output is machine-generated, throwaway, per-request | Output is a **git-tracked source file humans edit and review** |
| Loss is graceful (slightly worse answer) | Loss is **cliff-edged** (a dropped exception = a shipped vulnerability) |

This gap is the single most important input to the ranking in §4. Methods that
win in the literature (learned token-dropping, soft prompts) lose badly here on
maintainability and cliff-edge risk.

### 1.3 Findings, by relevance

**LLMLingua family (Microsoft Research) — coarse-to-fine token dropping.**
Uses a small LM to score and drop low-information tokens, with a budget
controller allocating different compression ratios to instructions vs.
demonstrations. LongLLMLingua adds query-aware compression/reordering; snippets
report *"up to a 17.1% performance improvement while reducing token count by
approximately fourfold"*. LLMLingua-2 reframes compression as token
classification distilled from a stronger model.
**⚠️ UNVERIFIED — pending citation-check, snippet-level only.**
*Relevance:* the **budget-controller idea transfers** — different content
classes deserve different compression ratios (exactly §2's taxonomy). The
**mechanism does not** — it produces non-human-readable output and it is tuned
for evidence, not for policy where dropping one token can invert a rule.
Sources: [Microsoft Research blog](https://www.microsoft.com/en-us/research/blog/llmlingua-innovating-llm-efficiency-with-prompt-compression/),
[LongLLMLingua](https://arxiv.org/pdf/2310.06839).

**Gisting / soft-prompt compression (Mu et al., NeurIPS 2023).** Trains the model
to compress a prompt into a few "gist" tokens; snippets report *"up to 26x
compression … up to 40% FLOPs reductions … with minimal loss in output quality"*.
**⚠️ UNVERIFIED — pending citation-check, snippet-level only.**
*Relevance:* **none operationally** — requires model-side training and produces
opaque vectors. Listed here only because it is the headline compression number
people cite, and it must be explicitly ruled out (§4, "do not prototype").
Source: [arXiv 2304.08467](https://arxiv.org/abs/2304.08467).

**Pseudo-code instructions (Mishra, Kumar et al., EMNLP 2023).** Manually wrote
pseudo-code prompts for 132 Super-NaturalInstructions tasks; snippets report
*"an average increase (absolute) of 7-16 points in F1 for classification tasks
and a relative improvement of 12-38% in aggregate ROUGE-L"*, on BLOOM and
CodeGen, with ablations attributing gains to *code comments, docstrings, and
structural clues*.
**⚠️ UNVERIFIED — pending citation-check, snippet-level only.**
*Relevance:* **the most directly encouraging result for a structured encoding** —
and note the ablation: the gain came substantially from *comments and
docstrings*, i.e. from the **rationale that pseudo-code carries alongside the
structure**, not from terseness. That is a direct argument for keeping `WHY`
fields (§4, and risk R5). Caveats: 2023-era mid-size open models; *task*
instructions, not *policy* documents; the paper is about accuracy, **not about
size reduction at all**.
Source: [ACL Anthology 2023.emnlp-main.939](https://aclanthology.org/2023.emnlp-main.939/).

**Prompt formatting sensitivity (He et al., 2024).** Same content rendered as
plain text / Markdown / YAML / JSON; snippets report GPT-3.5-turbo varying *"by
up to 40% in a code translation task"* across templates, with GPT-4 markedly more
robust.
**⚠️ UNVERIFIED — pending citation-check, snippet-level only.**
*Relevance:* two consequences. (a) A re-encoding is **not behavior-neutral by
default** — changing the *format* alone can move behavior, so the eval must
compare minified-vs-original, never assume equivalence. (b) Format sensitivity
**shrinks with model capability**, so a minified file validated on one model
does not transfer for free; the harness must record which model it validated on.
Source: [arXiv 2411.10541](https://arxiv.org/abs/2411.10541).

**Controlled natural language / CNL-P, and ASD-STE100 Simplified Technical
English.** CNLs are subsets of natural language with restricted grammar and
vocabulary *"in order to reduce or eliminate ambiguity and complexity"*.
ASD-STE100 Issue 8 carries **53 writing rules** ("keep sentences short", "avoid
pronouns", "use only dictionary-approved words", "use only the active voice").
CNL-P is a recent proposal applying CNL discipline to LLM prompts via
context-free grammar and static analysis.
**⚠️ UNVERIFIED — pending citation-check, snippet-level only.**
*Relevance:* STE is the **best-established precedent for exactly our risk
profile** — safety-critical maintenance instructions that must not be
misread — and it is a *disambiguation* standard, not a *compression* standard.
Several STE rules (no pronouns → repeat the noun; one instruction per sentence)
**lengthen** text. Use it as a **lint layer**, not as the encoding (§4, rank 3).
Sources: [Wikipedia: Simplified Technical English](https://en.wikipedia.org/wiki/Simplified_Technical_English),
[Wikipedia: Controlled natural language](https://en.wikipedia.org/wiki/Controlled_natural_language),
[CNL-P, arXiv 2508.06942](https://arxiv.org/html/2508.06942).

**Negation sensitivity.** Snippets from *"When Prohibitions Become Permissions:
Auditing Negation Sensitivity in Language Models"* report open-source models
endorsing prohibited actions *"77% of the time under simple negation and 100%
under compound negation — a 317% increase over affirmative framing"*, with
commercial models showing *"swings of 19-128%"*. A separate line of work argues
negation-processing mechanisms are *"overshadowed by other mechanisms at later
layers"*.
**✅ VERIFIED (main statistic), citation corrected 2026-08-13 — see
`citation-verification.md` Finding C.** The 77%/100%/317%/19-128% figures are
confirmed against arXiv 2601.21433. The "overshadowed... at later layers"
quote does **not** come from that paper or from the MIT News article (which
covers a different, vision-language negation study) — it traces to an
uncited third paper, arXiv 2605.03052 ("How Language Models Process
Negation"), now cited below in its place.
*Relevance:* **the single highest-value literature input for the risk list.**
Our corpus is negation-dense — measured `never` counts: CLAUDE.md 14,
secure-coding 20, hyper-sprint 30. Any rewrite that touches a prohibition's
polarity or nests it under another negation is high-risk. Drives risks R3 and
R14.
Sources: [arXiv 2601.21433](https://arxiv.org/html/2601.21433) (statistic),
[arXiv 2605.03052](https://arxiv.org/abs/2605.03052) ("overshadowed" quote,
corrected attribution).

**Position bias / "lost in the middle".** Accuracy follows a U-shaped serial
position curve; primacy and recency dominate, mid-context material is
down-weighted; snippets note the effect *"is strongest when inputs occupy up to
50% of a model's context window"*.
**✅ VERIFIED, citation corrected 2026-08-13 — see `citation-verification.md`
Finding A.** The U-shaped-curve finding belongs to arXiv 2510.10276. The
specific "up to 50% of a model's context window" figure is the headline
finding of a different paper, arXiv 2508.07479 ("Positional Biases Shift as
Inputs Approach Context Window Limits," Veseli et al., COLM 2025), now cited
below in its place.
*Relevance:* **reordering is a semantic operation.** hyper-sprint deliberately
places its cost-economy banner at the primacy slot (§3, probe E). Moving a rule
out of that slot can reduce adherence with byte-identical text. Drives risk R4/R19.
Sources: [arXiv 2510.10276](https://arxiv.org/html/2510.10276v1) (U-shaped
curve), [arXiv 2508.07479](https://arxiv.org/abs/2508.07479) ("50% of context
window" figure, corrected attribution).

**Tone/register sensitivity.** *"Mind Your Tone"* reports ChatGPT-4o accuracy
ranging *"from 80.8% for Very Polite prompts to 84.8% for Very Rude prompts"* on
50 MCQs.
**⚠️ UNVERIFIED — pending citation-check, snippet-level only.** Small n, single
model, MCQ-only — I would treat this as suggestive at best.
*Relevance:* register is not free. Minification systematically shifts register
(bare imperatives, dropped hedges). The eval must not assume tone-neutrality.
Source: [arXiv 2510.04950](https://arxiv.org/abs/2510.04950).

**Self-report unreliability.** Work on LLM introspection reports *"considerable
inconsistencies between LLM self-report ratings and revealed behavioral scores"*
and characterizes much apparent self-knowledge as *"self-narration, driven by
learned linguistic conventions"*.
**⚠️ UNVERIFIED — pending citation-check, snippet-level only.**
*Relevance:* directly justifies risk R9 — **never ask the agent whether it
followed the rule.** Sources: [The Personality Illusion, arXiv 2509.03730](https://arxiv.org/pdf/2509.03730),
[Rethinking Psychometric Evaluation of LLMs, arXiv 2606.12730](https://arxiv.org/html/2606.12730v1).

**Agent Skills discovery mechanics.** At startup only each skill's `name` +
`description` are loaded; the `description` *"is what Claude matches your
request against when determining whether to trigger the Skill"* (Anthropic
platform docs, verified verbatim); SKILL.md body and referenced files load
only after triggering. Per-skill discovery cost has been independently
measured (third-party, not Anthropic) at *"median... near 80 tokens... ranging
from about 55 to 235"* across 17 official skills.
**✅ VERIFIED, citation corrected 2026-08-13 — see `citation-verification.md`
Finding B.** The description-as-retrieval-key quote is confirmed verbatim on
Anthropic's own docs page, which itself states a flat "~100 tokens per Skill"
estimate with no median/range. The "median near 80 tokens, 55-235 range"
figure is **not** on that page — it is a third-party measurement (SwirlAI
newsletter, "State of Context Engineering in 2026") now cited separately
below rather than attributed to Anthropic.
*Relevance:* this is a **structural constraint on the minifier, not a nice-to-have.**
The frontmatter `description` is a *retrieval key*, not prose — compressing it
changes what the skill matches. Drives risk R7. Also: the SKILL.md **body** only
costs tokens when triggered, whereas **CLAUDE.md is always resident** — so
CLAUDE.md is worth several times more per byte saved than a SKILL.md body.
Sources: [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
(retrieval-key mechanics, ~100 tokens/skill estimate), SwirlAI, "State of
Context Engineering in 2026" (median ~80 token / 55-235 range figure,
third-party measurement, corrected attribution).

---

## 2. Content taxonomy of this repo's instruction files

Seven classes, ordered from *must not touch* to *safest to compress*, each
grounded in text quoted from the three files. The **budget** column is the
compression ratio the minifier should be allowed to spend on that class — the
LLMLingua budget-controller idea, applied to our content classes.

### C1 — Verbatim invariants · budget **0%** · risk **critical**

Commands, file paths, symbol names, DSL/flag syntax, numeric constants, error
strings. **Measured: 16.5% of the corpus** (33.9% of CLAUDE.md alone).

Real examples:

- `python3 tools/vela-dev/scripts/lint.py --parts src/parts   # key-drift + CSS sink gate`
- `--tools "" --strict-mcp-config --setting-sources ""` (the `CLAUDE_LOCKDOWN` flags — parity-tested against a Go gatekeeper)
- `arr.map((b) => sanitizeBlock(b))` vs the buggy `arr.map(sanitizeBlock)`
- `DOCKER_BUILDKIT=1 docker build -f vela-neutralino/Dockerfile -o type=local,dest=vela-neutralino/dist .`
- `❌ Files under skills/vela-slides/ changed but VELA_VERSION was not bumped.`
- `"vela-deck"` (main), `"vela-m-<moduleId>"`; `VELA:DEV-ONLY`; `NN / NN`; `960×540px`

Rule: the minifier must treat every backticked span and fenced block as an
**opaque, byte-frozen zone**. Paraphrasing `imports → icons → blocks → reducer →
engine → slides → list → chat → test → uitest → demo → pdf → pptx → app` is not
compression, it is corruption — the file states this order is TDZ-sensitive.

### C2 — Routing / lookup tables · budget **0–5%** · risk **high**

CLAUDE.md's *"Where does X live"* table (**4,046 B, 22.1% of the file**) and the
secure-coding §2 canonical-helpers table (**2,977 B, 16.9%**).

> `| **Sanitization / allowlists / a new slide or block field** | src/parts/part-imports.jsx | SAFE_SLIDE_KEYS, SAFE_BLOCK_KEYS, sanitizeBlock, … |`

> `| Colour scalar → CSS | cssColor(v) (fail-closed allowlist) | interpolating slide.bg/block.accent raw |`

These are **already an optimal encoding**: three columns, near-100% content
words, every cell a verbatim symbol. Additionally, CLAUDE.md states the routing
table is **CI-enforced** (`check-routing.py`) — a minifier that reworded a cell
would break CI, and the "Never" column of the helpers table encodes
prohibitions that must survive intact. **Compression opportunity here is
effectively nil.** Any minify skill that reports big wins on these files is
almost certainly damaging them.

### C3 — Hard constraints with scope + DO/DON'T semantics · budget **10–15%** · risk **high**

The two `## CRITICAL:` sections of CLAUDE.md, and secure-coding §0's *"five
non-negotiables"*.

> "**Public-facing text about a security fix MUST NOT include detail that helps
> reproduce the issue in the wild.**" … "✅ DO state: … ❌ DO NOT include: …"

> "2. **Allowlist, never denylist**, for anything structural … A denylist is only
> ever an *extra* layer on top of an allowlist, never the gate."

Structure is `WHEN · SCOPE · MUST · DO · NEVER · EXCEPTION · TIE-BREAK`, but it is
carried implicitly by prose and by ✅/❌ glyphs. Making it explicit is the core
of the recommended format. Measured yield: **13.2%** (probe A).

### C4 — Sequential procedures & gates · budget **10–15%** · risk **medium-high (ordering is semantic)**

> "## Mandatory: Run CI Checks After Every Change … All checks must pass before
> committing."

> hyper-sprint Phase 0a → 0b → 1 → 2 → 3 → 4 → 5, with "Orchestrator **hard-gates
> on `blocked`**".

> secure-coding §5's five-command block, plus "A PostToolUse hook … auto-runs the
> lint (~0.7 s) … treat that feedback as a failing gate, not a suggestion."

Steps compress like ordinary telegraphic prose, but **order and gate-polarity are
load-bearing** and must be preserved structurally, not incidentally.

### C5 — Conditional triage / boolean logic · budget **5–10%** · risk **critical (highest value target)**

secure-coding's Triage section — the densest boolean logic in the corpus:

> "**Full read required** (§1–§6) if your change does ANY of: …" (a five-way
> disjunction, one arm of which enumerates nine filenames)
> "**Quick path** … is enough ONLY when the change is confined to … **and** reads
> no deck value it doesn't already receive sanitized."
> "Two hard rules stay in force on the quick path: …"
> "**If in doubt — or if mid-change you touch anything in the full-read list —
> stop and read the whole skill.**"

That is: `∀change: §0`; `full ⟸ (a ∨ b ∨ c ∨ d ∨ e)`; `quick ⟸ (f ∧ g)`;
`quick ⇒ still(h ∧ i)`; `doubt ∨ late-discovery ⇒ full`; `lint ∧ CI ∀paths`.
**Byte yield is the worst in the corpus (4.6%)** because it is an irreducible
enumeration — but it is the class where an explicit encoding buys the most
*correctness*, because the quantifiers (`ANY` / `BOTH` / `regardless of path`) are
exactly what a careless rewrite flattens.

### C6 — Rationale & war stories · budget **10–20%** · risk **critical (highest-consequence loss)**

> "Vela renders untrusted deck JSON in runtimes with real filesystem and network
> capability, and nearly every vulnerability in this repo's history came from
> ordinary feature code, not from work labelled 'security'."

> "one sprint's hub was **$59.74 across 72M cache-read tokens over 375 turns**,
> and cache-reads were **94% of that sprint's 150M total tokens**"

> "A guard that `return`s hands the attacker an opt-out: nest one level deeper and
> the scrubbers never ran."

This class *looks* like the fattest target and is the **most dangerous to cut**.
Its function is not decoration — it is what lets the agent apply the rule to a
case the file never enumerated. Delete "nearly every vulnerability came from
ordinary feature code" and the triage gate stops feeling load-bearing for a
routine feature change. Note the pseudo-code paper's own ablation (§1.3) found
*comments and docstrings* contributed to its gains — rationale is the part that
transfers. Measured yield: 15.7% (16.4% prose-only), the best in the corpus —
which is precisely the temptation to guard against.

### C7 — Orientation / background prose · budget **20–30%** · risk **low**

> "## What is Vela? AI-native presentation engine for Claude.ai. Single-file React
> app (~1.3MB, 18,421 lines) …"
> The `## Architecture` ASCII pipeline diagram; `## Key Directories`; `## License`.

The safest class — but note the measurement in probe D: the section is **42%
verbatim by bytes** (fenced diagram + code + paths), so the *prose* inside it is
already thin. The one real win was replacing the padded 3-line ASCII pipeline
diagram with an inline arrow chain: **−197 B in one edit**, with every pipeline
stage preserved. Formatting whitespace, not words, was the fat.

### Cross-cutting measurement: there is almost no *literal* redundancy

Repeated 8-word shingles: **CLAUDE.md 1, secure-coding 0, hyper-sprint 35**;
shared across ≥2 files: **7** (all in the shared "before writing, changing, or
reviewing any code" / disclosure-discipline boilerplate). So **dedup-by-string
buys nothing.** The redundancy that exists is *conceptual paraphrase* — measured
candidate blocks (§5.2) total 8,772 B / 12.6% of corpus — and removing it is the
single riskiest operation available (risk R4).

---

## 3. Hand-minification probes — the primary evidence

### 3.0 The recommended format, as used in these probes

**Typed Rule Blocks (TRB)** = structured key-value rule blocks + telegraphic
field values + byte-frozen verbatim zones + explicit modality tokens.
Fixed legend, emitted once per minified file:

```
WHEN=trigger/scope  SCOPE=where it applies  MUST/NEVER=hard  SHOULD=default (deviate w/ reason)
MAY=permitted  DO=required action  EXC=exception  TEST=decision rule  WHY=rationale (generalizes)
EVID=measured evidence  GATE=blocking check  ELSE=fallback  TIE=tie-breaker  REF=pointer (verbatim)
NOTE=applies regardless of branch   `backticks`=verbatim, never reword   ⇒ = "therefore"
ANY of / BOTH of / regardless of = explicit quantifiers, never flattened
```

Probes were rewritten by hand in this format and measured with `wc`/`len(bytes)`.
Source extracts were taken byte-exactly via line ranges from the live files (the
files themselves were **not** modified). Working copies live in the session
scratchpad; the full text of both sides is reproduced below.

### 3.1 Results table (exact bytes)

| Probe | Source | Section | Before | After | Cut | Prose-only cut |
|---|---|---|---:|---:|---:|---:|
| **A** | `CLAUDE.md` L240–250 | *CRITICAL: Security-Fix Disclosure Discipline* | **1,443 B** | **1,253 B** | **13.2%** | 13.3% |
| **B** | `vela-secure-coding/SKILL.md` L20–42 | *Triage — how much of this skill your change needs* | **1,458 B** | **1,391 B** | **4.6%** | 5.4% |
| **C** | `hyper-sprint/SKILL.md` L93–111 | *Principle 3 — hub hygiene* | **1,789 B** | **1,508 B** | **15.7%** | 16.4% |
| C′ | same, maximum-aggression variant | | 1,789 B | 1,461 B | 18.3% | — |
| **D** | `CLAUDE.md` L3–41 | *What is Vela? / Architecture / Part-File Order* | **1,839 B** | **1,636 B** | **11.0%** | 0.6%\* |
| **E** | `hyper-sprint/SKILL.md` L19–46 | *Orchestrator banner* | **2,037 B** | **1,899 B** | **6.8%** | 6.9% |
| | | **POOLED (A–E)** | **8,566 B** | **7,687 B** | **10.3%** | **9.2%** |

\* Probe D's entire win came from replacing the padded ASCII diagram (counted as
verbatim in the split); its prose was already at floor.

Lexical-density check (function-word ratio), confirming a real telegraphic shift
rather than reformatting: A 31.2→24.5%, B 25.6→16.9%, C 34.8→21.7%,
D 24.9→17.7%, E 30.0→25.3%.

> **A methodological note, reported because it is decision-relevant.** My first
> pass at probes A–C applied TRB *structure* only (field labels, aligned
> columns) without the telegraphic layer. It measured **2.8% pooled — and probe
> B came out 0.3% *larger* than the original.** Structural re-encoding is not
> compression; column alignment costs the bytes it saves. All numbers above are
> from the second pass, which adds the lexical layer. Any `/minify` skill built
> from this research must include the lexical pass, and its self-check must fail
> a "minification" that grew the file.

### 3.2 Probe A — `CLAUDE.md` L240–250, *Security-Fix Disclosure Discipline*

**BEFORE (1,443 B, verbatim from the file):**

```markdown
## CRITICAL: Security-Fix Disclosure Discipline

**Public-facing text about a security fix MUST NOT include detail that helps reproduce the issue in the wild.** This applies to **`VELA_CHANGELOG` entries, commit messages, PR titles/bodies, code review comments, and any other public-exposed document** (the changelog also renders in the in-app About dialog).

For any security-related change, describe it at a **high level only**:
- ✅ DO state: the class of issue (e.g. "CSS exfil channel", "mutation-XSS", "fail-open sanitization"), severity, the affected area, what the fix does, and that regression tests were added.
- ❌ DO NOT include: working payloads or example attack strings, the exact bypass token/primitive, step-by-step reproduction, "where the gap was" maps (precise unguarded fields/endpoints/parameters an attacker should target), or chained CVE/exploit references that amount to a recipe.

Rule of thumb: if a reader could copy a string or follow the steps to trigger the bug, it's too much — generalize it. Keep precise mechanics in **non-public** channels (private security threads / advisories), or, where genuinely needed for maintenance, in **in-code comments** (maintainer-facing, not surfaced in release notes) — and even there, prefer the minimum needed to explain *why* the guard exists.

This discipline is permanent and applies to **every** future change, not just the current one. When in doubt, write less.
```

**AFTER (1,253 B, TRB):**

```markdown
## CRITICAL: Security-Fix Disclosure Discipline

RULE sec-disclosure. Permanent — every future change, not just the current one.
WHEN public-facing text about a security fix.
SCOPE `VELA_CHANGELOG` · commit msg · PR title/body · code-review comment · any other public-exposed doc (changelog also renders in the in-app About dialog).
MUST high level only; MUST NOT include detail that helps reproduce the issue in the wild.
DO class of issue (e.g. "CSS exfil channel", "mutation-XSS", "fail-open sanitization") · severity · affected area · what the fix does · that regression tests were added.
NEVER working payload / example attack string · exact bypass token or primitive · step-by-step repro · "where the gap was" map (precise unguarded field/endpoint/param an attacker should target) · chained CVE/exploit ref amounting to a recipe.
TEST reader could copy a string or follow the steps to trigger the bug ⇒ too much ⇒ generalize.
EXC precise mechanics MAY go to a non-public channel (private security thread/advisory), or — where genuinely needed for maintenance — an in-code comment (maintainer-facing, not surfaced in release notes); even there, the minimum needed to explain WHY the guard exists.
TIE in doubt ⇒ write less.
```

**Constraint-survival check — 11 of 11 present:**

| # | Constraint in original | Survives? | Where |
|---|---|---|---|
| A1 | MUST NOT include detail helping reproduce the issue in the wild | ✅ | `MUST` |
| A2 | Scope = changelog · commit msgs · PR title/body · review comments · any other public-exposed doc | ✅ | `SCOPE` (all 5 arms) |
| A3 | Changelog also renders in the in-app About dialog | ✅ | `SCOPE` parenthetical |
| A4 | Describe at high level **only** | ✅ | `MUST` ("only" retained) |
| A5 | DO-list: class of issue + 3 named examples, severity, affected area, what the fix does, tests added | ✅ | `DO` (all 5 items + all 3 examples) |
| A6 | DON'T-list: payloads/attack strings, exact bypass token/primitive, step-by-step repro, "where the gap was" maps (+ its gloss), chained CVE/exploit recipe | ✅ | `NEVER` (all 5 items + gloss) |
| A7 | Rule of thumb: copyable string **or** followable steps ⇒ too much ⇒ generalize | ✅ | `TEST` (disjunction preserved) |
| A8 | Permitted homes: non-public channels; *or* in-code comments where genuinely needed for maintenance | ✅ | `EXC` (both, with the "genuinely needed" qualifier) |
| A9 | Even in comments, prefer the minimum needed to explain *why* | ✅ | `EXC` tail |
| A10 | Permanent; every future change, not just the current one | ✅ | `RULE` line |
| A11 | When in doubt, write less | ✅ | `TIE` |

Deliberate non-losses worth noting: the modal **MUST NOT** is retained as a
token (not softened to "avoid"); "in-code comments" keeps its *maintainer-facing,
not surfaced in release notes* gloss, without which someone could read it as
permission to put payloads in a public source file.

### 3.3 Probe B — `vela-secure-coding/SKILL.md` L20–42, *Triage*

**BEFORE (1,458 B, verbatim):**

```markdown
## Triage — how much of this skill your change needs

**§0 (the five non-negotiables) is mandatory for every change, always.** Then:

**Full read required** (§1–§6) if your change does ANY of: reads a new or
existing deck-supplied field anywhere; touches a sanitizer, encoder, allowlist,
or `SAFE_*` key set; touches an exporter (PDF/PPTX/Markdown/standalone HTML);
touches `part-imports.jsx`, `part-pdf.jsx`, `part-pdf-extract.jsx`,
`part-pdf-vector.jsx`, `part-export-md.jsx`, `part-pptx.jsx`, `serve.py`,
`assemble.py`, `agent_backend.py`, or anything under `vela-neutralino/`;
touches storage/reload paths, the startup patch, CI/release/build scripts, or
any `dangerouslySetInnerHTML`/`<style>`/CSS-sink/native-bridge code.

**Quick path** (§0 + the table in §2 as a lookup + §5's gates) is enough ONLY
when the change is confined to app-chrome/editor UI with static, code-authored
values — e.g. repositioning existing editor controls, adding a button that
dispatches an existing action, changing static styling of app chrome — and
reads no deck value it doesn't already receive sanitized. Two hard rules stay
in force on the quick path: never interpolate any deck-derived value into a
style/URL/DOM sink without its §2 helper, and never introduce a new external
fetch. **If in doubt — or if mid-change you touch anything in the full-read
list — stop and read the whole skill.** The post-edit lint and CI gates run
regardless of path.
```

**AFTER (1,391 B, TRB):**

```markdown
## Triage — how much of this skill your change needs

§0 (the five non-negotiables) = MANDATORY for every change, always. Then:

PATH=full → read §1–§6. REQUIRED if the change does ANY of:
· reads any deck-supplied field (new or existing) anywhere
· touches sanitizer / encoder / allowlist / `SAFE_*` key set
· touches exporter (PDF|PPTX|Markdown|standalone HTML)
· touches `part-imports.jsx` `part-pdf.jsx` `part-pdf-extract.jsx` `part-pdf-vector.jsx` `part-export-md.jsx` `part-pptx.jsx` `serve.py` `assemble.py` `agent_backend.py` | anything under `vela-neutralino/`
· touches storage/reload path | startup patch | CI/release/build script | any `dangerouslySetInnerHTML` / `<style>` / CSS-sink / native-bridge code

PATH=quick → §0 + §2 table as lookup + §5 gates. ENOUGH ONLY IF BOTH:
· change confined to app-chrome/editor UI with static code-authored values (e.g. reposition an existing editor control, add a button dispatching an existing action, change static styling of app chrome), AND
· reads no deck value it doesn't already receive sanitized
QUICK-PATH INVARIANTS (stay in force): NEVER interpolate any deck-derived value into a style/URL/DOM sink without its §2 helper; NEVER introduce a new external fetch.

ELSE in doubt — or you touch a full-read item mid-change — STOP, read the whole skill.
NOTE post-edit lint + CI gates run regardless of path.
```

**Constraint-survival check — 15 of 15 present:**

| # | Constraint | Survives? |
|---|---|---|
| B1 | §0 mandatory, **every** change, **always** | ✅ `MANDATORY … every change, always` |
| B2 | Full read = §1–§6 | ✅ |
| B3 | Trigger is a disjunction — **ANY of** | ✅ quantifier retained as a literal token |
| B4 | arm 1: reads a **new or existing** deck-supplied field **anywhere** | ✅ all three qualifiers |
| B5 | arm 2: sanitizer, encoder, allowlist, `SAFE_*` key set | ✅ 4/4 |
| B6 | arm 3: exporter — PDF/PPTX/Markdown/standalone HTML | ✅ 4/4 |
| B7 | arm 4: the nine named files + anything under `vela-neutralino/` | ✅ 9/9 filenames byte-identical + the directory |
| B8 | arm 5: storage/reload paths, startup patch, CI/release/build scripts, `dangerouslySetInnerHTML`/`<style>`/CSS-sink/native-bridge | ✅ 4/4, backticks preserved |
| B9 | Quick path composition: §0 + §2 table **as a lookup** + §5's gates | ✅ |
| B10 | Quick path is **enough ONLY when** … (necessary-condition semantics) | ✅ `ENOUGH ONLY IF BOTH` |
| B11 | Condition 1 + its three worked examples | ✅ all three examples kept |
| B12 | Condition 2: reads no deck value it doesn't already receive sanitized — **conjunctive** with cond. 1 | ✅ `BOTH … AND` made explicit |
| B13 | Two hard rules still in force on the quick path (helper-gating; no new external fetch) | ✅ both, as `NEVER` |
| B14 | In doubt **or** mid-change discovery ⇒ stop and read all of it | ✅ disjunction retained |
| B15 | Lint + CI gates run **regardless of path** | ✅ `NOTE … regardless of path` |

**This probe is the argument for the whole approach.** It cut only **4.6%** of
bytes — the worst in the corpus — yet it converted three implicit logical
operators into explicit tokens (`ANY of`, `ONLY IF BOTH … AND`, `regardless of
path`) and lifted the two quick-path invariants out of a trailing subordinate
clause into their own labelled line. On this corpus **TRB is a correctness
instrument that happens to save a few bytes, not a compressor.** The project
should decide whether that is a deliverable it wants; if the answer is "we only
care about tokens", §5's verdict says stop.

### 3.4 Probe C — `hyper-sprint/SKILL.md` L93–111, *Principle 3* (rationale-heavy)

Chosen deliberately as the adversarial case: this is the war-story class (C6),
where compression looks easiest and loss is worst.

**BEFORE (1,789 B, verbatim):**

```markdown
3. **Orchestrator, not worker — hub hygiene: payloads to disk, pointers + verdicts in the
   hub (HARD RULE).** The orchestrator must **never** read a worker's diff, a screenshot,
   or any large doc into the main loop — it trusts the worker's pasted test-summary + one-line verdict, and re-drives
   only **by exception**, via a cheap sub-agent that returns a bare pass/fail (not the raw
   artifact). Frame-checks and one-off lookups (a pricing page, a doc for one config flag, a
   single number buried in a giant reference) are **delegated**, never fetched/read directly
   in the hub. **Screenshots are the single worst payload — treat "no images in the hub" as an
   absolute.** A viewed screenshot is ~10–37K tokens, is **un-evictable** (compaction is the
   only thing that sheds it, and context-editing/`clear_tool_uses` does not cover image
   blocks), and is re-read on **every** later turn. The blind verifiers/hunters already *look*
   at every proof state (principle 8) and return a one-line frame-check verdict — the hub reads
   the **verdict, never the pixels**; if the hub genuinely needs its own visual check, spawn a
   throwaway "look at this PNG → reply pass/fail + one sentence" sub-agent so the image lives and
   dies in an isolated window. *(Measured example: in one sprint the orchestrator was **65% of
   total spend** and **95% of its tokens were cache-reads**; **10 screenshots the hub looked at
   were 31% of its cache-read and ~46% of its standing context** — more than any other single
   bucket. This is generally the single biggest cost lever; it is not specific to that run.)*
   Enforceable checklist, the CLI-vs-SDK context levers, and the re-drive-by-exception recipe:
   `references/hub-hygiene.md` + `references/context-economy.md`.
```

**AFTER (1,508 B, TRB):**

```markdown
3. **Orchestrator, not worker — hub hygiene: payloads to disk, pointers + verdicts in the hub (HARD RULE).**
NEVER into the main loop: worker's diff · screenshot · any large doc.
DO trust the worker's pasted test-summary + one-line verdict.
EXC re-drive by exception only — cheap sub-agent returns a bare pass/fail, never the raw artifact.
DO delegate frame-checks + one-off lookups (a pricing page, a doc for one config flag, one number buried in a giant reference); never fetch/read them in the hub.
NEVER images in the hub — absolute. Screenshots = the single worst payload.
WHY viewed screenshot ≈10–37K tokens · UN-EVICTABLE (only compaction sheds it; context-editing/`clear_tool_uses` does NOT cover image blocks) · re-read EVERY later turn.
DO blind verifiers/hunters already look at every proof state (principle 8) + return a one-line frame-check verdict → hub reads the verdict, never the pixels.
EXC hub genuinely needs its own visual check ⇒ throwaway "look at this PNG → pass/fail + one sentence" sub-agent; image lives and dies in an isolated window.
EVID one sprint: orchestrator = 65% of total spend, 95% of its tokens cache-reads; 10 hub-viewed screenshots = 31% of its cache-read + ~46% of its standing context — more than any other single bucket. Generally the single biggest cost lever, not specific to that run.
REF `references/hub-hygiene.md` + `references/context-economy.md` — enforceable checklist · CLI-vs-SDK context levers · re-drive-by-exception recipe.
```

**Constraint-survival check — 15 of 15 present:**

| # | Constraint | Survives? |
|---|---|---|
| C1 | Principle **number 3** and its exact title, incl. "(HARD RULE)" | ✅ preserved verbatim — other sections cite "principle 3" by number (risk R6) |
| C2 | NEVER read into main loop: worker's diff · screenshot · any large doc (all three) | ✅ |
| C3 | Trust the worker's pasted test-summary + one-line verdict | ✅ |
| C4 | Re-drive **only by exception**, via cheap sub-agent, bare pass/fail, **not the raw artifact** | ✅ |
| C5 | Frame-checks + one-off lookups are delegated, never fetched/read in the hub | ✅ |
| C6 | …with its three worked examples (pricing page / one config flag / one number in a giant reference) | ✅ all three (they calibrate "one-off") |
| C7 | "No images in the hub" is an **absolute**; screenshots are the single worst payload | ✅ |
| C8 | WHY-1: a viewed screenshot ≈10–37K tokens | ✅ numeric range intact |
| C9 | WHY-2: un-evictable; compaction is the only thing that sheds it | ✅ |
| C10 | WHY-2b: context-editing/`clear_tool_uses` does **not** cover image blocks | ✅ negation preserved (`does NOT`) |
| C11 | WHY-3: re-read on **every** later turn | ✅ |
| C12 | Verifiers already look (cross-ref to **principle 8**) and return a one-line verdict; hub reads verdict, never pixels | ✅ incl. the numbered cross-reference |
| C13 | Escape hatch: throwaway "look at this PNG → pass/fail + one sentence" sub-agent, isolated window | ✅ |
| C14 | Measured evidence: 65% of spend / 95% cache-reads / 10 screenshots = 31% of cache-read + ~46% of standing context / more than any other bucket / **generalizes beyond that run** | ✅ all six figures + the generalization claim |
| C15 | Pointer to both reference files + the three things they contain | ✅ paths verbatim |

**Aggression ceiling test.** A second variant (C′) stripped remaining articles
and most emphasis markup: **1,461 B, 18.3%** — only 2.6 points better than the
careful version, while removing salience cues. Corpus-wide, **all** markdown
emphasis markup is just **1.01% / 1.54% / 2.43%** of the three files. **Stripping
emphasis is not a meaningful byte lever and should be forbidden**, since bold is
the corpus's main salience carrier (risk R4).

### 3.5 Probes D and E (summary)

**D — `CLAUDE.md` L3–41, orientation:** 1,839 → 1,636 B (**11.0%**). All 16
constraints survive, including the TDZ-sensitivity warning, the "add a new part
in the same change or the lint fails" gate, the verbatim part-order chain, both
`partsize.py` invocations with their comments, and MANIFEST.txt's
single-source-of-truth status. **Essentially the entire win came from replacing
the 3-line padded ASCII pipeline diagram with a one-line arrow chain (−197 B);
the prose compressed 0.6%.**

**E — `hyper-sprint/SKILL.md` L19–46, orchestrator banner:** 2,037 → 1,899 B
(**6.8%**). All 17 constraints survive, including every figure ($59.74, 72M, 375
turns, 94%, 150M, ≤50, ~12 scripts, >2 round-trips) and — critically — the
*anti*-rule "**≤50 main-loop turns is a heuristic … NOT a hard ceiling**", which
is exactly the kind of hedged non-constraint a naive minifier converts into a
hard cap (risk R15). I **did not** dedupe this banner against principles 3/9/12
despite ~2 KB of conceptual overlap: it sits in the primacy position on purpose
(§1.3, position bias), so removing it is a salience change, not a size change.

---

## 4. Ranked recommendation

### #1 — Typed Rule Blocks (structured key-value + telegraphic values + verbatim zones) ✅ **PROTOTYPE THIS**

A hybrid, not a pure candidate: **structured key-value rule blocks** provide the
skeleton, **telegraphic style** is the register *inside* field values, and
**"omit-the-inferable"** is permitted *only* on class C7.

Why it wins:

- **It is the only candidate that makes the failure mode visible.** Quantifiers,
  modality and scope become named tokens (`ANY of`, `ONLY IF BOTH`, `MUST NOT`,
  `regardless of path`), so the highest-frequency compression defects (R1, R2,
  R14, R18) become *diffable* rather than silent.
- **Verbatim preservation is structural, not disciplinary.** Backticked spans and
  fenced blocks are a declared frozen zone; C1/C2 content (16.5% of the corpus,
  all of it CI-enforced or security-critical) is protected by construction.
- **It stays human-maintainable and reviewable.** The file remains Markdown, the
  legend is 6 lines, and a `git diff` of a minified file is still readable — a
  hard requirement for a public repo where humans edit these files.
- **It degrades safely.** An agent that ignores the field labels still reads
  grammatical (if terse) English. There is no parse to fail.
- **Best available literature support** — the pseudo-code-instructions result
  (structure + retained comments/docstrings helped) and the CNL/STE tradition
  both point at *explicit structure with retained rationale*.
  ⚠️ both UNVERIFIED, snippet-level.
- **Measured**: 10.3% pooled byte reduction with **57 of 57 constraints
  surviving** across probes A–C (plus 16/16 in D and 17/17 in E).

Honest weakness: **it is not the biggest byte-saver, and on this corpus nothing
is.** Adopt it for what it measurably delivers — explicit constraint structure
at a modest size discount — not for a token headline.

### #2 — Telegraphic / "caveman" prose ⚠️ **prototype only as TRB's field-value style, never standalone**

This is the actual byte engine — the second-pass lexical layer is what moved
probes from 2.8% to 10.3%, and it drove function-word ratio down 6–13 points.
But standalone it is the **most dangerous** candidate: dropping determiners and
copulas is exactly the edit that also drops "only", "any", "still", "not",
"unless", and turns "MUST NOT" into "avoid". The negation-sensitivity literature
(§1.3) says models already mis-handle prohibitions; a register that suppresses
function words attacks precisely the tokens that carry prohibition and
quantification. Use it **inside** typed fields where the field name preserves the
speech act.

### #3 — Controlled natural language / STE ⚠️ **prototype as a lint layer, not as the encoding**

Strongest precedent for our exact risk profile (safety-critical instructions that
must not be misread), and STE's rules — one instruction per sentence, active
voice, no pronouns, approved vocabulary — map almost perfectly onto the failure
modes in §6. But STE is a **disambiguation** standard: "avoid pronouns → repeat
the noun" and "keep sentences short" often *increase* length. Recommendation:
adopt ~6 STE-derived rules as **checks the `/minify` skill runs on its own
output** (no pronouns crossing a rule boundary; one obligation per line; active
voice; modality word present in every obligation), and drop the rest.

### #4 — "Omit-the-inferable" ⚠️ **prototype, but hard-scoped to class C7 only**

A *pass*, not a format — and the single highest-variance idea in the brief. It is
genuinely right for C7 (nobody needs "The app source (part-files) lives in
`src/parts/`" spelled out when a routing table says so) and genuinely
catastrophic for C6, because the whole point of "nearly every vulnerability in
this repo's history came from ordinary feature code" is that the model **would
not** have inferred it. The inferability judgment is also made by the *minifying*
model, which is systematically miscalibrated: it has just read the original, so
everything looks inferable. If prototyped, it must be gated to C7-classified
spans and forbidden from touching any `WHY`/`EVID` field.

### #5 — Pseudocode ⚠️ **prototype narrowly, for class C5 only; do not adopt file-wide**

The literature's best accuracy numbers, but the fit is partial. It suits the
triage/gate logic (probe B is *already* a boolean expression) and suits nothing
else — rendering "nearly every vulnerability came from ordinary feature code" or
the $59.74 war story as pseudocode would be absurd. Two specific hazards: (a) it
implies executable determinism the rules don't have (many are judgment calls with
`When in doubt` clauses); (b) in a repo whose instruction files are *about JSX
and Python*, pseudocode risks being read as code to write rather than policy to
follow. The pseudo-code paper measured **accuracy on task instructions**, not
**size on policy documents** — it is not evidence for compression at all.

### ❌ #6 — Symbolic / predicate notation — **DO NOT PROTOTYPE**

Four independent disqualifiers:

1. **Human-maintainability is a hard requirement here.** These are public-repo
   files edited by a human across many sessions and reviewed in PRs. A bespoke
   predicate syntax guarantees dialect drift (risk R20) and makes review
   impossible. The repo's own CLAUDE.md warns that CI-verified routing rows must
   be *fixed in the same change* when found wrong — that presupposes a human can
   read them.
2. **It probably isn't even smaller in tokens.** Rare glyphs (`∀ ⊨ ¬ ⊕`) tokenize
   poorly compared to common English words. Byte reduction would overstate token
   reduction (risk R11), possibly to the point of inversion.
3. **No evidence it works.** I found no literature supporting reliable LLM
   compliance with a novel, undefined symbol set; the format-sensitivity result
   points the other way (unfamiliar templates hurt).
4. **The measured headroom doesn't justify the risk.** The whole prize is ~10%.
   Spending opacity to chase it is a bad trade.

### ❌ Also do not prototype — learned/soft compression (gist tokens, LLMLingua-style token dropping)

Named explicitly because it owns the field's biggest numbers (26×, 4×) and will
otherwise keep resurfacing. Ruled out because: it requires model-side control or
a separate compressor model we don't have in the loop; its output is **not a
maintainable source file**, which is the actual deliverable; it optimizes a
downstream *task* metric, not *rule-following fidelity*; and its loss profile is
graceful-degradation, whereas ours is cliff-edged. **Its one transferable idea —
per-content-class compression budgets — is already adopted in §2.**

### ❌ Out of scope by construction — output-side terseness

Any technique whose benefit is shorter *model output* (response style guides,
"be concise" directives, structured-output schemas) is irrelevant here: the
`/minify` gate measures *input* instruction size. Worth stating because
"compression" results in the wild frequently conflate the two.

---

## 5. Projected reduction vs. the ≥20% gate

### 5.1 Model and numbers

Projection = `(1 − verbatim_fraction) × prose_reduction_rate`, using the
**measured** pooled prose rate of **9.2%** and each file's **measured** verbatim
fraction.

| File | Bytes | Verbatim | Projected cut | Bytes saved |
|---|---:|---:|---:|---:|
| `CLAUDE.md` | 18,301 | 33.9% | **6.0%** | ~1,107 |
| `vela-secure-coding/SKILL.md` | 17,634 | 19.7% | **7.3%** | ~1,296 |
| `hyper-sprint/SKILL.md` | 33,907 | 5.6% | **8.6%** | ~2,929 |
| **weighted average** | **69,842** | 16.5% | **7.6%** | **~5,332** |

### 5.2 Can restatement pruning close the gap?

Measured candidate restatement blocks (conceptual, not literal — literal
redundancy is ~0):

| Bytes | Location | What it restates |
|---:|---|---|
| 2,037 | hyper-sprint L19–46 | banner ⟶ principles 3/9/12 |
| 1,901 | hyper-sprint L254–274 | Phase 0b ⟶ principle 1 |
| 1,391 | hyper-sprint L181–198 | P9 "long-session cost levers" ⟶ P2/P3/P6/P12 |
| 1,138 | secure-coding L245–261 | §5 tail ⟶ CLAUDE.md version-bump / disclosure / public-repo |
| 782 | secure-coding L9–18 | intro ⟶ §2/§3/§4/§5 below it |
| 785 | CLAUDE.md L122–133 | "read the secure-coding skill" ⟶ that skill's own Triage |
| 406 | CLAUDE.md L142–157 | "Build Commands" ⟶ "Run CI Checks" (`concat.py`, `test_vela.py` twice) |
| 332 | CLAUDE.md L275–280 | "Ad-hoc testing" ⟶ the section immediately above it |
| **8,772** | | **12.6% of corpus** |

Most of this is **deliberate**. The banner is at the primacy slot on purpose;
principle 9's recap is a recap by design; secure-coding restates CLAUDE.md so the
skill reads correctly on its own. Realistically **40–60% is recoverable**
(~3,500–5,300 B ≈ 5.0–7.5% of corpus) and every byte of it is drawn from the
highest-risk operation in §6 (R4).

**Combined realistic ceiling: ~13–15%.** Maximum-aggression rewriting (probe C′
rate) plus full restatement removal would reach roughly 18–20% — i.e. only by
spending exactly the risks the project exists to avoid.

### 5.3 Verdict on the gate

> ## ❌ The ≥20% average reduction gate does **NOT** clear on this corpus.
> **~7.6%** from rewriting alone; **~13–15%** with aggressive restatement pruning.

Root cause, measured and stated plainly: **these three files are already
minified.** Function-word ratio 21.5–27.5% vs ~44% for ordinary prose; 16.5%
frozen verbatim content; ~0 literal redundancy; a fifth of CLAUDE.md is an
already-optimal lookup table. The `/minify` approach is not failing — the input
has no fat.

Three options for the project, in my recommended order:

1. **Re-scope the gate to a representative corpus, and re-measure.** The 20% bar
   is reasonable for *typical* instruction files. Before abandoning anything,
   sample ~6 CLAUDE.md/SKILL.md files with normal density (function-word ratio
   ≥35%) and re-run the probe protocol. My expectation is the gate clears
   comfortably there. **Pre-register the corpus before measuring** (the
   context.md task-selection-bias rule applies to file selection too).
2. **Split the gate into two verdicts, matching the two things TRB actually
   delivers.** (a) *Size*: ≥20%, keep as-is, applied per-file with a documented
   exemption for pre-densified files (verbatim fraction >25% **or** function-word
   ratio <30%). (b) *Structure*: a constraint-explicitness score — count of
   quantifier/modality tokens made explicit, minus constraints lost. Probe B
   fails (a) at 4.6% and passes (b) decisively. Merging them into one number
   hides exactly the signal worth having.
3. **Only if 1 and 2 both fail: reconsider the project's premise for this repo.**
   Note that the value is not uniform — **CLAUDE.md is always resident** in every
   session, whereas SKILL.md bodies load only on trigger. A 6% cut on CLAUDE.md
   is worth more per byte than a 9% cut on hyper-sprint. If the project narrows
   to "always-resident context only", the honest available prize is ~1.1 KB.

I explicitly do **not** recommend closing the gap by loosening the
semantics-preservation standard. Every measurement above was taken with 100%
constraint survival; the numbers get better the moment that is relaxed, and that
is the one thing this project cannot trade.

---

## 6. Risk list for eval design

Failure modes a rigorous eval suite must guard against. Each has a **detection
method** — a risk with no detector is a wish. `[brief]` marks the ten risks named
in the phase-1 brief.

### Semantic-loss risks

**R1 · Quantifier & modality erosion** `[brief]` — MUST/NEVER/SHOULD/MAY flattened
to a uniform imperative tone; "ANY of" → an unquantified list; "only when" → "when";
"always" dropped. *Corpus exposure:* CLAUDE.md 10 `MUST`, secure-coding 9,
hyper-sprint 8; `never` 14/20/30.
*Detect:* mechanical modality-token census (original vs minified) with a
zero-loss requirement per rule block; plus behavioral probes on a task that is
permitted under SHOULD but forbidden under MUST — the two must diverge.

**R2 · Dropped exception clauses** `[brief]` — the `EXC` content is
grammatically subordinate and dies first. *Corpus exposure:* probe A's
"in-code comments" carve-out; the `part-export-md.jsx` deliberate-duplicate
exception in §2; `--vera-accent` as the one permitted CSS custom property.
*Detect:* enumerate every "except / unless / the one exception / other than /
apart from" in the original, require a 1:1 map into the minified file, and drive
one task *inside* each exception's scope.

**R3 · Negation-to-positive rewriting that narrows a prohibition** `[brief]` —
"never interpolate a deck-derived value into a style sink without its helper"
becoming "use the helper for style sinks": the positive form covers the cases you
thought of; the negative form covers all of them. Aggravated by the
negation-sensitivity literature (§1.3).
*Detect:* polarity diff per rule; and adversarial tasks that satisfy the positive
paraphrase while violating the original prohibition (e.g. a *new* sink the
positive form never enumerated).

**R4 · Salience loss from deduplication or reordering** `[brief]` — the biggest
byte prize (§5.2) is also this risk. Includes: removing the hyper-sprint banner
because principles 3/9/12 "already say it"; dropping `**bold**` (measured at only
1.0–2.4% of file bytes — nearly all cost, no benefit); moving a rule out of the
primacy slot; collapsing an intentional CLAUDE.md ↔ SKILL.md restatement.
*Detect:* treat position and emphasis as versioned properties — record each
rule's (section index, ordinal, emphasis level) before/after and flag any change
for human sign-off. Behaviorally: measure adherence under *distraction* (a long
task where the rule applies only at the end), which is where salience actually
shows up. Never validate a dedup on a short task.

**R5 · Rationale removal breaking generalization** `[brief]` — the rule survives
verbatim, the *why* is cut, and the agent stops applying it to the unlisted case.
*Corpus exposure:* class C6; note that the pseudo-code paper's own ablation
credited comments/docstrings (§1.3).
*Detect:* **held-out generalization tasks** — cases that fall under a rule's
rationale but appear in no list in the file (e.g. a brand-new export format not
among PDF/PPTX/MD/HTML; a Neutralino method not in `nativeAllowList`). This is the
single most important eval family and the one a naive "did it follow the listed
rules" suite will completely miss.

**R13 · Example-set erosion** — worked examples are *calibration anchors*, not
illustrations. Deleting "CSS exfil channel", "mutation-XSS", "fail-open
sanitization" changes the operative boundary of "class of issue"; deleting
probe C's three one-off-lookup examples changes what counts as "one-off".
*Detect:* example census per rule; behavioral probe on a case *between* two
retained examples.

**R14 · Conjunction/disjunction flattening** — `∨` silently becoming `∧` (or vice
versa) when a prose list is bulleted. Probe B contains both in adjacent
paragraphs: full-read is `ANY of` (∨), quick-path is `BOTH` (∧). Swap them and the
gate either never fires or always fires.
*Detect:* boolean-structure extraction per conditional rule; truth-table
comparison over the enumerated arms.

**R15 · Default-vs-hard-rule collapse** — hedged non-constraints hardening into
constraints. Live example: "**≤50 main-loop turns is a heuristic for a
normal-size sprint, not a hard ceiling**" → "≤50 turns". Also "Prefer a root
`.hyper-sprint/config.md`" (preference) vs "`§0` is mandatory" (obligation).
*Detect:* explicit strength labels in the encoding (`MUST`/`SHOULD`/`MAY`/`HEURISTIC`)
+ a behavioral probe that *should* be allowed to exceed the soft bound.

**R18 · Conditional-scope leakage** — a rule scoped to one branch becoming global,
or vice versa. Probe B's two quick-path invariants are the live case: they must
apply on the quick path *and* the full path; lift them wrong and either the quick
path loses its floor or the full path gains a phantom restriction.
*Detect:* per-rule scope annotation; probes run under *both* branches.

### Reference-integrity risks

**R6 · Cross-file and intra-file reference breakage** `[brief]` — this corpus
cites by **heading title**, by **section number**, and by **ordinal**:
"see the *Mandatory* section below", "§0", "§2's canonical helpers", "§5's proof
standard", "principle 8", "principle 9", "(see *Stop rule*)", "CLAUDE.md
*Security-Fix Disclosure Discipline*", "the cost-economy banner at the top of
this file", "**Phase 5**". Renaming, renumbering, merging or reordering any
section silently breaks these — and the breakage is invisible to a test that
doesn't follow the pointer. Note that references cross files in *both* directions
(CLAUDE.md ↔ vela-secure-coding).
*Detect:* build a reference graph before minifying (heading titles, `§n`,
"principle n", "Phase n", file paths); after minifying, assert every edge still
resolves. Run it across the whole `.claude/` tree plus `docs/`, not just the
edited file. **This is cheap, mechanical, and must be a hard CI-style gate.**

**R7 · SKILL.md frontmatter `description` is a retrieval key, not prose** `[brief]`
— the `description` is what a skill is *matched* against; only `name` +
`description` are resident before triggering. Compressing trigger phrasing can
stop the skill from ever being invoked. **The trap named in the brief is real and
severe: an eval that invokes the skill explicitly (`/vela-secure-coding`, or
"read the secure-coding skill") tests the body while the actual regression is in
discovery, and scores a perfect pass on a broken skill.** Live exposure:
vela-secure-coding's description packs `/code-review`, `/security-review`, "PR
review", "vulnerability hunts", "refactors", "exports", plus a glob list — each is
a distinct trigger surface.
*Detect:* a **separate discovery eval** — natural-language task prompts that never
name the skill, measuring invocation rate over N trials, before/after. Treat
frontmatter `description` as **frozen by default**; require an explicit opt-in
plus a passing discovery eval to change one character. Suggested default rule for
the `/minify` skill: *never* minify frontmatter.

**R8 · Verbatim payload / command / path corruption** `[brief]` — 16.5% of the
corpus. A "tidied" flag, a normalized quote, a re-wrapped path, a dropped comment
after a command. Highest-consequence live examples: the `CLAUDE_LOCKDOWN` flags
(parity-tested against a Go gatekeeper), `arr.map((b) => sanitizeBlock(b))` (the
whole point is that it differs from `arr.map(sanitizeBlock)`), the TDZ-sensitive
part-order chain, `hmac.compare_digest`, `O_NOFOLLOW`.
*Detect:* extract all backticked/fenced spans from both versions and require
**set equality on exact bytes** — not fuzzy match. Any diff fails the build.
Additionally, execute every extracted shell command in dry-run where possible.

### Measurement-validity risks

**R9 · Self-report is not evidence** `[brief]` — asking the agent "did you follow
the rules?" measures narration, not behavior (§1.3). Aggravated by the fact that
a minified file's rules are *fresh in context*, so recall is easy while
*application* may have degraded.
*Detect:* structural ban. Every scenario's pass/fail must come from an
**observable artifact**: files written, commands run, whether `VELA_VERSION` was
actually bumped, whether the agent actually read the skill before its first edit,
whether the changelog entry contains a payload. The judge scores artifacts; it
never scores the agent's self-assessment. Recommend the harness *reject* any
rubric item phrased as a question to the agent.

**R11 · Byte reduction ≠ token reduction** — minified text is lexically denser
(measured: function-word ratio drops 6–13 points), and common function words are
cheap single tokens while dense punctuation-heavy text tokenizes worse. Byte
savings can therefore **overstate** token savings; for symbol-heavy encodings it
can invert. No tokenizer was available in this container, so **every number in
this document is bytes, not tokens.**
*Detect:* the harness must measure real tokens (API token-count endpoint or
observed usage from the run), and the ≥20% gate must be evaluated on tokens.
Report both, and flag any case where byte cut > token cut by more than a few points.

**R16 · Numeric and threshold drift** — a rounded or "tidied" number is a changed
rule. Live: `~1.3MB`, `18,421 lines`, `27 block types`, `960×540px`, `361 tests`,
`~0.7 s`, `~10ms`, `10–37K tokens`, `$59.74`, `72M`, `375`, `94%`, `≤50`, `>2`,
exit codes `0/1/2/3/4/5`.
*Detect:* numeric-literal census with exact-match requirement (including units,
tildes, ranges and currency).

**R17 · Ordering-as-semantics** — some sequences are content: the part-file build
order is TDZ-sensitive ("never reorder it"); phases 0a→5 are sequential; §2's
"one canonical helper per context" implies a lookup order; "read the skill
**before** your first code edit" is temporal.
*Detect:* mark ordered lists as ordered in the encoding and diff sequences, not
sets. Behaviorally, probe with a task where doing the right things in the wrong
order is wrong.

**R19 · Position effects independent of text** — even with byte-identical rules,
moving content changes adherence (§1.3 position bias). This makes A/B comparison
of *reorganized* files confounded: you cannot attribute a behavior delta to
wording when position also moved.
*Detect:* prefer position-preserving minification for the first pilot, so wording
is the only variable. If a reorganization is tested, run it as a **separate arm**.

**R21 · Register/tone shift as a confound** — minification systematically shifts
register toward bare imperative. Tone has been reported to move accuracy on some
setups (§1.3, weak evidence).
*Detect:* keep it as a named confound in the analysis; do not treat "same content,
terser tone" as behaviorally neutral by assumption.

**R22 · Verbosity and judge bias** (extends context.md's watchlist) — minified
instructions plausibly produce different *output* length; a judge scoring holistic
"quality" will conflate that with merit.
*Detect:* rubric items must be concrete, per-constraint, artifact-anchored (see
R9). Randomize A/B order; scrub every label and path that could identify the arm;
keep the judge model distinct from the minifying model.

### Process risks

**R10 · Human-edit dialect drift** `[brief]` — six months of hand-edits to a
minified file, with no fixed legend, produces a private dialect: three people
write `EXC` / `EXCEPT` / `unless`; `NEVER` softens to `avoid`; new rules arrive as
untyped prose. The file stops being minified *and* stops being readable.
*Mitigate + detect:* (a) an explicit, versioned **legend block** in every minified
file — the sole authority on field names and symbols; (b) a linter that rejects
unknown field labels and obligations with no modality token; (c) **keep the
original as the source of truth** and treat the minified file as a build product
regenerated by `/minify`, so drift is impossible by construction. Option (c) is
strictly the safest and I recommend it, with the caveat that it doubles the
repo's instruction surface — which is a real cost worth weighing.

**R12 · Scope-list truncation** — long enumerations are prime "tidying" targets;
dropping one of probe B's nine filenames silently narrows a security gate and
nothing visibly breaks.
*Detect:* list-length assertions per enumeration, plus exact set-equality on
enumerated identifiers.

**R20 · Eval contamination / leakage** (extends context.md's watchlist) — the
minified file drifting toward encoding the eval scenarios (inflating scores
without generalizing). Especially likely if the same agent sees both the eval
tasks and the minification job.
*Detect:* strict separation — the minifying agent must never see the scenario
set; keep a **held-out scenario family** never used during iteration; diff each
minified revision for newly-introduced specifics that map onto known scenarios.

### The one detector to build first

Most of R1–R3, R12–R18 collapse into a single mechanism, and it is the technique
that produced §3's evidence: **an enumerated constraint inventory with a 1:1
survival map.** Extract every constraint from the original as a numbered list
(with its modality, scope, polarity, quantifier, exceptions, examples and
numeric literals), then require every item to be located in the minified file.
It is cheap, it is auditable by a human, it caught nothing in my probes precisely
because I ran it while rewriting — and it is the artifact the eval harness should
demand alongside every minified file.

---

## 7. Recommended next steps

1. **Pre-register a second, normal-density corpus** (~6 instruction files with
   function-word ratio ≥35%) and re-run the §3 probe protocol against it. This is
   the fastest way to learn whether the 20% gate is wrong about the approach or
   right about *these files*. Do it before phase 4 builds the skill.
2. **Split the phase-6a verdict into `size` and `structure`** per §5.3(2), and
   record verbatim-fraction + function-word ratio for every file as
   pre-conditions, so a low percentage on a pre-densified file is interpretable
   rather than a failure.
3. **Build the constraint-inventory extractor first** (§6, last subsection) — it
   is the backbone of the quality gate and it is useful before any real
   `claude -p` budget is spent.
4. **Make three things non-negotiable in the `/minify` skill's own rules:**
   frontmatter `description` is never minified (R7); backticked/fenced spans are
   byte-frozen (R8); reference-graph integrity is a hard gate (R6).
5. **Phase 3 (citation verification)**: every ⚠️-tagged number in §1 needs
   primary-source confirmation before it appears anywhere outside this lab
   directory. None of them is load-bearing for the recommendation.
6. **Measure tokens, not bytes, in the harness** (R11). This document's numbers
   are bytes only — no tokenizer was available in-container.

---

## Appendix — measurement provenance

All corpus statistics were computed directly from the live files with Python
`len(text.encode())` and regex extraction; probe extracts were taken byte-exactly
by line range and were **not** modified in place. No file in the repository was
altered by this research. Minified probe texts are reproduced in full in §3 and
are the exact strings measured. Key measurement definitions:

- *verbatim fraction* = bytes inside ``` fences plus bytes inside `inline code`
  spans outside fences, ÷ file bytes.
- *function-word ratio* = share of alphabetic word tokens appearing in a fixed
  84-word English function-word list, after stripping fenced blocks and replacing
  inline-code spans with a placeholder.
- *repeated 8-grams* = distinct 8-word shingles occurring ≥2× after lowercasing
  and stripping markdown punctuation and code.
- *prose-only cut* = (before−after) bytes excluding verbatim spans on both sides.
