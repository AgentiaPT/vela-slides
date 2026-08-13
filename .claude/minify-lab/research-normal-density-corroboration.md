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
