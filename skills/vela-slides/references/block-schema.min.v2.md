# Vela Block Schema Reference

27 block types, Vela v12.

## Slide Object

```
{
  "blocks": [ ...block objects... ],
  "bg": "#0f172a",           // solid bg color
  "bgGradient": "linear-gradient(135deg, ...)", // overrides bg visually
  "color": "#e2e8f0",        // default text color
  "accent": "#3b82f6",       // accent color: dots/icons/highlights
  "align": "left|center|right",       // block-stack horizontal align
  "verticalAlign": "top|center|bottom", // vertical align, 540px canvas
  "padding": "36px 48px",    // slide padding (CSS)
  "gap": 16,                 // gap between blocks (px)
  "duration": 60,            // speaking time est., seconds — REQUIRED
  "title": "Slide Name",     // label for filmstrip/TOC
  "layout": "stack|image-right|image-left|cols", // default "stack"
  "L": [ ...blocks... ],     // left col (cols layout only)
  "R": [ ...blocks... ],     // right col (cols layout only)
  "contentFlex": 1,          // left-col flex ratio (cols/split)
  "imageFlex": 1,            // right-col flex ratio (cols/split)
  "splitGap": 32,            // gap between columns, px (cols/split)
  "imageCols": 3             // pin col count for adjacent image blocks (int 1-6; omit = auto)
}
```

Two+ adjacent `image` blocks auto-grid; `imageCols` pins the column count.

**Numeric fields, type/range-checked on load:** `imageCols` → int, clamped 1–6. `gap`/`splitGap` → 0–200px. `contentFlex`/`imageFlex` → 0.1–20. Non-numeric value is dropped and the renderer default applies.

**Reserved key namespace:** any slide or block key beginning with `_` is renderer-private (e.g. derived title-card state) and is never authored content — it is stripped on import and cannot be set from deck JSON.

**Layout:** `align:"left"`(default) stretches blocks full-width; `align:"center"` shrink-wraps. Flow/grid/progress blocks fill the canvas automatically as a result.

**Cols layout:** `blocks` renders full-width above the two columns (optional header — badge/heading). `L`/`R` hold left/right column blocks. At least one of L/R must be present. `contentFlex`/`imageFlex` set column-width ratio (default 1:1); `splitGap` sets column gap (default 32px). All block types work in L/R.

## `studyNotes` (offline student content, v12.32+)

Pre-authored content for the 🎓 student panel, zero API calls; reuses the live Vera Teacher markdown+SVG renderer.

```json
{"studyNotes": {
  "text": "Markdown. **bold**, *italic*, ~~strike~~, [label](url), [X-Ray term](#agent).",
  "diagram": "<svg viewBox='0 0 320 140'>...</svg>",
  "questions": ["Why does X happen?"],
  "glossary": {"agent": {"definition": "A goal-driven loop.", "url": "https://example.com"}}
}}
```

- `text` *(required, string, ≤ 4000 chars, warn at 2000)* — markdown body, rendered via the same `parseInline` + `ChatMarkdown` pipeline used by live Vera chat. Supports `**bold**` `*italic*` `***both***` `~~strike~~` `__underscore__` `[label](https://…)` external links and `[label](#term)` X-Ray refs.
- `diagram` *(optional, string, ≤ 8000 chars)* — one well-formed inline SVG, through `sanitizeSvgMarkup` (strips `<script>`, event handlers, `javascript:/data:/vbscript:` URIs); empty-string fallback if invalid.
- `questions` *(optional, array, max 6, each ≤ 160 chars)* — pre-authored follow-ups. When the Claude API / MCP channel is reachable they render as clickable buttons that send the question into the live Vera Teacher flow; otherwise they render as static "Questions to ponder" bullets.
- `glossary` *(optional, object, max 24 entries)* — `{termKey: {definition ≤400 chars, url?: sanitized}}`; keys lowercased, `[^\w-]` stripped, case-insensitive match; `[label](#term)` renders a popover; unknown terms render as plain text.

**Behavior matrix:**

| studyNotes | API reachable | Result |
|---|---|---|
| yes | yes | Static content + clickable questions + Ask Vera input |
| yes | no | Static content only; questions become non-interactive bullets |
| no | yes | Live `TeacherPanel` (auto-generated) |
| no | no | Live `TeacherPanel` → degrade via `callVeraTeacher` catch |

