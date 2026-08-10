#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela Dep-Sweep — the deterministic half of a dependency bump.

Answers the questions that have one right answer and no judgement in them:

  • Which manifests exist, and is anything unmonitored by Dependabot?
  • For each dependency, which upgrade targets have cleared the cooldown tier
    in .github/dependabot.yml (measured against the TARGET version's own
    release date, which is how Dependabot measures it)?
  • Does every SHA-pinned GitHub Action still match the tag its comment claims?
  • Does each candidate version carry npm provenance, and does it trace to the
    package's real upstream repo?
  • Did the publisher identity change between the installed and candidate
    version? (a takeover signal)
  • Does the candidate newly introduce an install lifecycle hook?
  • Do package-lock.json and pnpm-lock.yaml still agree?

It deliberately does NOT decide anything. Cooldown eligibility is not the same
as "should we take it" — picking between the newest eligible version and the
last patch of an older line, judging a major, spending the security exemption,
or reading release notes against our own usage all stay with a human (or an
agent) reading this report. See the `dependency-sweep` skill.

Usage:
  python3 dep-sweep.py                      # full report, human-readable
  python3 dep-sweep.py --json               # machine-readable, for an agent
  python3 dep-sweep.py --offline            # skip every network call
  python3 dep-sweep.py --base <git-ref>     # also diff lockfiles vs a ref
  python3 dep-sweep.py --only actions,npm   # run a subset of checks

Exit codes: 0 = nothing needs attention, 1 = findings present,
            2 = usage error, 4 = a verification FAILED (bad pin / parity break).
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_USAGE = 2
EXIT_VERIFY_FAILED = 4

ROOT = Path(__file__).resolve().parents[3]
NPM_REGISTRY = "https://registry.npmjs.org"
ATTESTATION_URL = NPM_REGISTRY + "/-/npm/v1/attestations"
SLSA_PREDICATE = "https://slsa.dev/provenance/v1"

# Cache registry documents for the life of one run — a sweep asks about the
# same package from several checks and these documents are large.
_DOC_CACHE: dict[str, dict | None] = {}
NOW = datetime.now(timezone.utc)


# ── HTTP (stdlib only — repo policy is zero external Python deps) ─────

def _fetch_json(url: str, timeout: int = 60) -> dict | None:
    """
    GET a JSON document.

    Returns the document, `{}` for HTTP 404 (the endpoint answered and the data
    genuinely does not exist — e.g. a package version with no attestations), or
    `None` for a FAILED fetch (network down, timeout, garbage). Callers that
    make comparative judgements must treat None as "unknown", never as
    "absent": inventing a provenance regression out of a transient network
    error would page someone over nothing, and the mirror case would wave a
    real regression through during an outage.
    """
    if url in _DOC_CACHE:
        return _DOC_CACHE[url]
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            doc = json.load(resp)
    except urllib.error.HTTPError as e:
        doc = {} if e.code == 404 else None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        doc = None
    _DOC_CACHE[url] = doc
    return doc


def _pkg_url(name: str, version: str = "") -> str:
    # Scoped names must be escaped; the registry wants %2f, not a path split.
    esc = name.replace("/", "%2f")
    return f"{NPM_REGISTRY}/{esc}" + (f"/{version}" if version else "")


# ── Semver + cooldown ────────────────────────────────────────────────

SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)")


def parse_semver(v: str) -> tuple[int, int, int] | None:
    m = SEMVER_RE.match(v.strip())
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def is_prerelease(v: str) -> bool:
    return "-" in v


def update_type(old: str, new: str) -> str:
    """Classify old->new the way Dependabot's cooldown tiers do."""
    a, b = parse_semver(old), parse_semver(new)
    if not a or not b:
        return "unknown"
    if b[0] != a[0]:
        return "major"
    if b[1] != a[1]:
        return "minor"
    if b[2] != a[2]:
        return "patch"
    return "none"


def age_days(iso: str) -> int | None:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return (NOW - dt).days


def load_cooldown() -> dict[str, dict[str, int]]:
    """
    Read the cooldown tiers straight out of .github/dependabot.yml so this
    script can never drift from the policy it is enforcing.

    Deliberately a narrow line-scanner rather than a YAML parse: PyYAML is not
    stdlib, and the block we need is a flat set of `key: int` lines.
    """
    path = ROOT / ".github" / "dependabot.yml"
    default = {"default": 7, "major": 30, "minor": 14, "patch": 7}
    if not path.exists():
        return {"*": default}
    # Keyed by "<ecosystem>@<directory>", one entry per update block. The
    # config has THREE separate npm blocks (/, channel, vela-neutralino);
    # collapsing them into one "npm" entry would mean last-parsed-wins the
    # moment any directory's policy diverges from the others. (Assumes
    # `directory:` precedes `cooldown:` within a block, as dependabot's
    # documented layout and this repo's config both do.)
    per_block: dict[str, dict[str, int]] = {}
    eco = None
    directory = "/"
    in_cooldown = False
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        m = re.search(r"package-ecosystem:\s*[\"']?([\w-]+)", line)
        if m:
            eco, directory, in_cooldown = m.group(1), "/", False
            continue
        m = re.search(r"^\s+directory:\s*[\"']?([^\"'\s]+)", line)
        if m and eco and not in_cooldown:
            directory = m.group(1)
            # Start EMPTY, not from the global default. A block that only
            # declares `default-days` (as github-actions does) must fall back
            # to that single number for every update type — seeding the semver
            # tiers would invent a 30-day major window the config never set.
            per_block.setdefault(f"{eco}@{directory}", {})
            continue
        if re.search(r"^\s*cooldown:\s*$", line):
            in_cooldown = True
            continue
        if in_cooldown:
            m = re.search(r"^\s+(default|semver-major|semver-minor|semver-patch)-days:\s*(\d+)", line)
            if m and eco:
                key = m.group(1).replace("semver-", "")
                per_block.setdefault(f"{eco}@{directory}", {})[key] = int(m.group(2))
            elif re.match(r"^\s{0,4}\S", line):
                in_cooldown = False
    per_block.setdefault("*", default)
    return per_block


