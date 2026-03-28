#!/usr/bin/env python3
"""
judge.py — Deck quality scoring for Vela eval.

Modes:
  python3 judge.py <deck.json> --deterministic-only --json   # Free metrics only
  python3 judge.py <deck.json> --prompt                      # Generate judge prompt
  python3 judge.py --parse-response <response.json>          # Parse judge output
  python3 judge.py <deck.json> --json                        # Both deterministic + prompt

A/B Blind Comparison:
  python3 judge.py --ab <deck_a.json> <deck_b.json> --prompt # Generate blind A/B prompt
  python3 judge.py --ab-parse <response.json>                # Parse A/B response
  python3 judge.py --ab <deck_a.json> <deck_b.json> --json   # Full A/B with deterministic

The LLM judge is designed to run as a BLIND subagent:
  - System prompt: evals/prompts/judge-rubric.md (single) or judge-ab-rubric.md (A/B)
  - User prompt: deck JSON summary (from --prompt)
  - The subagent has NO access to scenario, SKILL.md, or version info
  - In A/B mode, deck order is randomized to eliminate position bias
"""

import json
import math
import os
import random
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent
RUBRIC_PATH = EVAL_DIR / "prompts" / "judge-rubric.md"
AB_RUBRIC_PATH = EVAL_DIR / "prompts" / "judge-ab-rubric.md"

# All 21 Vela block types
ALL_BLOCK_TYPES = {
    "heading", "text", "quote", "badge", "callout",
    "bullets", "icon-row", "tag-group",
    "grid", "table", "metric", "progress", "timeline",
    "flow", "steps",
    "image", "code", "svg",
    "spacer", "divider",
}


def load_deck(path):
    """Load deck JSON and extract slides + blocks in any format."""
    with open(path) as f:
        data = json.load(f)

    slides = []
    if isinstance(data, list):
        # Turbo format
        if len(data) > 1 and isinstance(data[1], list):
            for lane in data[1]:
                if isinstance(lane, list) and len(lane) > 1:
                    for item in lane[1]:
                        if isinstance(item, list) and len(item) > 3:
                            for s in item[3]:
                                slides.append(s)
    elif "G" in data:
        # Compact grouped format
        for group in data.get("G", []):
            slides.extend(group.get("S", []))
    elif "S" in data:
        # Compact format
        slides = data.get("S", [])
    elif "lanes" in data:
        # Full format
        for lane in data.get("lanes", []):
            for item in lane.get("items", []):
                slides.extend(item.get("slides", []))

    return data, slides


def extract_blocks(slide):
    """Get block dicts from a slide (handles compact/full)."""
    blocks = slide.get("blocks", slide.get("B", []))
    return [b for b in blocks if isinstance(b, dict)]


def get_block_type(block):
    """Get block type from full or compact format."""
    return block.get("type", block.get("_", ""))


def deterministic_scores(data, slides):
    """Compute free quality metrics from deck structure."""
    raw = json.dumps(data, ensure_ascii=False)

    # Block type diversity
    types_found = set()
    total_blocks = 0
    type_counts = {}
    total_words = 0
    slides_with_heading = 0
    slides_with_badge = 0

    for slide in slides:
        blocks = extract_blocks(slide)
        has_heading = False
        has_badge = False

        for b in blocks:
            bt = get_block_type(b)
            if bt:
                types_found.add(bt)
                type_counts[bt] = type_counts.get(bt, 0) + 1
                total_blocks += 1
            if bt == "heading":
                has_heading = True
            if bt == "badge":
                has_badge = True

            # Count words in text content
            text = b.get("text", b.get("x", ""))
            if isinstance(text, str):
                total_words += len(text.split())

        if has_heading:
            slides_with_heading += 1
        if has_badge:
            slides_with_badge += 1

    n_slides = max(len(slides), 1)

    # Shannon entropy of block type distribution
    entropy = 0
    if total_blocks > 0:
        for count in type_counts.values():
            p = count / total_blocks
            if p > 0:
                entropy -= p * math.log2(p)

    # Theme variety: distinct bg/color combos
    themes = set()
    for slide in slides:
        if isinstance(slide, dict):
            bg = slide.get("bg", slide.get("b", ""))
            color = slide.get("color", slide.get("c", ""))
            if bg or color:
                themes.add((str(bg), str(color)))

    # Block diversity score (0-1)
    block_diversity = len(types_found) / len(ALL_BLOCK_TYPES)

    return {
        "block_diversity": round(block_diversity, 3),
        "block_types_used": len(types_found),
        "block_types_total": len(ALL_BLOCK_TYPES),
        "block_type_entropy": round(entropy, 3),
        "theme_variety": len(themes),
        "structure_consistency": round(slides_with_heading / n_slides, 3),
        "badge_rate": round(slides_with_badge / n_slides, 3),
        "content_density_words_per_slide": round(total_words / n_slides, 1),
        "content_density_blocks_per_slide": round(total_blocks / n_slides, 1),
        "slide_count": len(slides),
    }


