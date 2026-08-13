---
name: minify
description: Compress an instruction file (CLAUDE.md, SKILL.md, a reference doc) into fewer tokens without weakening any rule the file expresses. Use when asked to minify, shrink, compress, or reduce the token count of an instruction/prompt file, or to make a CLAUDE.md/SKILL.md "leaner" or "tighter". Applies a tiered classification strategy plus a mechanical trigger-word preservation gate so conditional/exception logic can never be silently dropped.
---

# Minify

The object being optimized is not "text length" but reliable retrieval-and-
execution under distraction. Some of what looks like filler in a good
instruction file (**bold**, "this is permanent", "when in doubt, do X") is not
information — it is priority marking. Stripping it drops the token count
without hurting a comprehension quiz, but it can still hurt compliance in a
live agent loop. Optimize for compliance, not for a smaller file.

## Procedure

1. **Read the target file(s)** in full before changing anything.

2. **Classify every block into one of three tiers.** Do this explicitly (a
   scratch outline is fine) before writing any output — don't compress
   inline as you read.

   - **Tier N — normative / judgment.** Anything expressing an obligation,
     a conditional, an exception, or a disambiguation rule. Mechanically:
     any sentence containing one of these trigger words is Tier N by
     definition and gets flagged for the gate below:
     `unless, except, only, never, must not, do not, before, after,
     when in doubt, otherwise, instead of`.
     Also Tier N: anything using MUST / NEVER / MANDATORY / CRITICAL /
     REQUIRED, security-disclosure or scope-of-change policies, and any
     rule whose violation would be hard to detect later.
     **Compress nothing here beyond removing literal duplicate sentences.**
     Tier N content must survive byte-identical or near-identical — same
     words, same modal strength, same conditions attached to the same
     clause.

   - **Tier M — mechanical / enumerable.** Routing tables, command
     lists, directory trees, constants, exit codes, file-path indexes —
     content that is a lookup, not a judgment call. Compress hard, aim
     for roughly 30-40% reduction: symbol-only table cells, drop
     connective prose ("in order to", "you should then"), collapse
     repeated sentence scaffolding, use a table/list instead of prose
     where the content is already enumerable.

   - **Tier E — explanatory.** Rationale, background, "why this rule
     exists" asides, multiple examples where one would do, restated
     context that's available elsewhere. Trim hard, aim for roughly
     30-50% reduction: keep the directive, cut or shorten the "why"
     clause; collapse to one representative example; point out to
     another section/file instead of repeating it inline — but only for
     genuinely optional depth-on-demand material.

3. **Hard rules while compressing** (these are themselves Tier N — follow
   them exactly, they are the whole point of this skill):
   - Never delete or paraphrase a sentence containing a trigger word from
     the Tier N list above. Compression of such a sentence requires a
     human decision, not an automated one — leave it alone.
   - Never merge a rule with its exception/condition into a single
     shortened line that loses the conditional.
   - Never downgrade a modal verb's strength (MUST → should, NEVER →
     avoid, MANDATORY → recommended are semantic edits, not compression —
     do not make them).
   - Never move an unconditional obligation behind a pointer/reference.
     Pointers are for optional depth-on-demand material only. If removing
     a sentence and replacing it with "see X" would let the reader skip
     an obligation, keep the obligation inline.
   - Never use telegraphic/caveman English (dropping articles, auxiliaries,
     function words) — it disproportionately destroys exactly the words
     (unless/except/only/never/before/after) that encode conditional logic,
     and produces text that is out-of-distribution for the model reading it.
   - Never substitute emoji or invented glyph/shorthand codes for words.
     Existing ✅/❌ pairs already in the file may stay.
   - Target an overall reduction of roughly 20-30% on a first pass. If your
     draft comes out below 10% overall, stop and report "already optimal"
     rather than forcing further cuts — this file was already dense. If a
     draft is heading past ~35%, you are almost certainly cutting into
     Tier N or salience markers; pull back.
   - The result must be a genuine restructuring (tightened tables, merged
     duplicate sections, trimmed rationale), not just deletions with the
     same structure left behind — but every actionable instruction from
     the original must still be present and actionable in the output.

4. **Write the minified output** to `<original-name>.min.<ext>` next to the
   original file (e.g. `CLAUDE.md` → `CLAUDE.min.md`). If the user gave an
   explicit output path, use that instead. Never overwrite the original.

5. **Run the preservation gate**, every time, no exceptions:

   ```bash
   python3 <this-skill-dir>/scripts/check_preservation.py <original> <minified>
   ```

   - Exit code 0 = gate passed. Exit code 1 = gate failed — some trigger-word
     (Tier N) sentence from the original is missing or was substantively
     altered in the minified file.
   - **If it fails, revise the minified file and re-run the gate. Do not
     hand back a minified file that fails the gate, and do not weaken the
     gate or the target file's trigger-word sentences to force a pass.**
     A failure means you compressed or dropped Tier N content — put it back
     as it was in the original.
   - The script also reports token counts and % reduction for both files.
     If the reported reduction is 0% (or negative), or wildly outside the
     20-30% target with no good reason (e.g. the source was already terse),
     say so plainly in your summary rather than presenting it as a win.

6. **Report a summary** to the user covering:
   - Tier breakdown (roughly how much of the file was N vs M vs E, and
     what happened to each).
   - Token counts before/after and % reduction.
   - Gate result (pass, and confirmation nothing Tier N was touched).
   - Where the output file was written.

## Notes

- This skill is intentionally conservative. The failure mode it defends
  against — silently dropping a conditional or exception rule during
  compression — is high-cost and shows up only probabilistically across
  many later agent sessions, so it is not something to catch by "being
  careful" alone; that is what step 5's mechanical gate is for.
- Don't iteratively re-minify an already-minified file in a tight loop in
  production use — each pass churns the text and the wins shrink fast
  after the first pass. One clean pass per meaningful revision of the
  source file is the intended cadence.
- This skill works on any plain-text instruction file. It has no
  dependency on any particular repository's structure, and the gate
  script takes two file paths as plain arguments — nothing is hardcoded.
