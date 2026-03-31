#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Sync the CLI command reference in SKILL.md from vela.py CAPABILITIES dict.

Usage:
  python3 sync-skill-docs.py              # Preview changes
  python3 sync-skill-docs.py --write      # Write to SKILL.md

Reads CAPABILITIES from vela.py, generates the command reference section,
and patches it into SKILL.md between marker comments.
"""

import json
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
SKILL_MD = os.path.join(SKILL_DIR, "SKILL.md")
VELA_PY = os.path.join(SCRIPT_DIR, "vela.py")

# Markers in SKILL.md where the auto-generated section lives
START_MARKER = "<!-- BEGIN AUTO-GENERATED CLI REFERENCE -->"
END_MARKER = "<!-- END AUTO-GENERATED CLI REFERENCE -->"


def get_capabilities():
    """Run vela --capabilities and parse JSON output."""
    result = subprocess.run(
        [sys.executable, VELA_PY, "--capabilities"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"ERROR: vela --capabilities failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def generate_section(caps):
    """Generate markdown CLI reference from capabilities."""
    lines = [START_MARKER, "", f"### CLI Quick Reference (v{caps['version']})", ""]

    for resource, info in caps["resources"].items():
        commands = info["commands"]
        lines.append(f"**`vela {resource}`** — {info['description']}")
        lines.append("")
        lines.append("```")
        if isinstance(commands, dict):
            for name, usage in commands.items():
                lines.append(usage)
        else:
            # Legacy: array of command names
            for name in commands:
                lines.append(f"vela {resource} {name} <deck.json>")
        lines.append("```")
        lines.append("")

    flags = caps.get("global_flags", [])
    if flags:
        lines.append(f"**Global flags:** {', '.join(f'`{f}`' for f in flags)}")
        lines.append("")

    codes = caps.get("exit_codes", {})
    if codes:
        lines.append(f"**Exit codes:** {', '.join(f'{k}={v}' for k, v in codes.items())}")
        lines.append("")

    lines.append(END_MARKER)
    return "\n".join(lines)


def main():
    write = "--write" in sys.argv

    caps = get_capabilities()
    section = generate_section(caps)

    with open(SKILL_MD, "r", encoding="utf-8") as f:
        content = f.read()

    if START_MARKER in content and END_MARKER in content:
        # Replace existing section
        pattern = re.escape(START_MARKER) + r".*?" + re.escape(END_MARKER)
        new_content = re.sub(pattern, section, content, flags=re.DOTALL)
    else:
        # Insert before "## Workflow A" (first workflow section)
        insert_point = "## Workflow A"
        if insert_point in content:
            new_content = content.replace(insert_point, section + "\n\n" + insert_point)
        else:
            print("WARNING: Could not find insertion point in SKILL.md", file=sys.stderr)
            print(section)
            return

    if write:
        with open(SKILL_MD, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"✅ Updated {SKILL_MD}")
        # Show diff
        lines_old = content.count("\n")
        lines_new = new_content.count("\n")
        print(f"   {lines_old} → {lines_new} lines ({lines_new - lines_old:+d})")
    else:
        print("Preview (use --write to apply):\n")
        print(section)


if __name__ == "__main__":
    main()
