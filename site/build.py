#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela GitHub Pages — Static Site Builder

Generates a static site from the Vela app and example decks:
  _site/
    index.html          ← Gallery with deck cards
    vela.html           ← Viewer (loads ?deck= at runtime)
    vela.jsx            ← Engine (fetched by vela.html)
    examples/*.json     ← Example deck files

Usage:
  python3 site/build.py              # build into _site/
  python3 site/build.py --output dir # build into custom dir
"""

import json, os, re, shutil, sys, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, "skills", "vela-slides")
TEMPLATE_JSX = os.path.join(SKILL_DIR, "app", "vela.jsx")
EXAMPLES_DIR = os.path.join(ROOT, "examples")
CONCAT_SCRIPT = os.path.join(SKILL_DIR, "scripts", "concat.py")

DEFAULT_OUTPUT = os.path.join(ROOT, "_site")


def get_vela_version():
    """Extract VELA_VERSION from part-imports.jsx."""
    path = os.path.join(SKILL_DIR, "app", "parts", "part-imports.jsx")
    with open(path) as f:
        for line in f:
            m = re.search(r'VELA_VERSION\s*=\s*"([^"]+)"', line)
            if m:
                return m.group(1)
    return "0.0"


def load_deck_meta(json_path):
    """Extract metadata from a deck JSON for gallery cards."""
    with open(json_path) as f:
        deck = json.load(f)

    title = deck.get("deckTitle", "Untitled")
    lanes = deck.get("lanes", [])

    # Count slides & duration
    total_slides = 0
    total_duration = 0
    first_slide = None
    for lane in lanes:
        for item in lane.get("items", []):
            slides = item.get("slides", [])
            total_slides += len(slides)
            for s in slides:
                total_duration += s.get("duration", 0)
                if first_slide is None and slides:
                    first_slide = slides[0]

    # Extract first slide theme colors
    bg = "#0f172a"
    accent = "#3b82f6"
    color = "#e2e8f0"
    heading = ""
    subtitle = ""
    bg_gradient = None

    if first_slide:
        bg = first_slide.get("bg", bg)
        accent = first_slide.get("accent", accent)
        color = first_slide.get("color", color)
        bg_gradient = first_slide.get("bgGradient")
        for block in first_slide.get("blocks", []):
            if block.get("type") == "heading" and not heading:
                heading = block.get("text", "")
            elif block.get("type") == "text" and not subtitle:
                subtitle = block.get("text", "")

    return {
        "title": title,
        "heading": heading,
        "subtitle": subtitle,
        "slides": total_slides,
        "duration": total_duration,
        "lanes": len(lanes),
        "bg": bg,
        "accent": accent,
        "color": color,
        "bgGradient": bg_gradient,
        "filename": os.path.basename(json_path),
    }


# ━━━ Viewer HTML (vela.html) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def generate_viewer_html(version):
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vela Slides</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⛵</text></svg>" />
  <meta name="description" content="AI-native presentations — view and edit slides in the browser" />
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body, #root {{ width: 100%; height: 100%; overflow: hidden; }}
    body {{ background: #0f172a; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif; }}
    #vela-loading {{ display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; gap: 20px; opacity: 1; transition: opacity 0.4s ease; }}
    #vela-loading.fade-out {{ opacity: 0; pointer-events: none; }}
    #vela-loading .boat {{ font-size: 48px; animation: sail 3s ease-in-out infinite; }}
    @keyframes sail {{ 0%,100% {{ transform: translateY(0) rotate(-2deg); }} 50% {{ transform: translateY(-8px) rotate(2deg); }} }}
    #vela-loading .title {{ font-size: 24px; font-weight: 700; color: #e2e8f0; letter-spacing: 4px; }}
    #vela-loading .wave {{ height: 3px; width: 120px; background: linear-gradient(90deg, transparent, #3b82f6, #8b5cf6, #3b82f6, transparent); border-radius: 2px; animation: wave-move 2s ease-in-out infinite; }}
    @keyframes wave-move {{ 0%,100% {{ transform: scaleX(0.6); opacity: 0.5; }} 50% {{ transform: scaleX(1); opacity: 1; }} }}
    #vela-loading .msg {{ font-size: 13px; color: #64748b; transition: opacity 0.3s; }}
    #vela-loading .dots {{ display: inline-block; width: 20px; text-align: left; }}
    #vela-loading .error {{ color: #ef4444; font-size: 14px; margin-top: 12px; max-width: 480px; text-align: center; line-height: 1.5; }}
    #vela-loading .error a {{ color: #60a5fa; }}
  </style>
</head>
<body>
  <div id="root">
    <div id="vela-loading">
      <div class="boat">⛵</div>
      <div class="title">VELA</div>
      <div class="wave"></div>
      <div class="msg">Loading engine<span class="dots"></span></div>
    </div>
  </div>

  <!-- Dot animation -->
  <script>
    (function() {{
      var d = 0, dotsEl = document.querySelector('#vela-loading .dots');
      setInterval(function() {{ d = (d + 1) % 4; if (dotsEl) dotsEl.textContent = '.'.repeat(d); }}, 400);
    }})();
  </script>

  <!-- Import map -->
  <script type="importmap">
  {{
    "imports": {{
      "react": "https://esm.sh/react@18.3.1",
      "react-dom": "https://esm.sh/react-dom@18.3.1",
      "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
      "lucide-react": "https://esm.sh/lucide-react@0.344.0?external=react"
    }}
  }}
  </script>

  <!-- Load deps as ES modules -->
  <script type="module">
    import * as React from 'react';
    import * as ReactDOM from 'react-dom';
    import * as lucideReact from 'lucide-react';
    import {{ createRoot }} from 'react-dom/client';
    window.React = React;
    window.ReactDOM = ReactDOM;
    window.lucideReact = lucideReact;
    window._createRoot = createRoot;
    window._depsReady = true;
    window.dispatchEvent(new Event('vela-deps-ready'));
  </script>

  <!-- Babel standalone -->
  <script src="https://unpkg.com/@babel/standalone@7.24.0/babel.min.js"></script>

  <!-- Storage polyfill (localStorage) -->
  <script>
    window.storage = {{
      get: function(key) {{ return Promise.resolve(localStorage.getItem(key)); }},
      set: function(key, value) {{ try {{ localStorage.setItem(key, value); }} catch(e) {{}} return Promise.resolve(); }},
      delete: function(key) {{ localStorage.removeItem(key); return Promise.resolve(); }}
    }};
  </script>

  <!-- Vela Pages Loader -->
  <script>
    (function() {{
      var msgEl = document.querySelector('#vela-loading .msg');
      function setMsg(text) {{ if (msgEl) msgEl.innerHTML = text; }}
      function showError(text) {{
        var el = document.querySelector('#vela-loading');
        if (el) {{
          var err = document.createElement('div');
          err.className = 'error';
          err.innerHTML = text;
          el.appendChild(err);
        }}
        setMsg('Failed to load');
      }}

      // Read ?deck= parameter (only relative paths allowed — no external URLs)
      var params = new URLSearchParams(window.location.search);
      var deckParam = params.get('deck');
      var deckUrl = null;

      if (deckParam) {{
        if (/^[a-z][a-z0-9+.-]*:/i.test(deckParam) || deckParam.startsWith('//')) {{
          showError('External deck URLs are not allowed.<br>Only local deck paths (e.g. <code>examples/deck.json</code>) are supported.<br><a href="./">Back to gallery</a>');
          return;
        }}
        deckUrl = deckParam;
      }}

      // Fetch vela.jsx engine + optional deck in parallel
      var jsxPromise = fetch('vela.jsx').then(function(r) {{
        if (!r.ok) throw new Error('Failed to load engine: HTTP ' + r.status);
        return r.text();
      }});

      var deckPromise = deckUrl
        ? (setMsg('Loading deck<span class="dots"></span>'),
           fetch(deckUrl).then(function(r) {{
             if (!r.ok) throw new Error('Failed to load deck: HTTP ' + r.status);
             return r.json();
           }}))
        : Promise.resolve(null);

      Promise.all([jsxPromise, deckPromise])
        .then(function(results) {{
          var jsxSource = results[0];
          var deckData = results[1];

          // Inject deck data (same as assemble.py)
          if (deckData) {{
            var marker = 'const STARTUP_PATCH = null;';
            var replacement = 'const STARTUP_PATCH = ' + JSON.stringify(deckData) + ';';
            jsxSource = jsxSource.replace(marker, replacement);
          }}

          setMsg('Transpiling<span class="dots"></span>');

          // Wait for deps + Babel
          function boot() {{
            if (!window._depsReady || !window.Babel) {{
              setTimeout(boot, 100);
              return;
            }}

            setMsg('Starting<span class="dots"></span>');

            // Strip ES module imports (globals provided by import map above)
            jsxSource = jsxSource.replace(/^import\\s+.*?from\\s+["'][^"']+["'];?\\s*$/gm, '');
            jsxSource = jsxSource.replace(/^import\\s*\\*\\s*as\\s+.*?from\\s+["'][^"']+["'];?\\s*$/gm, '');
            jsxSource = jsxSource.replace(/^import\\s*\\{{[^}}]*\\}}\\s*from\\s+["'][^"']+["'];?\\s*$/gm, '');
            jsxSource = jsxSource.replace(/^export\\s+default\\s+/gm, '');

            // UMD shim: bridge window globals to the names the app expects
            var umdShim = 'const {{ useState, useReducer, useEffect, useLayoutEffect, useRef, useCallback, useMemo }} = React;\\n'
              + 'const _LucideAll = window.lucideReact;\\n'
              + 'const {{ ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, X, Presentation, Download, Upload, Search, FileDown }} = window.lucideReact;\\n';
            jsxSource = umdShim + jsxSource;

            // Append self-mount so App is accessible within the evaluated scope
            jsxSource += '\\n;(function() {{ var rootEl = document.getElementById("root"); var root = window._createRoot(rootEl); root.render(React.createElement(App)); }})();\\n';

            try {{
              var code = Babel.transform(jsxSource, {{
                presets: ['react'],
                filename: 'vela.jsx'
              }}).code;

              // Execute (App mounts itself from within the evaluated code)
              new Function(code)();
            }} catch(e) {{
              console.error('[vela] Boot failed:', e);
              showError('Failed to start Vela: ' + e.message);
            }}
          }}
          boot();
        }})
        .catch(function(err) {{
          console.error('[vela]', err);
          showError(err.message + '<br><a href="./">Back to gallery</a>');
        }});
    }})();
  </script>
</body>
</html>'''


# ━━━ Gallery HTML (index.html) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def generate_gallery_html(decks, version):
    """Generate the gallery index page with deck cards."""

    cards_html = ""
    for d in decks:
        bg_style = f"background: {d['bgGradient']};" if d.get("bgGradient") else f"background: {d['bg']};"
        duration_str = f"{d['duration'] // 60}m" if d['duration'] >= 60 else f"{d['duration']}s"
        heading_text = html.escape(d['heading'] or d['title'])
        subtitle_text = html.escape(d['subtitle'][:80]) if d.get('subtitle') else ''
        deck_title = html.escape(d['title'])

        cards_html += f'''
      <a href="vela.html?deck=examples/{html.escape(d['filename'])}" class="card" style="--card-accent: {d['accent']};">
        <div class="card-preview" style="{bg_style}">
          <div class="card-slide-title" style="color: {d['color']};">{heading_text}</div>
          {f'<div class="card-slide-sub" style="color: {d["color"]}; opacity: 0.6;">{subtitle_text}</div>' if subtitle_text else ''}
        </div>
        <div class="card-info">
          <div class="card-title">{deck_title}</div>
          <div class="card-meta">
            <span>{d['slides']} slides</span>
            <span>·</span>
            <span>{duration_str}</span>
            <span>·</span>
            <span>{d['lanes']} section{"s" if d["lanes"] != 1 else ""}</span>
          </div>
        </div>
      </a>'''

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vela Slides — Gallery</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⛵</text></svg>" />
  <meta name="description" content="Vela Slides — AI-native presentations. Browse and view example decks." />
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{
      background: #0a0f1a;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
    }}

    /* Header */
    .header {{
      text-align: center;
      padding: 60px 24px 20px;
    }}
    .header .boat {{ font-size: 48px; margin-bottom: 12px; display: inline-block; animation: sail 3s ease-in-out infinite; }}
    @keyframes sail {{ 0%,100% {{ transform: translateY(0) rotate(-2deg); }} 50% {{ transform: translateY(-8px) rotate(2deg); }} }}
    .header h1 {{ font-size: 32px; font-weight: 700; letter-spacing: 6px; margin-bottom: 8px; }}
    .header p {{ font-size: 15px; color: #64748b; max-width: 480px; margin: 0 auto; line-height: 1.5; }}
    .header .version {{ font-size: 11px; color: #475569; margin-top: 8px; font-family: monospace; }}

    /* Card grid */
    .gallery {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
      gap: 24px;
      padding: 32px 48px 60px;
    }}

    .card {{
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 12px;
      overflow: hidden;
      text-decoration: none;
      color: inherit;
      transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
    }}
    .card:hover {{
      transform: translateY(-4px);
      border-color: var(--card-accent, #3b82f6);
      box-shadow: 0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px var(--card-accent, #3b82f6);
    }}

    .card-preview {{
      aspect-ratio: 16/9;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 40px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }}
    .card-slide-title {{
      font-size: 18px;
      font-weight: 700;
      line-height: 1.3;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }}
    .card-slide-sub {{
      font-size: 13px;
      margin-top: 8px;
      line-height: 1.4;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}

    .card-info {{
      padding: 16px 20px;
      border-top: 1px solid #1e293b;
    }}
    .card-title {{
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 6px;
    }}
    .card-meta {{
      display: flex;
      gap: 6px;
      font-size: 12px;
      color: #64748b;
    }}

    /* Footer */
    .footer {{
      text-align: center;
      padding: 24px;
      border-top: 1px solid #1e293b;
      font-size: 12px;
      color: #475569;
    }}
    .footer a {{ color: #64748b; text-decoration: none; }}
    .footer a:hover {{ color: #94a3b8; }}

    /* Responsive */
    @media (max-width: 480px) {{
      .gallery {{ grid-template-columns: 1fr; padding: 16px; gap: 16px; }}
      .header {{ padding: 40px 16px 12px; }}
      .header h1 {{ font-size: 24px; letter-spacing: 4px; }}
    }}
  </style>
</head>
<body>
  <div class="header">
    <div class="boat">⛵</div>
    <h1>VELA</h1>
    <p>AI-native presentation engine. Browse example decks below.</p>
    <div class="version">v{html.escape(version)}</div>
  </div>

  <div class="gallery">
    {cards_html}
    <!-- Empty state card: create new -->
    <a href="vela.html" class="card" style="--card-accent: #8b5cf6;">
      <div class="card-preview" style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);">
        <div class="card-slide-title" style="color: #c4b5fd; font-size: 32px;">+</div>
        <div class="card-slide-sub" style="color: #a78bfa; opacity: 0.8;">Start from scratch</div>
      </div>
      <div class="card-info">
        <div class="card-title">New Presentation</div>
        <div class="card-meta"><span>Empty deck</span></div>
      </div>
    </a>
  </div>


  <div class="footer">
    <span>&copy; 2025-present <a href="https://www.linkedin.com/in/rquintino/">Rui Quintino</a></span>
    <span> &middot; </span>
    <a href="https://github.com/agentiapt/vela-slides">GitHub</a>
    <span> &middot; </span>
    <a href="https://github.com/agentiapt/vela-slides/blob/main/LICENSE">ELv2</a>
  </div>
</body>
</html>'''


# ━━━ Build ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def build(output_dir=None):
    output = output_dir or DEFAULT_OUTPUT

    # Clean output
    if os.path.exists(output):
        shutil.rmtree(output)
    os.makedirs(output, exist_ok=True)

    version = get_vela_version()
    print(f"Building Vela Pages site v{version} → {output}/")

    # 1. Ensure template is up to date
    print("  Rebuilding template from parts...")
    import subprocess
    result = subprocess.run(
        [sys.executable, CONCAT_SCRIPT],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"ERROR: concat failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)
    print(f"  {result.stdout.strip()}")

    # 2. Copy vela.jsx
    shutil.copy2(TEMPLATE_JSX, os.path.join(output, "vela.jsx"))
    jsx_size = os.path.getsize(os.path.join(output, "vela.jsx")) // 1024
    print(f"  Copied vela.jsx ({jsx_size}KB)")

    # 3. Copy example decks
    examples_out = os.path.join(output, "examples")
    os.makedirs(examples_out, exist_ok=True)
    decks_meta = []

    for fname in sorted(os.listdir(EXAMPLES_DIR)):
        if not fname.endswith(".json"):
            continue
        src = os.path.join(EXAMPLES_DIR, fname)
        shutil.copy2(src, os.path.join(examples_out, fname))
        meta = load_deck_meta(src)
        decks_meta.append(meta)
        print(f"  Deck: {meta['title']} ({meta['slides']} slides)")

    # Also include skill demo deck if exists
    skill_demo = os.path.join(SKILL_DIR, "examples", "vela-demo.json")
    if os.path.exists(skill_demo):
        shutil.copy2(skill_demo, os.path.join(examples_out, "vela-demo.json"))
        meta = load_deck_meta(skill_demo)
        decks_meta.insert(0, meta)  # Demo first
        print(f"  Deck: {meta['title']} ({meta['slides']} slides) [demo]")

    # 4. Generate vela.html (viewer)
    viewer_html = generate_viewer_html(version)
    with open(os.path.join(output, "vela.html"), "w") as f:
        f.write(viewer_html)
    print("  Generated vela.html")

    # 5. Generate index.html (gallery)
    gallery_html = generate_gallery_html(decks_meta, version)
    with open(os.path.join(output, "index.html"), "w") as f:
        f.write(gallery_html)
    print(f"  Generated index.html ({len(decks_meta)} decks)")

    print(f"\nDone! Site ready at {output}/")
    print(f"  Total decks: {len(decks_meta)}")
    total_size = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _, fnames in os.walk(output)
        for f in fnames
    ) // 1024
    print(f"  Total size: {total_size}KB")


if __name__ == "__main__":
    out = None
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            out = sys.argv[idx + 1]
    build(out)
