# Vela Design Patterns & Slide Archetypes

> **v12.5** · 2026-03-23

## Slide Archetypes

Every slide should follow one of these proven patterns. Mix them throughout a deck for visual variety.

### 1. Title Slide
Opening slide — centered, gradient bg, badge + 4xl heading + subtitle + presenter line. `verticalAlign: "center"`, `align: "center"`. Duration: 20s.

### 2. Section Break
Divides major sections — centered xl icon in circle + 3xl heading + subtitle. High-contrast gradient. Duration: 15s.

### 3. Key Point + Supporting Detail
Workhorse content slide — badge label → spacer → 2xl assertion heading with icon → body text → callout. Duration: 60-90s.

### 4. Feature Grid
2-3 col grid with icon + heading + text per cell. Each cell gets subtle colored background (`rgba(...,0.08)`) + border. Duration: 60-90s.

### 5. Metrics / Stats
3-col grid of metric blocks with large values (`3xl`), icons, and ALL-CAPS labels. Gradient bg. Duration: 20-40s.

### 6. Process / Flow
Horizontal flow block with 3-5 icon steps + sublabels connected by arrows. Add `loop: true` for iterative processes (agent loops, ReAct, OODA, feedback cycles). Add `gate: true` on items for human-review checkpoints. Add italic footnote below. Duration: 90-120s.

### 7. Comparison Table
Table block with striped rows, colored headers. Heading with icon above. Duration: 60-120s.

### 8. Timeline / Roadmap
Horizontal timeline block with 3-5 dated milestones. Duration: 60s.

### 9. Closing / CTA
Centered layout — xl icon + 3xl heading + body text + tag-group for contact/links. Gradient bg. Duration: 30s.

### 10. Layer Diagram *(v13)*
Stacked architecture / composition visual using 1-col grid with `direction: "row"` cells.

**When to use:** Architecture stacks, OSI model, testing pyramid, context window composition, agent anatomy, MCP layers, any layered system where order implies hierarchy.

**Design rules:**
- Use `cols: 1` grid — each cell = one horizontal layer bar
- Each cell: `direction: "row"` with `icon` + `heading` + `text` flowing inline
- Left border color = layer's semantic color
- Background opacity: `0.06–0.10` (subtle, not loud)
- Tight padding: `10px 16px` to `14px 20px`
- Keep sublabel text as plain `text` block, not badges (cleaner)

```json
{
  "bg": "#0f172a",
  "color": "#e2e8f0",
  "accent": "#3b82f6",
  "padding": "36px 48px",
  "duration": 90,
  "blocks": [
    { "type": "heading", "text": "Composable Layers", "size": "2xl" },
    { "type": "text", "text": "Spec tells the loop WHAT. Execution does IT. CI validates EACH commit.", "size": "md", "color": "#94a3b8" },
    { "type": "spacer", "h": 12 },
    {
      "type": "grid", "cols": 1, "gap": 8,
      "items": [
        {
          "direction": "row",
          "blocks": [
            { "type": "icon", "name": "FileText", "size": "md", "color": "#3b82f6", "circle": true, "bg": "#3b82f620" },
            { "type": "heading", "text": "Specification", "size": "lg" },
            { "type": "text", "text": "Intent & constraints — the WHAT and WHY", "size": "sm", "color": "#94a3b8" }
          ],
          "style": { "background": "rgba(59,130,246,0.08)", "borderLeft": "4px solid #3b82f6", "borderRadius": "8px", "padding": "12px 18px" }
        },
        {
          "direction": "row",
          "blocks": [
            { "type": "icon", "name": "Play", "size": "md", "color": "#8b5cf6", "circle": true, "bg": "#8b5cf620" },
            { "type": "heading", "text": "Execution", "size": "lg" },
            { "type": "text", "text": "Ralph loop / HITL / Parallel sub-agents", "size": "sm", "color": "#94a3b8" }
          ],
          "style": { "background": "rgba(139,92,246,0.08)", "borderLeft": "4px solid #8b5cf6", "borderRadius": "8px", "padding": "12px 18px" }
        },
        {
          "direction": "row",
          "blocks": [
            { "type": "icon", "name": "CheckCircle", "size": "md", "color": "#34d399", "circle": true, "bg": "#34d39920" },
            { "type": "heading", "text": "Verification", "size": "lg" },
            { "type": "text", "text": "CI / Tests / Evals — per commit", "size": "sm", "color": "#94a3b8" }
          ],
          "style": { "background": "rgba(52,211,153,0.08)", "borderLeft": "4px solid #34d399", "borderRadius": "8px", "padding": "12px 18px" }
        }
      ]
    }
  ]
}
```

