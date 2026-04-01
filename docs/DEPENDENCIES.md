# Dependencies

Exhaustive inventory of every runtime, package, library, CDN resource, browser API, and CI tool used by Vela Slides — organized by layer.

---

## 1. Runtimes

| Runtime | Version | Where specified | Used by |
|---------|---------|-----------------|---------|
| **Python** | 3.12 | `.github/workflows/ci.yml` (line 71) | All build scripts, CLI, tests, dev server |
| **Node.js** | 18+ (implicit) | `"type": "module"` in channel `package.json` | Channel bridge only (`vela-channel.ts`) |
| **Browser** | ES2020+ | — | Vela app (React SPA in artifact sandbox) |

> Python has **zero** external (pip) packages — every script uses only the standard library. No `requirements.txt`, `Pipfile`, or `pyproject.toml` exists.

---

## 2. Python Standard Library Modules

Every Python module imported across all scripts. No third-party packages.

### Build & CLI scripts

| Module | Used in | Purpose |
|--------|---------|---------|
| `json` | concat, assemble, validate, vela, tests, evals | JSON parsing / encoding |
| `sys` | All scripts | CLI args, exit codes |
| `os` | All scripts | File / directory operations |
| `re` | assemble, vela, evals | Regular expressions |
| `subprocess` | assemble, vela, tests | Spawning child processes |
| `shutil` | vela | File copy / removal |
| `copy` | vela | Deep-copy deck structures |
| `tempfile` | tests | Temporary files for test isolation |
| `argparse` | evals scripts | CLI argument parsing |
| `pathlib` | evals scripts | Path objects |

### Dev server (`serve.py`)

| Module | Purpose |
|--------|---------|
| `http.server` | HTTP request handler and server |
| `http.cookies` | Cookie parsing |
| `hashlib` | SHA-1 file hashing (ETag) |
| `hmac` | HMAC request validation |
| `secrets` | Secure random token generation |
| `threading` | Multi-threaded request handling |
| `concurrent.futures` | Bounded thread pool (max 20) |
| `urllib.parse` | URL / query-string parsing |
| `webbrowser` | Auto-open browser on start |
| `time` | Timing, delays |

### Tests

| Module | Used in | Purpose |
|--------|---------|---------|
| `unittest` | `test_serve.py` | Test framework |
| `http.client` | `test_serve.py` | HTTP client for server tests |
| `py_compile` | CI (`evals-check.yml`) | Syntax-check eval scripts |

### Evals

| Module | Purpose |
|--------|---------|
| `collections` | `defaultdict` for aggregations |
| `datetime` | Timestamps |
| `colorsys` | Color conversion (preview.py) |
| `random` | Random sampling |
| `math` | Numeric calculations |

---

## 3. npm Packages

### Root `package.json` — devDependencies

These are consumed at runtime via CDN (see §5), not bundled. The `package.json` exists for version tracking only.

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| `react` | ^18.3.1 | MIT | UI framework |
| `react-dom` | ^18.3.1 | MIT | DOM rendering |
| `lucide-react` | ^0.344.0 | ISC | 280+ SVG icons |
| `@babel/standalone` | ^7.24.0 | MIT | In-browser JSX transpilation |

### Channel `package.json` — `skills/vela-slides/channel/`

| Package | Version | Type | License | Purpose |
|---------|---------|------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.25.0 | dependency | MIT | MCP server SDK |
| `tsx` | ^4.0.0 | devDependency | MIT | TypeScript execution for Node.js |

Node built-in modules used by channel: `node:http`, `node:fs`, `node:path`

> **Lockfile integrity:** `pnpm-lock.yaml` is committed with SHA-512 hashes for reproducible builds and tamper detection. The root devDependencies are reference-only; the app loads libraries from CDN at runtime. Supply chain protections: `ignore-scripts=true` (.npmrc), 7-day release cooldown, no native builds (pnpm-workspace.yaml).

---

## 4. React APIs Used

Imported once in `part-imports.jsx` and used throughout the part-files:

### Hooks
| Hook | Used in |
|------|---------|
| `useState` | All interactive components |
| `useReducer` | `part-reducer.jsx` — main app state |
| `useEffect` | Side effects (storage, keyboard, SSE) |
| `useLayoutEffect` | DOM measurements before paint |
| `useRef` | DOM element references |
| `useCallback` | Memoized event handlers |
| `useMemo` | Derived/computed values |

### Rendering
| API | Purpose |
|-----|---------|
| `ReactDOM.createRoot()` | React 18 concurrent root |
| JSX / `React.createElement` | Component tree |

### Named icon imports from `lucide-react`
`ChevronLeft`, `ChevronRight`, `Maximize2`, `Minimize2`, `Plus`, `X`, `Presentation`, `Download`, `Upload`, `Search`, `FileDown`, plus wildcard `* as _LucideAll` for dynamic icon resolution (~280 icons).

