# Citation Verification — `research-encoding-formats.md` §1 (Literature Review)

**Author:** citation-verification sub-agent. **Date:** 2026-08-13.
**Scope:** verify every external citation/numeric claim tagged
`⚠️ UNVERIFIED — pending citation-check, snippet-level only` in §1 of
`research-encoding-formats.md`. Source document was **not modified**.

**Tooling available this session:** WebSearch (unrestricted) and WebFetch.
**Confirmed during this check:** direct WebFetch to `arxiv.org`,
`aclanthology.org`, and `news.mit.edu` is **blocked by the network egress
proxy** (`EGRESS_BLOCKED`) — the same constraint the original research
document reported. All arXiv-hosted claims below are therefore verified via
**independent secondary sources and WebSearch result snippets** (which
themselves pull from Google Scholar/HuggingFace/OpenReview/ACL/news-outlet
indexing of the papers), never via a direct fetch of the arXiv page itself.
Where a claim rests only on such secondary corroboration, that is stated
explicitly rather than implying a primary-source read.

---

## 0. Calibration test (required before trusting the method)

**Fabricated citation invented for this test:** *"Semantic Drift
Coefficients: A Unified Metric for Instruction Compression Fidelity"*,
claimed as arXiv 2503.14829, asserting "compression above 15% causes semantic
drift exceeding 0.34 on the SDC scale in 89% of cases." No such paper,
metric, or finding was consulted or half-remembered — it was constructed
purely to look plausible (real-sounding title, correctly-formatted arXiv ID,
a specific number).

**Result:** WebSearch on the exact title and on the arXiv ID both returned
**no matching paper**. The tool surfaced only tangentially related real
papers (on semantic compression / semantic drift generally) and explicitly
stated the ID "does not show a paper with that exact identifier" and
speculated it "may not exist." This is the correct behavior — a genuine
paper's ID+title pair (see §2 below) reliably returns a direct hit with
matching abstract content; the fabricated one did not.

**Verdict: method calibrated correctly.** Proceeding to the real citations.

---

## 1. Extracted citation clusters

§1.3 of the source document contains 10 distinct claim-clusters, citing 15
individual sources. Each is checked below.

---

## 2. Verdicts

### 2.1 LLMLingua / LongLLMLingua (Microsoft Research)
**Claim:** budget-controller allocates compression ratios per prompt module;
LongLLMLingua reports "up to a 17.1% performance improvement while reducing
token count by approximately fourfold"; LLMLingua-2 reframes compression as
token classification distilled from a stronger model.
**Sources cited:** MS Research blog; arXiv 2310.06839 (LongLLMLingua).

**Verdict: VERIFIED.** High confidence.
- LongLLMLingua's headline "17.1%... ~4x fewer tokens" figure (NaturalQuestions
  benchmark) is directly corroborated by multiple independent secondary
  summaries (Hugging Face paper page, alphaXiv, OpenReview, summarizepaper.com)
  quoting the same number, plus a slightly different but co-existing figure
  ("up to 21.4%... GPT-3.5-Turbo") for a different model/benchmark within the
  same paper — not a contradiction, just a different reported instantiation.
