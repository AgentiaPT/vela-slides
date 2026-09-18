# Independent review — completed-sprint index at `c92335c`

Scope: `.hyper-sprint/completed/README.md` and `.hyper-sprint/check-completed-index.py` only.
All adversarial mutations were run on throwaway copies outside the repository. The repository's
own files were not modified (`README.md` md5 `c909fd0c194de3e3b866f1aa97698ba8` before and after).

---

## IN-SCOPE DEFECTS

### 1. The exact CR-1 defect still passes the checker

`check-completed-index.py:33-40` sets `in_table = False` on any line that does not start with `|`,
then unconditionally skips the next pipe line as a header:

```python
for num, line in enumerate(lines, 1):
    if not line.strip().startswith("|"):
        in_table = False
        continue
    cs = cells(line)
    if not in_table:
        in_table = True          # header line
        continue
```

A pipe row that follows a blank line is therefore exempt from **all three** assertions (a), (b)
and (c). Appending a duplicate `palisade` row **with 5 cells** after a blank line — the literal
CR-1 symptom, reintroduced — is not caught.

Mutated index tail:

```
| 2026-07-06 | Envoy | Native PowerPoint (.pptx) export | [README](./2026-07-06-envoy/README.md) |

| 2026-08-08 | Palisade | duplicate row, 5 cells | [README](./2026-08-08-palisade/README.md) | trailing |
```

Literal observed output:

```
OK: 5 rows, 5 sprint folders, all checks pass
exit=0
```

The check the CR commissioned does not catch the bug the CR describes.

### 2. Header and separator rows are exempt from assertion (a)

A column-count mismatch in the header or separator breaks rendering harder than a bad data row.
The GFM spec states: "The header row must match the [delimiter row] in the number of cells.  If not,
a table will not be recognized". (Verified against `github/cmark-gfm`, `test/spec.txt`, Tables
extension — https://github.github.com/gfm/#tables-extension-)

Three variants each pass clean:

- H1 — 5-cell header vs 4-cell data rows:

```
| Date | Codename | Theme | Report | Notes |
|---|---|---|---|
| 2026-08-08 | Palisade | Deck-data hardening: ingress allowlist, bounded recursion, CI drift guards (v13.22) | [README](./2026-08-08-palisade/README.md) |
----- H1 -----
OK: 5 rows, 5 sprint folders, all checks pass
exit=0
```

- H2 — separator row with 3 cells against a 4-cell header:

```
----- H2 -----
OK: 5 rows, 5 sprint folders, all checks pass
exit=0
```

- H3 — separator deleted, header replaced with a 5-cell line:

```
----- H3 -----
OK: 5 rows, 5 sprint folders, all checks pass
exit=0
```

In H1 and H2 GitHub renders the whole block as a paragraph of literal pipes — a worse outcome than
the one CR-1 fixed — while the checker reports clean.

### 3. Assertion (b) is a substring count over joined row text, not a row or link check

`check-completed-index.py:58-63`:

```python
text = "\n".join(line for _, cs in rows for line in ["|".join(cs)])
for folder in folders:
    hits = text.count(folder)
```

A folder named anywhere — including inside a *Theme* cell — satisfies "appears on exactly one row".
Removing the envoy row and writing `Follow-up to 2026-07-06-envoy` into the lifeboat Theme:

```
----- F2: sprint folder named ONLY in prose, never on a row -----
OK: 4 rows, 5 sprint folders, all checks pass
exit=0
```

A sprint can drop out of the index with no row and no link, undetected.

### 4. Substring collision produces a false FAIL on a correct index

Because `folder` is counted as a raw substring, a future sprint whose directory name extends an
existing one breaks a valid table. With both `2026-08-08-palisade` and `2026-08-08-palisade-ii`
present, each on exactly one correctly-formed row and in correct date order:

```
| Date | Codename | Theme | Report |
|---|---|---|---|
| 2026-08-09 | PalisadeII | follow-up | [README](./2026-08-08-palisade-ii/README.md) |
| 2026-08-08 | Palisade | Deck-data hardening: ingress allowlist, bounded recursion, CI drift guards (v13.22) | [README](./2026-08-08-palisade/README.md) |
...
----- G1 -----
FAIL: sprint folder 2026-08-08-palisade appears on 2 rows, expected 1
exit=1
```

### 5. "Rows" is miscounted as "occurrences"

The script never groups by row, although (b) is worded per-row. One folder named twice within a
*single* row (`| ... | see 2026-07-06-envoy | [README](./2026-07-06-envoy/README.md) |`) gives a
false failure with a factually wrong message:

```
----- G2 -----
FAIL: sprint folder 2026-07-06-envoy appears on 2 rows, expected 1
exit=1
```

It appears on one row.

---

## OUT-OF-SCOPE / COSMETIC

These do not fail the review.

1. `os.listdir` treats every directory under `completed/` as a sprint. Adding an `assets/` or a
   scratch directory gives `FAIL: sprint folder assets appears on 0 rows, expected 1`. No such
   directory exists today.
2. No reverse check. A row pointing at a directory that does not exist passes:
   `OK: 6 rows, 5 sprint folders, all checks pass`, exit 0. CR (b) does not literally require it.
3. A missing index file raises `FileNotFoundError` with a traceback instead of a clean `FAIL:` line.
   The exit code is still 1.
4. Equal adjacent dates pass (`cur > prev`, not `>=`). Defensible for "newest first".
5. `line 58` — `"\n".join(line for _, cs in rows for line in ["|".join(cs)])` iterates a
   single-element list; a plain generator expression is equivalent.
