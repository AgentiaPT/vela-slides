3. **Orchestrator, not worker — hub hygiene: payloads to disk, pointers + verdicts in the hub (HARD RULE).**
NEVER into the main loop: worker's diff · screenshot · any large doc.
DO trust the worker's pasted test-summary + one-line verdict.
EXC re-drive by exception only — cheap sub-agent returns a bare pass/fail, never the raw artifact.
DO delegate frame-checks + one-off lookups (a pricing page, a doc for one config flag, one number buried in a giant reference); never fetch/read them in the hub.
NEVER images in the hub — absolute. Screenshots = the single worst payload.
WHY viewed screenshot large · UN-EVICTABLE (only compaction sheds it; context-editing/`clear_tool_uses` does NOT cover image blocks) · re-read EVERY later turn.
DO blind verifiers/hunters already look at every proof state (principle 8) + return a one-line frame-check verdict → hub reads the verdict, never the pixels.
EXC hub genuinely needs its own visual check ⇒ throwaway "look at this PNG → pass/fail + one sentence" sub-agent; image lives and dies in an isolated window.
EVID one sprint: the orchestrator dominated spend, mostly cache-reads; hub-viewed screenshots were a large share of cache-read and standing context — more than any other single bucket. Generally the single biggest cost lever, not specific to that run.
REF `references/hub-hygiene.md` + `references/context-economy.md` — enforceable checklist · CLI-vs-SDK context levers · re-drive-by-exception recipe.