- WebFetch of the Microsoft Research blog post itself (succeeded, not
  arXiv-blocked) confirms LLMLingua/LongLLMLingua exist and confirms the
  budget-controller mechanism ("we employed a budget controller to balance
  the sensitivities of different modules in the prompt") — consistent with,
  though not verbatim identical to, the document's "instructions vs.
  demonstrations" framing.
- LLMLingua-2's description ("token classification problem," "distillation
  from GPT-4," BERT-level encoder) is independently confirmed via Microsoft
  Research's own publication page and GitHub — matches the document's gloss
  closely, though the MS blog page fetched did not itself mention LLMLingua-2
  (it predates it); the description is corroborated from other MS sources instead.

### 2.2 Gisting / soft-prompt compression (Mu, Li, Goodman — NeurIPS 2023)
**Claim:** "up to 26x compression … up to 40% FLOPs reductions … with minimal
loss in output quality." **Source:** arXiv 2304.08467.

**Verdict: VERIFIED.** High confidence. Paper exists (confirmed via arXiv
abstract-page search snippet, NeurIPS 2023 listing, Harvard ADS, ResearchGate,
Medium summary), correct authors (Jesse Mu, Xiang Lisa Li, Noah Goodman). The
exact figures "up to 26x compression," "up to 40% FLOPs reductions," and
"minimal loss in output quality" are reproduced verbatim/near-verbatim across
independent secondary summaries of the abstract. arXiv itself not directly
fetched (blocked); relying on convergent secondary sourcing.

### 2.3 Pseudo-code instructions (Mishra, Kumar et al. — EMNLP 2023)
**Claim:** "average increase (absolute) of 7-16 points in F1 for
classification tasks and a relative improvement of 12-38% in aggregate
ROUGE-L," on BLOOM and CodeGen, 132 Super-NaturalInstructions tasks, ablation
crediting comments/docstrings/structural clues. **Source:** ACL Anthology
2023.emnlp-main.939.

**Verdict: VERIFIED.** High confidence — the strongest-corroborated claim in
the set. Independent search of the ACL Anthology page/OpenReview version
returns the **exact same numbers** ("7-16 points" F1, "12-38%" ROUGE-L),
correct model families (BLOOM, CodeGen), correct task count (132, from
Super-NaturalInstructions), and the ablation finding is reproduced almost
word-for-word ("code comments, docstrings, and the structural clues encoded
in pseudo-code all contribute"). Correct authors (Mishra, Kumar, Bhat, Murthy,
Contractor, Tamilselvam). Direct WebFetch of aclanthology.org was blocked;
verified via multiple independent secondary indexes agreeing on the same
figures.

### 2.4 Prompt formatting sensitivity (He et al., 2024)
**Claim:** GPT-3.5-turbo varies "by up to 40% in a code translation task"
across text/Markdown/YAML/JSON templates; GPT-4 more robust. **Source:**
arXiv 2411.10541.

**Verdict: VERIFIED.** High confidence. Paper "Does Prompt Formatting Have
Any Impact on LLM Performance?" (Jia He et al., arXiv 2411.10541, Nov 2024)
confirmed via arXiv abstract-page search result, GitHub paper-notes issue,
Hugging Face paper page, and a Medium writeup, all agreeing on the "up to 40%"
figure for GPT-3.5-turbo on code translation and the qualitative claim that
GPT-4 is more robust to template changes.

### 2.5 Controlled natural language / CNL-P / ASD-STE100
**Claim:** CNL-P is a CFG-based prompt-discipline proposal; ASD-STE100 Issue 8
carries "53 writing rules." **Sources:** Wikipedia (STE, CNL), arXiv 2508.06942.

**Verdict: VERIFIED.** High confidence on both parts.
- CNL-P paper exists exactly as described: "When Prompt Engineering Meets
  Software Engineering: CNL-P as Natural and Robust 'APIs' for Human-AI
  Interaction," arXiv 2508.06942, submitted Aug 9 2025, matches the document's
  gloss (context-free grammar, static analysis, modular design) closely,
  confirmed via arXiv abstract listing, ResearchGate, and OpenReview mirrors.
- ASD-STE100 Issue 8's "53 writing rules" figure is confirmed independently by
  multiple STE-focused sources (Acrolinx guide, the official ASD-STE100 PDF
  itself, a third-party Claude-skill README built directly from the standard),
  all stating 53 rules across 9 sections.

### 2.6 Negation sensitivity
**Claim:** open-source models endorse prohibited actions "77% of the time
under simple negation and 100% under compound negation — a 317% increase over
affirmative framing," commercial models show "swings of 19-128%"; separately,
negation-processing mechanisms are "overshadowed by other mechanisms at later
layers." **Sources cited:** arXiv 2601.21433, MIT News.

**Verdict: VERIFIED (main statistic) / MISATTRIBUTED (mechanistic quote) — see
Finding C in §3.** Medium-high confidence on the statistic, low confidence the
"overshadowed" quote is correctly sourced.
- "When Prohibitions Become Permissions: Auditing Negation Sensitivity in
  Language Models" (Elkins & Chun, Kenyon College, arXiv 2601.21433, submitted
  Jan 29 2026) is a real paper. The 77% / 100% / 317% / 19-128% figures are
  reproduced consistently across independent secondary coverage (Quantum
  Zeitgeist, Unite.AI) and a search-engine snippet of the paper's own HTML
  abstract page — all agree on the same numbers. arXiv itself not directly
  fetchable (blocked); this rests on convergent secondary sourcing, which the
  document itself flags as its evidentiary ceiling.
