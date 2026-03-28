# Vela Theming System

Themes are applied by setting consistent `bg`, `bgGradient`, `color`, and `accent` properties across all slides. This file defines named palettes and composition techniques.

## Theme Structure

A theme defines:
- **bg range**: 2-4 background colors/gradients used across slides
- **color**: primary text color
- **muted**: secondary/body text color
- **accent**: highlight color for icons, badges, metrics, dots
- **accent2** (optional): secondary accent for variety

## Built-in Directions

### Dark (Default)
Deep navy/slate backgrounds, bright accents. Best for tech, workshops, keynotes.
```
bg:      #0f172a, #1e293b, #0f172a→#1e3a5f (gradient)
color:   #e2e8f0
muted:   #94a3b8
accent:  #3b82f6 (blue)
accent2: #8b5cf6 (purple) or #f59e0b (amber)
```

### Midnight
Ultra-dark with rich jewel-tone accents. Dramatic, premium feel.
```
bg:      #09090b, #18181b, #09090b→#1a1a2e (gradient)
color:   #fafafa
muted:   #a1a1aa
accent:  #a78bfa (violet)
accent2: #f472b6 (pink) or #34d399 (emerald)
```

### Light
Clean white/gray backgrounds. Best for corporate, academic, formal.
```
bg:      #ffffff, #f8fafc, #f1f5f9, #ffffff→#f1f5f9 (gradient)
color:   #1e293b
muted:   #64748b
accent:  #2563eb (blue)
accent2: #0891b2 (cyan) or #7c3aed (violet)
```

### Warm Light
Soft warm neutrals. Approachable, editorial.
```
bg:      #faf8f5, #f5f0eb, #fffbf5, #faf8f5→#f0ebe4 (gradient)
color:   #292524
muted:   #78716c
accent:  #c2410c (burnt orange)
accent2: #0d9488 (teal) or #9333ea (purple)
```

### Vibrant
Bold saturated gradients. Energetic, startup pitch.
```
bg:      #0f172a→#3b0764 (purple), #0f172a→#164e63 (teal), #1e1b4b→#312e81 (indigo)
color:   #f8fafc
muted:   #c4b5fd or #a5b4fc
accent:  #f59e0b (amber)
accent2: #06b6d4 (cyan) or #ec4899 (pink)
```

### Editorial
Sophisticated asymmetric feel. Warm neutrals with one strong accent.
```
bg:      #1c1917, #292524, #1c1917→#292524 (gradient)
color:   #e7e5e4
muted:   #a8a29e
accent:  #dc2626 (red) or #f59e0b (amber)
accent2: keep minimal — editorial uses restraint
```

### Minimal
Maximum whitespace, subtle tones. Let content breathe.
```
bg:      #ffffff, #fafafa, #f4f4f5
color:   #27272a
muted:   #71717a
accent:  #18181b (near-black — accent via weight/size, not color)
accent2: #3b82f6 (single pop color, used sparingly)
```

## Applying Themes

### Variation Within a Theme
Don't use identical `bg` on every slide. Create rhythm:

1. **Title slides**: Use the richest gradient in the palette
2. **Content slides**: Alternate between 2-3 solid bg variants
3. **Section breaks**: Use a contrasting gradient or accent-tinted bg
4. **Metrics/highlight slides**: Slightly different gradient angle or tint
5. **Closing slide**: Echo the title slide gradient

### Example: Dark Theme Variation
```
Slide 1 (Title):    bgGradient: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)"
Slide 2 (Content):  bg: "#0f172a"
Slide 3 (Content):  bg: "#1e293b"
Slide 4 (Section):  bgGradient: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)"
Slide 5 (Metrics):  bgGradient: "linear-gradient(135deg, #0f172a 0%, #1a1a2e 100%)"
Slide 6 (Content):  bg: "#0f172a"
Slide 7 (Closing):  bgGradient: "linear-gradient(135deg, #1e293b 0%, #0f172a 50%, #1e3a5f 100%)"
```

### Accent Color Usage
- **Primary accent**: badges, icon colors, metric values, dot colors, heading icons, table headers
- **Secondary accent**: alternate icon colors in grids, progress bar variation, callout borders
- Use accent at 10-20% opacity for backgrounds: `"#3b82f620"` for icon circles, callout bg, grid cell bg

### Contrast Rules
- Dark bg → light text (`#e2e8f0` or `#ffffff`)
- Light bg → dark text (`#1e293b` or `#0f172a`)
- Always check accent visibility against bg — bright accents on dark bg, saturated accents on light bg
- Muted text should be clearly readable but obviously secondary (aim for 4.5:1 contrast ratio)

## Custom Themes

When the user provides custom colors or brand guidelines:

1. Extract primary and secondary colors
2. Derive bg range: use darkened/lightened variants of primary
3. Set accent to the most vibrant brand color
4. Ensure text contrast against all bg variants
5. Create opacity variants for subtle backgrounds: append `20`, `15`, `10` to hex codes

### Example: Custom Brand (hex #e63946)
```
bg:      #1a0a0c, #2d1215, linear-gradient(135deg, #1a0a0c 0%, #2d1215 100%)
color:   #fecdd3
muted:   #f9a8b3
accent:  #e63946
accent2: #f59e0b (complementary warm)
```
