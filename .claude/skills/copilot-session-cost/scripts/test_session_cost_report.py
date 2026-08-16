#!/usr/bin/env python3
"""Focused stdlib tests for session-cost-report.py's cost-concentration
analysis (hotspots / ranked opportunities). Read-only, synthetic SQLite
data only — no real Copilot session data is read or committed.

Run:
  python3 .claude/skills/copilot-session-cost/scripts/test_session_cost_report.py
"""
import argparse
import contextlib
import importlib.util
import io
import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT_PATH = os.path.join(HERE, "session-cost-report.py")
# Scratch space stays inside the repo (never /tmp); each test cleans up its
# own subdirectory, and this root is removed once empty.
SCRATCH_ROOT = os.path.join(HERE, ".test-scratch")


def local_tempdir():
    """Project-relative equivalent of tempfile.TemporaryDirectory() — every
    synthetic DB this suite creates stays under the repo, never under /tmp."""
    os.makedirs(SCRATCH_ROOT, exist_ok=True)
    path = tempfile.mkdtemp(dir=SCRATCH_ROOT)

    class _Ctx:
        def __enter__(self):
            return path

        def __exit__(self, *exc):
            shutil.rmtree(path, ignore_errors=True)
            try:
                os.rmdir(SCRATCH_ROOT)
            except OSError:
                pass  # not empty yet (other tests still running); fine
            return False

    return _Ctx()

# The script's filename has a hyphen, so it cannot be `import`-ed by name;
# load it directly from its path instead.
_spec = importlib.util.spec_from_file_location("session_cost_report", SCRIPT_PATH)
scr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(scr)

# Mirrors the real assistant_usage_events schema (see the design checkpoint
# this test suite implements). Tests that simulate an older schema pass a
# narrower `columns` list instead.
FULL_SCHEMA_COLS = [
    "id", "session_id", "turn_index", "agent_id", "parent_tool_call_id", "model",
    "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
    "reasoning_tokens", "total_nano_aiu", "request_multiplier", "duration_ms",
    "time_to_first_token_ms", "inter_token_latency_ms", "initiator", "api_endpoint",
    "reasoning_effort", "finish_reason", "content_filter_triggered",
    "token_details_json", "created_at",
]


def make_db(path, rows, columns=None):
    cols = columns if columns is not None else FULL_SCHEMA_COLS
    con = sqlite3.connect(path)
    con.execute(f"create table assistant_usage_events ({', '.join(cols)})")
    placeholders = ", ".join("?" for _ in cols)
    for row in rows:
        vals = [row.get(c) for c in cols]
        con.execute(
            f"insert into assistant_usage_events ({', '.join(cols)}) values ({placeholders})", vals)
    con.commit()
    con.close()


def base_row(**kw):
    row = dict(session_id="s1", model="model-a", agent_id=None, initiator="user",
               input_tokens=0, output_tokens=0, cache_read_tokens=0, cache_write_tokens=0,
               reasoning_tokens=0, total_nano_aiu=0, created_at="2026-01-01T00:00:00.000Z")
    row.update(kw)
    return row


def run_report(db_path, session_id, root_only=False, hotspot_threshold=20.0, top_opportunities=4,
               tree_depth=scr.DEFAULT_TREE_DEPTH, tree_top=scr.DEFAULT_TREE_TOP, tree_order=None,
               snapshot="2099-01-01T00:00:00Z"):
    con = scr.open_ro(db_path, "test-db")
    rows, col_names, has_agent_id, has_initiator, token_col_available, warnings = scr.query_usage(
        con, session_id, snapshot, root_only)
    rates = {"nano_aiu_per_credit": scr.DEFAULT_NANO_AIU_PER_CREDIT,
              "usd_per_credit": scr.DEFAULT_USD_PER_CREDIT}
    report = scr.build_report(rows, col_names, has_agent_id, has_initiator, token_col_available,
                               root_only, rates, False, hotspot_threshold, top_opportunities,
                               tree_depth, tree_top, tree_order)
    con.close()
    return report, warnings


def assert_tree_reconciles(test, node, parent_raw):
    """Exact raw reconciliation, recursively: sum(shown children raw_value)
    + Other raw_value == this node's own raw_value, at every level that was
    expanded. A leaf (no children, no Other) has nothing left to check."""
    children = node.get("children") or []
    other = node.get("other")
    if not children and not other:
        return
    total = sum(c["raw_value"] for c in children)
    if other:
        total += other["raw_value"]
    test.assertEqual(total, parent_raw,
                      f"reconciliation failed at {node.get('label', node.get('metric'))!r}: "
                      f"{total} != {parent_raw}")
    for c in children:
        assert_tree_reconciles(test, c, c["raw_value"])



def hotspots_for(report, dimension, metric=None):
    out = [h for h in report["hotspots"] if h["dimension"] == dimension]
    if metric:
        out = [h for h in out if h["metric"] == metric]
    return out


class ShareMathTests(unittest.TestCase):
    def test_80_20_split_flags_only_the_dominant_item(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", input_tokens=800),
                base_row(model="model-b", input_tokens=200),
            ])
            report, _ = run_report(db, "s1")
            shares = {i["label"]: i["shares"]["input_tokens"]
                      for i in report["dimensions"]["model"]["items"]}
            self.assertAlmostEqual(shares["model-a"], 0.8)
            self.assertAlmostEqual(shares["model-b"], 0.2)
            flagged = {h["item"] for h in hotspots_for(report, "model", "input_tokens")}
            self.assertEqual(flagged, {"model-a"})  # 20% is NOT > 20% (strict >)


class TrivialDimensionGuardTests(unittest.TestCase):
    def test_single_agent_never_flags_100_percent(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", input_tokens=900, total_nano_aiu=900),
                base_row(model="model-b", input_tokens=100, total_nano_aiu=100),
            ])
            report, _ = run_report(db, "s1")
            self.assertTrue(report["dimensions"]["agent"]["trivial"])
            self.assertEqual(report["dimensions"]["agent"]["item_count"], 1)
            self.assertEqual(hotspots_for(report, "agent"), [])

    def test_root_only_hides_subagent_rows_and_stays_trivial(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(agent_id=None, input_tokens=100),
                base_row(agent_id=None, input_tokens=100),
                base_row(agent_id="call_abc123", input_tokens=900),
            ])
            full_report, _ = run_report(db, "s1", root_only=False)
            self.assertEqual(full_report["dimensions"]["agent"]["item_count"], 2)

            root_report, _ = run_report(db, "s1", root_only=True)
            self.assertEqual(root_report["dimensions"]["agent"]["item_count"], 1)
            self.assertTrue(root_report["dimensions"]["agent"]["trivial"])
            self.assertEqual(hotspots_for(root_report, "agent"), [])


class ZeroTotalMetricTests(unittest.TestCase):
    def test_all_zero_reasoning_tokens_is_skipped_not_flagged(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", input_tokens=500, reasoning_tokens=0),
                base_row(model="model-b", input_tokens=500, reasoning_tokens=0),
            ])
            report, _ = run_report(db, "s1")
            self.assertIn("reasoning_tokens", report["skipped_metrics"])
            self.assertEqual(hotspots_for(report, "model", "reasoning_tokens"), [])
            for item in report["dimensions"]["model"]["items"]:
                self.assertNotIn("reasoning_tokens", item["shares"])