- The MIT News article exists and is genuine, but it is about a **different,
  narrower study**: vision-language models failing to handle negation words in
  image-caption *retrieval* (Kumail Alhamoud et al., CVPR, May 2025) — not
  about general-purpose LLM prohibition-endorsement or about
  "negation-processing mechanisms... overshadowed... at later layers." That
  specific mechanistic-interpretability quote traces (per an independent
  search) to a **third, uncited paper** — "How Language Models Process
  Negation" (arXiv 2605.03052) — which the document does not cite at all. See
  Finding C.

### 2.7 Position bias / "lost in the middle"
**Claim:** U-shaped serial-position curve; effect "is strongest when inputs
occupy up to 50% of a model's context window." **Source:** arXiv 2510.10276.

**Verdict: MOSTLY VERIFIED, with a MISATTRIBUTION — see Finding A in §3.**
Medium confidence. arXiv 2510.10276, "Lost in the Middle: An Emergent
Property from Information Retrieval Demands in LLMs," is a real paper and its
general finding (U-shaped curve from primacy/recency training dynamics) is
accurately summarized. **However**, the specific "up to 50% of a model's
context window" figure does not appear to belong to this paper — it is the
headline abstract finding of a **different** paper, arXiv 2508.07479,
"Positional Biases Shift as Inputs Approach Context Window Limits" (Veseli,
Chibane, Toneva, Koller; COLM 2025), whose abstract states almost verbatim:
"the Lost in the Middle (LiM) effect is strongest when inputs occupy up to
50% of a model's context window." The document cites only 2510.10276 for this
sentence; the correct source for the specific number is 2508.07479.

### 2.8 Tone/register sensitivity ("Mind Your Tone")
**Claim:** ChatGPT-4o accuracy "from 80.8% for Very Polite prompts to 84.8%
for Very Rude prompts," 50 MCQs. **Source:** arXiv 2510.04950.

**Verdict: VERIFIED**, with one minor imprecision noted. High confidence.
"Mind Your Tone: Investigating How Prompt Politeness Affects LLM Accuracy"
(arXiv 2510.04950) is real and the 80.8%/84.8% figures match exactly across
multiple independent outlets (arXiv abstract snippet, news9live, Fello AI,
Cool Papers, an X/Twitter research summary). Minor imprecision: the study
used 50 *base* questions expanded into 250 tone-variant prompts (5 tones ×
50), so "50 MCQs" undercounts the actual evaluated prompt set by 5x — the
document's own hedge ("small n, single model, MCQ-only... suggestive at
best") already flags this as low-power regardless, so the imprecision doesn't
change the document's stated confidence level.

### 2.9 Self-report unreliability
**Claim:** "considerable inconsistencies between LLM self-report ratings and
revealed behavioral scores"; self-knowledge as "self-narration, driven by
learned linguistic conventions." **Sources:** arXiv 2509.03730 ("The
Personality Illusion"), arXiv 2606.12730 ("Rethinking Psychometric Evaluation
of LLMs").

**Verdict: VERIFIED.** High confidence. Both papers exist and are a real
pair — the second (June 2026) is a direct follow-up to the first (Sept 2025)
by an overlapping author list (Kocielnik, Han, Song, Debnath, Mobbs,
Anandkumar, Alvarez — Caltech/UIUC/Cambridge). "The Personality Illusion"'s
core finding — self-reported traits do not reliably predict behavior — is
confirmed via arXiv abstract, GitHub repo, and independent review summaries
(themoonlight.io). The "self-narration... learned linguistic conventions"
phrasing was not independently reproduced verbatim in secondary sources found,
so that exact wording is plausible-but-unconfirmed at the phrase level, though
the underlying claim (self-report unreliable, driven by learned patterns
rather than genuine introspection) is squarely consistent with both papers'
abstracts.

### 2.10 Agent Skills discovery mechanics (Anthropic platform docs)
**Claim:** "median discovery cost near 80 tokens each"; description "is what
Claude matches your request against when determining whether to trigger the
Skill." **Source cited:** Agent Skills overview
(platform.claude.com/docs/en/agents-and-tools/agent-skills/overview).

**Verdict: PARTIALLY VERIFIED / MISATTRIBUTED — see Finding B in §3.** High
confidence (direct WebFetch of the cited URL succeeded, unlike arXiv).
- The description-as-retrieval-key claim is **verified verbatim**: the live
  page states exactly "The `description` is what Claude matches your request
  against when determining whether to trigger the Skill."
