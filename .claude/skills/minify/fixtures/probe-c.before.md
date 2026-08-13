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