def tiers_for(all_tiers: dict[str, dict[str, int]], eco: str, directory: str = "/") -> dict[str, int]:
    """
    The cooldown tiers governing one manifest.

    Exact block first. A manifest with no block of its own (which the coverage
    check reports separately) falls back to the STRICTEST value per tier across
    that ecosystem's blocks — a cooldown is a floor, so when the config is
    ambiguous the safe reading is the longest wait, never the shortest.
    """
    exact = all_tiers.get(f"{eco}@{directory}")
    if exact:
        return exact
    same_eco = [v for k, v in all_tiers.items() if k.startswith(f"{eco}@") and v]
    if same_eco:
        merged: dict[str, int] = {}
        for block in same_eco:
            for k, v in block.items():
                merged[k] = max(merged.get(k, 0), v)
        return merged
    return all_tiers.get("*", {"default": 7})


def required_days(tiers: dict[str, int], utype: str) -> int:
    return tiers.get(utype, tiers.get("default", 7))


# ── Manifest discovery ───────────────────────────────────────────────

SKIP_DIRS = {"node_modules", ".git", "dist", "bin", "archive", "coverage-analysis", "evals", "decks"}


def discover_manifests() -> list[dict]:
    """Every file in the repo that declares a dependency, and who watches it."""
    found: list[dict] = []
    patterns = {
        "package.json": "npm",
        "requirements-test.txt": "pip",
        "go.mod": "gomod",
        "Dockerfile": "docker",
    }
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        eco = patterns.get(path.name)
        if path.name.startswith("requirements") and path.suffix == ".txt":
            eco = "pip"
        if not eco:
            continue
        rel = path.relative_to(ROOT)
        found.append({
            "path": str(rel),
            "ecosystem": eco,
            "directory": "/" + str(rel.parent) if str(rel.parent) != "." else "/",
        })
    # Workflows using third-party actions are a dependency surface too —
    # dependabot's `github-actions` ecosystem watches them at directory "/".
    # Without this entry, deleting that block from dependabot.yml would pass
    # the coverage check silently.
    wf_dir = ROOT / ".github" / "workflows"
    if wf_dir.is_dir() and any(
        "uses:" in p.read_text() for p in wf_dir.glob("*.yml")
    ):
        found.append({
            "path": ".github/workflows",
            "ecosystem": "actions",
            "directory": "/",
        })
    return sorted(found, key=lambda f: f["path"])


def dependabot_coverage() -> set[tuple[str, str]]:
    """(ecosystem, directory) pairs Dependabot is configured to watch."""
    path = ROOT / ".github" / "dependabot.yml"
    if not path.exists():
        return set()
    pairs, eco = set(), None
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0]
        m = re.search(r"package-ecosystem:\s*[\"']?([\w-]+)", line)
        if m:
            eco = m.group(1)
        m = re.search(r"directory:\s*[\"']([^\"']+)", line)
        if m and eco:
            pairs.add((eco, m.group(1)))
    return pairs


def check_coverage() -> list[dict]:
    watched = dependabot_coverage()
    findings = []
    for man in discover_manifests():
        eco = man["ecosystem"]
        if eco == "gomod":
            continue  # stdlib-only module; nothing for a bot to bump
        key = ("github-actions" if eco == "actions" else eco, man["directory"])
        if key not in watched:
            findings.append({
                "manifest": man["path"],
                "ecosystem": eco,
                "directory": man["directory"],
                "issue": "no Dependabot config watches this manifest",
            })
    return findings


# ── GitHub Actions pins ──────────────────────────────────────────────

USES_RE = re.compile(r"uses:\s*([\w.\-/]+)@([0-9a-f]{40})\s*#\s*(\S+)")
USES_ANY_RE = re.compile(r"uses:\s*(\S+)")


def _git_ls_remote_tags(repo: str) -> dict[str, str]:
    """Tag -> commit SHA for a public repo, without needing an API token."""
    url = f"https://github.com/{repo}"
    try:
        out = subprocess.run(
            ["git", "ls-remote", "--tags", url],
            capture_output=True, text=True, timeout=120, check=False,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return {}
    tags: dict[str, str] = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) != 2:
            continue
        sha, ref = parts[0].strip(), parts[1].strip()
        name = ref[len("refs/tags/"):]
        if name.endswith("^{}"):          # peeled annotated tag — authoritative
            tags[name[:-3]] = sha
        else:
            tags.setdefault(name, sha)
    return tags


TAG_RE = re.compile(r"^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$")


def parse_tag(tag: str) -> tuple[int, int, int] | None:
    """`v7`, `v7.0`, `v7.0.1` -> a comparable triple. Anything else -> None."""
    m = TAG_RE.match(tag.strip())
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2) or 0), int(m.group(3) or 0))


