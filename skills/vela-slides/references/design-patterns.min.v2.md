# Vela Design Patterns & Slide Archetypes

> **v12.5** · 2026-03-23

## Slide Archetypes

Every slide should follow one of these patterns. Mix them for visual variety.

| # | Archetype | Composition | Duration |
|---|---|---|---|
| 1 | Title Slide | Opening — centered, gradient bg, badge + 4xl heading + subtitle + presenter line. `verticalAlign: "center"`, `align: "center"` | 20s |
| 2 | Section Break | Divides sections — centered xl icon in circle + 3xl heading + subtitle, high-contrast gradient | 15s |
| 3 | Key Point + Supporting Detail | Workhorse slide — badge → spacer → 2xl assertion heading w/ icon → body text → callout | 60-90s |
| 4 | Feature Grid | 2-3 col grid, icon + heading + text per cell; cell gets subtle colored bg (`rgba(...,0.08)`) + border | 60-90s |
| 5 | Metrics / Stats | 3-col grid of metric blocks — large values (`3xl`), icons, ALL-CAPS labels, gradient bg | 20-40s |
| 6 | Process / Flow | Horizontal flow, 3-5 icon steps + sublabels, arrows. `loop: true` for iterative processes (agent loops, ReAct, OODA, feedback cycles); `gate: true` for human-review checkpoints; italic footnote below | 90-120s |
| 7 | Comparison Table | Table block, striped rows, colored headers, heading w/ icon above | 60-120s |
| 8 | Timeline / Roadmap | Horizontal timeline, 3-5 dated milestones | 60s |
| 9 | Closing / CTA | Centered — xl icon + 3xl heading + body text + tag-group for contact/links, gradient bg | 30s |

### 10. Layer Diagram *(v13)*
Stacked architecture/composition visual: 1-col grid, `direction: "row"` cells.

**When to use:** architecture stacks, OSI model, testing pyramid, context window composition, agent anatomy, MCP layers, any layered system where order implies hierarchy.

**Design rules:**
- `cols: 1` grid — each cell = one horizontal layer bar
- Each cell: `direction: "row"` with `icon` + `heading` + `text` inline
- Left border color = layer's semantic color
- Background opacity `0.06–0.10` (subtle, not loud)
- Tight padding: `10px 16px` to `14px 20px`
- Sublabel text as plain `text` block, not badges (cleaner)

```json
{"bg":"#0f172a","color":"#e2e8f0","accent":"#3b82f6","padding":"36px 48px","duration":90,"blocks":[{"type":"heading","text":"Composable Layers","size":"2xl"},{"type":"spacer","h":12},{"type":"grid","cols":1,"gap":8,"items":[{"direction":"row","blocks":[{"type":"icon","name":"FileText","size":"md","color":"#3b82f6","circle":true,"bg":"#3b82f620"},{"type":"heading","text":"Specification","size":"lg"},{"type":"text","text":"Intent & constraints","size":"sm","color":"#94a3b8"}],"style":{"background":"rgba(59,130,246,0.08)","borderLeft":"4px solid #3b82f6","borderRadius":"8px","padding":"12px 18px"}},{"direction":"row","blocks":[{"type":"icon","name":"CheckCircle","size":"md","color":"#34d399","circle":true,"bg":"#34d39920"},{"type":"heading","text":"Verification","size":"lg"},{"type":"text","text":"CI / Tests / Evals","size":"sm","color":"#94a3b8"}],"style":{"background":"rgba(52,211,153,0.08)","borderLeft":"4px solid #34d399","borderRadius":"8px","padding":"12px 18px"}}]}]}
```

### 11. Gated Pipeline *(v13)*
Workflow with human-review checkpoints between stages.

**When to use:** CI/CD approval stages, spec-driven development phases, deployment pipelines, compliance workflows, code review gates.

**Design rules:**
- `flow` with `gate: true` on items needing a checkpoint AFTER them
- `gateIcon`/`gateLabel`/`gateColor` at block level (shared across gates)
- Gates render as dashed-circle checkpoints aligned to icon centerline
- Amber/gold (`#f59e0b`) is the natural gate color — implies "pause and review"
- Keep flow to 3-5 items max (gates add visual width)

```json
{"bg":"#0f172a","color":"#e2e8f0","accent":"#3b82f6","padding":"36px 48px","duration":120,"blocks":[{"type":"heading","text":"CI/CD with Approval Gates","size":"2xl","icon":"GitBranch"},{"type":"flow","items":[{"icon":"Code","label":"Build","sublabel":"Compile + lint"},{"icon":"FlaskConical","label":"Test","sublabel":"Unit + E2E","gate":true},{"icon":"Rocket","label":"Production","sublabel":"Live"}],"gateIcon":"UserCheck","gateLabel":"Approve","gateColor":"#f59e0b","arrowColor":"#3b82f6","direction":"horizontal"}]}
```

