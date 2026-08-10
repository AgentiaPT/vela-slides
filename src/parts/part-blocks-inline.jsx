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