def generate_prompt(deck_path):
    """Generate the user prompt for a blind judge subagent."""
    with open(deck_path) as f:
        deck_text = f.read()

    # Truncate very large decks to avoid token waste
    if len(deck_text) > 50000:
        deck_text = deck_text[:50000] + "\n... [truncated]"

    return f"Score this Vela Slides deck:\n\n```json\n{deck_text}\n```"


def parse_response(response_text):
    """Parse and validate judge subagent response."""
    # Try to extract JSON from response
    text = response_text.strip()

    # Handle markdown code blocks
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start)
        text = text[start:end].strip()
    elif "```" in text:
        start = text.index("```") + 3
        end = text.index("```", start)
        text = text[start:end].strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        return {"error": "Failed to parse judge response as JSON", "raw": response_text[:500]}

    # Validate structure
    dims = result.get("dimensions", {})
    expected = {"structural", "visual_hierarchy", "content_quality", "block_variety", "brand_consistency"}
    missing = expected - set(dims.keys())
    if missing:
        return {"error": f"Missing dimensions: {missing}", "partial": result}

    # Normalize scores
    for key in expected:
        dim = dims[key]
        if isinstance(dim, dict):
            score = dim.get("score", 0)
            dims[key]["score"] = max(1, min(3, int(score)))
        elif isinstance(dim, (int, float)):
            dims[key] = {"score": max(1, min(3, int(dim))), "reasoning": ""}

    # Compute overall
    scores = [dims[k]["score"] for k in expected]
    result["overall"] = round(sum(scores) / len(scores), 2)

    return result


def generate_ab_prompt(deck_path_a, deck_path_b):
    """Generate a blind A/B comparison prompt with randomized order.

    Returns (prompt, mapping) where mapping records which file is Deck 1 vs 2.
    """
    with open(deck_path_a) as f:
        text_a = f.read()
    with open(deck_path_b) as f:
        text_b = f.read()

    # Truncate large decks
    if len(text_a) > 40000:
        text_a = text_a[:40000] + "\n... [truncated]"
    if len(text_b) > 40000:
        text_b = text_b[:40000] + "\n... [truncated]"

    # Randomize order to eliminate position bias
    swap = random.choice([True, False])
    if swap:
        first_text, second_text = text_b, text_a
        mapping = {"deck_1": str(deck_path_b), "deck_2": str(deck_path_a), "swapped": True}
    else:
        first_text, second_text = text_a, text_b
        mapping = {"deck_1": str(deck_path_a), "deck_2": str(deck_path_b), "swapped": False}

    prompt = (
        "Compare these two Vela Slides decks and pick the better one.\n\n"
        "## Deck 1\n\n```json\n" + first_text + "\n```\n\n"
        "## Deck 2\n\n```json\n" + second_text + "\n```"
    )

    return prompt, mapping