---

## 5. CDN / External Resources

Every URL fetched at runtime by the browser.

### JavaScript libraries

| Library | Version | CDN | URL | Used in |
|---------|---------|-----|-----|---------|
| html2canvas | 1.4.1 | cdnjs | `https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js` | `part-slides.jsx` — PDF/image export |
| @babel/standalone | 7.24.0 | unpkg | `https://unpkg.com/@babel/standalone@7.24.0/babel.min.js` | `local.html`, `serve.py` — JSX transpilation |
| React | 18.3.1 | esm.sh | `https://esm.sh/react@18.3.1` | `local.html` import map |
| React DOM | 18.3.1 | esm.sh | `https://esm.sh/react-dom@18.3.1` | `local.html` import map |
| React DOM/client | 18.3.1 | esm.sh | `https://esm.sh/react-dom@18.3.1/client` | `local.html` import map |
| lucide-react | 0.344.0 | esm.sh | `https://esm.sh/lucide-react@0.344.0?external=react` | `local.html` import map |

### Evals dashboard only (not part of the main app)

| Library | Version | CDN | URL |
|---------|---------|-----|-----|
| React | 18 | unpkg | `https://unpkg.com/react@18/umd/react.production.min.js` |
| React DOM | 18 | unpkg | `https://unpkg.com/react-dom@18/umd/react-dom.production.min.js` |
| @babel/standalone | latest | unpkg | `https://unpkg.com/@babel/standalone/babel.min.js` |
| Tailwind CSS | latest | cdn | `https://cdn.tailwindcss.com` |

### Web fonts — Google Fonts API

Loaded via CSS `@import` in `part-imports.jsx`:

```
https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap
```

| Font | Weights | License | Used for |
|------|---------|---------|----------|
| **Sora** | 400, 500, 600, 700, 800 | OFL 1.1 | Headings |
| **DM Sans** | 400, 500, 600, 700 | OFL 1.1 | Body text |
| **Space Mono** | 400, 700 | OFL 1.1 | Code / monospace |

### Web fonts — evals dashboard

```
https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap
```

| Font | Weights | License |
|------|---------|---------|
| **Inter** | 300–700 | OFL 1.1 |
| **JetBrains Mono** | 400, 500 | OFL 1.1 |

### TTF font files for PDF export

Fetched at PDF-generation time with jsDelivr primary and raw.githubusercontent.com fallback. Located in `part-pdf.jsx`:

| Font file | Primary URL (jsDelivr) | Fallback URL (GitHub raw) |
|-----------|----------------------|--------------------------|
| DMSans-Regular.ttf | `cdn.jsdelivr.net/gh/googlefonts/dm-fonts@main/Sans/Exports/DMSans-Regular.ttf` | `raw.githubusercontent.com/googlefonts/dm-fonts/main/Sans/Exports/DMSans-Regular.ttf` |
| DMSans-Bold.ttf | `cdn.jsdelivr.net/gh/googlefonts/dm-fonts@main/Sans/Exports/DMSans-Bold.ttf` | `raw.githubusercontent.com/googlefonts/dm-fonts/main/Sans/Exports/DMSans-Bold.ttf` |
| DMSans-Italic.ttf | `cdn.jsdelivr.net/gh/googlefonts/dm-fonts@main/Sans/Exports/DMSans-Italic.ttf` | `raw.githubusercontent.com/googlefonts/dm-fonts/main/Sans/Exports/DMSans-Italic.ttf` |
| Sora-Regular.ttf | `cdn.jsdelivr.net/gh/sora-xor/sora-font@master/fonts/ttf/v2.1beta/Sora-Regular.ttf` | `raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/v2.1beta/Sora-Regular.ttf` |
| Sora-SemiBold.ttf | `cdn.jsdelivr.net/gh/sora-xor/sora-font@master/fonts/ttf/v2.1beta/Sora-SemiBold.ttf` | `raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/v2.1beta/Sora-SemiBold.ttf` |
| Sora-Bold.ttf | `cdn.jsdelivr.net/gh/sora-xor/sora-font@master/fonts/ttf/v2.1beta/Sora-Bold.ttf` | `raw.githubusercontent.com/sora-xor/sora-font/master/fonts/ttf/v2.1beta/Sora-Bold.ttf` |
| SpaceMono-Regular.ttf | `cdn.jsdelivr.net/gh/googlefonts/spacemono@main/fonts/SpaceMono-Regular.ttf` | `raw.githubusercontent.com/googlefonts/spacemono/main/fonts/SpaceMono-Regular.ttf` |
| SpaceMono-Bold.ttf | `cdn.jsdelivr.net/gh/googlefonts/spacemono@main/fonts/SpaceMono-Bold.ttf` | `raw.githubusercontent.com/googlefonts/spacemono/main/fonts/SpaceMono-Bold.ttf` |