### 12. Spectrum / Continuum *(v13)*
Position something between two extremes: progress bar with endpoint labels.

**When to use:** methodology positioning, risk scales, maturity models, capability continuum, team skill assessment, cost-quality tradeoff.

**Design rules:**
- Single `progress` item at a specific `value` (0-100) position
- `leftLabel`/`rightLabel` define the extremes; optional `leftIcon`/`rightIcon`
- `showValue: false` — the position tells the story, not the number
- `annotation` below explains positioning in context
- `height: 10-12` for visual weight
- Can stack multiple progress blocks for multi-dimension spectrums

```json
{"bg":"#0f172a","color":"#e2e8f0","accent":"#3b82f6","padding":"36px 48px","duration":60,"blocks":[{"type":"heading","text":"Not Waterfall, Not Vibe Coding","size":"2xl"},{"type":"progress","items":[{"label":"SDD","value":35,"color":"#3b82f6"}],"leftLabel":"Waterfall","rightLabel":"Vibe Coding","showValue":false,"trackColor":"#1e293b","height":10,"annotation":"Shorter feedback loops than waterfall, better output than vibe coding"}]}
```

### 13. Diagram Slide *(v14)*
Custom SVG diagram for non-linear visuals structured blocks can't express.

**When to use:** architecture diagrams with feedback loops, fan-out patterns (1→N), mesh connectors (M×N), probability distributions, custom layouts with arrows between arbitrary elements.

**Design rules:**
- Badge → spacer → `svg` block → optional callout/text below
- Always use theme tokens (`{{accent}}`, `{{color}}`, `{{muted}}`, `{{bg}}`) in SVG markup
- Keep `viewBox` height ≤ 300px
- Use `monospace` font-family for SVG text
- Prefer stroke-based outlines over filled shapes
- `maxWidth: "90%"` and `align: "center"` for typical diagrams
- Use `caption` for diagram labels instead of separate text blocks

```json
{"bg":"#0f172a","color":"#e2e8f0","accent":"#3b82f6","blocks":[{"type":"heading","text":"Agent Core with Context Fan-Out","size":"2xl"},{"type":"svg","maxWidth":"90%","align":"center","markup":"<svg viewBox='0 0 600 200'><rect x='220' y='60' width='160' height='80' rx='12' fill='none' stroke='{{accent}}' stroke-width='2'/><text x='300' y='105' text-anchor='middle' fill='{{color}}' font-size='16' font-family='monospace'>Agent Core</text><rect x='10' y='20' width='120' height='40' rx='6' fill='none' stroke='{{accent}}' stroke-width='1.5'/><text x='70' y='45' text-anchor='middle' fill='{{muted}}' font-size='11' font-family='monospace'>RAG Store</text><line x1='130' y1='40' x2='220' y2='80' stroke='{{muted}}' stroke-width='1'/></svg>","caption":"Context fan-in → Agent reasoning → Tool fan-out"}]}
```
*(extend the same rect/text/line pattern for more nodes)*

### 14. Loop Flow *(v14)*
Iterative process diagram — flow block with return arrow.

**When to use:** ReAct agent loops, OODA loops, Reflexion patterns, feedback cycles, retry mechanisms, any iterative process where the last step feeds back to the first.

**Design rules:**
- Use `flow` with `loop: true` (NOT `svg` — flow handles this natively now)
- `loopLabel` describes the iteration condition
- `loopStyle: "dashed"` (default) is best for most cases
- Keep to 3-4 items — loops already add visual complexity
- Combine with `gate: true` for human-in-the-loop review points

```json
{"bg":"#0f172a","color":"#e2e8f0","accent":"#10b981","padding":"36px 48px","duration":90,"blocks":[{"type":"heading","text":"ReAct Loop","size":"2xl","icon":"RefreshCw"},{"type":"flow","items":[{"icon":"Brain","label":"Thought","sublabel":"Reason about task"},{"icon":"Zap","label":"Action","sublabel":"Call tool / API"},{"icon":"Eye","label":"Observe","sublabel":"Read result"}],"loop":true,"loopLabel":"repeat until task complete","loopStyle":"dashed","arrowColor":"#10b981"}]}
```

---

