// Spike step 1 — hand-authored IR proving the OOXML+zip skeleton and that
// text/shapes/pictures arrive as NATIVE, EDITABLE PowerPoint objects.
// Output: out/minimal.pptx  (verify with verify.py / soffice).
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildPptx } from './pptx-emitter.mjs';
import { solidPng } from './png.mjs';

mkdirSync(new URL('./out', import.meta.url), { recursive: true });

// A tiny SVG diagram (stroke-based, like a Vela `svg` block / flow arrow) +
// a PNG raster fallback for PowerPoint clients without native SVG.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">`
  + `<rect x="4" y="20" width="70" height="40" rx="8" fill="none" stroke="#3B82F6" stroke-width="3"/>`
  + `<line x1="78" y1="40" x2="120" y2="40" stroke="#3B82F6" stroke-width="3"/>`
  + `<polygon points="120,34 132,40 120,46" fill="#3B82F6"/>`
  + `<rect x="132" y="20" width="64" height="40" rx="8" fill="none" stroke="#22C55E" stroke-width="3"/>`
  + `<text x="39" y="44" text-anchor="middle" font-family="monospace" font-size="12" fill="#0F172A">Input</text>`
  + `<text x="164" y="44" text-anchor="middle" font-family="monospace" font-size="12" fill="#0F172A">Output</text></svg>`;

const slide = {
  bg: '#0F172A',
  boxes: [
    { x: 60, y: 60, w: 840, h: 96, fill: '#1E293B', radius: 16, line: { w: 1.5, color: '#334155' } },
    { x: 60, y: 300, w: 400, h: 180, fill: '#3B82F6', radius: 12 },
  ],
  ellipses: [
    { cx: 780, cy: 400, r: 70, fill: '#8B5CF6', line: { w: 2, color: '#C4B5FD' } },
  ],
  images: [
    { x: 500, y: 300, w: 180, h: 120, png: solidPng(180, 120, [34, 197, 94, 255]), alt: 'sample image' },
  ],
  svgs: [
    { x: 60, y: 180, w: 300, h: 100, svg, pngFallback: solidPng(300, 100, [15, 23, 42, 255]), alt: 'flow diagram (SVG)' },
  ],
  texts: [
    { x: 84, y: 84, w: 792, h: 48, text: 'Editable PowerPoint title (native text box)', size: 32, color: '#FFFFFF', bold: true, font: 'Sora' },
    { x: 84, y: 340, w: 352, h: 40, text: 'White text on an editable rounded rect', size: 18, color: '#FFFFFF', font: 'DM Sans' },
    { x: 700, y: 470, w: 160, h: 24, text: 'ellipse + label', size: 12, color: '#E2E8F0', align: 'center', font: 'Space Mono' },
  ],
};

const buf = buildPptx([slide]);
const outPath = new URL('./out/minimal.pptx', import.meta.url);
writeFileSync(outPath, buf);
console.log(`wrote ${outPath.pathname} (${buf.length} bytes)`);