def _clone_cache(repo: str) -> Path | None:
    """
    Blobless bare mirror of an action repo, cached for the run.

    `git ls-remote` gives tag->SHA but not dates, and we need a release date to
    do cooldown arithmetic. A blobless bare clone fetches metadata only (fast,
    no working tree) and works without an API token, which matters because
    api.github.com is not always reachable from a build box.
    """
    cache = Path(os.environ.get("TMPDIR", "/tmp")) / "vela-dep-sweep-cache"
    cache.mkdir(parents=True, exist_ok=True)
    dest = cache / (repo.replace("/", "__") + ".git")
    try:
        if dest.exists():
            # A cached clone is frozen at whatever tags existed when it was
            # made — reusing it without a fetch would report "on the newest
            # release" against a stale tag list, and would clear an EOL Go
            # line that a new release just created. Refresh, and if the fetch
            # fails treat the cache as unusable rather than silently stale.
            r = subprocess.run(
                ["git", "-C", str(dest), "fetch", "--quiet", "--tags", "--force", "origin"],
                capture_output=True, text=True, timeout=120, check=False,
            )
            return dest if r.returncode == 0 else None
        r = subprocess.run(
            ["git", "clone", "--quiet", "--bare", "--filter=blob:none",
             f"https://github.com/{repo}", str(dest)],
            capture_output=True, text=True, timeout=180, check=False,
        )
        return dest if r.returncode == 0 else None
    except (subprocess.SubprocessError, OSError):
        return None


