#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Unit tests for tools/vela-dev/scripts/dep-sweep.py.

Everything here runs OFFLINE. The registry-facing functions are exercised
through injected fixtures, so this suite is deterministic and safe in CI:
a dependency sweep that only works when npmjs.org is reachable is not a
guard, and a test that depends on live version numbers rots within a week.

Run:  python3 -m unittest tests.test_dep_sweep -v
"""

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "vela-dev" / "scripts" / "dep-sweep.py"


def _load():
    spec = importlib.util.spec_from_file_location("dep_sweep", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ds = _load()


class TestSemver(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(ds.parse_semver("1.62.1"), (1, 62, 1))
        self.assertEqual(ds.parse_semver("10.4.0"), (10, 4, 0))
        self.assertIsNone(ds.parse_semver("not-a-version"))

    def test_prerelease_detected(self):
        self.assertTrue(ds.is_prerelease("1.62.0-alpha-2026-07-22"))
        self.assertFalse(ds.is_prerelease("1.62.0"))

    def test_update_type(self):
        self.assertEqual(ds.update_type("1.60.0", "1.62.1"), "minor")
        self.assertEqual(ds.update_type("7.29.7", "7.29.8"), "patch")
        self.assertEqual(ds.update_type("1.19.14", "2.0.12"), "major")
        self.assertEqual(ds.update_type("1.0.0", "1.0.0"), "none")

    def test_update_type_is_measured_from_the_installed_version(self):
        # The tier depends on the whole jump, not the last hop. 1.60.0 -> 1.62.1
        # is a MINOR update even though .1 looks like a patch on 1.62.0 — this
        # is the rule that decides whether a 14-day or 7-day window applies.
        self.assertEqual(ds.update_type("1.60.0", "1.62.0"), "minor")
        self.assertEqual(ds.update_type("1.62.0", "1.62.1"), "patch")


class TestCooldownTiers(unittest.TestCase):
    def test_required_days_falls_back_to_default(self):
        # github-actions declares only `default-days`, so every update type
        # must resolve to it. Seeding semver tiers would invent policy.
        tiers = {"default": 7}
        for utype in ("patch", "minor", "major"):
            self.assertEqual(ds.required_days(tiers, utype), 7)

    def test_required_days_uses_explicit_tier(self):
        tiers = {"default": 7, "major": 30, "minor": 14, "patch": 7}
        self.assertEqual(ds.required_days(tiers, "major"), 30)
        self.assertEqual(ds.required_days(tiers, "minor"), 14)
        self.assertEqual(ds.required_days(tiers, "patch"), 7)

    def test_parses_this_repo_config_per_block(self):
        # One entry PER dependabot block. Collapsing the three npm blocks into
        # a single "npm" key was last-parsed-wins the moment any directory's
        # policy diverged from the others.
        tiers = ds.load_cooldown()
        for key in ("npm@/", "npm@/tools/vela-dev/channel",
                    "npm@/vela-neutralino", "pip@/tests",
                    "docker@/vela-neutralino", "github-actions@/"):
            self.assertIn(key, tiers, key)
        self.assertEqual(ds.required_days(tiers["npm@/"], "minor"), 14)
        self.assertEqual(ds.required_days(tiers["npm@/"], "major"), 30)
        # Actions intentionally run a single flat window.
        self.assertEqual(ds.required_days(tiers["github-actions@/"], "major"), 7)

    def test_tiers_for_prefers_the_exact_block(self):
        all_t = {"npm@/": {"default": 7, "minor": 14},
                 "npm@/sub": {"default": 3, "minor": 5},
                 "*": {"default": 7}}
        self.assertEqual(ds.tiers_for(all_t, "npm", "/sub"), {"default": 3, "minor": 5})

    def test_tiers_for_unwatched_dir_takes_the_strictest_same_eco_values(self):
        # A manifest with no block of its own must not inherit the LOOSEST
        # policy — a cooldown is a floor, so ambiguity resolves to the longest
        # wait per tier.
        all_t = {"npm@/": {"default": 7, "minor": 14},
                 "npm@/other": {"default": 10, "minor": 5},
                 "*": {"default": 7}}
        merged = ds.tiers_for(all_t, "npm", "/nowhere")
        self.assertEqual(merged, {"default": 10, "minor": 14})

    def test_tiers_for_unknown_eco_falls_back_to_global_default(self):
        self.assertEqual(ds.tiers_for({"*": {"default": 9}}, "cargo", "/"),
                         {"default": 9})


class TestEligibility(unittest.TestCase):
    def setUp(self):
        self._orig = ds.npm_release_dates

    def tearDown(self):
        ds.npm_release_dates = self._orig

    def _with_dates(self, mapping):
        ds.npm_release_dates = lambda name: mapping

    def _iso(self, days_ago):
        from datetime import timedelta
        return (ds.NOW - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")

    def test_blocks_a_version_inside_its_tier(self):
        # Reproduces the playwright call: 1.62.1 is a MINOR jump from 1.60.0
        # and only 10 days old, so a 14-day tier must exclude it.
        self._with_dates({
            "1.61.1": self._iso(47),
            "1.62.0": self._iso(16),
            "1.62.1": self._iso(10),
        })
        tiers = {"default": 7, "major": 30, "minor": 14, "patch": 7}
        rows = ds.candidates("playwright", "1.60.0", tiers)
        by_ver = {r["version"]: r for r in rows}
        self.assertTrue(by_ver["1.61.1"]["cooldown_ok"])
        self.assertTrue(by_ver["1.62.0"]["cooldown_ok"])
        self.assertFalse(by_ver["1.62.1"]["cooldown_ok"])
        self.assertEqual(ds.newest_eligible(rows)["version"], "1.62.0")

    def test_prereleases_are_never_candidates(self):
        self._with_dates({
            "1.62.0": self._iso(40),
            "1.63.0-alpha-2026-08-05": self._iso(40),
        })
        rows = ds.candidates("playwright", "1.61.0", {"default": 7})
        self.assertEqual([r["version"] for r in rows], ["1.62.0"])

    def test_nothing_eligible_returns_none(self):
        self._with_dates({"2.0.0": self._iso(1)})
        rows = ds.candidates("x", "1.0.0", {"default": 7, "major": 30})
        self.assertIsNone(ds.newest_eligible(rows))

    def test_ignores_registry_bookkeeping_keys(self):
        self._with_dates({"created": self._iso(999), "modified": self._iso(1),
                          "1.1.0": self._iso(30)})
        rows = ds.candidates("x", "1.0.0", {"default": 7})
        self.assertEqual([r["version"] for r in rows], ["1.1.0"])


class TestLockfileParsing(unittest.TestCase):
    def test_npm_pairs_include_nested_copies(self):
        lock = json.dumps({"packages": {
            "": {"name": "root"},
            "node_modules/whatwg-url": {"version": "17.1.0"},
            "node_modules/data-urls/node_modules/whatwg-url": {"version": "16.0.1"},
        }})
        self.assertEqual(
            ds.npm_lock_pairs(lock),
            {("whatwg-url", "17.1.0"), ("whatwg-url", "16.0.1")},
        )

    def test_pnpm_pairs(self):
        lock = "packages:\n\n  hono@4.12.34:\n    resolution: {integrity: sha512-x}\n\n  '@hono/node-server@2.0.12':\n    resolution: {integrity: sha512-y}\n"
        self.assertEqual(
            ds.pnpm_lock_pairs(lock),
            {("hono", "4.12.34"), ("@hono/node-server", "2.0.12")},
        )

    def test_parity_check_is_quiet_when_trees_agree(self):
        # Guard against a parity check that silently passes because it parsed
        # nothing — both parsers must find the same non-empty set.
        npm = ds.npm_lock_pairs((ROOT / "package-lock.json").read_text())
        pnpm = ds.pnpm_lock_pairs((ROOT / "pnpm-lock.yaml").read_text())
        self.assertGreater(len(npm), 10)
        self.assertGreater(len(pnpm), 10)
        self.assertEqual(ds.check_parity(), [])


class TestTagParsing(unittest.TestCase):
    def test_accepts_partial_tags(self):
        # Actions are pinned with comments like `# v1` and `# v4` as often as
        # full triples; those must still compare against a newer `v4.1.1`.
        self.assertEqual(ds.parse_tag("v1"), (1, 0, 0))
        self.assertEqual(ds.parse_tag("v6.0"), (6, 0, 0))
        self.assertEqual(ds.parse_tag("v7.0.1"), (7, 0, 1))
        self.assertEqual(ds.parse_tag("4.2.0"), (4, 2, 0))

    def test_rejects_non_release_tags(self):
        for tag in ("v6-beta", "predicate@2.0.0", "nightly", "latest"):
            self.assertIsNone(ds.parse_tag(tag), tag)

    def test_ordering_makes_v1_older_than_v4(self):
        self.assertLess(ds.parse_tag("v1"), ds.parse_tag("v4.1.1"))


class TestLockedVersionResolution(unittest.TestCase):
    """
    Regression tests for a real bug: reading the ROOT package-lock for every
    manifest made a package absent from it fall back to the manifest's declared
    MINIMUM, which both inflates the apparent jump and can select the wrong
    cooldown tier.
    """

    def test_channel_current_is_the_resolved_version_not_the_caret_floor(self):
        locked = ds._locked_versions_for("tools/vela-dev/channel/package.json")
        self.assertIn("tsx", locked, "tsx must resolve from the channel's own pnpm-lock")
        # The channel has no package-lock.json, so before the fix this package
        # was invisible and fell through to the manifest floor.
        self.assertIsNotNone(ds.parse_semver(locked["tsx"]))
        importers = ds.PNPM_IMPORTER_RE.findall(
            (ROOT / "tools/vela-dev/channel/pnpm-lock.yaml").read_text())
        self.assertIn(("tsx", locked["tsx"]), importers)

    def test_npm_lock_wins_over_pnpm_when_they_disagree(self):
        # CI installs via `npm ci`, so package-lock.json is authoritative for
        # "what is currently installed". A stale pnpm-lock must not override it
        # — that would silently restate the parity break as a different current.
        npm_pairs = dict(ds.npm_lock_pairs((ROOT / "package-lock.json").read_text()))
        resolved = ds._locked_versions_for("package.json")
        for name in ("playwright", "lucide-react", "@babel/standalone"):
            if name in npm_pairs:
                self.assertEqual(resolved.get(name), npm_pairs[name],
                                 f"{name} must come from package-lock.json")

    def test_duplicate_nested_copy_never_randomises_current(self):
        # whatwg-url exists twice in the root lock (17.1.0 top-level, 16.0.1
        # nested under data-urls). Iterating the unordered pair-set made
        # "current" nondeterministic across runs — and the cooldown tier with
        # it. Only the top-level entry is a direct dep's resolution.
        for _ in range(20):
            locked = ds._locked_versions_for("package.json")
            self.assertEqual(locked.get("whatwg-url"), "17.1.0")

    def test_flags_when_current_is_only_a_manifest_floor(self):
        # vela-neutralino has no lockfile, so its versions are inferred. The
        # report must say so rather than present a guess as a fact.
        rows = [r for r in ds.direct_npm_deps() if r[0] == "vela-neutralino/package.json"]
        if rows:
            self.assertFalse(rows[0][3], "expected current_from_lockfile=False with no lockfile")


class TestActionPins(unittest.TestCase):
    def test_regex_accepts_a_sha_pin_with_version_comment(self):
        line = "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1"
        m = ds.USES_RE.search(line)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(1), "actions/checkout")
        self.assertEqual(m.group(3), "v7.0.1")

    def test_regex_rejects_a_floating_tag(self):
        self.assertIsNone(ds.USES_RE.search("      - uses: actions/checkout@v4"))

    def test_every_pin_in_this_repo_is_sha_pinned(self):
        findings, _ = ds.check_actions(offline=True)
        unpinned = [f for f in findings if "not pinned" in f["issue"]]
        self.assertEqual(unpinned, [], f"unpinned actions found: {unpinned}")


class TestRepoSlug(unittest.TestCase):
    def test_normalises_git_urls(self):
        for url in ("git+https://github.com/uuidjs/uuid.git",
                    "https://github.com/uuidjs/uuid",
                    "git+ssh://git@github.com/uuidjs/uuid.git"):
            self.assertEqual(ds._repo_slug(url), "uuidjs/uuid")

    def test_none_for_junk(self):
        self.assertIsNone(ds._repo_slug(None))
        self.assertIsNone(ds._repo_slug("not a url"))


class TestVetting(unittest.TestCase):
    """The comparative supply-chain signals — the actual hijack detectors."""

    def setUp(self):
        self._vf, self._pv = ds.version_facts, ds.provenance

    def tearDown(self):
        ds.version_facts, ds.provenance = self._vf, self._pv

    def _inject(self, facts, prov):
        ds.version_facts = lambda n, v: facts[v]
        ds.provenance = lambda n, v: prov[v]

    def test_flags_provenance_regression(self):
        self._inject(
            {"1.0.0": {"publisher": "a", "hooks": [], "declared_repo": None, "deps": [], "fetched": True},
             "2.0.0": {"publisher": "a", "hooks": [], "declared_repo": None, "deps": [], "fetched": True}},
            {"1.0.0": {"has_provenance": True, "source_repo": "https://github.com/o/r", "fetched": True},
             "2.0.0": {"has_provenance": False, "source_repo": None, "fetched": True}},
        )
        flags = ds.vet_candidate("p", "1.0.0", "2.0.0")["flags"]
        self.assertTrue(any(f["severity"] == "critical" and "REGRESSION" in f["detail"] for f in flags))

    def test_flags_provenance_built_from_a_foreign_repo(self):
        self._inject(
            {"1.0.0": {"publisher": "a", "hooks": [], "declared_repo": "https://github.com/real/pkg", "deps": [], "fetched": True},
             "2.0.0": {"publisher": "a", "hooks": [], "declared_repo": "https://github.com/real/pkg", "deps": [], "fetched": True}},
            {"1.0.0": {"has_provenance": False, "source_repo": None, "fetched": True},
             "2.0.0": {"has_provenance": True, "source_repo": "https://github.com/attacker/pkg", "fetched": True}},
        )
        flags = ds.vet_candidate("p", "1.0.0", "2.0.0")["flags"]
        self.assertTrue(any(f["severity"] == "critical" and "!=" in f["detail"] for f in flags))

    def test_publisher_change_to_ci_is_only_informational(self):
        # uuid 8.3.2 -> 14.0.1 moved from a human to GitHub Actions. That is a
        # posture IMPROVEMENT and must not be reported as a takeover.
        self._inject(
            {"8.3.2": {"publisher": "ctavan", "hooks": [], "declared_repo": None, "deps": [], "fetched": True},
             "14.0.1": {"publisher": "GitHub Actions", "hooks": [], "declared_repo": None, "deps": [], "fetched": True}},
            {"8.3.2": {"has_provenance": False, "source_repo": None, "fetched": True},
             "14.0.1": {"has_provenance": True, "source_repo": "https://github.com/uuidjs/uuid", "fetched": True}},
        )
        flags = ds.vet_candidate("uuid", "8.3.2", "14.0.1")["flags"]
        pub = [f for f in flags if "publisher changed" in f["detail"]]
        self.assertEqual(len(pub), 1)
        self.assertEqual(pub[0]["severity"], "info")

    def test_flags_a_human_publisher_swap(self):
        self._inject(
            {"1.0.0": {"publisher": "maintainer", "hooks": [], "declared_repo": None, "deps": [], "fetched": True},
             "1.0.1": {"publisher": "stranger", "hooks": [], "declared_repo": None, "deps": [], "fetched": True}},
            {"1.0.0": {"has_provenance": False, "source_repo": None, "fetched": True},
             "1.0.1": {"has_provenance": False, "source_repo": None, "fetched": True}},
        )
        flags = ds.vet_candidate("p", "1.0.0", "1.0.1")["flags"]
        self.assertTrue(any(f["severity"] == "warn" and "publisher changed" in f["detail"] for f in flags))

    def test_flags_a_newly_introduced_install_hook(self):
        self._inject(
            {"1.0.0": {"publisher": "a", "hooks": [], "declared_repo": None, "deps": [], "fetched": True},
             "1.0.1": {"publisher": "a", "hooks": ["postinstall"], "declared_repo": None, "deps": [], "fetched": True}},
            {"1.0.0": {"has_provenance": False, "source_repo": None, "fetched": True},
             "1.0.1": {"has_provenance": False, "source_repo": None, "fetched": True}},
        )
        flags = ds.vet_candidate("p", "1.0.0", "1.0.1")["flags"]
        self.assertTrue(any("lifecycle hook" in f["detail"] for f in flags))

    def test_does_not_flag_a_preexisting_hook(self):
        # esbuild has always had a postinstall. Steady state is not a signal.
        self._inject(
            {"0.28.0": {"publisher": "a", "hooks": ["postinstall"], "declared_repo": None, "deps": [], "fetched": True},
             "0.28.1": {"publisher": "a", "hooks": ["postinstall"], "declared_repo": None, "deps": [], "fetched": True}},
            {"0.28.0": {"has_provenance": True, "source_repo": None, "fetched": True},
             "0.28.1": {"has_provenance": True, "source_repo": None, "fetched": True}},
        )
        self.assertEqual(ds.vet_candidate("esbuild", "0.28.0", "0.28.1")["flags"], [])

    def test_flags_new_runtime_dependencies(self):
        self._inject(
            {"1.0.0": {"publisher": "a", "hooks": [], "declared_repo": None, "deps": [], "fetched": True},
             "1.1.0": {"publisher": "a", "hooks": [], "declared_repo": None, "deps": ["left-pad"], "fetched": True}},
            {"1.0.0": {"has_provenance": True, "source_repo": None, "fetched": True},
             "1.1.0": {"has_provenance": True, "source_repo": None, "fetched": True}},
        )
        flags = ds.vet_candidate("p", "1.0.0", "1.1.0")["flags"]
        self.assertTrue(any("left-pad" in f["detail"] for f in flags))


class TestVettingUnknowns(unittest.TestCase):
    """A failed registry fetch is not evidence — of anything."""

    def setUp(self):
        self._vf, self._pv = ds.version_facts, ds.provenance

    def tearDown(self):
        ds.version_facts, ds.provenance = self._vf, self._pv

    def _inject(self, facts, prov):
        ds.version_facts = lambda n, v: facts[v]
        ds.provenance = lambda n, v: prov[v]

    def test_failed_attestation_fetch_does_not_fabricate_a_regression(self):
        # The exact false-critical both reviews reproduced: current has
        # provenance, the CANDIDATE's attestation lookup fails -> the old code
        # reported "provenance REGRESSION" (exit 4) out of a network blip.
        self._inject(
            {"1.0.0": {"publisher": "a", "hooks": [], "declared_repo": None,
                       "deps": [], "fetched": True},
             "2.0.0": {"publisher": "a", "hooks": [], "declared_repo": None,
                       "deps": [], "fetched": True}},
            {"1.0.0": {"has_provenance": True, "source_repo": None, "fetched": True},
             "2.0.0": {"has_provenance": False, "source_repo": None, "fetched": False}},
        )
        flags = ds.vet_candidate("p", "1.0.0", "2.0.0")["flags"]
        self.assertFalse(any("REGRESSION" in f["detail"] for f in flags))
        self.assertTrue(any("INCOMPLETE" in f["detail"] for f in flags))

    def test_total_outage_reports_incomplete_not_all_clear(self):
        # The mirror failure: every fetch fails. Zero flags would read as a
        # clean vetting — a real regression during an outage sails through.
        self._inject(
            {"1.0.0": {"publisher": None, "hooks": [], "declared_repo": None,
                       "deps": [], "fetched": False},
             "2.0.0": {"publisher": None, "hooks": [], "declared_repo": None,
                       "deps": [], "fetched": False}},
            {"1.0.0": {"has_provenance": False, "source_repo": None, "fetched": False},
             "2.0.0": {"has_provenance": False, "source_repo": None, "fetched": False}},
        )
        flags = ds.vet_candidate("p", "1.0.0", "2.0.0")["flags"]
        self.assertTrue(any("INCOMPLETE" in f["detail"] for f in flags))


class TestGoToolchain(unittest.TestCase):
    def test_pins_are_parsed_from_workflows_and_dockerfile(self):
        # The pins COMPILE the shipped gatekeeper; go.mod is only a floor. A
        # reverted workflow pin must be visible here, not hidden behind go.mod.
        pins = ds.go_toolchain_pins()
        self.assertIn("vela-neutralino/Dockerfile", pins)
        self.assertTrue(any(k.startswith(".github/workflows/") for k in pins))
        for v in pins.values():
            self.assertIsInstance(v, tuple)

    def test_eol_floor_alone_is_a_warn_not_a_high(self):
        # go.mod 1.25 with pins on 1.26: when Go 1.27 ships, the old check
        # exited 4 on every default run over a FLOOR that still builds fine
        # with a current toolchain. Only an EOL *pin* is a high.
        orig = ds.latest_go_minors
        ds.latest_go_minors = lambda offline=False: [(1, 26), (1, 27)]
        try:
            findings = ds.check_go_toolchain()
            highs = [f for f in findings if f["severity"] == "high"]
            self.assertEqual(highs, [], f"pins are 1.26 (supported) — no high expected: {highs}")
            warns = [f for f in findings if "go.mod" in f["issue"]]
            self.assertEqual(len(warns), 1, "the 1.25 floor should warn, not page")
        finally:
            ds.latest_go_minors = orig

    def test_eol_pin_is_a_high(self):
        orig = ds.latest_go_minors
        ds.latest_go_minors = lambda offline=False: [(1, 27), (1, 28)]
        try:
            findings = ds.check_go_toolchain()
            self.assertTrue(any(f["severity"] == "high" and "past end of life" in f["issue"]
                                for f in findings))
        finally:
            ds.latest_go_minors = orig


class TestOnlyValidation(unittest.TestCase):
    @staticmethod
    def _main(argv):
        import contextlib, io
        with contextlib.redirect_stdout(io.StringIO()), \
             contextlib.redirect_stderr(io.StringIO()):
            return ds.main(argv)

    def test_typo_in_only_is_a_usage_error_not_a_clean_pass(self):
        # `--only parrity` used to run zero checks and print "Nothing needs
        # attention" with exit 0 — a misspelled gate silently passing.
        self.assertEqual(self._main(["--offline", "--only", "parrity"]), ds.EXIT_USAGE)
        self.assertEqual(self._main(["--offline", "--only", "coverage,bogus"]), ds.EXIT_USAGE)

    def test_valid_only_still_runs(self):
        self.assertIn(self._main(["--offline", "--only", "coverage,parity"]),
                      (ds.EXIT_OK, ds.EXIT_FINDINGS))


class TestAuditParsing(unittest.TestCase):
    """
    Parsing is tested directly rather than through check_audits(), so the suite
    does not depend on an installed node_modules tree or a reachable registry.
    """

    def test_reports_advisories(self):
        # The real shape pnpm emitted for the channel: 3 low / 13 moderate / 5 high.
        payload = json.dumps({
            "metadata": {"vulnerabilities": {"info": 0, "low": 3, "moderate": 13, "high": 5, "critical": 0}},
            "advisories": {"1": {"module_name": "hono", "severity": "high"}},
        })
        f = ds.parse_audit("channel", payload)
        self.assertIsNotNone(f)
        self.assertEqual(f["severity"], "high")
        self.assertIn("21 advisory finding(s)", f["issue"])
        self.assertIn("hono (high)", f["modules"])

    def test_critical_outranks_high(self):
        payload = json.dumps({
            "metadata": {"vulnerabilities": {"high": 1, "critical": 2}}, "advisories": {}})
        self.assertEqual(ds.parse_audit("root", payload)["severity"], "critical")

    def test_info_only_is_not_a_finding(self):
        # An `info` bucket alone must not raise an alarm.
        payload = json.dumps({"metadata": {"vulnerabilities": {"info": 4}}})
        self.assertIsNone(ds.parse_audit("root", payload))

    def test_clean_audit_produces_no_finding(self):
        payload = json.dumps({
            "metadata": {"vulnerabilities": {"info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0}}
        })
        self.assertIsNone(ds.parse_audit("root", payload))

    def test_malformed_output_degrades_to_info(self):
        self.assertEqual(ds.parse_audit("root", "not json")["severity"], "info")
        self.assertEqual(ds.parse_audit("root", "")["severity"], "info")

    def test_npm_total_bucket_is_not_double_counted(self):
        # npm v7+ puts a "total" key INSIDE metadata.vulnerabilities. Summing
        # every int key reported "2 advisory finding(s)" for a single high.
        payload = json.dumps({
            "auditReportVersion": 2,
            "metadata": {"vulnerabilities": {"info": 0, "low": 0, "moderate": 0,
                                             "high": 1, "critical": 0, "total": 1}},
            "vulnerabilities": {"undici": {"name": "undici", "severity": "high"}},
        })
        f = ds.parse_audit("root", payload)
        self.assertIn("1 advisory finding(s)", f["issue"])
        self.assertNotIn("total", f["issue"])

    def test_npm_v7_module_names_are_read_from_vulnerabilities(self):
        # npm dropped the legacy `advisories` key in v7; module names live in
        # the per-package `vulnerabilities` map. Reading only `advisories`
        # made `modules` permanently empty for the root npm tree.
        payload = json.dumps({
            "auditReportVersion": 2,
            "metadata": {"vulnerabilities": {"high": 1, "total": 1}},
            "vulnerabilities": {"undici": {"name": "undici", "severity": "high"}},
        })
        self.assertEqual(ds.parse_audit("root", payload)["modules"], ["undici (high)"])

    def test_npm_info_only_with_total_is_not_a_finding(self):
        # The old sum included "total", so an info-only npm report (info: 3,
        # total: 3) raised a warn out of nothing.
        payload = json.dumps({
            "metadata": {"vulnerabilities": {"info": 3, "low": 0, "moderate": 0,
                                             "high": 0, "critical": 0, "total": 3}}})
        self.assertIsNone(ds.parse_audit("root", payload))

    def test_pnpm_no_lockfile_error_is_an_honest_info_finding(self):
        # Without --ignore-workspace pnpm walked up and audited the ROOT tree
        # under this tree's name. With it, a lockfile-less dir errors — which
        # must surface as "audit unavailable", never as a clean result.
        payload = json.dumps({"error": {"code": "ERR_PNPM_AUDIT_NO_LOCKFILE",
                                        "message": "No pnpm-lock.yaml found"}})
        f = ds.parse_audit("vela-neutralino", payload)
        self.assertEqual(f["severity"], "info")
        self.assertIn("NOT covered", f["issue"])

    def test_neutralino_audit_command_carries_ignore_workspace(self):
        cmds = {label: cmd for label, _, cmd in ds.AUDIT_TREES}
        self.assertIn("--ignore-workspace", cmds["vela-neutralino"])
        self.assertNotIn("--ignore-workspace", cmds["channel"])


class TestCoverage(unittest.TestCase):
    def test_finds_every_manifest_in_this_repo(self):
        paths = {m["path"] for m in ds.discover_manifests()}
        for expected in ("package.json", "tests/requirements-test.txt",
                         "tools/vela-dev/channel/package.json",
                         "vela-neutralino/package.json",
                         "vela-neutralino/Dockerfile"):
            self.assertIn(expected, paths)

    def test_skips_vendored_and_generated_trees(self):
        paths = {m["path"] for m in ds.discover_manifests()}
        self.assertFalse([p for p in paths if "node_modules" in p or p.startswith("dist/")])

    def test_this_repo_has_no_unmonitored_manifest(self):
        # If someone adds a new manifest without a dependabot entry, this fails.
        self.assertEqual(ds.check_coverage(), [])

    def test_workflows_count_as_an_actions_manifest(self):
        # Deleting the github-actions block from dependabot.yml must show up
        # as an unmonitored manifest — previously the actions->github-actions
        # mapping in check_coverage was unreachable because discovery never
        # emitted an "actions" entry.
        manifests = ds.discover_manifests()
        actions = [m for m in manifests if m["ecosystem"] == "actions"]
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0]["directory"], "/")
        without_block = {(e, d) for e, d in ds.dependabot_coverage()
                         if e != "github-actions"}
        orig = ds.dependabot_coverage
        ds.dependabot_coverage = lambda: without_block
        try:
            gaps = [f for f in ds.check_coverage() if f["ecosystem"] == "actions"]
            self.assertEqual(len(gaps), 1, "removing the github-actions block must be flagged")
        finally:
            ds.dependabot_coverage = orig


if __name__ == "__main__":
    unittest.main(verbosity=2)