class RankingDiversityTests(unittest.TestCase):
    def test_three_dimensions_each_top_before_any_repeat(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", agent_id=None, initiator="user",
                         total_nano_aiu=900, created_at="2026-01-01T00:00:00.000Z"),
                base_row(model="model-b", agent_id=None, initiator="user",
                         total_nano_aiu=100, created_at="2026-01-01T00:00:00.000Z"),
                base_row(model="model-a", agent_id="call_x", initiator="compaction",
                         total_nano_aiu=50, created_at="2026-01-01T00:00:00.000Z"),
                base_row(model="model-b", agent_id="call_x", initiator="compaction",
                         total_nano_aiu=50, created_at="2026-01-01T00:00:00.000Z"),
            ])
            report, _ = run_report(db, "s1", top_opportunities=3)
            ranked = report["ranked_opportunities"]
            self.assertEqual(len(ranked), 3)
            dims_seen = [c["dimension"] for c in ranked]
            self.assertEqual(len(set(dims_seen)), 3,
                              f"expected 3 distinct dimensions, got {dims_seen}")


class CliValidationTests(unittest.TestCase):
    def _run(self, *extra_args):
        return subprocess.run(
            [sys.executable, SCRIPT_PATH, *extra_args],
            capture_output=True, text=True, timeout=30)

    def test_hotspot_threshold_rejects_out_of_range(self):
        for bad in ("0", "-0.1", "150"):
            with self.subTest(bad=bad):
                proc = self._run("--hotspot-threshold", bad)
                self.assertEqual(proc.returncode, 2)

    def test_hotspot_threshold_accepts_boundary_100(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = self._run("--store", db, "--state-dir", state_dir, "--session-id", "s1",
                              "--hotspot-threshold", "100", "--json")
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_top_opportunities_rejects_out_of_range(self):
        for bad in ("0", "-1", "25"):
            with self.subTest(bad=bad):
                proc = self._run("--top-opportunities", bad)
                self.assertEqual(proc.returncode, 2)

    def test_top_opportunities_accepts_boundary_20(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = self._run("--store", db, "--state-dir", state_dir, "--session-id", "s1",
                              "--top-opportunities", "20", "--json")
            self.assertEqual(proc.returncode, 0, proc.stderr)


class RateCliValidationTests(unittest.TestCase):
    """A CLI-supplied rate that would make a zero, negative, NaN, or
    infinite AI-credit/dollar figure must fail as a clear usage error
    (nonzero exit), not silently fall back."""

    def _run(self, *extra_args):
        return subprocess.run(
            [sys.executable, SCRIPT_PATH, *extra_args],
            capture_output=True, text=True, timeout=30)

    def test_nano_aiu_per_credit_rejects_nan_infinities_zero_and_negative(self):
        for bad in ("nan", "inf", "--nano-aiu-per-credit=-inf", "0", "-5"):
            with self.subTest(bad=bad):
                args = [bad] if bad.startswith("--") else ["--nano-aiu-per-credit", bad]
                proc = self._run(*args)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertIn("nano-aiu-per-credit", proc.stderr.lower())

    def test_usd_per_credit_rejects_nan_infinities_and_negative(self):
        for bad in ("nan", "inf", "--usd-per-credit=-inf", "-1"):
            with self.subTest(bad=bad):
                args = [bad] if bad.startswith("--") else ["--usd-per-credit", bad]
                proc = self._run(*args)
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertIn("usd-per-credit", proc.stderr.lower())

    def test_usd_per_credit_accepts_zero(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = self._run("--store", db, "--state-dir", state_dir, "--session-id", "s1",
                              "--usd-per-credit", "0", "--json")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = json.loads(proc.stdout)
            self.assertEqual(out["report"]["cost_estimate"]["usd_per_credit"], 0.0)

    def test_nano_aiu_per_credit_accepts_a_positive_value(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10, total_nano_aiu=2_000_000_000)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = self._run("--store", db, "--state-dir", state_dir, "--session-id", "s1",
                              "--nano-aiu-per-credit", "1000000000", "--json")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = json.loads(proc.stdout)
            self.assertEqual(out["report"]["totals"]["ai_credits"], 2.0)


class RateFileValidationTests(unittest.TestCase):
    """An invalid --rates-file value must warn and fall back to the prior
    valid/default value — never raise, never reach the report math."""

    def _rates(self, data, nano_aiu_per_credit=None, usd_per_credit=None):
        with local_tempdir() as d:
            path = os.path.join(d, "rates.json")
            with open(path, "w") as f:
                f.write(data)
            args = argparse.Namespace(rates_file=path,
                                       nano_aiu_per_credit=nano_aiu_per_credit,
                                       usd_per_credit=usd_per_credit)
            return scr.load_rates(args)

    def test_nan_falls_back_to_default_with_warning(self):
        rates, warnings = self._rates('{"nano_aiu_per_credit": NaN, "usd_per_credit": NaN}')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(len(warnings), 2)

    def test_positive_infinity_falls_back_to_default_with_warning(self):
        rates, warnings = self._rates(
            '{"nano_aiu_per_credit": Infinity, "usd_per_credit": Infinity}')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(len(warnings), 2)

    def test_negative_infinity_falls_back_to_default_with_warning(self):
        rates, warnings = self._rates(
            '{"nano_aiu_per_credit": -Infinity, "usd_per_credit": -Infinity}')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(len(warnings), 2)

    def test_zero_nano_aiu_per_credit_falls_back_but_zero_usd_is_kept(self):
        rates, warnings = self._rates('{"nano_aiu_per_credit": 0, "usd_per_credit": 0}')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], 0.0)
        self.assertEqual(len(warnings), 1)

    def test_negative_values_fall_back_to_default_with_warning(self):
        rates, warnings = self._rates(
            '{"nano_aiu_per_credit": -5, "usd_per_credit": -0.5}')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(len(warnings), 2)

    def test_valid_rates_file_value_is_kept_not_overwritten_by_a_later_invalid_key(self):
        rates, warnings = self._rates(
            '{"nano_aiu_per_credit": 500000000, "usd_per_credit": NaN}')
        self.assertEqual(rates["nano_aiu_per_credit"], 500000000)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(len(warnings), 1)

    def test_report_json_never_contains_nan_or_infinity_literals(self):
        """Strict-JSON regression: with an invalid rates file, the emitted
        report JSON must contain only standard, finite numbers."""
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10, total_nano_aiu=10)])
            rates_path = os.path.join(d, "rates.json")
            with open(rates_path, "w") as f:
                f.write('{"nano_aiu_per_credit": NaN, "usd_per_credit": -Infinity}')
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--store", db, "--state-dir", state_dir,
                 "--session-id", "s1", "--rates-file", rates_path, "--json"],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertNotIn("NaN", proc.stdout)
            self.assertNotIn("Infinity", proc.stdout)
            out = json.loads(proc.stdout)
            self.assertTrue(math.isfinite(out["report"]["cost_estimate"]["nano_aiu_per_credit"]))
            self.assertTrue(math.isfinite(out["report"]["cost_estimate"]["usd_per_credit"]))