### 11. Gated Pipeline *(v13)*
Workflow with human-review checkpoints between stages.

**When to use:** CI/CD approval stages, spec-driven development phases, deployment pipelines, compliance workflows, code review gates.

**Design rules:**
- Use `flow` with `gate: true` on items that need a checkpoint AFTER them
- Set `gateIcon`, `gateLabel`, `gateColor` at block level (shared across all gates)
- Gates render as dashed-circle checkpoints aligned to icon centerline
- Amber/gold (`#f59e0b`) is the natural gate color — implies "pause and review"
- Keep flow to 3-5 items max (gates add visual width)

```json
{
  "bg": "#0f172a",
  "color": "#e2e8f0",
  "accent": "#3b82f6",
  "padding": "36px 48px",
  "duration": 120,
  "blocks": [
    { "type": "heading", "text": "CI/CD with Approval Gates", "size": "2xl", "icon": "GitBranch" },
    { "type": "spacer", "h": 20 },
    {
      "type": "flow",
      "items": [
        { "icon": "Code", "label": "Build", "sublabel": "Compile + lint" },
        { "icon": "FlaskConical", "label": "Test", "sublabel": "Unit + E2E", "gate": true },
        { "icon": "Eye", "label": "Staging", "sublabel": "Preview deploy", "gate": true },
        { "icon": "Rocket", "label": "Production", "sublabel": "Live" }
      ],
      "gateIcon": "UserCheck",
      "gateLabel": "Approve",
      "gateColor": "#f59e0b",
      "arrowColor": "#3b82f6",
      "direction": "horizontal"
    }
  ]
}
```

### 12. Spectrum / Continuum *(v13)*
Position something between two extremes using a progress bar with endpoint labels.

**When to use:** Methodology positioning, risk scales, maturity models, capability continuum, team skill assessment, cost-quality tradeoff.

**Design rules:**
- Single `progress` item at a specific `value` (0-100) position
- `leftLabel` / `rightLabel` define the extremes
- Optional `leftIcon` / `rightIcon` reinforce the endpoints
- `showValue: false` — the position tells the story, not the number
- `annotation` below explains positioning in context
- Use `height: 10-12` for visual weight
- Can stack multiple progress blocks for multi-dimension spectrums

```json
{
  "bg": "#0f172a",
  "color": "#e2e8f0",
  "accent": "#3b82f6",
  "padding": "36px 48px",
  "duration": 60,
  "blocks": [
    { "type": "heading", "text": "Not Waterfall, Not Vibe Coding", "size": "2xl" },
    { "type": "text", "text": "SDD sits in the disciplined middle.", "size": "md", "color": "#94a3b8" },
    { "type": "spacer", "h": 16 },
    {
      "type": "progress",
      "items": [{ "label": "SDD", "value": 35, "color": "#3b82f6" }],
      "leftLabel": "Waterfall", "rightLabel": "Vibe Coding",
      "leftIcon": "FileText", "rightIcon": "Zap",
      "showValue": false, "trackColor": "#1e293b", "height": 10,
      "annotation": "Shorter feedback loops than waterfall, better output than vibe coding",
      "annotationColor": "#94a3b8"
    }
  ]
}
```

### 13. Diagram Slide *(v14)*
Custom SVG diagram for non-linear visuals that structured blocks can't express.

**When to use:** Architecture diagrams with feedback loops, fan-out patterns (1→N), mesh connectors (M×N), probability distributions, custom layouts with arrows between arbitrary elements.