def parse_ab_response(response_text):
    """Parse and validate A/B judge response."""
    text = response_text.strip()

    # Handle markdown code blocks
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start)
        text = text[start:end].strip()
    elif "```" in text:
        start = text.index("```") + 3
        end = text.index("```", start)
        text = text[start:end].strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        return {"error": "Failed to parse A/B judge response as JSON", "raw": response_text[:500]}

    # Validate required fields
    expected_dims = {"structural", "visual_hierarchy", "content_quality", "block_variety", "brand_consistency"}
    dims = result.get("dimensions", {})
    missing = expected_dims - set(dims.keys())
    if missing:
        return {"error": f"Missing dimensions: {missing}", "partial": result}

    # Validate each dimension has winner + reasoning
    for key in expected_dims:
        dim = dims[key]
        if isinstance(dim, dict):
            winner = dim.get("winner", "")
            if winner not in ("1", "2", "tie", 1, 2):
                dim["winner"] = "tie"
            else:
                dim["winner"] = str(winner)
        elif isinstance(dim, (int, float, str)):
            dims[key] = {"winner": str(dim), "reasoning": ""}

    # Compute overall winner
    winner = result.get("overall_winner", "")
    if str(winner) not in ("1", "2", "tie"):
        # Tally from dimensions
        wins = {"1": 0, "2": 0, "tie": 0}
        for key in expected_dims:
            w = dims[key].get("winner", "tie")
            wins[w] = wins.get(w, 0) + 1
        if wins["1"] > wins["2"]:
            result["overall_winner"] = "1"
        elif wins["2"] > wins["1"]:
            result["overall_winner"] = "2"
        else:
            result["overall_winner"] = "tie"
    else:
        result["overall_winner"] = str(winner)

    return result


def resolve_ab_result(ab_result, mapping):
    """Unswap the A/B result to map back to original file paths."""
    resolved = {
        "winner_file": None,
        "loser_file": None,
        "overall_winner": ab_result.get("overall_winner", "tie"),
        "swapped": mapping.get("swapped", False),
        "dimensions": ab_result.get("dimensions", {}),
    }

    winner = ab_result.get("overall_winner", "tie")
    if winner == "1":
        resolved["winner_file"] = mapping["deck_1"]
        resolved["loser_file"] = mapping["deck_2"]
    elif winner == "2":
        resolved["winner_file"] = mapping["deck_2"]
        resolved["loser_file"] = mapping["deck_1"]

    # Also resolve per-dimension winners
    resolved["dimension_winners"] = {}
    for dim_name, dim_data in ab_result.get("dimensions", {}).items():
        w = dim_data.get("winner", "tie") if isinstance(dim_data, dict) else "tie"
        if w == "1":
            resolved["dimension_winners"][dim_name] = mapping["deck_1"]
        elif w == "2":
            resolved["dimension_winners"][dim_name] = mapping["deck_2"]
        else:
            resolved["dimension_winners"][dim_name] = "tie"

    return resolved


