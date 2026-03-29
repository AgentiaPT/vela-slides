#!/usr/bin/env python3
"""
preview.py — Generate visual slide previews from Vela deck JSON.
Creates an HTML file with all slides rendered as colored rectangles with text.
Open in browser to see visual quality. Also outputs a text summary for CLI review.

Usage:
  python3 preview.py <deck.json>                    # Open HTML preview
  python3 preview.py <deck.json> --text             # Text-only contrast check
  python3 preview.py <deck.json> --audit            # Color audit (detect issues)
"""

import json, sys, os, re, colorsys, html as _html

def hex_to_rgb(h):
    """Convert hex color to RGB tuple (0-255)."""
    h = h.lstrip('#')
    if len(h) == 8: h = h[:6]  # strip alpha
    if len(h) != 6: return (128, 128, 128)
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def luminance(r, g, b):
    """Relative luminance (WCAG formula)."""
    def lin(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

def contrast_ratio(c1, c2):
    """WCAG contrast ratio between two hex colors."""
    l1 = luminance(*hex_to_rgb(c1))
    l2 = luminance(*hex_to_rgb(c2))
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)

def is_accent_color(color):
    """Check if a color is too saturated/bright to be a background."""
    r, g, b = hex_to_rgb(color)
    h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
    return s > 0.5 and v > 0.4  # High saturation + medium+ brightness

def extract_slides(deck):
    """Extract slides from any format."""
    slides = []
    if "lanes" in deck:
        for lane in deck["lanes"]:
            for item in lane.get("items", []):
                slides.extend(item.get("slides", []))
    elif "S" in deck:
        slides = deck["S"]
    return slides

def audit_deck(deck_path):
    """Audit a deck for common color/quality issues."""
    with open(deck_path) as f:
        deck = json.load(f)

    slides = extract_slides(deck)
    issues = []

    for i, s in enumerate(slides):
        slide_num = i + 1
        title = s.get("title", s.get("n", f"Slide {slide_num}"))
        bg = s.get("bg", s.get("bgGradient", "#000000"))
        if isinstance(bg, str) and "gradient" in bg:
            # Extract first color from gradient
            colors = re.findall(r'#[0-9A-Fa-f]{6}', bg)
            bg = colors[0] if colors else "#000000"
        color = s.get("color", "#FFFFFF")
        accent = s.get("accent", "#3B82F6")

        # Check 1: Accent color used as full slide background
        if bg and is_accent_color(bg):
            issues.append(f"  SLIDE {slide_num} '{title}': bg={bg} is a saturated accent color used as background — will look garish")

        # Check 2: Low contrast between text and bg
        if bg and color:
            cr = contrast_ratio(bg, color)
            if cr < 4.5:
                issues.append(f"  SLIDE {slide_num} '{title}': LOW CONTRAST text({color}) on bg({bg}) — ratio {cr:.1f} (need 4.5+)")

        # Check 3: Duration issues
        dur = s.get("duration", s.get("d", 0))
        if isinstance(dur, int) and dur < 10:
            issues.append(f"  SLIDE {slide_num} '{title}': duration={dur}s is too short (min 15s for titles)")

        # Check 4: Same bg on consecutive slides
        if i > 0:
            prev_bg = slides[i-1].get("bg", "")
            if bg and prev_bg and bg == prev_bg and not s.get("bgGradient"):
                issues.append(f"  SLIDE {slide_num} '{title}': same bg as previous slide ({bg}) — monotonous")

        # Check blocks for color issues
        blocks = s.get("blocks", s.get("B", []))
        for j, b in enumerate(blocks):
            if not isinstance(b, dict): continue
            block_bg = b.get("bg", b.get("b", ""))
            block_color = b.get("color", b.get("c", ""))
            block_type = b.get("type", b.get("_", ""))

            # Check icon-row for duplicate colors
            if block_type == "icon-row":
                ics = [item.get("iconColor", item.get("ic", "")) for item in b.get("items", b.get("I", []))]
                ics = [c for c in ics if c]
                if len(ics) > 1 and len(set(ics)) == 1:
                    issues.append(f"  SLIDE {slide_num} '{title}': icon-row has all same iconColor ({ics[0]}) — no differentiation")

    return slides, issues

def _esc(text):
    """Escape HTML special chars."""
    return str(text).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")