**Design rules:**
- Badge label → spacer → `svg` block → optional callout or text below
- Always use theme tokens (`{{accent}}`, `{{color}}`, `{{muted}}`, `{{bg}}`) in SVG markup
- Keep `viewBox` height ≤ 300px
- Use `monospace` font-family for text in SVGs
- Prefer stroke-based outlines over filled shapes
- Set `maxWidth: "90%"` and `align: "center"` for typical diagrams
- Use `caption` for diagram labels instead of separate text blocks

```json
{
  "bg": "#0f172a",
  "color": "#e2e8f0",
  "accent": "#3b82f6",
  "padding": "36px 48px",
  "duration": 90,
  "blocks": [
    { "type": "badge", "text": "ARCHITECTURE", "icon": "Layers", "bg": "#3b82f620", "color": "#60a5fa" },
    { "type": "spacer", "h": 8 },
    { "type": "heading", "text": "Agent Core with Context Fan-Out", "size": "2xl", "icon": "Brain" },
    { "type": "spacer", "h": 12 },
    {
      "type": "svg",
      "maxWidth": "90%",
      "align": "center",
      "markup": "<svg viewBox='0 0 600 200' xmlns='http://www.w3.org/2000/svg'><rect x='220' y='60' width='160' height='80' rx='12' fill='none' stroke='{{accent}}' stroke-width='2'/><text x='300' y='105' text-anchor='middle' fill='{{color}}' font-size='16' font-weight='bold' font-family='monospace'>Agent Core</text><rect x='10' y='20' width='120' height='40' rx='6' fill='none' stroke='{{accent}}' stroke-width='1.5'/><text x='70' y='45' text-anchor='middle' fill='{{muted}}' font-size='11' font-family='monospace'>RAG Store</text><rect x='10' y='80' width='120' height='40' rx='6' fill='none' stroke='{{accent}}' stroke-width='1.5'/><text x='70' y='105' text-anchor='middle' fill='{{muted}}' font-size='11' font-family='monospace'>Memory</text><rect x='10' y='140' width='120' height='40' rx='6' fill='none' stroke='{{accent}}' stroke-width='1.5'/><text x='70' y='165' text-anchor='middle' fill='{{muted}}' font-size='11' font-family='monospace'>Profile</text><line x1='130' y1='40' x2='220' y2='80' stroke='{{muted}}' stroke-width='1'/><line x1='130' y1='100' x2='220' y2='100' stroke='{{muted}}' stroke-width='1'/><line x1='130' y1='160' x2='220' y2='120' stroke='{{muted}}' stroke-width='1'/><rect x='470' y='20' width='120' height='40' rx='6' fill='none' stroke='#f59e0b' stroke-width='1.5'/><text x='530' y='45' text-anchor='middle' fill='#fcd34d' font-size='11' font-family='monospace'>Tool A</text><rect x='470' y='80' width='120' height='40' rx='6' fill='none' stroke='#f59e0b' stroke-width='1.5'/><text x='530' y='105' text-anchor='middle' fill='#fcd34d' font-size='11' font-family='monospace'>Tool B</text><rect x='470' y='140' width='120' height='40' rx='6' fill='none' stroke='#ef4444' stroke-width='1.5'/><text x='530' y='165' text-anchor='middle' fill='#fca5a5' font-size='11' font-family='monospace'>Output</text><line x1='380' y1='80' x2='470' y2='40' stroke='#f59e0b' stroke-width='1'/><line x1='380' y1='100' x2='470' y2='100' stroke='#f59e0b' stroke-width='1'/><line x1='380' y1='120' x2='470' y2='160' stroke='#ef4444' stroke-width='1'/></svg>",
      "caption": "Context fan-in → Agent reasoning → Tool fan-out"
    }
  ]
}
```

### 14. Loop Flow *(v14)*
Iterative process diagram — flow block with return arrow.

**When to use:** ReAct agent loops, OODA loops, Reflexion patterns, feedback cycles, retry mechanisms, any iterative process where the last step feeds back to the first.

**Design rules:**
- Use `flow` with `loop: true` (NOT `svg` — flow handles this natively now)
- Set `loopLabel` to describe the iteration condition
- `loopStyle: "dashed"` (default) is best for most cases
- Keep to 3-4 items — loops already add visual complexity
- Combine with `gate: true` for human-in-the-loop review points