Text strips HTML tags and NULL bytes, truncates 4000 chars. External URLs allow only `http:`, `https:`, `mailto:` via `sanitizeUrl`. Blocked URLs render as plain text. Empty-definition glossary entries are dropped.

**Marker:** slides with `studyNotes` show a 🎓 badge in TOC/gallery/viewer (top-left).

**Limitation:** X-Ray `[term](#key)` syntax activates only inside `studyNotes.text`. Other blocks call `parseInline(text)` without a glossary context, so it renders as plain text there.

Compact format: key `sN`, value verbatim (palette-alias pass skips it). Turbo: optional position 10 (`len(s)>10` guarded). **Authoring:** JSON-only for v12.32. No editor UI yet; `set_study_notes` Vera tool planned.

## Block Types

### heading
```json
{"type":"heading","text":"...","size":"2xl","color":"#fff","weight":700,"align":"left|center|right","icon":"Zap","iconColor":"#3b82f6","maxWidth":"80%","style":{}}
```
Sizes: xs 12 · sm 14 · md 17 · lg 20 · xl 26 · 2xl 35 · 3xl 46 · 4xl 56 (px)

### text
```json
{"type":"text","text":"...","size":"md","color":"#94a3b8","bold":false,"italic":false,"align":"left|center|right","maxWidth":"70%","style":{}}
```

### bullets
```json
{"type":"bullets","items":["Plain string",{"text":"With icon","icon":"CheckCircle"}],"size":"md","dotColor":"#3b82f6","gap":8,"color":"#e2e8f0","style":{}}
```

### image
```json
{"type":"image","src":"data:image/... or URL","caption":"...","maxWidth":"80%","shadow":true,"rounded":true}
```
When improving existing slides, keep `src` as `"keep-original"` to preserve image data.

### code
```json
{"type":"code","text":"const x=1;","label":"JAVASCRIPT","copy":true,"size":"sm","bg":"#1e293b","color":"#e2e8f0"}
```
`copy:true` adds a clipboard-copy button.

### grid
Multi-column; each cell has its own `blocks` array. v13: cell `direction:"row"` for horizontal flow.
```json
{"type":"grid","cols":2,"gap":16,"items":[{"direction":"column","blocks":[{"type":"heading","text":"A","size":"lg"}],"style":{"padding":"16px"}}]}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| direction | row\|column | column | row=horizontal/centered/12px gap; column=vertical/8px gap |
| blocks | array | required | child blocks |
| style | object | {} | cell CSS overrides |
Max 2-3 cols, 6 cells, 2-4 blocks/cell.

### callout
```json
{"type":"callout","text":"...","title":"...","reveal":true,"bg":"rgba(59,130,246,.15)","border":"#3b82f6","color":"#e2e8f0","icon":"Lightbulb"}
```
`reveal:true` = collapsible, starts closed.

### metric
```json
{"type":"metric","value":"42%","label":"REDUCTION","size":"3xl","color":"#3b82f6","labelColor":"#94a3b8","icon":"TrendingUp","iconColor":"#3b82f6"}
```

### quote
```json
{"type":"quote","text":"...","author":"Alan Kay","size":"xl","color":"#e2e8f0"}
```

### badge
```json
{"type":"badge","text":"SECTION 01","color":"#fff","bg":"#3b82f6","icon":"Star"}
```

### icon
```json
{"type":"icon","name":"Brain","size":"lg","color":"#3b82f6","bg":"#3b82f620","circle":true,"label":"...","border":"#3b82f640"}
```
Sizes: sm 16 · md 24 · lg 32 · xl 48 (px)

### icon-row
Feature list with icons — use INSTEAD of bullets for visual impact.
```json
{"type":"icon-row","items":[{"icon":"Zap","title":"Fast","text":"...","iconColor":"#fbbf24","iconBg":"#fbbf2420"}],"iconBg":"#3b82f620","iconColor":"#3b82f6","iconShape":"circle|square","gap":16,"titleSize":"lg","textSize":"md"}
```

### flow
v13: item `gate:true` for a human-review checkpoint after that item. v14: block `loop:true` for a return arrow from last step to first.
```json
{"type":"flow","items":[{"icon":"FileText","label":"Input","sublabel":"Raw data"},{"icon":"Cpu","label":"Process","gate":true}],"arrowColor":"#3b82f6","direction":"horizontal|vertical","connectorStyle":"arrow|dashed|line","gateIcon":"UserCheck","gateLabel":"Review","gateColor":"#f59e0b","loop":true,"loopLabel":"repeat until done","loopColor":"#64748b","loopStyle":"dashed"}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| items[].icon/label/sublabel | string | — | step icon/label/secondary text |
| items[].gate | boolean | false | show gate checkpoint AFTER this item |
| gateIcon | string | "UserCheck" | icon inside gate circle |
| gateLabel | string | — | label below gate |
| gateColor | hex | slide accent | gate circle/icon/label color |
| loop | boolean | false | return arrow, last item to first |
| loopLabel | string | — | label on return arrow |
| loopColor | hex | accent @50% | return arrow/label color |
| loopStyle | dashed\|dotted\|solid | dashed | return-path stroke |
Gates render as a dashed-circle checkpoint between the gated item and the next arrow, aligned to icon centerline. Loop renders beneath horizontal flows (or right of vertical), last→first; use for agent loops (ReAct, OODA), feedback cycles.

