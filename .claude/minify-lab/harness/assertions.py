#!/usr/bin/env python3
"""
assertions.py — VERDICT 6B assertion engine (harness-design.md §9).

Every assertion result carries `critical: true|false` and a mandatory
evidence string — a bare boolean is never an acceptable result here. Output
shape ported from evals/scripts/validate.py's `{passed, total, results:[...]}`.

The centerpiece is `read_before_edit` (§9.3): transcript-based proof of
consultation from tool-call history ONLY. Assistant text is NEVER inspected
for this — self-report is not evidence anywhere in this harness. A fixture
where the agent claims "I read X" but made no matching tool call must FAIL
(covered in `_selftest`).

Usage:
  python3 assertions.py --run-dir <dir> --scenario <id> [--json]
  python3 assertions.py --selftest
"""

import argparse
import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


def _load_config():
    if yaml is None:
        return {}
    cfg_path = HARNESS_DIR / "config.yaml"
    if cfg_path.exists():
        with open(cfg_path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


SKILL_PATH_MAP_DEFAULT = {
    "vela-secure-coding": ".claude/skills/vela-secure-coding/SKILL.md",
    "vela-slides": "skills/vela-slides/SKILL.md",
    "hyper-sprint": ".claude/skills/hyper-sprint/SKILL.md",
}

READER_COMMANDS = ("grep", "rg", "sed", "awk", "cat", "head", "tail")


# ── run-dir data loading ────────────────────────────────────────────────

class RunData:
    """Everything an assertion needs about one (scenario, arm, rep) run."""

    def __init__(self, run_dir, worktree_dir=None):
        self.run_dir = Path(run_dir)
        self.worktree_dir = Path(worktree_dir) if worktree_dir else self.run_dir / "wt"
        self.events = self._load_json("events.json", default=[])
        self.metrics = self._load_json("metrics.json", default={})
        self.files_changed = self._load_json("files-changed.json", default=[])
        self.final_answer = self._load_text("final-answer.txt")
        self.diff_patch = self._load_text("diff.patch")
        self.anchors = self._load_json("anchors.json", default={})

    def _load_json(self, name, default):
        p = self.run_dir / name
        if not p.exists():
            return default
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    def _load_text(self, name):
        p = self.run_dir / name
        if not p.exists():
            return ""
        return p.read_text(encoding="utf-8")

    def changed_paths(self):
        """files-changed.json is a list of {status, path} or plain paths."""
        out = []
        for item in self.files_changed:
            if isinstance(item, dict):
                out.append(item.get("path", ""))
            else:
                out.append(item)
        return [p for p in out if p]

    def file_text(self, rel_path):
        p = self.worktree_dir / rel_path
        if not p.exists():
            return None
        try:
            return p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return None


# ── evidence helper ──────────────────────────────────────────────────────

def result(atype, critical, passed, evidence, **detail):
    r = {"type": atype, "critical": critical, "passed": passed, "evidence": evidence}
    if detail:
        r["detail"] = detail
    return r


# ── diff / filesystem assertions ─────────────────────────────────────────

def check_files_changed_include(spec, run):
    paths = run.changed_paths()
    misses = []
    for pattern in spec["paths"]:
        if not any(fnmatch.fnmatch(p, pattern) for p in paths):
            misses.append(pattern)
    passed = not misses
    ev = "all globs matched" if passed else f"no match for: {', '.join(misses)}"
    return result("files_changed_include", spec.get("critical", True), passed, ev)


def check_files_changed_exclude(spec, run):
    paths = run.changed_paths()
    hits = []
    for pattern in spec["paths"]:
        matched = [p for p in paths if fnmatch.fnmatch(p, pattern)]
        hits.extend(matched)
    passed = not hits
    ev = "no excluded path touched" if passed else f"excluded path(s) touched: {', '.join(hits)}"
    return result("files_changed_exclude", spec.get("critical", True), passed, ev)


def check_files_changed_max(spec, run):
    n = len(run.changed_paths())
    passed = n <= spec["n"]
    return result("files_changed_max", spec.get("critical", False), passed,
                  f"{n} files changed (max {spec['n']})")


def _diff_line_counts(diff_text):
    added = removed = hunks = 0
    for line in diff_text.splitlines():
        if line.startswith("@@"):
            hunks += 1
        elif line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed += 1
    return added, removed, hunks


def check_diff_lines_max(spec, run):
    added, removed, _ = _diff_line_counts(run.diff_patch)
    total = added + removed
    passed = total <= spec["n"]
    return result("diff_lines_max", spec.get("critical", False), passed,
                  f"{total} lines changed (+{added}/-{removed}, max {spec['n']})")


def check_diff_hunks_max(spec, run):
    _, _, hunks = _diff_line_counts(run.diff_patch)
    passed = hunks <= spec["n"]
    return result("diff_hunks_max", spec.get("critical", False), passed,
                  f"{hunks} hunks (max {spec['n']})")


def _extract_symbol_body(text, symbol_regex):
    """Best-effort: from the first match of symbol_regex, extract up to the
    next balanced top-level closer, capped at 4000 chars. Used for
    `within_symbol` scoping."""
    m = re.search(symbol_regex, text)
    if not m:
        return None
    start = m.start()
    return text[start:start + 4000]


def check_file_contains(spec, run, expect_present=True):
    atype = "file_contains" if expect_present else "file_not_contains"
    text = run.file_text(spec["path"])
    if text is None:
        return result(atype, spec.get("critical", True), not expect_present,
                      f"file not found: {spec['path']}")
    haystack = text
    if spec.get("within_symbol"):
        scoped = _extract_symbol_body(text, re.escape(spec["within_symbol"]))
        if scoped is None:
            # symbol not found: file_contains fails (nothing to search);
            # file_not_contains passes vacuously (nothing there to violate).
            passed = not expect_present
            return result(atype, spec.get("critical", True), passed,
                          f"symbol '{spec['within_symbol']}' not found in {spec['path']}")
        haystack = scoped

    pattern = spec["pattern"]
    if spec.get("regex", True) and any(c in pattern for c in r"\^$.|?*+()[]{}"):
        found = re.search(pattern, haystack) is not None
    else:
        found = pattern in haystack

    passed = found if expect_present else not found
    verb = "found" if found else "not found"
    return result(atype, spec.get("critical", True), passed,
                  f"'{pattern}' {verb} in {spec['path']}" +
                  (f" [within {spec['within_symbol']}]" if spec.get("within_symbol") else ""))


def check_file_not_contains(spec, run):
    return check_file_contains(spec, run, expect_present=False)


def check_symbol_set_contains(spec, run):
    text = run.file_text(spec["path"])
    if text is None:
        return result("symbol_set_contains", spec.get("critical", True), False,
                      f"file not found: {spec['path']}")
    # find `const <symbol> = new Set([ ... ])` and extract the balanced [...]
    m = re.search(rf"const\s+{re.escape(spec['symbol'])}\s*=\s*new\s+Set\(\s*\[", text)
    if not m:
        return result("symbol_set_contains", spec.get("critical", True), False,
                      f"{spec['symbol']} not found in {spec['path']}")
    start = m.end() - 1  # position of the '['
    depth = 0
    end = None
    for i in range(start, min(start + 20000, len(text))):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        return result("symbol_set_contains", spec.get("critical", True), False,
                      f"{spec['symbol']} literal not balanced in {spec['path']}")
    literal = text[start:end]
    member_pattern = rf'["\']{re.escape(spec["member"])}["\']'
    found = re.search(member_pattern, literal) is not None
    return result("symbol_set_contains", spec.get("critical", True), found,
                  f"{spec['symbol']} {'contains' if found else 'does not contain'} "
                  f'"{spec["member"]}" ({spec["path"]})')


def check_manifest_contains(spec, run):
    text = run.file_text("src/parts/MANIFEST.txt")
    if text is None:
        return result("manifest_contains", spec.get("critical", True), False,
                      "src/parts/MANIFEST.txt not found")
    found = any(
        spec["part"] in line and not line.strip().startswith("#")
        for line in text.splitlines()
    )
    return result("manifest_contains", spec.get("critical", True), found,
                  f"MANIFEST.txt {'has' if found else 'is missing'} a non-comment line for {spec['part']}")


def check_manifest_position_before(spec, run):
    text = run.file_text("src/parts/MANIFEST.txt")
    if text is None:
        return result("manifest_position_before", spec.get("critical", True), False,
                      "src/parts/MANIFEST.txt not found")
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    positions = {}
    for i, ln in enumerate(lines):
        for name in [spec["part"]] + spec["before"]:
            if name in ln and name not in positions:
                positions[name] = i
    part_pos = positions.get(spec["part"])
    if part_pos is None:
        return result("manifest_position_before", spec.get("critical", True), False,
                      f"{spec['part']} not found in MANIFEST.txt")
    misses = [b for b in spec["before"] if b in positions and positions[b] <= part_pos]
    passed = part_pos is not None and not misses
    ev = (f"{spec['part']} at line {part_pos}, before {spec['before']}" if passed
          else f"{spec['part']} not positioned before {misses}")
    return result("manifest_position_before", spec.get("critical", True), passed, ev)


_VERSION_RE = re.compile(r'VELA_VERSION\s*=\s*["\'](\d+)\.(\d+)["\']')


def _parse_version(text):
    m = _VERSION_RE.search(text or "")
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)))