- The **"median discovery cost near 80 tokens each" figure does NOT appear on
  the cited page.** The actual platform docs state a flat "~100 tokens per
  Skill" estimate for Level-1 metadata, with no "median" framing and no
  range. The "median... near 80 tokens... ranging from about 55 to 235"
  figure traces instead to an **independent third-party measurement**
  (a SwirlAI newsletter piece, "State of Context Engineering in 2026",
  analyzing 17 official Anthropic skills) — not to Anthropic's own
  documentation as the citation label implies.

---

## 3. Escalated findings — misattribution (not fabrication)

None of the citations appear **fabricated** — every paper, blog post, and
docs page named or implied is a real, findable source, and the calibration
test in §0 confirms the method would have caught an invented one. However,
three specific numeric/quoted claims are **misattributed** to the wrong
source or to a source that doesn't contain them. These are worth flagging
before anything in §1 is promoted to public-facing text:

**Finding A — Position-bias "50% of context window" figure (§2.7).** Cited
solely to arXiv 2510.10276; the figure is the headline finding of a different
paper, arXiv 2508.07479 ("Positional Biases Shift as Inputs Approach Context
Window Limits," Veseli et al., COLM 2025), which the document does not cite
at all.

**Finding B — Agent Skills "median ~80 tokens" figure (§2.10).** Labeled
"(Anthropic platform docs)" and cited to the official overview page; the live
page gives a different, non-median number (~100 tokens/skill) and no range.
The 80-token median with a 55–235 range is a named third-party analysis
(SwirlAI, 2026), not Anthropic's own documentation.

**Finding C — Negation "mechanisms overshadowed at later layers" quote
(§2.6).** Attached to citations for arXiv 2601.21433 and an MIT News article
about a different (vision-language, image-caption) study; the phrase appears
to originate in a third paper, arXiv 2605.03052 ("How Language Models Process
Negation"), which the document never cites.

**Assessment:** these read as citation-hygiene slips consistent with how the
original research was produced — snippet-level WebSearch evidence assembled
under a blocked-arXiv constraint, with topically-adjacent sources bundled
under one citation line — rather than deliberate fabrication. But by the
project's own numeric-claim discipline, all three numbers/quotes must be
re-attributed to their correct source (or dropped) before appearing in the
`/minify` skill, a PR body, or any public-facing text. This is a real,
if modest, finding worth a maintainer's attention: it shows the "snippet-only,
pending citation-check" tag in the source document was the right call, and
that citation-checking catches concrete, fixable errors even when nothing is
outright invented.

---

## 4. Summary

| # | Citation cluster | Verdict | Confidence |
|---|---|---|---|
| 1 | LLMLingua / LongLLMLingua / LLMLingua-2 | Verified | High |
| 2 | Gisting (Mu et al., NeurIPS 2023) | Verified | High |
| 3 | Pseudo-code instructions (Mishra et al., EMNLP 2023) | Verified | High |
| 4 | Prompt formatting sensitivity (He et al., 2024) | Verified | High |
| 5 | CNL-P / ASD-STE100 | Verified | High |
| 6 | Negation sensitivity — main statistic | Verified | Medium-high |
| 6b | Negation — "overshadowed at later layers" quote | Misattributed (Finding C) | Medium |
| 7 | Position bias / lost-in-the-middle | Misattributed (Finding A) | Medium |
| 8 | Tone/register ("Mind Your Tone") | Verified (minor n imprecision) | High |
| 9 | Self-report unreliability (2 papers) | Verified | High |
| 10 | Agent Skills discovery mechanics | Partially verified / Misattributed (Finding B) | High |

**Totals:** 10 citation clusters checked (15 individual sources). **7 fully
verified**, **1 verified with a minor, non-material imprecision**, **3
carry a misattribution** (Findings A, B, C — one of which, C, sits inside an
otherwise-verified cluster). **0 contradicted outright. 0 fabricated** — the
calibration test (§0) confirms the method reliably distinguishes real from
invented sources, and every source named in §1 does exist.

**Reminder of scope:** none of this affects the source document's actual
recommendation, which per its own §1.1 rests entirely on §3's measured
hand-minification probes, not on this literature. This report only clears
(or flags) the literature review's citations for eventual public-facing use,
per the project's citation-verification discipline.
