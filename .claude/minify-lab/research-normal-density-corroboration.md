# Research — Normal-Density Corroboration Study for `/minify`

**Phase 1b deliverable.** Author: research sub-agent (opus). Date: 2026-08-13.
**Commissioned by:** the orchestrator's autonomous decision of 2026-08-13
(`context.md` → *Autonomous decisions* → option 2), following phase 1's finding
that the locked **≥20% average-reduction gate does not clear** on this repo's
own instruction files.

**Question this study answers — and the one it does not.**

> **Answers:** is the ≥20% gate *wrong about the TRB approach*, or was it merely
> *miscalibrated for this repo's already-pre-densified files*?

> **Does not answer:** whether TRB preserves behavior. That is phase 6's job.
> Every number here is size + constraint survival, exactly as in phase 1.

**Method:** identical to `research-encoding-formats.md` §3 — same instrument
definitions (Appendix), same probe protocol, same 100%-constraint-survival
standard, same bytes-not-tokens caveat (R11).

---

## 1. PRE-REGISTRATION (written before any candidate file was fetched or measured)

> **Ordering commitment.** This section was written to disk **before** a single
> candidate file was retrieved. The only measurements taken before it existed
> were (a) instrument calibration against the three **already-published**
> vela-slides numbers in `research-encoding-formats.md` (that corpus is not a
> candidate here), and (b) nothing else. No candidate file's bytes, density, or
> compressibility were known at the time this list was fixed.
>
> This is `context.md`'s anti-bias watchlist item *"Task-selection bias: fix the
> scenario set before seeing results"*, applied to **file selection** as phase 1
> §5.3(1) explicitly required.
>
> **Independently verifiable.** The orchestrator's "commit after every phase"
> rule happened to snapshot this file mid-flight, at commit `5f6173f`
> (2026-08-13T03:43:46Z), while it contained **only** §1 — no measurements, no
> file stats, no results. `git show 5f6173f:.claude/minify-lab/research-normal-
> density-corroboration.md` reproduces the pre-registration exactly as fixed,
> and greps clean for every headline number reported below. The ordering claim
> in this section does not rest on my say-so.

### 1.1 Inclusion criteria (fixed in advance)

A candidate file must be:

1. **Not from `vela-slides`** — phase 1 established this repo's files are
   pre-densified; re-measuring them proves nothing.
2. **Markdown** — the instrument's verbatim-span extraction is defined over
   ``` fences and `inline code`. RST/plain-text files would under-report
   verbatim fraction and thereby *inflate* the projected reduction. Excluded to
   avoid a favourable measurement artifact.
3. **Instruction-genre** — normative, procedural, or policy text that tells an
   agent (human or LLM) what it must/must not do. Not tutorials, not API
   reference, not marketing.
4. **≥3 KB** — below that, percentage reductions are dominated by single-line
   noise.
5. **Predicted normal density** — predicted function-word ratio ≥35%, i.e.
   plainly *not* already telegraphic. **This is a prediction, not a filter:**
   see the honesty commitment in §1.4.

### 1.2 The six pre-registered files

| # | Repo | Path | Genre | Why this file |
|---|---|---|---|---|
| **N1** | `atom/atom` | `CONTRIBUTING.md` | Human contributor guide | The canonical *deliberately verbose* OSS contributing guide, widely copied as a template. Long explanatory register, few code spans. The closest non-AI analogue to CLAUDE.md, written by an author community that did **not** pre-compress. |
| **N2** | `nodejs/node` | `doc/contributing/pull-requests.md` | Procedural gate doc | Long step-by-step procedure with hard gates ("you must", "do not") — content classes **C3** (hard constraints) and **C4** (sequential procedures) in ordinary prose register. Independent authoring community from N1. |
| **N3** | `kubernetes/community` | `contributors/guide/pull-requests.md` | Large-project policy | Verbose process policy heavy on conditional/triage logic — content class **C5**, the class where vela's probe B did *worst* (4.6%). Directly tests whether C5's poor yield was intrinsic to the class or an artifact of vela's already-compressed phrasing. |
| **N4** | `google/styleguide` | `pyguide.md` | Normative rules-in-prose | MUST/SHOULD/NEVER semantics carried by full English sentences — the direct analogue of CLAUDE.md's `## CRITICAL:` sections, but written expansively. Also supplies a file with substantial-but-not-dominant code content, so the verbatim-fraction term in the projection is exercised. |
| **N5** | `github/awesome-copilot` | **largest** `*.instructions.md` file in the repo's instructions directory | **Real AI-agent instruction file** | The exact genre `/minify` targets, authored by a community other than this repo's telegraphic author. **Selection rule is pre-registered and size-based only** — it cannot be influenced by how well a file compresses, and it is decided before density is measured. |
| **N6** | `openai/codex` | `AGENTS.md` | **Real AI-agent instruction file** | A second agent-instruction sample from an independent vendor, so the genre that matters most does not rest on a single file. |

### 1.3 Substitution rule (fixed in advance)

A pre-registered file may be replaced **only** because it cannot be retrieved
(path does not exist / fetch fails) — **never** because of its measured
density, its size, or how well it compresses.

- N6 has a named fallback: `microsoft/vscode` → `CONTRIBUTING.md`.
- Any other unretrievable primary is replaced from this ordered reserve list:
  **(R1)** `microsoft/vscode` `CONTRIBUTING.md` ·
  **(R2)** `rust-lang/rust` `CONTRIBUTING.md` ·
  **(R3)** `facebook/react` `CONTRIBUTING.md`.
- Every substitution actually used is recorded in §2 with its reason.

### 1.4 Honesty commitments (fixed in advance)

1. **A file that measures below the predicted 35% stays in the study** and is
   reported as a failed prediction. It is not swapped out. (Dropping it would
   be exactly the selection bias this section exists to prevent.)
2. **Probe sections are chosen by a blind, deterministic rule, not by
   compressibility.** In each probed file, take the **first section in document
   order** whose body is **1,200–2,500 B** and which states **≥3 normative
   constraints** (obligations / prohibitions / conditions). "First in document
   order" is fixed so the probe cannot be shopped for.
3. **Probes are run on N1, N2, N3** (in that order) **plus one agent-instruction
   file** (N5, else N6) — genre coverage decided now, not after seeing yields.
4. **100% constraint survival is not negotiable.** If a probe cannot reach its
   byte reduction without dropping a constraint, the byte reduction is reported
   as-is and the constraint is restored. Phase 1's standard, unchanged.
5. **Both directions of the result get published.** If TRB fails to clear 20%
   on normal-density text, that finding lands here in the same form as a pass.

---

## 2. Headline findings

*(Placed after §1 deliberately — the pre-registration must be the first thing a
reader sees, so it cannot be mistaken for something written around the results.)*

1. **The gate was miscalibrated, not wrong about TRB — but only partly for the
   reason phase 1 guessed.** On genuinely normal-density *normative prose*, TRB
   at matched aggression cuts **27.2% and 27.5%** on two independent files
   (node.js, Kubernetes), at **100% constraint survival**. The ≥20% bar clears
   there with room to spare.
