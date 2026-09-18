#!/usr/bin/env python3
"""Check the hyper-sprint archive index table (.hyper-sprint/completed/README.md).

Asserts, on the committed file:
  (a) every data row has exactly 4 cells;
  (b) every sprint folder under .hyper-sprint/completed/ appears on exactly one row;
  (c) rows are sorted by date, newest first.

Exit 0 = pass, 1 = fail.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
COMPLETED = os.path.join(HERE, "completed")
INDEX = os.path.join(COMPLETED, "README.md")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def cells(line):
    """Split one markdown table line into its cells."""
    return [c.strip() for c in line.strip().strip("|").split("|")]


def main():
    errors = []
    with open(INDEX, encoding="utf-8") as fh:
        lines = fh.read().splitlines()

    rows = []          # (line number, cell list)
    in_table = False
    for num, line in enumerate(lines, 1):
        if not line.strip().startswith("|"):
            in_table = False
            continue
        cs = cells(line)
        if not in_table:
            in_table = True          # header line
            continue
        if all(set(c) <= set("-: ") and c for c in cs):
            continue                 # separator line
        rows.append((num, cs))

    if not rows:
        errors.append("no data rows found in the index table")

    # (a) exactly 4 cells per data row
    for num, cs in rows:
        if len(cs) != 4:
            errors.append("line %d: %d cells, expected 4" % (num, len(cs)))

    # (b) every sprint folder appears on exactly one row
    folders = sorted(
        d for d in os.listdir(COMPLETED)
        if os.path.isdir(os.path.join(COMPLETED, d))
    )
    text = "\n".join(line for _, cs in rows for line in ["|".join(cs)])
    for folder in folders:
        hits = text.count(folder)
        if hits != 1:
            errors.append(
                "sprint folder %s appears on %d rows, expected 1" % (folder, hits))

    # (c) rows sorted by date, newest first
    dates = []
    for num, cs in rows:
        if not DATE_RE.match(cs[0]):
            errors.append("line %d: first cell %r is not a YYYY-MM-DD date" % (num, cs[0]))
        else:
            dates.append((num, cs[0]))
    for (_, prev), (num, cur) in zip(dates, dates[1:]):
        if cur > prev:
            errors.append("line %d: date %s is newer than the row above (%s)" % (num, cur, prev))

    if errors:
        for e in errors:
            sys.stderr.write("FAIL: %s\n" % e)
        return 1
    print("OK: %d rows, %d sprint folders, all checks pass" % (len(rows), len(folders)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