```json
{
  "bg": "#0f172a",
  "color": "#e2e8f0",
  "accent": "#10b981",
  "padding": "36px 48px",
  "duration": 90,
  "blocks": [
    { "type": "badge", "text": "AGENT PATTERN", "icon": "Bot", "bg": "#10b98120", "color": "#34d399" },
    { "type": "spacer", "h": 8 },
    { "type": "heading", "text": "ReAct Loop", "size": "2xl", "icon": "RefreshCw" },
    { "type": "spacer", "h": 16 },
    {
      "type": "flow",
      "items": [
        { "icon": "Brain", "label": "Thought", "sublabel": "Reason about task" },
        { "icon": "Zap", "label": "Action", "sublabel": "Call tool / API" },
        { "icon": "Eye", "label": "Observe", "sublabel": "Read result" }
      ],
      "loop": true,
      "loopLabel": "repeat until task complete",
      "loopColor": "#64748b",
      "loopStyle": "dashed",
      "arrowColor": "#10b981"
    },
    { "type": "spacer", "h": 12 },
    { "type": "callout", "text": "The loop makes reasoning visible — each iteration is an auditable step.", "icon": "Shield", "bg": "rgba(16,185,129,0.1)", "border": "#10b981", "color": "#e2e8f0" }
  ]
}
```

---

### 15. Annotated Study Slide *(v12.32)*
Any archetype above **plus** an offline `studyNotes` block that renders in the 🎓 student panel with zero API calls.

**When to use:** course material, self-study decks, accessible presentations, and any environment where a live AI tutor can't be guaranteed (shared files, non-Claude hosts, offline viewing).

**Design rules:**
- Keep `studyNotes.text` tight — 150–400 words (3–6 paragraphs). The panel is a companion, not a handout.
- Include a `diagram` only when the visual genuinely adds information. It's not decoration.
- Write `questions` that probe *why* and *how*, not *what* (the slide already answered *what*).
- Populate `glossary` with the 3–8 key jargon words that actually appear on the slide. Don't catalogue every noun.
- Inline X-Ray links: `[term](#key)` where keys are lowercase. Unknown keys render as plain label text — safe fallback.
- For a definition + "learn more" combo, prefer `glossary[term] = { definition, url }` over raw inline `[label](https://…)` — it keeps the prose clean and surfaces the definition as a popover.
- Questions become clickable Vera prompts only when the live API is reachable. Design them so they still make sense as static "questions to ponder" when read offline.

**Minimal example (compact format, inside a slide):**
```json
"sN": {
  "text": "Agents close the loop: **plan → act → observe → revise**. Each iteration is an auditable step, unlike a single-shot LLM call. See the [ReAct paper](https://arxiv.org/abs/2210.03629) for the original formulation of this pattern, or explore [what an agent really is](#agent).",
  "questions": [
    "Why does exposing the loop matter for trust and debugging?",
    "When would you stop iterating — cost, confidence, or task completion?"
  ],
  "glossary": {
    "agent": { "definition": "A goal-driven loop that plans, acts, and observes — not just a single prompt.", "url": "https://example.com/agents" }
  }
}
```

The 🎓 marker appears in the TOC, gallery thumbnails, and the slide viewer automatically. No extra wiring needed.

---

### Spacing & Rhythm
- Start content slides with a `badge` (section label) → `spacer h:8` → `heading`
- Use `spacer h:12-16` between heading and content
- Use `spacer h:16-24` between content sections
- Never stack two headings without a spacer

### Visual Variety Checklist
For a 10-slide deck, aim for at least:
- 1 title slide (archetype 1)
- 1-2 section breaks (archetype 2)
- 2-3 content slides with different block types
- 1 metrics slide (archetype 5)
- 1 flow, loop flow, gated pipeline, or timeline (archetype 6, 14, 11, or 8)
- 1 grid, layer diagram, or comparison (archetype 4, 10, or 7)
- 1 spectrum if positioning is relevant (archetype 12)
- 1 diagram if non-linear visuals needed (archetype 13)
- 1 closing slide (archetype 9)