2. **It does not clear on whole real-world instruction *files*.** Projected
   whole-file reduction is **16.4% across the six pre-registered files** and
   **19.6% across the three that actually met the density prediction** — because
   real files are only *partly* normative prose. The rest is frozen machinery.
3. **Two of my six pre-registered predictions failed, and the failures are the
   most useful result in this study.** `atom/atom CONTRIBUTING.md` (predicted
   verbose) measures **25.5%** function-word ratio — *denser than this repo's
   hyper-sprint skill* — because **37.5% of it is link-reference definitions and
   URL machinery**. `github/awesome-copilot`'s largest instruction file is
   **71.1% fenced code** with **zero** sections carrying ≥3 normative statements.
   Real-world instruction files are frequently not prose at all.
4. **The projection formula in phase 1 §5.1 systematically over-projects on
   link-heavy files.** `verbatim_fraction` counts only ``` fences and
   `inline code`. It misses **URLs and link-reference definitions**, which are
   just as byte-frozen — you cannot reword a URL. For `atom/atom` that is the
   difference between a 5.0% and a **37.5%** frozen fraction, i.e. between a
   projected 21.4% (clears the gate) and **15.6%** (does not). **This is a live
   defect in the phase-1 model and in the `reduction.py` design that inherits
   it.** See §6.2.
5. **Lexical density predicts achievable reduction, tightly.** Across my four
   probes, function-word ratio vs. achieved cut correlates at **r = 0.998**
   (careful tier) / **r = 0.978** (aggressive tier); pooled with phase 1's five
   probes at matched aggression, **r = 0.734** (n = 9). Reduction is a property
   of *the input's density*, not of the minifier's cleverness.
6. **The instruction-file genre as a whole is pre-compressed relative to English
   prose.** Measured on one instrument: ordinary narrative prose **51.0%**,
   verbose OSS instruction docs **37.8–40.9%**, this repo's files **27.9–31.0%**,
   a real published agent-instruction file **18.2%**. Phase 1 framed
   pre-densification as *this author's* habit. It is partly a **genre** property.
   A flat percentage claim is therefore unsupportable for *any* corpus.
7. **Constraint survival held at 100% across all four probes** (15 + 22 + 32 + 18
   = **87 of 87**), with byte-exact set-equality on every verbatim span *and*
   every URL. Two fidelity defects that my own aggressive pass introduced were
   caught by the survival check and repaired at a cost of 20 bytes — evidence
   that the check works and that it must be mechanical, not vibes (§4.6).

---

## 3. Instrument and calibration

### 3.1 Definitions (replicated verbatim from phase 1's Appendix)

- **verbatim fraction** = bytes inside ``` fences + bytes inside `inline code`
  spans outside fences, ÷ file bytes.
- **function-word ratio** = share of alphabetic word tokens appearing in a fixed
  **84-word** English function-word list, after stripping fenced blocks and
  replacing inline-code spans with a placeholder.
- **prose-only cut** = (before − after) bytes excluding verbatim spans on both
  sides.
- **projection** = `(1 − verbatim_fraction) × prose_reduction_rate`.

### 3.2 Calibration against phase 1's published numbers

Phase 1 did **not** enumerate its 84-word list, so exact replication of that one
component is impossible from the document alone. I therefore built an explicit
84-word closed-class list (reproduced in the Appendix) and calibrated it against
phase 1's three published files.

| File | verbatim % — phase 1 | verbatim % — this study | fw % — phase 1 | fw % — this study | Δ fw |
|---|---:|---:|---:|---:|---:|
| `CLAUDE.md` | 33.9 | **33.9** | 21.5 | 27.9 | +6.4 |
| `vela-secure-coding/SKILL.md` | 19.7 | **19.7** | 24.5 | 29.5 | +5.0 |
| `hyper-sprint/SKILL.md` | 5.6 | **5.6** | 27.5 | 31.0 | +3.5 |

**Verbatim-fraction extraction reproduces phase 1 exactly** (3/3, to the tenth) —
that half of the instrument is a confirmed replication.

**The function-word ratio carries a consistent +5.0-point offset** (mean of
+6.4/+5.0/+3.5). My list is more inclusive; it counts quantifier and modal tokens
(`not`, `only`, `no`, `must`, `any`, `all`) that phase 1's list evidently did not.
Independent confirmation of the offset's size: phase 1 cites *"~44% for ordinary
English prose"* ⚠️ **UNVERIFIED — pending citation-check, snippet-level only**;
my instrument measures a 200 KB sample of ordinary narrative prose at **51.0%**,
i.e. **+7** on the same claim. The offset is real, stable, and in one direction.

**Consequence, and how this study handles it.** All comparisons below are made
**within one instrument**, so the offset cancels. Where an absolute number must
be mapped onto phase 1's scale (e.g. the pre-registered ≥35% bar, or
`context.md`'s <30% pre-densification exemption), I report an **offset-corrected**
value (measured − 5.0) and label it as such. I did **not** tune my word list to
reproduce phase 1's numbers: fitting an instrument to a target output is exactly
the kind of post-hoc adjustment this project's watchlist exists to prevent.

### 3.3 A measured density scale (all one instrument, uncorrected)

| Text | fw % | What it establishes |
|---|---:|---|
| Ordinary narrative prose (200 KB control) | **51.0** | Top of the scale |
| `nodejs/node` pull-requests doc (N2) | 40.9 | Verbose instruction prose |
| `kubernetes/community` PR guide (N3) | 39.6 | " |
| `google/styleguide` pyguide (N4) | 37.8 | Normative rules in full sentences |
| `openai/codex` AGENTS.md (N6) | 33.9 | Real agent-instruction file |
| **this repo — hyper-sprint** | **31.0** | Phase 1's densest |
| **this repo — secure-coding** | **29.5** | |
| **this repo — CLAUDE.md** | **27.9** | |
| `atom/atom` CONTRIBUTING (N1) | 25.5 | Prediction failure — link machinery |
| `awesome-copilot` instructions (N5) | 18.2 | Prediction failure — 71% code |

The control was retrieved from a GitHub mirror of a public-domain text
(Project Gutenberg's own host is blocked by the container's egress proxy).

---

## 4. Baseline measurements and probes

### 4.1 Baseline stats for the six pre-registered files

All six were retrieved **byte-exactly** over raw HTTP (no HTML→markdown
conversion, no model in the loop), on 2026-08-13. `frozen_ext` is this study's
extended frozen fraction: fences + inline code + link-reference definitions +
bare URLs (§6.2).

