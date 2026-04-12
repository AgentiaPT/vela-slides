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
          {entry && entry.url && (
            <a href={entry.url} target="_blank" rel="noopener noreferrer"
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

// Patch a single item in block.items and call onChange
function patchItemAt(block, onChange, idx, patch) {
  const ni = [...(block.items || [])];
  ni[idx] = { ...ni[idx], ...patch };
  onChange?.({ items: ni });
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
  return <div style={{ width: d, height: d, borderRadius: shape === "square" ? 8 : "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{el}</div>;
}

// ━━━ Icon Row Item (with per-item link) ━━━━━━━━━━━━━━━━━━━━━━━━━
function IconRowItem({ item, index, block, editable, onChange, st, SIZES, staggerIdx, presenting = false }) {
  const [hovered, setHovered] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const link = item.link;
  const editMode = editable && !presenting;

  const updateItem = (patch) => {
    const ni = [...(block.items || [])];
    ni[index] = { ...ni[index], ...patch };
    if (ni[index].link === undefined) delete ni[index].link;
    onChange?.({ items: ni });
  };

  return (
    <div className={stg(staggerIdx, index)} style={{ position: "relative", display: "flex", width: link ? "fit-content" : undefined, gap: 14, alignItems: "center", ...(link && (presenting || !editable) ? { cursor: "pointer" } : {}) }}
      title={link ? linkPreview(link, item.title) : undefined}
      data-pdf-link={link || undefined}
      onClick={link && (presenting || !editable) ? (e) => { e.stopPropagation(); window.open(link, "_blank", "noopener,noreferrer"); } : undefined}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <IconBubble icon={item.icon} size={20} color={item.iconColor || block.iconColor || st.accent} bg={item.iconBg || block.iconBg || `${st.accent}15`} shape={block.iconShape} />
      <div style={{ flex: 1 }}>
        <ItemText block={block} onChange={editMode ? onChange : undefined} editable={editMode} idx={index} prop="title" style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "sm"], fontWeight: 600, color: item.color || block.color || st.text, lineHeight: 1.3 }} />
        {item.text && <ItemText block={block} onChange={editMode ? onChange : undefined} editable={editMode} idx={index} prop="text" style={{ fontFamily: FONT.body, fontSize: SIZES[block.textSize || "sm"], color: block.textColor || st.muted, lineHeight: 1.5 }} />}
      </div>
      {/* Presenter mode: subtle link badge */}
      {link && presenting && <div onClick={(e) => { e.stopPropagation(); window.open(link, "_blank", "noopener,noreferrer"); }} style={{ position: "absolute", top: -2, right: -32, padding: "2px 5px", borderRadius: 4, background: T.accent, fontSize: 9, color: "#fff", zIndex: 12, cursor: "pointer", opacity: hovered ? 1 : 0.3, transition: "opacity 0.2s", boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>🔗</div>}
      {/* Link badge (not hovered, edit mode) */}
      {link && !hovered && editMode && <div style={{ position: "absolute", top: -2, right: -32, width: 14, height: 14, borderRadius: "50%", background: T.accent + "80", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, zIndex: 5, cursor: "pointer" }} title={link} onClick={(e) => { e.stopPropagation(); setEditingLink(true); }}>🔗</div>}
      {/* Hover chrome (edit mode) */}
      {hovered && editMode && <div style={{ position: "absolute", top: -6, right: -32, display: "flex", gap: 3, zIndex: 11 }}>
        <button onClick={(e) => { e.stopPropagation(); setEditingLink(!editingLink); }} style={{ width: 18, height: 18, borderRadius: "50%", background: link ? T.accent : T.bgPanel, border: `1px solid ${link ? T.accent : T.border}`, color: link ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title={link ? `Link: ${link}` : "Add link"}>🔗</button>
      </div>}
      {/* Link editor popup */}
      {editingLink && editMode && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -30, right: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 6px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
        <span style={{ fontSize: 9, color: T.textDim }}>🔗</span>
        <input autoFocus defaultValue={link || ""} placeholder="https://..." onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { updateItem({ link: e.target.value.trim() || undefined }); setEditingLink(false); } if (e.key === "Escape") setEditingLink(false); }} onBlur={(e) => { updateItem({ link: e.target.value.trim() || undefined }); setEditingLink(false); }} style={{ width: 200, padding: "2px 6px", fontSize: 10, fontFamily: FONT.mono, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, outline: "none" }} />
        {link && <button onClick={() => { updateItem({ link: undefined }); setEditingLink(false); }} style={{ background: "none", border: "none", color: T.red, fontSize: 10, cursor: "pointer", padding: 0 }}>✕</button>}
      </div>}
    </div>
  );
}

// ━━━ Bullet Item (with per-item link editing) ━━━━━━━━━━━━━━━━━━━━━
function BulletItem({ item, index, block, editable, onChange, st, SIZES, staggerIdx, fontScale, presenting = false }) {
  const [hovered, setHovered] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const text = typeof item === "string" ? item : item.text;
  const icon = typeof item === "object" ? item.icon : null;
  const link = typeof item === "object" ? item.link : null;
  const editMode = editable && !presenting;

  const updateItem = (patch) => {
    const ni = [...(block.items || [])];
    const cur = ni[index];
    if (typeof cur === "string") {
      ni[index] = { text: cur, ...patch };
    } else {
      ni[index] = { ...cur, ...patch };
    }
    if (ni[index].link === undefined) delete ni[index].link;
    onChange?.({ items: ni });
  };

  return (
    <div className={stg(staggerIdx, index)} style={{ position: "relative", display: "flex", gap: 12, alignItems: "center", ...(link && (presenting || !editable) ? { cursor: "pointer" } : {}) }}
      title={link ? linkPreview(link, text) : undefined}
      data-pdf-link={link || undefined}
      onClick={link && (presenting || !editable) ? (e) => { e.stopPropagation(); window.open(link, "_blank", "noopener,noreferrer"); } : undefined}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {icon ? <span style={{ flexShrink: 0, display: "flex" }}>{getIcon(icon, { size: 16, color: block.dotColor || st.accent, strokeWidth: 2 })}</span>
        : <div style={{ width: 6, height: 6, borderRadius: "50%", background: block.dotColor || st.accent, flexShrink: 0 }} />}
      <EditableText text={text} editable={editMode} onSave={(v) => {
        const ni = [...(block.items || [])];
        ni[index] = typeof item === "string" ? v : { ...item, text: v };
        onChange?.({ items: ni });
      }} style={{ fontFamily: FONT.body, fontSize: SIZES[block.size || "md"], color: block.color || st.muted, lineHeight: 1.6, flex: 1, ...(link ? { textDecoration: "underline", textDecorationColor: (block.dotColor || st.accent) + "60", textUnderlineOffset: "3px" } : {}) }} />
      {/* Presenter mode: persistent link pill */}
      {link && presenting && <div style={{ padding: "2px 8px", borderRadius: 4, background: T.accent, fontSize: 10, fontFamily: FONT.mono, color: "#fff", fontWeight: 600, opacity: hovered ? 1 : 0.35, transition: "opacity 0.2s", boxShadow: "0 2px 8px rgba(0,0,0,0.4)", flexShrink: 0, pointerEvents: "none" }}>🔗</div>}
      {/* Non-presenting, non-editable: small arrow */}
      {link && !presenting && !editable && <span style={{ flexShrink: 0, fontSize: 10, opacity: 0.5 }}>↗</span>}
      {/* Link badge (when not hovered, in edit mode) */}
      {link && !hovered && editMode && <div style={{ position: "absolute", top: -2, right: -2, width: 14, height: 14, borderRadius: "50%", background: T.accent + "80", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, zIndex: 5, cursor: "pointer" }} title={link} onClick={(e) => { e.stopPropagation(); setEditingLink(true); }}>🔗</div>}
      {/* Hover chrome (edit mode only) */}
      {hovered && editMode && <div style={{ position: "absolute", top: -6, right: -6, display: "flex", gap: 3, zIndex: 11 }}>
        <button onClick={(e) => { e.stopPropagation(); setEditingLink(!editingLink); }} style={{ width: 18, height: 18, borderRadius: "50%", background: link ? T.accent : T.bgPanel, border: `1px solid ${link ? T.accent : T.border}`, color: link ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title={link ? `Link: ${link}` : "Add link"}>🔗</button>
      </div>}
      {/* Link editor popup */}
      {editingLink && editMode && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -30, right: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 6px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
        <span style={{ fontSize: 9, color: T.textDim }}>🔗</span>
        <input autoFocus defaultValue={link || ""} placeholder="https://..." onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { const url = e.target.value.trim(); updateItem({ link: url || undefined }); setEditingLink(false); } if (e.key === "Escape") setEditingLink(false); }} onBlur={(e) => { const url = e.target.value.trim(); updateItem({ link: url || undefined }); setEditingLink(false); }} style={{ width: 200, padding: "2px 6px", fontSize: 10, fontFamily: FONT.mono, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, outline: "none" }} />
        {link && <button onClick={() => { updateItem({ link: undefined }); setEditingLink(false); }} style={{ background: "none", border: "none", color: T.red, fontSize: 10, cursor: "pointer", padding: 0 }}>✕</button>}
      </div>}
    </div>
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
      onClick={link ? (e) => { e.stopPropagation(); window.open(link, "_blank", "noopener,noreferrer"); } : undefined}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <RenderBlock block={block} staggerIdx={staggerIdx} slideTheme={slideTheme} editable={link ? false : editMode} slideAlign={slideAlign} fontScale={fontScale} presenting={presenting}
        onChange={onChange} />
      {/* Presenter mode: persistent link pill */}
      {link && presenting && <div onClick={(e) => { e.stopPropagation(); window.open(link, "_blank", "noopener,noreferrer"); }} style={{ position: "absolute", top: -8, right: -8, padding: "1px 6px", borderRadius: 4, background: T.accent, fontSize: 9, fontFamily: FONT.mono, color: "#fff", fontWeight: 600, zIndex: 12, cursor: "pointer", opacity: hovered ? 1 : 0.3, transition: "opacity 0.2s", boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>🔗</div>}
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
function ZoomWrap({ children, enabled }) {
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

  return <>
    <div ref={sourceRef} style={{ position: "relative", cursor: "zoom-in" }}
      onClick={(e) => { e.stopPropagation(); setZoomed(true); }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
      <div data-zoom-badge="" style={{ position: "absolute", top: 4, right: 4, padding: "2px 6px", borderRadius: 4, background: "rgba(15,23,42,0.7)", color: "#e2e8f0", fontSize: 10, fontFamily: "monospace", opacity: hovered ? 0.8 : 0, transition: "opacity 0.2s", pointerEvents: "none", display: "flex", alignItems: "center", gap: 3 }}>
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
  return <div className={cls} style={{ position: "relative", background: block.bg || "rgba(0,0,0,0.2)", borderRadius: 8, padding: "16px 20px", border: `1px solid ${st.border}`, overflow: "auto", ...block.style }}>
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
  return <div className={cls} style={{ display: "flex", gap: 10, padding: "14px 18px", borderRadius: 8, background: block.bg || `${st.accent}12`, borderLeft: `3px solid ${block.border || st.accent}`, alignItems: "flex-start", ...block.style }}>
    {block.icon && <span style={{ flexShrink: 0, display: "flex", marginTop: 2, ...(isReveal ? { cursor: "pointer" } : {}) }} onClick={isReveal ? () => setOpen(!open) : undefined}>{getIcon(block.icon, { size: 18, color: block.border || st.accent, strokeWidth: 2 })}</span>}
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
  switch (block.type) {

    case "heading": {
      const headingText = (block.text || "").replace(/^\*\*\s*|\s*\*\*$/g, "").replace(/\*\*/g, "");
      const hs = { fontFamily: FONT.display, fontSize: SIZES[block.size || "2xl"], fontWeight: block.weight || 700, color: block.color || st.text, lineHeight: 1.2, letterSpacing: "-0.02em", textAlign: block.icon ? undefined : block.align, maxWidth: block.maxWidth, margin: block.maxWidth && slideAlign === "center" ? "0 auto" : undefined, ...block.style };
      const wrapS = block.icon ? { display: "flex", alignItems: "center", gap: 10, justifyContent: block.align === "center" ? "center" : block.align === "right" ? "flex-end" : undefined } : {};
      return <div className={cls} style={{ ...wrapS, ...hs }}>
        {block.icon && <span style={{ flexShrink: 0, display: "flex" }}>{getIcon(block.icon, { size: Math.round(parseFloat(SIZES[block.size || "2xl"]) * 16) || 24, color: block.iconColor || block.color || st.accent, strokeWidth: 2 })}</span>}
        <EditableText text={headingText} editable={editable} onSave={(v) => onChange?.({ text: v })} style={block.icon ? { flex: 1 } : undefined} />
      </div>;
    }

    case "text":
      return <EditableText className={cls} text={block.text} editable={editable} onSave={(v) => onChange?.({ text: v })} multiline
        style={{ fontFamily: FONT.body, fontSize: SIZES[block.size || "md"], color: block.color || st.muted, lineHeight: 1.6, textAlign: block.align, maxWidth: block.maxWidth, margin: block.maxWidth && slideAlign === "center" ? "0 auto" : undefined, fontStyle: block.italic ? "italic" : "normal", fontWeight: block.bold ? 600 : 400, ...block.style }} />;

    case "bullets":
      return <div className={cls} style={{ display: "flex", flexDirection: "column", gap: block.gap || 8, ...block.style }}>{(block.items || []).map((item, i) =>
        <BulletItem key={i} item={item} index={i} block={block} editable={editable} onChange={onChange} st={st} SIZES={SIZES} staggerIdx={staggerIdx} fontScale={fontScale} presenting={presenting} />
      )}</div>;

    case "image":
      return <ZoomWrap enabled={!!block.src && !block._solo}><div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: block.align === "left" ? "flex-start" : block.align === "right" ? "flex-end" : "center", ...(block._solo ? { flex: 1, width: "100%", justifyContent: "center" } : {}), ...block.style }}>
        {block.src ? <img src={block.src} alt={block.alt || ""} style={block._solo
          ? { width: "100%", height: "100%", objectFit: block.fit || "contain", borderRadius: 0 }
          : { maxWidth: block.maxWidth || "100%", maxHeight: block.maxHeight || "100%", borderRadius: block.rounded ?? 8, objectFit: block.fit || "contain", boxShadow: block.shadow ? "0 8px 32px rgba(0,0,0,0.3)" : "none" }
        } /> : <div style={{ padding: 32, color: st.textDim, fontFamily: FONT.mono, fontSize: 11 }}>Paste image (Ctrl+V)</div>}
        {block.caption && <EditableText text={block.caption} editable={editable} onSave={(v) => onChange?.({ caption: v })} style={{ fontFamily: FONT.body, fontSize: SIZES.sm, color: st.textDim, marginTop: 8 }} />}
      </div></ZoomWrap>;

    case "code":
      return <CodeBlock block={block} cls={cls} st={st} editable={editable} onChange={onChange} SIZES={SIZES} />;

    case "grid":
      return <div className={cls} style={{ display: "grid", gridTemplateColumns: `repeat(${block.cols || 2}, 1fr)`, gap: block.gap || 24, ...block.style }}>{(block.items || []).map((cell, ci) => {
        const cellStyle = { display: "flex", flexDirection: cell.direction || "column", alignItems: cell.direction === "row" ? "center" : (cell.align ? ({ left: "flex-start", center: "center", right: "flex-end" }[cell.align] || cell.align) : "center"), gap: cell.direction === "row" ? 12 : 8 };
        if (cell.bg) cellStyle.background = cell.bg;
        if (cell.padding) cellStyle.padding = cell.padding;
        if (cell.borderRadius) cellStyle.borderRadius = cell.borderRadius;
        if (cell.border) cellStyle.border = cell.border;
        const safeStyle = cell.style && typeof cell.style === "object" && !Array.isArray(cell.style) ? cell.style : {};
        const cellLink = (cell.blocks || []).find(b => b.link)?.link;
        return <div key={ci} style={{ ...cellStyle, ...safeStyle, ...(cellLink ? { cursor: "pointer" } : {}) }} data-pdf-link={cellLink || undefined} onClick={cellLink ? (e) => { e.stopPropagation(); window.open(cellLink, "_blank", "noopener,noreferrer"); } : undefined}>{(cell.blocks || []).map((b, bj) => <GridCellBlock key={bj} block={b} staggerIdx={staggerIdx + ci + bj} slideTheme={st} slideAlign={slideAlign} fontScale={fontScale} presenting={presenting}
        editable={editable}
        onChange={onChange ? (patch) => {
          const newItems = (block.items || []).map((c, i) => i === ci
            ? { ...c, blocks: (c.blocks || []).map((nb, j) => j === bj ? { ...nb, ...patch } : nb) }
            : c);
          onChange({ items: newItems });
        } : undefined}
      />)}</div>; })}</div>;

    case "callout":
      return <CalloutBlock block={block} cls={cls} st={st} editable={editable} onChange={onChange} SIZES={SIZES} />;

    case "metric":
      return <div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: block.align === "left" ? "flex-start" : block.align === "right" ? "flex-end" : "center", ...block.style }}>
        {block.icon && <div style={{ marginBottom: 8, display: "flex" }}>{getIcon(block.icon, { size: 28, color: block.iconColor || st.accent, strokeWidth: 1.5 })}</div>}
        <EditableText text={block.value} editable={editable} onSave={(v) => onChange?.({ value: v })} style={{ fontFamily: FONT.display, fontSize: SIZES[block.size || "4xl"], fontWeight: 800, color: block.color || st.accent, lineHeight: 1, letterSpacing: "-0.03em" }} />
        {block.label && <EditableText text={block.label} editable={editable} onSave={(v) => onChange?.({ label: v })} style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: block.labelColor || st.textDim, marginTop: 6, letterSpacing: "0.05em", textTransform: "uppercase" }} />}
      </div>;

    case "quote":
      return <div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", ...block.style }}>
        <EditableText text={block.text} editable={editable} onSave={(v) => onChange?.({ text: v })} multiline prefix={"\u201C"} suffix={"\u201D"}
          style={{ fontFamily: FONT.display, fontSize: SIZES[block.size || "xl"], fontWeight: 600, color: block.color || st.text, lineHeight: 1.4, fontStyle: "italic", maxWidth: "85%" }} />
        {block.author && <EditableText text={block.author} editable={editable} onSave={(v) => onChange?.({ author: v })} prefix={"\u2014 "}
          style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: st.accent, marginTop: 14, letterSpacing: "0.05em" }} />}
      </div>;

    case "divider": return <div className={cls} style={{ height: 1, background: block.color || st.border, margin: `${block.spacing || 12}px 0`, ...block.style }} />;
    case "spacer": return <div style={{ height: block.h || 24 }} />;

    case "svg": {
      let processed = block.markup || "";
      // Theme token injection
      const tokens = { "{{color}}": st.text || "#e2e8f0", "{{accent}}": st.accent || "#3b82f6", "{{bg}}": st.bg || "#0f172a", "{{muted}}": (st.muted || "#94a3b8") };
      for (const [tok, val] of Object.entries(tokens)) { while (processed.includes(tok)) processed = processed.replace(tok, val); }
      // Sanitize — defense-in-depth against SVG XSS vectors
      processed = processed
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
        .replace(/<use[\s>][^]*?(?:<\/use>|\/>)/gi, "")
        .replace(/<animate[\s>][^]*?(?:<\/animate>|\/>)/gi, "")
        .replace(/<set[\s>][^]*?(?:<\/set>|\/>)/gi, "")
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
        .replace(/<embed[\s>][^]*?(?:<\/embed>|\/>)/gi, "")
        .replace(/<object[\s\S]*?<\/object>/gi, "")
        .replace(/\bon\w+\s*=/gi, "data-blocked=")
        .replace(/href\s*=\s*["']javascript:/gi, 'href="')
        .replace(/xlink:href\s*=\s*["'](?!#)/gi, 'data-blocked-href="')
        .replace(/style\s*=\s*["'][^"']*url\s*\([^)]*javascript:/gi, 'style="')
        .replace(/style\s*=\s*["'][^"']*expression\s*\(/gi, 'style="');
      return <ZoomWrap enabled={!!block.markup}><div className={cls} style={{ maxWidth: block.maxWidth || "100%", margin: block.align === "center" ? "0 auto" : block.align === "right" ? "0 0 0 auto" : "0", background: block.bg || "transparent", padding: block.padding || "0", borderRadius: block.rounded ? 8 : 0, ...block.style }}>
        <div dangerouslySetInnerHTML={{ __html: processed }} style={{ display: "flex", justifyContent: "center" }} />
        {block.caption && <EditableText text={block.caption} editable={editable} onSave={(v) => onChange?.({ caption: v })} style={{ textAlign: "center", color: block.captionColor || st.muted, fontSize: SIZES[block.captionSize || "sm"], marginTop: 8, fontStyle: "italic", fontFamily: FONT.body }} />}
      </div></ZoomWrap>;
    }

    case "badge": {
      const badgeFontSize = SIZES[block.size || "xs"];
      const badgeIconSize = badgeFontSize;
      const badgePadV = Math.max(3, Math.round(badgeFontSize * 0.25));
      const badgePadH = Math.max(10, Math.round(badgeFontSize * 0.8));
      return <div className={cls} style={{ display: "inline-flex", alignItems: "center", gap: Math.round(badgeFontSize * 0.5), fontFamily: FONT.mono, fontSize: badgeFontSize, fontWeight: 700, color: block.color || st.accent, letterSpacing: "0.15em", textTransform: "uppercase", padding: block.bg ? `${badgePadV}px ${badgePadH}px` : 0, borderRadius: 4, background: block.bg || "transparent", border: block.border ? `1px solid ${block.border}` : "none", ...block.style }}>
        {block.icon && <span style={{ display: "flex" }}>{getIcon(block.icon, { size: badgeIconSize, color: block.color || st.accent, strokeWidth: 2 })}</span>}
        <EditableText text={block.text} editable={editable} onSave={(v) => onChange?.({ text: v })} />
      </div>;
    }

    case "icon": {
      const sz = { sm: 20, md: 28, lg: 40, xl: 56 }[block.size || "md"] || 28;
      const iconEl = getIcon(block.name, { size: sz, color: block.color || st.accent, strokeWidth: block.strokeWidth || 1.5 });
      if (!iconEl) return <div className={cls} style={{ fontFamily: FONT.mono, fontSize: 10, color: st.textDim }}>⚠ {block.name}</div>;
      return <div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: block.align === "left" ? "flex-start" : block.align === "right" ? "flex-end" : "center", gap: 6, ...block.style }}>
        {block.circle !== false
          ? <IconBubble icon={block.name} size={sz} color={block.color || st.accent} bg={block.bg || `${block.color || st.accent}15`} strokeWidth={block.strokeWidth || 1.5} />
          : iconEl}
        {block.label && <EditableText text={block.label} editable={editable} onSave={(v) => onChange?.({ label: v })} style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: block.labelColor || st.textDim, letterSpacing: "0.03em", textAlign: "center" }} />}
      </div>;
    }

    case "icon-row": {
      const cols = block.cols || 1;
      const containerStyle = cols > 1
        ? { display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: block.gap || 14, ...block.style }
        : { display: "flex", flexDirection: "column", gap: block.gap || 14, ...block.style };
      return <div className={cls} style={containerStyle}>{(block.items || []).map((item, i) => (
        <IconRowItem key={i} item={item} index={i} block={block} editable={editable} onChange={onChange} st={st} SIZES={SIZES} staggerIdx={staggerIdx} presenting={presenting} />
      ))}</div>;
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
          <div key={`item-${i}`} className={stg(staggerIdx, i)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0, flex: isVert ? undefined : "1 1 0" }}>
            {item.icon && <IconBubble icon={item.icon} size={iconSz} color={item.iconColor || st.accent} bg={item.iconBg || block.iconBg || `${st.accent}15`} />}
            <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="label" style={{ fontFamily: FONT.display, fontSize: SIZES[block.labelSize || "sm"], fontWeight: 600, color: item.labelColor || block.labelColor || st.text, textAlign: "center", lineHeight: 1.3 }} />
            {item.sublabel && <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="sublabel" style={{ fontFamily: FONT.body, fontSize: SIZES[block.sublabelSize || "xs"], color: block.sublabelColor || st.muted, textAlign: "center", lineHeight: 1.4 }} />}
          </div>
        );
        if (i < items.length - 1) {
          const hasGate = item.gate;
          const gc = block.gateColor || st.accent;
          els.push(
            <div key={`conn-${i}`} style={{ display: "flex", flexDirection: isVert ? "column" : "row", alignItems: "center", justifyContent: "center", alignSelf: "flex-start", height: isVert ? undefined : iconH, flexShrink: 0, gap: 2 }}>
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
      return <ZoomWrap enabled={items.length > 0}><div className={cls} style={flowStyle}>
        {els}
        {block.loop && !isVert && <svg style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 36, width: "100%", overflow: "visible" }}>
          <defs><marker id={`loopArr-${staggerIdx}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={loopCol} /></marker></defs>
          {(() => { const n = items.length; const step = 100 / (n * 2); const x1 = step; const x2 = 100 - step; return <>
            <path d={`M ${x2}% 4 L ${x2}% 20 L ${x1}% 20 L ${x1}% 4`} fill="none" stroke={loopCol} strokeWidth="1.5" strokeDasharray={loopDash} strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#loopArr-${staggerIdx})`} />
            {block.loopLabel && <text x="50%" y="32" textAnchor="middle" fill={loopCol} fontSize="10" fontFamily="monospace" style={{ fontStyle: "italic" }}>{block.loopLabel}</text>}
          </>; })()}
        </svg>}
        {block.loop && isVert && <svg style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 36, height: "100%", overflow: "visible" }}>
          <defs><marker id={`loopArrV-${staggerIdx}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={loopCol} /></marker></defs>
          {(() => { const n = items.length; const step = 100 / (n * 2); const y1 = step; const y2 = 100 - step; return <>
            <path d={`M 4 ${y2}% L 20 ${y2}% L 20 ${y1}% L 4 ${y1}%`} fill="none" stroke={loopCol} strokeWidth="1.5" strokeDasharray={loopDash} strokeLinecap="round" strokeLinejoin="round" markerEnd={`url(#loopArrV-${staggerIdx})`} />
            {block.loopLabel && <text x="28" y="50%" textAnchor="middle" fill={loopCol} fontSize="10" fontFamily="monospace" style={{ fontStyle: "italic" }} transform={`rotate(90, 28, 50%)`} dominantBaseline="middle">{block.loopLabel}</text>}
          </>; })()}
        </svg>}
      </div></ZoomWrap>;
    }

    case "table": {
      const headers = block.headers || [];
      const rows = block.rows || [];
      const cols = headers.length || (rows[0] || []).length || 1;
      const hdrBg = block.headerBg || `${st.accent}20`;
      const hdrColor = block.headerColor || (block.headerBg ? "#fff" : st.accent);
      const cellColor = block.cellColor || st.muted;
      const brdColor = block.borderColor || st.border;
      return <div className={cls} style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${brdColor}`, ...block.style }}>
        {headers.length > 0 && <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, background: hdrBg }}>
          {headers.map((h, hi) => <EditableText key={hi} text={h} editable={editable} onSave={(v) => {
            const nh = [...headers]; nh[hi] = v; onChange?.({ headers: nh });
          }} style={{ padding: "10px 14px", fontFamily: FONT.mono, fontSize: SIZES[block.size || "xs"], fontWeight: 700, color: hdrColor, letterSpacing: "0.03em", textTransform: "uppercase", borderRight: hi < cols - 1 ? `1px solid ${brdColor}` : "none" }} />)}
        </div>}
        {rows.map((row, ri) => <div key={ri} className={stg(staggerIdx, ri + 1)} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, background: block.striped && ri % 2 === 1 ? `${st.accent}08` : "transparent", borderTop: `1px solid ${brdColor}` }}>
          {(row || []).map((cell, ci) => <EditableText key={ci} text={String(cell)} editable={editable} onSave={(v) => {
            const nr = rows.map((r, i) => i === ri ? r.map((c, j) => j === ci ? v : c) : r);
            onChange?.({ rows: nr });
          }} style={{ padding: "9px 14px", fontFamily: FONT.body, fontSize: SIZES[block.size || "sm"], color: ci === 0 ? st.text : cellColor, fontWeight: ci === 0 ? 500 : 400, lineHeight: 1.5, borderRight: ci < cols - 1 ? `1px solid ${brdColor}` : "none" }} />)}
        </div>)}
      </div>;
    }

    case "progress": {
      const items = block.items || (block.value != null ? [{ value: block.value, label: block.label, color: block.color }] : []);
      const trackCol = block.trackColor || `${st.accent}15`;
      const barH = block.height || 8;
      const labelColor = block.labelColor || st.muted;
      return <div className={cls} style={{ display: "flex", flexDirection: "column", gap: block.gap || 14, ...block.style }}>
        {(block.leftLabel || block.rightLabel) && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: -6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {block.leftIcon && getIcon(block.leftIcon, { size: 14, color: labelColor })}
              {block.leftLabel && <span style={{ fontSize: 11, fontWeight: 600, color: labelColor }}>{block.leftLabel}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {block.rightLabel && <span style={{ fontSize: 11, fontWeight: 600, color: labelColor }}>{block.rightLabel}</span>}
              {block.rightIcon && getIcon(block.rightIcon, { size: 14, color: labelColor })}
            </div>
          </div>
        )}
        {items.map((item, i) => {
          const val = Math.max(0, Math.min(item.value || 0, 100));
          const col = item.color || st.accent;
          return <div key={i} className={stg(staggerIdx, i)} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="label" style={{ fontFamily: FONT.display, fontSize: SIZES[block.size || "sm"], fontWeight: 500, color: block.labelColor || st.text }} />
              {block.showValue !== false && <span style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: col, fontWeight: 700 }}>{val}%</span>}
            </div>
            <div style={{ width: "100%", height: barH, borderRadius: barH / 2, background: trackCol, overflow: "hidden" }}>
              <div style={{ width: `${val}%`, height: "100%", borderRadius: barH / 2, background: col, transition: "width 0.6s ease" }} />
            </div>
          </div>;
        })}
        {block.annotation && (
          <div style={{ textAlign: "center", marginTop: -4, fontSize: 11, fontStyle: "italic", color: block.annotationColor || "#94a3b8" }}>
            {block.annotation}
          </div>
        )}
      </div>;
    }

    case "steps": {
      const items = block.items || [];
      const lineCol = block.lineColor || `${st.accent}40`;
      const active = typeof block.activeStep === "number" ? block.activeStep : items.length;
      return <div className={cls} style={{ display: "flex", flexDirection: "column", gap: 0, ...block.style }}>
        {items.map((item, i) => {
          const isActive = i < active;
          const dotCol = isActive ? (block.numberColor || st.accent) : `${st.textDim}60`;
          return <div key={i} className={stg(staggerIdx, i)} style={{ display: "flex", gap: 16, alignItems: "flex-start", position: "relative", paddingBottom: i < items.length - 1 ? 20 : 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 28 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: isActive ? dotCol : "transparent", border: `2px solid ${dotCol}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: isActive ? "#fff" : st.textDim, flexShrink: 0, zIndex: 1 }}>{i + 1}</div>
              {i < items.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 16, background: lineCol, marginTop: 4 }} />}
            </div>
            <div style={{ flex: 1, paddingTop: 3 }}>
              <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="title" style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "md"], fontWeight: 600, color: block.titleColor || st.text, lineHeight: 1.3 }} />
              {item.text && <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="text" style={{ fontFamily: FONT.body, fontSize: SIZES[block.textSize || "sm"], color: block.textColor || st.muted, lineHeight: 1.5, marginTop: 3 }} />}
            </div>
          </div>;
        })}
      </div>;
    }

    case "tag-group": {
      const items = block.items || [];
      const variant = block.variant || "filled";
      return <div className={cls} style={{ display: "flex", flexWrap: "wrap", gap: block.gap || 8, ...block.style }}>
        {items.map((item, i) => {
          const col = item.color || st.accent;
          const vs = variant === "outline"
            ? { background: "transparent", border: `1px solid ${col}`, color: col }
            : variant === "subtle"
              ? { background: `${col}15`, border: "1px solid transparent", color: col }
              : { background: col, border: "1px solid transparent", color: "#fff" };
          return <div key={i} className={stg(staggerIdx, i)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 20, fontFamily: FONT.mono, fontSize: SIZES[block.size || "xs"], fontWeight: 600, letterSpacing: "0.02em", ...vs, ...(item.style && typeof item.style === "object" && !Array.isArray(item.style) ? item.style : {}) }}>
            {item.icon && <span style={{ display: "flex", flexShrink: 0 }}>{getIcon(item.icon, { size: 12, color: variant === "filled" ? "#fff" : col, strokeWidth: 2 })}</span>}
            <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="text" />
          </div>;
        })}
      </div>;
    }

    case "timeline": {
      const items = block.items || [];
      const isVert = block.direction === "vertical";
      const lineCol = block.lineColor || `${st.accent}40`;
      const dotCol = block.dotColor || st.accent;

      if (isVert) {
        return <div className={cls} style={{ display: "flex", flexDirection: "column", gap: 0, ...block.style }}>
          {items.map((item, i) => (
            <div key={i} className={stg(staggerIdx, i)} style={{ display: "flex", gap: 16, alignItems: "flex-start", position: "relative", paddingBottom: i < items.length - 1 ? 24 : 0 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 14 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: dotCol, border: `2px solid ${dotCol}`, flexShrink: 0, zIndex: 1, marginTop: 4 }} />
                {i < items.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 20, background: lineCol, marginTop: 4 }} />}
              </div>
              <div style={{ flex: 1 }}>
                {item.date && <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="date" style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: block.dateColor || st.accent, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3 }} />}
                <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="title" style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "md"], fontWeight: 600, color: block.titleColor || st.text, lineHeight: 1.3 }} />
                {item.text && <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="text" style={{ fontFamily: FONT.body, fontSize: SIZES[block.textSize || "sm"], color: block.textColor || st.muted, lineHeight: 1.5, marginTop: 3 }} />}
              </div>
            </div>
          ))}
        </div>;
      }

      // Horizontal timeline
      return <div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: "stretch", ...block.style }}>
        <div style={{ display: "flex", alignItems: "flex-start", position: "relative" }}>
          <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 2, background: lineCol }} />
          {items.map((item, i) => (
            <div key={i} className={stg(staggerIdx, i)} style={{ flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", position: "relative", minWidth: 0 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: dotCol, flexShrink: 0, zIndex: 1, marginBottom: 10 }} />
              {item.date && <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="date" style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, color: block.dateColor || st.accent, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "center", marginBottom: 4 }} />}
              <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="title" style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "sm"], fontWeight: 600, color: block.titleColor || st.text, textAlign: "center", lineHeight: 1.3 }} />
              {item.text && <ItemText block={block} onChange={onChange} editable={editable} idx={i} prop="text" style={{ fontFamily: FONT.body, fontSize: SIZES.xs, color: block.textColor || st.muted, textAlign: "center", lineHeight: 1.4, marginTop: 3 }} />}
            </div>
          ))}
        </div>
      </div>;
    }

    case "comparison": {
      const items = block.items || [];
      const left = items[0] || {};
      const right = items[1] || {};
      const leftColor = left.color || "#ef4444";
      const rightColor = right.color || "#22c55e";
      const dividerLabel = block.dividerLabel || "VS";
      return <div className={cls} style={{ display: "flex", gap: 0, flex: 1, alignItems: "stretch", ...block.style }}>
        <div style={{ flex: 1, background: `${leftColor}08`, border: `1px solid ${leftColor}30`, borderRadius: "12px 0 0 12px", padding: "20px 22px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              {left.icon && <IconBubble icon={left.icon} size={18} color={leftColor} bg={`${leftColor}15`} />}
              <span style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "md"], fontWeight: 700, color: `${leftColor}cc` }}>{left.title || "A"}</span>
            </div>
            {(left.items || []).map((pt, pi) => (
              <div key={pi} style={{ display: "flex", alignItems: "start", gap: 8, fontSize: SIZES[block.size || "sm"], fontFamily: FONT.body, color: st.text, lineHeight: 1.5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: leftColor, flexShrink: 0, marginTop: 7 }} />
                <span>{typeof pt === "string" ? pt : pt.text || ""}</span>
              </div>
            ))}
          </div>
        </div>
        {block.hideDivider ? null : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, margin: "0 -18px" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: st.bg || "#1e293b", border: `2px solid ${st.border || "#475569"}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: st.muted }}>{dividerLabel}</div>
        </div>}
        <div style={{ flex: 1, background: `${rightColor}08`, border: `1px solid ${rightColor}30`, borderRadius: "0 12px 12px 0", padding: "20px 22px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              {right.icon && <IconBubble icon={right.icon} size={18} color={rightColor} bg={`${rightColor}15`} />}
              <span style={{ fontFamily: FONT.display, fontSize: SIZES[block.titleSize || "md"], fontWeight: 700, color: `${rightColor}cc` }}>{right.title || "B"}</span>
            </div>
            {(right.items || []).map((pt, pi) => (
              <div key={pi} style={{ display: "flex", alignItems: "start", gap: 8, fontSize: SIZES[block.size || "sm"], fontFamily: FONT.body, color: st.text, lineHeight: 1.5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: rightColor, flexShrink: 0, marginTop: 7 }} />
                <span>{typeof pt === "string" ? pt : pt.text || ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>;
    }

    case "funnel": {
      const items = block.items || [];
      const count = items.length || 1;
      const stageH = Math.floor(280 / count);
      const gap = 4;
      return <ZoomWrap enabled={items.length > 0}><div className={cls} style={{ width: "100%", ...block.style }}>
        <svg viewBox={`0 0 700 ${count * (stageH + gap)}`} style={{ width: "100%", maxWidth: 700 }} xmlns="http://www.w3.org/2000/svg">
          {items.map((item, i) => {
            const col = item.color || st.accent;
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
      </div></ZoomWrap>;
    }

    case "cycle": {
      const items = block.items || [];
      const n = items.length || 1;
      const cx = 260, cy = 200, radius = 130;
      const nodeR = 40;
      const defaultColors = ["#3b82f6", "#22c55e", "#f97316", "#8b5cf6", "#ec4899", "#06b6d4", "#f59e0b"];
      return <ZoomWrap enabled={items.length > 0}><div className={cls} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", ...block.style }}>
        <svg viewBox={`0 0 520 ${cy * 2 + 40}`} style={{ width: "100%", maxWidth: 520 }} xmlns="http://www.w3.org/2000/svg">
          <defs>
            {items.map((_, i) => {
              const col = items[i]?.color || defaultColors[i % defaultColors.length];
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
            const col = item.color || defaultColors[i % defaultColors.length];
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
      </div></ZoomWrap>;
    }

    case "number-row": {
      const items = block.items || [];
      const showIcons = block.showIcons !== false;
      return <div className={cls} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, width: "100%", ...(block.bordered ? { background: `${st.text}05`, border: `1px solid ${st.border}`, borderRadius: 12, padding: "20px 0" } : {}), ...block.style }}>
        {items.map((item, i) => {
          const col = item.color || st.accent;
          return <React.Fragment key={i}>
            {i > 0 && <div style={{ width: 1, height: block.compact ? 56 : 80, background: st.border || "#334155", flexShrink: 0 }} />}
            <div className={stg(staggerIdx, i)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: block.compact ? "16px 12px" : "24px 16px" }}>
              {showIcons && item.icon && <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${col}12`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {getIcon(item.icon, { size: 20, color: col, strokeWidth: 2 })}
              </div>}
              <div style={{ fontFamily: FONT.display, fontSize: SIZES[block.size || (block.compact ? "2xl" : "3xl")], fontWeight: 800, color: col, lineHeight: 1 }}>{item.value || ""}</div>
              {item.label && <div style={{ fontFamily: FONT.mono, fontSize: SIZES.xs, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: st.muted }}>{item.label}</div>}
            </div>
          </React.Fragment>;
        })}
      </div>;
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
      const renderRow = (indices, radii, yLabel) => (
        <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
          {hasY && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, flexShrink: 0 }}>
            {yLabel && <span style={yLabelStyle}>{yLabel}</span>}
          </div>}
          <div style={{ display: "flex", gap: 6, flex: 1 }}>
            {indices.map((qi) => {
              const qd = q(qi);
              const qc = qd.color || defaultQColors[qi];
              return <div key={qi} className={stg(staggerIdx, qi)} style={{ flex: 1, background: `${qc}0a`, border: `1px solid ${qc}30`, borderRadius: radii[qi - indices[0]], padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  {qd.icon && <span style={{ display: "flex" }}>{getIcon(qd.icon, { size: 16, color: qc, strokeWidth: 2 })}</span>}
                  <span style={{ fontFamily: FONT.display, fontSize: SIZES.sm, fontWeight: 700, color: `${qc}cc` }}>{qd.title || ""}</span>
                </div>
                {(qd.items || []).map((pt, pi) => (
                  <div key={pi} style={{ fontSize: SIZES.xs, fontFamily: FONT.body, color: st.text, marginBottom: 6, display: "flex", gap: 6 }}>
                    <span style={{ color: qc }}>•</span> {typeof pt === "string" ? pt : pt.text || ""}
                  </div>
                ))}
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
          return <div key={i} className={stg(staggerIdx, i)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: `${labelColor}08`, borderRadius: 8 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: status === "done" ? cfg.bg : status === "blocked" ? cfg.bg : "transparent", border: status === "pending" ? `2px solid ${st.muted}` : status === "partial" ? `2px solid #f59e0b` : "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative", overflow: "hidden" }}>
              {status === "partial" && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%", background: "#f59e0b" }} />}
              {cfg.icon && <span style={{ display: "flex", zIndex: 1 }}>{getIcon(cfg.icon, { size: 12, color: status === "done" ? "#fff" : "#ef4444", strokeWidth: 3 })}</span>}
            </div>
            <span style={{ fontFamily: FONT.body, fontSize: SIZES[block.size || "sm"], color: cfg.textColor, flex: 1 }}>{typeof item === "string" ? item : item.text || ""}</span>
            {block.showLabels !== false && <span style={{ marginLeft: "auto", fontFamily: FONT.mono, fontSize: SIZES.xs, fontWeight: 600, color: labelColor }}>{cfg.label}</span>}
          </div>;
        })}
      </div>;
    }

    default: return null;
  }
}

