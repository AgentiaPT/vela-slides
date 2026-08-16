// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Error Boundary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class SlideErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(err, info) { dbg("SlideErrorBoundary caught:", err, info); }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 24, textAlign: "center", color: T.red, fontFamily: FONT.mono, fontSize: 11 }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Slide render error</div>
        <div style={{ color: T.textDim, fontSize: 10 }}>{this.state.error?.message || "Unknown error"}</div>
      </div>
    );
    return this.props.children;
  }
}

// ━━━ Editable Text ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━ Inline Formatting: **bold**, *italic*, ***both***, ~~strike~~ ━━━
// ctx (optional): { glossary?, keyPrefix? } — when provided, also parses markdown
// links [label](https://…) → sanitized <a>, and [label](#term) → <GlossaryLink>.
// All existing call sites omit ctx and behavior is identical to before.
function parseInline(text, ctx) {
  if (!text || typeof text !== "string") return text;
  const glossary = ctx && ctx.glossary;
  const keyPrefix = (ctx && ctx.keyPrefix) || "il";

  const renderLinkToken = (tok, key) => {
    const label = tok.label;
    const target = tok.target;
    if (target && target.charAt(0) === "#") {
      const term = target.slice(1).toLowerCase();
      const entry = glossary && glossary[term];
      if (!entry) return label; // unknown term → plain text fallback
      return <GlossaryLink key={key} label={label} term={term} entry={entry} />;
    }
    const safe = sanitizeUrl(target);
    if (!safe) return label; // blocked URL → plain text fallback
    return <a key={key} href={safe} target="_blank" rel="noopener noreferrer"
              title={linkPreview(safe, label)}
              onClick={(e) => e.stopPropagation()}
              style={{ color: T.accent, textDecoration: "underline", cursor: "pointer" }}>{label}</a>;
  };

  const spliceSentinels = (str, linkTokens, prefix) => {
    // Replace \u0000LINK{i}\u0000 sentinels inside a plain string with React nodes
    if (!str || typeof str !== "string" || !str.includes("\u0000LINK")) return [str];
    const out = [];
    const re = /\u0000LINK(\d+)\u0000/g;
    let last = 0, m;
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) out.push(str.slice(last, m.index));
      const tok = linkTokens[parseInt(m[1], 10)];
      if (tok) out.push(renderLinkToken(tok, `${prefix}-${m[1]}`));
      last = m.index + m[0].length;
    }
    if (last < str.length) out.push(str.slice(last));
    return out;
  };

  const parseLine = (line, lineKey) => {
    // Fast path: no link, no formatting → return untouched
    const hasLink = line.includes("[") && line.includes("](");
    const hasFmt = line.includes("*") || line.includes("__") || line.includes("~~");
    if (!hasLink && !hasFmt) return line;

    // Pass 1: extract [label](target) link spans into sentinel placeholders
    let working = line;
    const linkTokens = [];
    if (hasLink) {
      const linkRe = /\[([^\[\]\n]+?)\]\(([^\s\)\n]+?)\)/g;
      working = line.replace(linkRe, (_, label, target) => {
        const idx = linkTokens.length;
        linkTokens.push({ label, target });
        return `\u0000LINK${idx}\u0000`;
      });
    }

    // Pass 2: existing bold/italic/strike tokenizer on the sentinel-bearing string
    if (!hasFmt && linkTokens.length === 0) return working;
    const parts = [];
    if (hasFmt) {
      const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|___(.+?)___|__(.+?)__|_(.+?)_|~~(.+?)~~)/g;
      let last = 0, m;
      while ((m = re.exec(working)) !== null) {
        if (m.index > last) parts.push(working.slice(last, m.index));
        if (m[2]) parts.push({ text: m[2], bold: true, italic: true });
        else if (m[3]) parts.push({ text: m[3], bold: true });
        else if (m[4]) parts.push({ text: m[4], italic: true });
        else if (m[5]) parts.push({ text: m[5], bold: true, italic: true });
        else if (m[6]) parts.push({ text: m[6], bold: true });
        else if (m[7]) parts.push({ text: m[7], italic: true });
        else if (m[8]) parts.push({ text: m[8], strike: true });
        last = m.index + m[0].length;
      }
      if (last < working.length) parts.push(working.slice(last));
    } else {
      parts.push(working);
    }

    // Pass 3: rehydrate link sentinels inside both plain runs and styled spans
    if (parts.length === 1 && typeof parts[0] === "string" && linkTokens.length === 0) return working;
    const out = [];
    parts.forEach((p, i) => {
      if (typeof p === "string") {
        const spliced = spliceSentinels(p, linkTokens, `${keyPrefix}-${lineKey}-t${i}`);
        spliced.forEach((el, j) => {
          if (typeof el === "string") out.push(el);
          else out.push(React.cloneElement(el, { key: `${keyPrefix}-${lineKey}-t${i}s${j}` }));
        });
      } else {
        const children = spliceSentinels(p.text, linkTokens, `${keyPrefix}-${lineKey}-s${i}`);
        out.push(
          <span key={`${keyPrefix}-${lineKey}-s${i}`} style={{ fontWeight: p.bold ? 700 : undefined, fontStyle: p.italic ? "italic" : undefined, textDecoration: p.strike ? "line-through" : undefined }}>
            {children.length === 1 ? children[0] : children}
          </span>
        );
      }
    });
    return out;
  };

  const textLines = text.split("\n");
  if (textLines.length === 1) return parseLine(textLines[0], 0);
  const result = [];
  textLines.forEach((line, i) => {
    if (i > 0) result.push(<br key={`${keyPrefix}-br${i}`} />);
    const parsed = parseLine(line, i);
    if (Array.isArray(parsed)) parsed.forEach((el, j) => {
      result.push(typeof el === "string" ? el : React.cloneElement(el, { key: `${keyPrefix}-${i}x${j}` }));
    });
    else result.push(parsed);
  });
  return result;
}

// ━━━ X-Ray Glossary Link — inline popover for [term](#key) refs ━━━━
// Used by parseInline when ctx.glossary is provided. Matches the popover
// style used by CommentPopover (inline absolute, click-outside + Esc close).
function GlossaryLink({ label, term, entry }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const preview = (entry && entry.definition ? entry.definition : "").slice(0, 140);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <span
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={preview}
        data-xray-term={term}
        style={{
          color: T.accent,
          borderBottom: `1px dashed ${T.accent}`,
          cursor: "help",
          fontWeight: 600,
        }}
      >{label}</span>
      {open && (
        <span style={{
          position: "absolute",
          top: "100%",
          left: 0,
          zIndex: 50,
          marginTop: 4,
          minWidth: 220,
          maxWidth: 320,
          padding: "10px 12px",
          background: "#0f1219",
          border: `1px solid ${T.accent}60`,
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          fontSize: 12,
          lineHeight: 1.5,
          color: "#E6F1FF",
          fontFamily: FONT.body,
          whiteSpace: "normal",
          textAlign: "left",
        }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, color: T.accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{term}</div>
          <div>{entry && entry.definition}</div>
          {entry && entry.url && sanitizeUrl(entry.url) && (
            <a href={sanitizeUrl(entry.url)} target="_blank" rel="noopener noreferrer"
               onClick={(e) => e.stopPropagation()}
               style={{ display: "inline-block", marginTop: 6, color: T.accent, fontSize: 11, textDecoration: "underline" }}>
              Learn more →
            </a>
          )}
        </span>
      )}
    </span>
  );
}

function EditableText({ text, onSave, editable, style, multiline, className, prefix, suffix }) {
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [localText, setLocalText] = useState(text);
  const ref = useRef(null);

  useEffect(() => { setLocalText(text); }, [text]);

  // Convert markdown inline to HTML for WYSIWYG editing
  const mdToHtml = (t) => {
    if (!t) return "";
    return t
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/___(.+?)___/g, "<strong><em>$1</em></strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      .replace(/\n/g, "<br>");
  };

  // Convert contentEditable HTML back to markdown
  const htmlToMd = (el) => {
    let r = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { r += n.textContent; }
      else if (n.nodeName === "BR") { r += "\n"; }
      else if (n.nodeName === "STRONG" || n.nodeName === "B") { r += "**" + htmlToMd(n) + "**"; }
      else if (n.nodeName === "EM" || n.nodeName === "I") { r += "*" + htmlToMd(n) + "*"; }
      else if (n.nodeName === "S" || n.nodeName === "DEL" || n.nodeName === "STRIKE") { r += "~~" + htmlToMd(n) + "~~"; }
      else if (n.nodeName === "DIV" || n.nodeName === "P") {
        if (r.length > 0 && !r.endsWith("\n")) r += "\n";
        r += htmlToMd(n);
      }
      else { r += htmlToMd(n); }
    }
    return r;
  };

  useEffect(() => {
    if (!editing || !ref.current) return;
    const el = ref.current;
    el.innerHTML = mdToHtml(localText);
    el.focus();
    try { const s = window.getSelection(); s.selectAllChildren(el); s.collapseToEnd(); } catch (_) {}
  }, [editing]);

  const baseStyle = { ...style, whiteSpace: "pre-line" };

  if (!editable || !onSave) return <div className={className} style={baseStyle}>{prefix}{parseInline(text)}{suffix}</div>;

  const commit = () => {
    const el = ref.current;
    if (!el) { setEditing(false); setHovered(false); return; }
    const v = htmlToMd(el).trim();
    if (v !== text) { setLocalText(v); onSave(v); }
    setEditing(false);
    setHovered(false);
  };
  const cancel = () => { setEditing(false); setHovered(false); };
  const begin = (e) => { e.stopPropagation(); e.preventDefault(); setEditing(true); };

  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") cancel();
    if (e.key === "Enter" && !multiline && !e.shiftKey) { e.preventDefault(); commit(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "b") { e.preventDefault(); document.execCommand("bold"); }
    if ((e.ctrlKey || e.metaKey) && e.key === "i") { e.preventDefault(); document.execCommand("italic"); }
  };

  if (editing) return (
    <div key="editing" ref={ref} contentEditable suppressContentEditableWarning
      onBlur={commit} onKeyDown={onKey}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={className}
      style={{ ...baseStyle, outline: `2px solid ${T.accent}`, outlineOffset: 2, borderRadius: 2, cursor: "text", minHeight: "1em", whiteSpace: "pre-wrap" }}
    />
  );

  return (
    <div key="display" className={className}
      onClick={begin}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ ...baseStyle, cursor: "pointer", borderRadius: 2,
        outline: hovered ? `1px dashed ${T.accent}60` : "1px dashed transparent",
        outlineOffset: 2, transition: "outline 0.15s ease" }}
    >{prefix}{parseInline(localText)}{suffix}</div>
  );
}


// ━━━ Block Helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const stg = (base, offset = 0) => `stg-${Math.min(base + offset, 7)}`;
// Buffer (px) reserved above/right of a cols-layout column's inner crop box so
// an edge block's hover toolbar (negative top/right offset) isn't clipped.
const COL_TOOLBAR_PAD = 12;

// Patch a single item in block.items and call onChange
function patchItemAt(block, onChange, idx, patch) {
  const ni = [...(block.items || [])];
  ni[idx] = { ...ni[idx], ...patch };
  onChange?.({ items: ni });
}

// Remove block.items[idx] and call onChange
function removeItemAt(block, onChange, idx) {
  onChange?.({ items: (block.items || []).filter((_, j) => j !== idx) });
}

// Set/clear .link on block.items[idx], upgrading a bare-string item to an object
function setItemLink(block, onChange, idx, url) {
  const ni = [...(block.items || [])];
  const cur = ni[idx];
  const base = typeof cur === "string" ? { text: cur } : { ...cur };
  if (url) base.link = url; else delete base.link;
  ni[idx] = base;
  onChange?.({ items: ni });
}

// Read the per-item link regardless of whether the item is a bare string or an object
const itemLinkOf = (item) => (item && typeof item === "object" ? item.link : undefined);

// Append newItem to block.items and call onChange
function addItemAt(block, onChange, newItem) {
  onChange?.({ items: [...(block.items || []), newItem] });
}