### Anti-Patterns (Avoid These)
- ❌ Heading + bullets on every slide (monotonous)
- ❌ More than 7 blocks per slide (overflow)
- ❌ No icons anywhere (bland)
- ❌ Identical bg on all slides (flat)
- ❌ Missing duration (breaks timing)
- ❌ Body text at `sm` or below (use `md` minimum for readable content, `lg` preferred)
- ❌ Using `xs` for anything except monospace labels or timestamps
- ❌ Grid with more than 3 columns (too cramped at 960px)
- ❌ Bullets with 8+ items (split into two slides)
- ❌ Label headlines ("Results") instead of assertion headlines ("Revenue Up 30%")
- ❌ Layer diagram cells with badges inside rows (use plain text sublabels)
- ❌ Layer diagram backgrounds above 0.12 opacity (too loud)
- ❌ Spectrum progress bars with `showValue: true` (position tells the story)
- ❌ Using `svg` block when `flow` with `loop: true` would work (use structured blocks first)
- ❌ SVG markup without `viewBox` attribute (breaks responsiveness)
- ❌ SVG with hardcoded colors instead of theme tokens (breaks light/dark switching)
- ❌ SVG `viewBox` height > 300px (dominates the slide)
- ❌ Slide-level `align: "center"` with `svg`, `divider`, or `progress` blocks (they collapse to zero width — use `align: "left"` + per-block centering instead)

### Content Density Guidelines
| Slide Type | Max Blocks | Max Text Lines | Target Duration |
|------------|-----------|----------------|-----------------|
| Title | 4-5 | 3 | 15-30s |
| Section Break | 3-4 | 2 | 10-15s |
| Key Point | 5-6 | 6-8 | 60-90s |
| Feature Grid | 4-5 | 9-12 (across cells) | 60-90s |
| Metrics | 4-5 | 3-4 | 20-40s |
| Process/Flow | 4-5 | 5-7 | 90-120s |
| Loop Flow | 4-6 | 5-7 | 90-120s |
| Layer Diagram | 4-6 | 6-9 (across layers) | 60-90s |
| Gated Pipeline | 4-5 | 5-7 | 90-120s |
| Spectrum | 4-6 | 4-6 | 45-90s |
| Diagram (svg) | 3-5 | 3-4 + SVG labels | 60-90s |
| Table | 3-4 | varies | 60-120s |
| Code | 3-4 | 15 lines max | 90-180s |
| Closing | 4-5 | 3 | 20-30s |

---

### Known Issues & Gotchas

#### ⚠️ `align: "center"` slides shrink-wrap blocks — SVGs and dividers collapse

**Problem:** When a slide has `align: "center"`, Vela shrink-wraps all blocks to their intrinsic content width. Blocks with no intrinsic width — `divider` (a border line), `svg` (responsive viewBox), and `progress` — collapse to zero or near-zero width and become invisible.

**Symptoms:**
- `divider` blocks disappear entirely
- `svg` blocks don't render (no width to fill)
- Layout looks like those blocks were never added

**Fix:** Use `align: "left"` at slide level and center content via individual block properties:
- Text/heading blocks: add `"align": "center"` per block
- SVG blocks: add `"align": "center"` + `"maxWidth": "60%"` (SVG renderer uses `margin: 0 auto`)
- For visual separators on centered slides: use an `svg` block with an explicit rect instead of `divider`

**Example — centered closing slide that works:**
```json
{
  "align": "left",
  "verticalAlign": "center",
  "blocks": [
    { "type": "svg", "markup": "<svg viewBox='0 0 420 70' .../>", "maxWidth": "60%", "align": "center" },
    { "type": "text", "text": "Subtitle", "align": "center" },
    { "type": "svg", "markup": "<svg viewBox='0 0 200 4'><rect ... fill='#34D399'/></svg>", "maxWidth": "25%", "align": "center" },
    { "type": "heading", "text": "Contact Name", "align": "center" }
  ]
}
```

**Rule of thumb:** Never use slide-level `align: "center"` if the slide contains `svg`, `divider`, or `progress` blocks. Use `align: "left"` + per-block centering instead.