### table
```json
{"type":"table","headers":["Feature","Basic","Pro"],"rows":[["Users","5","50"]],"striped":true,"headerBg":"#1e293b","headerColor":"#e2e8f0","cellColor":"#cbd5e1","borderColor":"#334155","size":"sm"}
```

### progress
v13: endpoint labels + annotation for spectrum visuals.
```json
{"type":"progress","items":[{"label":"Python","value":95,"color":"#3b82f6"}],"showValue":true,"trackColor":"#1e293b","height":8,"labelColor":"#e2e8f0","size":"sm","leftLabel":"Beginner","rightLabel":"Expert","leftIcon":"BookOpen","rightIcon":"Trophy","annotation":"Team average","annotationColor":"#94a3b8"}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| leftLabel/rightLabel | string | — | track-end labels |
| `leftIcon` | string (Lucide) | — | Icon before left label |
| `rightIcon` | string (Lucide) | — | Icon after right label |
| annotation | string | — | italic text below track |
| annotationColor | hex | #94a3b8 | annotation color |
Values 0-100 (%). Endpoint labels render above track, annotation below.

### steps
```json
{"type":"steps","items":[{"title":"Discover","text":"..."}],"lineColor":"#3b82f6","activeStep":2,"numberColor":"#3b82f6","titleColor":"#e2e8f0","textColor":"#94a3b8"}
```

### tag-group
```json
{"type":"tag-group","items":[{"text":"React","color":"#61dafb","icon":"Code"}],"variant":"filled|outline|subtle","gap":8,"size":"sm"}
```

### timeline
```json
{"type":"timeline","items":[{"date":"Q1 2025","title":"Alpha","text":"..."}],"lineColor":"#3b82f6","dotColor":"#3b82f6","dateColor":"#60a5fa","titleColor":"#e2e8f0","textColor":"#94a3b8","direction":"horizontal|vertical"}
```

### svg *(v14)*
Escape hatch for visuals structured blocks can't express.
Use when: feedback loops, fan-outs (1→N), mesh connectors (M×N), variable-width layers, probability distributions, non-linear architecture diagrams.
Don't use when: a structured block (`flow`,`grid`,`steps`,`progress`) would work — those are more maintainable and theme-aware.
```json
{"type":"svg","markup":"<svg viewBox='0 0 400 160'><rect x='10' y='20' width='100' height='50' rx='8' fill='none' stroke='{{accent}}'/></svg>","maxWidth":"80%","align":"center","caption":"...","captionColor":"#94a3b8","captionSize":"sm","bg":"rgba(0,0,0,.2)","padding":"16px","rounded":true}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| `markup` | string (SVG) | — (required) | Raw SVG with `viewBox`. NO fixed width/height. |
| maxWidth | CSS string | "100%" | e.g. "80%","400px" |
| align | left\|center\|right | inherits | horizontal align |
| caption/captionColor/captionSize | string/hex/token | —/#94a3b8/sm | caption text/color/size |
| bg | CSS string | transparent | background behind SVG |
| padding | CSS string | "0" | padding around SVG |
| rounded | boolean | false | 8px border-radius |