// Swap block.items[idx] with its neighbour ("up" = earlier, "down" = later) and
// call onChange. No-op at the list boundary. Mirrors the reducer's REORDER swap.
function moveItemAt(block, onChange, idx, dir) {
  const items = [...(block.items || [])];
  const t = dir === "up" ? idx - 1 : idx + 1;
  if (t < 0 || t >= items.length) return;
  [items[idx], items[t]] = [items[t], items[idx]];
  onChange?.({ items });
}

// Build the pin-aware control ItemChrome renders as ▲▼ arrows:
//   { onUp, onDown, pinned, anyPinned, clearPin }
// `move(dir)` performs the swap; `keyOf(i)` maps a slot index to its pin key;
// `pin` = { key, set } is shared per-block state (from RenderBlock).
//
// After a move we pin the DESTINATION slot (keyOf(idx±1)) so its cluster stays
// visible on the item that just landed there — instead of the neighbour that
// slid under the cursor stealing focus. The pin is positional (survives the swap
// without item ids) and is cleared on the next mouse move (see ItemChrome).
// `anyPinned` lets every other item suppress its own hover cluster while pinned.
const _noPin = { key: null, set: () => {} };
const reorderCtl = (n, idx, move, keyOf, pin) => {
  const p = pin || _noPin;
  return {
    onUp: idx > 0 ? () => { move("up"); p.set(keyOf(idx - 1)); } : undefined,
    onDown: idx < n - 1 ? () => { move("down"); p.set(keyOf(idx + 1)); } : undefined,
    pinned: p.key === keyOf(idx),
    anyPinned: p.key != null,
    clearPin: () => p.set(null),
  };
};

// Reorder control for a plain block.items list — undefined when not editable or
// when there is nothing to reorder (0–1 items).
function itemReorder(block, onChange, idx, pin) {
  if (!onChange) return undefined;
  const n = (block.items || []).length;
  if (n <= 1) return undefined;
  return reorderCtl(n, idx, (d) => moveItemAt(block, onChange, idx, d), String, pin);
}

// Placeholder item factory for the "+ add" affordance on multi-item blocks.
// Returns a blank item with neutral placeholder text/icon matching each block
// type's item shape — so a fresh item is editable inline without resorting to AI.
function blankItemFor(type) {
  switch (type) {
    case "bullets": return "New point";
    case "icon-row": return { icon: "Circle", title: "Title", text: "Description" };
    case "flow": return { icon: "Circle", label: "Step" };
    case "steps": return { title: "Step title", text: "Description" };
    case "tag-group": return { text: "Tag" };
    case "timeline": return { date: "2025", title: "Milestone", text: "Description" };
    case "progress": return { label: "Metric", value: 50 };
    case "number-row": return { value: "00", label: "Label", icon: "Circle" };
    case "checklist": return { text: "New task", status: "pending" };
    case "funnel": return { label: "Stage", value: "0" };
    case "cycle": return { label: "Step" };
    case "grid": return { blocks: [{ type: "heading", text: "Title", size: "md" }, { type: "text", text: "Description" }] };
    default: return { text: "New item" };
  }
}

// Content fields to reset to placeholders when cloning a sibling item. Everything
// NOT listed here (colors, icon, iconColor/iconBg, padding, status, variant, style…)
// is inherited from the last item so the new one matches its neighbours.
const PLACEHOLDER_FIELDS = {
  bullets: { text: "New point" },
  "icon-row": { title: "Title", text: "Description" },
  flow: { label: "Step" },
  steps: { title: "Step title", text: "Description" },
  "tag-group": { text: "Tag" },
  timeline: { date: "2025", title: "Milestone", text: "Description" },
  progress: { label: "Metric", value: 50 },
  "number-row": { value: "00", label: "Label" },
  checklist: { text: "New task" },
  funnel: { label: "Stage", value: "0" },
  cycle: { label: "Step" },
};

// Deep-clone a grid cell, keeping its style (padding/background) and inner block
// structure (icon, sizes, colors) so the new card looks identical to its siblings —
// only the textual block content is reset to placeholders.
function cloneGridCell(cell) {
  let c;
  try { c = JSON.parse(JSON.stringify(cell)); } catch { return blankItemFor("grid"); }
  if (!c || typeof c !== "object") return blankItemFor("grid");
  delete c.link;
  if (Array.isArray(c.blocks) && c.blocks.length) {
    c.blocks.forEach((b) => {
      if (!b || typeof b !== "object") return;
      delete b.link;
      if (typeof b.text === "string") b.text = b.type === "text" ? "Description" : "Title";
      if (typeof b.value === "string") b.value = "00";
      if (typeof b.label === "string") b.label = "Label";
      if (typeof b.caption === "string") b.caption = "Caption";
    });
    return c;
  }
  return blankItemFor("grid");
}

// Reset a comparison/matrix point (string or {text,link}) to a placeholder,
// preserving any other styling the sibling point carried.
function clonePoint(pt) {
  if (pt && typeof pt === "object") { const x = { ...pt, text: "New point" }; delete x.link; return x; }
  return "New point";
}

// Build the item appended by "+ add": clone the last sibling's style and reset
// only its content fields to placeholders. Falls back to a generic blank when the
// list is empty (or the sibling is a bare string with no style to inherit).
function newItemFor(block, type) {
  const items = block.items || [];
  const last = items.length ? items[items.length - 1] : undefined;
  if (type === "grid") return last ? cloneGridCell(last) : blankItemFor("grid");
  if (last && typeof last === "object" && !Array.isArray(last)) {
    const next = { ...last };
    delete next.link;
    const ph = PLACEHOLDER_FIELDS[type] || { text: "New item" };
    for (const k in ph) next[k] = ph[k];
    return next;
  }
  return blankItemFor(type);
}

// ━━━ Add-Item Affordance — "+ add" button shown only in edit mode ━━━━━━━━━━━━━
// Lets the user append a placeholder item to a multi-item block without AI.
// variant: "row" full-width dashed bar (column lists) · "chip" compact inline
// (wrap/horizontal layouts) · "cell" grid-cell-sized dashed box.
// Hover-reveal (CR-06): mirrors the slide-level "＋ add" affordance (AddMenu,
// part-list.jsx) — idle at low opacity so it reads as a hint rather than
// permanent chrome, full opacity + accent styling on hover. Same policy
// everywhere an "+ Add X" appears (bullets, flow, table rows, steps, etc.).
function AddItem({ onAdd, label = "Add", accent, variant = "row", style }) {
  const [hover, setHover] = useState(false);
  const ac = accent || T.accent;
  const base = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
    cursor: "pointer", fontFamily: FONT.mono, fontSize: variant === "chip" ? 10 : 11,
    fontWeight: 600, letterSpacing: "0.04em", lineHeight: 1,
    color: hover ? ac : T.textDim,
    border: `1px dashed ${hover ? ac : T.border}`,
    borderRadius: variant === "cell" ? 10 : 6,
    background: hover ? `${ac}12` : "transparent",
    opacity: hover ? 1 : 0.28,
    transition: "opacity .15s, color .15s, border-color .15s, background .15s",
    boxSizing: "border-box", userSelect: "none",
    padding: variant === "chip" ? "4px 10px" : variant === "cell" ? 16 : "6px 12px",
    width: variant === "chip" ? "fit-content" : "100%",
    minHeight: variant === "cell" ? 56 : undefined,
    ...style,
  };
  return <button type="button" title={label}
    onClick={(e) => { e.stopPropagation(); onAdd(); }}
    onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    style={base}>+ {label}</button>;
}

// Editable text wired to patch an item property
function ItemText({ block, onChange, editable, idx, prop, style }) {
  const items = block.items || [];
  const val = items[idx]?.[prop] || "";
  return <EditableText text={val} editable={editable}
    onSave={(v) => patchItemAt(block, onChange, idx, { [prop]: v })} style={style} />;
}

// Icon in a circle/square container
function IconBubble({ icon, size = 20, color, bg, shape, strokeWidth = 1.5 }) {
  const el = getIcon(icon, { size, color, strokeWidth });
  if (!el) return null;
  const d = size * 1.8;
  // `bg` mixes deck-supplied values (block.bg/iconBg/item.iconBg) with computed
  // theme+alpha fallbacks — encoder-gate once here for every caller. (v13.26)
  return <div style={{ width: d, height: d, borderRadius: shape === "square" ? 8 : "50%", background: cssColor(bg), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{el}</div>;
}

// ━━━ Per-Item Chrome — hover toolbar (🔗 link + ✕ delete) for one item of a multi-item block ━━
// In edit mode, hovering an item shows a small cluster to attach/edit a link or delete the item.
// Out of edit mode, a linked item becomes clickable (and feeds PDF export via data-pdf-link).
// Pass onDelete/onSetLink to enable each action; omit one to hide that button.
//
// Overlap handling: the toolbar anchors INSIDE the item's top-right corner so it never
// pokes into a neighbouring item or past the slide edge. Hovering an item also notifies
// ItemHoverContext, which the block lets read to hide its own (block-level) toolbar — so
// the item toolbar and the block toolbar are never shown stacked on the same corner.
const ItemHoverContext = React.createContext(null);
const itemChromeBtn = (bg, border, color) => ({ width: 18, height: 18, borderRadius: "50%", background: bg, border: `1px solid ${border}`, color, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" });
// Reorder arrow — a full-size round button (same footprint as the link/delete
// chrome) so it's an easy click target. Dimmed + non-interactive at a boundary.
const reorderArrowBtn = (enabled) => ({ ...itemChromeBtn(T.bgPanel, T.border, enabled ? T.text : T.border), fontSize: 10, fontWeight: 700, cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.4 });

// noLinkBadge: keep link click-through + PDF export but render no link UI (badge/popup/button)
// — used by grid, where the inner block already owns the link-editing chrome.
function ItemChrome({ editable, presenting, onDelete, link, onSetLink, children, className, wrapStyle, linkLabel, anchor, badgeAnchor, noLinkBadge, reorder }) {
  const [hovered, setHovered] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const notifyHover = React.useContext(ItemHoverContext);
  const editMode = editable && !presenting;
  const linkable = typeof onSetLink === "function";
  const showLinkUI = linkable && !noLinkBadge;
  const deletable = typeof onDelete === "function";
  const clickable = link && !editMode;
  const a = anchor || { top: 2, right: 2 };
  const ba = badgeAnchor || { top: 2, right: 2 };
  const enter = () => { setHovered(true); if (editMode) notifyHover?.(true); };
  const leave = () => { setHovered(false); if (editMode) notifyHover?.(false); };
  // While a reorder pin is active anywhere in the block, the pinned slot keeps its
  // cluster and every other item suppresses hover — so the item that just moved
  // stays focused instead of the neighbour now under the cursor. The pin clears on
  // the next mouse move, handing control back to plain hover.
  const clusterVisible = reorder && reorder.anyPinned ? reorder.pinned : hovered;
  return (
    <div className={className} style={{ position: "relative", ...(clickable ? { cursor: "pointer" } : {}), ...wrapStyle }}
      title={link ? linkPreview(link, linkLabel) : undefined}
      onMouseMove={reorder && reorder.anyPinned ? () => reorder.clearPin?.() : undefined}
      data-pdf-link={link || undefined}
      onClick={clickable ? (e) => { e.stopPropagation(); openExternalLink(link); } : undefined}
      onMouseEnter={enter} onMouseLeave={leave}>
      {children}
      {/* Idle link badge — edit mode, cluster not shown */}
      {link && showLinkUI && !clusterVisible && editMode && <div onClick={(e) => { e.stopPropagation(); setEditingLink(true); }} style={{ position: "absolute", ...ba, width: 14, height: 14, borderRadius: "50%", background: T.accent + "80", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, zIndex: 5, cursor: "pointer" }} title={link}>🔗</div>}
      {/* Idle link badge — presenter */}
      {link && presenting && !noLinkBadge && <div onClick={(e) => { e.stopPropagation(); openExternalLink(link); }} style={{ position: "absolute", ...ba, padding: "2px 5px", borderRadius: 4, background: T.accent, fontSize: 9, color: "#fff", zIndex: 12, cursor: "pointer", opacity: hovered ? 1 : 0.3, transition: "opacity 0.2s", boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>🔗</div>}
      {/* Hover cluster — edit mode (or pinned after a reorder move) */}
      {clusterVisible && editMode && (showLinkUI || deletable || reorder) && <div style={{ position: "absolute", ...a, display: "flex", alignItems: "center", gap: 3, zIndex: 11 }}>
        {reorder && <button onClick={(e) => { e.stopPropagation(); reorder.onUp?.(); }} disabled={!reorder.onUp} style={reorderArrowBtn(!!reorder.onUp)} title="Move up">▲</button>}
        {reorder && <button onClick={(e) => { e.stopPropagation(); reorder.onDown?.(); }} disabled={!reorder.onDown} style={reorderArrowBtn(!!reorder.onDown)} title="Move down">▼</button>}
        {showLinkUI && <button onClick={(e) => { e.stopPropagation(); setEditingLink(!editingLink); }} style={itemChromeBtn(link ? T.accent : T.bgPanel, link ? T.accent : T.border, link ? "#fff" : T.textDim)} title={link ? `Link: ${link}` : "Add link"}>🔗</button>}
        {deletable && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ ...itemChromeBtn(T.red, T.red, "#fff"), fontWeight: 700 }} title="Delete item">✕</button>}
      </div>}
      {/* Link editor popup */}
      {editingLink && editMode && showLinkUI && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -30, right: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 6px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
        <span style={{ fontSize: 9, color: T.textDim }}>🔗</span>
        <input autoFocus defaultValue={link || ""} placeholder="https://..." onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { onSetLink(e.target.value.trim() || undefined); setEditingLink(false); } if (e.key === "Escape") setEditingLink(false); }} onBlur={(e) => { onSetLink(e.target.value.trim() || undefined); setEditingLink(false); }} style={{ width: 200, padding: "2px 6px", fontSize: 10, fontFamily: FONT.mono, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, outline: "none" }} />
        {link && <button onClick={() => { onSetLink(undefined); setEditingLink(false); }} style={{ background: "none", border: "none", color: T.red, fontSize: 10, cursor: "pointer", padding: 0 }}>✕</button>}
      </div>}
    </div>
  );
}

// ━━━ Icon Row Item (per-item link + delete) ━━━━━━━━━━━━━━━━━━━━━━━━━
function IconRowItem({ item, index, block, editable, onChange, st, SIZES, staggerIdx, presenting = false, pin }) {
  const link = item.link;
  const editMode = editable && !presenting;
  return (
    <ItemChrome editable={editable} presenting={presenting}
      className={stg(staggerIdx, index)}
      wrapStyle={{ display: "flex", width: link ? "fit-content" : undefined, gap: 14, alignItems: "center" }}
      link={link} linkLabel={item.title}
      reorder={itemReorder(block, onChange, index, pin)}
      onSetLink={onChange ? (url) => setItemLink(block, onChange, index, url) : undefined}
      onDelete={onChange ? () => removeItemAt(block, onChange, index) : undefined}>
      <EditableIcon editable={editMode} value={item.icon} size={20} onPick={onChange ? (name) => patchItemAt(block, onChange, index, { icon: name }) : undefined}>
        <IconBubble icon={item.icon} size={20} color={item.iconColor || block.iconColor || st.accent} bg={item.iconBg || block.iconBg || `${st.accent}15`} shape={block.iconShape} />
      </EditableIcon>
      <div style={{ flex: 1 }}>
        <ItemText block={block} onChange={editMode ? onChange : undefined} editable={editMode} idx={index} prop="title" style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "sm"], fontWeight: 600, color: item.color || block.color || st.text, lineHeight: 1.3 }} />
        {item.text && <ItemText block={block} onChange={editMode ? onChange : undefined} editable={editMode} idx={index} prop="text" style={{ fontFamily: FONT.body, fontSize: SIZES[block.textSize || "sm"], color: block.textColor || st.muted, lineHeight: 1.5 }} />}
      </div>
    </ItemChrome>
  );
}

