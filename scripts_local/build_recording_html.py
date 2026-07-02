#!/usr/bin/env python3
"""Build a fully self-contained, CDN-free Vela HTML for browser recording.

Mirrors serve.py's build_browser_html transforms but points React / ReactDOM /
lucide-react / Babel at LOCAL vendored UMD builds (the CDNs esm.sh/unpkg are
network-blocked in this container). Output is a portable dir with index.html +
vendor/ that Chromium can open via file://.

Usage: build_recording_html.py <deck.vela|folder-with-deck> <out-dir>
"""
import json, os, re, sys, shutil

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(REPO, "skills", "vela-slides")
LOCAL_HTML = os.path.join(SKILL, "app", "local.html")
VELA_JSX = os.path.join(SKILL, "app", "vela.jsx")
NM = os.path.join(REPO, "node_modules")

VENDOR = {
    "react.js": os.path.join(NM, "react/umd/react.development.js"),
    "react-dom.js": os.path.join(NM, "react-dom/umd/react-dom.development.js"),
    "lucide-react.js": os.path.join(NM, "lucide-react/dist/umd/lucide-react.js"),
    "babel.min.js": os.path.join(NM, "@babel/standalone/babel.min.js"),
}


def escape_for_script_context(s):
    # JSON string already; escape the HTML-significant sequences for <script>
    return s.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def build(deck_path, out_dir):
    with open(VELA_JSX, encoding="utf-8") as f:
        vela = f.read()
    with open(LOCAL_HTML, encoding="utf-8") as f:
        html = f.read()

    deck_data = json.load(open(deck_path, encoding="utf-8"))
    deck_json = json.dumps(deck_data, ensure_ascii=False, separators=(",", ":"))
    marker = "const STARTUP_PATCH = null;"
    if marker not in vela:
        raise SystemExit("STARTUP_PATCH marker missing")
    vela = vela.replace(marker, f"const STARTUP_PATCH = {escape_for_script_context(deck_json)};", 1)

    vela = re.sub(r'^import\s+\{[^}]+\}\s+from\s+"react";\s*$', '', vela, flags=re.M)
    vela = re.sub(r'^import\s+\{[^}]+\}\s+from\s+"lucide-react";\s*$', '', vela, flags=re.M)
    vela = re.sub(r'^import\s+\*\s+as\s+\w+\s+from\s+"lucide-react";\s*$', '', vela, flags=re.M)
    vela = re.sub(r'^export\s+default\s+function\s+', 'function ', vela, flags=re.M)
    shim = (
        "const { useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;\n"
        "const _LucideAll = window.lucideReact;\n"
        "const { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown } = window.lucideReact;\n"
    )
    vela = shim + vela
    vela = vela.replace("const VELA_LOCAL_MODE = false;", "const VELA_LOCAL_MODE = true;", 1)
    vela = vela.replace("const VELA_CHANNEL_PORT = 0;", "const VELA_CHANNEL_PORT = 0;", 1)
    vela = re.sub(r"</(?=script)", r"<\\/", vela, flags=re.I)
    vela = vela.replace("<!--", "<\\!--")

    # Replace the CDN importmap + esm module block + unpkg babel with local UMD.
    # Kill the importmap script.
    html = re.sub(r'<script type="importmap">.*?</script>', '', html, flags=re.S)
    # Replace the esm module block that sets globals with UMD-based globals.
    umd_block = (
        '<script src="vendor/react.js"></script>\n'
        '<script src="vendor/react-dom.js"></script>\n'
        # lucide UMD reads global.react (lowercase); React UMD sets global.React.
        '<script>window.react = window.React;</script>\n'
        '<script src="vendor/lucide-react.js"></script>\n'
        '<script>\n'
        '  window.ReactDOM = ReactDOM;\n'
        '  window.lucideReact = window.LucideReact || window.lucide || {};\n'
        '  window._createRoot = ReactDOM.createRoot;\n'
        '  window._depsReady = true;\n'
        '  window.dispatchEvent(new Event("vela-deps-ready"));\n'
        '</script>'
    )
    html = re.sub(r'<script type="module">.*?</script>', umd_block, html, count=1, flags=re.S)
    html = html.replace('<script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js"></script>',
                        '<script src="vendor/babel.min.js"></script>')
    html = html.replace("__VELA_JSX_PLACEHOLDER__", vela)
    html = html.replace("__VELA_CHANNEL_PORT__", "0")
    html = html.replace("'__VELA_DECK_PATH__'", json.dumps(os.path.basename(deck_path)))

    os.makedirs(os.path.join(out_dir, "vendor"), exist_ok=True)
    for name, src in VENDOR.items():
        shutil.copyfile(src, os.path.join(out_dir, "vendor", name))
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    print("Built:", os.path.join(out_dir, "index.html"))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: build_recording_html.py <deck.vela> <out-dir>")
    build(sys.argv[1], sys.argv[2])