// ━━━ Branding Overlay ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function BrandingOverlay({ branding, index, total, displayIndex, displayTotal, slideBg }) {
  if (!branding?.enabled) return null;
  const b = branding;
  const di = displayIndex != null ? displayIndex : index;
  const dt = displayTotal != null ? displayTotal : total;
  const slideNum = `${String(di + 1).padStart(2, "0")} / ${String(dt).padStart(2, "0")}`;
  const rightText = b.footerRight === "auto" ? slideNum : (b.footerRight || "");
  // Detect light slides for contrast-appropriate footer defaults
  const isLight = (() => {
    if (!slideBg || slideBg.startsWith("linear") || slideBg.startsWith("radial")) return false;
    const c = slideBg.replace("#", "");
    if (c.length < 6) return false;
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), bl = parseInt(c.slice(4, 6), 16);
    return (r * 299 + g * 587 + bl * 114) / 1000 > 140;
  })();
  const isDefaultFooter = !b.footerBg || b.footerBg === "rgba(0,0,0,0.35)";
  const isDefaultColor = !b.footerColor || b.footerColor === "#94a3b8";
  const footerBg = isDefaultFooter && isLight ? "rgba(0,0,0,0.06)" : (b.footerBg || "rgba(0,0,0,0.35)");
  const footerColor = isDefaultColor && isLight ? "#475569" : (b.footerColor || "#94a3b8");
  return <>
    {b.accentBar && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: b.accentHeight || 4, background: b.accentColor || T.accent, zIndex: 5 }} />}
    {b.logo && (() => {
      const pos = b.logoPosition || "top-left";
      const sz = b.logoSize || 56;
      const isTop = pos.startsWith("top");
      const isLeft = pos.endsWith("left");
      const vOffset = isTop ? (b.accentBar ? (b.accentHeight || 4) + 8 : 10) : 36;
      const style = { position: "absolute", height: sz, objectFit: "contain", zIndex: 1, opacity: 0.9 };
      if (isTop) style.top = vOffset; else style.bottom = vOffset;
      if (isLeft) style.left = 16; else style.right = 16;
      return <img src={b.logo} alt="" data-branding-logo="true" style={style} />;
    })()}
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 28, background: footerBg, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", zIndex: 5 }}>
      <span style={{ fontFamily: FONT.mono, fontSize: b.footerSize || 9, color: footerColor, fontWeight: 500 }}>{b.footerLeft || ""}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: b.footerSize || 9, color: footerColor, fontWeight: 400, opacity: 0.7 }}>{b.footerCenter || ""}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: b.footerSize || 9, color: footerColor, fontWeight: 500 }}>{rightText}</span>
    </div>
  </>;
}