| # | File | Bytes | verbatim % | **frozen_ext %** | fw % | fw (corrected) | fw, prose only | Prediction ≥35%? |
|---|---|---:|---:|---:|---:|---:|---:|:--:|
| N1 | `atom/atom` CONTRIBUTING.md | 48,035 | 5.0 | **37.5** | 25.5 | ~20.5 | 34.7 | ❌ **FAILED** |
| N2 | `nodejs/node` pull-requests.md | 27,384 | 7.5 | 14.0 | **40.9** | ~35.9 | 43.3 | ✅ |
| N3 | `kubernetes/community` pull-requests.md | 42,668 | 4.8 | 9.1 | **39.6** | ~34.6 | 41.2 | ✅ |
| N4 | `google/styleguide` pyguide.md | 115,828 | 26.4 | 28.3 | **37.8** | ~32.8 | 38.7 | ✅ |
| N5 | `awesome-copilot` azure-logic-apps…instructions.md | 64,287 | **71.1** | **72.5** | 18.2 | ~13.2 | 18.8 | ❌ **FAILED** |
| N6 | `openai/codex` AGENTS.md | 22,519 | 20.6 | 21.6 | 33.9 | ~28.9 | 34.3 | ⚠️ borderline |
| | **total** | **320,721** | | | | | | 3 of 6 clean |

**No substitutions were needed** — all six pre-registered paths resolved. N6's
named fallback went unused. The N5 selection rule ("largest `*.instructions.md`")
resolved mechanically to `azure-logic-apps-power-automate.instructions.md`
(64,287 B, largest of 192 candidates) and was taken as-is.

**Honest reading of the failures** (kept in the study per commitment §1.4.1):

- **N1** — my stereotype ("verbose OSS contributing guide") was right about
  *volume* and wrong about *density*. 10,818 B of link-reference definitions plus
  4,761 B of inline URLs — **37.5% of the file** — are frozen strings whose
  alphabetic tokens (`search`, `atom`, `repo`, `label`, `issue`) inflate the
  denominator with near-zero function words. Its **actual prose** measures 34.7%,
  i.e. normal-ish. The file is normal prose wrapped in a lot of machinery.
- **N5** — a 64 KB, top-of-its-repo "AI-agent instruction file" that is
  essentially a **code-snippet catalogue**: 71.1% fenced code, 2,288 prose word
  tokens in the whole file, and **zero** sections meeting the pre-registered
  probe criterion (1,200–2,500 B *and* ≥3 normative statements). Its densest
  section has 0 normative markers. This is a genuine and somewhat alarming
  datapoint about the genre `/minify` is aimed at.

### 4.2 Probe-section selection (mechanical, per §1.4.2)

The rule — *first section in document order, 1,200–2,500 B, ≥3 normative
statements* — was applied by script to N1, N2, N3, then to the agent-instruction
slot. Full section maps were produced for each file; the rule selected:

| Probe | File | Section (first qualifying, document order) | Lines | Bytes |
|---|---|---|---|---:|
| **P1** | N1 | `#### Before Submitting A Bug Report` | 110–116 | 1,247 |
| **P2** | N2 | `### Step 9: Discuss and update` | 304–344 | 1,655 |
| **P3** | N3 | `# Why is my pull request not getting reviewed?` | 120–151 | 2,213 |
| **P4** | N6 | `### TUI Styling (ratatui)` | 146–157 | 1,498 |

**Why P4 comes from N6, not N5.** The pre-registered agent-instruction slot was
"N5, else N6". N5 produced **zero** qualifying sections under the rule — no
section in the entire 64 KB file is both 1,200–2,500 B and states ≥3 normative
constraints. The fall-through is therefore rule-driven, not discretionary. N5's
non-probeability is reported as a finding rather than hidden as a substitution.

**Not cherry-picked, and it shows:** the rule handed me P1 and P4, the two
*worst*-compressing sections in the study. Had I been free to choose, I would
have picked neither.

### 4.3 Two aggression tiers, and why both are reported