// ━━━ Bullet Item (per-item link + delete) ━━━━━━━━━━━━━━━━━━━━━
function BulletItem({ item, index, block, editable, onChange, st, SIZES, staggerIdx, fontScale, presenting = false, pin }) {
  const text = typeof item === "string" ? item : item.text;
  const icon = typeof item === "object" ? item.icon : null;
  const link = itemLinkOf(item);
  const editMode = editable && !presenting;
  const pickIcon = onChange ? (name) => {
    const ni = [...(block.items || [])];
    const cur = ni[index];
    ni[index] = typeof cur === "string" ? { text: cur, icon: name } : { ...cur, icon: name };
    if (!name) delete ni[index].icon;
    onChange({ items: ni });
  } : undefined;
  return (
    <ItemChrome editable={editable} presenting={presenting}
      className={stg(staggerIdx, index)}
      wrapStyle={{ display: "flex", gap: 12, alignItems: "center" }}
      link={link} linkLabel={text}
      reorder={itemReorder(block, onChange, index, pin)}
      onSetLink={onChange ? (url) => setItemLink(block, onChange, index, url) : undefined}
      onDelete={onChange ? () => removeItemAt(block, onChange, index) : undefined}>
      {icon
        ? <EditableIcon editable={editMode} value={icon} size={16} onPick={pickIcon}><span style={{ flexShrink: 0, display: "flex" }}>{getIcon(icon, { size: 16, color: cssColor(block.dotColor) || st.accent, strokeWidth: 2 })}</span></EditableIcon>
        : (editMode
          ? <EditableIcon editable value={undefined} size={14} onPick={pickIcon} />
          : <div style={{ width: 6, height: 6, borderRadius: "50%", background: cssColor(block.dotColor) || st.accent, flexShrink: 0 }} />)}
      <EditableText text={text} editable={editMode} onSave={(v) => {
        const ni = [...(block.items || [])];
        ni[index] = typeof item === "string" ? v : { ...item, text: v };
        onChange?.({ items: ni });
      }} style={{ fontFamily: FONT.body, fontSize: SIZES[block.size || "md"], color: block.color || st.muted, lineHeight: 1.6, flex: 1, ...(link ? { textDecoration: "underline", textDecorationColor: (block.dotColor || st.accent) + "60", textUnderlineOffset: "3px" } : {}) }} />
    </ItemChrome>
  );
}

// ━━━ Grid Cell Block (with per-block link editing) ━━━━━━━━━━━━━━━
function GridCellBlock({ block, staggerIdx, slideTheme, editable, onChange, slideAlign, fontScale, presenting }) {
  const [hovered, setHovered] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const link = block.link;
  const editMode = editable && !presenting;

  const setLink = (url) => onChange?.({ link: url || undefined });

  return (
    <div style={{ position: "relative", ...(link ? { cursor: "pointer" } : {}) }}
      title={link ? linkPreview(link, block.text || block.value || block.title) : undefined}
      data-pdf-link={link || undefined}
      onClick={link ? (e) => { e.stopPropagation(); openExternalLink(link); } : undefined}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <RenderBlock block={block} staggerIdx={staggerIdx} slideTheme={slideTheme} editable={link ? false : editMode} slideAlign={slideAlign} fontScale={fontScale} presenting={presenting}
        onChange={onChange} />
      {/* Presenter mode: persistent link pill */}
      {link && presenting && <div onClick={(e) => { e.stopPropagation(); openExternalLink(link); }} style={{ position: "absolute", top: -8, right: -8, padding: "1px 6px", borderRadius: 4, background: T.accent, fontSize: 9, fontFamily: FONT.mono, color: "#fff", fontWeight: 600, zIndex: 12, cursor: "pointer", opacity: hovered ? 1 : 0.3, transition: "opacity 0.2s", boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>🔗</div>}
      {/* Link badge (not hovered, edit mode) */}
      {link && !hovered && editMode && <div style={{ position: "absolute", top: -8, right: -8, width: 14, height: 14, borderRadius: "50%", background: T.accent + "80", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, zIndex: 5, cursor: "pointer" }} title={link} onClick={(e) => { e.stopPropagation(); setEditingLink(true); }}>🔗</div>}
      {/* Hover chrome (edit mode) */}
      {hovered && editMode && <div style={{ position: "absolute", top: -10, right: -10, display: "flex", gap: 3, zIndex: 11 }}>
        <button onClick={(e) => { e.stopPropagation(); setEditingLink(!editingLink); }} style={{ width: 18, height: 18, borderRadius: "50%", background: link ? T.accent : T.bgPanel, border: `1px solid ${link ? T.accent : T.border}`, color: link ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title={link ? `Link: ${link}` : "Add link"}>🔗</button>
      </div>}
      {/* Link editor popup */}
      {editingLink && editMode && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -30, left: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 6px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
        <span style={{ fontSize: 9, color: T.textDim }}>🔗</span>
        <input autoFocus defaultValue={link || ""} placeholder="https://..." onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { setLink(e.target.value.trim()); setEditingLink(false); } if (e.key === "Escape") setEditingLink(false); }} onBlur={(e) => { setLink(e.target.value.trim()); setEditingLink(false); }} style={{ width: 200, padding: "2px 6px", fontSize: 10, fontFamily: FONT.mono, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, outline: "none" }} />
        {link && <button onClick={() => { setLink(undefined); setEditingLink(false); }} style={{ background: "none", border: "none", color: T.red, fontSize: 10, cursor: "pointer", padding: 0 }}>✕</button>}
      </div>}
    </div>
  );
}

// ━━━ Zoomable Block Wrapper ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function ZoomWrap({ children, enabled, link, fill }) {
  const [zoomed, setZoomed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const sourceRef = useRef(null);
  const cloneRef = useRef(null);

  useEffect(() => {
    if (!zoomed || !sourceRef.current || !cloneRef.current) return;
    const el = sourceRef.current;
    const container = cloneRef.current;
    container.innerHTML = "";
    // Find the SVG or IMG and render it full-viewport (skip the zoom badge icon)
    const svg = Array.from(el.querySelectorAll("svg[viewBox]")).find(s => !s.closest("[data-zoom-badge]"));
    const img = el.querySelector("img[src]");
    if (svg) {
      const svgClone = svg.cloneNode(true);
      svgClone.removeAttribute("width");
      svgClone.removeAttribute("height");
      svgClone.style.cssText = "width:100%;height:100%";
      container.appendChild(svgClone);
    } else if (img) {
      const imgClone = img.cloneNode(true);
      imgClone.style.cssText = "width:100%;height:100%;object-fit:contain;display:block";
      container.appendChild(imgClone);
    } else {
      // Flow blocks or other — clone entire subtree with scale
      const clone = el.cloneNode(true);
      clone.style.cssText = "transform:scale(2);transform-origin:center center;position:absolute;top:50%;left:50%;translate:-50% -50%";
      container.appendChild(clone);
    }
  }, [zoomed]);

  if (!enabled) return children;

  // When the block carries a link, the link takes precedence: a plain click
  // bubbles to the wrapper's openExternalLink handler instead of zooming. Zoom
  // stays reachable via the explicit badge (clickable only while visible/hovered
  // so the invisible badge never steals clicks aimed at the link).
  const hasLink = !!link;
  const triggerZoom = (e) => { e.stopPropagation(); setZoomed(true); };

  return <>
    <div ref={sourceRef} style={{ position: "relative", cursor: hasLink ? "pointer" : "zoom-in", ...(fill ? { flex: 1, height: "100%", minHeight: 0 } : {}) }}
      onClick={hasLink ? undefined : triggerZoom}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
      <div data-zoom-badge="" onClick={hasLink ? triggerZoom : undefined} style={{ position: "absolute", top: 4, right: 4, padding: "2px 6px", borderRadius: 4, background: "rgba(15,23,42,0.7)", color: "#e2e8f0", fontSize: 10, fontFamily: "monospace", opacity: hovered ? 0.8 : 0, transition: "opacity 0.2s", pointerEvents: (hasLink && hovered) ? "auto" : "none", cursor: "zoom-in", display: "flex", alignItems: "center", gap: 3 }}>
        {getIcon("Maximize2", { size: 10, color: "#e2e8f0" })} zoom
      </div>
    </div>
    {zoomed && <div
      onClick={() => setZoomed(false)}
      onKeyDown={(e) => { if (e.key === "Escape") setZoomed(false); }}
      tabIndex={0} ref={(el) => el?.focus()}
      style={{ position: "fixed", inset: 0, zIndex: 999999, background: "#060a14", cursor: "zoom-out" }}>
      <div style={{ position: "absolute", top: 12, right: 16, color: "#64748b", fontSize: 11, fontFamily: "monospace", zIndex: 10 }}>ESC or click to close</div>
      <div ref={cloneRef} onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 40, left: 40, right: 40, bottom: 40, cursor: "default" }} />
    </div>}
  </>;
}