class RateFileShapeValidationTests(unittest.TestCase):
    """A --rates-file holding valid JSON that is not an object (array,
    null, a bare number, a bare string) must warn and fall back to the
    current rates dict — never raise TypeError/AttributeError from
    `key in data` / `data[key]` / `data.keys()`."""

    def _rates(self, data, nano_aiu_per_credit=None, usd_per_credit=None):
        with local_tempdir() as d:
            path = os.path.join(d, "rates.json")
            with open(path, "w") as f:
                f.write(data)
            args = argparse.Namespace(rates_file=path,
                                       nano_aiu_per_credit=nano_aiu_per_credit,
                                       usd_per_credit=usd_per_credit)
            return scr.load_rates(args)

    def test_array_falls_back_to_default_with_one_warning(self):
        rates, warnings = self._rates('[]')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(len(warnings), 1)
        self.assertIn("array", warnings[0])

    def test_null_falls_back_to_default_with_one_warning(self):
        rates, warnings = self._rates('null')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(len(warnings), 1)
        self.assertIn("null", warnings[0])

    def test_scalar_number_falls_back_to_default_with_one_warning(self):
        rates, warnings = self._rates('42')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(len(warnings), 1)
        self.assertIn("number", warnings[0])

    def test_string_falls_back_to_default_with_one_warning(self):
        rates, warnings = self._rates('"usd_per_credit"')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(len(warnings), 1)
        self.assertIn("string", warnings[0])

    def test_empty_object_is_a_no_op_not_a_new_warning(self):
        """An empty object is a well-formed rates file with no overrides —
        the control case, distinct from a wrong-shape file. It must keep
        defaults with no warning at all."""
        rates, warnings = self._rates('{}')
        self.assertEqual(rates["nano_aiu_per_credit"], scr.DEFAULT_NANO_AIU_PER_CREDIT)
        self.assertEqual(rates["usd_per_credit"], scr.DEFAULT_USD_PER_CREDIT)
        self.assertEqual(warnings, [])

    def test_cli_flag_still_overrides_a_wrong_shape_rates_file(self):
        """CLI-flag precedence over --rates-file must hold even when the
        rates file itself is unusable."""
        rates, warnings = self._rates('[]', nano_aiu_per_credit=2_000_000_000.0,
                                       usd_per_credit=0.02)
        self.assertEqual(rates["nano_aiu_per_credit"], 2_000_000_000.0)
        self.assertEqual(rates["usd_per_credit"], 0.02)
        self.assertEqual(len(warnings), 1)

    def test_cli_no_traceback_for_array_shaped_rates_file(self):
        """End-to-end: an array-shaped rates file must not crash the CLI;
        it must exit 0 and print no traceback."""
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10, total_nano_aiu=10)])
            rates_path = os.path.join(d, "rates.json")
            with open(rates_path, "w") as f:
                f.write('[1, 2, 3]')
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--store", db, "--state-dir", state_dir,
                 "--session-id", "s1", "--rates-file", rates_path],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertNotIn("Traceback", proc.stderr)
            self.assertIn("array", proc.stdout)

    def test_cli_no_traceback_and_strict_json_for_null_shaped_rates_file(self):
        """End-to-end with --json: a null-shaped rates file must not
        crash, must exit 0, and must emit strict, parseable JSON only
        (no NaN/Infinity literals)."""
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10, total_nano_aiu=10)])
            rates_path = os.path.join(d, "rates.json")
            with open(rates_path, "w") as f:
                f.write('null')
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--store", db, "--state-dir", state_dir,
                 "--session-id", "s1", "--rates-file", rates_path, "--json"],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertNotIn("Traceback", proc.stderr)
            self.assertNotIn("NaN", proc.stdout)
            self.assertNotIn("Infinity", proc.stdout)
            out = json.loads(proc.stdout)
            self.assertEqual(out["report"]["cost_estimate"]["nano_aiu_per_credit"],
                              scr.DEFAULT_NANO_AIU_PER_CREDIT)
            self.assertEqual(out["report"]["cost_estimate"]["usd_per_credit"],
                              scr.DEFAULT_USD_PER_CREDIT)
            self.assertTrue(any("null" in w for w in out["warnings"]))


class SchemaDegradeTests(unittest.TestCase):
    def test_missing_agent_id_and_initiator_columns_degrade_safely(self):
        narrow_cols = ["session_id", "model", "input_tokens", "output_tokens",
                       "cache_read_tokens", "cache_write_tokens", "reasoning_tokens",
                       "total_nano_aiu", "duration_ms", "created_at"]
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model=None, input_tokens=100),
                base_row(model="model-a", input_tokens=200),
            ], columns=narrow_cols)
            con = scr.open_ro(db, "test-db")
            cols = scr.get_columns(con, "assistant_usage_events")
            rows, col_names, has_agent_id, has_initiator, token_col_available, warnings = scr.query_usage(
                con, "s1", "2099-01-01T00:00:00Z", False)
            self.assertFalse(has_agent_id)
            self.assertFalse(has_initiator)
            self.assertTrue(any("agent_id" in w for w in warnings))
            self.assertTrue(any("initiator" in w for w in warnings))

            rates = {"nano_aiu_per_credit": scr.DEFAULT_NANO_AIU_PER_CREDIT,
                      "usd_per_credit": scr.DEFAULT_USD_PER_CREDIT}
            report = scr.build_report(rows, col_names, has_agent_id, has_initiator,
                                       token_col_available, False, rates, False, 20.0, 4)
            con.close()
            # Missing agent_id: every row folds into a single "root" bucket
            # (matches the script's historical "everything is root" degrade).
            self.assertEqual(report["dimensions"]["agent"]["item_count"], 1)
            self.assertFalse(report["dimensions"]["agent"]["available"])
            # Missing initiator: no safe label to build a bucket from, so
            # the dimension stays empty rather than inventing one.
            self.assertEqual(report["dimensions"]["initiator"]["item_count"], 0)
            self.assertFalse(report["dimensions"]["initiator"]["available"])
            # NULL model still degrades to a labeled bucket, no crash.
            labels = {i["label"] for i in report["dimensions"]["model"]["items"]}
            self.assertIn("(unknown model)", labels)
            self.assertEqual(report["totals"]["input_tokens"], 300)


class RegressionTests(unittest.TestCase):
    def test_totals_by_model_and_root_vs_subagent_match_hand_computed(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", agent_id=None, input_tokens=100, output_tokens=10),
                base_row(model="model-a", agent_id=None, input_tokens=50, output_tokens=5),
                base_row(model="model-a", agent_id="call_1", input_tokens=30, output_tokens=3),
                base_row(model="model-b", agent_id="call_2", input_tokens=20, output_tokens=2),
                base_row(model="model-b", agent_id="call_2", input_tokens=10, output_tokens=1),
            ])
            report, _ = run_report(db, "s1")
            self.assertEqual(report["totals"]["calls"], 5)
            self.assertEqual(report["totals"]["input_tokens"], 210)
            self.assertEqual(report["totals"]["output_tokens"], 21)
            self.assertEqual(report["by_model"]["model-a"]["input_tokens"], 180)
            self.assertEqual(report["by_model"]["model-b"]["input_tokens"], 30)
            rvs = report["root_vs_subagent"]
            self.assertEqual(rvs["root"]["input_tokens"], 150)
            self.assertEqual(rvs["subagents"]["input_tokens"], 60)
            self.assertEqual(rvs["subagents"]["subagent_instance_count"], 2)