### 15. Annotated Study Slide *(v12.32)*
Any archetype above **plus** an offline `studyNotes` block rendering in the 🎓 student panel with zero API calls.

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
  "text": "Agents close the loop: **plan → act → observe → revise**. See the [ReAct paper](https://arxiv.org/abs/2210.03629) for the original formulation, or explore [what an agent really is](#agent).",
  "questions": ["Why does exposing the loop matter for trust and debugging?"],
  "glossary": { "agent": { "definition": "A goal-driven loop that plans, acts, and observes — not just a single prompt.", "url": "https://example.com/agents" } }
}
```

The 🎓 marker appears in the TOC, gallery thumbnails, and the slide viewer automatically. No extra wiring needed.

---

### Spacing & Rhythm
- Start content slides with a `badge` (section label) → `spacer h:8` → `heading`
- `spacer h:12-16` between heading and content
- `spacer h:16-24` between content sections
- Never stack two headings without a spacer

### Visual Variety Checklist
For a 10-slide deck, aim for at least:
- 1 title slide (1); 1-2 section breaks (2); 2-3 content slides with different block types
- 1 metrics slide (5)
- 1 flow/loop flow/gated pipeline/timeline (6, 14, 11, or 8)
- 1 grid/layer diagram/comparison (4, 10, or 7)
- 1 spectrum if positioning is relevant (12); 1 diagram if non-linear visuals needed (13)
- 1 closing slide (9)

### Anti-Patterns (Avoid These)
- ❌ Heading + bullets on every slide (monotonous)
- ❌ More than 7 blocks per slide (overflow)
- ❌ No icons anywhere (bland); identical bg on all slides (flat); missing duration (breaks timing)
- ❌ Body text at `sm` or below (use `md` minimum, `lg` preferred)
- ❌ Using `xs` for anything except monospace labels or timestamps
- ❌ Grid with more than 3 columns (too cramped at 960px)
- ❌ Bullets with 8+ items (split into two slides)
- ❌ Label headlines ("Results") instead of assertion headlines ("Revenue Up 30%")
- ❌ Layer diagram cells with badges inside rows (use plain text sublabels); backgrounds above 0.12 opacity (too loud)
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
{"align":"left","verticalAlign":"center","blocks":[{"type":"svg","markup":"<svg viewBox='0 0 420 70' .../>","maxWidth":"60%","align":"center"},{"type":"text","text":"Subtitle","align":"center"},{"type":"heading","text":"Contact Name","align":"center"}]}
```

**Rule of thumb:** Never use slide-level `align: "center"` if the slide contains `svg`, `divider`, or `progress` blocks. Use `align: "left"` + per-block centering instead.

---

## Cols Layout Patterns

`layout: "cols"` splits blocks into `L`/`R` arrays. Optional `blocks` (compact `B`) renders full-width above as a header. `contentFlex`/`imageFlex` set column widths (default 1:1); `splitGap` sets the gap (default 32px).

### Header + Balanced Cols (most common)
B: badge + heading + context callout. L: primary content (steps, bullets, table). R: supporting visual (SVG, metrics, flow diagram).

```json
{"layout":"cols","contentFlex":3,"imageFlex":2,"blocks":[{"type":"badge","text":"ARCHITECTURE"},{"type":"heading","text":"System Overview","size":"2xl"}],"L":[{"type":"bullets","items":["Microservices","Event-driven","Auto-scaling"]}],"R":[{"type":"flow","items":[{"icon":"Upload","label":"In"},{"icon":"Cpu","label":"Process"},{"icon":"Download","label":"Out"}]}]}
```

### Pure Side-by-Side (no header)
L: "Before" content with badge. R: "After" content with badge.

```json
{
  "layout": "cols",
  "L": [
    { "type": "badge", "text": "BEFORE", "bg": "#dc2626" },
    { "type": "bullets", "items": ["Manual deploys", "3-hour rollbacks"] }
  ],
  "R": [
    { "type": "badge", "text": "AFTER", "bg": "#16a34a" },
    { "type": "bullets", "items": ["CI/CD pipeline", "5-min rollbacks"] }
  ]
}
```

### Content + Sidebar
contentFlex: 4, imageFlex: 1. L: main content. R: 1-2 metrics or single visual.

```json
{"layout":"cols","contentFlex":4,"imageFlex":1,"blocks":[{"type":"heading","text":"Q4 Results","size":"2xl"}],"L":[{"type":"steps","items":[{"title":"Step 1","text":"Launched beta"},{"title":"Step 2","text":"Scaled to 10K users"}]}],"R":[{"type":"metric","value":"98%","label":"Uptime","size":"2xl"}]}
```

### Common Ratio Patterns

| Ratio | contentFlex:imageFlex | Use case |
|-------|----------------------|----------|
| Equal | 1:1 | Before/after, comparison |
| Wide left | 3:2 | Text + supporting visual |
| Wide right | 2:3 | Summary + detailed steps |
| Sidebar | 4:1 or 1:4 | Main content + narrow metric strip |
</content>