// ━━━ Code Block (sub-component for useState copy feedback) ━━━━━━━
function CodeBlock({ block, cls, st, editable, onChange, SIZES }) {
  const [copied, setCopied] = useState(false);
  const showCopy = !!block.copy;
  const handleCopy = () => {
    if (!block.text) return;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(block.text).then(done).catch(() => {
        // Fallback for non-HTTPS / sandboxed iframes
        try { const ta = Object.assign(document.createElement("textarea"), { value: block.text, style: "position:fixed;opacity:0" }); document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); done(); } catch (_) {}
      });
    }
  };
  return <div className={cls} style={{ position: "relative", background: cssColor(block.bg) || "rgba(0,0,0,0.2)", borderRadius: 8, padding: "16px 20px", border: `1px solid ${st.border}`, overflow: "auto", ...block.style }}>
    {block.label && <EditableText text={block.label} editable={editable} onSave={(v) => onChange?.({ label: v })} style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: st.accent, marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }} />}
    <EditableText text={block.text} editable={editable} onSave={(v) => onChange?.({ text: v })} multiline style={{ fontFamily: FONT.mono, fontSize: SIZES[block.size || "sm"], color: block.color || st.text, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap", ...(showCopy ? { paddingRight: 80 } : {}) }} />
    {showCopy && <button onClick={handleCopy} style={{ position: "absolute", top: 10, right: 10, padding: "4px 10px", borderRadius: 4, border: `1px solid ${st.border}`, background: copied ? st.accent : "rgba(255,255,255,0.08)", color: copied ? "#fff" : st.muted, fontSize: 11, fontFamily: FONT.mono, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s", zIndex: 2 }}>{copied ? "Copiado ✓" : "Copiar"}</button>}
  </div>;
}

// ━━━ Callout Block (sub-component for useState reveal toggle) ━━━━
function CalloutBlock({ block, cls, st, editable, onChange, SIZES }) {
  // reveal: true → starts collapsed (open=false); reveal: false/omitted → always open
  const [open, setOpen] = useState(!block.reveal);
  const isReveal = !!block.reveal;
  const chevron = isReveal ? (open ? "▾" : "▸") : null;
  return <div className={cls} style={{ display: "flex", gap: 10, padding: "14px 18px", borderRadius: 8, background: cssColor(block.bg) || `${st.accent}12`, borderLeft: `3px solid ${block.border || st.accent}`, alignItems: "flex-start", ...block.style }}>
    <EditableIcon editable={editable} value={block.icon} size={18} onPick={(name) => onChange?.({ icon: name })}>
      {block.icon ? <span style={{ flexShrink: 0, display: "flex", marginTop: 2, ...((isReveal && !editable) ? { cursor: "pointer" } : {}) }} onClick={(isReveal && !editable) ? () => setOpen(!open) : undefined}>{getIcon(block.icon, { size: 18, color: block.border || st.accent, strokeWidth: 2 })}</span> : null}
    </EditableIcon>
    <div style={{ flex: 1 }}>
      {block.title && <div style={{ display: "flex", alignItems: "center", gap: 6, ...(isReveal ? { cursor: "pointer", userSelect: "none" } : {}) }} onClick={isReveal ? () => setOpen(!open) : undefined}>
        {chevron && <span style={{ fontSize: 14, color: block.border || st.accent, lineHeight: 1 }}>{chevron}</span>}
        <EditableText text={block.title} editable={editable} onSave={(v) => onChange?.({ title: v })} style={{ fontFamily: FONT.display, fontSize: SIZES.sm, fontWeight: 700, color: block.border || st.accent, marginBottom: open ? 4 : 0 }} />
      </div>}
      {!block.title && isReveal && <div style={{ cursor: "pointer", userSelect: "none", fontSize: 14, color: block.border || st.accent, marginBottom: open ? 4 : 0 }} onClick={() => setOpen(!open)}>{chevron} {open ? "Ocultar" : "Revelar"}</div>}
      {open && <EditableText text={block.text} editable={editable} onSave={(v) => onChange?.({ text: v })} multiline style={{ fontFamily: FONT.body, fontSize: SIZES[block.size || "md"], color: block.color || st.text, lineHeight: 1.5 }} />}
    </div>
  </div>;
}

// ━━━ Block Renderer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function RenderBlock({ block: rawBlock, staggerIdx, slideTheme, editable, onChange, slideAlign, fontScale = 1, presenting = false }) {
  // Runtime guard: ensure .style is always a plain object
  const block = useMemo(() => {
    if (rawBlock.style && (typeof rawBlock.style !== "object" || Array.isArray(rawBlock.style))) {
      const { style: _, ...rest } = rawBlock; return rest;
    }
    return rawBlock;
  }, [rawBlock]);
  const SIZES = useMemo(() => {
    if (!fontScale || fontScale === 1) return BASE_SIZES;
    const s = {};
    for (const k in BASE_SIZES) s[k] = (parseFloat(BASE_SIZES[k]) * fontScale).toFixed(3) + "rem";
    return s;
  }, [fontScale]);
  const st = slideTheme;
  const cls = stg(staggerIdx);
  // Show the "+ add item" affordance only in the live editable panel
  // (never in present/thumbnail/PDF, and only when an onChange sink exists).
  const canEdit = editable && !presenting && typeof onChange === "function";
  // Text/icon-slot edit chrome (dashed hover outline, click-to-edit, ghost "+"
  // icon slot) must also never leak into Present mode — gate it the same way.
  const textEditable = editable && !presenting;
  // Per-block reorder pin (see reorderCtl/ItemChrome): keeps the just-moved item's
  // ▲▼ cluster focused at its destination slot. `_pin` is handed to itemReorder;
  // the comparison/matrix cases read pinKey/setPinKey directly for their columns.
  const [pinKey, setPinKey] = useState(null);
  const _pin = { key: pinKey, set: setPinKey };
  switch (block.type) {

    case "heading": {
      const headingText = (block.text || "").replace(/^\*\*\s*|\s*\*\*$/g, "").replace(/\*\*/g, "");
      const headingIconSlot = block.icon || textEditable;
      const hs = { fontFamily: FONT.display, fontSize: SIZES[block.size || "2xl"], fontWeight: block.weight || 700, color: block.color || st.text, lineHeight: 1.2, letterSpacing: "-0.02em", textAlign: headingIconSlot ? undefined : block.align, maxWidth: block.maxWidth, margin: block.maxWidth && slideAlign === "center" ? "0 auto" : undefined, ...block.style };
      const wrapS = headingIconSlot ? { display: "flex", alignItems: "center", gap: 10, justifyContent: block.align === "center" ? "center" : block.align === "right" ? "flex-end" : undefined } : {};
      return <div className={cls} style={{ ...wrapS, ...hs }}>
        <EditableIcon editable={textEditable} value={block.icon} size={24} onPick={(name) => onChange?.({ icon: name })}>
          {block.icon ? <span style={{ flexShrink: 0, display: "flex" }}>{getIcon(block.icon, { size: Math.round(parseFloat(SIZES[block.size || "2xl"]) * 16) || 24, color: block.iconColor || block.color || st.accent, strokeWidth: 2 })}</span> : null}
        </EditableIcon>
        <EditableText text={headingText} editable={textEditable} onSave={(v) => onChange?.({ text: v })} style={headingIconSlot ? { flex: 1, textAlign: block.align } : undefined} />
      </div>;
    }

    case "text":
      return <EditableText className={cls} text={block.text} editable={textEditable} onSave={(v) => onChange?.({ text: v })} multiline
        style={{ fontFamily: FONT.body, fontSize: SIZES[block.size || "md"], color: block.color || st.muted, lineHeight: 1.6, textAlign: block.align, maxWidth: block.maxWidth, margin: block.maxWidth && slideAlign === "center" ? "0 auto" : undefined, fontStyle: block.italic ? "italic" : "normal", fontWeight: block.bold ? 600 : 400, ...block.style }} />;

    case "bullets":
      return <div className={cls} style={{ display: "flex", flexDirection: "column", gap: block.gap || 8, ...block.style }}>{(block.items || []).map((item, i) =>
        <BulletItem key={i} item={item} index={i} block={block} editable={editable} onChange={onChange} st={st} SIZES={SIZES} staggerIdx={staggerIdx} fontScale={fontScale} presenting={presenting} pin={_pin} />
      )}
      {canEdit && <AddItem label="Add point" accent={st.accent} onAdd={() => addItemAt(block, onChange, newItemFor(block,"bullets"))} />}
      </div>;

    case "image":
      // _gridCell: this image is a cell in a multi-image grid — fill the cell and
      // letterbox (objectFit:contain) so mixed aspect ratios sit in uniform cells.
      return <ZoomWrap enabled={!!block.src && !block._solo} link={block.link} fill={!!block._gridCell}><div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: block.align === "left" ? "flex-start" : block.align === "right" ? "flex-end" : "center", ...(block._solo ? { flex: 1, width: "100%", justifyContent: "center" } : {}), ...(block._gridCell ? { flex: 1, minHeight: 0, width: "100%", height: "100%", justifyContent: "center", position: "relative" } : {}), ...block.style }}>
        {block.src ? <img src={block.src} alt={block.alt || ""} style={block._solo
          ? { width: "100%", height: "100%", objectFit: block.fit || "contain", borderRadius: 0 }
          : block._gridCell
          // Absolutely fill the grid cell so the row height is driven ONLY by the
          // grid track (minmax(0,1fr)), never by the image's intrinsic height. A
          // portrait/tall image therefore letterboxes (objectFit:contain) into the
          // uniform cell instead of ballooning the row off-canvas — and, critically,
          // it contributes 0 to the auto-height fit measurement, so a tall image no
          // longer forces an over-aggressive slide fit-scale.
          ? { position: "absolute", top: 0, left: 0, width: "100%", height: "100%", minHeight: 0, objectFit: block.fit || "contain", borderRadius: block.rounded ?? 8, boxShadow: block.shadow ? "0 8px 32px rgba(0,0,0,0.3)" : "none" }
          : { maxWidth: block.maxWidth || "100%", maxHeight: block.maxHeight || "100%", borderRadius: block.rounded ?? 8, objectFit: block.fit || "contain", boxShadow: block.shadow ? "0 8px 32px rgba(0,0,0,0.3)" : "none" }
        } /> : <div style={{ ...(block._gridCell ? { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" } : {}), padding: 32, color: st.textDim, fontFamily: FONT.mono, fontSize: 11 }}>Paste image (Ctrl+V)</div>}
        {block.caption && <EditableText text={block.caption} editable={textEditable} onSave={(v) => onChange?.({ caption: v })} style={{ fontFamily: FONT.body, fontSize: SIZES.sm, color: st.textDim, marginTop: 8, flexShrink: 0 }} />}
      </div></ZoomWrap>;

    case "code":
      return <CodeBlock block={block} cls={cls} st={st} editable={textEditable} onChange={onChange} SIZES={SIZES} />;

    case "grid":
      return <div className={cls} style={{ display: "grid", gridTemplateColumns: `repeat(${block.cols || 2}, 1fr)`, gap: block.gap || 24, ...block.style }}>{(block.items || []).map((cell, ci) => {
        const cellStyle = { display: "flex", flexDirection: cell.direction || "column", alignItems: cell.direction === "row" ? "center" : (cell.align ? ({ left: "flex-start", center: "center", right: "flex-end" }[cell.align] || cell.align) : "center"), gap: cell.direction === "row" ? 12 : 8 };
        if (cell.bg) { const c = cssColor(cell.bg); if (c) cellStyle.background = c; }
        if (cell.padding) cellStyle.padding = cell.padding;
        if (cell.borderRadius) cellStyle.borderRadius = cell.borderRadius;
        if (cell.border) cellStyle.border = cell.border;
        const safeStyle = cell.style && typeof cell.style === "object" && !Array.isArray(cell.style) ? cell.style : {};
        const cellLink = (cell.blocks || []).find(b => b.link)?.link;
        return <ItemChrome key={ci} editable={editable} presenting={presenting}
          wrapStyle={{ ...cellStyle, ...safeStyle }}
          link={cellLink} noLinkBadge linkLabel={cell.text || cell.value || cell.title}
          reorder={itemReorder(block, onChange, ci, _pin)}
          onDelete={onChange ? () => removeItemAt(block, onChange, ci) : undefined}
          anchor={{ top: 2, left: 2, right: "auto" }}>{(cell.blocks || []).map((b, bj) => <GridCellBlock key={bj} block={b} staggerIdx={staggerIdx + ci + bj} slideTheme={st} slideAlign={slideAlign} fontScale={fontScale} presenting={presenting}
        editable={editable}
        onChange={onChange ? (patch) => {
          const newItems = (block.items || []).map((c, i) => i === ci
            ? { ...c, blocks: (c.blocks || []).map((nb, j) => j === bj ? { ...nb, ...patch } : nb) }
            : c);
          onChange({ items: newItems });
        } : undefined}
      />)}</ItemChrome>; })}
      {canEdit && <AddItem variant="cell" label="Add card" accent={st.accent} onAdd={() => addItemAt(block, onChange, newItemFor(block,"grid"))} />}
      </div>;

    case "callout":
      return <CalloutBlock block={block} cls={cls} st={st} editable={textEditable} onChange={onChange} SIZES={SIZES} />;

    case "metric":
      return <div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: block.align === "left" ? "flex-start" : block.align === "right" ? "flex-end" : "center", ...block.style }}>
        <EditableIcon editable={textEditable} value={block.icon} size={28} onPick={(name) => onChange?.({ icon: name })}>
          {block.icon ? <div style={{ marginBottom: 8, display: "flex" }}>{getIcon(block.icon, { size: 28, color: block.iconColor || st.accent, strokeWidth: 1.5 })}</div> : null}
        </EditableIcon>
        <EditableText text={block.value} editable={textEditable} onSave={(v) => onChange?.({ value: v })} style={{ fontFamily: FONT.display, fontSize: SIZES[block.size || "4xl"], fontWeight: 800, color: block.color || st.accent, lineHeight: 1, letterSpacing: "-0.03em" }} />
        {block.label && <EditableText text={block.label} editable={textEditable} onSave={(v) => onChange?.({ label: v })} style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: block.labelColor || st.textDim, marginTop: 6, letterSpacing: "0.05em", textTransform: "uppercase" }} />}
      </div>;

    case "quote":
      return <div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", ...block.style }}>
        <EditableText text={block.text} editable={textEditable} onSave={(v) => onChange?.({ text: v })} multiline prefix={"\u201C"} suffix={"\u201D"}
          style={{ fontFamily: FONT.display, fontSize: SIZES[block.size || "xl"], fontWeight: 600, color: block.color || st.text, lineHeight: 1.4, fontStyle: "italic", maxWidth: "85%" }} />
        {block.author && <EditableText text={block.author} editable={textEditable} onSave={(v) => onChange?.({ author: v })} prefix={"\u2014 "}
          style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: st.accent, marginTop: 14, letterSpacing: "0.05em" }} />}
      </div>;

    case "divider": return <div className={cls} style={{ height: 1, background: cssColor(block.color) || st.border, margin: `${block.spacing || 12}px 0`, ...block.style }} />;
    case "spacer": return <div style={{ height: block.h || 24 }} />;

    case "svg": {
      let processed = block.markup || "";
      // Theme token injection
      const tokens = { "{{color}}": st.text || "#e2e8f0", "{{accent}}": st.accent || "#3b82f6", "{{bg}}": st.bg || "#0f172a", "{{muted}}": (st.muted || "#94a3b8") };
      for (const [tok, val] of Object.entries(tokens)) { while (processed.includes(tok)) processed = processed.replace(tok, val); }
      // Sanitize — defense-in-depth against SVG XSS vectors. Runs AFTER theme-token injection
      // so any token value is also vetted. DOM-based (same pipeline as study-notes/chat diagrams);
      // the prior regex chain let unquoted/obfuscated javascript: URIs through.
      processed = sanitizeSvgMarkup(processed);
      return <ZoomWrap enabled={!!block.markup} link={block.link}><div className={cls} style={{ maxWidth: block.maxWidth || "100%", margin: block.align === "center" ? "0 auto" : block.align === "right" ? "0 0 0 auto" : "0", background: cssColor(block.bg) || "transparent", padding: block.padding || "0", borderRadius: block.rounded ? 8 : 0, ...block.style }}>
        <div dangerouslySetInnerHTML={{ __html: processed }} style={{ display: "flex", justifyContent: "center" }} />
        {block.caption && <EditableText text={block.caption} editable={textEditable} onSave={(v) => onChange?.({ caption: v })} style={{ textAlign: "center", color: block.captionColor || st.muted, fontSize: SIZES[block.captionSize || "sm"], marginTop: 8, fontStyle: "italic", fontFamily: FONT.body }} />}
      </div></ZoomWrap>;
    }

    case "badge": {
      const badgeFontSize = SIZES[block.size || "xs"];
      // SIZES values are rem strings (e.g. "0.85rem"). Convert to a px number
      // for the icon-size / padding / gap math — arithmetic on the rem string
      // yields NaN (which React silently drops, collapsing the intended gap).
      const badgeFontPx = Math.round(parseFloat(badgeFontSize) * 16) || 14;
      const badgeIconSize = badgeFontPx;
      const badgePadV = Math.max(3, Math.round(badgeFontPx * 0.25));
      const badgePadH = Math.max(10, Math.round(badgeFontPx * 0.8));
      return <div className={cls} style={{ display: "inline-flex", alignItems: "center", gap: Math.round(badgeFontPx * 0.5), fontFamily: FONT.mono, fontSize: badgeFontSize, fontWeight: 700, color: block.color || st.accent, letterSpacing: "0.15em", textTransform: "uppercase", padding: block.bg ? `${badgePadV}px ${badgePadH}px` : 0, borderRadius: 4, background: cssColor(block.bg) || "transparent", border: block.border ? `1px solid ${block.border}` : "none", ...block.style }}>
        <EditableIcon editable={textEditable} value={block.icon} size={14} onPick={(name) => onChange?.({ icon: name })}>
          {block.icon ? <span style={{ display: "flex" }}>{getIcon(block.icon, { size: badgeIconSize, color: block.color || st.accent, strokeWidth: 2 })}</span> : null}
        </EditableIcon>
        <EditableText text={block.text} editable={textEditable} onSave={(v) => onChange?.({ text: v })} />
      </div>;
    }

    case "icon": {
      const sz = { sm: 20, md: 28, lg: 40, xl: 56 }[block.size || "md"] || 28;
      const iconEl = getIcon(block.name, { size: sz, color: block.color || st.accent, strokeWidth: block.strokeWidth || 1.5 });
      if (!iconEl && !textEditable) return <div className={cls} style={{ fontFamily: FONT.mono, fontSize: 10, color: st.textDim }}>⚠ {block.name}</div>;
      return <div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: block.align === "left" ? "flex-start" : block.align === "right" ? "flex-end" : "center", gap: 6, ...block.style }}>
        <EditableIcon editable={textEditable} value={block.name} size={sz} onPick={(name) => onChange?.({ name })}>
          {iconEl
            ? (block.circle !== false
              ? <IconBubble icon={block.name} size={sz} color={block.color || st.accent} bg={block.bg || `${block.color || st.accent}15`} strokeWidth={block.strokeWidth || 1.5} />
              : iconEl)
            : (block.name ? <div style={{ fontFamily: FONT.mono, fontSize: 10, color: st.textDim }}>⚠ {block.name}</div> : null)}
        </EditableIcon>
        {block.label && <EditableText text={block.label} editable={textEditable} onSave={(v) => onChange?.({ label: v })} style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: block.labelColor || st.textDim, letterSpacing: "0.03em", textAlign: "center" }} />}
      </div>;
    }

    case "icon-row": {
      const cols = block.cols || 1;
      const containerStyle = cols > 1
        ? { display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: block.gap || 14, ...block.style }
        : { display: "flex", flexDirection: "column", gap: block.gap || 14, ...block.style };
      return <div className={cls} style={containerStyle}>{(block.items || []).map((item, i) => (
        <IconRowItem key={i} item={item} index={i} block={block} editable={editable} onChange={onChange} st={st} SIZES={SIZES} staggerIdx={staggerIdx} presenting={presenting} pin={_pin} />
      ))}
      {canEdit && <AddItem label="Add item" accent={st.accent} style={cols > 1 ? { gridColumn: "1 / -1" } : undefined} onAdd={() => addItemAt(block, onChange, newItemFor(block,"icon-row"))} />}
      </div>;
    }

    case "flow": {
      const items = block.items || [];
      const isVert = block.direction === "vertical";
      const cStyle = block.connectorStyle || "arrow";
      const arrowCol = block.arrowColor || st.accent;
      const flowScale = { xs: 0.7, sm: 1, md: 1.2, lg: 1.4, xl: 1.7, "2xl": 2, "3xl": 2.4, "4xl": 2.8 }[block.labelSize || "sm"] || 1;
      const iconSz = Math.round(20 * flowScale);
      const arrowW = Math.round(24 * flowScale);
      const arrowH = Math.round(12 * flowScale);
      const arrowVW = Math.round(12 * flowScale);
      const arrowVH = Math.round(20 * flowScale);
      const iconH = iconSz * 1.8; // IconBubble rendered height
      const renderArrowSvg = () => {
        if (isVert) return cStyle === "dashed"
          ? <div style={{ width: 2, height: arrowVH, borderLeft: `2px dashed ${arrowCol}`, opacity: 0.5 }} />
          : <svg width={arrowVW} height={arrowVH} viewBox="0 0 12 20" fill="none"><path d={cStyle === "line" ? "M6 0 L6 20" : "M6 0 L6 16 M2 12 L6 18 L10 12"} stroke={arrowCol} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" /></svg>;
        return cStyle === "dashed"
          ? <div style={{ width: arrowW, height: 2, borderTop: `2px dashed ${arrowCol}`, opacity: 0.5 }} />
          : <svg width={arrowW} height={arrowH} viewBox="0 0 24 12" fill="none"><path d={cStyle === "line" ? "M0 6 L24 6" : "M0 6 L18 6 M14 2 L20 6 L14 10"} stroke={arrowCol} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" /></svg>;
      };
      const els = [];
      items.forEach((item, i) => {
        els.push(
          <ItemChrome key={`item-${i}`} editable={editable} presenting={presenting} className={stg(staggerIdx, i)}
            wrapStyle={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0, flex: isVert ? undefined : "1 1 0" }}
            link={itemLinkOf(item)} linkLabel={item.label}
            reorder={itemReorder(block, onChange, i, _pin)}
            onSetLink={onChange ? (url) => setItemLink(block, onChange, i, url) : undefined}
            onDelete={onChange ? () => removeItemAt(block, onChange, i) : undefined}>
            <EditableIcon editable={editable && !presenting} value={item.icon} size={iconSz} onPick={onChange ? (name) => patchItemAt(block, onChange, i, { icon: name }) : undefined}>
              {item.icon ? <IconBubble icon={item.icon} size={iconSz} color={item.iconColor || st.accent} bg={item.iconBg || block.iconBg || `${st.accent}15`} /> : null}
            </EditableIcon>
            <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="label" style={{ fontFamily: FONT.display, fontSize: SIZES[block.labelSize || "sm"], fontWeight: 600, color: item.labelColor || block.labelColor || st.text, textAlign: "center", lineHeight: 1.3 }} />
            {item.sublabel && <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="sublabel" style={{ fontFamily: FONT.body, fontSize: SIZES[block.sublabelSize || "xs"], color: block.sublabelColor || st.muted, textAlign: "center", lineHeight: 1.4 }} />}
          </ItemChrome>
        );
        if (i < items.length - 1) {
          const hasGate = item.gate;
          const gc = block.gateColor || st.accent;
          els.push(
            <div key={`conn-${i}`} style={{ display: "flex", flexDirection: isVert ? "column" : "row", alignItems: "center", justifyContent: "center", alignSelf: isVert ? "center" : "flex-start", height: isVert ? undefined : iconH, flexShrink: 0, gap: 2 }}>
              {hasGate && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px dashed ${gc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {getIcon(block.gateIcon || "UserCheck", { size: 10, color: gc })}
                </div>
                {block.gateLabel && <span style={{ position: "absolute", top: 24, fontSize: 7, color: gc, fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap" }}>{block.gateLabel}</span>}
              </div>}
              {renderArrowSvg()}
            </div>
          );
        }
      });
      const flowStyle = { display: "flex", flexDirection: isVert ? "column" : "row", alignItems: isVert ? "center" : "flex-start", justifyContent: "center", gap: 0, ...block.style };
      if (block.loop) { flowStyle.position = "relative"; flowStyle.paddingBottom = isVert ? 0 : 36; if (isVert) flowStyle.paddingRight = 36; }
      const loopCol = block.loopColor || `${arrowCol}80`;
      const loopDash = block.loopStyle === "dotted" ? "2,4" : block.loopStyle === "solid" ? "none" : "6,4";
      return <><ZoomWrap enabled={items.length > 0} link={block.link}><div className={cls} style={flowStyle}>
        {els}
        {block.loop && !isVert && <svg style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 36, width: "100%", overflow: "visible" }}>
          <defs><marker id={`loopArr-${staggerIdx}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={loopCol} /></marker></defs>
          {(() => { const n = items.length; const step = 100 / (n * 2); const x1 = step; const x2 = 100 - step; return <>
            <line x1={`${x2}%`} y1="4" x2={`${x2}%`} y2="20" stroke={loopCol} strokeWidth="1.5" strokeDasharray={loopDash} strokeLinecap="round" />
            <line x1={`${x2}%`} y1="20" x2={`${x1}%`} y2="20" stroke={loopCol} strokeWidth="1.5" strokeDasharray={loopDash} strokeLinecap="round" />
            <line x1={`${x1}%`} y1="20" x2={`${x1}%`} y2="4" stroke={loopCol} strokeWidth="1.5" strokeDasharray={loopDash} strokeLinecap="round" markerEnd={`url(#loopArr-${staggerIdx})`} />
            {block.loopLabel && <text x="50%" y="32" textAnchor="middle" fill={loopCol} fontSize="10" fontFamily="monospace" style={{ fontStyle: "italic" }}>{block.loopLabel}</text>}
          </>; })()}
        </svg>}
        {block.loop && isVert && <svg style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 36, height: "100%", overflow: "visible" }}>
          <defs><marker id={`loopArrV-${staggerIdx}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={loopCol} /></marker></defs>
          {(() => { const n = items.length; const step = 100 / (n * 2); const y1 = step; const y2 = 100 - step; return <>
            <line x1="4" y1={`${y2}%`} x2="20" y2={`${y2}%`} stroke={loopCol} strokeWidth="1.5" strokeDasharray={loopDash} strokeLinecap="round" />
            <line x1="20" y1={`${y2}%`} x2="20" y2={`${y1}%`} stroke={loopCol} strokeWidth="1.5" strokeDasharray={loopDash} strokeLinecap="round" />
            <line x1="20" y1={`${y1}%`} x2="4" y2={`${y1}%`} stroke={loopCol} strokeWidth="1.5" strokeDasharray={loopDash} strokeLinecap="round" markerEnd={`url(#loopArrV-${staggerIdx})`} />
            {block.loopLabel && <text x="28" y="50%" textAnchor="middle" fill={loopCol} fontSize="10" fontFamily="monospace" style={{ fontStyle: "italic" }} transform={`rotate(90, 28, 50%)`} dominantBaseline="middle">{block.loopLabel}</text>}
          </>; })()}
        </svg>}
      </div></ZoomWrap>
      {canEdit && <AddItem label="Add step" accent={st.accent} style={{ marginTop: 8 }} onAdd={() => addItemAt(block, onChange, newItemFor(block,"flow"))} />}
      </>;
    }

    case "table": {
      const headers = block.headers || [];
      const rows = block.rows || [];
      const cols = headers.length || (rows[0] || []).length || 1;
      const hdrBg = cssColor(block.headerBg) || `${st.accent}20`;
      const hdrColor = block.headerColor || (block.headerBg ? "#fff" : st.accent);
      const cellColor = block.cellColor || st.muted;
      const brdColor = block.borderColor || st.border;
      return <div className={cls} style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${brdColor}`, ...block.style }}>
        {headers.length > 0 && <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, background: hdrBg }}>
          {headers.map((h, hi) => <EditableText key={hi} text={h} editable={textEditable} onSave={(v) => {
            const nh = [...headers]; nh[hi] = v; onChange?.({ headers: nh });
          }} style={{ padding: "10px 14px", fontFamily: FONT.mono, fontSize: SIZES[block.size || "xs"], fontWeight: 700, color: hdrColor, letterSpacing: "0.03em", textTransform: "uppercase", borderRight: hi < cols - 1 ? `1px solid ${brdColor}` : "none" }} />)}
        </div>}
        {rows.map((row, ri) => <div key={ri} className={stg(staggerIdx, ri + 1)} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, background: block.striped && ri % 2 === 1 ? `${st.accent}08` : "transparent", borderTop: `1px solid ${brdColor}` }}>
          {(row || []).map((cell, ci) => <EditableText key={ci} text={String(cell)} editable={textEditable} onSave={(v) => {
            const nr = rows.map((r, i) => i === ri ? r.map((c, j) => j === ci ? v : c) : r);
            onChange?.({ rows: nr });
          }} style={{ padding: "9px 14px", fontFamily: FONT.body, fontSize: SIZES[block.size || "sm"], color: ci === 0 ? st.text : cellColor, fontWeight: ci === 0 ? 500 : 400, lineHeight: 1.5, borderRight: ci < cols - 1 ? `1px solid ${brdColor}` : "none" }} />)}
        </div>)}
        {canEdit && <AddItem label="Add row" accent={st.accent} style={{ borderRadius: 0, border: "none", borderTop: `1px solid ${brdColor}` }} onAdd={() => onChange({ rows: [...rows, Array.from({ length: cols }, (_, j) => j === 0 ? "New row" : "Value")] })} />}
      </div>;
    }

    case "progress": {
      const items = block.items || (block.value != null ? [{ value: block.value, label: block.label, color: block.color }] : []);
      const hasItems = Array.isArray(block.items);
      const trackCol = cssColor(block.trackColor) || `${st.accent}15`;
      const barH = block.height || 8;
      const labelColor = block.labelColor || st.muted;
      return <div className={cls} style={{ display: "flex", flexDirection: "column", gap: block.gap || 14, ...block.style }}>
        {(block.leftLabel || block.rightLabel) && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: -6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <EditableIcon editable={editable && !presenting} value={block.leftIcon} size={14} onPick={(name) => onChange?.({ leftIcon: name || undefined })}>{block.leftIcon ? getIcon(block.leftIcon, { size: 14, color: labelColor }) : null}</EditableIcon>
              {block.leftLabel && <span style={{ fontSize: 11, fontWeight: 600, color: labelColor }}>{block.leftLabel}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {block.rightLabel && <span style={{ fontSize: 11, fontWeight: 600, color: labelColor }}>{block.rightLabel}</span>}
              <EditableIcon editable={editable && !presenting} value={block.rightIcon} size={14} onPick={(name) => onChange?.({ rightIcon: name || undefined })}>{block.rightIcon ? getIcon(block.rightIcon, { size: 14, color: labelColor }) : null}</EditableIcon>
            </div>
          </div>
        )}
        {items.map((item, i) => {
          const val = Math.max(0, Math.min(item.value || 0, 100));
          const col = cssColor(item.color) || st.accent;
          return <ItemChrome key={i} editable={editable} presenting={presenting} className={stg(staggerIdx, i)}
            wrapStyle={{ display: "flex", flexDirection: "column", gap: 5 }}
            link={itemLinkOf(item)} linkLabel={item.label}
            reorder={hasItems ? itemReorder(block, onChange, i, _pin) : undefined}
            onSetLink={hasItems && onChange ? (url) => setItemLink(block, onChange, i, url) : undefined}
            onDelete={hasItems && onChange ? () => removeItemAt(block, onChange, i) : undefined}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="label" style={{ fontFamily: FONT.display, fontSize: SIZES[block.size || "sm"], fontWeight: 500, color: block.labelColor || st.text }} />
              {block.showValue !== false && <span style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: col, fontWeight: 700 }}>{val}%</span>}
            </div>
            <div style={{ width: "100%", height: barH, borderRadius: barH / 2, background: trackCol, overflow: "hidden" }}>
              <div style={{ width: `${val}%`, height: "100%", borderRadius: barH / 2, background: col, transition: "width 0.6s ease" }} />
            </div>
          </ItemChrome>;
        })}
        {canEdit && hasItems && <AddItem label="Add bar" accent={st.accent} onAdd={() => addItemAt(block, onChange, newItemFor(block,"progress"))} />}
        {block.annotation && (
          <div style={{ textAlign: "center", marginTop: -4, fontSize: 11, fontStyle: "italic", color: block.annotationColor || "#94a3b8" }}>
            {block.annotation}
          </div>
        )}
      </div>;
    }

    case "steps": {
      const items = block.items || [];
      const lineCol = cssColor(block.lineColor) || `${st.accent}40`;
      const active = typeof block.activeStep === "number" ? block.activeStep : items.length;
      return <div className={cls} style={{ display: "flex", flexDirection: "column", gap: 0, ...block.style }}>
        {items.map((item, i) => {
          const isActive = i < active;
          const dotCol = isActive ? (cssColor(block.numberColor) || st.accent) : `${st.textDim}60`;
          return <ItemChrome key={i} editable={editable} presenting={presenting} className={stg(staggerIdx, i)}
            wrapStyle={{ display: "flex", gap: 16, alignItems: "flex-start", paddingBottom: i < items.length - 1 ? 20 : 0 }}
            link={itemLinkOf(item)} linkLabel={item.title}
            reorder={itemReorder(block, onChange, i, _pin)}
            onSetLink={onChange ? (url) => setItemLink(block, onChange, i, url) : undefined}
            onDelete={onChange ? () => removeItemAt(block, onChange, i) : undefined}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 28 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: isActive ? dotCol : "transparent", border: `2px solid ${dotCol}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: isActive ? "#fff" : st.textDim, flexShrink: 0, zIndex: 1 }}>{i + 1}</div>
              {i < items.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 16, background: lineCol, marginTop: 4 }} />}
            </div>
            <div style={{ flex: 1, paddingTop: 3 }}>
              <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="title" style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "md"], fontWeight: 600, color: block.titleColor || st.text, lineHeight: 1.3 }} />
              {item.text && <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="text" style={{ fontFamily: FONT.body, fontSize: SIZES[block.textSize || "sm"], color: block.textColor || st.muted, lineHeight: 1.5, marginTop: 3 }} />}
            </div>
          </ItemChrome>;
        })}
        {canEdit && <AddItem label="Add step" accent={st.accent} onAdd={() => addItemAt(block, onChange, newItemFor(block,"steps"))} />}
      </div>;
    }

    case "tag-group": {
      const items = block.items || [];
      const variant = block.variant || "filled";
      return <div className={cls} style={{ display: "flex", flexWrap: "wrap", gap: block.gap || 8, ...block.style }}>
        {items.map((item, i) => {
          const col = cssColor(item.color) || st.accent;
          const vs = variant === "outline"
            ? { background: "transparent", border: `1px solid ${col}`, color: col }
            : variant === "subtle"
              ? { background: `${col}15`, border: "1px solid transparent", color: col }
              : { background: col, border: "1px solid transparent", color: "#fff" };
          return <ItemChrome key={i} editable={editable} presenting={presenting} className={stg(staggerIdx, i)}
            wrapStyle={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 20, fontFamily: FONT.mono, fontSize: SIZES[block.size || "xs"], fontWeight: 600, letterSpacing: "0.02em", ...vs, ...(item.style && typeof item.style === "object" && !Array.isArray(item.style) ? item.style : {}) }}
            link={itemLinkOf(item)} linkLabel={item.text}
            reorder={itemReorder(block, onChange, i, _pin)}
            onSetLink={onChange ? (url) => setItemLink(block, onChange, i, url) : undefined}
            onDelete={onChange ? () => removeItemAt(block, onChange, i) : undefined}>
            <EditableIcon editable={editable && !presenting} value={item.icon} size={12} onPick={onChange ? (name) => patchItemAt(block, onChange, i, { icon: name }) : undefined}>
              {item.icon ? <span style={{ display: "flex", flexShrink: 0 }}>{getIcon(item.icon, { size: 12, color: variant === "filled" ? "#fff" : col, strokeWidth: 2 })}</span> : null}
            </EditableIcon>
            <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="text" />
          </ItemChrome>;
        })}
        {canEdit && <AddItem variant="chip" label="Add" accent={st.accent} onAdd={() => addItemAt(block, onChange, newItemFor(block,"tag-group"))} />}
      </div>;
    }

    case "timeline": {
      const items = block.items || [];
      const isVert = block.direction === "vertical";
      const lineCol = cssColor(block.lineColor) || `${st.accent}40`;
      const dotCol = cssColor(block.dotColor) || st.accent;

      if (isVert) {
        return <div className={cls} style={{ display: "flex", flexDirection: "column", gap: 0, ...block.style }}>
          {items.map((item, i) => (
            <ItemChrome key={i} editable={editable} presenting={presenting} className={stg(staggerIdx, i)}
              wrapStyle={{ display: "flex", gap: 16, alignItems: "flex-start", paddingBottom: i < items.length - 1 ? 24 : 0 }}
              link={itemLinkOf(item)} linkLabel={item.title}
              reorder={itemReorder(block, onChange, i, _pin)}
              onSetLink={onChange ? (url) => setItemLink(block, onChange, i, url) : undefined}
              onDelete={onChange ? () => removeItemAt(block, onChange, i) : undefined}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 14 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: dotCol, border: `2px solid ${dotCol}`, flexShrink: 0, zIndex: 1, marginTop: 4 }} />
                {i < items.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 20, background: lineCol, marginTop: 4 }} />}
              </div>
              <div style={{ flex: 1 }}>
                {item.date && <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="date" style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: block.dateColor || st.accent, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3 }} />}
                <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="title" style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "md"], fontWeight: 600, color: block.titleColor || st.text, lineHeight: 1.3 }} />
                {item.text && <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="text" style={{ fontFamily: FONT.body, fontSize: SIZES[block.textSize || "sm"], color: block.textColor || st.muted, lineHeight: 1.5, marginTop: 3 }} />}
              </div>
            </ItemChrome>
          ))}
          {canEdit && <AddItem label="Add event" accent={st.accent} onAdd={() => addItemAt(block, onChange, newItemFor(block,"timeline"))} />}
        </div>;
      }

      // Horizontal timeline
      return <div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: "stretch", ...block.style }}>
        <div style={{ display: "flex", alignItems: "flex-start", position: "relative" }}>
          <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 2, background: lineCol }} />
          {items.map((item, i) => (
            <ItemChrome key={i} editable={editable} presenting={presenting} className={stg(staggerIdx, i)}
              wrapStyle={{ flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}
              link={itemLinkOf(item)} linkLabel={item.title}
              reorder={itemReorder(block, onChange, i, _pin)}
              onSetLink={onChange ? (url) => setItemLink(block, onChange, i, url) : undefined}
              onDelete={onChange ? () => removeItemAt(block, onChange, i) : undefined}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: dotCol, flexShrink: 0, zIndex: 1, marginBottom: 10 }} />
              {item.date && <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="date" style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: block.dateColor || st.accent, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "center", marginBottom: 4 }} />}
              <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="title" style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "sm"], fontWeight: 600, color: block.titleColor || st.text, textAlign: "center", lineHeight: 1.3 }} />
              {item.text && <ItemText block={block} onChange={onChange} editable={textEditable} idx={i} prop="text" style={{ fontFamily: FONT.body, fontSize: SIZES.xs, color: block.textColor || st.muted, textAlign: "center", lineHeight: 1.4, marginTop: 3 }} />}
            </ItemChrome>
          ))}
        </div>
        {canEdit && <AddItem label="Add event" accent={st.accent} style={{ marginTop: 8 }} onAdd={() => addItemAt(block, onChange, newItemFor(block,"timeline"))} />}
      </div>;
    }

    case "comparison": {
      const items = block.items || [];
      const left = items[0] || {};
      const right = items[1] || {};
      const leftColor = cssColor(left.color) || "#ef4444";
      const rightColor = cssColor(right.color) || "#22c55e";
      const dividerLabel = block.dividerLabel || "VS";
      // Per-point delete/link, nested in items[side].items
      const deletePoint = (side, pi) => onChange?.({ items: items.map((col, k) => k === side ? { ...col, items: (col.items || []).filter((_, j) => j !== pi) } : col) });
      const linkPoint = (side, pi, url) => onChange?.({ items: items.map((col, k) => k !== side ? col : { ...col, items: (col.items || []).map((p, j) => {
        if (j !== pi) return p;
        const base = typeof p === "string" ? { text: p } : { ...p };
        if (url) base.link = url; else delete base.link;
        return base;
      }) }) });
      const addPoint = (side) => {
        const cols = [{ ...left }, { ...right }];
        const prev = cols[side].items || [];
        cols[side] = { ...cols[side], items: [...prev, clonePoint(prev[prev.length - 1])] };
        onChange?.({ items: cols });
      };
      const movePoint = (side, pi, dir) => onChange?.({ items: items.map((col, k) => {
        if (k !== side) return col;
        const pts = [...(col.items || [])];
        const t = dir === "up" ? pi - 1 : pi + 1;
        if (t < 0 || t >= pts.length) return col;
        [pts[pi], pts[t]] = [pts[t], pts[pi]];
        return { ...col, items: pts };
      }) });
      const pointReorder = (side, pts, pi) => (onChange && (pts || []).length > 1)
        ? reorderCtl(pts.length, pi, (dir) => movePoint(side, pi, dir), (k) => `c${side}_${k}`, _pin) : undefined;
      return <div className={cls} style={{ display: "flex", gap: 0, flex: 1, alignItems: "stretch", ...block.style }}>
        <div style={{ flex: 1, background: `${leftColor}08`, border: `1px solid ${leftColor}30`, borderRadius: "12px 0 0 12px", padding: "20px 22px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <EditableIcon editable={editable && !presenting} value={left.icon} size={18} onPick={onChange ? (name) => onChange({ items: items.map((c, k) => k === 0 ? { ...c, icon: name || undefined } : c) }) : undefined}>
                {left.icon ? <IconBubble icon={left.icon} size={18} color={leftColor} bg={`${leftColor}15`} /> : null}
              </EditableIcon>
              <span style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "md"], fontWeight: 700, color: `${leftColor}cc` }}>{left.title || "A"}</span>
            </div>
            {(left.items || []).map((pt, pi) => (
              <ItemChrome key={pi} editable={editable} presenting={presenting}
                wrapStyle={{ display: "flex", alignItems: "start", gap: 8, fontSize: SIZES[block.size || "sm"], fontFamily: FONT.body, color: st.text, lineHeight: 1.5 }}
                link={itemLinkOf(pt)} linkLabel={typeof pt === "string" ? pt : pt.text}
                reorder={pointReorder(0, left.items, pi)}
                onSetLink={onChange ? (url) => linkPoint(0, pi, url) : undefined}
                onDelete={onChange ? () => deletePoint(0, pi) : undefined}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: leftColor, flexShrink: 0, marginTop: 7 }} />
                <span>{typeof pt === "string" ? pt : pt.text || ""}</span>
              </ItemChrome>
            ))}
            {canEdit && <AddItem variant="chip" label="Add point" accent={leftColor} onAdd={() => addPoint(0)} />}
          </div>
        </div>
        {block.hideDivider ? null : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, margin: "0 -18px" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: st.bg || "#1e293b", border: `2px solid ${st.border || "#475569"}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: st.muted }}>{dividerLabel}</div>
        </div>}
        <div style={{ flex: 1, background: `${rightColor}08`, border: `1px solid ${rightColor}30`, borderRadius: "0 12px 12px 0", padding: "20px 22px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <EditableIcon editable={editable && !presenting} value={right.icon} size={18} onPick={onChange ? (name) => onChange({ items: items.map((c, k) => k === 1 ? { ...c, icon: name || undefined } : c) }) : undefined}>
                {right.icon ? <IconBubble icon={right.icon} size={18} color={rightColor} bg={`${rightColor}15`} /> : null}
              </EditableIcon>
              <span style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "md"], fontWeight: 700, color: `${rightColor}cc` }}>{right.title || "B"}</span>
            </div>
            {(right.items || []).map((pt, pi) => (
              <ItemChrome key={pi} editable={editable} presenting={presenting}
                wrapStyle={{ display: "flex", alignItems: "start", gap: 8, fontSize: SIZES[block.size || "sm"], fontFamily: FONT.body, color: st.text, lineHeight: 1.5 }}
                link={itemLinkOf(pt)} linkLabel={typeof pt === "string" ? pt : pt.text}
                reorder={pointReorder(1, right.items, pi)}
                onSetLink={onChange ? (url) => linkPoint(1, pi, url) : undefined}
                onDelete={onChange ? () => deletePoint(1, pi) : undefined}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: rightColor, flexShrink: 0, marginTop: 7 }} />
                <span>{typeof pt === "string" ? pt : pt.text || ""}</span>
              </ItemChrome>
            ))}
            {canEdit && <AddItem variant="chip" label="Add point" accent={rightColor} onAdd={() => addPoint(1)} />}
          </div>
        </div>
      </div>;
    }

    case "funnel": {
      const items = block.items || [];
      const count = items.length || 1;
      const stageH = Math.floor(280 / count);
      const gap = 4;
      return <><ZoomWrap enabled={items.length > 0} link={block.link}><div className={cls} style={{ width: "100%", ...block.style }}>
        <svg viewBox={`0 0 700 ${count * (stageH + gap)}`} style={{ width: "100%", maxWidth: 700 }} xmlns="http://www.w3.org/2000/svg">
          {items.map((item, i) => {
            const col = cssColor(item.color) || st.accent;
            const inset = (i / count) * 250;
            const nextInset = ((i + 1) / count) * 250;
            const y = i * (stageH + gap);
            const x1 = 30 + inset, x2 = 670 - inset;
            const x3 = 30 + nextInset, x4 = 670 - nextInset;
            const isHighlight = item.highlight;
            return <g key={i} className={stg(staggerIdx, i)}>
              <polygon points={`${x1},${y} ${x2},${y} ${x4},${y + stageH} ${x3},${y + stageH}`}
                fill={`${col}${isHighlight ? "22" : "18"}`} stroke={`${col}80`} strokeWidth={isHighlight ? 2 : 1.5}
                strokeDasharray={isHighlight ? "8,4" : "none"} />
              <text x="350" y={y + stageH * 0.38} textAnchor="middle" fill={`${col}dd`}
                fontSize="14" fontWeight="600" fontFamily="Inter, sans-serif">{item.label || ""}{isHighlight ? " \u26A0" : ""}</text>
              {item.value && <text x="350" y={y + stageH * 0.72} textAnchor="middle" fill={col}
                fontSize="20" fontWeight="800" fontFamily="Inter, sans-serif">{item.value}</text>}
              {item.drop && <text x={x4 + 16} y={y + stageH * 0.55} textAnchor="start" fill={isHighlight ? col : st.muted}
                fontSize="12" fontWeight={isHighlight ? 700 : 400} fontFamily="Inter, sans-serif">{item.drop}</text>}
            </g>;
          })}
        </svg>
      </div></ZoomWrap>
      {canEdit && <AddItem label="Add stage" accent={st.accent} style={{ marginTop: 8 }} onAdd={() => addItemAt(block, onChange, newItemFor(block,"funnel"))} />}
      </>;
    }

    case "cycle": {
      const items = block.items || [];
      const n = items.length || 1;
      const cx = 260, cy = 200, radius = 130;
      const nodeR = 40;
      const defaultColors = ["#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#ec4899", "#06b6d4", "#f59e0b"];
      return <><ZoomWrap enabled={items.length > 0} link={block.link}><div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", ...block.style }}>
        <svg viewBox={`0 0 520 ${cy * 2 + 40}`} style={{ width: "100%", maxWidth: 520 }} xmlns="http://www.w3.org/2000/svg">
          <defs>
            {items.map((_, i) => {
              const col = cssColor(items[i]?.color) || defaultColors[i % defaultColors.length];
              return <marker key={`m${i}`} id={`cyc-arr-${staggerIdx}-${i}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill={col} />
              </marker>;
            })}
          </defs>
          {block.centerLabel && <>
            <text x={cx} y={cy - 8} textAnchor="middle" fill={st.border || "#475569"} fontSize="16" fontWeight="700" fontFamily="Inter, sans-serif" letterSpacing="3">{block.centerLabel}</text>
            {block.centerSub && <text x={cx} y={cy + 14} textAnchor="middle" fill={st.muted} fontSize="13" fontFamily="Inter, sans-serif">{block.centerSub}</text>}
          </>}
          {items.map((item, i) => {
            const angle = (2 * Math.PI * i / n) - Math.PI / 2;
            const nextAngle = (2 * Math.PI * ((i + 1) % n) / n) - Math.PI / 2;
            const col = cssColor(item.color) || defaultColors[i % defaultColors.length];
            const nx = cx + radius * Math.cos(angle);
            const ny = cy + radius * Math.sin(angle);
            const nextNx = cx + radius * Math.cos(nextAngle);
            const nextNy = cy + radius * Math.sin(nextAngle);
            const arcR = radius + 18;
            const gap = Math.asin(nodeR / radius) + 0.08;
            const startA = angle + gap;
            const endA = nextAngle - gap - 0.06;
            const startX = cx + arcR * Math.cos(startA);
            const startY = cy + arcR * Math.sin(startA);
            const endX = cx + arcR * Math.cos(endA);
            const endY = cy + arcR * Math.sin(endA);
            return <g key={i} className={stg(staggerIdx, i)}>
              <path d={`M ${startX} ${startY} A ${arcR} ${arcR} 0 0 1 ${endX} ${endY}`}
                fill="none" stroke={col} strokeWidth="2.5" strokeOpacity="0.6"
                markerEnd={`url(#cyc-arr-${staggerIdx}-${i})`} />
              <circle cx={nx} cy={ny} r={nodeR} fill={`${col}15`} stroke={col} strokeWidth="2.5" />
              {item.icon && <text x={nx} y={ny - 6} textAnchor="middle" fontSize="18" fontFamily="Inter, sans-serif">{item.icon}</text>}
              <text x={nx} y={ny + (item.icon ? 14 : 5)} textAnchor="middle" fill={`${col}dd`}
                fontSize="12" fontWeight="700" fontFamily="Inter, sans-serif">{item.label || ""}</text>
            </g>;
          })}
        </svg>
      </div></ZoomWrap>
      {canEdit && <AddItem label="Add node" accent={st.accent} style={{ marginTop: 8 }} onAdd={() => addItemAt(block, onChange, newItemFor(block,"cycle"))} />}
      </>;
    }

    case "number-row": {
      const items = block.items || [];
      const showIcons = block.showIcons !== false;
      return <><div className={cls} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, width: "100%", ...(block.bordered ? { background: `${st.text}05`, border: `1px solid ${st.border}`, borderRadius: 12, padding: "20px 0" } : {}), ...block.style }}>
        {items.map((item, i) => {
          const col = cssColor(item.color) || st.accent;
          return <React.Fragment key={i}>
            {i > 0 && <div style={{ width: 1, height: block.compact ? 56 : 80, background: st.border || "#334155", flexShrink: 0 }} />}
            <ItemChrome editable={editable} presenting={presenting} className={stg(staggerIdx, i)}
              wrapStyle={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: block.compact ? "16px 12px" : "24px 16px" }}
              link={itemLinkOf(item)} linkLabel={item.label}
              reorder={itemReorder(block, onChange, i, _pin)}
              onSetLink={onChange ? (url) => setItemLink(block, onChange, i, url) : undefined}
              onDelete={onChange ? () => removeItemAt(block, onChange, i) : undefined}>
              {showIcons && <EditableIcon editable={editable && !presenting} value={item.icon} size={20} onPick={onChange ? (name) => patchItemAt(block, onChange, i, { icon: name }) : undefined}>
                {item.icon ? <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${col}12`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {getIcon(item.icon, { size: 20, color: col, strokeWidth: 2 })}
                </div> : null}
              </EditableIcon>}
              <div style={{ fontFamily: FONT.display, fontSize: SIZES[block.size || (block.compact ? "2xl" : "3xl")], fontWeight: 800, color: col, lineHeight: 1 }}>{item.value || ""}</div>
              {item.label && <div style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: st.muted }}>{item.label}</div>}
            </ItemChrome>
          </React.Fragment>;
        })}
      </div>
      {canEdit && <AddItem label="Add stat" accent={st.accent} style={{ marginTop: 8 }} onAdd={() => addItemAt(block, onChange, newItemFor(block,"number-row"))} />}
      </>;
    }

    case "matrix": {
      const quadrants = block.quadrants || block.items || [];
      const q = (i) => quadrants[i] || {};
      const xLeft = block.xLeft || "";
      const xRight = block.xRight || "";
      const yTop = block.yTop || "";
      const yBottom = block.yBottom || "";
      const defaultQColors = ["#22c55e", "#3b82f6", "#f97316", "#ef4444"];
      const hasY = yTop || yBottom;
      const yLabelStyle = { fontFamily: FONT.mono, fontSize: SIZES.xs, fontWeight: 600, color: st.muted, letterSpacing: "0.08em", transform: "rotate(-90deg)", whiteSpace: "nowrap" };
      // Per-point delete/link, nested in quadrants[qi].items[pi]
      const qKey = block.quadrants ? "quadrants" : "items";
      const deleteQPoint = (qi, pi) => onChange?.({ [qKey]: quadrants.map((qq, k) => k === qi ? { ...qq, items: (qq.items || []).filter((_, j) => j !== pi) } : qq) });
      const linkQPoint = (qi, pi, url) => onChange?.({ [qKey]: quadrants.map((qq, k) => k !== qi ? qq : { ...qq, items: (qq.items || []).map((p, j) => {
        if (j !== pi) return p;
        const base = typeof p === "string" ? { text: p } : { ...p };
        if (url) base.link = url; else delete base.link;
        return base;
      }) }) });
      const addQPoint = (qi) => onChange?.({ [qKey]: [0, 1, 2, 3].map((k) => {
        const qq = quadrants[k] || {};
        if (k !== qi) return qq;
        const prev = qq.items || [];
        return { ...qq, items: [...prev, clonePoint(prev[prev.length - 1])] };
      }) });
      const moveQPoint = (qi, pi, dir) => onChange?.({ [qKey]: quadrants.map((qq, k) => {
        if (k !== qi) return qq;
        const pts = [...(qq.items || [])];
        const t = dir === "up" ? pi - 1 : pi + 1;
        if (t < 0 || t >= pts.length) return qq;
        [pts[pi], pts[t]] = [pts[t], pts[pi]];
        return { ...qq, items: pts };
      }) });
      const qPointReorder = (qi, pts, pi) => (onChange && (pts || []).length > 1)
        ? reorderCtl(pts.length, pi, (dir) => moveQPoint(qi, pi, dir), (k) => `q${qi}_${k}`, _pin) : undefined;
      const renderRow = (indices, radii, yLabel) => (
        <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
          {hasY && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, flexShrink: 0 }}>
            {yLabel && <span style={yLabelStyle}>{yLabel}</span>}
          </div>}
          <div style={{ display: "flex", gap: 6, flex: 1 }}>
            {indices.map((qi) => {
              const qd = q(qi);
              const qc = cssColor(qd.color) || defaultQColors[qi];
              return <div key={qi} className={stg(staggerIdx, qi)} style={{ flex: 1, background: `${qc}0a`, border: `1px solid ${qc}30`, borderRadius: radii[qi - indices[0]], padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <EditableIcon editable={editable && !presenting} value={qd.icon} size={16} onPick={onChange ? (name) => onChange({ [qKey]: quadrants.map((qq, k) => k === qi ? { ...qq, icon: name || undefined } : qq) }) : undefined}>
                    {qd.icon ? <span style={{ display: "flex" }}>{getIcon(qd.icon, { size: 16, color: qc, strokeWidth: 2 })}</span> : null}
                  </EditableIcon>
                  <span style={{ fontFamily: FONT.display, fontSize: SIZES.sm, fontWeight: 700, color: `${qc}cc` }}>{qd.title || ""}</span>
                </div>
                {(qd.items || []).map((pt, pi) => (
                  <ItemChrome key={pi} editable={editable} presenting={presenting}
                    wrapStyle={{ fontSize: SIZES.xs, fontFamily: FONT.body, color: st.text, marginBottom: 6, display: "flex", gap: 6 }}
                    link={itemLinkOf(pt)} linkLabel={typeof pt === "string" ? pt : pt.text}
                    reorder={qPointReorder(qi, qd.items, pi)}
                    onSetLink={onChange ? (url) => linkQPoint(qi, pi, url) : undefined}
                    onDelete={onChange ? () => deleteQPoint(qi, pi) : undefined}>
                    <span style={{ color: qc }}>•</span> {typeof pt === "string" ? pt : pt.text || ""}
                  </ItemChrome>
                ))}
                {canEdit && <AddItem variant="chip" label="Add point" accent={qc} style={{ marginTop: 4 }} onAdd={() => addQPoint(qi)} />}
              </div>;
            })}
          </div>
        </div>
      );
      return <div className={cls} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", ...block.style }}>
          {(xLeft || xRight) && <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 8, paddingLeft: hasY ? 24 : 0, padding: "0 20px" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, fontWeight: 600, color: st.muted, letterSpacing: "0.08em" }}>{xLeft}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, fontWeight: 600, color: st.muted, letterSpacing: "0.08em" }}>{xRight}</span>
          </div>}
          {renderRow([0, 1], ["10px 4px 4px 4px", "4px 10px 4px 4px"], yTop)}
          <div style={{ height: 6 }} />
          {renderRow([2, 3], ["4px 4px 4px 10px", "4px 4px 10px 4px"], yBottom)}
      </div>;
    }

    case "checklist": {
      const items = block.items || [];
      const statusConfig = {
        done: { bg: "#22c55e", icon: "Check", label: "DONE", textColor: st.text },
        partial: { bg: "#f59e0b", icon: null, label: "IN PROGRESS", textColor: st.text },
        pending: { bg: "transparent", icon: null, label: "PENDING", textColor: st.muted },
        blocked: { bg: `#ef444425`, icon: "X", label: "BLOCKED", textColor: "#fca5a5" },
      };
      return <div className={cls} style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", ...block.style }}>
        {items.map((item, i) => {
          const status = item.status || "pending";
          const cfg = statusConfig[status] || statusConfig.pending;
          const labelColor = status === "done" ? "#22c55e" : status === "partial" ? "#f59e0b" : status === "blocked" ? "#ef4444" : st.muted;
          return <ItemChrome key={i} editable={editable} presenting={presenting} className={stg(staggerIdx, i)}
            wrapStyle={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: `${labelColor}08`, borderRadius: 8 }}
            link={itemLinkOf(item)} linkLabel={typeof item === "string" ? item : item.text}
            reorder={itemReorder(block, onChange, i, _pin)}
            onSetLink={onChange ? (url) => setItemLink(block, onChange, i, url) : undefined}
            onDelete={onChange ? () => removeItemAt(block, onChange, i) : undefined}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: status === "done" ? cfg.bg : status === "blocked" ? cfg.bg : "transparent", border: status === "pending" ? `2px solid ${st.muted}` : status === "partial" ? `2px solid #f59e0b` : "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative", overflow: "hidden" }}>
              {status === "partial" && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", background: "#f59e0b" }} />}
              {cfg.icon && <span style={{ display: "flex", zIndex: 1 }}>{getIcon(cfg.icon, { size: 12, color: status === "done" ? "#fff" : "#ef4444", strokeWidth: 3 })}</span>}
            </div>
            <span style={{ fontFamily: FONT.body, fontSize: SIZES[block.size || "sm"], color: cfg.textColor, flex: 1 }}>{typeof item === "string" ? item : item.text || ""}</span>
            {block.showLabels !== false && <span style={{ marginLeft: "auto", fontFamily: FONT.mono, fontSize: SIZES.xs, fontWeight: 600, color: labelColor }}>{cfg.label}</span>}
          </ItemChrome>;
        })}
        {canEdit && <AddItem label="Add item" accent={st.accent} onAdd={() => addItemAt(block, onChange, newItemFor(block,"checklist"))} />}
      </div>;
    }

    default: return null;
  }
}