class EdgeCaseTests(unittest.TestCase):
    def test_one_event_session_has_no_hotspots(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=42, total_nano_aiu=42)])
            report, _ = run_report(db, "s1")
            self.assertEqual(report["hotspots"], [])
            self.assertEqual(report["ranked_opportunities"], [])
            for dim in report["dimensions"].values():
                self.assertTrue(dim["trivial"])

    def test_zero_rows_session_does_not_crash(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(session_id="other-session", input_tokens=42)])
            report, warnings = run_report(db, "s1")
            self.assertEqual(report["totals"]["calls"], 0)
            self.assertEqual(report["hotspots"], [])
            self.assertEqual(set(report["skipped_metrics"]), set(scr.PRIMARY_METRICS))
            self.assertTrue(any("No usage rows found" in w for w in warnings))


class PrivacyGuardTests(unittest.TestCase):
    def test_query_never_references_free_text_columns(self):
        cols = set(FULL_SCHEMA_COLS)
        sql, _warnings, _has_agent, _has_init, _token_cols = scr.build_query(cols, False)
        for forbidden in ("token_details_json", "parent_tool_call_id", "api_endpoint"):
            self.assertNotIn(forbidden, sql)
        self.assertNotIn("sessions.", sql)

    def test_list_sessions_never_queries_or_prints_branch(self):
        """--list-sessions must show only session id, timestamps, and
        active state (the CLI help's own contract). A branch name can
        carry customer/ticket/task text, so it must never reach the SQL
        statement `list_known_sessions` runs, nor the printed output —
        proven here with an obvious fake sentinel, not real data."""
        sentinel = "CUSTOMER-ACME-TICKET-1234-do-not-leak-this-branch"
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            con = sqlite3.connect(db)
            con.execute(
                "create table sessions (id text, branch text, created_at text, updated_at text)")
            con.execute(
                "insert into sessions values (?, ?, ?, ?)",
                ("s1", sentinel, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"))
            con.commit()
            con.close()

            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir, exist_ok=True)

            ro = scr.open_ro(db, "test-db")
            executed_sql = []
            ro.set_trace_callback(executed_sql.append)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                scr.list_known_sessions(ro, state_dir)
            ro.close()
            output = buf.getvalue()

        # Not queried: no statement the function ran selects the branch column.
        select_stmts = [s for s in executed_sql if s.strip().lower().startswith("select")]
        self.assertTrue(select_stmts, "expected at least one SELECT to run")
        for stmt in select_stmts:
            self.assertNotIn("branch", stmt.lower())
        # Not emitted: the sentinel and the word "branch" never reach stdout.
        self.assertNotIn(sentinel, output)
        self.assertNotIn("branch", output.lower())
        # The documented fields are still present.
        self.assertIn("s1", output)
        self.assertIn("2026-01-01T00:00:00Z", output)
        self.assertIn("2026-01-02T00:00:00Z", output)

    def test_cost_tree_uses_only_already_fetched_safe_columns(self):
        """The tree is built in pure Python from rows the existing SQL
        already fetched — it must not need a second query or a new column."""
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", agent_id=None, initiator="user", input_tokens=100),
                base_row(model="model-b", agent_id="call_x", initiator="agent", input_tokens=50),
            ])
            report, _ = run_report(db, "s1")
            self.assertIn("cost_tree", report)
            for dim in report["cost_tree"]["order"]:
                self.assertIn(dim, scr.DEFAULT_TREE_ORDER)
            # Every tree node label is one of: a model name, 'root'/an opaque
            # agent-call id already used by the 'agent' dimension elsewhere,
            # an initiator enum value, a time-bucket string, or 'Other' /
            # the fixed unavailable/unknown markers — never free text.
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            agent_labels = {i["label"] for i in report["dimensions"]["agent"]["items"]}
            for child in root["children"]:
                self.assertIn(child["label"], {"model-a", "model-b"})


class CostTreeDefaultTests(unittest.TestCase):
    """Default nesting: model -> agent -> initiator -> time_bucket, depth 2,
    top 5. Roots appear in PRIMARY_METRICS order."""

    def test_default_order_and_depth_two(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", agent_id=None, input_tokens=600, total_nano_aiu=600),
                base_row(model="model-a", agent_id="call_x", input_tokens=200, total_nano_aiu=200),
                base_row(model="model-b", agent_id=None, input_tokens=200, total_nano_aiu=200),
            ])
            report, _ = run_report(db, "s1")
            ct = report["cost_tree"]
            self.assertEqual(ct["order"], scr.DEFAULT_TREE_ORDER)
            self.assertEqual(ct["depth"], scr.DEFAULT_TREE_DEPTH)
            self.assertEqual(ct["top"], scr.DEFAULT_TREE_TOP)
            self.assertEqual([r["metric"] for r in ct["roots"]], scr.PRIMARY_METRICS)
            root = next(r for r in ct["roots"] if r["metric"] == "input_tokens")
            self.assertEqual(root["raw_value"], 1000)
            # depth 2: model -> agent, no initiator/time_bucket level.
            model_a = next(c for c in root["children"] if c["label"] == "model-a")
            for grandchild in model_a["children"]:
                self.assertEqual(grandchild["children"], [])
                self.assertIsNone(grandchild["other"])

    def test_every_root_and_every_level_reconciles_exactly(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", agent_id=None, initiator="user",
                         input_tokens=333, output_tokens=71, cache_read_tokens=19,
                         cache_write_tokens=3, reasoning_tokens=5, total_nano_aiu=987),
                base_row(model="model-a", agent_id="call_1", initiator="agent",
                         input_tokens=127, output_tokens=44, cache_read_tokens=8,
                         cache_write_tokens=1, reasoning_tokens=2, total_nano_aiu=333),
                base_row(model="model-b", agent_id="call_2", initiator="sub-agent",
                         input_tokens=59, output_tokens=13, cache_read_tokens=2,
                         cache_write_tokens=0, reasoning_tokens=0, total_nano_aiu=71),
            ])
            report, _ = run_report(db, "s1", tree_depth=4,
                                    tree_order=["model", "agent", "initiator", "time_bucket"])
            for root in report["cost_tree"]["roots"]:
                if root["skipped"]:
                    continue
                assert_tree_reconciles(self, root, root["raw_value"])


