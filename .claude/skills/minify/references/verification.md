# Verification — the failure catalogue

Read before STEP 6. Every entry here is a way a minified file passes a human
skim and changes what the agent does. They are listed because they are the
*non-obvious* ones: a deleted paragraph is easy to see in a diff, a modal verb
that softened is not.

Verification is two passes, and the second is the one that matters.

```
PASS 1 (mechanical)  scripts/minify-check.py report <orig> <min>
                     HARD = fix before delivering; REVIEW = justify in the report
PASS 2 (judgement)   read the diff hunk by hunk against the questions below
GATE: PASS 1 clean is necessary, not sufficient. It detects things that
      vanished. It cannot detect a rule that still parses and now means
      something narrower — or broader.
```

## The hunk-by-hunk protocol

For each changed hunk, in order, ask:

1. **Who does this govern now?** Compare the subject/scope word for word with
   the original. "no deck-supplied value may…" and "deck values must not…" are
   different rules; the first is universal, the second invites exceptions.
2. **How hard is it now?** MUST / MUST NOT / SHOULD / MAY / NEVER — identical,
   or leveled?
3. **What escapes it?** Every except / unless / only-if in the original must be
   findable in the output, ideally as its own `EXCEPT:` field.
4. **Would an agent facing an analogous-but-unlisted case still make the right
   call?** This is the rationale question. If the answer changed, the cut was
   too deep regardless of how redundant the prose looked.
5. **Could this hunk be acted on without reading anything else?** If the
   compression made the line depend on a neighbouring line for its subject,
   restore the subject.
6. **Did anything get broader?** Widening is as much a behavior change as
   narrowing and reads as a harmless generalization in a diff.

Then, once, across the whole file: **does the section order and heading set
match the original exactly?**

## Catalogue

Entries 1-11 are the risks identified in the design research; 12-13 were added
from applying the process.

### 1. Quantifier and modality erosion
*Shape:* every/any/only/all dropped as filler; MUST/SHOULD/MAY flattened into
undifferentiated bullets; NEVER softened to "avoid".
*Why missed:* these are the smallest words on the line and the first casualties
of telegraphic rewriting.
*Detect:* `minify-check verify` counts each modal and quantifier and reports
any decrease, including a separate count for UPPERCASE usage (caps carry
salience of their own). Any decrease needs a written justification.

### 2. Dropped exception clauses
*Shape:* "…except the sanitized path", "only when the file is under ~300
lines", "unless the caller asked for it" — gone.
*Why missed:* an exception is a handful of tokens, usually at the end of a
sentence, and looks exactly like a trailing qualifier.
*Detect:* `minify-check exceptions <orig>` lists every carve-out clause in the
original; tick each one off in the output. `verify` also matches them
heuristically. Prefer giving each an `EXCEPT:` field — a field that must be
filled is harder to skip than a clause that must be remembered.

### 3. Negation rewrites
*Shape:* "never do X" becomes "always do Y".
*Why missed:* it reads as an improvement — positive instructions do get
followed more reliably — so a reviewer nods it through.
*Why it is wrong:* it narrows the prohibition whenever Y is only one of several
ways to satisfy "not X". Everything else that was banned is now unaddressed.
*Detect:* `verify` reports negation-word density drops. **Policy: never apply
it. FLAG-N.** If the positive form genuinely helps, propose it *in addition*,
leaving the prohibition intact.

### 4. Salience loss from dedup and reordering
*Shape:* a rule stated three times is consolidated to once; a rule moves from
the end of the file into a middle section.
*Why missed:* the diff looks like pure formatting cleanup, and the rule is
still "in there".
*Why it is wrong:* repetition and position both drive attention. A rule the
author repeated was often repeated *because it was being violated*.
*Detect:* imperative count must not drop (count them). Headings and their order
must be identical — `verify` fails on any reorder.

### 5. Rationale removal breaks generalization
*Shape:* the *why* behind a rule is cut as redundant with the rule.
*Why missed:* the rule is still there, so every listed case still passes. The
failure only shows on cases the file never listed — which no eval built from
the file will contain.
*Detect:* question 4 of the protocol, per rule. Any rationale cut is FLAG-R and
is not applied in the delivered file.