6. A legitimately empty archive (0 directories, 0 rows) fails with
   `no data rows found in the index table`.
7. The script is mode `-rw-r--r--` although it carries `#!/usr/bin/env python3`, so
   `./check-completed-index.py` does not execute. `python3 <path>` works.
8. Python portability: the code uses only `os.path`, `re`, `%`-formatting and explicit
   `encoding="utf-8"`. No defect found. Observed interpreter: Python 3.11.15.

---

## Literal CR verification

### Step 1 — the committed check script, run as-is

```
$ python3 .hyper-sprint/check-completed-index.py
OK: 5 rows, 5 sprint folders, all checks pass
EXIT CODE: 0
```

### Step 2 — the four CR-mandated mutations are each caught

```
----- M1: 5-cell data row -----
FAIL: line 9: 5 cells, expected 4
exit=1
----- M2: duplicate folder reference -----
FAIL: sprint folder 2026-08-08-palisade appears on 2 rows, expected 1
exit=1
----- M3: missing folder reference -----
FAIL: sprint folder 2026-07-06-envoy appears on 0 rows, expected 1
exit=1
----- M4: rows out of date order -----
FAIL: line 6: date 2026-08-08 is newer than the row above (2026-07-23)
exit=1
```

Header, separator, non-table text and empty-table handling:

```
=== E1: empty table (header+separator only, no data rows) ===
FAIL: no data rows found in the index table
FAIL: sprint folder 2026-07-06-envoy appears on 0 rows, expected 1
FAIL: sprint folder 2026-07-11-lifeboat appears on 0 rows, expected 1
FAIL: sprint folder 2026-07-13-panorama appears on 0 rows, expected 1
FAIL: sprint folder 2026-07-23-clarity appears on 0 rows, expected 1
FAIL: sprint folder 2026-08-08-palisade appears on 0 rows, expected 1
exit=1
=== E2: no table at all / only prose ===   -> same six FAIL lines, exit=1
=== E3: completely empty file ===          -> same six FAIL lines, exit=1
=== E4: no separator row, 5 valid data rows ===
OK: 5 rows, 5 sprint folders, all checks pass
exit=0
```

E1, E2 and E3 behave correctly. E4 is correct behavior (all five data rows were checked).

### Step 3 — CR-1 confirmed on the committed file

Cell count of every pipe line:

```
3 4 cells :: ['Date', 'Codename', 'Theme', 'Report']
4 4 cells :: ['---', '---', '---', '---']
5 4 cells :: ['2026-08-08', 'Palisade', 'Deck-data hardening: i', '[README](./2026-08-08-']
6 4 cells :: ['2026-07-23', 'Clarity', 'UX clarification: gall', '[README](./2026-07-23-']
7 4 cells :: ['2026-07-13', 'Panorama', 'Deck-editor UX: center', '[README](./2026-07-13-']
8 4 cells :: ['2026-07-11', 'Lifeboat', 'Export crash + dialog/', '[README](./2026-07-11-']
9 4 cells :: ['2026-07-06', 'Envoy', 'Native PowerPoint (.pp', '[README](./2026-07-06-']
```

Directories under `.hyper-sprint/completed/`:

```
./2026-07-06-envoy
./2026-07-11-lifeboat
./2026-07-13-panorama
./2026-07-23-clarity
./2026-08-08-palisade
```

Each appears on exactly one row. Dates:

```
dates: ['2026-08-08', '2026-07-23', '2026-07-13', '2026-07-11', '2026-07-06']
strictly descending: True
```

Link targets and file hygiene:

```
OK   ./2026-08-08-palisade/README.md -> completed/2026-08-08-palisade/README.md
OK   ./2026-07-23-clarity/README.md -> completed/2026-07-23-clarity/README.md
OK   ./2026-07-13-panorama/README.md -> completed/2026-07-13-panorama/README.md
OK   ./2026-07-11-lifeboat/README.md -> completed/2026-07-11-lifeboat/README.md
OK   ./2026-07-06-envoy/README.md -> completed/2026-07-06-envoy/README.md

bytes: 755 | BOM: False | CRLF: False | ends with newline: True
non-ascii: []
trailing-ws lines: []
tabs: 0
```

CR-1 holds on the committed file.

### Step 4 — CR-2 confirmed

Theme cell metrics:

```
 83 chars | clauses(.!?)=0 | Deck-data hardening: ingress allowlist, bounded recursion, CI drift guards (v13.22)
 78 chars | clauses(.!?)=0 | UX clarification: gallery title cards, TOC collapse, image-paste grid (v13.20)
 75 chars | clauses(.!?)=0 | Deck-editor UX: centered text, multi-select copy, TOC context menu (v13.11)
 48 chars | clauses(.!?)=0 | Export crash + dialog/toolbar/storage UX (v13.1)
 32 chars | clauses(.!?)=0 | Native PowerPoint (.pptx) export
```

Theme cells are 32-83 characters with zero multi-clause sentences, in a uniform
`Area: item, item, item (vXX.XX)` shape with the version tag last. Against long multi-clause
run-on Theme sentences this is plainly easier to scan. The check script still passes:

```
$ python3 .hyper-sprint/check-completed-index.py
OK: 5 rows, 5 sprint folders, all checks pass
exit=0
```

---

## VERDICT: DEFECTS FOUND

The index itself is correct: CR-1 and CR-2 both hold as user-visible outcomes. The **check script**,
which CR-1 makes part of the deliverable, does not reliably assert what CR-1 words. Defect 1 is the
blocking one: the specific malformation the CR was raised to fix passes silently if it is
reintroduced with a blank line before it.