class CostTreeCustomTests(unittest.TestCase):
    def test_custom_order_depth_and_top(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            rows = [base_row(model=f"m{i}", agent_id=None, input_tokens=10 * (i + 1))
                    for i in range(8)]
            make_db(db, rows)
            report, _ = run_report(db, "s1", tree_order=["agent", "model"], tree_depth=2,
                                    tree_top=3)
            ct = report["cost_tree"]
            self.assertEqual(ct["order"], ["agent", "model"])
            self.assertEqual(ct["top"], 3)
            root = next(r for r in ct["roots"] if r["metric"] == "input_tokens")
            # only one agent ("root") in this fixture -> single child, no Other.
            self.assertEqual(len(root["children"]), 1)
            agent_node = root["children"][0]
            self.assertEqual(agent_node["label"], "root")
            # nested by model, top 3 of 8 -> 3 shown + 1 Other.
            self.assertEqual(len(agent_node["children"]), 3)
            self.assertIsNotNone(agent_node["other"])
            self.assertEqual(agent_node["other"]["omitted_count"], 5)
            assert_tree_reconciles(self, root, root["raw_value"])

    def test_tree_order_fewer_than_four_clamps_depth_without_error(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="model-a", input_tokens=10)])
            report, _ = run_report(db, "s1", tree_depth=4, tree_order=["model", "agent"])
            self.assertEqual(report["cost_tree"]["depth"], 2)

    def test_tree_depth_one_shows_no_second_level(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", agent_id="call_1", input_tokens=10),
                base_row(model="model-a", agent_id="call_2", input_tokens=20),
            ])
            report, _ = run_report(db, "s1", tree_depth=1)
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            for child in root["children"]:
                self.assertEqual(child["children"], [])
                self.assertIsNone(child["other"])


class CostTreeCliValidationTests(unittest.TestCase):
    def _run(self, *extra_args):
        return subprocess.run(
            [sys.executable, SCRIPT_PATH, *extra_args],
            capture_output=True, text=True, timeout=30)

    def test_tree_depth_rejects_out_of_range(self):
        for bad in ("0", "5", "-1"):
            with self.subTest(bad=bad):
                self.assertEqual(self._run("--tree-depth", bad).returncode, 2)

    def test_tree_top_rejects_out_of_range(self):
        for bad in ("0", "21", "-1"):
            with self.subTest(bad=bad):
                self.assertEqual(self._run("--tree-top", bad).returncode, 2)

    def test_tree_order_rejects_unknown_and_duplicate_names(self):
        self.assertEqual(self._run("--tree-order", "bogus").returncode, 2)
        self.assertEqual(self._run("--tree-order", "model,model").returncode, 2)

    def test_tree_depth_and_top_accept_boundaries(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = self._run("--store", db, "--state-dir", state_dir, "--session-id", "s1",
                              "--tree-depth", "4", "--tree-top", "20", "--json")
            self.assertEqual(proc.returncode, 0, proc.stderr)


class CostTreeOtherRollupTests(unittest.TestCase):
    def test_eight_models_top_five_yields_exact_other_remainder(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            rows = [base_row(model=f"m{i}", agent_id=None, input_tokens=(i + 1) * 7)
                    for i in range(8)]
            make_db(db, rows)
            report, _ = run_report(db, "s1", tree_top=5)
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            self.assertEqual(len(root["children"]), 5)
            self.assertIsNotNone(root["other"])
            self.assertEqual(root["other"]["omitted_count"], 3)
            shown_sum = sum(c["raw_value"] for c in root["children"])
            self.assertEqual(shown_sum + root["other"]["raw_value"], root["raw_value"])
            self.assertTrue(root["other"]["is_other"])
            for c in root["children"]:
                self.assertFalse(c["is_other"])

    def test_fewer_items_than_top_n_has_no_other(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="model-a", input_tokens=10),
                         base_row(model="model-b", input_tokens=20)])
            report, _ = run_report(db, "s1", tree_top=5)
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            self.assertIsNone(root["other"])
            self.assertEqual(len(root["children"]), 2)


class CostTreeTieBreakTests(unittest.TestCase):
    def test_equal_values_sort_by_label_deterministically(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="zeta", input_tokens=50),
                         base_row(model="alpha", input_tokens=50),
                         base_row(model="mid", input_tokens=50)])
            report1, _ = run_report(db, "s1")
            report2, _ = run_report(db, "s1")
            root1 = next(r for r in report1["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            root2 = next(r for r in report2["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            labels1 = [c["label"] for c in root1["children"]]
            labels2 = [c["label"] for c in root2["children"]]
            self.assertEqual(labels1, labels2)
            self.assertEqual(labels1, sorted(labels1))  # equal value -> ascending label tie-break


class CostTreeUnknownDimensionTests(unittest.TestCase):
    def test_missing_initiator_column_uses_real_unavailable_label(self):
        narrow_cols = ["session_id", "model", "agent_id", "input_tokens", "output_tokens",
                       "cache_read_tokens", "cache_write_tokens", "reasoning_tokens",
                       "total_nano_aiu", "duration_ms", "created_at"]
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="model-a", input_tokens=100)], columns=narrow_cols)
            report, _ = run_report(db, "s1", tree_order=["initiator"], tree_depth=1)
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            self.assertEqual(len(root["children"]), 1)
            self.assertEqual(root["children"][0]["label"], scr.UNAVAILABLE_LABEL)
            self.assertFalse(root["children"][0]["is_other"])
            self.assertIsNone(root["other"])

    def test_null_initiator_value_uses_real_unknown_label_not_other(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="model-a", initiator=None, input_tokens=100),
                         base_row(model="model-a", initiator="user", input_tokens=50)])
            report, _ = run_report(db, "s1", tree_order=["initiator"], tree_depth=1, tree_top=1)
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            labels = {c["label"] for c in root["children"]}
            if root["other"]:
                labels.add(root["other"]["label"])
            self.assertIn(scr.UNKNOWN_INITIATOR_LABEL, [c["label"] for c in root["children"]]
                           + ([] if not root["other"] else []))
            # The unknown-initiator row (100, the larger value) must show as
            # a REAL top item, not be absorbed into the synthetic Other.
            top_label = root["children"][0]["label"]
            self.assertEqual(top_label, scr.UNKNOWN_INITIATOR_LABEL)
            self.assertFalse(root["children"][0]["is_other"])

    def test_unparsable_timestamp_gets_real_unknown_time_label(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="model-a", input_tokens=100, created_at="not-a-date"),
                         base_row(model="model-a", input_tokens=50,
                                  created_at="2026-01-01T00:00:00.000Z")])
            report, _ = run_report(db, "s1", tree_order=["time_bucket"], tree_depth=1)
            self.assertEqual(report["cost_tree"]["time_bounds"]["unknown_time_rows"], 1)
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            labels = [c["label"] for c in root["children"]]
            self.assertIn(scr.UNKNOWN_TIME_LABEL, labels)
            unknown_node = next(c for c in root["children"] if c["label"] == scr.UNKNOWN_TIME_LABEL)
            self.assertEqual(unknown_node["raw_value"], 100)
            self.assertFalse(unknown_node["is_other"])
            assert_tree_reconciles(self, root, root["raw_value"])


class CostTreeRootOnlyTests(unittest.TestCase):
    def test_root_only_collapses_agent_level_to_one_real_node(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", agent_id=None, input_tokens=100),
                base_row(model="model-a", agent_id="call_1", input_tokens=900),
            ])
            report, _ = run_report(db, "s1", root_only=True, tree_order=["agent"], tree_depth=1)
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            self.assertEqual(root["raw_value"], 100)
            self.assertEqual(len(root["children"]), 1)
            self.assertEqual(root["children"][0]["label"], "root")
            self.assertEqual(root["children"][0]["share_of_parent"], 1.0)
            self.assertIsNone(root["other"])