def check_version_bumped(spec, run, base_text=None):
    head_text = run.file_text(spec["path"])
    head_v = _parse_version(head_text)
    base_v = _parse_version(base_text) if base_text is not None else None
    if base_v is None:
        # fall back: caller must supply base_text via run.anchors or similar;
        # if truly unavailable, treat as a hard failure with a clear reason.
        return result("version_bumped", spec.get("critical", True), False,
                      "no base VELA_VERSION available for comparison (prepared-base snapshot missing)")
    if head_v is None:
        return result("version_bumped", spec.get("critical", True), False,
                      f"VELA_VERSION not found in {spec['path']} at HEAD")
    passed = head_v > base_v
    return result("version_bumped", spec.get("critical", True), passed,
                  f"VELA_VERSION {'.'.join(map(str, base_v))} -> {'.'.join(map(str, head_v))}"
                  f" ({'increased' if passed else 'not increased'})")


def check_changelog_entry_added(spec, run, base_text=None):
    head_text = run.file_text("src/parts/part-imports.jsx") or ""
    m = re.search(r"VELA_CHANGELOG\s*=\s*\[", head_text)
    if not m:
        return result("changelog_entry_added", spec.get("critical", True), False,
                      "VELA_CHANGELOG not found")
    head_v = _parse_version(head_text)
    if head_v is None:
        return result("changelog_entry_added", spec.get("critical", True), False,
                       "VELA_VERSION not found alongside VELA_CHANGELOG")
    v_str = ".".join(map(str, head_v))
    # look for {v:"X.Y", ...} as the first array element (approximate: first
    # `v:` occurrence after the array open).
    entry_search = head_text[m.end():m.end() + 500]
    first_v_match = re.search(r'v\s*:\s*["\']([\d.]+)["\']', entry_search)
    passed = bool(first_v_match and first_v_match.group(1) == v_str)
    ev = (f"first VELA_CHANGELOG entry v='{first_v_match.group(1) if first_v_match else '?'}' "
          f"vs VELA_VERSION='{v_str}'")
    return result("changelog_entry_added", spec.get("critical", True), passed, ev)


