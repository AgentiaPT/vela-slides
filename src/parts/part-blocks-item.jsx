// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
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

