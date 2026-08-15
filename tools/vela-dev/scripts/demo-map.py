#!/usr/bin/env python3
"""demo-map.py — generate src/parts/DEMO_MAP.md, the product tour's discovery index.

Why this exists: the product tour (src/parts/part-demo.jsx) showcases 20+
distinct app states in one scripted run. Without one canonical list, "is
feature X covered, and how do we know it still works" costs a full read of
the scene code. `DEMO_FEATURES` in part-demo.jsx is the single source of
truth (id, title, introduced version, NEW-badge flag, deck slide, stable
test ID / selector, cue, action, assertion, cleanup, safe/live class); this
script only reads and validates it, then renders the table.

Freshness is CI-gated (`--check`, wired into tests/test_vela.py, mirroring
the src/parts/CODEMAP.md gate in .github/workflows/ci.yml): DEMO_MAP.md must
regenerate in the same commit as any DEMO_FEATURES change.

Usage:
  python3 tools/vela-dev/scripts/demo-map.py           # (re)write DEMO_MAP.md
  python3 tools/vela-dev/scripts/demo-map.py --check   # exit 1 if stale or invalid
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts_manifest import CANONICAL_PARTS_DIR  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(CANONICAL_PARTS_DIR))
DEMO_PATH = os.path.join(CANONICAL_PARTS_DIR, "part-demo.jsx")
IMPORTS_PATH = os.path.join(CANONICAL_PARTS_DIR, "part-imports.jsx")
DEMO_MAP_PATH = os.path.join(CANONICAL_PARTS_DIR, "DEMO_MAP.md")
DECK_A = os.path.join(REPO_ROOT, "examples", "vela-demo.vela")
DECK_B = os.path.join(REPO_ROOT, "skills", "vela-slides", "examples", "vela-demo.json")

MIN_FEATURES = 20
MIN_NEW_FEATURES = 5
MIN_DURATION_MS = 60000
MAX_DURATION_MS = 120000

# One line per DEMO_FEATURES entry, fields in the fixed order the registry
# uses (see the comment above DEMO_FEATURES in part-demo.jsx). A plain regex,
# not a JS engine — deliberate, same tradeoff as gen-codemap.py.
FEATURE_RE = re.compile(
    r'\{\s*id:\s*"([^"]+)"'
    r',\s*title:\s*"([^"]+)"'
    r',\s*introduced:\s*"([^"]+)"'
    r',\s*isNew:\s*(true|false)'
    r',\s*deckSlide:\s*(null|"[^"]*")'
    r',\s*testId:\s*"([^"]+)"'
    r',\s*cue:\s*"([^"]+)"'
    r',\s*action:\s*"([^"]+)"'
    r',\s*assertion:\s*"([^"]+)"'
    r',\s*cleanup:\s*"([^"]+)"'
    r',\s*safety:\s*"([^"]+)"\s*\}'
)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def parse_features(demo_src):
    block_match = re.search(r"const DEMO_FEATURES = Object\.freeze\(\[(.*?)\n\]\);", demo_src, re.S)
    if not block_match:
        return []
    features = []
    for m in FEATURE_RE.finditer(block_match.group(1)):
        deck_slide_raw = m.group(5)
        deck_slide = None if deck_slide_raw == "null" else deck_slide_raw[1:-1]
        features.append({
            "id": m.group(1),
            "title": m.group(2),
            "introduced": m.group(3),
            "isNew": m.group(4) == "true",
            "deckSlide": deck_slide,
            "testId": m.group(6),
            "cue": m.group(7),
            "action": m.group(8),
            "assertion": m.group(9),
            "cleanup": m.group(10),
            "safety": m.group(11),
        })
    return features


def parse_scene_titles(demo_src):
    order_match = re.search(r"const DEMO_SCENE_ORDER = Object\.freeze\(\[(.*?)\]\);", demo_src, re.S)
    return re.findall(r'"([^"]+)"', order_match.group(1)) if order_match else []


def parse_scene_durations(demo_src):
    region = demo_src.split("function buildDemoScenes(ctx)", 1)[-1].split("const getDemoPlan", 1)[0]
    return [int(x) for x in re.findall(r"\bduration:\s*(\d+)", region)]


def parse_deck_slide_titles(deck_path):
    import json
    try:
        deck = json.loads(read(deck_path))
    except (OSError, ValueError):
        return None
    titles = []
    for lane in deck.get("lanes", []):
        for item in lane.get("items", []):
            for slide in item.get("slides", []):
                if slide.get("title"):
                    titles.append(slide["title"])
    return titles


def parse_changelog_versions(imports_src):
    changelog_match = re.search(r"const VELA_CHANGELOG = \[(.*?)\n\];", imports_src, re.S)
    changelog_src = changelog_match.group(1) if changelog_match else ""
    return set(re.findall(r'\{\s*v:\s*"([^"]+)"', changelog_src))


def source_has_test_id(test_id, combined_src, blocks_src):
    """A `testId` entry references either a data-testid literal, a
    data-block-type literal, or (prefixed `text:`) page-text fragments that
    the runtime UI battery checks directly — those are not statically
    checkable here, so they are treated as documented-only and skipped."""
    m = re.match(r"^\[data-testid='([^']+)'\]$", test_id)
    if m:
        name = m.group(1)
        return f'data-testid="{name}"' in combined_src or f"data-testid={{" in combined_src
    m = re.match(r"^\[data-block-type='([^']+)'\]$", test_id)
    if m:
        # `data-block-type={b.type}` is a dynamic JSX attribute (no literal
        # per-type string in the DOM markup) — verify the block TYPE is real
        # by checking RenderBlock's `case "<type>":` in part-blocks.jsx instead.
        name = m.group(1)
        return f'case "{name}":' in blocks_src
    if test_id == "[contenteditable='true']":
        return True  # a plain DOM attribute, not a Vela-authored test hook
    if test_id.startswith("text:"):
        return True  # documented only — verified live by the UI battery, not statically
    return False


def validate(features, demo_src, imports_src):
    problems = []

    ids = [f["id"] for f in features]
    if len(ids) != len(set(ids)):
        problems.append("DEMO_FEATURES has duplicate ids")
    if len(features) < MIN_FEATURES:
        problems.append(f"only {len(features)} features (need >= {MIN_FEATURES})")

    new_features = [f for f in features if f["isNew"]]
    changelog_versions = parse_changelog_versions(imports_src)
    for f in new_features:
        version = f["introduced"]
        try:
            major, minor = (float(p) for p in version.split("."))
        except ValueError:
            problems.append(f"{f['id']}: introduced version {version!r} is not numeric")
            continue
        if major < 13 or (major == 13 and minor <= 0):
            problems.append(f"{f['id']}: isNew but introduced {version} is not post-13.0")
        elif version not in changelog_versions:
            problems.append(f"{f['id']}: introduced {version} not found in VELA_CHANGELOG")
    if len(new_features) < MIN_NEW_FEATURES:
        problems.append(f"only {len(new_features)} isNew features (need >= {MIN_NEW_FEATURES})")

    scene_titles = set(parse_scene_titles(demo_src))
    for f in features:
        if f["title"] not in scene_titles:
            problems.append(f"{f['id']}: title {f['title']!r} is not a DEMO_SCENE_ORDER scene")

    deck_a_titles = parse_deck_slide_titles(DECK_A)
    deck_b_titles = parse_deck_slide_titles(DECK_B)
    if deck_a_titles is None:
        problems.append(f"could not read deck slide titles from {DECK_A}")
    else:
        for f in features:
            if f["deckSlide"] and f["deckSlide"] not in deck_a_titles:
                problems.append(f"{f['id']}: deckSlide {f['deckSlide']!r} not found in {os.path.basename(DECK_A)}")

    if os.path.exists(DECK_A) and os.path.exists(DECK_B):
        with open(DECK_A, "rb") as fa, open(DECK_B, "rb") as fb:
            if fa.read() != fb.read():
                problems.append(f"{os.path.basename(DECK_A)} and {os.path.basename(DECK_B)} are not byte-identical")

    combined_src = demo_src
    for extra in ("part-app.jsx", "part-chat.jsx", "part-slidepanel.jsx", "part-pdf.jsx",
                  "part-app-modals.jsx", "part-list.jsx", "part-slides.jsx"):
        path = os.path.join(CANONICAL_PARTS_DIR, extra)
        if os.path.exists(path):
            combined_src += read(path)
    blocks_src = read(os.path.join(CANONICAL_PARTS_DIR, "part-blocks.jsx")) if os.path.exists(
        os.path.join(CANONICAL_PARTS_DIR, "part-blocks.jsx")) else ""
    for f in features:
        if not source_has_test_id(f["testId"], combined_src, blocks_src):
            problems.append(f"{f['id']}: testId {f['testId']!r} not found in source")

    for f in features:
        for key in ("action", "assertion", "cleanup"):
            if not f[key].strip():
                problems.append(f"{f['id']}: {key} is empty")
        if f["safety"] != "safe":
            problems.append(f"{f['id']}: safety is {f['safety']!r}, expected 'safe' (the tour must stay live-AI-free)")

    durations = parse_scene_durations(demo_src)
    total = sum(durations)
    if not (MIN_DURATION_MS <= total <= MAX_DURATION_MS):
        problems.append(f"total planned duration {total}ms is outside {MIN_DURATION_MS}-{MAX_DURATION_MS}ms")

    return problems


def build(features, demo_src):
    durations = parse_scene_durations(demo_src)
    total_s = sum(durations) / 1000
    new_count = sum(1 for f in features if f["isNew"])
    out = []
    out.append("# DEMO_MAP — generated product-tour feature index. DO NOT EDIT BY HAND.")
    out.append("")
    out.append("Generated by `tools/vela-dev/scripts/demo-map.py` from `DEMO_FEATURES` in")
    out.append("`src/parts/part-demo.jsx`; CI fails if stale (`--check`, wired into")
    out.append("`tests/test_vela.py`). Regenerate in the same commit as any `DEMO_FEATURES`,")
    out.append("scene, or cue change.")
    out.append("")
    out.append(f"- {len(features)} distinct verified feature states ({new_count} marked NEW, post-13.0).")
    out.append(f"- Planned tour duration: {total_s:.1f}s (budget 60-120s).")
    out.append("")
    out.append("| id | title | introduced | NEW | deck slide | cue | test hook |")
    out.append("|---|---|---|---|---|---|---|")
    for f in features:
        deck_slide = f["deckSlide"] or "*(current slide)*"
        out.append(
            f"| `{f['id']}` | {f['title']} | {f['introduced']} | {'✅' if f['isNew'] else ''} "
            f"| {deck_slide} | `{f['cue']}` | `{f['testId']}` |"
        )
    out.append("")
    out.append("## Per-feature action, assertion, cleanup")
    out.append("")
    for f in features:
        out.append(f"### `{f['id']}`")
        out.append(f"- **Action:** {f['action']}")
        out.append(f"- **Assertion:** {f['assertion']}")
        out.append(f"- **Cleanup:** {f['cleanup']}")
        out.append(f"- **Safety class:** {f['safety']}")
        out.append("")
    return "\n".join(out)


def main():
    demo_src = read(DEMO_PATH)
    imports_src = read(IMPORTS_PATH)
    features = parse_features(demo_src)

    if not features:
        print("❌ DEMO_FEATURES not found or empty in part-demo.jsx")
        return 1

    problems = validate(features, demo_src, imports_src)
    if problems:
        print("❌ DEMO_FEATURES is invalid:")
        for p in problems:
            print(f"   - {p}")
        return 1

    content = build(features, demo_src)
    if "--check" in sys.argv:
        on_disk = read(DEMO_MAP_PATH) if os.path.exists(DEMO_MAP_PATH) else ""
        if on_disk != content:
            print("❌ DEMO_MAP.md is stale — regenerate it in the SAME commit as the change:")
            print("   python3 tools/vela-dev/scripts/demo-map.py")
            return 1
        print(f"✅ DEMO_MAP.md is fresh ({len(features)} features, {sum(1 for f in features if f['isNew'])} NEW)")
        return 0

    with open(DEMO_MAP_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"✅ wrote {DEMO_MAP_PATH} ({len(content):,} chars, {len(features)} features)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
