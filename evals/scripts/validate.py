#!/usr/bin/env python3
"""
validate.py — Check deck outputs against scenario assertions.

Usage:
  python3 validate.py <deck.json> <scenario.json>
  python3 validate.py <deck.json> --quick    # Basic checks only

Assertions:
  file_exists, json_valid, slide_count, block_type_present,
  ships_ok, slide_title_equals, block_text_contains,
  text_present, text_not_present
"""

import json
import sys
import os
import subprocess

VELA_PATH = os.environ.get("VELA_PATH", "vela")


def load_deck(path):
    """Load and parse deck JSON, handling compact/full/turbo."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    # Extract slides regardless of format
    slides = []
    if isinstance(data, list):
        # Turbo format
        for lane in data[1]:
            for item in lane[1]:
                for s in item[3]:
                    slides.append({"title": s[0], "blocks_raw": s[9] if len(s) > 9 else []})
    elif "S" in data:
        # Compact format
        for s in data["S"]:
            slides.append({
                "title": s.get("n", ""),
                "blocks": s.get("B", []),
            })
    elif "lanes" in data:
        # Full format
        for lane in data.get("lanes", []):
            for item in lane.get("items", []):
                for s in item.get("slides", []):
                    slides.append(s)

    return data, slides


def check_assertion(assertion, deck_path, raw_data, slides):
    """Check a single assertion. Returns (passed, evidence)."""
    atype = assertion["type"]

    if atype == "file_exists":
        p = assertion.get("path", deck_path)
        ok = os.path.exists(p)
        return ok, f"{'exists' if ok else 'missing'}: {p}"

    elif atype == "json_valid":
        try:
            p = assertion.get("path", deck_path)
            with open(p, encoding="utf-8") as f:
                json.load(f)
            return True, "valid JSON"
        except Exception as e:
            return False, f"invalid JSON: {e}"

    elif atype == "slide_count":
        expected = assertion["expected"]
        actual = len(slides)
        return actual == expected, f"expected {expected}, got {actual}"

    elif atype == "block_type_present":
        bt = assertion["block_type"]
        raw = json.dumps(raw_data, ensure_ascii=False)
        # Check for type in any format
        found = (
            f'"type":"{bt}"' in raw
            or f'"_":"{bt}"' in raw
            or f'"type": "{bt}"' in raw
        )
        return found, f"{'found' if found else 'not found'}: {bt}"

    elif atype == "ships_ok":
        try:
            # Use 'deck validate' instead of 'deck ship' — ship requires
            # assembly (template file) which may not be available locally.
            vela_cmd = VELA_PATH.split() + ["deck", "validate", deck_path]
            r = subprocess.run(
                vela_cmd,
                capture_output=True, text=True, timeout=30
            )
            ok = r.returncode == 0
            return ok, f"exit={r.returncode}" + (f" {r.stderr[:100]}" if not ok else "")
        except FileNotFoundError:
            return False, "vela not found in PATH"
        except Exception as e:
            return False, str(e)

    elif atype == "slide_title_equals":
        idx = assertion["slide"] - 1
        expected = assertion["expected"]
        if idx >= len(slides):
            return False, f"slide {assertion['slide']} not found (have {len(slides)})"
        actual = slides[idx].get("title", slides[idx].get("n", ""))
        return actual == expected, f"expected '{expected}', got '{actual}'"

    elif atype == "block_text_contains":
        idx = assertion["slide"] - 1
        bi = assertion.get("block_index", 0)
        expected = assertion["expected"]
        if idx >= len(slides):
            return False, f"slide {assertion['slide']} not found"
        blocks = slides[idx].get("blocks", slides[idx].get("B", []))
        if bi >= len(blocks):
            return False, f"block {bi} not found in slide {assertion['slide']}"
        block = blocks[bi]
        text = block.get("text", block.get("x", "")) if isinstance(block, dict) else ""
        return expected in text, f"{'found' if expected in text else 'not found'}: '{expected}' in block {bi}"

    elif atype == "text_present":
        raw = json.dumps(raw_data, ensure_ascii=False)
        text = assertion["text"]
        return text in raw, f"{'found' if text in raw else 'not found'}: '{text}'"

    elif atype == "text_not_present":
        raw = json.dumps(raw_data, ensure_ascii=False)
        text = assertion["text"]
        return text not in raw, f"{'absent' if text not in raw else 'STILL PRESENT'}: '{text}'"

    else:
        return False, f"unknown assertion type: {atype}"


def validate(deck_path, assertions):
    """Run all assertions against a deck. Returns list of results."""
    raw_data, slides = load_deck(deck_path)
    results = []
    for a in assertions:
        passed, evidence = check_assertion(a, deck_path, raw_data, slides)
        results.append({
            "type": a["type"],
            "passed": passed,
            "evidence": evidence,
        })
    return results, slides


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 validate.py <deck.json> [<scenario.json>|--quick]", file=sys.stderr)
        sys.exit(1)

    deck_path = sys.argv[1]

    if "--quick" in sys.argv:
        assertions = [
            {"type": "file_exists"},
            {"type": "json_valid"},
            {"type": "ships_ok"},
        ]
    elif len(sys.argv) >= 3 and not sys.argv[2].startswith("--"):
        with open(sys.argv[2], encoding="utf-8") as f:
            scenarios_data = json.load(f)
        # Support --scenario <id> to pick a specific scenario
        scenario_id = None
        if "--scenario" in sys.argv:
            idx = sys.argv.index("--scenario")
            if idx + 1 < len(sys.argv):
                scenario_id = sys.argv[idx + 1]
        if scenario_id and "scenarios" in scenarios_data:
            matched = [s for s in scenarios_data["scenarios"] if s["id"] == scenario_id]
            assertions = matched[0]["assertions"] if matched else []
        elif "scenarios" in scenarios_data:
            # Use first scenario's assertions as default
            assertions = scenarios_data["scenarios"][0].get("assertions", [])
        else:
            assertions = scenarios_data.get("assertions", [])
    else:
        assertions = [
            {"type": "file_exists"},
            {"type": "json_valid"},
        ]

    results, slides = validate(deck_path, assertions)

    passed = sum(1 for r in results if r["passed"])
    total = len(results)

    print(f"\n{'✅' if passed == total else '❌'} {passed}/{total} assertions passed — {deck_path}")
    for r in results:
        icon = "✅" if r["passed"] else "❌"
        print(f"  {icon} {r['type']}: {r['evidence']}")

    if "--json" in sys.argv:
        print(json.dumps({"passed": passed, "total": total, "slides": len(slides), "results": results}, indent=2))

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