def action_upgrades(repo: str, current_tag: str, tiers: dict[str, int]) -> list[dict]:
    """
    Newer release tags for a pinned action, with cooldown eligibility.

    Verifying that a pin matches its tag says nothing about whether that tag is
    still the one you want — an action can sit correctly pinned to a version
    that upstream has since superseded for security reasons. This closes that
    blind spot.
    """
    cur = parse_tag(current_tag)
    repo_dir = _clone_cache(repo)
    if not cur or repo_dir is None:
        return []
    try:
        out = subprocess.run(
            ["git", "-C", str(repo_dir), "for-each-ref",
             "--format=%(refname:short)|%(creatordate:short)", "refs/tags"],
            capture_output=True, text=True, timeout=120, check=False,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return []
    rows = []
    for line in out.splitlines():
        if "|" not in line:
            continue
        tag, date = line.split("|", 1)
        sv = parse_tag(tag)
        if not sv or sv <= cur:
            continue
        age = age_days(date + "T00:00:00+00:00")
        if age is None:
            continue
        utype = ("major" if sv[0] != cur[0] else "minor" if sv[1] != cur[1] else "patch")
        need = required_days(tiers, utype)
        rows.append({
            "tag": tag, "released": date, "age_days": age,
            "update_type": utype, "required_days": need,
            "cooldown_ok": age >= need,
        })
    rows.sort(key=lambda r: parse_tag(r["tag"]) or (0, 0, 0))
    return rows


def check_actions(offline: bool = False) -> tuple[list[dict], list[dict]]:
    """Verify every pin matches its claimed tag. Returns (findings, verified)."""
    findings: list[dict] = []
    verified: list[dict] = []
    wf_dir = ROOT / ".github"
    if not wf_dir.exists():
        return findings, verified

    pins: set[tuple[str, str, str]] = set()
    for path in list(wf_dir.rglob("*.yml")) + list(wf_dir.rglob("*.yaml")):
        text = path.read_text()
        for line in text.splitlines():
            m_any = USES_ANY_RE.search(line)
            if not m_any:
                continue
            ref = m_any.group(1)
            if ref.startswith("./"):        # local reusable workflow
                continue
            m = USES_RE.search(line)
            if not m:
                findings.append({
                    "check": "actions",
                    "severity": "high",
                    "file": str(path.relative_to(ROOT)),
                    "action": ref,
                    "issue": "not pinned to a full 40-char commit SHA with a # vN comment",
                })
                continue
            pins.add((m.group(1), m.group(2), m.group(3)))

    if offline:
        return findings, verified

    for repo, sha, tag in sorted(pins):
        tags = _git_ls_remote_tags(repo)
        if not tags:
            findings.append({
                "check": "actions", "severity": "info", "action": repo,
                "issue": "could not reach upstream to verify the pin",
            })
            continue
        expected = tags.get(tag)
        if expected is None:
            findings.append({
                "check": "actions", "severity": "high", "action": repo, "tag": tag,
                "issue": f"comment claims {tag} but no such tag exists upstream",
            })
        elif expected != sha:
            findings.append({
                "check": "actions", "severity": "critical", "action": repo, "tag": tag,
                "issue": f"pin {sha[:12]} does NOT match upstream {tag} ({expected[:12]})",
            })
        else:
            verified.append({"action": repo, "tag": tag, "sha": sha})
    return findings, verified


def check_action_upgrades(tiers: dict[str, int], verified: list[dict]) -> list[dict]:
    """Eligible newer tags for each correctly-pinned action."""
    rows = []
    for pin in verified:
        ups = action_upgrades(pin["action"], pin["tag"], tiers)
        elig = [r for r in ups if r["cooldown_ok"]]
        if not elig:
            continue
        rows.append({
            "action": pin["action"], "current": pin["tag"],
            "newest_eligible": elig[-1],
            "blocked_by_cooldown": [r for r in ups if not r["cooldown_ok"]],
        })
    return rows


# ── npm: candidate upgrades + cooldown eligibility ───────────────────

def npm_release_dates(name: str) -> dict[str, str]:
    doc = _fetch_json(_pkg_url(name))
    return (doc or {}).get("time", {}) or {}


def candidates(name: str, current: str, tiers: dict[str, int]) -> list[dict]:
    """Every published version newer than `current`, with eligibility."""
    times = npm_release_dates(name)
    cur = parse_semver(current)
    if not cur:
        return []
    rows = []
    for ver, iso in times.items():
        if ver in ("created", "modified") or is_prerelease(ver):
            continue
        sv = parse_semver(ver)
        if not sv or sv <= cur:
            continue
        utype = update_type(current, ver)
        need = required_days(tiers, utype)
        age = age_days(iso)
        if age is None:
            continue
        rows.append({
            "version": ver, "released": iso[:10], "age_days": age,
            "update_type": utype, "required_days": need,
            "cooldown_ok": age >= need,
        })
    rows.sort(key=lambda r: parse_semver(r["version"]) or (0, 0, 0))
    return rows


def newest_eligible(rows: list[dict]) -> dict | None:
    ok = [r for r in rows if r["cooldown_ok"]]
    return ok[-1] if ok else None


# ── Provenance, publisher identity, install hooks ────────────────────

def provenance(name: str, version: str) -> dict:
    """
    SLSA provenance for one version: present? built from which repo?

    `fetched` distinguishes "the registry answered" (including a 404 — this
    version simply has no attestations) from "the request failed". Comparative
    checks must not treat a failed fetch as evidence of anything.
    """
    esc = name.replace("/", "%2f")
    doc = _fetch_json(f"{ATTESTATION_URL}/{esc}@{version}")
    out = {"has_provenance": False, "source_repo": None, "source_workflow": None,
           "fetched": doc is not None}
    for att in (doc or {}).get("attestations", []) or []:
        if att.get("predicateType") != SLSA_PREDICATE:
            continue
        payload = ((att.get("bundle") or {}).get("dsseEnvelope") or {}).get("payload")
        if not payload:
            continue
        try:
            stmt = json.loads(base64.b64decode(payload))
        except (ValueError, json.JSONDecodeError):
            continue
        ext = ((stmt.get("predicate") or {}).get("buildDefinition") or {}).get("externalParameters") or {}
        wf = ext.get("workflow") or {}
        out.update({
            "has_provenance": True,
            "source_repo": wf.get("repository"),
            "source_workflow": wf.get("path"),
        })
    return out


LIFECYCLE = ("preinstall", "install", "postinstall", "prepare", "prepublish")


def version_facts(name: str, version: str) -> dict:
    doc = _fetch_json(_pkg_url(name, version))
    fetched = doc is not None
    doc = doc or {}
    scripts = doc.get("scripts") or {}
    repo = doc.get("repository")
    repo_url = repo.get("url") if isinstance(repo, dict) else repo
    return {
        "publisher": ((doc.get("_npmUser") or {}).get("name")),
        "hooks": sorted(k for k in scripts if k in LIFECYCLE),
        "declared_repo": repo_url,
        "deps": sorted((doc.get("dependencies") or {}).keys()),
        "fetched": fetched,
    }


def _repo_slug(url: str | None) -> str | None:
    if not url:
        return None
    m = re.search(r"github\.com[:/]+([\w.\-]+/[\w.\-]+?)(?:\.git)?/?$", url.strip())
    return m.group(1).lower() if m else None


def vet_candidate(name: str, current: str, target: str) -> dict:
    """
    The supply-chain diligence a human would otherwise do by hand for one bump.
    Every signal here is comparative: what matters is not that a package lacks
    provenance, but that it lost provenance it used to have, or changed hands.
    """
    cur_f, new_f = version_facts(name, current), version_facts(name, target)
    cur_p, new_p = provenance(name, current), provenance(name, target)

    flags = []
    # Every comparative signal needs BOTH sides actually fetched. A failed
    # request is not evidence: flagging a "regression" because the candidate's
    # attestation lookup timed out fabricates a critical out of thin air, and
    # the mirror case (current side failed) would hide a real one. Say
    # "unknown" and let the human decide whether to retry.
    prov_known = cur_p["fetched"] and new_p["fetched"]
    facts_known = cur_f["fetched"] and new_f["fetched"]
    if not (prov_known and facts_known):
        flags.append(("info", "supply-chain vetting INCOMPLETE — registry fetch failed; "
                              "re-run before trusting this candidate"))
    if prov_known and cur_p["has_provenance"] and not new_p["has_provenance"]:
        flags.append(("critical", "provenance REGRESSION: had SLSA provenance, candidate does not"))
    if new_p["has_provenance"]:
        claimed = _repo_slug(new_f.get("declared_repo"))
        built = _repo_slug(new_p.get("source_repo"))
        if claimed and built and claimed != built:
            flags.append(("critical", f"provenance source {built} != declared repo {claimed}"))
    if facts_known:
        if cur_f["publisher"] and new_f["publisher"] and cur_f["publisher"] != new_f["publisher"]:
            sev = "info" if new_f["publisher"] in ("GitHub Actions",) else "warn"
            flags.append((sev, f"publisher changed: {cur_f['publisher']} -> {new_f['publisher']}"))
        gained = sorted(set(new_f["hooks"]) - set(cur_f["hooks"]))
        if gained:
            flags.append(("warn", f"introduces install lifecycle hook(s): {', '.join(gained)}"))
    new_deps = sorted(set(new_f["deps"]) - set(cur_f["deps"])) if facts_known else []
    if new_deps:
        flags.append(("warn", f"adds new runtime dependencies: {', '.join(new_deps)}"))

    return {
        "package": name, "from": current, "to": target,
        "provenance": new_p, "publisher": new_f["publisher"],
        "hooks": new_f["hooks"], "new_deps": new_deps,
        "flags": [{"severity": s, "detail": d} for s, d in flags],
    }


# ── Lockfile diffing + parity ────────────────────────────────────────

def npm_lock_pairs(text: str) -> set[tuple[str, str]]:
    pkgs = json.loads(text).get("packages", {})
    return {
        (k.split("node_modules/")[-1], v["version"])
        for k, v in pkgs.items() if k and "version" in v
    }


PNPM_PKG_RE = re.compile(r"^  '?([@\w./-]+)'?@([0-9][^:@]*?)'?:$", re.M)


def pnpm_lock_pairs(text: str) -> set[tuple[str, str]]:
    return {(m.group(1), m.group(2).rstrip("'")) for m in PNPM_PKG_RE.finditer(text)}


def _git_show(ref: str, rel: str) -> str | None:
    r = subprocess.run(["git", "show", f"{ref}:{rel}"],
                       capture_output=True, text=True, cwd=ROOT, check=False)
    return r.stdout if r.returncode == 0 else None


def check_new_packages(base: str) -> list[dict]:
    """Names that appear in a lockfile now but did not at `base`."""
    findings = []
    targets = [
        ("package-lock.json", npm_lock_pairs),
        ("pnpm-lock.yaml", pnpm_lock_pairs),
        ("tools/vela-dev/channel/pnpm-lock.yaml", pnpm_lock_pairs),
    ]
    for rel, parser in targets:
        now_path = ROOT / rel
        old_text = _git_show(base, rel)
        if not now_path.exists() or old_text is None:
            continue
        try:
            before, after = parser(old_text), parser(now_path.read_text())
        except (json.JSONDecodeError, ValueError):
            continue
        new_names = sorted({n for n, _ in after} - {n for n, _ in before})
        if new_names:
            findings.append({
                "check": "new-packages", "severity": "warn", "lockfile": rel,
                "new_packages": new_names,
                "issue": f"{len(new_names)} package name(s) new since {base} — each needs vetting",
            })
    return findings


def latest_go_minors(offline: bool = False) -> list[tuple[int, int]]:
    """
    The Go minor versions still receiving security fixes.

    Go supports the two most recent majors, so the support window is derived
    rather than hardcoded — a static EOL table goes stale silently, which is
    the exact failure mode this check exists to catch. Falls back to returning
    nothing (check skipped) rather than guessing.
    """
    if offline:
        return []
    dest = _clone_cache("golang/go")
    if dest is None:
        return []
    try:
        out = subprocess.run(
            ["git", "-C", str(dest), "for-each-ref", "--format=%(refname:short)", "refs/tags/go*"],
            capture_output=True, text=True, timeout=120, check=False,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return []
    minors = set()
    for tag in out.splitlines():
        m = re.match(r"^go(\d+)\.(\d+)(?:\.\d+)?$", tag.strip())
        if m:
            minors.add((int(m.group(1)), int(m.group(2))))
    return sorted(minors)[-2:] if len(minors) >= 2 else []


def go_toolchain_pins() -> dict[str, tuple[int, int]]:
    """
    Every place a Go toolchain version is pinned, source -> (major, minor).

    The workflow `go-version:` fields and the Dockerfile `golang:` base image
    are what actually COMPILE the shipped gatekeeper, so they are the
    authoritative pins. go.mod's `go` directive is only a language-version
    floor — reported separately, because an EOL floor merely *permits* an
    unpatched compiler while an EOL pin *guarantees* one.
    """
    pins: dict[str, tuple[int, int]] = {}
    wf_dir = ROOT / ".github" / "workflows"
    if wf_dir.is_dir():
        for path in sorted(wf_dir.glob("*.yml")):
            for m in re.finditer(r"go-version:\s*[\"']?(\d+)\.(\d+)", path.read_text()):
                pins[f".github/workflows/{path.name}"] = (int(m.group(1)), int(m.group(2)))
    dockerfile = ROOT / "vela-neutralino" / "Dockerfile"
    if dockerfile.exists():
        m = re.search(r"FROM\s+golang:(\d+)\.(\d+)", dockerfile.read_text())
        if m:
            pins["vela-neutralino/Dockerfile"] = (int(m.group(1)), int(m.group(2)))
    return pins


def check_go_toolchain(offline: bool = False) -> list[dict]:
    """
    The toolchain pins that build the agent gatekeeper, plus go.mod's floor.

    A stdlib-only module has no dependencies for a bot to bump, so nothing else
    in this sweep — or in Dependabot — will ever notice that the compiler
    producing a security-critical binary went end-of-life.
    """
    supported = latest_go_minors(offline)
    if not supported:
        return []
    oldest, newest = min(supported), supported[-1]
    window = ", ".join(f"{a}.{b}" for a, b in supported)
    findings: list[dict] = []

    pins = go_toolchain_pins()
    eol_pins = {src: v for src, v in pins.items() if v < oldest}
    if eol_pins:
        detail = ", ".join(f"{src} pins {a}.{b}" for src, (a, b) in sorted(eol_pins.items()))
        findings.append({
            "check": "go-toolchain", "severity": "high",
            "issue": (
                f"Go toolchain pin(s) past end of life ({detail}; Go supports "
                f"{window}). The gatekeeper binary is a security boundary — move "
                f"every workflow `go-version:` and the Dockerfile base image "
                f"together, e.g. to {newest[0]}.{newest[1]}."
            ),
        })
    elif len(set(pins.values())) > 1:
        detail = ", ".join(f"{src}={a}.{b}" for src, (a, b) in sorted(pins.items()))
        findings.append({
            "check": "go-toolchain", "severity": "warn",
            "issue": f"Go toolchain pins disagree ({detail}) — CI, copilot and the "
                     f"Docker build should compile with the same toolchain.",
        })

    gomod = ROOT / "vela-neutralino" / "extensions" / "agent" / "go.mod"
    if gomod.exists():
        m = re.search(r"^go\s+(\d+)\.(\d+)", gomod.read_text(), re.M)
        if m and (int(m.group(1)), int(m.group(2))) < oldest:
            findings.append({
                "check": "go-toolchain", "severity": "warn",
                "issue": (
                    f"go.mod's floor (go {m.group(1)}.{m.group(2)}) is below the supported "
                    f"window ({window}) — it still builds fine with a current toolchain, "
                    f"but raise it at the next touch so an EOL compiler cannot satisfy it."
                ),
            })
    return findings


def _run(cmd: list[str], cwd: Path) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd,
                           timeout=300, check=False)
        # pnpm writes its structured error document ({"error": {...}}) to
        # stderr; surface it so parse_audit can classify the failure instead
        # of reporting an empty result.
        return p.returncode, p.stdout if p.stdout.strip() else p.stderr
    except (subprocess.SubprocessError, OSError, FileNotFoundError):
        return -1, ""


# Only these buckets are advisory severities. npm v7+ also puts a "total" key
# inside metadata.vulnerabilities — summing every int key double-counts.
AUDIT_SEVERITIES = ("low", "moderate", "high", "critical")


def parse_audit(label: str, output: str) -> dict | None:
    """
    Turn one `npm audit --json` / `pnpm audit --json` document into a finding,
    or None when the tree is clean. Kept separate from process execution so it
    is testable without a node_modules tree or a network.

    Handles both report shapes: pnpm's legacy `advisories` map, and npm v7+'s
    per-package `vulnerabilities` map (npm dropped `advisories` in v7).
    """
    if not output.strip():
        return {"check": "audit", "severity": "info", "tree": label,
                "issue": "audit produced no output (offline registry?)"}
    try:
        doc = json.loads(output)
    except json.JSONDecodeError:
        return {"check": "audit", "severity": "info", "tree": label,
                "issue": "audit output was not JSON"}

    err = doc.get("error")
    if isinstance(err, dict):
        if err.get("code") == "ERR_PNPM_AUDIT_NO_LOCKFILE":
            return {"check": "audit", "severity": "info", "tree": label,
                    "issue": "no lockfile — audit unavailable for this tree; "
                             "its dependencies are NOT covered by any audit"}
        return {"check": "audit", "severity": "info", "tree": label,
                "issue": f"audit failed: {err.get('code') or err.get('message') or 'unknown error'}"}

    counts = (doc.get("metadata") or {}).get("vulnerabilities") or {}
    total = sum(int(counts.get(k) or 0) for k in AUDIT_SEVERITIES)
    if not total:
        return None
    worst = "critical" if counts.get("critical") else ("high" if counts.get("high") else "warn")
    detail = ", ".join(f"{k}: {counts[k]}" for k in AUDIT_SEVERITIES if counts.get(k))
    modules = {
        (a.get("module_name"), a.get("severity"))
        for a in (doc.get("advisories") or {}).values()          # pnpm shape
    }
    vulns = doc.get("vulnerabilities")
    if isinstance(vulns, dict):                                   # npm v7+ shape
        for name, v in vulns.items():
            if isinstance(v, dict):
                modules.add((v.get("name") or name, v.get("severity")))
    return {
        "check": "audit", "severity": worst, "tree": label,
        "issue": f"{total} advisory finding(s) — {detail}",
        "modules": sorted(f"{m} ({s})" for m, s in modules if m),
    }


AUDIT_TREES = [
    ("root", "", ["npm", "audit", "--json"]),
    ("channel", "tools/vela-dev/channel", ["pnpm", "audit", "--json"]),
    # --ignore-workspace is load-bearing: without it pnpm walks up to the repo
    # root's pnpm-workspace.yaml and audits the ROOT tree, then reports that
    # result under this tree's name. This directory has no committed lockfile,
    # so the flag makes pnpm say so honestly (ERR_PNPM_AUDIT_NO_LOCKFILE,
    # surfaced as an info finding) instead of auditing the wrong tree.
    ("vela-neutralino", "vela-neutralino", ["pnpm", "audit", "--ignore-workspace", "--json"]),
]


def check_audits() -> list[dict]:
    """
    Run each tree's native audit. This is the check that actually finds live
    advisories — cooldown and provenance say nothing about a package that was
    always vulnerable, and transitive dependencies never appear in the direct
    upgrade table above.
    """
    findings: list[dict] = []
    for label, rel, cmd in AUDIT_TREES:
        cwd = ROOT / rel if rel else ROOT
        if not cwd.exists():
            continue
        if not (cwd / "node_modules").exists():
            findings.append({
                "check": "audit", "severity": "info", "tree": label,
                "issue": "not installed — run the install first for an accurate audit",
            })
            continue
        _, out = _run(cmd, cwd)
        f = parse_audit(label, out)
        if f:
            findings.append(f)
    return findings


def check_parity() -> list[dict]:
    npm_path, pnpm_path = ROOT / "package-lock.json", ROOT / "pnpm-lock.yaml"
    if not (npm_path.exists() and pnpm_path.exists()):
        return []
    a = npm_lock_pairs(npm_path.read_text())
    b = pnpm_lock_pairs(pnpm_path.read_text())
    only_npm, only_pnpm = sorted(a - b), sorted(b - a)
    if not only_npm and not only_pnpm:
        return []
    return [{
        "check": "parity", "severity": "high",
        "issue": "package-lock.json and pnpm-lock.yaml resolve different versions",
        "only_in_npm": [f"{n}@{v}" for n, v in only_npm],
        "only_in_pnpm": [f"{n}@{v}" for n, v in only_pnpm],
    }]


# ── Report assembly ──────────────────────────────────────────────────

PNPM_IMPORTER_RE = re.compile(
    r"^\s{6}'?([@\w./-]+)'?:\s*\n\s+specifier:.*\n\s+version:\s*([0-9][^\s(]*)", re.M
)


def _locked_versions_for(manifest_rel: str) -> dict[str, str]:
    """
    Resolved versions for ONE manifest, from ITS OWN lockfile.

    Reading the root package-lock for every manifest was a real bug: a package
    absent from the root lock silently fell back to the manifest's declared
    MINIMUM (`^4.0.0` -> `4.0.0`) rather than what is actually installed
    (`4.22.3`). That inflates the apparent jump and — the part that actually
    bites — can classify the update into the wrong cooldown tier.
    """
    d = Path(manifest_rel).parent
    locked: dict[str, str] = {}

    npm_lock = ROOT / d / "package-lock.json"
    if npm_lock.exists():
        try:
            pkgs = json.loads(npm_lock.read_text()).get("packages", {})
            # Only the TOP-LEVEL entry (`node_modules/<name>`, no nesting) is
            # the version a direct dependency resolves to. Iterating the whole
            # package set was nondeterministic: a package with a nested
            # duplicate (whatwg-url 17.1.0 top-level vs 16.0.1 under
            # data-urls) picked whichever the set yielded first, which
            # randomised "current" — and therefore the cooldown tier.
            for key, v in pkgs.items():
                if key.startswith("node_modules/") and key.count("node_modules/") == 1 \
                        and "version" in v:
                    locked[key[len("node_modules/"):]] = v["version"]
        except (json.JSONDecodeError, ValueError, AttributeError):
            pass

    pnpm_lock = ROOT / d / "pnpm-lock.yaml"
    if pnpm_lock.exists():
        # The `importers:` block maps DIRECT deps to the exact version resolved
        # for this project. setdefault, NOT assignment: where both lockfiles
        # exist and disagree, package-lock.json wins because `npm ci` is what
        # CI actually installs. (The disagreement itself is reported separately
        # by check_parity as a high-severity finding — it must not also silently
        # change which version we call "current".)
        for m in PNPM_IMPORTER_RE.finditer(pnpm_lock.read_text()):
            locked.setdefault(m.group(1), m.group(2))
    return locked


def direct_npm_deps() -> list[tuple[str, str, str, bool]]:
    """(manifest, package, current-version, resolved-from-lockfile?)"""
    out = []
    for rel in ("package.json", "tools/vela-dev/channel/package.json",
                "vela-neutralino/package.json"):
        path = ROOT / rel
        if not path.exists():
            continue
        try:
            doc = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        locked = _locked_versions_for(rel)
        for field in ("dependencies", "devDependencies"):
            for name, spec in (doc.get(field) or {}).items():
                exact = locked.get(name)
                current = exact or re.sub(r"^[\^~>=<\s]*", "", str(spec))
                if parse_semver(current):
                    out.append((rel, name, current, exact is not None))
    return out


VALID_CHECKS = ("coverage", "actions", "npm", "go", "parity", "audit", "new-packages")


def run(args: argparse.Namespace) -> dict:
    all_tiers = load_cooldown()
    report: dict = {
        "generated_utc": NOW.isoformat(timespec="seconds"),
        "cooldown_tiers": all_tiers,
        "findings": [],
        "upgrades": [],
        "verified_pins": [],
        "manifests": [],
    }
    only = set(args.only.split(",")) if args.only else None

    def want(check: str) -> bool:
        return only is None or check in only

    if want("coverage"):
        report["manifests"] = discover_manifests()
        for f in check_coverage():
            report["findings"].append({"check": "coverage", "severity": "warn", **f})

    if want("actions"):
        f, v = check_actions(offline=args.offline)
        report["findings"].extend(f)
        report["verified_pins"] = v

    if want("parity"):
        report["findings"].extend(check_parity())

    if want("audit") and not args.offline:
        report["findings"].extend(check_audits())

    if args.base and want("new-packages"):
        report["findings"].extend(check_new_packages(args.base))

    if want("actions") and not args.offline and args.upgrades:
        report["action_upgrades"] = check_action_upgrades(
            tiers_for(all_tiers, "github-actions", "/"),
            report.get("verified_pins", []),
        )

    if want("go") and not args.offline:
        report["findings"].extend(check_go_toolchain(args.offline))

    if want("npm") and not args.offline:
        for manifest, name, current, from_lock in direct_npm_deps():
            # Tiers resolve per manifest directory — three separate npm blocks
            # exist in dependabot.yml, and their policies may diverge.
            mdir = str(Path(manifest).parent)
            mdir = "/" if mdir == "." else "/" + mdir
            rows = candidates(name, current, tiers_for(all_tiers, "npm", mdir))
            if not rows:
                continue
            elig = newest_eligible(rows)
            blocked = [r for r in rows if not r["cooldown_ok"]]
            entry = {
                "manifest": manifest, "package": name, "current": current,
                # Flags a "current" inferred from the manifest's declared floor
                # rather than read from a lockfile — treat those jumps as
                # approximate until the tree is installed.
                "current_from_lockfile": from_lock,
                "newest_eligible": elig,
                "blocked_by_cooldown": [
                    {k: r[k] for k in ("version", "age_days", "required_days", "update_type")}
                    for r in blocked
                ],
                # A version superseded by a patch we cannot take yet is exactly
                # the case a human must rule on, so surface it rather than hide it.
                "note": None,
            }
            if elig and blocked:
                newer_same_minor = [
                    r for r in blocked
                    if parse_semver(r["version"])[:2] == parse_semver(elig["version"])[:2]
                ]
                if newer_same_minor:
                    entry["note"] = (
                        f"{elig['version']} is eligible but already superseded by "
                        f"{newer_same_minor[-1]['version']} (still in cooldown) — judgement call"
                    )
            if elig and args.vet:
                entry["vetting"] = vet_candidate(name, current, elig["version"])
                for fl in entry["vetting"]["flags"]:
                    if fl["severity"] in ("critical", "warn"):
                        report["findings"].append({
                            "check": "supply-chain", "severity": fl["severity"],
                            "package": f"{name} {current} -> {elig['version']}",
                            "issue": fl["detail"],
                        })
            report["upgrades"].append(entry)

    return report


SEV_ORDER = {"critical": 0, "high": 1, "warn": 2, "info": 3}


def render(report: dict) -> str:
    L: list[str] = []
    L.append("# Vela dependency sweep")
    L.append(f"_generated {report['generated_utc']}_\n")

    findings = sorted(report["findings"], key=lambda f: SEV_ORDER.get(f.get("severity", "info"), 9))
    crit = [f for f in findings if f.get("severity") in ("critical", "high")]

    L.append("## Findings")
    if not findings:
        L.append("Nothing needs attention.\n")
    else:
        for f in findings:
            sev = f.get("severity", "info").upper()
            who = f.get("package") or f.get("action") or f.get("manifest") or f.get("lockfile") or f.get("check")
            L.append(f"- **{sev}** · `{who}` — {f['issue']}")
        L.append("")

    if report.get("verified_pins"):
        L.append(f"## Action pins — {len(report['verified_pins'])} verified against upstream tags")
        for p in report["verified_pins"]:
            L.append(f"- `{p['action']}` {p['tag']} · `{p['sha'][:12]}`")
        # A pin can be perfectly valid and still point at a superseded release,
        # so never let "all verified" read as "all current".
        if "action_upgrades" not in report:
            L.append("")
            L.append("> Verified means each pin matches the tag it claims — **not** that the "
                     "tag is still current. Re-run with `--upgrades` to check for newer releases.")
        L.append("")

    if report.get("action_upgrades"):
        L.append("## Action upgrades available (cooldown cleared)")
        L.append("| action | current | eligible target | type | age |")
        L.append("|---|---|---|---|---|")
        for a in report["action_upgrades"]:
            e = a["newest_eligible"]
            L.append(f"| `{a['action']}` | {a['current']} | **{e['tag']}** | "
                     f"{e['update_type']} | {e['age_days']}d |")
        L.append("")
    elif "action_upgrades" in report:
        L.append("## Action upgrades available (cooldown cleared)")
        L.append("None — every pinned action is on its newest cooldown-cleared release.\n")

    ups = [u for u in report.get("upgrades", []) if u.get("newest_eligible")]
    L.append("## Upgrade candidates that have cleared cooldown")
    if not ups:
        L.append("None — everything is either current or still inside its cooldown window.\n")
    else:
        L.append("| package | current | eligible target | type | age | note |")
        L.append("|---|---|---|---|---|---|")
        for u in ups:
            e = u["newest_eligible"]
            L.append(
                f"| `{u['package']}` | {u['current']} | **{e['version']}** | "
                f"{e['update_type']} | {e['age_days']}d | {u.get('note') or ''} |"
            )
        L.append("")

    blocked = [u for u in report.get("upgrades", []) if u.get("blocked_by_cooldown")]
    if blocked:
        L.append("## Held back by cooldown (do not take without a security justification)")
        for u in blocked:
            names = ", ".join(
                f"{b['version']} ({b['age_days']}d/{b['required_days']}d)"
                for b in u["blocked_by_cooldown"][-3:]
            )
            L.append(f"- `{u['package']}` — {names}")
        L.append("")

    L.append("## What this report does NOT decide")
    L.append(
        "Cooldown eligibility is not a recommendation. Choosing between the newest "
        "eligible version and the last patch of an older line, judging a major, "
        "spending the security exemption, and reading release notes against this "
        "repo's actual usage all still need a human or an agent."
    )
    if crit:
        L.append(f"\n**{len(crit)} finding(s) at high/critical severity — read those first.**")
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="dep-sweep",
        description="Deterministic dependency-bump reconnaissance for Vela.",
    )
    ap.add_argument("--json", action="store_true", help="emit the raw report as JSON")
    ap.add_argument("--offline", action="store_true", help="skip every network call")
    ap.add_argument("--base", metavar="GIT_REF", help="diff lockfiles against this ref to find new packages")
    ap.add_argument("--only", metavar="CHECKS", help="comma-separated subset: coverage,actions,npm,go,parity,audit,new-packages")
    ap.add_argument("--upgrades", action="store_true",
                    help="also scan for newer GitHub Action tags (clones action repos; adds ~15s)")
    ap.add_argument("--vet", action="store_true",
                    help="also run supply-chain vetting (provenance, publisher, hooks) on each eligible target")
    ap.add_argument("--out", metavar="FILE", help="write the report to a file as well as stdout")
    ap.add_argument("--json-out", metavar="FILE", dest="json_out",
                    help="also write the raw JSON report here, whatever --out's format is "
                         "(so one run can produce both without re-querying the registry)")
    args = ap.parse_args(argv)

    if args.only:
        # A typo'd check name must not run zero checks and then print
        # "Nothing needs attention" with exit 0 — the skill reads that as a
        # passed gate, which turns a misspelling into a silent skip.
        unknown = sorted(set(args.only.split(",")) - set(VALID_CHECKS))
        if unknown:
            print(f"dep-sweep: unknown check(s) in --only: {', '.join(unknown)}\n"
                  f"           valid: {', '.join(VALID_CHECKS)}", file=sys.stderr)
            return EXIT_USAGE

    try:
        report = run(args)
    except KeyboardInterrupt:
        return EXIT_USAGE

    text = json.dumps(report, indent=2) if args.json else render(report)
    print(text)
    if args.out:
        Path(args.out).write_text(text + "\n")
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2) + "\n")

    hard = [f for f in report["findings"] if f.get("severity") in ("critical", "high")]
    if hard:
        return EXIT_VERIFY_FAILED
    return EXIT_FINDINGS if report["findings"] else EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
