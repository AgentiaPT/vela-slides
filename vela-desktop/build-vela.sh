#!/usr/bin/env bash
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
# Build script for Vela Desktop — rebuilds monolith from parts, then runs Vite build.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PARTS_DIR="$PROJECT_ROOT/skills/vela-slides/app/parts"
CONCAT_SCRIPT="$PROJECT_ROOT/skills/vela-slides/scripts/concat.py"
VELA_JSX="$PROJECT_ROOT/skills/vela-slides/app/vela.jsx"

echo "=== Vela Desktop Build ==="
echo ""

# Step 1: Rebuild monolith from parts
echo "→ Step 1: Rebuilding vela.jsx from parts..."
python3 "$CONCAT_SCRIPT"
echo "  ✓ vela.jsx rebuilt ($(wc -l < "$VELA_JSX") lines)"
echo ""

# Step 2: Install frontend dependencies
echo "→ Step 2: Installing frontend dependencies..."
cd "$SCRIPT_DIR"
if command -v pnpm &>/dev/null; then
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
else
  npm install
fi
echo "  ✓ Dependencies installed"
echo ""

# Step 3: Build frontend with Vite
echo "→ Step 3: Building frontend with Vite..."
npx vite build
echo "  ✓ Frontend built to dist/"
echo ""

# Step 4: Build Tauri app (optional — only if --tauri flag passed)
if [[ "${1:-}" == "--tauri" ]]; then
  echo "→ Step 4: Building Tauri desktop app..."
  cd "$SCRIPT_DIR"
  cargo tauri build
  echo "  ✓ Desktop app built"
  echo ""
fi

echo "=== Build complete ==="