# ━━━ CSS value sanitization ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_SAFE_CSS_COLOR_RE = re.compile(
    r'^('
    r'#[0-9A-Fa-f]{3,8}'
    r'|rgba?\(\s*[\d.%,\s/]+\)'
    r'|hsla?\(\s*[\d.deg,%\s/]+\)'
    r'|transparent'
    r'|currentColor'
    r'|[a-zA-Z]{3,20}'
    r')$', re.ASCII
)
_SAFE_CSS_GRADIENT_RE = re.compile(
    r'^(linear|radial|conic)-gradient\([^;"\'>()]*\)$', re.ASCII
)

def _css(value, fallback="#000000"):
    """Sanitize a CSS color/gradient value for safe interpolation into style attributes."""
    if not isinstance(value, str):
        return fallback
    v = value.strip()
    if not v:
        return fallback
    if _SAFE_CSS_COLOR_RE.match(v):
        return v
    if _SAFE_CSS_GRADIENT_RE.match(v):
        return v
    return fallback

def generate_html(deck_path, output_path=None):
    """Generate an HTML preview matching Vela's actual rendering."""
    with open(deck_path) as f:
        deck = json.load(f)

    slides = extract_slides(deck)
    title = deck.get("deckTitle", deck.get("n", "Untitled"))

    # Vela actual sizes (rem at 16px base → px for ~60% scale preview)
    REM = 10  # 60% scale: readable text while fitting 2 slides per row
    SIZES = {"xs":round(0.85*REM),"sm":round(0.95*REM),"md":round(1.05*REM),"lg":round(1.2*REM),
             "xl":round(1.5*REM),"2xl":round(2*REM),"3xl":round(2.6*REM),"4xl":round(3.2*REM)}

    html_slides = []
    for i, s in enumerate(slides):
        bg = _css(s.get("bg", "#0A0F1C"), "#0A0F1C")
        bg_grad = _css(s.get("bgGradient", ""), "")
        color = _css(s.get("color", "#E6F1FF"), "#E6F1FF")
        accent = _css(s.get("accent", "#3B82F6"), "#3B82F6")
        align = s.get("align", "left")
        raw_pad = s.get("padding", "36px 48px")
        # Scale padding to half for preview
        pad_parts = raw_pad.replace("px","").split()
        padding = " ".join(f"{max(8,int(float(p))//2)}px" for p in pad_parts) if pad_parts else "18px 24px"
        bg_style = f"background:{bg_grad}" if bg_grad else f"background:{bg}"
        slide_num = i + 1
        dur = s.get("duration", "?")

        blocks_html = ""
        blocks = s.get("blocks", s.get("B", []))
        for b in blocks:
            if isinstance(b, int):
                blocks_html += f'<div style="height:{max(2,b//2)}px"></div>'
                continue
            if not isinstance(b, dict): continue
            bt = b.get("type", b.get("_", ""))
            text = _esc(b.get("text", b.get("x", "")))
            size = b.get("size", b.get("s", "md"))
            bc = _css(b.get("color", b.get("c", color)), color)
            bbg = _css(b.get("bg", b.get("b", "")), "")
            fs = SIZES.get(size, SIZES["md"])
            if isinstance(size, str) and "px" in size:
                try: fs = max(7, int(size.replace("px","")) // 2)
                except: fs = SIZES["md"]

            if bt == "heading":
                w = b.get("weight", b.get("w", 600))
                icon = b.get("icon", b.get("i", ""))
                icon_html = f'<span style="margin-right:4px;opacity:0.7">⬡</span>' if icon else ""
                blocks_html += f'<div style="font-size:{fs}px;font-weight:{w};color:{bc};line-height:1.15;margin:2px 0;font-family:system-ui,sans-serif">{icon_html}{text}</div>'
            elif bt == "text":
                blocks_html += f'<div style="font-size:{fs}px;color:{bc};line-height:1.5;margin:1px 0;opacity:0.85">{text}</div>'
            elif bt == "badge":
                icon = b.get("icon", b.get("i", ""))
                icon_html = f'<span style="margin-right:3px;font-size:14px">⬡</span>' if icon else ""
                blocks_html += f'<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:{bbg or "rgba(255,255,255,0.1)"};color:{bc};font-size:14px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase">{icon_html}{text}</span>'
            elif bt == "icon-row":
                items = b.get("items", b.get("I", []))
                items_html = ""
                for item in items:
                    ic = _css(item.get("iconColor", item.get("ic", accent)), accent)
                    ib = _css(item.get("iconBg", item.get("ib", "")), "")
                    t = _esc(item.get("title", ""))
                    x = _esc(item.get("text", item.get("x", "")))
                    icon = item.get("icon", "")
                    items_html += f'''<div style="flex:1;text-align:center;min-width:0">
                        <div style="width:24px;height:24px;border-radius:50%;background:{ib or ic+'20'};margin:0 auto 3px;display:flex;align-items:center;justify-content:center">
                            <span style="color:{ic};font-size:14px;font-weight:700">●</span>
                        </div>
                        <div style="font-size:14px;font-weight:700;color:{color};margin-bottom:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{t}</div>
                        <div style="font-size:13px;color:{color};opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{x}</div>
                    </div>'''
                blocks_html += f'<div style="display:flex;gap:8px;margin:4px 0">{items_html}</div>'
            elif bt == "table":
                headers = b.get("headers", b.get("H", []))
                rows = b.get("rows", b.get("R", []))
                hbg = _css(b.get("headerBg", b.get("hb", "#1e293b")), "#1e293b")
                hc = _css(b.get("headerColor", b.get("hc", color)), color)
                bc2 = _css(b.get("cellColor", b.get("cc", color)), color)
                bdc = _css(b.get("borderColor", b.get("bc", "rgba(255,255,255,0.08)")), "rgba(255,255,255,0.08)")
                th = "".join(f'<th style="padding:3px 5px;text-align:left;color:{hc};font-size:13px;font-weight:700;border-bottom:1px solid {bdc}">{_esc(h)}</th>' for h in headers)
                trs = ""
                for ri, row in enumerate(rows):
                    rbg = "rgba(255,255,255,0.025)" if b.get("striped") and ri % 2 else "transparent"
                    tds = "".join(f'<td style="padding:3px 5px;font-size:13px;color:{bc2};opacity:0.8;border-bottom:1px solid {bdc}">{_esc(c)}</td>' for c in row)
                    trs += f'<tr style="background:{rbg}">{tds}</tr>'
                blocks_html += f'<table style="width:100%;border-collapse:collapse;margin:4px 0"><thead style="background:{hbg}"><tr>{th}</tr></thead><tbody>{trs}</tbody></table>'
            elif bt == "flow":
                items = b.get("items", b.get("I", []))
                ac = _css(b.get("arrowColor", accent), accent)
                flow_html = ""
                for fi, item in enumerate(items):
                    lb = _esc(item.get("label", item.get("lb", "")))
                    sl = _esc(item.get("sublabel", ""))
                    gate = item.get("gate", False)
                    flow_html += f'''<div style="text-align:center;flex:1">
                        <div style="width:22px;height:22px;border-radius:50%;background:{ac}25;margin:0 auto 2px;display:flex;align-items:center;justify-content:center;{'border:1.5px dashed '+ac if gate else ''}">
                            <span style="color:{ac};font-size:12px">●</span>
                        </div>
                        <div style="font-size:13px;font-weight:700;color:{color}">{lb}</div>
                        <div style="font-size:12px;color:{color};opacity:0.5">{sl}</div>
                    </div>'''
                    if fi < len(items) - 1:
                        flow_html += f'<div style="color:{ac};font-size:13px;opacity:0.6;margin:0 -2px">→</div>'
                loop = b.get("loop", False)
                loop_html = f'<div style="text-align:center;font-size:12px;color:{ac};opacity:0.5;margin-top:2px">↩ {_esc(b.get("loopLabel",""))}</div>' if loop else ""
                blocks_html += f'<div style="margin:4px 0"><div style="display:flex;align-items:center;gap:2px">{flow_html}</div>{loop_html}</div>'
            elif bt == "callout":
                border = _css(b.get("border", accent), accent)
                title_text = _esc(b.get("title", ""))
                title_html = f'<div style="font-size:14px;font-weight:700;margin-bottom:2px">{title_text}</div>' if title_text else ""
                blocks_html += f'<div style="padding:8px 10px;border-left:2px solid {border};background:{bbg or "rgba(255,255,255,0.04)"};border-radius:4px;margin:4px 0;font-size:14px;color:{bc or color};line-height:1.4">{title_html}{text}</div>'
            elif bt == "metric":
                val = _esc(b.get("value", ""))
                lb = _esc(b.get("label", b.get("lb", "")))
                mc = _css(b.get("color", b.get("c", accent)), accent)
                ms = SIZES.get(b.get("size", b.get("s", "3xl")), SIZES["3xl"])
                blocks_html += f'<div style="text-align:center;margin:3px 0"><div style="font-size:{ms}px;font-weight:800;color:{mc};line-height:1">{val}</div><div style="font-size:13px;color:{color};opacity:0.6;margin-top:2px">{lb}</div></div>'
            elif bt == "grid":
                items = b.get("items", b.get("I", []))
                cols = b.get("cols", 3)
                grid_html = ""
                for gi in items:
                    style = gi.get("style", {})
                    gbg = _css(style.get("background", "rgba(255,255,255,0.04)"), "rgba(255,255,255,0.04)")
                    gpad = "8px"
                    gbr = _esc(str(style.get("borderRadius", "6px")))
                    gbl_color = _css(style['borderLeft'].split()[-1], accent) if "borderLeft" in style else ""
                    gbl = f"border-left:2px solid {gbl_color};" if gbl_color else ""
                    inner = ""
                    for gb in gi.get("blocks", []):
                        if isinstance(gb, int):
                            inner += f'<div style="height:{max(1,gb//3)}px"></div>'
                        elif isinstance(gb, dict):
                            gbt = gb.get("type", gb.get("_",""))
                            if gbt == "metric":
                                v = _esc(gb.get("value",""))
                                l = _esc(gb.get("label",gb.get("lb","")))
                                mc = _css(gb.get("color",gb.get("c",accent)), accent)
                                inner += f'<div style="font-size:20px;font-weight:800;color:{mc};line-height:1">{v}</div><div style="font-size:12px;color:{color};opacity:0.6;margin-top:1px">{l}</div>'
                            elif gbt == "heading":
                                inner += f'<div style="font-size:14px;font-weight:700;color:{_css(gb.get("color",gb.get("c",color)), color)}">{_esc(gb.get("text",gb.get("x","")))}</div>'
                            elif gbt == "icon":
                                ic2 = _css(gb.get("color",gb.get("c",accent)), accent)
                                ib2 = _css(gb.get("bg",gb.get("b","")), "")
                                inner += f'<div style="width:18px;height:18px;border-radius:50%;background:{ib2 or ic2+"20"};display:flex;align-items:center;justify-content:center;margin-bottom:2px"><span style="color:{ic2};font-size:14px">●</span></div>'
                            else:
                                inner += f'<div style="font-size:13px;color:{color};opacity:0.7">{_esc(gb.get("text",gb.get("x","")))}</div>'
                    grid_html += f'<div style="background:{gbg};padding:{gpad};border-radius:{gbr};{gbl}">{inner}</div>'
                blocks_html += f'<div style="display:grid;grid-template-columns:repeat({cols},1fr);gap:6px;margin:4px 0">{grid_html}</div>'
            elif bt == "tag-group":
                items = b.get("items", b.get("I", []))
                variant = b.get("variant", b.get("v", "outline"))
                tags_html = ""
                for tag in items:
                    tc = _css(tag.get("color", tag.get("c", accent)), accent)
                    tx = _esc(tag.get("text", tag.get("x", "")))
                    if variant == "filled":
                        tags_html += f'<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:{tc};color:#fff;font-size:13px;font-weight:600;margin:1px 2px">{tx}</span>'
                    else:
                        tags_html += f'<span style="display:inline-block;padding:2px 8px;border-radius:10px;border:1px solid {tc};color:{tc};font-size:13px;font-weight:600;margin:1px 2px">{tx}</span>'
                blocks_html += f'<div style="margin:3px 0;display:flex;flex-wrap:wrap;gap:2px;{"justify-content:center" if align=="center" else ""}">{tags_html}</div>'
            elif bt in ("steps", "timeline"):
                items = b.get("items", b.get("I", []))
                lc = _css(b.get("lineColor", b.get("lnc", accent)), accent)
                steps_html = ""
                for si, item in enumerate(items):
                    if isinstance(item, str): item = {"title": item}
                    if not isinstance(item, dict): continue
                    t = _esc(item.get("title", item.get("date", "")))
                    x = _esc(item.get("text", item.get("x", "")))
                    steps_html += f'''<div style="display:flex;gap:6px;margin:1px 0;align-items:flex-start">
                        <div style="width:14px;height:14px;border-radius:50%;background:{lc}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
                            <span style="color:{lc};font-size:13px;font-weight:800">{si+1}</span>
                        </div>
                        <div><div style="font-size:14px;font-weight:700;color:{color}">{t}</div><div style="font-size:12px;color:{color};opacity:0.6">{x}</div></div>
                    </div>'''
                blocks_html += f'<div style="margin:3px 0">{steps_html}</div>'
            elif bt == "code":
                lb = _esc(b.get("label", b.get("lb", "")))
                label_html = f'<div style="font-size:12px;font-weight:700;color:{accent};margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px">{lb}</div>' if lb else ""
                blocks_html += f'<div style="padding:6px 8px;background:{bbg or "#0f172a"};border-radius:4px;margin:3px 0;font-family:monospace">{label_html}<pre style="font-size:13px;color:#e2e8f0;margin:0;white-space:pre-wrap;overflow:hidden;max-height:40px">{text[:120]}</pre></div>'
            elif bt == "quote":
                author = _esc(b.get("author", ""))
                blocks_html += f'<div style="border-left:2px solid {accent};padding:6px 10px;margin:3px 0;font-style:italic;color:{bc or color};font-size:12px;line-height:1.4">"{text}"<div style="font-size:13px;margin-top:2px;opacity:0.6;font-style:normal">— {author}</div></div>'
            elif bt == "icon":
                ic2 = _css(b.get("color", b.get("c", accent)), accent)
                ib2 = _css(b.get("bg", b.get("b", "")), "")
                sz = {"sm":12,"md":18,"lg":24,"xl":32}.get(b.get("size",b.get("s","lg")), 24)
                circle = b.get("circle", False)
                if circle:
                    blocks_html += f'<div style="width:{sz+8}px;height:{sz+8}px;border-radius:50%;background:{ib2 or ic2+"20"};display:{"inline-" if align=="center" else ""}flex;align-items:center;justify-content:center;margin:{"0 auto" if align=="center" else "2px 0"}"><span style="color:{ic2};font-size:{sz//2}px;font-weight:700">◆</span></div>'
                else:
                    blocks_html += f'<div style="color:{ic2};font-size:{sz}px;margin:2px 0">◆</div>'
            elif bt == "progress":
                items = b.get("items", b.get("I", []))
                for pi in items:
                    pl = _esc(pi.get("label", pi.get("lb", "")))
                    pv = pi.get("value", 0)
                    pc = _css(pi.get("color", pi.get("c", accent)), accent)
                    blocks_html += f'''<div style="margin:2px 0">
                        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:1px"><span style="color:{color}">{pl}</span><span style="color:{color};opacity:0.5">{pv}%</span></div>
                        <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden"><div style="height:100%;width:{pv}%;background:{pc};border-radius:2px"></div></div>
                    </div>'''
            elif bt == "divider":
                dc = _css(b.get("color", b.get("c", "rgba(255,255,255,0.1)")), "rgba(255,255,255,0.1)")
                blocks_html += f'<div style="height:1px;background:{dc};margin:4px 0"></div>'

        va = s.get("verticalAlign", "top")
        va_css = "center" if va == "center" else "flex-start"

        # Slide number + duration label
        label_color = "rgba(255,255,255,0.25)" if luminance(*hex_to_rgb(bg or "#000")) < 0.5 else "rgba(0,0,0,0.25)"

        html_slides.append(f'''
        <div style="width:576px;height:324px;{bg_style};color:{color};padding:{padding};box-sizing:border-box;border-radius:6px;margin:6px;display:inline-flex;flex-direction:column;justify-content:{va_css};{'text-align:center;align-items:center' if align=='center' else ''};overflow:hidden;font-family:'DM Sans',system-ui,-apple-system,sans-serif;position:relative;box-shadow:0 2px 12px rgba(0,0,0,0.4)">
            <div style="position:absolute;top:4px;right:8px;font-size:13px;font-family:monospace;color:{label_color}">{slide_num} · {dur}s</div>
            {blocks_html}
        </div>''')

    html = f'''<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>{_esc(title)} — Preview</title>
<style>
body{{background:#0a0a0a;padding:16px;display:flex;flex-wrap:wrap;justify-content:center;gap:0;margin:0}}
*{{box-sizing:border-box}}
</style>
</head><body>
{"".join(html_slides)}
</body></html>'''

    if not output_path:
        output_path = deck_path.replace(".json", "-preview.html")
    with open(output_path, "w") as f:
        f.write(html)
    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 preview.py <deck.json> [--audit|--text]")
        sys.exit(1)

    deck_path = sys.argv[1]

    if "--audit" in sys.argv:
        slides, issues = audit_deck(deck_path)
        print(f"\nAudit: {len(slides)} slides, {len(issues)} issues\n")
        if issues:
            for issue in issues:
                print(issue)
        else:
            print("  No issues found.")
    else:
        output = generate_html(deck_path)
        print(f"Preview: {output}")

        # Also run audit
        slides, issues = audit_deck(deck_path)
        if issues:
            print(f"\n⚠️  {len(issues)} issues found:")
            for issue in issues:
                print(issue)
