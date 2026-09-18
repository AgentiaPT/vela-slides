#!/usr/bin/env python3
"""
Preprocess skills/vela-slides/app/vela.jsx into resources/vela.jsx for the
Neutralino shell. Mirrors the transformations serve.py does at request time,
but writes the output to disk so the Neutralino static-file webview can load
it without a Python process in the loop.

Transformations applied:
  1. Strip ES module imports (React / lucide-react) — Babel-standalone does
     not resolve modules, so imports must become references to globals that
     the HTML shell has already set up (window.React / window.lucideReact).
  2. Remove the `export default` keyword in front of `function App()` — at
     script scope we want a plain function declaration.
  3. Set NL_MODE sentinel so vela.jsx can branch inside callClaudeAPI (PR3).
     VELA_LOCAL_MODE stays false and VELA_CHANNEL_PORT stays 0 — the
     Neutralino build does not use the HTTP channel.

The UMD shim that binds the React hooks and the lucide icons into local scope
is NOT written into this file. `resources/js/nl-boot.js` prepends it in memory
just before Babel transpiles the source. Keep it that way: the standalone-HTML
exporter fetches this same `vela.jsx` and prepends its own shim, so a shim in
the file makes the export declare `useState` twice and fail to parse.

This script is idempotent and fast. Run it whenever vela.jsx or a part-file
changes. `scripts/run.sh` invokes it automatically before `neu run`.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent                             # vela-neutralino/
REPO = PROJECT.parent                             # vela-slides/
SRC = REPO / "skills" / "vela-slides" / "app" / "vela.jsx"
DST = PROJECT / "resources" / "vela.jsx"



def preprocess(src_text: str) -> str:
    out = src_text

    # 1. Strip module imports that Babel-standalone cannot resolve.
    out = re.sub(
        r'^import\s+\{[^}]+\}\s+from\s+"react";\s*$', "", out, flags=re.MULTILINE
    )
    out = re.sub(
        r'^import\s+\{[^}]+\}\s+from\s+"lucide-react";\s*$',
        "",
        out,
        flags=re.MULTILINE,
    )
    out = re.sub(
        r'^import\s+\*\s+as\s+\w+\s+from\s+"lucide-react";\s*$',
        "",
        out,
        flags=re.MULTILINE,
    )

    # 2. `export default function App(...)` → `function App(...)` — script
    #    scope, not a module. render() below picks App up as a closure.
    out = re.sub(r"^export\s+default\s+function\s+", "function ", out, flags=re.MULTILINE)

    # 3. NB: do NOT prepend a UMD shim here and do NOT add a `const NL_MODE`
    #    sentinel. nl-boot.js adds the shim in memory at transpile time, so
    #    the file on disk stays a plain copy of the monolith that the
    #    standalone-HTML exporter can re-use. Neutralino itself injects
    #    `NL_MODE` as a global (runtime mode: "window"/"browser"/"cloud"/
    #    "chrome"), and a script-scoped lexical declaration collides with it.

    # 4. Flip VELA_LOCAL_MODE → true. Combined with VELA_CHANNEL_PORT = 0,
    #    this makes `velaAIAvailable()` return false cleanly, so AI buttons
    #    in the Neutralino build render as "unavailable" instead of trying
    #    to call `window.claude.complete` (which is artifact-only) or
    #    opening an HTTP channel we don't have. PR3 replaces this with a
    #    proper NL_MODE branch inside callClaudeAPI.
    out = out.replace(
        "const VELA_LOCAL_MODE = false;",
        "const VELA_LOCAL_MODE = true;",
        1,
    )
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Preprocess vela.jsx for Neutralino.")
    ap.add_argument(
        "--check",
        action="store_true",
        help="Only verify that the destination is up-to-date; exit 1 otherwise.",
    )
    args = ap.parse_args()

    if not SRC.exists():
        print(f"source not found: {SRC}", file=sys.stderr)
        return 1

    src_text = SRC.read_text(encoding="utf-8")
    new_text = preprocess(src_text)

    if args.check:
        if not DST.exists():
            print(f"{DST} missing", file=sys.stderr)
            return 1
        if DST.read_text(encoding="utf-8") != new_text:
            print(f"{DST} is stale — run scripts/sync-vela.py", file=sys.stderr)
            return 1
        print(f"{DST} is up-to-date")
        return 0

    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(new_text, encoding="utf-8")
    print(f"wrote {DST} ({len(new_text):,} chars)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