### 6. Cross-file and intra-file pointer breakage
*Shape:* a heading is renamed, merged or renumbered; "principle 7" becomes
"principle 6"; a `§` reference dangles.
*Why missed:* nothing validates prose cross-references. The citing file still
reads fine and now points at nothing.
*Detect:* `minify-check xref <target> --root .` **before** editing. Treat every
cited heading and every number as a frozen identifier. In this repo, for
example, CI tooling parses a CLAUDE.md heading by title — renaming it breaks a
check, not just a link.

### 7. Frontmatter `description` is a retrieval key
*Shape:* trigger phrases trimmed out of a SKILL.md description because they
looked like repetition.
*Why missed:* the skill still works perfectly *when invoked*. What changed is
whether it gets invoked at all — and an eval that names the skill explicitly
will never see it.
*Detect:* frontmatter must be byte-identical; `verify` reports any field change
as HARD, naming `description` specifically. If a description genuinely needs
work, that is a separate task with its own trigger-rate evaluation, not part of
a minification.

### 8. Verbatim payload corruption
*Shape:* a path, command, flag, symbol, glob, exact string or number is
"cleaned up".
*Why missed:* the result reads perfectly. It just no longer matches anything.
*Detect:* `verify` compares fenced blocks byte-for-byte and checks every inline
literal that looks like payload, plus URLs and bare paths.

### 9. Table cells swallowing conditionals
*Shape:* a routing-table cell contained an instruction ("read the security
skill first"), and columnization pressure trimmed it to a location.
*Why missed:* the table looks *better* afterwards — more uniform.
*Detect:* diff table cells individually. Any cell whose original contained an
imperative or a conditional must still contain it.

### 10. Self-report is not evidence
*Shape:* the report asserts equivalence; everyone believes it.
*Why it is wrong:* models systematically overestimate their own constraint
compliance relative to rule-based scoring. A minifier grading its own output is
the least reliable available signal.
*Detect:* structural. The report template ends with an explicit "what this
does not establish" section, and states which rules most need eval coverage.
Never phrase the report as "behavior preserved" — phrase it as "these checks
passed; equivalence untested".

### 11. Human-edit decay
*Shape:* a dense file gets appended to in the old verbose style; after a few
edits it is a mixed dialect that is neither compact nor consistent.
*Why missed:* each individual append is fine.
*Detect:* the legend at the top of the file, using the canonical label set.
`verify` fails a file that uses field notation without a legend.

### 12. Scope widening (added)
*Shape:* a rule about "values that came from a deck" is restated as a rule
about "values"; a rule about "the shipped skill directory" becomes "the repo".
*Why missed:* it reads as a cleaner, more general rule, and generality feels
safe.
*Why it is wrong:* over-broad rules get exceptions invented at use time, and
the agent's invented exception may be exactly the case that mattered. It also
makes the rule fire where it should not, which trains the reader to ignore it.
*Detect:* question 1 of the protocol. Compare scope words literally.

### 13. Gate polarity flattening (added)
*Shape:* "you must not proceed until X" becomes a `STEP` or a bullet that reads
as a recommendation. Or a `GATE:` line whose verb is descriptive ("tests are
run") rather than blocking ("tests MUST pass before continuing").
*Why missed:* pseudocode notation looks authoritative, so a weak gate inside it
inherits borrowed authority.
*Detect:* every `GATE:` line must name the blocking condition and use a modal.
Read each one asking: if this were false, would the procedure stop?

## Before delivering

```
GATE: minify-check report shows zero HARD findings
GATE: every REVIEW finding has a written justification in the self-report
GATE: every FLAG is in the report, and the delivered file retains the
      ORIGINAL behavior for each flagged item (flags are proposals, and the
      file must be safe to adopt with all of them rejected)
GATE: heading set and order identical to the original
GATE: the report claims measured size reduction and nothing about behavior
```

The last one is not modesty. The only evidence that a minified instruction file
drives the same agent behavior is an evaluation that scores *observed behavior*
on real tasks — did the agent bump the version, grep the right file first, read
the mandated skill before editing — never a self-assessment and never a human
skim of the diff. If such a harness exists, name the rules most worth testing.
If it does not, say that the reduction is unvalidated.
