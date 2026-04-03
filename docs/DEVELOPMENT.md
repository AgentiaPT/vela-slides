# Development Setup

## Prerequisites

- **Python 3.12+** — build scripts, CLI, dev server, tests
- **Node.js 22+** — e2e tests (Playwright), channel bridge
- **pnpm** — package manager (npm is not used)

## Quick Start

```bash
# Install Node dependencies (dev only — no production deps)
pnpm install

# Run all tests
python3 tests/test_vela.py --all

# Start local server
python3 skills/vela-slides/scripts/vela.py server start examples/ --port 3030
```

## WSL2 / Mounted Drive Performance

The project directory is typically mounted from Windows (e.g., `D:\` → `/home/.../projects/`). The drvfs filesystem is **extremely slow** for `node_modules` — thousands of small files with symlinks.

### Solution: `virtual-store-dir`

Add `virtual-store-dir` to your **local** `.npmrc` (do not commit — this is machine-specific):

```bash
echo 'virtual-store-dir=/home/<user>/.local/node_modules_cache/vela-slides/.pnpm' >> .npmrc
```

This keeps:
- **`node_modules/`** on drvfs — only lightweight symlinks (fast)
- **`.pnpm/`** (actual package contents) on ext4 — native Linux speed

Typical install times: **~20s** (vs 5+ minutes on drvfs).

### Verifying

```bash
# Check if you're on a mounted drive
df -h .
# Filesystem      Size  Used Avail Use% Mounted on
# D:\             1.9T  657G  1.2T  36% /home/.../vela-slides

# Verify virtual store is on native fs
ls -la /home/<user>/.local/node_modules_cache/vela-slides/.pnpm/
```

## Supply Chain Security

All Node.js dependency management follows strict supply chain security practices.

### Protections in place

| Protection | Config | Purpose |
|---|---|---|
| **No install scripts** | `.npmrc: ignore-scripts=true` | Blocks malicious `postinstall` scripts |
| **No native builds** | `pnpm-workspace.yaml: onlyBuiltDependencies: []` | Blocks native binary compilation |
| **7-day release cooldown** | `pnpm-workspace.yaml: minimumReleaseAge: 10080` | New releases must age 7 days before install |
| **Lockfile with integrity** | `pnpm-lock.yaml` (SHA-512 hashes) | Pins exact versions + verifies content |
| **Lockfile committed** | Checked into git | Reproducible builds, detects tampering |
| **Minimal dependencies** | 5 devDependencies, 0 production | Smallest possible attack surface |

### Before adding any dependency

1. Check publisher/maintainer — known, trusted organization?
2. Check popularity — weekly downloads, GitHub stars, dependents
3. Search for CVEs — Snyk, npm audit, GitHub advisories
4. Assess supply chain risk — compromised releases history, typosquatting
5. Review the dependency tree — are transitive deps reasonable?
6. Verify license compatibility (ELv2)
7. Only proceed after confirming the package is **safe**

Reference: [Dependency Cooldowns](https://simonwillison.net/2025/Nov/21/dependency-cooldowns/)

### Current dependencies

All dev-only (no production deps):

| Package | Version | Purpose |
|---|---|---|
| `react` | 18.3.1 | E2E test rendering |
| `react-dom` | 18.3.1 | E2E test rendering |
| `@babel/standalone` | 7.26.10 | E2E JSX transpilation |
| `lucide-react` | 0.344.0 | E2E icon rendering |
| `playwright` | 1.58.2 | E2E browser automation |

### Python

Python uses **zero** external packages — only the standard library. No `requirements.txt`, `Pipfile`, or `pyproject.toml` exists.

## Testing

### Single entry point

```bash
python3 tests/test_vela.py --all
```

This runs everything, matching what CI does:

| Suite | Runner | Tests |
|---|---|---|
| Unit tests | `test_vela.py --unit` | ~98 |
| Integration tests | `test_vela.py --integration` | ~100 |
| Server tests | `test_serve.py` (unittest) | 72 |
| Template sync | `concat.py` + diff | 1 |
| E2E UI tests | `test_review_ui.cjs` (Playwright) | 32 |

### Selective runs

```bash
python3 tests/test_vela.py              # unit + integration (fast, no Node deps needed)
python3 tests/test_vela.py --unit       # unit only
python3 tests/test_vela.py --integration # integration only
python3 tests/test_vela.py --all        # everything (requires pnpm install + Playwright)
```

### E2E test prerequisites

```bash
pnpm install                            # installs React, Babel, Lucide, Playwright
npx playwright install chromium         # downloads Chromium browser
```

## Local Server

```bash
# Start (opens browser with auth token)
python3 skills/vela-slides/scripts/vela.py server start <folder> --port 3030

# Stop
python3 skills/vela-slides/scripts/vela.py server stop

# Replace existing server on same port
python3 skills/vela-slides/scripts/vela.py server start <folder> --port 3030 --replace

# No auth (local dev only)
python3 skills/vela-slides/scripts/vela.py server start <folder> --no-auth
```

The server writes runtime info to `.vela.env` (gitignored). On exit, cleanup handlers remove it automatically.

## Build

```bash
# Rebuild monolith from parts
python3 skills/vela-slides/scripts/concat.py

# Assemble with a deck
python3 skills/vela-slides/scripts/assemble.py examples/vela-demo.vela --from-parts

# Validate deck JSON
python3 skills/vela-slides/scripts/validate.py examples/vela-demo.vela
```
