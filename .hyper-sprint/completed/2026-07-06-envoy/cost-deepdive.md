# Sprint "Envoy" — Cost / Efficiency Deep-Dive

Post-mortem of the PowerPoint-export hyper-sprint (2026-07-06). Analysis of the
raw orchestrator + sub-agent transcripts, not just the summary tool. All dollar
figures use `sprint-cost.py`'s discounted price table (opus cr $0.50/M, cw
$6.25/M; sonnet cr $0.20/M, cw $2.50/M) so they reconcile to the tool to the cent.

---

## Executive summary

- **Sprint spend (frozen snapshot in README):** **$104.54** across 18 transcripts
  (opus $74.40 · sonnet $30.14). Re-running `sprint-cost.py` today reads **~$108.6**
  for the same 18 agents and **~$110.6 across 20** — the extra ~$6 is *not* new sprint
  work: transcripts are live-appended and re-priced, plus two post-README follow-up
  agents (`a4ca3a20…` repair-on-open $1.35, `aeafd7e3…` = an earlier run of *this*
  cost analysis $0.66). Treat **$104.54 / 18** as the sprint number.
- **Estimated avoidable waste: ≈ $6–7, i.e. ~6% of the total.** The single biggest
  chunk (**$4.80**) is the two blind validators killed mid-hunt by an account-wide
  **weekly** API limit — largely outside the orchestrator's control, but exposure was
  reducible. The rest (~$1–2) is hub context-hygiene: reference docs slurped whole into
  the hub early and a raw OOXML dump pinned late.
- **The sprint was operationally clean.** No retry storms, no rework loops, no
  worker had to redo another worker's output. Every sub-agent tool error was a
  single, self-corrected one-turn hiccup (`File has not been read yet…`) costing
  negligible tokens. The waste is structural (context carry + one unlucky rate-limit),
  not sloppy execution.

### Top 3 findings

1. **95% of all spend is cache-read of standing context; the hub itself is the most
   expensive "activity."** The 428-turn orchestrator cost $27.59 (25% of the sprint) of
   which **86% ($23.8) is pure context-carrying** (cache-read $17.0 + cache-write $6.8),
   only 14% ($3.8) is actual output/reasoning. No single build task rivals the cost of
   *carrying the hub for 13 hours*. Highest-leverage lever = shorter session + smaller
   hub, not any one task.
2. **The rate-limit death of blind round 1 ($4.80) is the only true "wasted work,"** and
   it forced a full re-run of the gate ($13.4 for round 2). Running **two opus validators
   in parallel** at a weekly-limit boundary maximized the blast radius.
3. **PPTX-4 is the cost outlier ($12.92, 2h20m) — the 4th sequential build worker.** Its
   length is mostly a legitimate LibreOffice/python-pptx verify loop, but ~10 early tool
   calls re-grep `part-blocks.jsx` for gradient/callout internals that recon already
   owned, and its 2h20m runtime idled the hub long enough to trigger a full cache-TTL
   rewrite ($0.50).

---

## 1. Errors that could have been avoided

### 1a. The rate-limit deaths (the only material failed work) — $4.80

Blind round 1 dispatched two **opus** validators in parallel:

| Agent | Role | Ran | Turns / tools | Spend before death |
|---|---|---|---|---|
| `a369524c9d5edbbf2` | Blind validator A (functional correctness) | 21:40:46 → 21:45:07 (4m21s) | 61 / 18 | **$2.25** |
| `a83a06befa084c230` | Blind validator B (edge cases) | 21:41:06 → 21:45:21 (4m15s) | 56 / 16 | **$2.55** |

Both did **real** validation before dying — driving live exports, python-pptx read-back,
LibreOffice renders (validator A got through 18 tool calls incl. a `render-pptx.sh` run;
B did 16 incl. multiple zipfile/`Presentation` structural reads). The kill sequence in
each transcript is clean, **not** a retry storm:

- First a transient: `claude-sonnet-5 is temporarily unavailable, so auto mode cannot
  determine the safety of Bash right now. Wait briefly…`
- Then the hard stop: `You've hit your weekly limit · resets 11pm (UTC)`