class CostTreeZeroMetricTests(unittest.TestCase):
    def test_zero_total_metric_root_is_skipped_with_no_children(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="model-a", input_tokens=100, reasoning_tokens=0)])
            report, _ = run_report(db, "s1")
            root = next(r for r in report["cost_tree"]["roots"]
                        if r["metric"] == "reasoning_tokens")
            self.assertTrue(root["skipped"])
            self.assertEqual(root["children"], [])
            self.assertIsNone(root["other"])
            self.assertEqual(root["raw_value"], 0)


class TimeBucketIsoLabelTests(unittest.TestCase):
    def test_bucket_labels_carry_full_date_and_stay_chronological_across_midnight(self):
        ts = [
            scr.parse_iso_ts("2026-01-01T23:50:00.000Z"),
            scr.parse_iso_ts("2026-01-02T00:05:00.000Z"),
            scr.parse_iso_ts("2026-01-02T00:15:00.000Z"),
            scr.parse_iso_ts("2026-01-01T23:40:00.000Z"),
        ]
        labels, bounds, dropped = scr.build_time_bucket_labels(ts)
        self.assertEqual(dropped, 0)
        for b in bounds:
            self.assertIn("-", b["start"])  # ISO date present, not just a time
            self.assertIn("-", b["end"])
        # bucket index in the label stays 1..N in chronological order,
        # independent of any later value-based sort in the tree.
        indices = [b["index"] for b in bounds]
        self.assertEqual(indices, sorted(indices))
        starts = [b["start"] for b in bounds]
        self.assertEqual(starts, sorted(starts))

    def test_json_preserves_exact_bucket_boundaries(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", input_tokens=10, created_at="2026-01-01T23:50:00.000Z"),
                base_row(model="model-a", input_tokens=20, created_at="2026-01-02T00:15:00.000Z"),
            ])
            report, _ = run_report(db, "s1")
            bounds = report["dimensions"]["time_bucket"]["bucket_bounds"]
            self.assertTrue(len(bounds) > 0)
            for b in bounds:
                self.assertIn("start", b)
                self.assertIn("end", b)
                self.assertIn("index", b)
            tb = report["cost_tree"]["time_bounds"]
            self.assertEqual(tb["min"], bounds[0]["start"])
            self.assertEqual(tb["max"], bounds[-1]["end"])


class CostTreeJsonAndHumanOrderTests(unittest.TestCase):
    def test_json_output_adds_cost_tree_without_removing_prior_fields(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="model-a", input_tokens=100, total_nano_aiu=100)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--store", db, "--state-dir", state_dir,
                 "--session-id", "s1", "--json"],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = json.loads(proc.stdout)
            report = out["report"]
            for key in ("totals", "by_model", "hotspots", "ranked_opportunities",
                        "skipped_metrics", "dimensions", "overall_token_mix", "cost_tree"):
                self.assertIn(key, report)
            ct = report["cost_tree"]
            for key in ("order", "depth", "top", "time_bounds", "roots"):
                self.assertIn(key, ct)
            for root in ct["roots"]:
                for key in ("metric", "value", "raw_value", "skipped", "children", "other"):
                    self.assertIn(key, root)

    def test_human_output_orders_cost_tree_between_mix_and_concentration(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="model-a", input_tokens=100, total_nano_aiu=100)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--store", db, "--state-dir", state_dir,
                 "--session-id", "s1"],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            mix_pos = proc.stdout.index("-- Overall token mix --")
            tree_pos = proc.stdout.index("-- Cost tree")
            concentration_pos = proc.stdout.index("-- Cost concentration")
            self.assertLess(mix_pos, tree_pos)
            self.assertLess(tree_pos, concentration_pos)

    def test_no_tree_flag_omits_human_section_but_json_keeps_it(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(model="model-a", input_tokens=100, total_nano_aiu=100)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--store", db, "--state-dir", state_dir,
                 "--session-id", "s1", "--no-tree"],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertNotIn("-- Cost tree", proc.stdout)
            self.assertIn("-- Overall token mix --", proc.stdout)
            self.assertIn("-- Cost concentration", proc.stdout)

            proc_json = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--store", db, "--state-dir", state_dir,
                 "--session-id", "s1", "--no-tree", "--json"],
                capture_output=True, text=True, timeout=30)
            out = json.loads(proc_json.stdout)
            self.assertIn("cost_tree", out["report"])


