# Vela Block Schema Reference

Complete reference for all Vela v12 slide block types (27 total).

## Slide Object

```
{
  "blocks": [ ...block objects... ],
  "bg": "#0f172a",                              // solid background color
  "bgGradient": "linear-gradient(135deg, ...)", // gradient (overrides bg visually)
  "color": "#e2e8f0",                           // default text color
  "accent": "#3b82f6",                          // accent color for dots, icons, highlights
  "align": "left|center|right",                 // horizontal alignment of block stack
  "verticalAlign": "top|center|bottom",          // vertical alignment within 540px canvas
  "padding": "36px 48px",                       // slide padding (CSS format)
  "gap": 16,                                    // gap between blocks (px)
  "duration": 60,                               // speaking time estimate (seconds, REQUIRED)
  "title": "Slide Name"                         // optional label for filmstrip/TOC
}
```

**Layout note:** Left-aligned slides (`align: "left"` or default) stretch blocks to full width. Center-aligned slides (`align: "center"`) shrink-wrap blocks. This means flow, grid, and progress blocks automatically fill the canvas on content slides.

## Slide-level optional: `studyNotes` (offline student content, v12.32+)

Pre-authored companion content that renders in the 🎓 student panel with **zero API calls**. Mirrors the live Vera Teacher output shape so the existing markdown + inline-SVG renderer is reused.

```json
{
  "studyNotes": {
    "text": "Markdown body. Supports **bold**, *italic*, ~~strike~~, [label](https://example.com), and [X-Ray term](#agent).",
    "diagram": "<svg viewBox='0 0 320 140'>...</svg>",
    "questions": ["Why does X happen?", "How does Y relate to Z?"],
    "glossary": {
      "agent": {
        "definition": "A goal-driven loop that plans, acts, observes.",
        "url": "https://example.com/agents"
      }
    }
  }
}
```

**Field reference:**
- `text` *(required, string, ≤ 4000 chars, warn at 2000)* — markdown body, rendered via the same `parseInline` + `ChatMarkdown` pipeline used by live Vera chat. Supports `**bold**`, `*italic*`, `***both***`, `~~strike~~`, `__underscores__`, `[label](https://…)` external links, and `[label](#term)` X-Ray glossary refs.
- `diagram` *(optional, string, ≤ 8000 chars)* — one complete, well-formed inline SVG. Rendered under the text body via `sanitizeSvgMarkup` (DOMParser-based strip of `<script>`, event handlers, `javascript:/data:/vbscript:` URIs).
- `questions` *(optional, array, max 6, each ≤ 160 chars)* — pre-authored follow-up questions. When the Claude API / MCP channel is reachable they render as clickable buttons that send the question into the live Vera Teacher flow; otherwise they render as static "Questions to ponder" bullets.
- `glossary` *(optional, object, max 24 entries)* — `{ termKey: { definition: string ≤ 400 chars, url?: sanitized URL } }`. Keys are lowercased and `[^\w-]` stripped on load, so match is case-insensitive. The inline syntax `[label](#term)` looks up the entry and renders a Kindle-style popover with the definition + optional "Learn more" link. Unknown terms render as plain label text.

**Behavior matrix:**

| Has `studyNotes` | API reachable | Result |
|---|---|---|
| yes | yes | Static content + clickable questions + Ask Vera input (live answers layer below) |
| yes | no  | Static content only; questions become non-interactive bullets; no input |
| no  | yes | Existing live `TeacherPanel` (auto-generates from the slide) |
| no  | no  | Existing live `TeacherPanel` → graceful degrade via `callVeraTeacher` catch |

**Sanitization:**
- `text` strips HTML tags, NULL bytes (sentinel safety for the link parser), and truncates at 4000 chars.
- `diagram` runs through `sanitizeSvgMarkup` — empty-string fallback if invalid.
- External URLs allow only `http:`, `https:`, `mailto:` via `sanitizeUrl`. Blocked URLs render as plain text.
- Glossary entries with empty definitions are dropped.

**Visible marker:** Slides that carry `studyNotes` show a 🎓 badge in the TOC, gallery thumbnails, and main slide viewer (top-left, next to the top-right comment badge).

**Limitation:** X-Ray `[term](#key)` syntax activates only inside `studyNotes.text`. Regular text / heading / bullets / callout blocks render it as plain label text because they call `parseInline(text)` without a glossary context.

