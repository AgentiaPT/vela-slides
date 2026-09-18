#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""CI gate: nobody re-implements the secret-to-disk path.

WHY
---
A local auth token was once written with ``os.open(path, ..., 0o600)`` and a
``st_mode`` check that only printed a warning. Both are no-ops on Windows and on
WSL drvfs mounts, so the file was written unprotected on two supported
platforms. The code was not wrong to want owner-only permissions; it was wrong
to believe a POSIX mode bit delivers them everywhere, and wrong to continue
when its own check failed.

Fixing that one function does not stop the next one. This gate does: any new
POSIX-permission literal, or any ``st_mode`` comparison, has to live inside the
canonical helper (``secure_file.py``) or be justified in place.

WHAT IT ENFORCES
----------------
1. Owner-only mode literals (``0o600`` / ``0o700``) appear only in
   ``secure_file.py``, in tests, or on a line marked ``# SECRET-WRITE-OK: why``.
2. ``st_mode`` is not compared against a literal outside the same places — on
   Windows that value is synthesized and cannot prove anything.
3. ``secure_file.py`` itself grows no fail-open escape hatch.

ESCAPE HATCH
------------
Put ``# SECRET-WRITE-OK: <reason>`` on the line. It is deliberately visible in
review — the reason has to convince a reader, not the script.

Exit 0 clean, 1 on a finding, 2 on usage error.
"""

import os
import re
import sys

# A gate must never fail because of how it prints its own result. The Windows
# console defaults to cp1252, which cannot encode the status glyphs the rest of
# this repo's tooling uses, so an all-clear run died on its own success line.
# Reconfigure to UTF-8 where we can (keeping output identical across runners),
# and fall back to ASCII markers where we cannot.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    PASS_MARK, FAIL_MARK = "\u2705", "\u274c"
except (AttributeError, OSError, ValueError):  # pragma: no cover
    PASS_MARK, FAIL_MARK = "PASS:", "FAIL:"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))

# The canonical helper, and the tests that deliberately exercise raw modes.
EXEMPT_FILES = {
    os.path.join("tools", "vela-dev", "scripts", "secure_file.py"),
    os.path.join("tools", "vela-dev", "scripts", "check-secret-writes.py"),
}
EXEMPT_DIRS = (
    "tests" + os.sep,
    "evals" + os.sep,          # frozen historical skill snapshots, never run
    "node_modules" + os.sep,
    ".git" + os.sep,
)

ALLOW_MARK = "SECRET-WRITE-OK:"
MARK_LOOKBEHIND = 6   # comment lines above the flagged line that may carry it
CALL_LOOKBEHIND = 3   # lines above, to catch a wrapped os.open(...)

# An owner-only mode (0o600 / 0o700) actually being APPLIED to a file. Matching
# the bare literal would flag prose; what matters is a call that sets it.
PERM_CALL = re.compile(
    r"\bos\.(open|chmod|fchmod|mkdir|makedirs|mknod|umask)\s*\(")
OWNER_ONLY_MODE = re.compile(r"0o[67]00\b")
# st_mode masked and compared. On nt this value is synthesized from
# FILE_ATTRIBUTE_READONLY, so the comparison can neither fail on a safe file nor
# pass on an unsafe one — it is decoration, not a check.
ST_MODE_COMPARE = re.compile(r"st_mode\s*&\s*0o?[0-7]+\s*(==|!=|<|>)")

FINDINGS = []


def _rel(path):
    return os.path.relpath(path, REPO_ROOT)


def _skip(rel):
    return rel in EXEMPT_FILES or rel.startswith(EXEMPT_DIRS)


def scan_file(path):
    rel = _rel(path)
    if _skip(rel):
        return
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except (OSError, UnicodeDecodeError):
        return
    for n, line in enumerate(lines, 1):
        # The marker may sit on the line itself or in the comment block just
        # above it — a one-line reason is rarely a good enough reason, so the
        # annotation has room to actually explain.
        if any(ALLOW_MARK in l for l in lines[max(0, n - 1 - MARK_LOOKBEHIND):n]):
            continue
        stripped = line.split("#", 1)[0]
        # A permission-setting call is often wrapped across lines, with the mode
        # on the continuation. Look back a few lines for the call itself, or a
        # wrapped os.open() slips through.
        window = "".join(lines[max(0, n - 1 - CALL_LOOKBEHIND):n])
        if OWNER_ONLY_MODE.search(stripped) and PERM_CALL.search(window):
            FINDINGS.append((
                rel, n,
                "owner-only mode literal outside secure_file.py — POSIX mode "
                "bits are a no-op on Windows and drvfs; use "
                "secure_file.write_secret()",
                line.strip(),
            ))
        if ST_MODE_COMPARE.search(stripped):
            FINDINGS.append((
                rel, n,
                "st_mode compared to a literal — on Windows this value is "
                "synthesized and proves nothing; verify through "
                "secure_file.write_secret()",
                line.strip(),
            ))


def check_helper_has_no_hatch():
    """The helper must not grow a "write it anyway" override."""
    helper = os.path.join(REPO_ROOT, "tools", "vela-dev", "scripts", "secure_file.py")
    try:
        with open(helper, encoding="utf-8") as f:
            src = f.read()
    except OSError:
        FINDINGS.append((_rel(helper), 0, "canonical helper is missing", ""))
        return
    for bad in ("ALLOW_INSECURE", "allow_insecure"):
        # The module documents in prose why it has none, so a bare substring
        # match would flag its own explanation. Only a real DEFINITION counts:
        # a def or an assignment whose NAME carries the token. (Both branches
        # must contain the token — an alternation where one branch does not
        # matches every `def` in the file.)
        pattern = r"^\s*(?:def\s+\w*{0}\w*\s*\(|\w*{0}\w*\s*=)".format(bad)
        if re.search(pattern, src, re.M):
            FINDINGS.append((
                _rel(helper), 0,
                "a fail-open insecure-write override was added to the canonical "
                "helper — the recourse for an unprotectable filesystem is "
                "VELA_TOKEN, not a weaker write",
                bad,
            ))


def main(argv):
    if len(argv) > 1:
        print(__doc__)
        return 2
    for base, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs
                   if d not in (".git", "node_modules", "__pycache__", "dist", ".venv")]
        for name in files:
            if name.endswith(".py"):
                scan_file(os.path.join(base, name))
    check_helper_has_no_hatch()

    if FINDINGS:
        print(f"{FAIL_MARK} Secret-write policy violations:\n")
        for rel, n, why, line in FINDINGS:
            where = f"{rel}:{n}" if n else rel
            print(f"  {where}\n      {why}")
            if line:
                print(f"      > {line}")
        print(f"\n{len(FINDINGS)} finding(s). Route the write through "
              f"tools/vela-dev/scripts/secure_file.py, or annotate the line "
              f"with '# {ALLOW_MARK} <reason>' if it genuinely handles no secret.")
        return 1

    print(f"{PASS_MARK} Secret-write policy: no raw owner-only modes or "
          f"st_mode assertions outside the canonical helper.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