Theme tokens (replaced at render): `{{color}}`→slide color (#e2e8f0 default) · `{{accent}}`→slide accent (#3b82f6) · `{{bg}}`→slide bg (#0f172a) · `{{muted}}`→color @50%.

**Rules:** Always include `viewBox`, never fixed width/height. Use theme tokens for adaptation. Use `monospace` for labels. Keep to 2-8 elements. Prefer stroke outlines (`fill="none" stroke="{{accent}}"`) over filled shapes. Max viewBox height ~200-300px. Text 11-16px labels, 8-10px annotations.

### comparison
Side-by-side A/B with semantic coloring, icon headers, optional divider. Before/after, pros/cons, plan A vs B.
```json
{
  "type": "comparison",
  "items": [
    {
      "title": "Before",
      "icon": "X",
      "color": "#ef4444",
      "items": ["Manual deploys"]
    },
    {
      "title": "After",
      "icon": "Check",
      "color": "#22c55e",
      "items": ["CI/CD pipeline"]
    }
  ],
  "dividerLabel": "VS", "titleSize": "md", "size": "sm"
}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| items | array(2) | [] | Exactly 2 side objects: `{title, icon?, color?, items[]}` |
| items[].title | string | | Side heading (e.g. "Before", "Pros") |
| items[].color | string | left #ef4444 / right #22c55e | side accent |
| dividerLabel | string | "VS" | divider circle text |
| hideDivider | boolean | false | hide VS divider |
| titleSize/size | size | md/sm | title/bullet size |

### funnel
```json
{"type":"funnel","items":[{"label":"Visitors","value":"124,000","color":"#3b82f6"},{"label":"Paying","value":"1,920","color":"#a855f7","drop":"−60.0%","highlight":true}]}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| items[].value | string | | e.g. "124,000" |
| items[].color | string | accent | stage color |
| items[].drop | string | | e.g. "−74.8%" |
| items[].highlight | boolean | false | dashed border on problem stage |

### cycle
```json
{"type":"cycle","centerLabel":"ReAct","centerSub":"Agent Loop","items":[{"label":"Think","icon":"🧠","color":"#3b82f6"}]}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| items | array | [] | nodes around circle, 3-7 recommended |
| items[].icon | string | | emoji/text inside node |
| items[].color | string | auto-cycle | node/arrow color |
| centerLabel/centerSub | string | | center text / smaller subtext |

### number-row
Replaces grid+metric boilerplate.
```json
{"type":"number-row","items":[{"value":"99.97%","label":"Uptime","icon":"Activity","color":"#22c55e"}],"size":"3xl","compact":false,"bordered":false}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| items | array | [] | 2-5 metric items |
| size | size | "3xl" | value font size |
| compact | boolean | false | smaller padding, "2xl" default |
| bordered | boolean | false | background border container |
| showIcons | boolean | true | show/hide icon circles |

### matrix
2×2 quadrant grid, axis labels, per-quadrant color. SWOT, Eisenhower, effort/impact.
```json
{"type":"matrix","xLeft":"INTERNAL","xRight":"EXTERNAL","yTop":"POSITIVE","yBottom":"NEGATIVE","quadrants":[{"title":"Strengths","icon":"TrendingUp","color":"#22c55e","items":["Strong team"]}]}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| quadrants | array(4) | [] | top-L, top-R, bottom-L, bottom-R |
| quadrants[].items | string[] | [] | bullets in quadrant |
| xLeft/xRight/yTop/yBottom | string | | axis labels |
`items` can be used as an alias for `quadrants`.

### checklist
Semantic icons/colors per state: done, partial, pending, blocked.
```json
{"type":"checklist","items":[{"text":"SSO integration","status":"done"},{"text":"EU data residency","status":"blocked"}],"size":"sm","showLabels":true}
```
| Prop | Type | Default | Notes |
|---|---|---|---|
| items[].status | enum | "pending" | done\|partial\|pending\|blocked |
| showLabels | boolean | true | status label on right |

### spacer
```json
{ "type": "spacer", "h": 16 }
```

### divider
```json
{"type":"divider","color":"#334155","spacing":16}
```