**Compact format:** short key `sN` on the slide object; value is passed verbatim (the palette-alias pass skips `studyNotes` fields so literal hex codes in prose aren't mangled).

**Turbo format:** optional position 10 on the slide array. Backward compatible — old decoders ignore the extra position, new decoders guard on `len(s) > 10`.

**Authoring:** JSON-only for v12.32. No in-app editor UI yet. A Vera `set_study_notes` tool is planned for a future release so the live engine can author offline notes on demand.

## Block Types

### heading
Title/heading text with optional icon.
```json
{
  "type": "heading",
  "text": "Your Heading Here",
  "size": "2xl",
  "color": "#ffffff",
  "weight": 700,
  "align": "left|center|right",
  "icon": "Zap",
  "iconColor": "#3b82f6",
  "maxWidth": "80%",
  "style": {}
}
```
Sizes: `xs` (12px), `sm` (14px), `md` (17px), `lg` (20px), `xl` (26px), `2xl` (35px), `3xl` (46px), `4xl` (56px)

### text
Body text paragraph.
```json
{
  "type": "text",
  "text": "Body text content here.",
  "size": "md",
  "color": "#94a3b8",
  "bold": false,
  "italic": false,
  "align": "left|center|right",
  "maxWidth": "70%",
  "style": {}
}
```

### bullets
Bullet list with optional per-item icons.
```json
{
  "type": "bullets",
  "items": [
    "Plain string item",
    { "text": "Item with icon", "icon": "CheckCircle" },
    { "text": "Another item", "icon": "ArrowRight" }
  ],
  "size": "md",
  "dotColor": "#3b82f6",
  "gap": 8,
  "color": "#e2e8f0",
  "style": {}
}
```

### image
Inline image block.
```json
{
  "type": "image",
  "src": "data:image/... or URL",
  "caption": "Optional caption",
  "maxWidth": "80%",
  "shadow": true,
  "rounded": true
}
```
Note: When improving existing slides, keep `src` as `"keep-original"` to preserve image data.

### code
Code snippet with label. Optional `copy: true` adds a "Copiar" button that copies text to clipboard.
```json
{
  "type": "code",
  "text": "const hello = 'world';",
  "label": "JAVASCRIPT",
  "copy": true,
  "size": "sm",
  "bg": "#1e293b",
  "color": "#e2e8f0"
}
```

### grid
Multi-column layout. Each cell contains its own blocks array.

**v13:** Cells support `direction: "row"` for horizontal block flow (layer diagrams, inline icon+label bars).

```json
{
  "type": "grid",
  "cols": 2,
  "gap": 16,
  "items": [
    {
      "direction": "column",
      "blocks": [
        { "type": "icon", "name": "Zap", "color": "#fbbf24", "circle": true, "bg": "#fbbf2420" },
        { "type": "heading", "text": "Feature A", "size": "lg" },
        { "type": "text", "text": "Description here", "size": "sm" }
      ],
      "style": { "padding": "16px", "background": "rgba(255,255,255,0.05)", "borderRadius": "8px" }
    }
  ]
}
```

**Cell props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `direction` | `"row" \| "column"` | `"column"` | Flex direction for blocks within cell. `"row"` = horizontal with centered alignment and 12px gap. `"column"` = vertical stack with 8px gap |
| `blocks` | array | required | Child block objects |
| `style` | object | `{}` | CSS style overrides on the cell container |

Max 2-3 cols. Max 6 cells. Keep cell blocks minimal (2-4 blocks each).

### callout
Highlighted insight or tip box.
```json
{
  "type": "callout",
  "text": "Key insight or important note here.",
  "title": "Optional Title",
  "bg": "rgba(59,130,246,0.15)",
  "border": "#3b82f6",
  "color": "#e2e8f0",
  "icon": "Lightbulb"
}
```

### metric
Large statistic/number display.
```json
{
  "type": "metric",
  "value": "42%",
  "label": "REDUCTION IN ERRORS",
  "size": "3xl",
  "color": "#3b82f6",
  "labelColor": "#94a3b8",
  "icon": "TrendingUp",
  "iconColor": "#3b82f6"
}
```

### quote
Quotation with attribution.
```json
{
  "type": "quote",
  "text": "The best way to predict the future is to invent it.",
  "author": "Alan Kay",
  "size": "xl",
  "color": "#e2e8f0"
}
```

### badge
Small label/tag, often placed above headings.
```json
{
  "type": "badge",
  "text": "SECTION 01",
  "color": "#ffffff",
  "bg": "#3b82f6",
  "icon": "Star"
}
```

### icon
Standalone icon, optionally with circle background and label.
```json
{
  "type": "icon",
  "name": "Brain",
  "size": "lg",
  "color": "#3b82f6",
  "bg": "#3b82f620",
  "circle": true,
  "label": "Optional label below",
  "border": "#3b82f640"
}
```
Sizes: `sm` (16px), `md` (24px), `lg` (32px), `xl` (48px)

### icon-row
Feature list with icons — use INSTEAD of bullets for visual impact.
```json
{
  "type": "icon-row",
  "items": [
    { "icon": "Zap", "title": "Fast", "text": "Sub-second response times", "iconColor": "#fbbf24", "iconBg": "#fbbf2420" },
    { "icon": "Shield", "title": "Secure", "text": "End-to-end encryption", "iconColor": "#34d399", "iconBg": "#34d39920" },
    { "icon": "Globe", "title": "Global", "text": "Available in 40+ countries", "iconColor": "#60a5fa", "iconBg": "#60a5fa20" }
  ],
  "iconBg": "#3b82f620",
  "iconColor": "#3b82f6",
  "iconShape": "circle|square",
  "gap": 16,
  "titleSize": "lg",
  "textSize": "md"
}
```

### flow
Process/pipeline diagram with connected steps.

**v13:** Items support `gate: true` for human-review checkpoint indicators between steps.
**v14:** Block supports `loop: true` for iterative processes with a return arrow from last step back to first.

```json
{
  "type": "flow",
  "items": [
    { "icon": "FileText", "label": "Input", "sublabel": "Raw data" },
    { "icon": "Cpu", "label": "Process", "sublabel": "AI model", "gate": true },
    { "icon": "CheckCircle", "label": "Output", "sublabel": "Results" }
  ],
  "arrowColor": "#3b82f6",
  "direction": "horizontal|vertical",
  "connectorStyle": "arrow|dashed|line",
  "iconBg": "#3b82f620",
  "labelColor": "#e2e8f0",
  "sublabelColor": "#94a3b8",
  "gateIcon": "UserCheck",
  "gateLabel": "Review",
  "gateColor": "#f59e0b",
  "loop": true,
  "loopLabel": "repeat until done",
  "loopColor": "#64748b",
  "loopStyle": "dashed"
}
```

**Flow item props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `icon` | string (Lucide) | — | Icon name for step |
| `label` | string | — | Step label |
| `sublabel` | string | — | Secondary text below label |
| `gate` | boolean | `false` | Show gate checkpoint AFTER this item |

**Flow block gate props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `gateIcon` | string (Lucide) | `"UserCheck"` | Icon inside the gate circle |
| `gateLabel` | string | — | Optional label below gate (e.g. "Approve", "HITL") |
| `gateColor` | string (hex) | slide accent | Color for gate circle border, icon, and label |

Gates render as a dashed-circle checkpoint between the gated item and the next arrow. The gate aligns to the icon centerline regardless of text height below.

**Flow block loop props (v14):**

| Prop | Type | Default | Description |
|---|---|---|---|
| `loop` | boolean | `false` | Show return arrow from last item back to first |
| `loopLabel` | string | — | Label centered on the return arrow (e.g. "repeat until done") |
| `loopColor` | string (hex) | slide accent at 50% | Color of return arrow and label |
| `loopStyle` | `"dashed"\|"dotted"\|"solid"` | `"dashed"` | Stroke style of return path |

Loop renders a dashed return arrow beneath horizontal flows (or right of vertical flows), connecting the last item back to the first. Use for agent loops (ReAct, OODA), feedback cycles, iterative processes.

### table
Data table with headers and rows.
```json
{
  "type": "table",
  "headers": ["Feature", "Basic", "Pro", "Enterprise"],
  "rows": [
    ["Users", "5", "50", "Unlimited"],
    ["Storage", "1 GB", "100 GB", "1 TB"],
    ["Support", "Email", "Priority", "Dedicated"]
  ],
  "striped": true,
  "headerBg": "#1e293b",
  "headerColor": "#e2e8f0",
  "cellColor": "#cbd5e1",
  "borderColor": "#334155",
  "size": "sm"
}
```

### progress
Progress/skill bars.

**v13:** Supports endpoint labels and annotation for spectrum/continuum visuals.

```json
{
  "type": "progress",
  "items": [
    { "label": "Python", "value": 95, "color": "#3b82f6" },
    { "label": "TypeScript", "value": 85, "color": "#8b5cf6" },
    { "label": "Rust", "value": 60, "color": "#f97316" }
  ],
  "showValue": true,
  "trackColor": "#1e293b",
  "height": 8,
  "labelColor": "#e2e8f0",
  "size": "sm",
  "leftLabel": "Beginner",
  "rightLabel": "Expert",
  "leftIcon": "BookOpen",
  "rightIcon": "Trophy",
  "annotation": "Team average across all languages",
  "annotationColor": "#94a3b8"
}
```

**New progress props (v13):**

| Prop | Type | Default | Description |
|---|---|---|---|
| `leftLabel` | string | — | Label at left end of track |
| `rightLabel` | string | — | Label at right end of track |
| `leftIcon` | string (Lucide) | — | Icon before left label |
| `rightIcon` | string (Lucide) | — | Icon after right label |
| `annotation` | string | — | Italic text centered below the progress track |
| `annotationColor` | string (hex) | `#94a3b8` | Color for annotation text |

Values: 0-100 (percentage). Endpoint labels render above the track. Annotation renders below.

### steps
Numbered sequential process with connecting line.
```json
{
  "type": "steps",
  "items": [
    { "title": "Discover", "text": "Identify the problem space" },
    { "title": "Design", "text": "Prototype solutions" },
    { "title": "Deliver", "text": "Ship and iterate" }
  ],
  "lineColor": "#3b82f6",
  "activeStep": 2,
  "numberColor": "#3b82f6",
  "titleColor": "#e2e8f0",
  "textColor": "#94a3b8"
}
```

### tag-group
Inline chip/tag collection.
```json
{
  "type": "tag-group",
  "items": [
    { "text": "React", "color": "#61dafb", "icon": "Code" },
    { "text": "Python", "color": "#3776ab" },
    { "text": "Docker", "color": "#2496ed", "icon": "Box" }
  ],
  "variant": "filled|outline|subtle",
  "gap": 8,
  "size": "sm"
}
```

### timeline
Temporal progression / roadmap.
```json
{
  "type": "timeline",
  "items": [
    { "date": "Q1 2025", "title": "Alpha Launch", "text": "Internal testing" },
    { "date": "Q2 2025", "title": "Beta", "text": "Selected partners" },
    { "date": "Q3 2025", "title": "GA", "text": "Public release" }
  ],
  "lineColor": "#3b82f6",
  "dotColor": "#3b82f6",
  "dateColor": "#60a5fa",
  "titleColor": "#e2e8f0",
  "textColor": "#94a3b8",
  "direction": "horizontal|vertical"
}
```

### svg *(v14)*
Inline SVG diagram — escape hatch for visuals that structured blocks can't express.

**Use when:** Feedback loops, fan-outs (1→N), mesh connectors (M×N), variable-width layers, probability distributions, custom architecture diagrams with non-linear connections.

**Don't use when:** A structured block (`flow`, `grid`, `steps`, `progress`) would work — structured blocks are more maintainable and theme-aware.

```json
{
  "type": "svg",
  "markup": "<svg viewBox='0 0 400 160' xmlns='http://www.w3.org/2000/svg'><rect x='10' y='20' width='100' height='50' rx='8' fill='none' stroke='{{accent}}' stroke-width='2'/><text x='60' y='50' text-anchor='middle' fill='{{color}}' font-size='12' font-family='monospace'>Step 1</text></svg>",
  "maxWidth": "80%",
  "align": "center",
  "caption": "Optional caption below",
  "captionColor": "#94a3b8",
  "captionSize": "sm",
  "bg": "rgba(0,0,0,0.2)",
  "padding": "16px",
  "rounded": true
}
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `markup` | string (SVG) | — (required) | Raw SVG with `viewBox`. NO fixed `width`/`height`. |
| `maxWidth` | string (CSS) | `"100%"` | Max width (e.g. `"80%"`, `"400px"`) |
| `align` | `"left"\|"center"\|"right"` | inherits | Horizontal alignment |
| `caption` | string | — | Caption text below SVG |
| `captionColor` | string (hex) | `"#94a3b8"` | Caption color |
| `captionSize` | size token | `"sm"` | Caption size (`xs`, `sm`, `md`) |
| `bg` | string (CSS) | `"transparent"` | Background behind SVG |
| `padding` | string (CSS) | `"0"` | Padding around SVG |
| `rounded` | boolean | `false` | Border-radius 8px on container |

**Theme tokens** — replaced at render time:

| Token | Resolves to |
|---|---|
| `{{color}}` | slide `color` (default `#e2e8f0`) |
| `{{accent}}` | slide `accent` (default `#3b82f6`) |
| `{{bg}}` | slide `bg` (default `#0f172a`) |
| `{{muted}}` | slide color at 50% opacity |

**SVG authoring rules:**
- Always include `viewBox`, never fixed `width`/`height`
- Use `{{accent}}`, `{{color}}`, `{{muted}}`, `{{bg}}` tokens for theme adaptation
- Use `monospace` font-family for labels
- Keep diagrams simple: 2-8 elements, clear visual hierarchy
- Prefer stroke-based outlines (`fill="none" stroke="{{accent}}"`) over filled shapes
- Max `viewBox` height ~200-300px to avoid dominating the slide
- Text sizes: 11-16px for labels, 8-10px for annotations

### comparison
Side-by-side A vs B layout with semantic coloring, icon headers, and optional central divider. Use for before/after, pros/cons, plan A vs B.
```json
{
  "type": "comparison",
  "items": [
    {
      "title": "Before",
      "icon": "X",
      "color": "#ef4444",
      "items": ["Manual deploys", "2-hour releases", "No rollback"]
    },
    {
      "title": "After",
      "icon": "Check",
      "color": "#22c55e",
      "items": ["CI/CD pipeline", "5-min deploys", "One-click rollback"]
    }
  ],
  "dividerLabel": "VS",
  "titleSize": "md",
  "size": "sm"
}
```
| Prop | Type | Default | Description |
|---|---|---|---|
| items | array(2) | `[]` | Exactly 2 side objects: `{title, icon?, color?, items[]}` |
| items[].title | string | | Side heading (e.g. "Before", "Pros") |
| items[].icon | string | | Lucide icon for side header |
| items[].color | string | left:`#ef4444` right:`#22c55e` | Side accent color |
| items[].items | string[] | `[]` | Bullet points for that side |
| dividerLabel | string | `"VS"` | Text in center divider circle |
| hideDivider | boolean | `false` | Hide the VS divider circle |
| titleSize | size | `"md"` | Size of side titles |
| size | size | `"sm"` | Size of bullet text |

### funnel
Tapered stages from wide to narrow. SVG-rendered trapezoids with labels, values, and drop annotations.
```json
{
  "type": "funnel",
  "items": [
    { "label": "Visitors", "value": "124,000", "color": "#3b82f6" },
    { "label": "Signups", "value": "31,200", "color": "#6366f1", "drop": "−74.8%" },
    { "label": "Activated", "value": "4,800", "color": "#ef4444", "drop": "−84.6%", "highlight": true },
    { "label": "Paying", "value": "1,920", "color": "#a855f7", "drop": "−60.0%" }
  ]
}
```
| Prop | Type | Default | Description |
|---|---|---|---|
| items | array | `[]` | Funnel stages top-to-bottom |
| items[].label | string | | Stage name |
| items[].value | string | | Display value (e.g. "124,000") |
| items[].color | string | accent | Stage color |
| items[].drop | string | | Drop annotation (e.g. "−74.8%") |
| items[].highlight | boolean | `false` | Dashed border to highlight problem stage |

### cycle
Circular process diagram with nodes around a circle, connected by curved arrows. Optional center label.
```json
{
  "type": "cycle",
  "centerLabel": "ReAct",
  "centerSub": "Agent Loop",
  "items": [
    { "label": "Think", "icon": "🧠", "color": "#3b82f6" },
    { "label": "Act", "icon": "⚡", "color": "#22c55e" },
    { "label": "Observe", "icon": "👁", "color": "#f97316" },
    { "label": "Reflect", "icon": "🔄", "color": "#8b5cf6" }
  ]
}
```
| Prop | Type | Default | Description |
|---|---|---|---|
| items | array | `[]` | Nodes arranged in a circle (3-7 recommended) |
| items[].label | string | | Node label |
| items[].icon | string | | Emoji or text shown inside node |
| items[].color | string | auto-cycle | Node and arrow color |
| centerLabel | string | | Large text in center of circle |
| centerSub | string | | Smaller text below centerLabel |

### number-row
Inline row of 2-5 big metrics with labels, optional icons, separated by thin dividers. Replaces grid+metric boilerplate.
```json
{
  "type": "number-row",
  "items": [
    { "value": "99.97%", "label": "Uptime", "icon": "Activity", "color": "#22c55e" },
    { "value": "38ms", "label": "P95 Latency", "icon": "Clock", "color": "#3b82f6" },
    { "value": "2.4M", "label": "Active Users", "icon": "Users", "color": "#8b5cf6" }
  ],
  "size": "3xl",
  "compact": false,
  "bordered": false
}
```
| Prop | Type | Default | Description |
|---|---|---|---|
| items | array | `[]` | 2-5 metric items |
| items[].value | string | | Big display value |
| items[].label | string | | Uppercase label below value |
| items[].icon | string | | Lucide icon above value |
| items[].color | string | accent | Value and icon color |
| size | size | `"3xl"` | Value font size |
| compact | boolean | `false` | Smaller padding, "2xl" default size |
| bordered | boolean | `false` | Add background border container |
| showIcons | boolean | `true` | Show/hide icon circles |

### matrix
2×2 quadrant grid with axis labels and per-quadrant coloring. Use for SWOT, Eisenhower, effort/impact.
```json
{
  "type": "matrix",
  "xLeft": "INTERNAL",
  "xRight": "EXTERNAL",
  "yTop": "POSITIVE",
  "yBottom": "NEGATIVE",
  "quadrants": [
    { "title": "Strengths", "icon": "TrendingUp", "color": "#22c55e", "items": ["Strong team", "First mover"] },
    { "title": "Opportunities", "icon": "Lightbulb", "color": "#3b82f6", "items": ["Enterprise market", "API ecosystem"] },
    { "title": "Weaknesses", "icon": "TrendingDown", "color": "#f97316", "items": ["Small team", "Limited blocks"] },
    { "title": "Threats", "icon": "AlertTriangle", "color": "#ef4444", "items": ["Big tech competitors", "Cost increases"] }
  ]
}
```
| Prop | Type | Default | Description |
|---|---|---|---|
| quadrants | array(4) | `[]` | Four quadrant objects: top-left, top-right, bottom-left, bottom-right |
| quadrants[].title | string | | Quadrant heading |
| quadrants[].icon | string | | Lucide icon for heading |
| quadrants[].color | string | auto | Quadrant accent color |
| quadrants[].items | string[] | `[]` | Bullet points in quadrant |
| xLeft | string | | Top-left x-axis label |
| xRight | string | | Top-right x-axis label |
| yTop | string | | Left y-axis top label |
| yBottom | string | | Left y-axis bottom label |

Note: `items` can be used as an alias for `quadrants`.

### checklist
Status-aware item list with semantic icons and colors for each state: done, partial, pending, blocked.
```json
{
  "type": "checklist",
  "items": [
    { "text": "SSO integration", "status": "done" },
    { "text": "Audit logging", "status": "done" },
    { "text": "SOC 2 certification", "status": "partial" },
    { "text": "HIPAA BAA template", "status": "pending" },
    { "text": "EU data residency", "status": "blocked" }
  ],
  "size": "sm",
  "showLabels": true
}
```
| Prop | Type | Default | Description |
|---|---|---|---|
| items | array | `[]` | Checklist items |
| items[].text | string | | Item text |
| items[].status | enum | `"pending"` | `"done"`, `"partial"`, `"pending"`, `"blocked"` |
| size | size | `"sm"` | Text font size |
| showLabels | boolean | `true` | Show status label on right side |

### spacer
Vertical whitespace.
```json
{ "type": "spacer", "h": 16 }
```

### divider
Horizontal line separator.
```json
{
  "type": "divider",
  "color": "#334155",
  "spacing": 16
}
```