def check_changelog_entry_shape(spec, run):
    head_text = run.file_text("src/parts/part-imports.jsx") or ""
    m = re.search(r"VELA_CHANGELOG\s*=\s*\[\s*\{", head_text)
    if not m:
        return result("changelog_entry_shape", spec.get("critical", False), False,
                      "VELA_CHANGELOG entry not found")
    entry_text = head_text[m.start():m.start() + 1500]
    d_match = re.search(r'd\s*:\s*(\[[^\]]*\]|"(?:[^"\\]|\\.)*")', entry_text, re.DOTALL)
    if not d_match:
        return result("changelog_entry_shape", spec.get("critical", False), False,
                      "changelog entry has no 'd' field")
    d_raw = d_match.group(1)
    max_bullets = spec.get("max_bullets", 3)
    max_chars = spec.get("max_chars_per_bullet", 180)
    if d_raw.startswith("["):
        bullets = re.findall(r'"((?:[^"\\]|\\.)*)"', d_raw)
        ok_count = len(bullets) <= max_bullets
        ok_len = all(len(b) <= max_chars for b in bullets)
        passed = ok_count and ok_len
        ev = f"{len(bullets)} bullets (max {max_bullets}), longest {max((len(b) for b in bullets), default=0)} chars (max {max_chars})"
    else:
        s = d_raw.strip('"')
        passed = len(s) <= max_chars
        ev = f"single-string entry, {len(s)} chars (max {max_chars})"
    return result("changelog_entry_shape", spec.get("critical", False), passed, ev)


def check_ci_version_gate(spec, run, base_text=None):
    """Replays .github/workflows/ci.yml's version-bump rule locally: if any
    changed path is under skills/vela-slides/ or src/parts/, VELA_VERSION
    must differ from base."""
    paths = run.changed_paths()
    touches_gated_area = any(
        p.startswith("skills/vela-slides/") or p.startswith("src/parts/")
        for p in paths
    )
    if not touches_gated_area:
        return result("ci_version_gate", spec.get("critical", True), True,
                       "no path under skills/vela-slides/ or src/parts/ changed — gate not triggered")
    head_text = run.file_text("src/parts/part-imports.jsx") or ""
    head_v = _parse_version(head_text)
    base_v = _parse_version(base_text) if base_text is not None else None
    passed = bool(head_v and base_v and head_v != base_v)
    return result("ci_version_gate", spec.get("critical", True), passed,
                  f"gated area touched; VELA_VERSION base={base_v} head={head_v}")


def check_command_succeeds(spec, run):
    try:
        cp = subprocess.run(
            spec["cmd"], shell=True, cwd=str(run.worktree_dir),
            capture_output=True, text=True, timeout=spec.get("timeout_s", 120),
        )
        passed = cp.returncode == 0
        ev = f"exit={cp.returncode}" + ("" if passed else f" stderr: {cp.stderr[-300:]}")
    except subprocess.TimeoutExpired:
        passed = False
        ev = f"timed out after {spec.get('timeout_s', 120)}s"
    except FileNotFoundError as e:
        passed = False
        ev = f"command not found: {e}"
    return result("command_succeeds", spec.get("critical", True), passed, ev)


def check_command_output_unchanged(spec, run):
    target = run.worktree_dir / spec["path"]
    before = target.read_bytes() if target.exists() else None
    try:
        subprocess.run(spec["cmd"], shell=True, cwd=str(run.worktree_dir),
                        capture_output=True, text=True, timeout=120, check=False)
    except Exception as e:
        return result("command_output_unchanged", spec.get("critical", False), False,
                       f"command failed to run: {e}")
    after = target.read_bytes() if target.exists() else None
    passed = before is not None and after is not None and before == after
    ev = ("byte-identical before/after re-running the generator — the agent "
          "already regenerated it" if passed else
          "output changed after re-running the generator — the agent's committed "
          "artifact was stale")
    return result("command_output_unchanged", spec.get("critical", False), passed, ev)


def check_answer_matches(spec, run, expect_match=True):
    atype = "answer_matches" if expect_match else "answer_not_matches"
    found = re.search(spec["pattern"], run.final_answer) is not None
    passed = found if expect_match else not found
    return result(atype, spec.get("critical", True), passed,
                  f"pattern {'found' if found else 'not found'} in final answer")


def check_answer_not_matches(spec, run):
    return check_answer_matches(spec, run, expect_match=False)


# ── transcript-based assertions ──────────────────────────────────────────

def check_tool_used(spec, run, expect_used=True):
    atype = "tool_used" if expect_used else "tool_not_used"
    matches = []
    for e in run.events:
        if e["kind"] != "tool_use" or e["name"] != spec["name"]:
            continue
        if e.get("result") and e["result"].get("is_error"):
            continue
        if spec.get("input_matches"):
            inp_str = json.dumps(e.get("input", {}))
            if not re.search(spec["input_matches"], inp_str):
                continue
        matches.append(e)
    passed = bool(matches) if expect_used else not matches
    ev = f"{len(matches)} matching non-error call(s) to {spec['name']}"
    return result(atype, spec.get("critical", False), passed, ev)


def check_tool_not_used(spec, run):
    return check_tool_used(spec, run, expect_used=False)


def check_no_broad_tree_scan(spec, run):
    violations = []
    for e in run.events:
        if e["kind"] != "tool_use":
            continue
        if e["name"] == "Glob":
            pattern = e.get("input", {}).get("pattern", "")
            if pattern in ("**/*", "**/*.jsx"):
                violations.append(f"Glob({pattern})")
        elif e["name"] == "Bash":
            cmd = e.get("input", {}).get("command", "")
            if re.search(r"\bls\s+-R\b", cmd) or re.search(r"\bfind\s+\.\b", cmd):
                violations.append(f"Bash({cmd[:60]})")
        elif e["name"] == "Read":
            inp = e.get("input", {})
            path = inp.get("file_path", "")
            if path.endswith(".jsx") and "offset" not in inp and "limit" not in inp:
                violations.append(f"Read({path}) whole-file, no offset/limit")
    passed = not violations
    ev = "no broad scans detected" if passed else f"{len(violations)} broad scan(s): {violations[:3]}"
    return result("no_broad_tree_scan", spec.get("critical", False), passed, ev)