Exactly **one** `is_error` per validator — they hit the wall once and stopped. **No
wasted backoff/retry looping.** So the $4.80 isn't burned on flailing; it's burned on
validation work that couldn't be *filed*: validator A had only *verbally* flagged the
slide-counter leak before dying, so the formal blind gate produced no structured verdict
and had to be re-run wholesale by A2/B2 ($8.51 + $4.88 = **$13.39**).

**Avoidable?** Partially. Weekly limits aren't visible to the agent, so the *timing* was
bad luck. But two design choices amplified it:
- **Two opus hunters fired simultaneously** doubled the token rate right at the limit
  boundary. A staggered or Sonnet-first round-1 would have lost less on death and might
  not have tripped the weekly cap at all.
- There was **no cheap pre-flight budget probe** before committing two best-model agents.
  (The orchestrator *did* add exactly this discipline for round 2 — the `a0df03c7…`
  "quick availability probe," $0.08 — which is the right pattern; it just came after the
  expensive lesson.)

### 1b. Sub-agent internal errors — all benign, ~$0 avoidable

Every non-validator sub-agent error was a single self-corrected turn:

- `a45ec02f…`(PPTX-2), `aa127926…`(PPTX-3), `ad8e6a0e…`(PPTX-6), `a4690f40…`(PPTX-4):
  each hit one `File has not been read yet before writing` and immediately Read-then-Wrote.
  ~1 wasted tool call apiece, negligible tokens.
- `a20565ea…` (recon part-pdf) tried to `Read` a **232,145-token** file (the generated
  `vela.jsx` monolith) and was blocked by the 25k limit, forcing offset/limit. Minor
  inefficiency — recon should read *part-files*, never the concatenated monolith — but
  the tool guard caught it at zero token cost.

There is **no** case of a worker producing output the orchestrator had to correct or a
worker redoing another's work. The 4 bugs that landed were caught by the *intended* gate
mechanism (build-review + fix-hunt + blind round), not by rework.

### 1c. The `pptxRasterizeSvgs` mid-flight coordination (PPTX-2 → PPTX-5) — cheap, ~half-avoidable

Traced in the main transcript at turns 258–264 (18:1x, Jul 6):

> (turn 258, orchestrator thinking) *"PPTX-2 landed clean, but it introduced an async
> `pptxRasterizeSvgs()` step that the export modal must call before `buildPptx`. Since
> PPTX-5 (UI wiring) is still building in parallel and may not know about this, I'll relay
> it now to avoid rework."*
> (turn 264) `SendMessage → a737dc74… (PPTX-5)`: interface update on `pptxExtractSlidePage`
> / the new async pre-pass.