class CostTreePerformanceTests(unittest.TestCase):
    def test_bounded_synthetic_many_agents_completes_quickly_and_stays_bounded(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            rows = []
            for i in range(50):
                rows.append(base_row(model="model-a", agent_id=f"call_{i:03d}",
                                      input_tokens=(i % 7) + 1,
                                      created_at="2026-01-01T00:00:0%d.000Z" % (i % 10)))
            make_db(db, rows)
            start = time.time()
            report, _ = run_report(db, "s1", tree_top=5, tree_depth=4)
            elapsed = time.time() - start
            self.assertLess(elapsed, 5.0, "tree build took too long for 50 agents")
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            self.assertLessEqual(len(root["children"]), 5)
            if root["other"]:
                self.assertEqual(root["other"]["omitted_count"], 45)
            assert_tree_reconciles(self, root, root["raw_value"])


class OverallTokenMixTests(unittest.TestCase):
    """Overall token mix: top-level input-vs-output share, plus independent
    cache/reasoning ratios shown only when the schema makes them
    meaningful. The report NEVER infers an uncached-input or
    non-reasoning remainder — no documented contract in this repo fixes
    counter semantics across models, so an aggregate inequality holding
    is not proof the counters are disjoint. See CLAUDE.md 'Overall token
    mix' correction."""

    def test_normal_ratio_percentages(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(input_tokens=800, output_tokens=200, cache_read_tokens=100,
                         cache_write_tokens=50, reasoning_tokens=40),
            ])
            report, _ = run_report(db, "s1")
            otm = report["overall_token_mix"]

            top = otm["top_level"]
            self.assertEqual(top["denominator"], 1000)
            self.assertAlmostEqual(top["components"]["input_tokens"]["pct"], 80.0)
            self.assertAlmostEqual(top["components"]["output_tokens"]["pct"], 20.0)

            cr = otm["cache_ratios"]
            self.assertEqual(cr["denominator"], 800)
            self.assertAlmostEqual(cr["components"]["cache_read_tokens"]["pct"], 12.5)
            self.assertAlmostEqual(cr["components"]["cache_write_tokens"]["pct"], 6.25)
            # No inferred remainder key of any kind.
            self.assertNotIn("uncached_input_tokens", cr["components"])

            rr = otm["reasoning_ratio"]
            self.assertEqual(rr["denominator"], 200)
            self.assertEqual(rr["components"]["reasoning_tokens"]["value"], 40)
            self.assertAlmostEqual(rr["components"]["reasoning_tokens"]["pct"], 20.0)
            self.assertNotIn("non_reasoning_output_tokens", rr["components"])
            self.assertEqual(otm["warnings"], [])

    def test_zero_input_and_output_omits_all_percentages(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=0, output_tokens=0, total_nano_aiu=0)])
            report, _ = run_report(db, "s1")
            otm = report["overall_token_mix"]

            top = otm["top_level"]
            self.assertEqual(top["denominator"], 0)
            self.assertIsNone(top["components"]["input_tokens"]["pct"])
            self.assertIsNone(top["components"]["output_tokens"]["pct"])
            self.assertIsNone(otm["cache_ratios"])
            self.assertIsNone(otm["reasoning_ratio"])
            self.assertTrue(any("input_tokens + output_tokens is 0" in w for w in otm["warnings"]))
            self.assertTrue(any("input_tokens total is 0" in w for w in otm["warnings"]))
            self.assertTrue(any("output_tokens total is 0" in w for w in otm["warnings"]))

    def test_aggregate_inequality_still_shows_ratios_with_warning(self):
        """A single-model row where the aggregate looks inconsistent
        (cache_read + cache_write > input, reasoning > output) must still
        show both ratios — never omit them and never derive a remainder.
        This differs from the old (buggy) behavior, which used to omit
        the whole composition here."""
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(input_tokens=100, output_tokens=50, cache_read_tokens=80,
                         cache_write_tokens=40, reasoning_tokens=60),
            ])
            report, _ = run_report(db, "s1")
            otm = report["overall_token_mix"]
            # cache_read (80) + cache_write (40) = 120 > input_tokens (100)
            cr = otm["cache_ratios"]
            self.assertIsNotNone(cr)
            self.assertAlmostEqual(cr["components"]["cache_read_tokens"]["pct"], 80.0)
            self.assertAlmostEqual(cr["components"]["cache_write_tokens"]["pct"], 40.0)
            self.assertTrue(any("exceeds input_tokens" in w for w in otm["warnings"]))
            # reasoning_tokens (60) > output_tokens (50)
            rr = otm["reasoning_ratio"]
            self.assertIsNotNone(rr)
            self.assertAlmostEqual(rr["components"]["reasoning_tokens"]["pct"], 120.0)
            self.assertTrue(any("exceeds output_tokens" in w for w in otm["warnings"]))
            # top-level input/output mix is unaffected — it never uses
            # cache/reasoning fields.
            top = otm["top_level"]
            self.assertAlmostEqual(top["components"]["input_tokens"]["pct"], 100 / 150 * 100,
                                    places=2)

    def test_mixed_model_rows_never_emit_false_remainder(self):
        """Two models contribute rows to the same session: model-a records
        cache_read/cache_write as clearly separate from input_tokens;
        model-b could plausibly use inclusive/larger cache and reasoning
        counters (a different per-model contract). The AGGREGATE
        cache_read + cache_write (100) stays <= aggregate input_tokens
        (500) — the exact condition the old buggy code treated as 'proof'
        it was safe to subtract and report an 'uncached_input_tokens'
        remainder. That inference must never happen: no such key may
        exist anywhere in the report, regardless of whether the aggregate
        inequality happens to hold. All five recorded counters must still
        show a visible percentage or ratio."""
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", input_tokens=300, output_tokens=100,
                         cache_read_tokens=20, cache_write_tokens=10, reasoning_tokens=15),
                base_row(model="model-b", input_tokens=200, output_tokens=100,
                         cache_read_tokens=60, cache_write_tokens=10, reasoning_tokens=70),
            ])
            report, _ = run_report(db, "s1")
            otm = report["overall_token_mix"]

            totals = report["totals"]
            self.assertEqual(totals["input_tokens"], 500)
            self.assertEqual(totals["output_tokens"], 200)
            self.assertEqual(totals["cache_read_tokens"], 80)
            self.assertEqual(totals["cache_write_tokens"], 20)
            self.assertEqual(totals["reasoning_tokens"], 85)
            # Aggregate check the old code used as a green light:
            # cache_read + cache_write (100) <= input_tokens (500), and
            # reasoning (85) <= output_tokens (200) — both "hold", yet no
            # remainder may ever be synthesized from mixed-model totals.
            self.assertLessEqual(totals["cache_read_tokens"] + totals["cache_write_tokens"],
                                  totals["input_tokens"])
            self.assertLessEqual(totals["reasoning_tokens"], totals["output_tokens"])

            report_json = json.dumps(report)
            self.assertNotIn("uncached_input_tokens", report_json)
            self.assertNotIn("non_reasoning_output_tokens", report_json)
            self.assertNotIn("input_composition", report_json)
            self.assertNotIn("output_composition", report_json)

            # All five recorded counters still have a visible percentage
            # or ratio: input/output via top_level, cache_read/cache_write
            # via cache_ratios, reasoning via reasoning_ratio.
            top = otm["top_level"]["components"]
            self.assertIsNotNone(top["input_tokens"]["pct"])
            self.assertIsNotNone(top["output_tokens"]["pct"])
            cr = otm["cache_ratios"]["components"]
            self.assertAlmostEqual(cr["cache_read_tokens"]["pct"], 80 / 500 * 100, places=2)
            self.assertAlmostEqual(cr["cache_write_tokens"]["pct"], 20 / 500 * 100, places=2)
            rr = otm["reasoning_ratio"]["components"]
            self.assertAlmostEqual(rr["reasoning_tokens"]["pct"], 85 / 200 * 100, places=2)
            # No warning falsely claims the aggregate is inconsistent, since
            # it numerically isn't in this scenario — but no partition or
            # unique-token claim is made either (checked via overlap_note).
            self.assertIn("not a partition", otm["overlap_note"])
            self.assertIn("counter volume", otm["overlap_note"])

    def test_missing_cache_or_reasoning_columns_omit_ratios(self):
        narrow_cols = ["session_id", "model", "agent_id", "initiator", "input_tokens",
                       "output_tokens", "total_nano_aiu", "duration_ms", "created_at"]
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=100, output_tokens=50)], columns=narrow_cols)
            report, _ = run_report(db, "s1")
            otm = report["overall_token_mix"]
            self.assertIsNone(otm["cache_ratios"])
            self.assertIsNone(otm["reasoning_ratio"])
            self.assertTrue(any("cache_read_tokens/cache_write_tokens column unavailable" in w
                                 for w in otm["warnings"]))
            self.assertTrue(any("reasoning_tokens column unavailable" in w for w in otm["warnings"]))

    def test_top_level_percentage_sums_within_tolerance(self):
        """Only the top-level input/output pair is ever claimed to sum to
        100% — cache_ratios and reasoning_ratio are independent ratios and
        are never asserted to sum to anything."""
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(input_tokens=333, output_tokens=667, cache_read_tokens=111,
                         cache_write_tokens=37, reasoning_tokens=59),
            ])
            report, _ = run_report(db, "s1")
            otm = report["overall_token_mix"]
            top = otm["top_level"]["components"]
            self.assertAlmostEqual(top["input_tokens"]["pct"] + top["output_tokens"]["pct"],
                                    100.0, delta=0.05)
            cr = otm["cache_ratios"]["components"]
            self.assertAlmostEqual(cr["cache_read_tokens"]["pct"], 111 / 333 * 100, places=2)
            self.assertAlmostEqual(cr["cache_write_tokens"]["pct"], 37 / 333 * 100, places=2)
            rr = otm["reasoning_ratio"]["components"]
            self.assertAlmostEqual(rr["reasoning_tokens"]["pct"], 59 / 667 * 100, places=2)

    def test_json_output_adds_overall_token_mix_without_removing_existing_fields(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(input_tokens=800, output_tokens=200, cache_read_tokens=100,
                         cache_write_tokens=50, reasoning_tokens=40, total_nano_aiu=1000),
            ])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--store", db, "--state-dir", state_dir,
                 "--session-id", "s1", "--json"],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = json.loads(proc.stdout)
            # Stable prior top-level shape is untouched.
            for key in ("session_id", "root_only", "snapshot_ts", "generated_at",
                        "session_active", "warnings", "report"):
                self.assertIn(key, out)
            report = out["report"]
            for key in ("totals", "by_model", "hotspots", "ranked_opportunities",
                        "skipped_metrics", "dimensions"):
                self.assertIn(key, report)
            # New stable field.
            otm = report["overall_token_mix"]
            self.assertIn("top_level", otm)
            self.assertIn("cache_ratios", otm)
            self.assertIn("reasoning_ratio", otm)
            self.assertIn("overlap_note", otm)
            self.assertIn("warnings", otm)
            self.assertEqual(otm["top_level"]["denominator"], 1000)
            self.assertEqual(otm["cache_ratios"]["denominator"], 800)
            self.assertEqual(otm["reasoning_ratio"]["denominator"], 200)

    def test_human_output_orders_overall_token_mix_before_cost_concentration(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(input_tokens=800, output_tokens=200, cache_read_tokens=100,
                         cache_write_tokens=50, reasoning_tokens=40, total_nano_aiu=1000),
            ])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--store", db, "--state-dir", state_dir,
                 "--session-id", "s1"],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            mix_pos = proc.stdout.index("-- Overall token mix --")
            concentration_pos = proc.stdout.index("-- Cost concentration")
            self.assertLess(mix_pos, concentration_pos)