def check_tool_calls_max(spec, run):
    n = len([e for e in run.events if e["kind"] == "tool_use"])
    passed = n <= spec["n"]
    return result("tool_calls_max", spec.get("critical", False), passed,
                  f"{n} tool calls (max {spec['n']})")


# ── read_before_edit (§9.3) ──────────────────────────────────────────────

def _resolve_realpath(worktree_dir, file_path):
    if not file_path:
        return None
    p = (worktree_dir / file_path) if not os.path.isabs(file_path) else Path(file_path)
    try:
        return str(p.resolve())
    except OSError:
        return str(p)


def _anchor_core(anchor_regex, min_len=4):
    """Longest non-metacharacter substring of an anchor regex, >=4 chars."""
    parts = re.split(r"[\\^$.|?*+()\[\]{}]", anchor_regex)
    parts = [p.strip() for p in parts if len(p.strip()) >= min_len]
    return max(parts, key=len) if parts else anchor_regex


def _is_consultation_event(e, must_read_path, worktree_dir, anchor, evidence_kinds, skill_map):
    """Returns (is_consultation: bool, kind: str|None) for one event against
    ONE must_read target. Never inspects assistant text blocks."""
    if e["kind"] != "tool_use":
        return False, None
    res = e.get("result")
    if res is None or res.get("is_error") or res.get("empty"):
        return False, None

    name = e["name"]
    inp = e.get("input", {}) or {}

    if name == "Read" and "read" in evidence_kinds:
        rp = _resolve_realpath(worktree_dir, inp.get("file_path", ""))
        target_rp = _resolve_realpath(worktree_dir, must_read_path)
        if rp != target_rp:
            return False, None
        if anchor is None or ("offset" not in inp and "limit" not in inp):
            return True, "read"
        offset = inp.get("offset", 1)
        limit = inp.get("limit")
        read_start = offset
        read_end = offset + limit if limit else float("inf")
        a_start, a_end = anchor["start"], anchor["end"]
        if read_start < a_end and a_start < read_end:
            return True, "read"
        return False, None

    if name == "Grep" and "grep" in evidence_kinds:
        path_arg = inp.get("path", "") or inp.get("glob", "")
        if must_read_path not in str(path_arg) and not str(path_arg) == "":
            # if a path/glob was given, it must reference our file; an empty
            # path/glob searches the whole tree and could still hit it — we
            # can't verify that without the actual match locations, so we
            # only credit an explicit path/glob targeting must_read_path,
            # matching the design's "whose path/glob includes must_read.path".
            return False, None
        core = _anchor_core(anchor["regex"]) if anchor else None
        pattern = inp.get("pattern", "")
        if core and core.lower() not in pattern.lower() and pattern.lower() not in core.lower():
            return False, None
        return True, "grep"

    if name == "Bash" and "shell_read" in evidence_kinds:
        cmd = inp.get("command", "")
        if not any(re.search(rf"\b{re.escape(r)}\b", cmd) for r in READER_COMMANDS):
            return False, None
        if must_read_path not in cmd:
            return False, None
        if anchor:
            sed_m = re.search(r"sed\s+-n\s+'?(\d+),(\d+)p'?", cmd)
            if sed_m:
                s, e_ = int(sed_m.group(1)), int(sed_m.group(2))
                if not (s < anchor["end"] and anchor["start"] < e_):
                    return False, None
            else:
                core = _anchor_core(anchor["regex"])
                if core.lower() not in cmd.lower():
                    return False, None
        return True, "shell_read"

    if name == "Skill" and "skill_load" in evidence_kinds:
        skill_name = inp.get("skill") or inp.get("name") or ""
        mapped = skill_map.get(skill_name)
        if mapped and (mapped == must_read_path or mapped.endswith(must_read_path)):
            return True, "skill_load"
        return False, None

    return False, None


def _is_mutation_event(e, target_paths, worktree_dir):
    if e["kind"] != "tool_use":
        return False
    name = e["name"]
    inp = e.get("input", {}) or {}
    targets_rp = {_resolve_realpath(worktree_dir, p) for p in target_paths}

    if name in ("Edit", "Write", "MultiEdit"):
        fp = inp.get("file_path", "")
        if _resolve_realpath(worktree_dir, fp) in targets_rp:
            # a hook-blocked edit never happened — not a mutation
            res = e.get("result")
            if res and res.get("is_error") and e.get("hook_blocked"):
                return False
            return True
        # MultiEdit may carry multiple edits with their own file_path in some
        # transcript shapes; also check an `edits` list.
        for edit in inp.get("edits", []) if isinstance(inp.get("edits"), list) else []:
            fp2 = edit.get("file_path", fp)
            if _resolve_realpath(worktree_dir, fp2) in targets_rp:
                return True
        return False

    if name == "Bash":
        cmd = inp.get("command", "")
        for p in target_paths:
            if p in cmd and re.search(r"(sed\s+-i|patch\b|\btee\b|>>?\s|python3?\s*-\s*<<)", cmd):
                return True
        return False

    return False