### External API

| Service | URL | Used in | Purpose |
|---------|-----|---------|---------|
| Anthropic Messages API | `https://api.anthropic.com/v1/messages` | `part-engine.jsx` | Vera AI chat (Claude Sonnet) |

---

## 6. Browser APIs Required

APIs used by the Vela app at runtime in the browser:

| API | Required | Used for |
|-----|----------|----------|
| **Web Storage** (localStorage) | Yes | Deck persistence (`vela-deck`, `vela-m-*` keys) |
| **Fetch** | Yes | Anthropic API calls, font loading |
| **Canvas** | Yes | PDF export (via html2canvas) |
| **Clipboard** (`navigator.clipboard`) | Yes (with fallback) | Copy deck JSON, export text |
| **Fullscreen** (`requestFullscreen`) | Optional | Presenter mode |
| **EventSource** (SSE) | Optional | Channel bridge to Claude Code |
| **WebSocket** | Optional | Channel bridge polling |
| **crypto.randomUUID()** | Yes | Unique ID generation |

---

## 7. CI / CD Dependencies

### GitHub Actions

| Action | Version | Used in workflow |
|--------|---------|-----------------|
| `actions/checkout` | v4 | `ci.yml`, `evals-check.yml`, `release.yml` |
| `actions/setup-python` | v5 | `ci.yml`, `evals-check.yml`, `release.yml` |
| `actions/github-script` | v7 | `ci.yml` (PR comment posting) |

### CI runner

| Requirement | Value |
|-------------|-------|
| Runner OS | `ubuntu-latest` |
| Python | 3.12 (via `setup-python`) |

### External CLI tools used in CI

| Tool | Used in | Purpose |
|------|---------|---------|
| `python3` | All workflows | Run tests, build scripts |
| `git` | `ci.yml` | Diff detection for version-bump check |
| `zip` | `release.yml` | Create skill ZIP for GitHub Release |
| `gh` (GitHub CLI) | `release.yml` | Create/check GitHub Releases |
| `diff` | `ci.yml` | Verify template sync |

---

## 8. Build Scripts & Their Dependencies

All build scripts use **only Python stdlib**. No external packages.

| Script | Path | Stdlib imports | Shells out to |
|--------|------|----------------|---------------|
| `concat.py` | `scripts/concat.py` | `sys`, `os` | — |
| `assemble.py` | `scripts/assemble.py` | `sys`, `json`, `os`, `re`, `subprocess` | `concat.py` (optional, via `--from-parts`) |
| `validate.py` | `scripts/validate.py` | `sys`, `json`, `os` | — |
| `vela.py` | `scripts/vela.py` | `json`, `sys`, `os`, `subprocess`, `copy`, `shutil` | `validate.py`, `assemble.py`, `serve.py` |
| `serve.py` | `scripts/serve.py` | `hashlib`, `hmac`, `http.server`, `http.cookies`, `secrets`, `threading`, `concurrent.futures`, `urllib.parse`, `webbrowser`, `os`, `sys`, `json`, `re`, `time` | `webbrowser.open()` or `cmd.exe` (Windows) |
| `sync-skill-docs.py` | `scripts/sync-skill-docs.py` | `subprocess`, `os`, `re` | `git` |
| `lint.py` | `scripts/lint.py` | `sys`, `os`, `re` | — |

---

## 9. Test Dependencies

| Test file | Framework | Stdlib imports | Shells out to |
|-----------|-----------|----------------|---------------|
| `test_vela.py` | Custom runner | `json`, `sys`, `os`, `subprocess`, `tempfile`, `re` | `python3` (concat, validate, tests, evals) |
| `test_serve.py` | `unittest` | `unittest`, `http.client`, `json`, `os`, `sys`, `threading`, `time` | — |
| `test_e2e_serve.js` | Playwright | `child_process`, `playwright` | `python3 serve.py` |

---

## 10. Summary

| Layer | Count | External (non-stdlib) |
|-------|-------|-----------------------|
| Python packages | 0 | **None** |
| npm packages (root) | 4 | react, react-dom, lucide-react, @babel/standalone |
| npm packages (channel) | 2 | @modelcontextprotocol/sdk, tsx |
| CDN JS libraries | 4 | html2canvas, Babel, React (esm.sh), lucide-react (esm.sh) |
| CDN fonts | 3 families (8 TTFs) | Sora, DM Sans, Space Mono |
| External APIs | 1 | Anthropic Messages API |
| GitHub Actions | 3 | checkout, setup-python, github-script |
| Browser APIs | 8 | Web Storage, Fetch, Canvas, Clipboard, Fullscreen, EventSource, WebSocket, crypto |

**Design principle:** Minimal external dependencies. The Python side is pure stdlib. The browser side loads libraries from CDN at runtime — no bundler, no `node_modules` in production.
