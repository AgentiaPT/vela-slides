#!/usr/bin/env bash
# Render a .pptx to PNG for visual inspection (spike helper).
#
# The sprint container ships a STRIPPED LibreOffice (only pdfimport/xsltfilter
# registry modules) that cannot load .pptx/.txt — "source file could not be
# loaded". Install the Impress module once, then convert:
#     apt-get install -y libreoffice-impress
# After that, soffice --convert-to png renders slides faithfully (native SVG
# included). This is how we visually diff the generated .pptx vs the source
# Vela render.
#
# USAGE: render-pptx.sh <file.pptx> [outdir]   (default outdir: ./out)
set -euo pipefail
PPTX="${1:?usage: render-pptx.sh <file.pptx> [outdir]}"
OUT="${2:-out}"
mkdir -p "$OUT"
if [ ! -f /usr/lib/libreoffice/share/registry/impress.xcd ]; then
  echo "Impress module missing — installing (one-time)..." >&2
  apt-get install -y -qq libreoffice-impress >&2
fi
export HOME="${HOME:-/tmp/lohome}"; mkdir -p "$HOME"
soffice --headless --norestore --nolockcheck \
  -env:UserInstallation="file://$HOME/lu" \
  --convert-to png --outdir "$OUT" "$PPTX" 2>&1 | grep -iv 'javaldx\|Warning: failed' || true
echo "rendered -> $OUT/$(basename "${PPTX%.pptx}").png"