def check_read_before_edit(spec, run, config):
    skill_map = config.get("skill_path_map", SKILL_PATH_MAP_DEFAULT)
    must_read = spec["must_read"]
    path = must_read["path"]
    section = must_read.get("section")
    evidence_kinds = spec.get("evidence", ["read", "grep", "shell_read", "skill_load"])
    ordering = spec.get("ordering", "strict")
    before_edit_to = spec["before_edit_to"]
    critical = spec.get("critical", True)

    anchor = None
    if section:
        anchor_info = run.anchors.get(path, {}).get(section.get("anchor_regex"))
        if anchor_info:
            anchor = {"start": anchor_info[0], "end": anchor_info[1], "regex": section["anchor_regex"]}
        else:
            # anchors.json missing this resolution — fall back to a
            # generous ±window search is not possible without a base line;
            # treat any read/grep/shell_read of the whole file as sufficient
            # (anchor is best-effort per §9.3 step 1; a missing anchor must
            # not silently pass everything, so we degrade to whole-file).
            anchor = None

    consultations = []
    for e in run.events:
        is_c, kind = _is_consultation_event(e, path, run.worktree_dir, anchor, evidence_kinds, skill_map)
        if is_c:
            consultations.append((e["index"], kind, e.get("via_subagent", False)))

    mutations = []
    for e in run.events:
        if _is_mutation_event(e, before_edit_to, run.worktree_dir):
            mutations.append(e["index"])
        elif e["kind"] == "tool_use" and e["name"] in ("Edit", "Write", "MultiEdit") and e.get("hook_blocked"):
            fp = e.get("input", {}).get("file_path", "")
            if _resolve_realpath(run.worktree_dir, fp) in {
                _resolve_realpath(run.worktree_dir, p) for p in before_edit_to
            }:
                pass  # recorded separately below for detail.hook_blocked_before

    hook_blocked_before = any(
        e["kind"] == "tool_use" and e["name"] in ("Edit", "Write", "MultiEdit")
        and e.get("hook_blocked")
        and _resolve_realpath(run.worktree_dir, e.get("input", {}).get("file_path", ""))
        in {_resolve_realpath(run.worktree_dir, p) for p in before_edit_to}
        for e in run.events
    )

    if not mutations and ordering == "strict":
        return result("read_before_edit", critical, True,
                      f"no mutation to {before_edit_to}; ordering not testable "
                      "(skipped — not counted toward critical totals)",
                      skipped=True, path=path, hook_blocked_before=hook_blocked_before)

    if ordering == "any":
        passed = bool(consultations)
        if passed:
            idx, kind, via_sub = consultations[0]
            ev = f"event#{idx} {kind} satisfies 'any' ordering for {path}"
        else:
            ev = f"no consultation of {path} found via {evidence_kinds}"
        return result("read_before_edit", critical, passed, ev,
                       consultation_index=(consultations[0][0] if consultations else None),
                       kind=(consultations[0][1] if consultations else None),
                       hook_blocked_before=hook_blocked_before)

    # strict ordering
    first_mutation_idx = min(mutations) if mutations else None
    prior_consultations = [c for c in consultations if c[0] < first_mutation_idx] if first_mutation_idx is not None else []
    passed = bool(prior_consultations)

    if passed:
        idx, kind, via_sub = prior_consultations[0]
        ev = (f"event#{idx} {kind} consultation of {path} "
              f"precedes first mutation event#{first_mutation_idx}")
    else:
        if consultations:
            idx, kind, via_sub = consultations[0]
            ev = (f"consultation of {path} found (event#{idx} {kind}) but AFTER "
                  f"first mutation event#{first_mutation_idx} — ordering violated")
        else:
            ev = (f"no consultation of {path} found before mutation event#{first_mutation_idx} "
                  f"(evidence kinds checked: {evidence_kinds})")

    return result("read_before_edit", critical, passed, ev,
                  consultation_index=(prior_consultations[0][0] if prior_consultations else None),
                  kind=(prior_consultations[0][1] if prior_consultations else None),
                  mutation_index=first_mutation_idx,
                  via_subagent=(prior_consultations[0][2] if prior_consultations else False),
                  hook_blocked_before=hook_blocked_before)


# ── locate_before_edit (weaker sibling; section_map alone satisfies it) ──

def check_locate_before_edit(spec, run):
    must_read = spec["must_read"]
    path = must_read["path"]
    before_edit_to = spec["before_edit_to"]
    part_name = Path(path).name

    located = []
    for e in run.events:
        if e["kind"] != "tool_use" or e["name"] != "Bash":
            continue
        cmd = e.get("input", {}).get("command", "")
        if "partsize.py" in cmd and part_name in cmd:
            res = e.get("result")
            if res and not res.get("is_error"):
                located.append(e["index"])
        # a plain read/grep also counts for the weaker assertion
        if any(r in cmd for r in READER_COMMANDS) and path in cmd:
            res = e.get("result")
            if res and not res.get("is_error"):
                located.append(e["index"])
    for e in run.events:
        if e["kind"] == "tool_use" and e["name"] in ("Read", "Grep"):
            fp = e.get("input", {}).get("file_path") or e.get("input", {}).get("path", "")
            if path in str(fp):
                res = e.get("result")
                if res and not res.get("is_error"):
                    located.append(e["index"])

    mutations = [e["index"] for e in run.events if _is_mutation_event(e, before_edit_to, run.worktree_dir)]
    if not mutations:
        return result("locate_before_edit", spec.get("critical", False), True,
                       f"no mutation to {before_edit_to}; not testable", skipped=True)
    first_mutation = min(mutations)
    prior = [i for i in located if i < first_mutation]
    passed = bool(prior)
    ev = (f"location event#{prior[0]} precedes mutation#{first_mutation}" if passed
          else "no locating call found before mutation")
    return result("locate_before_edit", spec.get("critical", False), passed, ev)


# ── dispatch ─────────────────────────────────────────────────────────────

