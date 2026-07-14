# Context economy — where a long sprint's tokens actually go, and the levers

The single biggest cost in a long multi-agent sprint is **not** any one call — it's the
**orchestrator re-reading its own accumulated context on every turn**. In a long run, ~95% of
tokens are *cache-reads*: the standing context, re-processed each turn. So total hub cost ≈
`(standing context size) × (number of turns)`. **Turn count is only a proxy for cost, and only
one of the two factors.** For a genuinely large, complex issue list the turn count *necessarily*
grows with cluster count — that's expected, not a failure. The factor that's actually
controllable, and the one that matters over a long session, is keeping the standing context
**small AND FLAT for the whole run**, not just thin at the outset: a payload pinned on turn 10
is still being cache-read on turn 400, so any growth compounds silently across a long sprint.
One sprint's hub ran **375 turns at $59.74, 72M cache-read tokens — 94% of that sprint's 150M
total tokens** — the fix was a hub that stayed thin *and flat*, not a lower turn count. The
standing context is dominated by a few evictable-only-if-you-never-load-them buckets.

## Worked example (a real sprint — 6-CR feature, one file family)

| Metric | Value |
|---|---|
| Total spend | ~$114 |
| **Orchestrator (hub)** | **$74.50 = 65%** |
| opus / sonnet | 97% / 3% |
| Tokens that were **cache-read** | **95%** |
| Hub context growth | 93K → 373K tokens over ~412 turns |
| **Screenshots the hub looked at** | **10 = 31% of hub cache-read, ~46% of standing context** |

Three buckets, ranked, with the fix:

1. **Images (31% of cache-read, ~46% of standing context).** A viewed screenshot is
   10–37K tokens, **un-evictable** short of a full compaction (`clear_tool_uses` does not cover
   image blocks), and re-read every later turn. → **Never load a screenshot in the hub.** The
   blind verifiers already look; the hub reads their one-line verdict. If the hub itself must
   see something, spawn a throwaway "look → pass/fail" sub-agent (isolation *is* the eviction).
2. **Redundant confirmation-drives (root cause of #1).** Re-running a worker's already-green
   verification "to be sure" adds turns *and* is what pulls the screenshots in. → Trust the
   pasted green; **≤1** inline re-drive for the whole sprint's load-bearing increment, delegated
   if it needs an artifact. The blind gate is the real check.
3. **Medium/large one-time reads pinned in the hub** (a SKILL, a research doc, a spike file):
   read once, re-read for hundreds of turns. → Delegate the read; the hub holds a pointer +
   summary (same as recon does for a huge source file).
4. **Narrow, one-issue-at-a-time dispatch (a turn-count multiplier, not a context-size one).**
   Dispatching each issue as its own round-trip means a 40-issue sprint pays 40× a dispatch
   turn's overhead even if each payload is tiny. → **Fat, batched delegations**: give each
   worker a whole cluster (every issue that shares its file set) as one self-contained
   objective, and fan out independent clusters in parallel rather than serially. This is what
   keeps turn count from scaling 1:1 with issue count on a long, complex list.

## The levers, by where you're running

**Claude Code CLI (coarse — summarize or restart, no surgical drop):**
- `/compact [focus]` — summarize now, optionally guided. **Lossy**: keeps high-level facts +
  recent turns; drops obscure specifics, and a mis-summary propagates forward.
- `/clear` — full reset (old convo still in `/resume`). `/context` — see what's eating space.
- `PreCompact` / `PostCompact` hooks. **No** way to drop a *specific* earlier image/tool-result
  without a full compact. No `autoCompact` threshold knob.

**Agent SDK / API (surgical + cache-safe — prefer when programmatic):**
- **`clear_tool_uses_20250919`** (context editing) — auto-clears oldest *tool results* past a
  token trigger, keeps N recent, replaces with a placeholder. Cache-friendly (clears a stable
  prefix). Does **not** cover image blocks. ~84% token cut reported on a 100-turn tool eval.
- **compaction** — server-side summarize at a trigger (default ~150K input tokens, configurable).
- **memory tool** — file-backed `/memories` that survives compaction/resets; the durable-state
  antidote to "what compaction forgets."

**Structural (works everywhere, and it's the strongest):**
- **Sub-agent isolation** — a sub-agent has its own window and returns only its final message;
  the parent never inherits its transcript, tool traces, or images. This is the one reliable
  **eviction mechanism** — put anything heavy (images, big reads, exploratory tool spew) behind
  a sub-agent and it's forgotten by construction. The skill's "deposit to files, return a
  pointer" is the same idea for durable text.

**Provider-agnostic compression layers** (e.g. Headroom, which bundles RTK): compress tool /
file / conversation output *before* it enters context, 60–95%, reversible. Useful for a
shell/tool-output-heavy agent. **Caveat:** only *write-time* compression is safe — anything that
**rewrites earlier context per turn busts prompt caching**, converting $-cheap cache-reads back
into full-price input. Don't run a per-turn re-summarizer over the live transcript.

## Checklist for the orchestrator (enforce every sprint)
- [ ] No screenshot ever enters the hub — verifiers look, hub reads the verdict.
- [ ] No re-verification of a worker's already-green pasted run (≤1 delegated re-drive total).
- [ ] Medium/large docs are summarized by a sub-agent; the hub holds pointers, not payloads.
- [ ] Validators sized to *surfaces*, not CR count (see principle 7).
- [ ] One warm harness per phase, reused across that phase's agents (don't re-boot per agent).
- [ ] Dispatch is **fat and batched** (one cluster's worth of issues per worker), not one
      dispatch round-trip per individual issue — see bucket 4 above.
- [ ] Standing context is **shed at phase boundaries** (end of recon, after each merge) —
      don't let stale tool-results from a finished phase ride along into the next one.
- [ ] A dead worker is **replaced**, never absorbed — its debug loop stays out of the hub.
- [ ] Run `sprint-cost.py --audit` at the mid-sprint checkpoint; if images-in-hub or a pinned
      artifact shows up, stop and correct before it compounds. For a large/long sprint,
      **judge the trend (is the hub staying flat?), not the absolute turn count.**