// ━━━ Slide Content ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━ Inline Comment Card (review mode) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function InlineCommentCard({ comment, itemId, slideIndex, dispatch }) {
  const [hover, setHover] = useState(false);
  const resolved = comment.status === "resolved";
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px 2px 5px", margin: "2px 0", background: resolved ? T.amber + "08" : T.amber + "12", border: `1px solid ${resolved ? T.amber + "20" : T.amber + "35"}`, borderRadius: 4, opacity: resolved ? 0.5 : 1, transition: "opacity 0.15s", width: "fit-content" }}>
      <span style={{ fontSize: 10, flexShrink: 0, lineHeight: 1 }}>💬</span>
      <span style={{ fontSize: 10, fontFamily: FONT.body, color: T.text, textDecoration: resolved ? "line-through" : "none", whiteSpace: "nowrap", lineHeight: 1.4 }}>{comment.text}</span>
      {comment.anchor && <span style={{ fontSize: 8, fontFamily: FONT.mono, color: T.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 80, flexShrink: 0 }}>"{comment.anchor}"</span>}
      <span onClick={(e) => { e.stopPropagation(); dispatch({ type: resolved ? "REOPEN_COMMENT" : "RESOLVE_COMMENT", itemId, slideIndex, commentId: comment.id }); }} style={{ cursor: "pointer", fontSize: 10, flexShrink: 0, opacity: hover ? 0.9 : 0.4, transition: "opacity 0.15s" }} title={resolved ? "Reopen" : "Resolve"}>{resolved ? "↩" : "✓"}</span>
      <span onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_COMMENT", itemId, slideIndex, commentId: comment.id }); }} style={{ cursor: "pointer", fontSize: 10, color: T.red, flexShrink: 0, opacity: hover ? 0.9 : 0.3, transition: "opacity 0.15s" }} title="Delete">✕</span>
    </div>
  );
}