This was a **genuine dependency discovered after dispatch**: the SVG→PNG *browser
rasterization* fallback (PPTX-2's job) is inherently async and cannot run inside the
synchronous OOXML string build, so the modal must `await` a pre-pass. The plan had pinned
`buildPptx()`'s signature for PPTX-5 but **not** that an async rasterization pre-pass would
exist — even though the plan itself already named a "browser-rasterized PNG fallback" as a
known design element. **Verdict: half-avoidable.** A sharper PPTX-5 brief ("the modal must
`await pptxRasterizeSvgs(pages)` before `buildPptx`") would have eliminated the round-trip.
But the *reactive* handling was correct and near-free: one SendMessage (a few hundred
tokens) prevented actual PPTX-5 rework. This is a coordination **win**, just one that a
tighter interface contract would have made unnecessary.

### 1d. Late follow-up: two agents editing the same files concurrently (post-README)

At turns 823/825 (06:33+, after the README was written) the orchestrator dispatched
`a4ca3a20…` (repair-on-open) and `a39b2f51…` (font/scale calibration) **both editing
`part-pptx.jsx` + `part-imports.jsx` concurrently without worktree isolation**, and had to
send both a collision-warning SendMessage. This is post-sprint cleanup, but it's a mild
planning slip: same-file concurrent workers should be serialized or worktree-isolated (the
sprint did use worktrees correctly for the PPTX-2‖PPTX-5 parallel pair earlier).

**Quantified failed/redone-work cost:** ~**$4.80** hard-wasted (dead validators) + ~$0.1
in self-corrected worker hiccups = **~$4.9, ≈4.7% of $104.54.** The $13.4 round-2 re-run
is not "waste" (it's the real gate) but it exists *only because* round 1 died.

---

## 2. Orchestrator turns that became stale/irrelevant pinned context

Baseline from `--audit`: hub had **0 images pinned** (excellent — screenshots stayed inside
validators, per hub-hygiene). Largest pinned tool-results: ~4,566 tok @turn≈49,
~4,060 tok @turn≈690, ~3,238 tok @turn≈24.

**Reframe of the "cost model."** It's not only "read once, re-read cheaply forever." The
orchestrator's cache_read **drops to 0 at turns 164, 373, and 491** — the prompt cache's
5-minute TTL lapsed during idle waits, forcing a **full re-cache-WRITE** of the entire
standing context at $2.50/M (sonnet), not a cheap read:

| Cache-expiry rewrite | ~when | context re-written | cost |
|---|---|---|---|
| turn 164 | after recon wait | ~135k tok | ~$0.34 |
| turn 373 | ~21:05, PPTX-4 finishing | ~199k tok | ~$0.50 |
| turn 491 | ~05:33, post-8h rate-limit gap | ~248k tok | ~$0.62 |

The turn-491 rewrite (~$0.62) is unavoidable (8h forced idle from the weekly limit). The
turn-373 rewrite (~$0.50) is a **direct consequence of PPTX-4 running 2h20m while the hub
idled** — a concrete link between long sequential builds and hub cost.

**Stale reference-doc pins (read once at startup, carried for the rest of the session).**
These are the hub's own Phase-0 reads — all pulled *whole* into the orchestrator's context
at turns 24–51 and never referenced again in a way that needed the full text:

| turn | tool-result | ~tok | upper-bound re-read cost* |
|---|---|---|---|
| 49 | `orchestration.md` (the skill's own methodology doc) | 4,566 | ~$0.37 |
| 24 | sprint spec `sprint-2026-07-04-1-envoy.md` | 3,238 | ~$0.27 |
| 51 | agent-profiles doc | 2,104 | ~$0.21 |
| 34 | version/cloud-profile config | 1,892 | ~$0.19 |
| 123–129 | burst-hunter docs + `vela-verbs.mjs` | ~3,200 | ~$0.28 |

*Upper bound = tok × subsequent assistant-turns × $0.20/M; real value is lower because the
three cache-expiries above reset the prefix. Order-of-magnitude, these ~15k tokens of
startup reference cost **~$1–1.5** to carry.

The most defensible target is **`orchestration.md` read in full (4,566 tok, turn 49)**:
it's the skill's *methodology* reference. Once internalized on turn 1, its verbatim text is
dead weight for the next ~400 turns. Same for the agent-profiles doc. These are the
clearest "paid to re-read for no benefit" items — the orchestrator needed them *once* to
plan, then never needed the literal text again.

**Where hub-hygiene held up well (credit where due):**
- Zero images in the hub across the whole run — validators' `ctx.shot()` screenshots
  stayed in their disposable windows. This is the single most important hygiene rule and
  it was followed perfectly.
- Build workers wrote payloads (generated `.pptx`, render PNGs) to `/tmp` and scratchpad,
  handing the hub only pointers/verdicts. Recon summaries were absorbed into the plan and
  not re-quoted.

**Where it slipped:**
- **Turn 690: ~4,060 tokens of raw generated `<a:tbl>…</a:tblGrid>` OOXML XML dumped
  directly into the hub** during the orchestrator-direct counter-leak verification. This
  is the exact anti-pattern — a large machine payload pinned in the hub. It should have
  been piped to a file with only a boolean/grep-count returned to context. Landing late
  (turn 690 of 814) limited the damage (~$0.15 in re-reads before session end), but it's
  a clean hygiene miss.
- The Phase-0 full-doc reads above — cheaper to have `head`/summarized them.

### The orchestrator-direct counter-leak fix — real verdict

Sequence (main transcript): round 1 dies 21:45 → **~8h forced idle** (weekly limit,
turns 471→544 gap) → orchestrator resumes ~05:33 and does the counter-leak
investigation+fix **directly** via Bash/Read/Edit (turns 508–613, source reads of
`PptxExportModal`, `extractBoxes`, etc.) → spawns fresh validators A2/B2 at **05:43**.

**Verdict: the direct fix was the right call, with one caveat.** The README frames it as
"sub-agent spawning was down," but the timeline shows spawning had *recovered* by 05:33
(A2/B2 launched fine 10 min later). The honest justification isn't "spawning was down"
— it's that the counter-leak was **small, fully understood** (validator A had already
localized it verbally), and after an 8-hour block the orchestrator sensibly kept momentum
rather than pay the latency+context cost of briefing a fresh sub-agent for a two-line fix
shared between the PDF and PPTX extractors. The direct source reads it pinned (turns
508–690, ~15k tok) landed **late**, so they were re-read only ~120–150 times, not 400 —
cheap (~$0.4). **The only real slip inside that episode is the turn-690 raw-XML dump**
(above), which delegation *would* have kept out of the hub. Net: efficient given the
constraint; dock it half a point for the XML dump.

---

## 3. Per-agent efficiency outliers

Cluster totals (current tool read): build $51.2 (47%) · orchestrator $27.6 (25%) ·
validators $18.2 (17%, incl. $4.8 dead) · fix $8.1 · recon $3.5.

| Rank | Agent | Role | Cost | Why |
|---|---|---|---|---|
| 1 | `a4690f40d569d7996` | **PPTX-4 fidelity** | **$12.92** | See below — the outlier. |
| 2 | `a6c7ca31…` | PPTX-1 core exporter | $9.26 | Legitimately the foundational build (`buildPptx`, shared-extractor wiring); 91 turns, opus. Necessary. |
| 3 | `aa127926…` | PPTX-3 tables/images | $8.64 | Fiddly table geometry (flagged "hard" in the plan); 106 turns. Justified. |
| 4 | `a0a897f1…` | Blind validator A2 (retry) | $8.51 | 162 turns / 49 tools in 12 min — the *real* gate; opus + large standing context. Necessary re-run caused by 1a. |
| 5 | `a737dc74…` | PPTX-5 UI menu+modal | $7.63 | Highest *output* tokens of any worker (12,560) — it wrote the modal UI; reasonable. |

**PPTX-4 (`a4690f40…`, $12.92) — anatomy of the outlier.** Ran **18:44 → 21:04 = 2h20m**,
153 turns, 48 tool calls (29 Bash / 13 Read / 4 Edit / 2 Write). Two things drove the cost:

1. **It's the 4th sequential worker in the PPTX-1→2→3→4 chain** (all one file,
   `part-pptx.jsx`, so they *couldn't* parallelize). By the time it ran, the *task itself*
   was "mid/medium" (gradients/alpha/fonts), but it inherited the largest accumulated
   context and the longest verify surface. Most of its 2h20m is a **legitimate** build→
   `concat.py`→`test_vela.py`→LibreOffice-render→python-pptx-diff loop; LibreOffice
   headless conversion is genuinely slow. This part is not waste.
2. **~10 early tool calls re-derive things recon already owned.** Its opening Bash calls
   `grep -n "linear-gradient" part-blocks.jsx`, `grep "gradient"`, `grep 'case "callout"'`,
   `grep "function CalloutBlock"` — re-mapping where gradient/callout rendering lives, which
   is exactly the "part-blocks internals" territory the recon cluster mapped. A fidelity
   worker handed a tighter recon pointer sheet (or the recon agent's own summary) would
   skip these. Small in isolation, but at opus + 100k-context each grep+read cycle is
   ~$0.1–0.2, and there are ~10 of them.

Its length also **externalized** cost onto the hub: the turn-373 cache-expiry rewrite
(~$0.50, §2) fired precisely because the orchestrator idled 2h20m waiting for it.

**Efficient agents worth noting:** recon cluster total only **$3.51** for 3 agents — lean,
disciplined, and the recon *payoff* was large (it's what produced the "wire to
`part-pdf.jsx`'s proven extractors instead of the buggy spike" decision that killed 4 of 5
baseline bugs at the root before any hunting). Recon was the highest-ROI spend in the
sprint. The `a0df03c7…` availability probe ($0.08) is the model of a cheap pre-flight check.

---

## 4. Recommendations for the next sprint (actionable checklist)

**Rate-limit / gate design (biggest single lever — saves ~$5 + avoids a re-run):**
- [ ] **Fire a cheap availability/quota probe BEFORE every best-model round**, not just
      after a failure. `a0df03c7…` ($0.08) already proves the pattern — make it mandatory
      pre-flight for any round that commits ≥2 opus agents.
- [ ] **Stagger blind validators, or run round-1 on Sonnet.** Two parallel opus hunters at
      a weekly-limit boundary is what turned a bad-luck limit into $4.80 of unfilable work.
      Launch one, let it file, then the second — a death then costs one validator, not two.
- [ ] **Have validators checkpoint findings to disk incrementally** (append each confirmed
      bug to a `findings.md` as it's found), so a mid-hunt kill still yields a structured
      partial verdict instead of only a "verbal" flag. Validator A had found the counter
      leak; the sprint got nothing filed.

**Sequential-build chain (PPTX-1→4) — shorten wall-clock, shrink hub carry:**
- [ ] The single-file constraint forced PPTX-1..4 sequential; PPTX-4 alone was 2h20m and
      triggered a $0.50 hub cache-rewrite by idling the orchestrator. Where a fidelity pass
      is genuinely independent (gradients vs. fonts vs. tables), **split it into
      worktree-parallel sub-tasks** even within one file and merge, rather than one 2h20m
      serial worker.
- [ ] **Hand fidelity/build workers a recon pointer-sheet** (exact file:line anchors for
      the blocks they'll touch). PPTX-4 re-grepped `part-blocks.jsx` for gradient/callout
      ~10 times that recon already knew — cap that with an upfront anchor list in the brief.

**Interface contracts (avoid the SendMessage round-trip):**
- [ ] When dispatching a parallel worker against an interface still being built, pin the
      **full** async contract, not just the sync signature. PPTX-5's brief should have
      included "`await pptxRasterizeSvgs(pages)` before `buildPptx`" — the async
      rasterization pre-pass was foreseeable from the already-planned PNG fallback.
- [ ] Never dispatch two workers to edit the **same files concurrently** without worktree
      isolation (the turn-823/825 font/scale ‖ repair-on-open pair). Serialize or isolate.

**Hub context hygiene (saves ~$1–2, keeps the 428-turn hub lean):**
- [ ] **Don't `Read` reference docs whole into the hub.** `orchestration.md` (4.6k tok),
      agent-profiles (2.1k), cloud-config (1.9k) were read once to plan and then carried
      verbatim for ~400 turns. Read them, extract the 3–4 facts you need into the plan,
      and don't keep the full text pinned.
- [ ] **Never dump machine payloads into the hub.** The turn-690 ~4,060-token raw OOXML
      `<a:tbl>` XML should have gone to a file with only a grep-count/boolean returned. Same
      rule you already apply to images — extend it to XML/JSON/large source blobs.
- [ ] **Direct-work is fine for small, well-scoped, well-understood fixes** (the counter
      leak was the right call), **but keep its verification off the hub** — pipe renders/
      dumps to disk, return verdicts.

**Measurement:**
- [ ] Remember 95% of spend is standing-context carry and 86% of the *hub's* cost is
      context, not reasoning. The highest-value optimizations are **session duration** and
      **peak hub context**, not shaving any single task. Track peak-context and total
      wall-clock as first-class sprint metrics next time.

---

*Sources: main orchestrator transcript
`…/d0bd2841-10ee-566d-a9ec-5eec823bbb38.jsonl` (814 lines / 428 assistant turns);
18 sub-agent transcripts under `…/subagents/`; `sprint-cost.py --audit --json`.
Turn/line numbers reference the main JSONL unless an agent id is given.*
