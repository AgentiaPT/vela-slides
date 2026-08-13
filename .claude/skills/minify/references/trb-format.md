# Typed Rule Blocks (TRB)

The encoding `/minify` rewrites into. Three ideas, and none of them is
"shorten the sentences":

1. **Typed fields.** Each line begins with a label saying what kind of claim it
   is. The label carries meaning the prose used to spend words on ("the
   following applies when…" becomes `WHEN`).
2. **Telegraphic values.** Inside a field, drop articles, copulas and
   connectives. Keep every content word that distinguishes this rule from a
   neighbouring one.
3. **Byte-frozen zones.** Code, URLs, numbers and cited names are copied
   character for character. TRB compresses the connective tissue, not the
   payload.

## Field legend

| Field | Carries |
|---|---|
| `RULE` | The rule's name/id, plus scope-of-life notes ("permanent", "per release"). |
| `WHEN` | The trigger condition. What situation switches this rule on. |
| `SCOPE` | What it covers. Enumerate — a truncated scope list is a silent weakening. |
| `MUST` | Hard obligation. |
| `MUST NOT` / `NEVER` | Hard prohibition. Keep both forms if the source used both; `NEVER` reads as the stronger of the two. |
| `SHOULD` | Default, overridable with reason. Never promote to `MUST`, never demote to `MAY`. |
| `MAY` | Permission. |
| `DO` | Concrete action list under an obligation. |
| `EXC` | Exception / carve-out. The most-dropped field and the most damaging to drop. |
| `WHY` | Rationale. Compressible, not deletable — a rule with no reason gets argued with. |
| `TEST` | The decision procedure: how a reader checks whether they are compliant. |
| `REF` | Pointer to another file, section, heading or numbered item. |
| `EVID` | The measurement or incident behind the rule ("measured: unscoped changes cost ~10% more"). |
| `GATE` | A blocking check in a sequence. |
| `ELSE` | What happens on failure. |
| `TIE` | Tie-breaker when rules conflict or the reader is unsure. |
| `NOTE` | Everything else worth keeping. |
| `PATH` | A filesystem path or route the rule attaches to. |

Fields are recognised at line start. Order is free, but `RULE` → `WHEN` →
`SCOPE` → obligations → `EXC` → `WHY`/`TEST` → `REF` reads best.

## Value conventions

| Symbol | Means |
|---|---|
| ` · ` | list separator (replaces "and", ", and", bullet lines) |
| ` ⇒ ` | implies / therefore (replaces "which means that", "so", "then") |
| `/` | alternation inside one item |
| `≥ ≤` | at least / at most — **keep the number attached** |

Explicit quantifier tokens are *added*, not removed: `ANY` · `ALL` · `ONLY` ·
`BOTH` · `EXC` · `regardless` · `at least`. Where the source implied a
quantifier by construction ("the exact command, the version, and the full
output"), the minified line states it (`MUST include ALL of: …`). Making
quantifiers explicit is what earns the positive half of the structure score.

Upper-case `AND`/`OR` inside a value are read as logical operators. Lower-case
"and" is ordinary prose and carries no quantifier weight.

## Worked example

Source (12 lines, 1443 B — normative prose with heavy emphasis markup):

```md
## CRITICAL: Security-Fix Disclosure Discipline

**Public-facing text about a security fix MUST NOT include detail that helps reproduce the issue in the wild.** This applies to **`VELA_CHANGELOG` entries, commit messages, PR titles/bodies, code review comments, and any other public-exposed document** (the changelog also renders in the in-app About dialog).

For any security-related change, describe it at a **high level only**:
- ✅ DO state: the class of issue (e.g. "CSS exfil channel", "mutation-XSS", "fail-open sanitization"), severity, the affected area, what the fix does, and that regression tests were added.
- ❌ DO NOT include: working payloads or example attack strings, the exact bypass token/primitive, step-by-step reproduction, "where the gap was" maps (precise unguarded fields/endpoints/parameters an attacker should target), or chained CVE/exploit references that amount to a recipe.

Rule of thumb: if a reader could copy a string or follow the steps to trigger the bug, it's too much — generalize it. Keep precise mechanics in **non-public** channels (private security threads / advisories), or, where genuinely needed for maintenance, in **in-code comments** (maintainer-facing, not surfaced in release notes) — and even there, prefer the minimum needed to explain *why* the guard exists.

This discipline is permanent and applies to **every** future change, not just the current one. When in doubt, write less.
```

TRB (1253 B):

```md
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

What moved and what did not:

- The heading is unchanged — other files cite it by name (`REF` integrity).
- Every quoted example string (`"CSS exfil channel"`, `` `VELA_CHANGELOG` ``)
  is byte-identical. They are C1.
- `MUST NOT` stayed `MUST NOT`; the `MAY` inside `EXC` stayed `MAY`. Collapsing
  either into a bare imperative loses the difference between "forbidden" and
  "allowed in this one channel".
- Emphasis markup (`**…**`) is gone. It was the largest single source of
  compressible bytes and carries no constraint.
- The `EXC` line is *longer* than a naive summary would be, deliberately. It
  carries two nested carve-outs and a limit on both of them.
- Prose glue disappeared: "This applies to", "For any security-related change,
  describe it at", "Rule of thumb: if", "and applies to".

Both files live in `fixtures/probe-a.{before,after}.md`; `selftest` re-verifies
this exact pair on every run.

## Rewriting recipe

1. Read the whole source block. Identify the one rule it states. Name it.
2. Pull the trigger out into `WHEN`, the coverage into `SCOPE`.
3. Split the obligations by modality — a paragraph mixing "must", "should" and
   "may" becomes three lines, not one.
4. Hunt for exceptions. Words like *except*, *unless*, *other than*, *apart
   from*, *where genuinely needed*, and any parenthetical qualifying a rule get
   their own `EXC` (or stay inside the line, but they stay).
5. Copy every code span, URL, path, number and quoted example across
   unchanged. Do not retype them — copy.
6. Convert the "how do I know" sentence into `TEST`, the "because" sentence
   into `WHY`, the incident/measurement into `EVID`.
7. Delete only glue: emphasis markup, "it is important to note that", "in
   general", restatements of the heading, and second sentences that repeat the
   first in other words.

## What TRB does not do

TRB is not summarisation. It never generalises two rules into one, never drops
the third item from a list of three because the first two "give the idea", and
never replaces a specific threshold with "a small number". If the output is
shorter because it says less, the structure verdict rejects it.