class TimestampNormalizationTests(unittest.TestCase):
    """Regression tests for the created_at parsing/snapshot-filtering fix:
    parse_iso_ts must return a UTC-aware datetime for every accepted local
    form (SQLite default, ISO 'Z', ISO explicit offset), and snapshot
    filtering must use real datetime comparison, never SQLite's lexical
    TEXT order."""

    def test_parse_iso_ts_returns_aware_utc_for_every_accepted_form(self):
        sqlite_style = scr.parse_iso_ts("2026-01-01 10:44:16")
        z_style = scr.parse_iso_ts("2026-01-01T10:44:16.309Z")
        offset_style = scr.parse_iso_ts("2026-01-01T05:44:16+00:00")
        for ts in (sqlite_style, z_style, offset_style):
            self.assertIsNotNone(ts)
            self.assertIsNotNone(ts.tzinfo, f"{ts!r} must be timezone-aware")

    def test_mixed_naive_and_aware_forms_do_not_crash_min_max(self):
        # Before the fix, parse_iso_ts returned a naive datetime for a
        # SQLite-style timestamp and an aware datetime for an ISO 'Z'
        # timestamp; comparing them (as build_time_bucket_labels' min()/
        # max() does) raised TypeError. This must not raise.
        values = [scr.parse_iso_ts("2026-01-01 10:44:16"),
                  scr.parse_iso_ts("2026-01-01T10:44:16.309Z")]
        try:
            lo, hi = min(values), max(values)
        except TypeError as e:
            self.fail(f"min/max raised on mixed timestamp forms: {e}")
        self.assertLessEqual(lo, hi)

    def test_report_does_not_crash_with_mixed_created_at_forms(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", input_tokens=10, created_at="2026-01-01 10:44:16"),
                base_row(model="model-a", input_tokens=20,
                         created_at="2026-01-01T10:45:16.309Z"),
                base_row(model="model-a", input_tokens=30,
                         created_at="2026-01-01T10:46:16+00:00"),
                base_row(model="model-a", input_tokens=40, created_at="not-a-date"),
            ])
            report, warnings = run_report(db, "s1", tree_order=["time_bucket"], tree_depth=1)
            root = next(r for r in report["cost_tree"]["roots"] if r["metric"] == "input_tokens")
            self.assertEqual(root["raw_value"], 100)
            assert_tree_reconciles(self, root, root["raw_value"])

    def test_snapshot_filter_excludes_late_same_day_row_by_real_time_not_text(self):
        # SQLite-style created_at uses a space (0x20) where ISO 'Z' style
        # uses 'T' (0x54); ' ' sorts before 'T', so a lexical compare of
        # "2026-01-01 23:59:00" <= "2026-01-01T12:00:00Z" is True even
        # though 23:59 UTC is AFTER noon UTC the same day. The old
        # implementation would wrongly keep this row; the fix must exclude
        # it by real datetime order.
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", input_tokens=100,
                         created_at="2026-01-01 23:59:00"),
                base_row(model="model-a", input_tokens=7,
                         created_at="2026-01-01T05:00:00Z"),
            ])
            report, _ = run_report(db, "s1", snapshot="2026-01-01T12:00:00Z")
            self.assertEqual(report["totals"]["input_tokens"], 7)

    def test_snapshot_filter_includes_early_same_day_row_correctly(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", input_tokens=100,
                         created_at="2026-01-01 05:00:00"),
            ])
            report, _ = run_report(db, "s1", snapshot="2026-01-01T12:00:00Z")
            self.assertEqual(report["totals"]["input_tokens"], 100)

    def test_unparsable_row_timestamp_is_kept_with_a_clear_warning(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [
                base_row(model="model-a", input_tokens=9, created_at="garbage"),
                base_row(model="model-a", input_tokens=1,
                         created_at="2026-01-01T00:00:00Z"),
            ])
            report, warnings = run_report(db, "s1", snapshot="2099-01-01T00:00:00Z")
            self.assertEqual(report["totals"]["input_tokens"], 10)
            self.assertTrue(any("unparsable created_at" in w for w in warnings))


class SnapshotCliValidationTests(unittest.TestCase):
    def _run(self, *extra_args):
        return subprocess.run(
            [sys.executable, SCRIPT_PATH, *extra_args],
            capture_output=True, text=True, timeout=30)

    def test_invalid_snapshot_rejected_with_clear_nonzero_exit(self):
        proc = self._run("--snapshot", "not-a-timestamp")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("snapshot", proc.stderr.lower())

    def test_valid_iso_z_snapshot_accepted(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = self._run("--store", db, "--state-dir", state_dir, "--session-id", "s1",
                              "--snapshot", "2099-01-01T00:00:00Z", "--json")
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_valid_explicit_offset_snapshot_accepted(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = self._run("--store", db, "--state-dir", state_dir, "--session-id", "s1",
                              "--snapshot", "2099-01-01T00:00:00+05:30", "--json")
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_valid_sqlite_style_snapshot_accepted(self):
        with local_tempdir() as d:
            db = os.path.join(d, "s.db")
            make_db(db, [base_row(input_tokens=10)])
            state_dir = os.path.join(d, "state")
            os.makedirs(state_dir)
            proc = self._run("--store", db, "--state-dir", state_dir, "--session-id", "s1",
                              "--snapshot", "2099-01-01 00:00:00", "--json")
            self.assertEqual(proc.returncode, 0, proc.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