_SIMPLE_DISPATCH = {
    "files_changed_include": check_files_changed_include,
    "files_changed_exclude": check_files_changed_exclude,
    "files_changed_max": check_files_changed_max,
    "diff_lines_max": check_diff_lines_max,
    "diff_hunks_max": check_diff_hunks_max,
    "file_contains": check_file_contains,
    "file_not_contains": check_file_not_contains,
    "symbol_set_contains": check_symbol_set_contains,
    "manifest_contains": check_manifest_contains,
    "manifest_position_before": check_manifest_position_before,
    "command_succeeds": check_command_succeeds,
    "command_output_unchanged": check_command_output_unchanged,
    "answer_matches": check_answer_matches,
    "answer_not_matches": check_answer_not_matches,
    "tool_used": check_tool_used,
    "tool_not_used": check_tool_not_used,
    "no_broad_tree_scan": check_no_broad_tree_scan,
    "tool_calls_max": check_tool_calls_max,
    "changelog_entry_shape": check_changelog_entry_shape,
    "locate_before_edit": check_locate_before_edit,
}

# Assertions that additionally need the PREPARED-BASE file text (for
# before/after comparison) are dispatched separately in run_assertions().
_BASE_TEXT_DISPATCH = {
    "version_bumped": check_version_bumped,
    "changelog_entry_added": check_changelog_entry_added,
    "ci_version_gate": check_ci_version_gate,
}


