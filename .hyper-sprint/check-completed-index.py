#!/usr/bin/env python3
"""Check the hyper-sprint archive index table (.hyper-sprint/completed/README.md).

Asserts, on the committed file:
  (a) every row of the table -- header, separator and data -- has exactly 4 cells;
  (b) every sprint folder under .hyper-sprint/completed/ is linked from exactly one
      data row, and every data row links to a folder that exists;
  (c) data rows are sorted by date, newest first.

Exit 0 = pass, 1 = fail. Every violation prints one `FAIL: ...` line on stderr.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
COMPLETED = os.path.join(HERE, "completed")
INDEX = os.path.join(COMPLETED, "README.md")
COLUMNS = 4

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SPRINT_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+$")
# The Report cell links to the sprint folder: [README](./<folder>/README.md)
LINK_RE = re.compile(r"\]\(\.{0,2}/?(?P<folder>[^/()\s]+)/README\.md\)")


def cells(line):
    """Split one markdown table line into its cells."""
    return [c.strip() for c in line.strip().strip("|").split("|")]


def is_separator(cs):
    """True for a markdown separator line such as |---|---|---|---|."""
    return bool(cs) and all(c and set(c) <= set("-: ") for c in cs)


def main():
    errors = []

    if not os.path.isfile(INDEX):
        sys.stderr.write("FAIL: index file %s does not exist\n" % INDEX)
        return 1

    with open(INDEX, encoding="utf-8") as fh:
        lines = fh.read().splitlines()

    # Every pipe line in the file belongs to the table, whatever separates it from
    # the line above. A blank line must never exempt a row from the checks.
    pipe_lines = [(num, cells(line)) for num, line in enumerate(lines, 1)
                  if line.strip().startswith("|")]
    separators = [i for i, (_, cs) in enumerate(pipe_lines) if is_separator(cs)]

    if len(separators) != 1:
        sys.stderr.write(
            "FAIL: expected exactly one table separator line, found %d\n" % len(separators))
        return 1
    sep_at = separators[0]
    if sep_at != 1:
        sys.stderr.write(
            "FAIL: the separator must be the second line of the one table, "
            "found %d pipe line(s) before it\n" % sep_at)
        return 1

    header = pipe_lines[0]
    separator = pipe_lines[1]
    rows = pipe_lines[2:]

    if not rows:
        errors.append("no data rows found in the index table")

    # (a) exactly 4 cells on every line of the table, header and separator included
    for label, (num, cs) in (("header", header), ("separator", separator)):
        if len(cs) != COLUMNS:
            errors.append("line %d: %s has %d cells, expected %d"
                          % (num, label, len(cs), COLUMNS))
    for num, cs in rows:
        if len(cs) != COLUMNS:
            errors.append("line %d: data row has %d cells, expected %d"
                          % (num, len(cs), COLUMNS))

    # (b) one row per sprint folder, one existing sprint folder per row.
    # The folder is read from the row's link target, so prose that merely names a
    # folder never counts as a row, and one folder name is never a substring hit
    # inside a longer one.
    linked = {}
    for num, cs in rows:
        match = LINK_RE.search(cs[-1]) if cs else None
        if match is None:
            errors.append("line %d: no [..](./<sprint-folder>/README.md) link in the last cell"
                          % num)
            continue
        folder = match.group("folder")
        linked.setdefault(folder, []).append(num)
        if not os.path.isdir(os.path.join(COMPLETED, folder)):
            errors.append("line %d: links to %s, which is not a folder under completed/"
                          % (num, folder))

    folders = sorted(d for d in os.listdir(COMPLETED)
                     if os.path.isdir(os.path.join(COMPLETED, d)) and SPRINT_DIR_RE.match(d))
    for folder in folders:
        hits = linked.get(folder, [])
        if len(hits) != 1:
            errors.append("sprint folder %s is linked from %d rows (%s), expected 1"
                          % (folder, len(hits), ", ".join("line %d" % h for h in hits) or "none"))

    # (c) data rows sorted by date, newest first
    dates = []
    for num, cs in rows:
        if not cs or not DATE_RE.match(cs[0]):
            errors.append("line %d: first cell %r is not a YYYY-MM-DD date"
                          % (num, cs[0] if cs else ""))
        else:
            dates.append((num, cs[0]))
    for (_, prev), (num, cur) in zip(dates, dates[1:]):
        if cur >= prev:
            errors.append("line %d: date %s is not older than the row above (%s)"
                          % (num, cur, prev))

    if errors:
        for e in errors:
            sys.stderr.write("FAIL: %s\n" % e)
        return 1
    print("OK: %d rows, %d sprint folders, all checks pass" % (len(rows), len(folders)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