Phase 1's headline (10.3% pooled) came from its *careful* pass; it tested maximum
aggression on a single probe (C′, 15.7% → 18.3%). My first pass came out at
**12.7% pooled** — but its function-word drop averaged only **4.6 points**
against phase 1's **~8**, meaning I had compressed *less hard* than phase 1 did.
Comparing my careful tier to phase 1's numbers would have **under-reported TRB on
normal-density text**, so I ran a second, matched-aggression tier (fw drop 3.9–13.7,
mean **7.9** — now aligned with phase 1's range). Both tiers are reported.
The aggressive tier is the headline **because it is the tier that matches phase
1's C′ protocol**, not because it is the larger number.

### 4.4 Results (exact bytes)

| Probe | Source | Before | Careful | Cut | **Aggressive** | **Cut** | Frozen-aware cut | fw before → after |
|---|---|---:|---:|---:|---:|---:|---:|---|
| **P1** | atom · bug-report precheck | 1,247 | 1,137 | 8.8% | **1,068** | **14.4%** | 23.2% | 33.2 → 26.6 |
| **P2** | node · discuss & update | 1,655 | 1,371 | 17.2% | **1,205** | **27.2%** | 32.9% | 45.1 → 31.4 |
| **P3** | k8s · why no review | 2,213 | 1,890 | 14.6% | **1,604** | **27.5%** | 29.3% | 42.2 → 30.0 |
| **P4** | codex · TUI styling | 1,498 | 1,377 | 8.1% | **1,324** | **11.6%** | 12.1% | 32.9 → 29.0 |
| | **POOLED (P1–P4)** | **6,613** | **5,775** | **12.7%** | **5,201** | **21.4%** | **25.0%** | |
| | **normal-density only (P2+P3)** | **3,868** | 3,261 | 15.7% | **2,809** | **27.4%** | **30.7%** | |

Pooled **prose-only** cut (phase 1's definition): careful **13.3%**, aggressive
**22.5%**. With URLs also treated as frozen: **14.8%** / **25.0%**.

**Integrity checks, both passing on all four probes:**

- **R8 verbatim set-equality** — the multiset of fenced + inline-code spans is
  byte-identical before/after (P1 0=0, P2 6=6, P3 3=3, P4 3=3; zero missing,
  zero added).
- **URL integrity** — every URL byte-identical before/after (7, 1, 3, 0).

### 4.5 The probes in full, with constraint-survival checks

> Format: **BEFORE** is byte-exact from the fetched file. **AFTER** is the
> aggressive-tier TRB rewrite that was measured. Survival tables enumerate
> *every* constraint in the original.

#### Probe P1 — `atom/atom` CONTRIBUTING.md L110–116 · 1,247 → 1,068 B (**14.4%**)

**BEFORE (1,247 B):**

```markdown
#### Before Submitting A Bug Report

* **Check the [debugging guide](https://flight-manual.atom.io/hacking-atom/sections/debugging/).** You might be able to find the cause of the problem and fix things yourself. Most importantly, check if you can reproduce the problem [in the latest version of Atom](https://flight-manual.atom.io/hacking-atom/sections/debugging/#update-to-the-latest-version), if the problem happens when you run Atom in [safe mode](https://flight-manual.atom.io/hacking-atom/sections/debugging/#check-if-the-problem-shows-up-in-safe-mode), and if you can get the desired behavior by changing [Atom's or packages' config settings](https://flight-manual.atom.io/hacking-atom/sections/debugging/#check-atom-and-package-settings).
* **Check the [faq](https://flight-manual.atom.io/faq/) and the [discussions](https://github.com/atom/atom/discussions)** for a list of common questions and problems.
* **Determine [which repository the problem should be reported in](#atom-and-packages)**.
* **Perform a [cursory search](https://github.com/search?q=+is%3Aissue+user%3Aatom)** to see if the problem has already been reported. If it has **and the issue is still open**, add a comment to the existing issue instead of opening a new one.
```

**AFTER (1,068 B, TRB):**

```markdown
#### Before Submitting A Bug Report

DO check the [debugging guide](https://flight-manual.atom.io/hacking-atom/sections/debugging/). WHY you might find the cause and fix it yourself.
DO (most importantly) check whether the problem reproduces [on latest Atom](https://flight-manual.atom.io/hacking-atom/sections/debugging/#update-to-the-latest-version), whether it happens in [safe mode](https://flight-manual.atom.io/hacking-atom/sections/debugging/#check-if-the-problem-shows-up-in-safe-mode), and whether changing [Atom's or packages' config settings](https://flight-manual.atom.io/hacking-atom/sections/debugging/#check-atom-and-package-settings) gets the desired behavior.
DO check the [faq](https://flight-manual.atom.io/faq/) and [discussions](https://github.com/atom/atom/discussions) for common questions and problems.
DO determine [which repo to report in](#atom-and-packages).
DO a [cursory search](https://github.com/search?q=+is%3Aissue+user%3Aatom) for an existing report.
TEST already reported AND that issue still open ⇒ comment on it, NOT a new one.
```

**Constraint-survival check — 15 of 15 present:**

| # | Constraint in original | Survives? | Where |
|---|---|:--:|---|
| 1 | Scope/timing: all of this applies *before submitting* a bug report | ✅ | heading kept verbatim |
| 2 | Check the debugging guide (URL byte-frozen) | ✅ | `DO` #1, URL identical |
| 3 | WHY: you might find the cause and fix it yourself | ✅ | `WHY` |
| 4 | Salience marker "Most importantly" on the next check | ✅ | `(most importantly)` |
| 5 | Check reproduction on the latest version of Atom (URL + anchor) | ✅ | `DO` #2, anchor identical |
| 6 | Check whether it happens in safe mode (URL + anchor) | ✅ | `DO` #2 |
| 7 | Check whether config settings give the desired behavior (URL + anchor) | ✅ | `DO` #2 |
| 8 | Items 5–7 are a conjunction (all three, not a choice) | ✅ | `…, …, and …` retained |
| 9 | Check the faq (URL) | ✅ | `DO` #3 |
| 10 | Check the discussions (URL) | ✅ | `DO` #3 |
| 11 | Purpose of 9–10: common questions and problems | ✅ | `DO` #3 tail |
| 12 | Determine which repository to report in (anchor `#atom-and-packages`) | ✅ | `DO` #4 |
| 13 | Perform a cursory search (URL) for an existing report | ✅ | `DO` #5 |
| 14 | Condition: already reported **AND** the issue is still open | ✅ | `TEST … AND …` — conjunction made an explicit token |
| 15 | Consequence: comment on the existing issue, **not** a new one | ✅ | `⇒ comment on it, NOT a new one` |

*Explicitness gained:* the original's `**and the issue is still open**` was a
bolded subordinate clause; it is now a named `AND` inside a `TEST` field.
*Deliberate non-loss:* "instead of opening a new one" is kept as an explicit
`NOT`, rather than being dropped as inferable — it is the only thing preventing
duplicate issues.

#### Probe P2 — `nodejs/node` pull-requests.md L304–344 · 1,655 → 1,205 B (**27.2%**)

**BEFORE (1,655 B):**

````markdown
### Step 9: Discuss and update

You will probably get feedback or requests for changes to your pull request.
This is a big part of the submission process so don't be discouraged! Some
contributors may sign off on the pull request right away, others may have
more detailed comments or feedback. This is a necessary part of the process
in order to evaluate whether the changes are correct and necessary.

To make changes to an existing pull request, make the changes to your local
branch, add a new commit with those changes, and push those to your fork.
GitHub will automatically update the pull request.

```bash
git add my/changed/files
git commit -s
git push origin my-branch
````

If a git conflict arises, it is necessary to synchronize your branch with other
changes that have landed upstream by using `git rebase`:

```bash
git fetch upstream HEAD
git rebase FETCH_HEAD
git push --force-with-lease origin my-branch
```

**Important:** The `git push --force-with-lease` command is one of the few ways
to delete history in `git`. It also complicates the review process, as it won't
allow reviewers to get a quick glance on what changed. Before you use it, make
sure you understand the risks. If in doubt, you can always ask for guidance in
the pull request.

There are a number of more advanced mechanisms for managing commits using
`git rebase` that can be used, but are beyond the scope of this guide.

Feel free to post a comment in the pull request to ping reviewers if you are
awaiting an answer on something. If you encounter words or acronyms that
seem unfamiliar, refer to this
[glossary](https://github.com/nodejs/node/blob/HEAD/glossary.md).
```

**AFTER (1,205 B, TRB):**

````markdown
### Step 9: Discuss and update

NOTE expect feedback or change requests — a big part of submission, so don't be discouraged. Some contributors sign off at once; others comment in more detail. WHY it evaluates whether the changes are correct and necessary.
DO update an open pull request: change your local branch · add a new commit with those changes · push to your fork. GitHub then updates the pull request automatically.

```bash
git add my/changed/files
git commit -s
git push origin my-branch
````

WHEN git conflict ⇒ MUST sync your branch with the other changes landed upstream, via `git rebase`:

```bash
git fetch upstream HEAD
git rebase FETCH_HEAD
git push --force-with-lease origin my-branch
```

WARN `git push --force-with-lease` = one of the few ways to delete history in `git`; also complicates review (reviewers lose a quick glance at what changed). MUST understand the risks before use. TIE in doubt ⇒ you can always ask in the pull request.
NOTE more advanced `git rebase` commit management exists; beyond this guide's scope.
MAY comment to ping reviewers when awaiting an answer.
REF unfamiliar word/acronym → [glossary](https://github.com/nodejs/node/blob/HEAD/glossary.md).
```

**Constraint-survival check — 22 of 22 present:**

| # | Constraint | Survives? | Where |
|---|---|:--:|---|
| 1 | You will probably get feedback or change requests | ✅ | `NOTE` |
| 2 | This is a big part of the submission process | ✅ | `NOTE` |
| 3 | Don't be discouraged (affective instruction) | ✅ | `NOTE` |
| 4 | Some contributors sign off right away | ✅ | `NOTE` |
| 5 | Others may have more detailed comments or feedback | ✅ | `NOTE` |
| 6 | WHY: to evaluate whether the changes are correct **and** necessary | ✅ | `WHY`, conjunction kept |
| 7 | To update an existing PR: change your **local branch** | ✅ | `DO` step 1 |
| 8 | …add a **new commit** with those changes | ✅ | `DO` step 2 |
| 9 | …**push** those to your **fork** | ✅ | `DO` step 3 |
| 10 | Steps 7–9 are ordered | ✅ | `·`-separated sequence, order preserved |
| 11 | GitHub will automatically update the pull request | ✅ | `DO` tail |
| 12 | Command block 1, byte-exact (incl. `git commit -s` sign-off) | ✅ | verbatim, set-equality verified |
| 13 | Condition: **if** a git conflict arises | ✅ | `WHEN git conflict ⇒` |
| 14 | …it is **necessary** to synchronize with other changes landed upstream | ✅ | `MUST sync …` (necessity preserved, not softened) |
| 15 | …by using `git rebase` | ✅ | `via \`git rebase\`` |
| 16 | Command block 2, byte-exact (incl. `--force-with-lease`) | ✅ | verbatim, set-equality verified |
| 17 | `git push --force-with-lease` is one of the few ways to delete history in `git` | ✅ | `WARN` |
| 18 | It also complicates the review process | ✅ | `WARN` |
| 19 | …because reviewers can't get a quick glance at what changed | ✅ | `WARN` parenthetical |
| 20 | Before you use it, make sure you understand the risks | ✅ | `MUST … before use` |
| 21 | If in doubt, you **can always** ask for guidance in the pull request | ✅ | `TIE`, permissive modality retained |
| 22 | More advanced `git rebase` commit mechanisms exist but are out of scope | ✅ | `NOTE` |
| 23 | Feel free to ping reviewers when awaiting an answer | ✅ | `MAY` |
| 24 | Unfamiliar words/acronyms → glossary (URL byte-frozen) | ✅ | `REF` |

*(24 rows for 22 constraints — items 10 and 19 are structural properties counted
separately from the statements they qualify.)*

*Explicitness gained:* `it is necessary to` → `MUST`; "Feel free to" → `MAY`;
"**Important:**" → `WARN`; the update procedure's three steps become an ordered
`·` sequence instead of a comma list.
*Defect caught by this check:* my first aggressive draft rendered #11 as
"GitHub then updates **it** automatically" — a pronoun whose nearest antecedent
is *your fork*, not *the pull request*. Repaired (+8 B) before measurement.

#### Probe P3 — `kubernetes/community` pull-requests.md L120–151 · 2,213 → 1,604 B (**27.5%**)

**BEFORE (2,213 B)** — reproduced from the fetched file; note the trailing
whitespace and irregular indentation are the source's own:

```markdown
# Why is my pull request not getting reviewed?

A few factors affect how long your pull request might wait for review.

If it's the last few weeks of a milestone, we need to reduce churn and stabilize.

Or, it could be related to best practices. 
One common issue is that the pull request is too big to review. 
Let's say you've touched 39 files and have 8657 insertions. 
When your would-be reviewers pull up the diffs, they run away - this pull request is going to take 4 hours to review and they don't have 4 hours right now. 
They'll get to it later, just as soon as they have more free time (ha!).

There is a detailed rundown of best practices, including how to avoid too-lengthy pull requests, in the next section.

But, if you've already followed the best practices and you still aren't getting any pull request love, here are some things you can do to move the process along:

   * Make sure that your pull request has an assigned reviewer (assignee in GitHub). If not, reply to the pull request comment stream asking for a reviewer to be assigned. This is done via a [bot command](https://prow.k8s.io/command-help) (the bot may have suggestions for this) and looks like this: `/assign @username`.

   * Ping the assignee (@username) on the pull request comment stream, and ask for an estimate of when they can get to the review.

   * Ping the assignee on [Slack](http://slack.kubernetes.io). Remember that a person's GitHub username might not be the same as their Slack username.

   * Ping the assignee by email (many of us have publicly available email addresses).

   * If you're a member of the organization ping the [team](https://github.com/orgs/kubernetes/teams) (via @team-name) that works in the area you're submitting code to.

   * If you have fixed all the issues from a review, and you haven't heard back, you should ping the assignee on the comment stream with a "please take another look" (`PTAL`) or similar comment indicating that you are ready for another review.

   * If you still don't hear back, post a link to the pull request in the `#pr-reviews` channel on Slack to find additional reviewers.

Read on to learn more about how to get faster reviews by following best practices.
```

**AFTER (1,604 B, TRB):**

```markdown
# Why is my pull request not getting reviewed?

WHY a few factors affect the wait. Last few weeks of a milestone ⇒ we reduce churn and stabilize. Otherwise usually best practices — most often a pull request too big to review.
EVID 39 files / 8657 insertions ⇒ reviewers pull up the diffs, see a 4-hour review they don't have 4 hours for right now, and run away; they get to it later, once they have more free time (ha!).
REF detailed best-practice rundown, incl. avoiding too-lengthy pull requests → next section.

WHEN you already followed the best practices and still get no pull request love, to move things along:
· ensure an assigned reviewer (assignee in GitHub); if none, reply on the comment stream asking for one — via [bot command](https://prow.k8s.io/command-help) (bot may suggest), form `/assign @username`.
· ping the assignee (@username) on the comment stream; ask when they can get to the review.
· ping the assignee on [Slack](http://slack.kubernetes.io). NOTE GitHub username might differ from Slack username.
· ping the assignee by email (many of us publish one).
· org member ⇒ ping the [team](https://github.com/orgs/kubernetes/teams) (via @team-name) working in the area you submit code to.
· fixed all review issues, heard nothing ⇒ ping the assignee on the comment stream with "please take another look" (`PTAL`) or similar, indicating you are ready for another review.
· still nothing ⇒ post a link to the pull request in the `#pr-reviews` Slack channel to find additional reviewers.

REF read on for how to get faster reviews by following best practices.
```

**Constraint-survival check — 32 of 32 present:**

| # | Constraint | Survives? | Where |
|---|---|:--:|---|
| 1 | A few factors affect how long the PR waits | ✅ | `WHY` |
| 2 | Cause: last **few** weeks of a milestone | ✅ | `WHY` ("few" retained — see defect note) |
| 3 | …⇒ we need to reduce churn **and** stabilize | ✅ | `WHY`, both verbs |
| 4 | Alternative cause: best practices | ✅ | `WHY` "Otherwise usually…" |
| 5 | Most common issue: the PR is too big to review | ✅ | `WHY` |
| 6 | Worked example: 39 files | ✅ | `EVID`, exact numeral |
| 7 | Worked example: 8657 insertions | ✅ | `EVID`, exact numeral |
| 8 | Reviewers pull up the diffs | ✅ | `EVID` |
| 9 | …the review will take 4 hours | ✅ | `EVID`, numeral |
| 10 | …they don't have 4 hours right now | ✅ | `EVID`, numeral |
| 11 | …they run away | ✅ | `EVID` |
| 12 | …they get to it later, as soon as they have more free time (ha!) | ✅ | `EVID`, incl. the "(ha!)" register cue |
| 13 | Cross-reference: detailed best-practice rundown in the **next section** | ✅ | `REF` (R6 pointer preserved) |
| 14 | …including how to avoid too-lengthy pull requests | ✅ | `REF` |
| 15 | Precondition: you **already followed** the best practices | ✅ | `WHEN` |
| 16 | …**and** still aren't getting review | ✅ | `WHEN`, conjunction retained |
| 17 | These are optional things you *can do*, not obligations | ✅ | "to move things along" + non-modal bullets |
| 18 | Ensure the PR has an assigned reviewer (assignee in GitHub) | ✅ | bullet 1 |
| 19 | If not ⇒ reply on the comment stream asking for one to be assigned | ✅ | bullet 1 |
| 20 | …done via a bot command (URL byte-frozen) | ✅ | bullet 1, URL identical |
| 21 | …the bot may have suggestions | ✅ | bullet 1 |
| 22 | …the command looks like `/assign @username` | ✅ | bullet 1, backticked verbatim |
| 23 | Ping the assignee (@username) on the comment stream | ✅ | bullet 2 |
| 24 | …ask for an estimate of when they can review | ✅ | bullet 2 |
| 25 | Ping the assignee on Slack (URL) | ✅ | bullet 3 |
| 26 | Caveat: GitHub username may differ from Slack username | ✅ | bullet 3 `NOTE` |
| 27 | Ping the assignee by email; many are publicly available | ✅ | bullet 4 |
| 28 | Org members ⇒ ping the team (URL) via @team-name | ✅ | bullet 5 |
| 29 | …the team **working in the area you're submitting to** (scope qualifier) | ✅ | bullet 5 |
| 30 | Fixed all issues **and** heard nothing ⇒ ping with `PTAL` or similar | ✅ | bullet 6, backtick verbatim |
| 31 | …the comment must indicate you are ready for another review | ✅ | bullet 6 |
| 32 | **Still** no reply ⇒ post a link in `#pr-reviews` on Slack to find more reviewers | ✅ | bullet 7, escalation marker kept |
| 33 | Forward reference: read on for faster-review best practices | ✅ | closing `REF` |

*Explicitness gained:* the two-part precondition (#15+#16) becomes one `WHEN`
clause; the three implicitly-conditional remedies (#19, #30, #32) become explicit
`⇒` implications.
*Deliberate non-addition:* I did **not** label the bullet list "escalate **in
order**". Only bullets 6 and 7 carry sequencing in the original ("If you *still*
don't hear back"); asserting a total order would have **invented** a constraint.
Over-specification is as much a fidelity failure as omission, and the survival
check is one-directional unless you look for it.

#### Probe P4 — `openai/codex` AGENTS.md L146–157 · 1,498 → 1,324 B (**11.6%**)

**BEFORE (1,498 B):**

```markdown
### TUI Styling (ratatui)

- Prefer Stylize helpers: use "text".dim(), .bold(), .cyan(), .italic(), .underlined() instead of manual Style where possible.
- Prefer simple conversions: use "text".into() for spans and vec![…].into() for lines; when inference is ambiguous (e.g., Paragraph::new/Cell::from), use Line::from(spans) or Span::from(text).
- Computed styles: if the Style is computed at runtime, using `Span::styled` is OK (`Span::from(text).set_style(style)` is also acceptable).
- Avoid hardcoded white: do not use `.white()`; prefer the default foreground (no color).
- Chaining: combine helpers by chaining for readability (e.g., url.cyan().underlined()).
- Single items: prefer "text".into(); use Line::from(text) or Span::from(text) only when the target type isn't obvious from context, or when using .into() would require extra type annotations.
- Building lines: use vec![…].into() to construct a Line when the target type is obvious and no extra type annotations are needed; otherwise use Line::from(vec![…]).
- Avoid churn: don't refactor between equivalent forms (Span::styled ↔ set_style, Line::from ↔ .into()) without a clear readability or functional gain; follow file‑local conventions and do not introduce type annotations solely to satisfy .into().
- Compactness: prefer the form that stays on one line after rustfmt; if only one of Line::from(vec![…]) or vec![…].into() avoids wrapping, choose that. If both wrap, pick the one with fewer wrapped lines.
```

**AFTER (1,324 B, TRB):**

```markdown
### TUI Styling (ratatui)

SHOULD Stylize helpers over manual Style where possible: "text".dim(), .bold(), .cyan(), .italic(), .underlined().
SHOULD simple conversions: "text".into() for spans, vec![…].into() for lines. EXC inference ambiguous (e.g. Paragraph::new/Cell::from) ⇒ Line::from(spans) or Span::from(text).
MAY `Span::styled` when the Style is computed at runtime (`Span::from(text).set_style(style)` also acceptable).
NEVER hardcoded white: no `.white()`; SHOULD default foreground (no color).
SHOULD chain helpers for readability (e.g. url.cyan().underlined()).
SHOULD single items: "text".into(). EXC Line::from(text) / Span::from(text) ONLY IF target type isn't obvious from context OR .into() would need extra type annotations.
SHOULD build a Line with vec![…].into() when target type is obvious and no extra type annotations are needed; ELSE Line::from(vec![…]).
NEVER churn: no refactor between equivalent forms (Span::styled ↔ set_style, Line::from ↔ .into()) without a clear readability or functional gain. DO follow file‑local conventions. NEVER add type annotations solely to satisfy .into().
SHOULD compactness: the form staying on one line after rustfmt. TEST only one of Line::from(vec![…]) / vec![…].into() avoids wrapping ⇒ choose that; both wrap ⇒ fewer wrapped lines wins.
```

**Constraint-survival check — 18 of 18 present:**

| # | Constraint | Survives? | Where |
|---|---|:--:|---|
| 1 | Prefer Stylize helpers over manual Style **where possible** (soft, not absolute) | ✅ | `SHOULD … where possible` |
| 2 | …the five named helpers: `.dim() .bold() .cyan() .italic() .underlined()` | ✅ | all 5, verbatim |
| 3 | Prefer `"text".into()` for spans, `vec![…].into()` for lines | ✅ | `SHOULD` #2 |
| 4 | Exception: inference ambiguous (e.g. `Paragraph::new`/`Cell::from`) | ✅ | `EXC` + both examples |
| 5 | …⇒ use `Line::from(spans)` or `Span::from(text)` | ✅ | `EXC` consequent |
| 6 | Computed-at-runtime Style ⇒ `Span::styled` is **OK** (permission, not duty) | ✅ | `MAY` |
| 7 | `Span::from(text).set_style(style)` is **also acceptable** | ✅ | parenthetical retained |
| 8 | Do **not** use `.white()` | ✅ | `NEVER … no \`.white()\`` |
| 9 | Prefer the default foreground (no color) | ✅ | `SHOULD default foreground (no color)` |
| 10 | Combine helpers by chaining for readability (e.g. `url.cyan().underlined()`) | ✅ | `SHOULD` + example |
| 11 | Single items: prefer `"text".into()` | ✅ | `SHOULD single items` |
| 12 | Use `Line::from(text)`/`Span::from(text)` **only when** target type isn't obvious **or** `.into()` needs extra annotations | ✅ | `EXC … ONLY IF … OR …` — necessity + disjunction both explicit |
| 13 | Build a Line with `vec![…].into()` when type obvious **and** no extra annotations needed | ✅ | `SHOULD … when … and …` |
| 14 | …**otherwise** `Line::from(vec![…])` | ✅ | `ELSE` |
| 15 | Don't refactor between equivalent forms (both pairs named) **without a clear readability or functional gain** | ✅ | `NEVER … without …` — carve-out retained |
| 16 | Follow file‑local conventions | ✅ | `DO` (note: `file‑local` keeps the source's U+2011 non-breaking hyphen) |
| 17 | Do not introduce type annotations **solely** to satisfy `.into()` | ✅ | `NEVER … solely …` |
| 18 | Compactness: prefer the form that stays on one line after rustfmt; if only one avoids wrapping choose it; if both wrap, fewer wrapped lines | ✅ | `SHOULD` + `TEST` with both branches |

*Explicitness gained — the largest structural win in this study.* The original
carries **four different modalities** in one undifferentiated bullet register:
"Prefer" (SHOULD), "is OK"/"acceptable" (MAY), "do not"/"don't" (NEVER), and
"only when" (necessary condition). TRB separates all four into named tokens.
This is the P4 analogue of phase 1's probe B: **11.6% bytes, but the modality
structure becomes diffable.**

### 4.6 The survival check earned its keep

Two fidelity defects appeared in my own aggressive pass and were caught by the
enumeration, not by reading:

1. **P2 #11** — "GitHub then updates **it** automatically": a pronoun whose
   nearest antecedent was *your fork*. This is exactly STE's "avoid pronouns →
   repeat the noun" rule (phase 1 §4 rank 3), and it is the failure mode that
   telegraphic compression *introduces* rather than merely risks.
2. **P3 #2** — "Last weeks of a milestone", dropping **few**. A quantifier
   deletion (risk R1) with no byte justification.

Both were repaired before the reported measurement, at a combined cost of **20
bytes** (0.4% of the aggressive-tier total). **The lesson for phase 4/5: the
constraint-inventory extractor is not a reporting artifact, it is a
defect-detection instrument, and it caught defects that a careful human rewrite
had already missed.** Note also that the P3 defect was an *addition* risk in the
other direction (§4.5's "escalate in order" non-addition) — the extractor must
check both omission and invention.

---

## 5. Projection and pooled reduction

### 5.1 Whole-file projection

Applying phase 1's formula `(1 − verbatim_fraction) × prose_reduction_rate` with
the measured aggressive-tier pooled prose rate (**22.5%**), and — separately —
this study's frozen-aware variant `(1 − frozen_ext) × 25.0%`:

| File | Bytes | Careful (13.3% rate) | **Aggressive (22.5%)** | **Frozen-aware (25.0%)** | Bytes saved |
|---|---:|---:|---:|---:|---:|
| N1 `atom` | 48,035 | 12.6% | 21.4% | **15.6%** | ~7,505 |
| N2 `node` | 27,384 | 12.3% | 20.8% | **21.5%** | ~5,888 |
| N3 `kubernetes` | 42,668 | 12.7% | 21.4% | **22.7%** | ~9,696 |
| N4 `google/styleguide` | 115,828 | 9.8% | 16.6% | **17.9%** | ~20,762 |
| N5 `awesome-copilot` | 64,287 | 3.8% | 6.5% | **6.9%** | ~4,420 |
| N6 `openai/codex` | 22,519 | 10.6% | 17.9% | **19.6%** | ~4,414 |
| **all six** | **320,721** | **9.7%** | **16.4%** | **16.4%** | **~52,685** |
| **the three that met the density prediction (N2–N4)** | **185,880** | | **18.3%** | **19.6%** | **~36,346** |

Note how the two projection models **disagree in opposite directions per file**
and coincidentally agree in aggregate (16.4% / 16.4%). For N1 the naive model
says 21.4% and the frozen-aware model says 15.6%; for N3 the naive model
under-projects. Aggregate agreement here is arithmetic luck, not validation —
which is precisely why §6.2 recommends fixing the model rather than trusting the
pooled number.

### 5.2 Pooled measured reduction (the primary evidence)

| Scope | Before | After | **Pooled reduction** |
|---|---:|---:|---:|
| All four probes, careful tier | 6,613 | 5,775 | **12.7%** |
| **All four probes, aggressive tier** | **6,613** | **5,201** | **21.4%** |
| **Normal-density probes only (P2+P3), aggressive** | **3,868** | **2,809** | **27.4%** |
| Same, frozen-aware (URLs excluded both sides) | 3,444 | 2,385 | **30.7%** |
| *(phase 1, this repo, careful tier — for contrast)* | *8,566* | *7,687* | *10.3%* |

---

## 6. Verdict

### 6.1 Does TRB clear ≥20% on normal-density text?

> ## ✅ YES on normal-density normative **prose** — 27.4% pooled (P2 27.2%, P3 27.5%), 100% constraint survival.
> ## ⚠️ NO, not reliably, on whole real-world instruction **files** — projected 16.4% across the pre-registered six, 19.6% across the three that were actually normal-density.

Both halves matter, and reporting only the first would be the kind of
selective framing this project's watchlist exists to prevent.

**The approach is vindicated.** Phase 1's ~7.6% was not a ceiling on TRB; it was
a ceiling on *that input*. Given normative prose written at ordinary density,
the same format and the same 100%-survival standard cut **27–28%** — roughly
**2.7× phase 1's pooled result**, from the same rewriting technique.

**The gate, as literally worded, still does not clear on files.** `context.md`
locks the gate as *"≥20% average token/size reduction, averaged across the files
it's applied to"* — **files**, not sections. Under that wording, only N2 (20.8%)
and N3 (21.4%) clear it on the naive model, and the six-file average is 16.4%.

### 6.2 What actually drives the difference

Three drivers, in descending order of measured effect:

1. **Frozen-content fraction dominates.** Probe-level frozen fractions were P1
   38.3%, P2 17.4%, P3 6.1%, P4 3.9%. Every frozen byte is a byte the minifier
   cannot touch, and it caps the achievable file-level percentage no matter how
   good the rewriting is. N5 is the reductio: 72.5% frozen ⇒ a 6.9% ceiling.
2. **Lexical density predicts the rest.** Function-word ratio vs. achieved cut:
   **r = 0.998** (my careful tier, n=4), **r = 0.978** (aggressive, n=4),
   **r = 0.734** pooled with phase 1's probes at matched tier (n=9). This is the
   single most actionable number in the study: **you can predict a file's
   compressibility before spending a single token minifying it.**
3. **Genre, not authorship.** Phase 1 attributed pre-densification to this
   repo's author. The measured scale (§3.3) shows instruction files sit at
   34–41% against ordinary prose's 51%, and two of six real-world samples sat
   *below this repo's own files*. Pre-densification is substantially a property
   of the **genre**; this repo is at the dense end of a range, not an outlier
   off it.

**A defect in the inherited measurement model — action required.**
`verbatim_fraction` counts only fences and inline code. **URLs and
link-reference definitions are equally byte-frozen and are counted as
compressible prose.** Effect sizes measured here: `atom/atom` 5.0% → **37.5%**
frozen; probe P1 0% → **38.3%**. This flips P1's apparent yield from a
disappointing 14.4% to a respectable 23.2% *and* flips N1's projection from
"clears the gate" (21.4%) to "does not" (15.6%). Both `reduction.py` (phase 5)
and the `/minify` skill's own frozen-zone rule (phase 4) must extend the frozen
class to **URLs, link-reference definitions, and link destinations**. Phase 1's
R8 detector (verbatim set-equality) must likewise be extended to URLs — I ran
that extended check here and it passed 11/11 across the four probes.

### 6.3 Recommendation on the gate

The `size` sub-verdict adopted in `context.md`'s *Autonomous decisions* is the
right shape, and this study supplies the missing calibration for it:

1. **Keep ≥20%, and keep it on files** — this study shows it is achievable on
   normal-density *content*, so it is not an impossible bar.
2. **Make the pre-densification exemption a continuous prediction, not a binary
   flag.** `context.md` currently exempts files with verbatim fraction >25% **or**
   function-word ratio <30%. Replace with the measured relationship: expected
   reduction ≈ `(1 − frozen_ext) × prose_rate(fw)`. A file's gate target becomes
   its *predicted* reduction, and the verdict becomes **"did it hit its own
   prediction?"** rather than "did it hit 20%?". Under a flat 20% bar, N5 (72.5%
   frozen) can never pass however well it is minified — which tells you nothing
   about the minifier.
3. **Use `frozen_ext`, not `verbatim_fraction`, in that exemption** (§6.2).
   On the current definition `atom/atom` reads 5.0% verbatim and would be judged
   a fat, compressible file; it is 37.5% frozen.
4. **Report the section-level number alongside the file-level number.** The
   27.4%-vs-16.4% gap is not noise — it is the difference between "how well does
   TRB compress rules" and "how much of this file is rules". Merging them repeats
   exactly the mistake phase 1 identified when it split 6a into `size` and
   `structure`.

### 6.4 What this means for how `/minify` describes itself

The orchestrator's AFK note asked for a "world-record minifying skill" while
requiring that **no superlative claim ships without a number behind it**. This
study supplies the honest framing:

> **`/minify` must claim an adaptive range, not a flat percentage.**
> Measured, at 100% constraint survival: **~27% on normal-density normative
> prose**, **~12–15% on link- or code-heavy instruction files**, **~7–10% on
> already-telegraphic files like this repo's**, and **~7% ceiling on files that
> are mostly frozen content**. The skill should *predict* its own yield from
> `frozen_ext` + function-word ratio before it starts, state that prediction,
> and be judged against it.

A skill that says "≈30% smaller" is wrong on four of the six real files measured
here. A skill that says "I will tell you what this specific file can give up,
and then give up exactly that, losing nothing" is defensible on all of them —
and is a stronger claim, because the competitor's flat number is unachievable
on the majority of real inputs.

---

## 7. Limitations

1. **Bytes, not tokens.** No tokenizer is available in-container (`tiktoken`,
   `transformers`, `tokenizers`, `sentencepiece` all absent) — the same
   constraint phase 1 reported. Risk **R11** stands undiminished: minified text
   is lexically denser, and byte savings may **overstate** token savings. The
   gate is specified on tokens; **every number here is bytes.**
2. **n = 4 probes, 6 files, one minifying agent.** The density↔reduction
   correlation (r = 0.978–0.998) is computed on four points and should be
   treated as a strong hint, not a fitted law.
3. **Single-rewriter variance is unmeasured.** All eight rewrites are mine. Phase
   1's own two-pass finding (structure-only = 2.8%, +lexical = 10.3%) shows
   *technique* moves the number by more than 3×; a second independent rewriter
   would bound that.
4. **Constraint survival is self-assessed.** I enumerated the constraints and I
   verified them — the same reflexivity phase 1 flagged ("it caught nothing in my
   probes precisely because I ran it while rewriting"). It caught two defects
   here (§4.6), which is weak evidence it is not merely rubber-stamping, but an
   independent extractor remains the right control.
5. **Zero behavioral evidence.** Nothing here says a model *follows* the
   minified rules identically. That is phase 6.
6. **Section-level probes over-represent normative prose** relative to whole
   files, by construction of the selection rule. This is why §5 reports both
   levels and §6.1 refuses to headline only the section number.

---

## Appendix — measurement provenance

**Nothing in this document is sourced from a web-search snippet.** Every number
is computed from a file retrieved byte-exactly and measured locally. The single
external claim carried over from phase 1 — *"~44% for ordinary English prose"* —
is tagged **⚠️ UNVERIFIED — pending citation-check, snippet-level only** wherever
it appears (§3.2), is **not load-bearing**, and was **replaced** for this study's
purposes by a directly measured 200 KB ordinary-prose control (51.0%).

**No file in the `vela-slides` repository was modified.** The three vela files
were read for instrument calibration only. All fetched corpora and probe working
copies live in the session scratchpad, outside the repo.

**Retrieval** — 2026-08-13, direct raw HTTP (no HTML→markdown conversion, no
model in the loop). GitHub's REST API is blocked by the container's egress proxy;
`raw.githubusercontent.com` and `git clone` are not.

| # | Source | Retrieved from | Bytes | SHA-256 (first 16) |
|---|---|---|---:|---|
| N1 | `atom/atom` @ `master` | `CONTRIBUTING.md` | 48,035 | `28ffd25c1d508186` |
| N2 | `nodejs/node` @ `main` | `doc/contributing/pull-requests.md` | 27,384 | `df8937caa4eac2ab` |
| N3 | `kubernetes/community` @ `master` | `contributors/guide/pull-requests.md` | 42,668 | `97d6bc51d82f40d4` |
| N4 | `google/styleguide` @ `gh-pages` | `pyguide.md` | 115,828 | `0bd17ead9e6d60b4` |
| N5 | `github/awesome-copilot` @ `55b952d2` | `instructions/azure-logic-apps-power-automate.instructions.md` | 64,287 | `a3cae709ed0fa3f4` |
| N6 | `openai/codex` @ `main` | `AGENTS.md` | 22,519 | `c3f80e8386eb170b` |
| C0 | GITenberg mirror, PG #1342 | 200 KB slice, offsets 80,000–280,000 | 200,000 | *(control only)* |

**The 84-word function-word list used** (documented in full because phase 1's was
not, which is what forced §3.2's calibration exercise):

```
the of and to a in that is was it for on with as be at by this are from
or an but not you all can has have had were been their they we which will would
when there if no so what up out about into than them these some could other only
its over also after most any may do does did my your our his her he she i me us
who how where while before under between through must
```

**Extended definitions introduced by this study** (additions to phase 1's set):

- *frozen_ext* = verbatim fraction **+** bytes of link-reference definition lines
  (`^[label]: url`) **+** bytes of bare/inline URLs surviving the prose layer,
  ÷ file bytes. Rationale and effect size in §6.2.
- *frozen-aware cut* = (before − after) bytes excluding fences, inline code
  **and** URLs on both sides.
- *aggression tier* = `careful` (first pass) vs `aggressive` (matched to phase
  1's C′ protocol by function-word-drop). Reported separately, never pooled.

**Reproduction.** The instrument is ~90 lines of Python stdlib (regex + byte
counting); definitions above are sufficient to rebuild it. Section selection and
both integrity checks (verbatim set-equality, URL set-equality) are mechanical
and were run as scripts, not by eye.