def run_assertions(assertion_specs, run, config=None, base_texts=None):
    """assertion_specs: list of dicts (from a scenario's `assertions:` list).
    base_texts: {path: text at prepared-base SHA} — required for
    version_bumped / changelog_entry_added / ci_version_gate.
    """
    config = config or {}
    base_texts = base_texts or {}
    results = []
    for spec in assertion_specs:
        atype = spec["type"]
        try:
            if atype == "read_before_edit":
                r = check_read_before_edit(spec, run, config)
            elif atype in _BASE_TEXT_DISPATCH:
                base_text = base_texts.get(spec.get("path", "src/parts/part-imports.jsx"))
                r = _BASE_TEXT_DISPATCH[atype](spec, run, base_text)
            elif atype in _SIMPLE_DISPATCH:
                r = _SIMPLE_DISPATCH[atype](spec, run)
            else:
                r = result(atype, spec.get("critical", True), False, f"unknown assertion type: {atype}")
        except Exception as e:  # an assertion crashing is a FAIL, not a harness crash
            r = result(atype, spec.get("critical", True), False, f"assertion raised {type(e).__name__}: {e}")
        results.append(r)

    testable = [r for r in results if not r.get("detail", {}).get("skipped")]
    critical_testable = [r for r in testable if r["critical"]]
    return {
        "passed": sum(1 for r in testable if r["passed"]),
        "total": len(testable),
        "critical_passed": sum(1 for r in critical_testable if r["passed"]),
        "critical_total": len(critical_testable),
        "results": results,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--run-dir")
    ap.add_argument("--scenario")
    ap.add_argument("--scenarios-file", default=str(HARNESS_DIR / "scenarios" / "claude-md.yaml"))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    if not args.run_dir or not args.scenario:
        ap.print_usage(sys.stderr)
        sys.exit(2)

    config = _load_config()
    if yaml is None:
        print("PyYAML required to load scenarios", file=sys.stderr)
        sys.exit(2)
    with open(args.scenarios_file, encoding="utf-8") as f:
        scenarios = yaml.safe_load(f)
    scenario = next((s for s in scenarios if s["id"] == args.scenario), None)
    if scenario is None:
        print(f"scenario not found: {args.scenario}", file=sys.stderr)
        sys.exit(3)

    run = RunData(args.run_dir)
    base_texts = {}
    base_sha_path = Path(args.run_dir) / "prepared-base.sha"
    imports_path = "src/parts/part-imports.jsx"
    if base_sha_path.exists():
        sha = base_sha_path.read_text(encoding="utf-8").strip()
        try:
            cp = subprocess.run(["git", "-C", str(run.worktree_dir), "show", f"{sha}:{imports_path}"],
                                 capture_output=True, text=True, timeout=30)
            if cp.returncode == 0:
                base_texts[imports_path] = cp.stdout
        except Exception:
            pass

    out = run_assertions(scenario.get("assertions", []), run, config, base_texts)
    if args.json:
        print(json.dumps(out, indent=2))
    else:
        print(f"{out['passed']}/{out['total']} assertions passed "
              f"({out['critical_passed']}/{out['critical_total']} critical)")
        for r in out["results"]:
            icon = "PASS" if r["passed"] else "FAIL"
            crit = "*" if r["critical"] else " "
            print(f"  [{icon}]{crit} {r['type']}: {r['evidence']}")

    sys.exit(0 if out["critical_passed"] == out["critical_total"] else 1)


# ── self-test (§14.3) ──────────────────────────────────────────────────

def _mkrun(tmp, events, files_changed=None, final_answer="", diff_patch="", anchors=None, worktree_files=None):
    run_dir = tmp / f"run_{len(list(tmp.iterdir()))}"
    run_dir.mkdir()
    wt = run_dir / "wt"
    wt.mkdir()
    (run_dir / "events.json").write_text(json.dumps(events), encoding="utf-8")
    (run_dir / "files-changed.json").write_text(json.dumps(files_changed or []), encoding="utf-8")
    (run_dir / "final-answer.txt").write_text(final_answer, encoding="utf-8")
    (run_dir / "diff.patch").write_text(diff_patch, encoding="utf-8")
    (run_dir / "anchors.json").write_text(json.dumps(anchors or {}), encoding="utf-8")
    for rel, content in (worktree_files or {}).items():
        p = wt / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
    return RunData(run_dir, wt)


def _ev(index, kind, name=None, input_=None, is_error=False, empty=False, via_subagent=False,
        hook_blocked=False, text=None):
    e = {"index": index, "kind": kind, "name": name, "input": input_ or {},
         "via_subagent": via_subagent, "hook_blocked": hook_blocked}
    if kind == "tool_use":
        e["result"] = {"is_error": is_error, "empty": empty, "bytes": 0 if empty else 100}
    else:
        e["result"] = None
        e["text"] = text or ""
    return e


def _selftest():
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        status = "OK" if cond else "FAIL"
        if not cond:
            ok = False
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))

    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        source_text = "const NO_HISTORY = new Set([\n  'SET_A',\n]);\n" + ("\n" * 10) + "function innerReducer() {}\n"
        anchor_start = 1
        anchor_end = 41  # ±40 window per spec

        # ---- read_before_edit hard invariants (§9.3 step 6) ----

        # (a) self-report fixture: agent CLAIMS a read in text but never calls
        # the tool — must FAIL. Text blocks are never inspected.
        events_selfreport = [
            _ev(0, "text", text="I've read part-reducer.jsx and the NO_HISTORY set."),
            _ev(1, "tool_use", "Edit", {"file_path": "src/parts/part-reducer.jsx"}),
        ]
        run = _mkrun(tmp, events_selfreport, worktree_files={
            "src/parts/part-reducer.jsx": source_text})
        spec = {"type": "read_before_edit", "critical": True,
                "must_read": {"path": "src/parts/part-reducer.jsx",
                               "section": {"anchor_regex": "const NO_HISTORY", "window_lines": 40}},
                "before_edit_to": ["src/parts/part-reducer.jsx"], "ordering": "strict"}
        run.anchors = {"src/parts/part-reducer.jsx": {"const NO_HISTORY": [anchor_start, anchor_end]}}
        r = check_read_before_edit(spec, run, {})
        check("self-report (text-only claim) FAILS read_before_edit", r["passed"] is False, r["evidence"])

        # (b) a consultation whose tool_result.is_error is true must not count
        events_errread = [
            _ev(0, "tool_use", "Read", {"file_path": "src/parts/part-reducer.jsx", "offset": 1, "limit": 40},
                is_error=True),
            _ev(1, "tool_use", "Edit", {"file_path": "src/parts/part-reducer.jsx"}),
        ]
        run2 = _mkrun(tmp, events_errread, worktree_files={"src/parts/part-reducer.jsx": source_text})
        run2.anchors = run.anchors
        r2 = check_read_before_edit(spec, run2, {})
        check("errored Read does not count as consultation", r2["passed"] is False, r2["evidence"])

        # (c) consultation AFTER the first mutation must not satisfy strict ordering
        events_editthenread = [
            _ev(0, "tool_use", "Edit", {"file_path": "src/parts/part-reducer.jsx"}),
            _ev(1, "tool_use", "Read", {"file_path": "src/parts/part-reducer.jsx", "offset": 1, "limit": 40}),
        ]
        run3 = _mkrun(tmp, events_editthenread, worktree_files={"src/parts/part-reducer.jsx": source_text})
        run3.anchors = run.anchors
        r3 = check_read_before_edit(spec, run3, {})
        check("edit-then-read FAILS strict ordering", r3["passed"] is False, r3["evidence"])

        # (d) section_map alone must FAIL read_before_edit
        events_sectionmap = [
            _ev(0, "tool_use", "Bash", {"command": "python3 tools/vela-dev/scripts/partsize.py part-reducer.jsx"}),
            _ev(1, "tool_use", "Edit", {"file_path": "src/parts/part-reducer.jsx"}),
        ]
        run4 = _mkrun(tmp, events_sectionmap, worktree_files={"src/parts/part-reducer.jsx": source_text})
        run4.anchors = run.anchors
        r4 = check_read_before_edit(spec, run4, {})
        check("section_map alone FAILS read_before_edit", r4["passed"] is False, r4["evidence"])
        # but it DOES satisfy the weaker locate_before_edit
        r4b = check_locate_before_edit(
            {"type": "locate_before_edit", "must_read": spec["must_read"],
             "before_edit_to": spec["before_edit_to"]}, run4)
        check("section_map DOES satisfy locate_before_edit", r4b["passed"] is True, r4b["evidence"])

        # (e) hook-blocked Edit is not a mutation, but is recorded in detail
        events_hookblocked = [
            _ev(0, "tool_use", "Grep", {"path": "src/parts/part-reducer.jsx", "pattern": "const NO_HISTORY"}),
            _ev(1, "tool_use", "Edit", {"file_path": "src/parts/part-reducer.jsx"}, is_error=True, hook_blocked=True),
        ]
        # grep's result must be non-error/non-empty to count
        events_hookblocked[0]["result"] = {"is_error": False, "empty": False, "bytes": 50}
        run5 = _mkrun(tmp, events_hookblocked, worktree_files={"src/parts/part-reducer.jsx": source_text})
        run5.anchors = run.anchors
        r5 = check_read_before_edit(spec, run5, {})
        check("hook-blocked Edit is not counted as a mutation (no real mutation -> skipped)",
              r5.get("detail", {}).get("skipped") is True, r5["evidence"])
        check("hook_blocked_before recorded in detail",
              r5.get("detail", {}).get("hook_blocked_before") is True, str(r5.get("detail")))

        # (f) subagent tool calls count, flagged via_subagent
        events_subagent = [
            _ev(0, "tool_use", "Grep", {"path": "src/parts/part-reducer.jsx", "pattern": "const NO_HISTORY"},
                via_subagent=True),
            _ev(1, "tool_use", "Edit", {"file_path": "src/parts/part-reducer.jsx"}),
        ]
        events_subagent[0]["result"] = {"is_error": False, "empty": False, "bytes": 50}
        run6 = _mkrun(tmp, events_subagent, worktree_files={"src/parts/part-reducer.jsx": source_text})
        run6.anchors = run.anchors
        r6 = check_read_before_edit(spec, run6, {})
        check("subagent consultation counts and passes", r6["passed"] is True, r6["evidence"])
        check("via_subagent flagged true in detail", r6.get("detail", {}).get("via_subagent") is True)

        # ---- positive path: grep before edit passes ----
        events_good = [
            _ev(0, "tool_use", "Grep", {"path": "src/parts/part-reducer.jsx", "pattern": "const NO_HISTORY"}),
            _ev(1, "tool_use", "Edit", {"file_path": "src/parts/part-reducer.jsx"}),
        ]
        events_good[0]["result"] = {"is_error": False, "empty": False, "bytes": 50}
        run7 = _mkrun(tmp, events_good, worktree_files={"src/parts/part-reducer.jsx": source_text})
        run7.anchors = run.anchors
        r7 = check_read_before_edit(spec, run7, {})
        check("grep-then-edit PASSES strict ordering", r7["passed"] is True, r7["evidence"])

        # ---- ordering=any with no mutation at all: skipped semantics n/a (uses consultation only) ----
        events_lookup = [
            _ev(0, "tool_use", "Grep", {"path": "src/parts/part-branding.jsx", "pattern": "BrandingOverlay"}),
        ]
        events_lookup[0]["result"] = {"is_error": False, "empty": False, "bytes": 20}
        run8 = _mkrun(tmp, events_lookup, worktree_files={"src/parts/part-branding.jsx": "BrandingOverlay lives here"})
        spec_any = {"type": "read_before_edit", "critical": True,
                    "must_read": {"path": "src/parts/part-branding.jsx"},
                    "before_edit_to": ["src/parts/part-branding.jsx"], "ordering": "any"}
        r8 = check_read_before_edit(spec_any, run8, {})
        check("ordering=any passes on a lookup-only scenario", r8["passed"] is True, r8["evidence"])

        # ---- no-mutation-at-all + strict => skipped, not counted critical ----
        events_nomutation = [_ev(0, "tool_use", "Grep", {"path": "x", "pattern": "y"})]
        events_nomutation[0]["result"] = {"is_error": False, "empty": False, "bytes": 1}
        run9 = _mkrun(tmp, events_nomutation)
        r9 = check_read_before_edit(spec, run9, {})
        check("strict + no mutation at all is skipped (not a hard fail)",
              r9["passed"] is True and r9.get("detail", {}).get("skipped") is True, str(r9))

        # ---- other assertion types: sanity pass/fail pairs ----

        symset_text = 'const NO_HISTORY = new Set([\n  "SET_A",\n  "SET_TOC_FILTER",\n]);\n'
        run10 = _mkrun(tmp, [], worktree_files={"src/parts/part-reducer.jsx": symset_text})
        r10 = check_symbol_set_contains(
            {"type": "symbol_set_contains", "path": "src/parts/part-reducer.jsx",
             "symbol": "NO_HISTORY", "member": "SET_TOC_FILTER"}, run10)
        check("symbol_set_contains passes when member present", r10["passed"] is True, r10["evidence"])
        r10b = check_symbol_set_contains(
            {"type": "symbol_set_contains", "path": "src/parts/part-reducer.jsx",
             "symbol": "NO_HISTORY", "member": "NOT_THERE"}, run10)
        check("symbol_set_contains fails when member absent", r10b["passed"] is False, r10b["evidence"])

        run11 = _mkrun(tmp, [], files_changed=[{"path": "src/parts/part-reducer.jsx"},
                                                {"path": "src/parts/part-imports.jsx"}])
        r11 = check_files_changed_include({"paths": ["src/parts/part-reducer.jsx"], "critical": True}, run11)
        check("files_changed_include passes on a real match", r11["passed"] is True)
        r11b = check_files_changed_exclude({"paths": ["src/parts/part-list.jsx"], "critical": True}, run11)
        check("files_changed_exclude passes when excluded path untouched", r11b["passed"] is True)
        r11c = check_files_changed_exclude({"paths": ["src/parts/part-reducer.jsx"], "critical": True}, run11)
        check("files_changed_exclude fails when excluded path IS touched", r11c["passed"] is False)

        run12 = _mkrun(tmp, [], final_answer="Found it: part-branding.jsx, BrandingOverlay.")
        r12 = check_answer_matches({"pattern": r"part-branding\.jsx", "critical": True}, run12)
        check("answer_matches passes", r12["passed"] is True)
        r12b = check_answer_not_matches({"pattern": r"part-canvas\.jsx", "critical": False}, run12)
        check("answer_not_matches passes when absent", r12b["passed"] is True)

        # version_bumped with an explicit base_text
        run13 = _mkrun(tmp, [], worktree_files={"src/parts/part-imports.jsx": 'const VELA_VERSION = "10.3";'})
        r13 = check_version_bumped({"path": "src/parts/part-imports.jsx", "critical": True}, run13,
                                     'const VELA_VERSION = "10.2";')
        check("version_bumped passes on a real increase", r13["passed"] is True, r13["evidence"])
        r13b = check_version_bumped({"path": "src/parts/part-imports.jsx", "critical": True}, run13,
                                      'const VELA_VERSION = "10.3";')
        check("version_bumped fails when unchanged", r13b["passed"] is False, r13b["evidence"])

        # ---- run_assertions() end-to-end aggregation + evidence-mandatory shape ----
        agg = run_assertions([
            {"type": "symbol_set_contains", "path": "src/parts/part-reducer.jsx",
             "symbol": "NO_HISTORY", "member": "SET_TOC_FILTER", "critical": True},
            {"type": "files_changed_max", "n": 5, "critical": False},
        ], run10)
        check("run_assertions returns evals/validate.py-shaped output",
              set(agg.keys()) >= {"passed", "total", "critical_passed", "critical_total", "results"})
        check("every result carries a non-empty evidence string",
              all(isinstance(r["evidence"], str) and r["evidence"] for r in agg["results"]))
        check("every result carries a critical field",
              all("critical" in r for r in agg["results"]))

    if ok:
        print("assertions.py --selftest: ALL OK")
    else:
        print("assertions.py --selftest: FAILURES ABOVE")
    return ok


if __name__ == "__main__":
    main()
