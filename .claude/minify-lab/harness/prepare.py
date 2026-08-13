#!/usr/bin/env python3
"""
prepare.py — worktree lifecycle + variant injection (harness-design.md §5.2)
and the contamination/confounder controls of §6.

Per (scenario, arm) this module drives:

  1. `git worktree add --detach <wt> <base_ref>`
  2. Scrub the lab from the tree (§6.1): `rm -rf <wt>/.claude/minify-lab`,
     then `assert_lab_scrubbed` — every remaining file under <wt> mentioning
     "minify-lab" must be exactly `.gitignore`, and only on its known
     whitelisted lines. Any other hit aborts.
  3. Apply `hooks_mode` (§6.2): `parity` leaves `<wt>/.claude/settings.json`
     untouched; `neutralized` rewrites it to a hooks-free copy.
  4. Apply the scenario's `setup_patch`, if any — identical in both arms.
  5. Inject the arm's CLAUDE.md variant (`variants/baseline/CLAUDE.md` or
     `variants/<approach>/CLAUDE.md`), after `variant_leak_check` (§6.4)
     against every frozen scenario's `leak_tokens`.
  6. Freeze: `git add -A && git commit -m "prepared base"` -> prepared-base.sha
  7. Parity check (caller, after both arms are prepared): `parity_check()`
     asserts the two prepared trees differ in exactly one path.
  8. Resolve every scenario anchor (`must_read.section.anchor_regex`)
     against the prepared tree -> `anchors.json`.

Also: `preamble_leak_check` (§6.3) — the shared preamble and every scenario
prompt must never mention `config.yaml`'s `preamble_leak_terms` (a scenario
may declare `leak_check_exempt` for terms that are the literal task grant,
not a re-taught procedure — see scenarios/claude-md.yaml's S7 for the one
frozen case and why).

KNOWN FINDING (discovered while building this module, not a bug in it):
`variant_leak_check` run against the REAL repo's `CLAUDE.md` and the frozen
§13 `leak_tokens` lists correctly fires for three scenarios whose probe
token is a PRE-EXISTING repo symbol already named in CLAUDE.md's own routing
table, not a scenario-invented identifier: `routing-lookup` (BrandingOverlay
/ part-branding), `exporter-encoder-reuse` (pptxEsc), and
`docs-only-versionbump` (block-schema). This is exactly the situation §6.4
names as its own resolution ("if the baseline mentions a scenario token, the
scenario is unfair to the minified arm and must be redesigned") — it is a
real property of those three frozen scenarios as specified, verified here
(see `_selftest`'s "known baseline/leak_tokens collision" check) and flagged
for the orchestrator; NOT something this module should silently work around
by editing the frozen scenario data. Until redesigned, those three scenarios
cannot run through `prepare_arm` as-is (`inject_variant`'s leak check will
correctly abort them) — `reducer-nohistory`, `blockfield-safekeys`,
`minimal-diff-temptation`, `security-changelog-discipline`,
`newpart-manifest`, and `public-repo-hygiene` are unaffected.

Post-run (called by runner.py, not this module's CLI):
  9.  `post_run_diff(wt, prepared_base_sha)` -> diff.patch + files-changed.json
  10. (caller runs `command_succeeds` assertions inside the worktree)
  11. `cleanup(wt)` -> `git worktree remove --force`, unless `keep=True`

Usage:
  python3 prepare.py --scenario <id> --arm baseline|minified \
      --run-dir <dir> [--approach telegraphic] [--base-ref HEAD] \
      [--hooks-mode parity|neutralized] [--keep-worktree]
  python3 prepare.py --selftest
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent
REPO_ROOT = HARNESS_DIR.parent.parent.parent  # .claude/minify-lab/harness -> repo root

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


def _load_scenarios(scenarios_file=None):
    if yaml is None:
        raise RuntimeError("PyYAML required")
    path = Path(scenarios_file) if scenarios_file else HARNESS_DIR / "scenarios" / "claude-md.yaml"
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or []


class PrepareError(RuntimeError):
    """Any failure in prepare.py's pipeline — always aborts the campaign for
    this (scenario, arm) pair. Never silently degrades."""


# ── git plumbing ─────────────────────────────────────────────────────────

def _git(args, cwd, check=True):
    cp = subprocess.run(["git"] + args, cwd=str(cwd), capture_output=True, text=True)
    if check and cp.returncode != 0:
        raise PrepareError(f"git {' '.join(args)} failed in {cwd}: {cp.stderr.strip()}")
    return cp


def worktree_add(wt_path, base_ref, repo_root=REPO_ROOT):
    wt_path = Path(wt_path)
    if wt_path.exists():
        raise PrepareError(f"worktree path already exists: {wt_path}")
    wt_path.parent.mkdir(parents=True, exist_ok=True)
    _git(["worktree", "add", "--detach", str(wt_path), base_ref], cwd=repo_root)
    return wt_path


def worktree_remove(wt_path, repo_root=REPO_ROOT, force=True):
    """Best-effort removal — never raises. A prepare.py caller must be able
    to clean up on BOTH the success and the failure path (§14.4)."""
    wt_path = Path(wt_path)
    args = ["worktree", "remove"]
    if force:
        args.append("--force")
    args.append(str(wt_path))
    cp = subprocess.run(["git"] + args, cwd=str(repo_root), capture_output=True, text=True)
    if cp.returncode != 0 and wt_path.exists():
        # worktree metadata may be stale (e.g. dir already gone) — fall back
        # to a raw rmtree plus `worktree prune` so no worktree is ever left
        # registered and lying around.
        shutil.rmtree(wt_path, ignore_errors=True)
        subprocess.run(["git", "worktree", "prune"], cwd=str(repo_root), capture_output=True, text=True)
    return cp.returncode == 0


# ── §6.1 lab self-leak scrub ─────────────────────────────────────────────

LAB_DIR_REL = Path(".claude") / "minify-lab"

# The exact lines .gitignore is allowed to carry (verified against this
# repo's real .gitignore — a mismatch means something else got smuggled
# into that file and the scrub-assert must abort).
GITIGNORE_ALLOWED_LINES = {
    "# minify-lab: WIP research/harness for the /minify project — tracked so",
    "# container reclaim can't wipe it again (see .claude/minify-lab/context.md)",
    "!.claude/minify-lab",
}


def scrub_lab(wt_path):
    shutil.rmtree(Path(wt_path) / LAB_DIR_REL, ignore_errors=True)


def assert_lab_scrubbed(wt_path):
    """§6.1: after scrubbing, no file under <wt> may mention "minify-lab"
    except .gitignore, and only on its whitelisted lines. Raises
    PrepareError on any other hit — this is the single highest-severity
    leak in the design, so it fails closed."""
    wt_path = Path(wt_path)
    if (wt_path / LAB_DIR_REL).exists():
        raise PrepareError(f"lab scrub failed: {LAB_DIR_REL} still present under {wt_path}")

    hits = []
    for p in wt_path.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(wt_path)
        if rel.parts and rel.parts[0] == ".git":
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binary/unreadable — cannot carry the leak as text
        if "minify-lab" in text:
            hits.append((rel, text))

    bad = []
    for rel, text in hits:
        if str(rel) != ".gitignore":
            bad.append(str(rel))
            continue
        offending = [ln for ln in text.splitlines() if "minify-lab" in ln and ln not in GITIGNORE_ALLOWED_LINES]
        if offending:
            bad.append(f".gitignore (unexpected line: {offending[0]!r})")

    if bad:
        raise PrepareError(f"lab self-leak: {bad}")


# ── §6.2 hooks_mode ───────────────────────────────────────────────────────

def apply_hooks_mode(wt_path, mode):
    if mode not in ("parity", "neutralized"):
        raise PrepareError(f"unknown hooks_mode: {mode}")
    if mode == "parity":
        return  # <wt>/.claude/settings.json untouched
    settings_path = Path(wt_path) / ".claude" / "settings.json"
    if not settings_path.exists():
        return
    data = json.loads(settings_path.read_text(encoding="utf-8"))
    data.pop("hooks", None)
    settings_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


# ── setup patches ─────────────────────────────────────────────────────────

def apply_setup_patch(wt_path, patch_path):
    patch_path = Path(patch_path)
    if not patch_path.is_absolute():
        patch_path = HARNESS_DIR / patch_path
    if not patch_path.exists():
        raise PrepareError(f"setup_patch not found: {patch_path}")
    _git(["apply", str(patch_path)], cwd=wt_path)


# ── §6.3 preamble / scenario-prompt leak check ────────────────────────────

def preamble_leak_check(text, terms, exempt=None):
    """Returns the list of terms found in `text` (regex, case-insensitive),
    excluding any in `exempt`. Empty list == pass."""
    exempt = set(exempt or [])
    hits = []
    for term in terms:
        if term in exempt:
            continue
        if re.search(term, text, re.IGNORECASE):
            hits.append(term)
    return hits


# ── §6.4 variant leak check ────────────────────────────────────────────────

def variant_leak_check(variant_text, scenarios):
    """Every variant file (baseline AND minified) is scanned for every
    scenario's leak_tokens[] — not just the scenario about to run, because a
    variant file is written once and reused across the whole campaign.
    Literal substring match (tokens are identifiers, not regex)."""
    hits = []
    for s in scenarios:
        for token in s.get("leak_tokens", []) or []:
            if token in variant_text:
                hits.append((s["id"], token))
    return hits


# ── variant injection ──────────────────────────────────────────────────────

def variant_claude_md_path(arm, approach=None):
    if arm == "baseline":
        return HARNESS_DIR / "variants" / "baseline" / "CLAUDE.md"
    if not approach:
        raise PrepareError("arm != baseline requires --approach")
    return HARNESS_DIR / "variants" / approach / "CLAUDE.md"


def inject_variant(wt_path, arm, approach=None, scenarios=None, skip_leak_check=False):
    src = variant_claude_md_path(arm, approach)
    if not src.exists():
        raise PrepareError(f"variant CLAUDE.md not found: {src}")
    text = src.read_text(encoding="utf-8")
    if not skip_leak_check and scenarios is not None:
        hits = variant_leak_check(text, scenarios)
        if hits:
            raise PrepareError(f"variant_leak_check failed for {src}: {hits}")
    (Path(wt_path) / "CLAUDE.md").write_text(text, encoding="utf-8")


# ── freeze / diff ────────────────────────────────────────────────────────

def freeze(wt_path, message="prepared base"):
    _git(["add", "-A"], cwd=wt_path)
    # nothing to commit is fine (e.g. baseline variant == tracked CLAUDE.md
    # content already) — `git commit --allow-empty` keeps prepared-base.sha
    # meaningful even when the diff against base_ref is empty.
    _git(["commit", "--allow-empty", "-m", message], cwd=wt_path)
    sha = _git(["rev-parse", "HEAD"], cwd=wt_path).stdout.strip()
    return sha


def parity_check(baseline_sha, minified_sha, repo_for_diff=REPO_ROOT):
    """§5.2 step 7, hard gate: the two arms' prepared trees must differ in
    exactly one path (the injected instruction file). Both SHAs live in the
    same underlying object database (worktrees share it), so this can run
    against any checkout of the repo, including the main one."""
    cp = _git(["diff", "--name-only", baseline_sha, minified_sha], cwd=repo_for_diff)
    paths = [ln for ln in cp.stdout.splitlines() if ln]
    if paths != ["CLAUDE.md"]:
        raise PrepareError(f"parity check failed: arms differ in {paths}, expected exactly ['CLAUDE.md']")
    return paths


def post_run_diff(wt_path, prepared_base_sha, out_dir):
    wt_path = Path(wt_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    _git(["add", "-A"], cwd=wt_path)
    diff_cp = _git(["diff", "--cached", prepared_base_sha], cwd=wt_path)
    (out_dir / "diff.patch").write_text(diff_cp.stdout, encoding="utf-8")
    status_cp = _git(["diff", "--cached", "--name-status", prepared_base_sha], cwd=wt_path)
    changed = []
    for line in status_cp.stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        changed.append({"status": parts[0], "path": parts[-1]})
    (out_dir / "files-changed.json").write_text(json.dumps(changed, indent=2), encoding="utf-8")
    return diff_cp.stdout, changed


# ── §9.3 step 1 — anchor resolution ────────────────────────────────────────

def resolve_anchor(wt_path, path, anchor_regex, window_lines=40):
    p = Path(wt_path) / path
    if not p.exists():
        return None
    text = p.read_text(encoding="utf-8", errors="replace")
    m = re.search(anchor_regex, text)
    if not m:
        return None
    line_no = text.count("\n", 0, m.start()) + 1
    start = max(1, line_no - window_lines)
    end = line_no + window_lines
    return [start, end]


def resolve_all_anchors(wt_path, scenarios):
    """Builds anchors.json's shape: {path: {anchor_regex: [start, end]}}.
    Scans both read_before_edit and locate_before_edit assertions across
    ALL scenarios (a run only needs its own scenario's anchors, but writing
    the full set is harmless and keeps this a pure function of the tree)."""
    anchors = {}
    for s in scenarios:
        for spec in s.get("assertions", []):
            if spec.get("type") not in ("read_before_edit", "locate_before_edit"):
                continue
            must_read = spec.get("must_read") or {}
            path = must_read.get("path")
            section = must_read.get("section")
            if not path or not section:
                continue
            anchor_regex = section.get("anchor_regex")
            window_lines = section.get("window_lines", 40)
            if not anchor_regex:
                continue
            resolved = resolve_anchor(wt_path, path, anchor_regex, window_lines)
            if resolved is None:
                continue
            anchors.setdefault(path, {})[anchor_regex] = resolved
    return anchors


def write_anchors(wt_path_or_rundir, anchors, out_dir=None):
    target = Path(out_dir) if out_dir else Path(wt_path_or_rundir)
    target.mkdir(parents=True, exist_ok=True)
    (target / "anchors.json").write_text(json.dumps(anchors, indent=2), encoding="utf-8")


# ── full pipeline for one arm ──────────────────────────────────────────────

def prepare_arm(scenario, arm, run_dir, config=None, approach=None, base_ref=None,
                 hooks_mode=None, repo_root=REPO_ROOT, scenarios_for_leak_check=None):
    """Runs §5.2 steps 1-6 + 8 for ONE arm of ONE scenario. Returns a dict
    with wt (Path), prepared_base_sha (str), anchors (dict). Caller is
    responsible for calling parity_check() across both arms, and cleanup()
    when done (success or failure — see the CLI/selftest for the try/finally
    pattern this requires)."""
    config = config or _load_config()
    base_ref = base_ref or config.get("run", {}).get("base_ref", "HEAD")
    hooks_mode = hooks_mode or config.get("run", {}).get("hooks_mode", "parity")
    scenarios_for_leak_check = scenarios_for_leak_check if scenarios_for_leak_check is not None else [scenario]

    run_dir = Path(run_dir)
    wt = run_dir / "wt"

    worktree_add(wt, base_ref, repo_root=repo_root)

    scrub_lab(wt)
    assert_lab_scrubbed(wt)

    apply_hooks_mode(wt, hooks_mode)

    setup_patch = scenario.get("setup_patch")
    if setup_patch:
        apply_setup_patch(wt, setup_patch)

    preamble_path = HARNESS_DIR / "prompts" / "harness-preamble.md"
    preamble_text = preamble_path.read_text(encoding="utf-8") if preamble_path.exists() else ""
    leak_terms = config.get("preamble_leak_terms", [])
    preamble_hits = preamble_leak_check(preamble_text, leak_terms)
    if preamble_hits:
        raise PrepareError(f"preamble_leak_check failed on harness-preamble.md: {preamble_hits}")
    prompt_hits = preamble_leak_check(
        scenario.get("prompt", ""), leak_terms, exempt=scenario.get("leak_check_exempt")
    )
    if prompt_hits:
        raise PrepareError(f"preamble_leak_check failed on scenario {scenario['id']!r} prompt: {prompt_hits}")

    inject_variant(wt, arm, approach=approach, scenarios=scenarios_for_leak_check)

    prepared_base_sha = freeze(wt)

    anchors = resolve_all_anchors(wt, scenarios_for_leak_check)
    write_anchors(wt, anchors)

    return {"wt": wt, "prepared_base_sha": prepared_base_sha, "anchors": anchors, "hooks_mode": hooks_mode}


def cleanup(wt_path, repo_root=REPO_ROOT, keep=False):
    if keep:
        return
    worktree_remove(wt_path, repo_root=repo_root)


# ── CLI ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--scenario")
    ap.add_argument("--scenarios-file", default=str(HARNESS_DIR / "scenarios" / "claude-md.yaml"))
    ap.add_argument("--arm", choices=["baseline", "minified"])
    ap.add_argument("--approach", default="telegraphic")
    ap.add_argument("--run-dir")
    ap.add_argument("--base-ref", default=None)
    ap.add_argument("--hooks-mode", choices=["parity", "neutralized"], default=None)
    ap.add_argument("--keep-worktree", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        ok = _selftest()
        sys.exit(0 if ok else 1)

    if not args.scenario or not args.arm or not args.run_dir:
        ap.print_usage(sys.stderr)
        sys.exit(2)

    config = _load_config()
    scenarios = _load_scenarios(args.scenarios_file)
    scenario = next((s for s in scenarios if s["id"] == args.scenario), None)
    if scenario is None:
        print(f"scenario not found: {args.scenario}", file=sys.stderr)
        sys.exit(3)

    try:
        result = prepare_arm(
            scenario, args.arm, args.run_dir, config=config,
            approach=args.approach if args.arm != "baseline" else None,
            base_ref=args.base_ref, hooks_mode=args.hooks_mode,
            scenarios_for_leak_check=scenarios,
        )
    except PrepareError as e:
        print(f"PREPARE FAILED: {e}", file=sys.stderr)
        # best-effort cleanup of whatever got created before the failure
        cleanup(Path(args.run_dir) / "wt", keep=args.keep_worktree)
        sys.exit(1)

    if args.json:
        print(json.dumps({"prepared_base_sha": result["prepared_base_sha"], "hooks_mode": result["hooks_mode"],
                           "wt": str(result["wt"])}, indent=2))
    else:
        print(f"prepared {args.scenario} [{args.arm}] at {result['wt']} sha={result['prepared_base_sha'][:12]}")

    if not args.keep_worktree:
        cleanup(result["wt"])


# ── self-test (harness-design.md §14.4) — REAL disposable git worktree ───

def _selftest():
    def check(name, cond, detail=""):
        status = "OK" if cond else "FAIL"
        print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))
        return bool(cond)

    all_ok = True
    config = _load_config()
    scenarios = _load_scenarios()

    # ── pure-function checks (no worktree needed) ──────────────────────
    print("prepare.py self-test — pure-function checks")

    hits = preamble_leak_check("Remember NO_HISTORY and VELA_VERSION.", ["NO_HISTORY", "VELA_VERSION"])
    all_ok &= check("preamble_leak_check fires on a poisoned preamble", set(hits) == {"NO_HISTORY", "VELA_VERSION"})

    hits2 = preamble_leak_check("Add a per-slide heading.", config.get("preamble_leak_terms", []))
    all_ok &= check("preamble_leak_check passes on a clean scenario prompt", hits2 == [])

    exempt_hits = preamble_leak_check("bump VELA_VERSION please", ["VELA_VERSION"], exempt=["VELA_VERSION"])
    all_ok &= check("preamble_leak_check honors leak_check_exempt", exempt_hits == [])

    real_hits = [h for s in scenarios for h in preamble_leak_check(
        s["prompt"], config.get("preamble_leak_terms", []), exempt=s.get("leak_check_exempt")
    )]
    all_ok &= check("all 9 frozen scenario prompts pass the real preamble_leak_terms list",
                     real_hits == [], str(real_hits))

    poisoned_variant = "Some text mentioning SET_TOC_FILTER and tocFilter in prose."
    vhits = variant_leak_check(poisoned_variant, scenarios)
    all_ok &= check("variant_leak_check fires on a poisoned variant",
                     any(t == "SET_TOC_FILTER" for _, t in vhits), str(vhits))

    clean_variant = "This variant file mentions nothing scenario-specific at all."
    vhits2 = variant_leak_check(clean_variant, scenarios)
    all_ok &= check("variant_leak_check passes on a clean variant", vhits2 == [])

    # Known finding (see module docstring): the REAL repo CLAUDE.md already
    # names three scenarios' seam tokens in its own routing table. This
    # proves variant_leak_check correctly detects that real collision — it
    # is expected to fire here, not a self-test bug.
    real_claude_md = (REPO_ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    real_hits2 = set(variant_leak_check(real_claude_md, scenarios))
    expected_collisions = {
        ("routing-lookup", "BrandingOverlay"), ("routing-lookup", "part-branding"),
        ("exporter-encoder-reuse", "pptxEsc"), ("docs-only-versionbump", "block-schema"),
    }
    all_ok &= check(
        "variant_leak_check reproduces the known baseline/leak_tokens collision on the real CLAUDE.md",
        real_hits2 == expected_collisions, str(real_hits2),
    )
    all_ok &= check(
        "the real telegraphic-placeholder fixture has no such collision",
        variant_leak_check((HARNESS_DIR / "variants" / "telegraphic" / "CLAUDE.md").read_text(encoding="utf-8"),
                            scenarios) == [],
    )

    # ── real .gitignore / lab-scrub-assert checks against THIS repo's tree
    # (read-only — no worktree needed for this half) ────────────────────
    gi_text = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")
    gi_lines = [ln for ln in gi_text.splitlines() if "minify-lab" in ln]
    all_ok &= check("this repo's real .gitignore only has whitelisted minify-lab lines",
                     all(ln in GITIGNORE_ALLOWED_LINES for ln in gi_lines), str(gi_lines))

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # poisoned-fixture check for assert_lab_scrubbed, entirely synthetic
        (tmp / "leftover.md").write_text("this file still says minify-lab in prose", encoding="utf-8")
        try:
            assert_lab_scrubbed(tmp)
            all_ok &= check("assert_lab_scrubbed raises on a poisoned fixture", False)
        except PrepareError:
            all_ok &= check("assert_lab_scrubbed raises on a poisoned fixture", True)

        (tmp / "leftover.md").unlink()
        (tmp / ".gitignore").write_text("\n".join(sorted(GITIGNORE_ALLOWED_LINES)) + "\n", encoding="utf-8")
        assert_lab_scrubbed(tmp)  # must not raise
        all_ok &= check("assert_lab_scrubbed passes a clean tree with only the whitelisted .gitignore hit", True)

        (tmp / ".gitignore").write_text("!.claude/minify-lab\n# SET_TOC_FILTER leaked here\n", encoding="utf-8")
        try:
            assert_lab_scrubbed(tmp)
            all_ok &= check("assert_lab_scrubbed raises on an unexpected .gitignore line", False)
        except PrepareError:
            all_ok &= check("assert_lab_scrubbed raises on an unexpected .gitignore line", True)

        # apply_hooks_mode: neutralized strips hooks, keeps everything else
        claude_dir = tmp / ".claude"
        claude_dir.mkdir()
        (claude_dir / "settings.json").write_text(json.dumps({"enabledPlugins": {"x": True}, "hooks": {"PreToolUse": []}}), encoding="utf-8")
        apply_hooks_mode(tmp, "parity")
        after_parity = json.loads((claude_dir / "settings.json").read_text())
        all_ok &= check("hooks_mode=parity leaves settings.json untouched", "hooks" in after_parity)
        apply_hooks_mode(tmp, "neutralized")
        after_neutral = json.loads((claude_dir / "settings.json").read_text())
        all_ok &= check("hooks_mode=neutralized strips hooks but keeps other keys",
                         "hooks" not in after_neutral and after_neutral.get("enabledPlugins") == {"x": True})

        # resolve_anchor against a synthetic fixture file
        fixture = tmp / "fixture.jsx"
        fixture.write_text("\n".join([f"line{i}" for i in range(1, 30)] + ["const NO_HISTORY = new Set([])"] +
                                      [f"line{i}" for i in range(31, 60)]), encoding="utf-8")
        anchor = resolve_anchor(tmp, "fixture.jsx", "const NO_HISTORY", window_lines=5)
        all_ok &= check("resolve_anchor finds the right window", anchor == [25, 35], str(anchor))

        missing = resolve_anchor(tmp, "fixture.jsx", "NOT_PRESENT_ANYWHERE", window_lines=5)
        all_ok &= check("resolve_anchor returns None for a missing anchor", missing is None)

    # ── REAL disposable git worktree against this repo (§14.4) ─────────
    print("prepare.py self-test — real git worktree (created + removed here)")
    run_root = Path(tempfile.mkdtemp(prefix="minify-lab-selftest-"))
    wt_baseline = run_root / "baseline" / "wt"
    wt_minified = run_root / "minified" / "wt"
    try:
        baseline_variant_ok = (HARNESS_DIR / "variants" / "baseline" / "CLAUDE.md").exists()
        minified_variant_ok = (HARNESS_DIR / "variants" / "telegraphic" / "CLAUDE.md").exists()
        all_ok &= check("variants/baseline/CLAUDE.md exists", baseline_variant_ok)
        all_ok &= check("variants/telegraphic/CLAUDE.md exists", minified_variant_ok)
        if not (baseline_variant_ok and minified_variant_ok):
            raise PrepareError("variant fixtures missing — skipping worktree pipeline checks")

        s1 = next(s for s in scenarios if s["id"] == "reducer-nohistory")

        base_result = prepare_arm(s1, "baseline", run_root / "baseline", config=config,
                                   scenarios_for_leak_check=scenarios)
        all_ok &= check(".claude/minify-lab is gone from the prepared baseline worktree",
                         not (base_result["wt"] / ".claude" / "minify-lab").exists())

        min_result = prepare_arm(s1, "minified", run_root / "minified", config=config, approach="telegraphic",
                                  scenarios_for_leak_check=scenarios)
        all_ok &= check(".claude/minify-lab is gone from the prepared minified worktree",
                         not (min_result["wt"] / ".claude" / "minify-lab").exists())

        diff_paths = parity_check(base_result["prepared_base_sha"], min_result["prepared_base_sha"])
        all_ok &= check("prepared arms differ in exactly one path (CLAUDE.md)", diff_paths == ["CLAUDE.md"], str(diff_paths))

        anchor = base_result["anchors"].get("src/parts/part-reducer.jsx", {}).get("const NO_HISTORY")
        real_text = (REPO_ROOT / "src/parts/part-reducer.jsx").read_text(encoding="utf-8")
        m = re.search("const NO_HISTORY", real_text)
        expected_line = real_text.count("\n", 0, m.start()) + 1
        all_ok &= check(
            "anchors.json resolves 'const NO_HISTORY' to the right line",
            anchor is not None and anchor[0] <= expected_line <= anchor[1],
            f"anchor={anchor} expected_line={expected_line}",
        )
        all_ok &= check("anchors.json was written to disk in the worktree",
                         (base_result["wt"] / "anchors.json").exists())

        # post_run_diff on an untouched prepared tree -> empty diff, empty file list
        diff_text, changed = post_run_diff(base_result["wt"], base_result["prepared_base_sha"], run_root / "baseline")
        all_ok &= check("post_run_diff on an untouched tree yields no changes", diff_text == "" and changed == [])

        # simulate an agent edit, then re-diff
        (base_result["wt"] / "PR-TITLE.txt").write_text("test\n", encoding="utf-8")
        diff_text2, changed2 = post_run_diff(base_result["wt"], base_result["prepared_base_sha"], run_root / "baseline")
        all_ok &= check("post_run_diff picks up a real post-freeze edit",
                         any(c["path"] == "PR-TITLE.txt" for c in changed2), str(changed2))

        cleanup(base_result["wt"])
        all_ok &= check("cleanup() removes the baseline worktree directory", not base_result["wt"].exists())
        cleanup(min_result["wt"])
        all_ok &= check("cleanup() removes the minified worktree directory", not min_result["wt"].exists())

        cp = subprocess.run(["git", "worktree", "list"], cwd=str(REPO_ROOT), capture_output=True, text=True)
        all_ok &= check("no self-test worktree left registered in `git worktree list`",
                         str(base_result["wt"]) not in cp.stdout and str(min_result["wt"]) not in cp.stdout,
                         cp.stdout)

    finally:
        # cleanup-on-failure path (§14.4): whatever got created above, force
        # it gone even if an assertion raised mid-pipeline.
        for wt in (wt_baseline, wt_minified):
            if wt.exists():
                worktree_remove(wt)
        subprocess.run(["git", "worktree", "prune"], cwd=str(REPO_ROOT), capture_output=True, text=True)
        shutil.rmtree(run_root, ignore_errors=True)
        all_ok &= check("cleanup ran on the failure path too (temp run_root removed)", not run_root.exists())

    # confirm no worktree survives even on a mid-pipeline PrepareError
    run_root2 = Path(tempfile.mkdtemp(prefix="minify-lab-selftest-fail-"))
    try:
        broken_scenario = {"id": "broken-" + uuid.uuid4().hex[:8], "prompt": "x", "assertions": [],
                            "setup_patch": "setup-patches/does-not-exist.patch", "leak_tokens": []}
        try:
            prepare_arm(broken_scenario, "baseline", run_root2, config=config, scenarios_for_leak_check=scenarios)
            all_ok &= check("prepare_arm raises PrepareError on a missing setup_patch", False)
        except PrepareError:
            all_ok &= check("prepare_arm raises PrepareError on a missing setup_patch", True)
        finally:
            wt = run_root2 / "wt"
            if wt.exists():
                worktree_remove(wt)
        all_ok &= check("worktree from the failed prepare_arm() was cleaned up", not (run_root2 / "wt").exists())
    finally:
        subprocess.run(["git", "worktree", "prune"], cwd=str(REPO_ROOT), capture_output=True, text=True)
        shutil.rmtree(run_root2, ignore_errors=True)

    print("prepare.py --selftest:", "ALL OK" if all_ok else "FAILURES ABOVE")
    return all_ok


if __name__ == "__main__":
    main()