function SlideContent({ slide, index, total, branding, editable, onEdit, presenting, onBlockEdit, blockEditing, fontScale = 1, reviewMode, itemId, dispatch: externalDispatch, displayIndex, displayTotal }) {
  const st = { text: slide.color || T.text, muted: slide.mutedColor || T.textMuted, textDim: T.textDim, accent: slide.accent || T.accent, border: T.border, codeBg: T.codeBg };
  const blocks = slide.blocks || [];
  const align = slide.align || "left";
  const requestedJustify = slide.verticalAlign || (align === "center" ? "center" : "flex-start");
  const bgStyle = {};
  if (slide.bg) bgStyle.background = slide.bg;
  if (slide.bgImage) { bgStyle.backgroundImage = `url(${slide.bgImage})`; bgStyle.backgroundSize = "cover"; bgStyle.backgroundPosition = "center"; }
  if (slide.bgGradient) bgStyle.background = slide.bgGradient;

  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  const [fitJustify, setFitJustify] = useState(requestedJustify);
  const [hoveredBlock, setHoveredBlock] = useState(null);
  const [editingLink, setEditingLink] = useState(null);
  const [editingBlockIdx, setEditingBlockIdx] = useState(null);
  const [blockPrompt, setBlockPrompt] = useState("");
  const [commentingBlockIdx, setCommentingBlockIdx] = useState(null);
  const [commentText, setCommentText] = useState("");

  // Close popup when blockEditing finishes
  const prevEditing = useRef(blockEditing);
  useEffect(() => {
    if (prevEditing.current && !blockEditing) { setEditingBlockIdx(null); setBlockPrompt(""); }
    prevEditing.current = blockEditing;
  }, [blockEditing]);

  const handleBlockChange = useCallback((blockIdx, blockPatch) => {
    if (!onEdit) return;
    const newBlocks = blocks.map((b, i) => i === blockIdx ? { ...b, ...blockPatch } : b);
    onEdit({ blocks: newBlocks });
  }, [onEdit, blocks]);

  const handleBlockRemove = useCallback((blockIdx) => {
    if (!onEdit) return;
    onEdit({ blocks: blocks.filter((_, i) => i !== blockIdx) });
  }, [onEdit, blocks]);

  useLayoutEffect(() => {
    const measure = () => {
      const inner = innerRef.current, outer = outerRef.current;
      if (!inner || !outer) return;
      inner.style.transform = "none";
      inner.style.width = "100%";
      inner.style.height = "auto";
      void inner.scrollHeight;
      const cs = getComputedStyle(outer);
      const availH = outer.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const ih = inner.scrollHeight;
      if (ih > availH && ih > 0) {
        const s = Math.max(availH / ih, 0.35);
        inner.style.transform = `scale(${s})`;
        inner.style.width = `${100 / s}%`;
        inner.style.height = isSplit ? "100%" : "";
        setFitScale(s);
        setFitJustify("flex-start");
      } else {
        inner.style.transform = "none";
        inner.style.width = "100%";
        inner.style.height = isSplit ? "100%" : "";
        setFitScale(1);
        setFitJustify(requestedJustify);
      }
    };
    measure();
    if (document.fonts?.ready) document.fonts.ready.then(() => requestAnimationFrame(measure));
  }, [slide, index, requestedJustify]);

  if (!blocks.length) return null;

  // ━━━ Layout: split image blocks for side-by-side layouts ━━━━━━━━━━
  const layout = slide.layout || "stack";
  const isSplit = layout === "image-right" || layout === "image-left";

  const rawPad = typeof slide.padding === "number" ? `${slide.padding}px` : slide.padding || "36px 48px";
  const isSoloImage = blocks.length === 1 && blocks[0].type === "image";
  const pad = isSoloImage ? "0px" : String(rawPad).split(/\s+/).map((v) => Math.max(parseInt(v) || 24, 24) + "px").join(" ");

  // Render a single block with all editable chrome (hover, edit popup, link, etc.)
  const renderBlockItem = (b, i) => editable && onEdit ? (
    <div key={i} data-block-type={b.type} style={{ position: "relative", ...(b.link ? { cursor: "pointer" } : {}) }}
      title={b.link ? linkPreview(b.link, b.text || b.value || b.title) : undefined}
      data-pdf-link={b.link || undefined}
      onClick={b.link ? (e) => { e.stopPropagation(); window.open(b.link, "_blank", "noopener,noreferrer"); } : undefined}
      onMouseEnter={() => setHoveredBlock(i)} onMouseLeave={() => { setHoveredBlock(null); }}>
      {editingBlockIdx === i && !presenting && <div style={{ position: "absolute", inset: -3, border: `2px solid ${st.accent}`, borderRadius: 6, pointerEvents: "none", zIndex: 10, boxShadow: `0 0 12px ${st.accent}40` }} />}
      {hoveredBlock === i && editingBlockIdx !== i && !presenting && <div style={{ position: "absolute", inset: -2, border: `1.5px dashed ${T.red}60`, borderRadius: 4, pointerEvents: "none", zIndex: 10 }} />}
      {hoveredBlock === i && !presenting && <div style={{ position: "absolute", top: -8, right: -8, display: "flex", gap: 3, zIndex: 11 }}>
        {onBlockEdit && <button onClick={(e) => { e.stopPropagation(); setEditingBlockIdx(editingBlockIdx === i ? null : i); setBlockPrompt(""); setEditingLink(null); }} style={{ width: 18, height: 18, borderRadius: "50%", background: editingBlockIdx === i ? st.accent : T.bgPanel, border: `1px solid ${editingBlockIdx === i ? st.accent : T.border}`, color: editingBlockIdx === i ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title="Edit this block with AI">🎯</button>}
        <button onClick={(e) => { e.stopPropagation(); setEditingLink(editingLink === i ? null : i); setEditingBlockIdx(null); setCommentingBlockIdx(null); }} style={{ width: 18, height: 18, borderRadius: "50%", background: b.link ? T.accent : T.bgPanel, border: `1px solid ${b.link ? T.accent : T.border}`, color: b.link ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title={b.link ? `Link: ${b.link}` : "Add link"}>🔗</button>
        {externalDispatch && <button onClick={(e) => { e.stopPropagation(); setCommentingBlockIdx(commentingBlockIdx === i ? null : i); setCommentText(""); setEditingBlockIdx(null); setEditingLink(null); }} style={{ width: 18, height: 18, borderRadius: "50%", background: commentingBlockIdx === i ? T.amber : T.bgPanel, border: `1px solid ${commentingBlockIdx === i ? T.amber : T.border}`, color: commentingBlockIdx === i ? "#fff" : T.textDim, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }} title="Add comment">💬</button>}
        <button onClick={(e) => { e.stopPropagation(); handleBlockRemove(i); }} style={{ width: 18, height: 18, borderRadius: "50%", background: T.red, border: "none", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>✕</button>
      </div>}
      {/* Block edit popup */}
      {editingBlockIdx === i && !presenting && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -36, right: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: "rgba(10,15,28,0.95)", border: `1px solid ${st.accent}50`, borderRadius: 8, padding: "4px 8px", boxShadow: `0 4px 16px rgba(0,0,0,0.6), 0 0 0 1px ${st.accent}20`, backdropFilter: "blur(12px)" }}>
        <span style={{ fontSize: 9, color: st.accent, flexShrink: 0 }}>🎯</span>
        <input autoFocus value={blockPrompt} onChange={(e) => setBlockPrompt(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && blockPrompt.trim() && !blockEditing) { e.preventDefault(); onBlockEdit(i, blockPrompt.trim()); } if (e.key === "Escape") { setEditingBlockIdx(null); setBlockPrompt(""); } }}
          disabled={blockEditing}
          placeholder="What to change..."
          style={{ width: 220, padding: "3px 6px", fontSize: 10, fontFamily: FONT.body, background: "rgba(255,255,255,0.06)", color: "#fff", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 4, outline: "none" }} />
        {blockEditing
          ? <span style={{ fontSize: 11, animation: "spin 1.5s linear infinite", display: "inline-block", flexShrink: 0 }}>✨</span>
          : <button onClick={() => { if (blockPrompt.trim()) onBlockEdit(i, blockPrompt.trim()); }} disabled={!blockPrompt.trim()} style={{ padding: "2px 8px", fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, background: blockPrompt.trim() ? st.accent : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 4, cursor: blockPrompt.trim() ? "pointer" : "default", opacity: blockPrompt.trim() ? 1 : 0.4, flexShrink: 0 }}>Go</button>}
        <button onClick={() => { setEditingBlockIdx(null); setBlockPrompt(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 10, padding: 0, flexShrink: 0 }}>✕</button>
      </div>}
      {editingLink === i && !presenting && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -32, right: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 6px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
        <span style={{ fontSize: 9, color: T.textDim }}>🔗</span>
        <input autoFocus defaultValue={b.link || ""} placeholder="https://..." onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { const url = e.target.value.trim(); handleBlockChange(i, { link: url || undefined }); setEditingLink(null); } if (e.key === "Escape") setEditingLink(null); }} onBlur={(e) => { const url = e.target.value.trim(); handleBlockChange(i, { link: url || undefined }); setEditingLink(null); }} style={{ width: 200, padding: "2px 6px", fontSize: 10, fontFamily: FONT.mono, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 4, outline: "none" }} />
        {b.link && <button onClick={() => { handleBlockChange(i, { link: undefined }); setEditingLink(null); }} style={{ background: "none", border: "none", color: T.red, fontSize: 10, cursor: "pointer", padding: 0 }}>✕</button>}
      </div>}
      {/* Block comment popup */}
      {commentingBlockIdx === i && !presenting && externalDispatch && <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: -36, right: 0, zIndex: 12, display: "flex", gap: 4, alignItems: "center", background: "rgba(10,15,28,0.95)", border: `1px solid ${T.amber}50`, borderRadius: 8, padding: "4px 8px", boxShadow: `0 4px 16px rgba(0,0,0,0.6), 0 0 0 1px ${T.amber}20`, backdropFilter: "blur(12px)" }}>
        <span style={{ fontSize: 9, flexShrink: 0 }}>💬</span>
        <input autoFocus value={commentText} onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && commentText.trim()) { e.preventDefault(); externalDispatch({ type: "ADD_COMMENT", itemId, slideIndex: index, text: commentText.trim(), blockIndex: i }); setCommentText(""); setCommentingBlockIdx(null); } if (e.key === "Escape") { setCommentingBlockIdx(null); setCommentText(""); } }}
          placeholder="Add a comment..."
          style={{ width: 220, padding: "3px 6px", fontSize: 10, fontFamily: FONT.body, background: "rgba(255,255,255,0.06)", color: "#fff", border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 4, outline: "none" }} />
        <button onClick={() => { if (commentText.trim()) { externalDispatch({ type: "ADD_COMMENT", itemId, slideIndex: index, text: commentText.trim(), blockIndex: i }); setCommentText(""); setCommentingBlockIdx(null); } }} disabled={!commentText.trim()} style={{ padding: "2px 8px", fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, background: commentText.trim() ? T.amber : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 4, cursor: commentText.trim() ? "pointer" : "default", opacity: commentText.trim() ? 1 : 0.4, flexShrink: 0 }}>Add</button>
        <button onClick={() => { setCommentingBlockIdx(null); setCommentText(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 10, padding: 0, flexShrink: 0 }}>✕</button>
      </div>}
      {/* Comment count badge (edit mode, not review) */}
      {!reviewMode && !presenting && hoveredBlock !== i && externalDispatch && (() => { const cc = slideComments.filter((c) => c.blockIndex === i && c.status === "open"); return cc.length > 0 ? <div style={{ position: "absolute", top: -2, left: -2, minWidth: 14, height: 14, borderRadius: 7, background: T.amber, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontFamily: FONT.mono, fontWeight: 700, color: "#fff", padding: "0 3px", zIndex: 5, boxShadow: "0 2px 4px rgba(0,0,0,0.3)" }} title={`${cc.length} comment${cc.length > 1 ? "s" : ""}`}>💬{cc.length > 1 ? cc.length : ""}</div> : null; })()}
      {b.link && hoveredBlock !== i && !presenting && <div onClick={(e) => { e.stopPropagation(); window.open(b.link, "_blank", "noopener,noreferrer"); }} style={{ position: "absolute", top: -2, right: -2, width: 14, height: 14, borderRadius: "50%", background: T.accent + "80", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, zIndex: 5, cursor: "pointer" }} title={b.link}>🔗</div>}
      {b.link && presenting && <div style={{ position: "absolute", top: -2, right: -2, padding: "2px 5px", borderRadius: 4, background: T.accent, fontSize: 9, color: "#fff", zIndex: 12, pointerEvents: "none", opacity: hoveredBlock === i ? 1 : 0.3, transition: "opacity 0.2s", boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}>🔗</div>}
      <RenderBlock block={b} staggerIdx={i + 1} slideTheme={st} editable={b.link ? false : editable} slideAlign={align} fontScale={fontScale} presenting={presenting}
        onChange={onEdit ? (patch) => handleBlockChange(i, patch) : undefined} />
    </div>
  ) : (
    <div key={i} data-block-type={b.type} title={b.link ? linkPreview(b.link, b.text || b.value || b.title) : undefined} data-pdf-link={b.link || undefined} onClick={b.link ? (e) => { e.stopPropagation(); window.open(b.link, "_blank", "noopener,noreferrer"); } : undefined} style={b.link ? { cursor: "pointer" } : undefined}>
      <RenderBlock block={b} staggerIdx={i + 1} slideTheme={st} editable={b.link ? false : editable} slideAlign={align} fontScale={fontScale} presenting={presenting}
        onChange={onEdit ? (patch) => handleBlockChange(i, patch) : undefined} />
    </div>
  );

  // Slide comments — always computed for badges, inline cards only in review mode
  const slideComments = slide?.comments ? slide.comments.filter(Boolean) : [];
  const renderInlineComments = (blockIdx) => {
    if (!reviewMode || !externalDispatch || slideComments.length === 0) return null;
    const matching = slideComments.filter((c) => c.blockIndex === blockIdx);
    if (matching.length === 0) return null;
    return matching.map((c) => <InlineCommentCard key={c.id} comment={c} itemId={itemId} slideIndex={index} dispatch={externalDispatch} />);
  };

  // Render a block followed by its inline comments
  const renderBlockWithComments = (b, i) => {
    const block = renderBlockItem(b, i);
    const comments = renderInlineComments(i);
    if (!comments) return [block];
    return [block, ...comments];
  };

  // Build content: split layout or standard stacked layout
  const renderBlocks = () => {
    if (isSplit) {
      const contentIdxs = [], imageIdxs = [];
      blocks.forEach((b, i) => { (b.type === "image" ? imageIdxs : contentIdxs).push(i); });
      // Fallback: if no images found, render as stack
      if (imageIdxs.length === 0) return blocks.flatMap((b, i) => renderBlockWithComments(b, i));
      const imageOnRight = layout === "image-right";
      const contentCol = <div key="__content" style={{ flex: slide.contentFlex || 1, display: "flex", flexDirection: "column", justifyContent: fitJustify, gap: slide.gap || 12, minWidth: 0 }}>{contentIdxs.flatMap((i) => renderBlockWithComments(blocks[i], i))}</div>;
      const imageCol = <div key="__images" style={{ flex: slide.imageFlex || 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: slide.gap || 12, minWidth: 0, height: "100%" }}>{imageIdxs.flatMap((i) => renderBlockWithComments(blocks[i], i))}</div>;
      return imageOnRight ? [contentCol, imageCol] : [imageCol, contentCol];
    }
    if (isSoloImage) return renderBlockWithComments({ ...blocks[0], _solo: true }, 0);
    return blocks.flatMap((b, i) => renderBlockWithComments(b, i));
  };

  return (
    <SlideErrorBoundary>
      <div ref={outerRef} style={{ height: "100%", padding: pad, position: "relative", overflow: "visible", boxSizing: "border-box", display: "flex", flexDirection: "column", ...bgStyle }}>
        <div ref={innerRef} style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: isSplit ? "row" : "column", justifyContent: isSplit ? "stretch" : fitJustify, alignItems: isSplit ? "stretch" : (align === "center" ? "center" : "stretch"), textAlign: align, gap: isSplit ? (slide.splitGap || 32) : (slide.gap || 12), transform: fitScale < 1 ? `scale(${fitScale})` : "none", transformOrigin: "top left", width: fitScale < 1 ? `${100 / fitScale}%` : "100%", height: fitScale < 1 ? `${100 / fitScale}%` : "100%", maxWidth: fitScale < 1 ? `${100 / fitScale}%` : "100%", flex: fitScale < 1 ? undefined : 1, boxSizing: "border-box" }}>
          {renderBlocks()}
        </div>
        {/* Slide-level comments (no blockIndex) — top-right */}
        {reviewMode && externalDispatch && (() => {
          const unanchored = slideComments.filter((c) => c.blockIndex == null);
          if (unanchored.length === 0) return null;
          return <div style={{ position: "absolute", top: 8, right: 8, zIndex: 5, display: "flex", flexDirection: "column", gap: 2, maxWidth: "45%" }}>
            {unanchored.map((c) => <InlineCommentCard key={c.id} comment={c} itemId={itemId} slideIndex={index} dispatch={externalDispatch} />)}
          </div>;
        })()}
        {branding?.enabled
          ? <BrandingOverlay branding={branding} index={index} total={total} displayIndex={displayIndex} displayTotal={displayTotal} slideBg={slide.bg} />
          : (() => { const di = displayIndex != null ? displayIndex : index; const dt = displayTotal != null ? displayTotal : total; return <div style={{ position: "absolute", bottom: 14, right: 18, fontFamily: FONT.mono, fontSize: 10, color: st.muted, opacity: 0.35 }}>{String(di + 1).padStart(2, "0")} / {String(dt).padStart(2, "0")}</div>; })()
        }
      </div>
    </SlideErrorBoundary>
  );
}