def main():
    args = sys.argv[1:]
    do_json = "--json" in args
    do_deterministic = "--deterministic-only" in args
    do_prompt = "--prompt" in args
    do_parse = "--parse-response" in args
    do_ab = "--ab" in args
    do_ab_parse = "--ab-parse" in args

    # ── A/B Comparison Mode ──
    if do_ab:
        # Collect the two deck paths (non-flag args that are files)
        deck_paths = [a for a in args if not a.startswith("--") and os.path.isfile(a)]
        if len(deck_paths) < 2:
            print("Usage: python3 judge.py --ab <deck_a.json> <deck_b.json> --prompt", file=sys.stderr)
            sys.exit(2)

        path_a, path_b = deck_paths[0], deck_paths[1]
        prompt, mapping = generate_ab_prompt(path_a, path_b)

        if do_prompt:
            # Output prompt + mapping file for later resolution
            mapping_path = EVAL_DIR / "output" / "ab-mapping.json"
            mapping_path.parent.mkdir(parents=True, exist_ok=True)
            with open(mapping_path, "w") as f:
                json.dump(mapping, f, indent=2)
            print(prompt)
            print(f"\n# Mapping saved to {mapping_path}", file=sys.stderr)
            sys.exit(0)

        if do_json:
            # Deterministic scores for both + prompt
            data_a, slides_a = load_deck(path_a)
            data_b, slides_b = load_deck(path_b)
            det_a = deterministic_scores(data_a, slides_a)
            det_b = deterministic_scores(data_b, slides_b)
            print(json.dumps({
                "deck_a": {"path": path_a, "deterministic": det_a},
                "deck_b": {"path": path_b, "deterministic": det_b},
                "ab_prompt": prompt,
                "mapping": mapping,
                "rubric_path": str(AB_RUBRIC_PATH),
            }, indent=2))
            sys.exit(0)

        # Default: print instructions
        print(f"A/B Blind Comparison: {path_a} vs {path_b}")
        print(f"Order {'swapped' if mapping['swapped'] else 'preserved'} (Deck 1 = {mapping['deck_1']})")
        print(f"\nTo run blind A/B judge, spawn a subagent with:")
        print(f"  System: {AB_RUBRIC_PATH}")
        print(f"  User:   python3 judge.py --ab {path_a} {path_b} --prompt")
        sys.exit(0)

    if do_ab_parse:
        # Parse A/B response and resolve back to original files
        response_path = None
        mapping_path = EVAL_DIR / "output" / "ab-mapping.json"
        for a in args:
            if not a.startswith("--") and os.path.isfile(a) and a != str(mapping_path):
                response_path = a
                break

        if response_path:
            with open(response_path) as f:
                text = f.read()
        else:
            text = sys.stdin.read()

        ab_result = parse_ab_response(text)
        if "error" in ab_result:
            print(json.dumps(ab_result, indent=2))
            sys.exit(1)

        # Resolve mapping
        if mapping_path.exists():
            with open(mapping_path) as f:
                mapping = json.load(f)
            resolved = resolve_ab_result(ab_result, mapping)
            ab_result["resolved"] = resolved

        print(json.dumps(ab_result, indent=2))
        sys.exit(0)

    # ── Single Deck Mode ──
    if do_parse:
        # Parse mode: read response from file or stdin
        if len(args) >= 2:
            idx = args.index("--parse-response")
            if idx + 1 < len(args):
                with open(args[idx + 1]) as f:
                    text = f.read()
            else:
                text = sys.stdin.read()
        else:
            text = sys.stdin.read()
        result = parse_response(text)
        print(json.dumps(result, indent=2))
        sys.exit(0 if "error" not in result else 1)

    # Need a deck path
    deck_path = None
    for a in args:
        if not a.startswith("--") and os.path.isfile(a):
            deck_path = a
            break

    if not deck_path:
        print("Usage:", file=sys.stderr)
        print("  python3 judge.py <deck.json> --deterministic-only --json", file=sys.stderr)
        print("  python3 judge.py <deck.json> --prompt", file=sys.stderr)
        print("  python3 judge.py --parse-response <response.json>", file=sys.stderr)
        print("  python3 judge.py --ab <a.json> <b.json> --prompt   # Blind A/B", file=sys.stderr)
        print("  python3 judge.py --ab-parse <response.json>        # Parse A/B result", file=sys.stderr)
        sys.exit(2)

    data, slides = load_deck(deck_path)
    det = deterministic_scores(data, slides)

    if do_prompt:
        prompt = generate_prompt(deck_path)
        print(prompt)
        sys.exit(0)

    if do_deterministic:
        if do_json:
            print(json.dumps({"deterministic": det}, indent=2))
        else:
            print(f"\nDeterministic Quality — {deck_path}")
            print(f"{'─' * 50}")
            print(f"  Slides:           {det['slide_count']}")
            print(f"  Block types:      {det['block_types_used']}/{det['block_types_total']} ({det['block_diversity']:.0%})")
            print(f"  Type entropy:     {det['block_type_entropy']:.2f} bits")
            print(f"  Theme variety:    {det['theme_variety']} combos")
            print(f"  Heading rate:     {det['structure_consistency']:.0%}")
            print(f"  Badge rate:       {det['badge_rate']:.0%}")
            print(f"  Words/slide:      {det['content_density_words_per_slide']:.0f}")
            print(f"  Blocks/slide:     {det['content_density_blocks_per_slide']:.1f}")
        sys.exit(0)

    # Default: print both deterministic + prompt instructions
    if do_json:
        print(json.dumps({
            "deterministic": det,
            "judge_prompt": generate_prompt(deck_path),
            "rubric_path": str(RUBRIC_PATH),
        }, indent=2))
    else:
        # Pretty print deterministic
        print(f"\nDeterministic Quality — {deck_path}")
        print(f"{'─' * 50}")
        for k, v in det.items():
            print(f"  {k}: {v}")
        print(f"\nTo run LLM judge, spawn a blind subagent with:")
        print(f"  System: {RUBRIC_PATH}")
        print(f"  User:   python3 judge.py {deck_path} --prompt")


if __name__ == "__main__":
    main()
