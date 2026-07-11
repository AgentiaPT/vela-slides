// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Icon System ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let _iconsMap = null;
let _iconsLoading = false;
const _iconsQueue = [];

// Alias newer lucide names → names available in 0.263.1, plus common word aliases
const ICON_ALIASES = {
  // Newer lucide → 0.263.1
  CircleCheck: "CheckCircle2", CircleCheckBig: "CheckCircle2", BadgeCheck: "CheckCircle",
  CircleAlert: "AlertCircle", CircleX: "XCircle", CircleDot: "Circle",
  ShieldCheck: "ShieldCheck", ShieldAlert: "ShieldAlert", ShieldX: "ShieldOff",
  TriangleAlert: "AlertTriangle", OctagonAlert: "AlertOctagon",
  SquareCheck: "CheckSquare", SquareX: "XSquare",
  LoaderCircle: "Loader2", Ellipsis: "MoreHorizontal", EllipsisVertical: "MoreVertical",
  PanelLeft: "LayoutDashboard", PanelRight: "LayoutDashboard",
  BotMessageSquare: "Bot", MessageSquareText: "MessageSquare",
  ChartBar: "BarChart3", ChartLine: "LineChart", ChartPie: "PieChart",
  NotebookPen: "BookOpen", FileScan: "File",
  Blocks: "Box", Boxes: "Package", Container: "Box",
  Waypoints: "GitBranch", Route: "Navigation", Workflow: "GitMerge",
  BrainCircuit: "Brain", BrainCog: "Brain",
  Sparkle: "Sparkles", WandSparkles: "Wand2",
  HandMetal: "Hand", Handshake: "Users",
  CircleDollarSign: "DollarSign", Banknote: "CreditCard",
  Factory: "Building2", Warehouse: "Building", Hospital: "Building",
  // Common word aliases → lucide names
  check: "CheckCircle", tick: "CheckCircle", success: "CheckCircle", ok: "CheckCircle", verified: "CheckCircle",
  warning: "AlertTriangle", warn: "AlertTriangle", caution: "AlertTriangle", alert: "AlertCircle",
  error: "XCircle", fail: "XCircle", danger: "XCircle", wrong: "XCircle", bad: "XCircle",
  close: "X", cancel: "X", remove: "X", delete: "Trash2",
  trust: "ShieldCheck", secure: "ShieldCheck", safe: "ShieldCheck", protect: "Shield",
  verify: "Search", validate: "Search", inspect: "Search", review: "Eye",
  info: "Info", help: "HelpCircle", question: "HelpCircle",
  edit: "Pencil", write: "Pencil", compose: "PenTool",
  settings: "Settings", config: "Settings", gear: "Settings", cog: "Settings",
  user: "User", person: "User", people: "Users", team: "Users", group: "Users",
  home: "Home", house: "Home",
  mail: "Mail", email: "Mail", send: "Send",
  search: "Search", find: "Search", lookup: "Search",
  star: "Star", favorite: "Star", bookmark: "Bookmark",
  heart: "Heart", love: "Heart", like: "ThumbsUp",
  link: "Link", url: "Link", chain: "Link",
  clock: "Clock", time: "Clock", timer: "Timer", schedule: "Calendar",
  money: "DollarSign", payment: "CreditCard", price: "DollarSign", cost: "DollarSign",
  chart: "BarChart3", graph: "LineChart", analytics: "BarChart3", stats: "BarChart3",
  globe: "Globe", world: "Globe", international: "Globe", web: "Globe",
  phone: "Phone", call: "Phone", mobile: "Smartphone",
  camera: "Camera", photo: "Image", image: "Image", picture: "Image",
  folder: "Folder", directory: "Folder", file: "FileText", document: "FileText", doc: "FileText",
  code: "Code", terminal: "Terminal", dev: "Code2",
  database: "Database", storage: "Database", data: "Database",
  cloud: "Cloud", upload: "Upload", download: "Download",
  lock: "Lock", unlock: "Unlock", key: "Key", password: "Key",
  play: "Play", pause: "Pause", stop: "Square", video: "Video",
  mic: "Mic", audio: "Volume2", sound: "Volume2", music: "Music",
  map: "Map", location: "MapPin", pin: "MapPin", navigate: "Navigation",
  wifi: "Wifi", signal: "Signal", network: "Network",
  battery: "Battery", power: "Power", energy: "Zap", lightning: "Zap", bolt: "Zap",
  sun: "Sun", light: "Sun", bright: "Sun", moon: "Moon", dark: "Moon", night: "Moon",
  speed: "Gauge", fast: "Zap", slow: "Clock",
  ai: "Brain", ml: "Brain", intelligence: "Brain", smart: "Brain", think: "Brain",
  robot: "Bot", bot: "Bot", agent: "Bot", assistant: "Bot",
  magic: "Wand2", wand: "Wand2", auto: "Wand2",
  target: "Target", goal: "Target", aim: "Target", focus: "Crosshair",
  rocket: "Rocket", launch: "Rocket", startup: "Rocket",
  trophy: "Trophy", award: "Award", medal: "Medal", prize: "Trophy", win: "Trophy",
  refresh: "RefreshCw", reload: "RefreshCw", sync: "RefreshCw", update: "RefreshCw",
  filter: "Filter", sort: "ArrowUpDown",
  list: "List", menu: "Menu", grid: "LayoutGrid",
  share: "Share2", export: "ExternalLink", external: "ExternalLink", open: "ExternalLink",
  copy: "Copy", clipboard: "Clipboard", paste: "ClipboardPaste",
  save: "Save", store: "Save",
  print: "Printer",
  trash: "Trash2", bin: "Trash2", recycle: "Trash2",
  eye: "Eye", view: "Eye", visible: "Eye", hidden: "EyeOff", invisible: "EyeOff",
  flag: "Flag", report: "Flag",
  gift: "Gift", present: "Gift",
  truck: "Truck", delivery: "Truck", shipping: "Truck",
  tool: "Wrench", tools: "Wrench", fix: "Wrench", repair: "Wrench",
  puzzle: "Puzzle", plugin: "Plug", connect: "Plug",
};

// Emoji fallback for icons with no lucide equivalent
const ICON_EMOJI = {
  Robot: "🤖", Rocket: "🚀", Fire: "🔥", Lightning: "⚡", Crown: "👑",
  Gem: "💎", Bomb: "💣", Skull: "💀", Ghost: "👻", Alien: "👽",
  Rainbow: "🌈", Sun: "☀️", Moon: "🌙", Cloud: "☁️",
  Tree: "🌳", Flower: "🌸", Leaf: "🍃", Apple: "🍎",
  Pizza: "🍕", Coffee: "☕", Wine: "🍷",
  Soccer: "⚽", Basketball: "🏀", Guitar: "🎸", Dice: "🎲",
  Flag: "🚩", Stopwatch: "⏱️", Hourglass: "⏳",
  Megaphone: "📢", Newspaper: "📰", Ticket: "🎫",
  Microscope: "🔬", Telescope: "🔭", Dna: "🧬",
};

// Convert PascalCase to kebab-case: "AlertTriangle" → "alert-triangle"
const toKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();

function ensureIcons(cb) {
  if (_iconsMap) { cb(_iconsMap); return; }
  const map = {};
  // Use named exports directly — these are pre-built React components
  for (const [k, v] of Object.entries(_LucideAll)) {
    if (k === "default" || k === "icons" || k === "createLucideIcon") continue;
    if (v && (typeof v === "function" || v.$$typeof || v.render)) {
      map[k] = v;
      // Also add kebab-case alias
      const kebab = k.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
      if (kebab !== k) map[kebab] = v;
    }
  }
  _iconsMap = map;
  const pascal = Object.keys(map).filter(k => /^[A-Z]/.test(k));
  console.log(`[Vela] Icons loaded: ${pascal.length} components`);
  _iconsQueue.push(cb);
  _iconsQueue.forEach(fn => fn(_iconsMap));
  _iconsQueue.length = 0;
}

// Build a lowercase lookup index once icons load
let _iconsLower = null;
function buildLowerIndex() {
  if (!_iconsMap || _iconsLower) return;
  _iconsLower = {};
  for (const k of Object.keys(_iconsMap)) _iconsLower[k.toLowerCase()] = _iconsMap[k];
}

// Normalize icon name: kebab-case → PascalCase, lowercase lookup
function resolveIcon(name) {
  if (!name || !_iconsMap) return null;
  // Direct
  if (_iconsMap[name]) return _iconsMap[name];
  // Alias
  const alias = ICON_ALIASES[name];
  if (alias && _iconsMap[alias]) return _iconsMap[alias];
  // kebab-case → PascalCase: "alert-triangle" → "AlertTriangle"
  if (name.includes("-")) {
    const pascal = name.split("-").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
    if (_iconsMap[pascal]) return _iconsMap[pascal];
    const a2 = ICON_ALIASES[pascal];
    if (a2 && _iconsMap[a2]) return _iconsMap[a2];
  }
  // Case-insensitive
  buildLowerIndex();
  if (_iconsLower) {
    const lc = name.toLowerCase();
    if (_iconsLower[lc]) return _iconsLower[lc];
    // Try alias lowercase
    if (alias) { const lca = alias.toLowerCase(); if (_iconsLower[lca]) return _iconsLower[lca]; }
  }
  return null;
}

// Detect if string is emoji (starts with non-ASCII)
const isEmoji = (s) => s && /^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u2705\u2611\u2714\u26A0\u274C\u274E\u2B50\u2764\u2728\u267B\u2660-\u2667\u2639\u263A\u2122\u00A9\u00AE]/u.test(s);

function IconSlot({ name, ...props }) {
  const [Icon, setIcon] = useState(null);
  const [emoji, setEmoji] = useState(null);
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    if (!name) return;
    if (isEmoji(name)) { setEmoji(name); setResolved(true); return; }
    ensureIcons(() => {
      const C = resolveIcon(name);
      if (C) setIcon(() => C);
      else if (ICON_EMOJI[name]) setEmoji(ICON_EMOJI[name]);
      else console.warn(`[Vela] Icon not found: "${name}"`);
      setResolved(true);
    });
  }, [name]);
  if (Icon) return <Icon {...props} />;
  if (emoji) return <span style={{ fontSize: props.size || 16, lineHeight: 1 }}>{emoji}</span>;
  if (resolved) return <span style={{ fontSize: (props.size || 16) * 0.6, fontWeight: 700, color: props.color, opacity: 0.6, lineHeight: 1 }}>{(name || "?").slice(0, 2)}</span>;
  return null;
}

function getIcon(name, props = {}) {
  if (!name) return null;
  if (isEmoji(name)) return <span style={{ fontSize: props.size || 16, lineHeight: 1 }}>{name}</span>;
  const C = resolveIcon(name);
  if (C) return <C {...props} />;
  if (ICON_EMOJI[name]) return <span style={{ fontSize: props.size || 16, lineHeight: 1 }}>{ICON_EMOJI[name]}</span>;
  return <IconSlot name={name} {...props} />;
}
ensureIcons(() => {});

// ━━━ Icon Picker (searchable, click-to-change in edit mode) ━━━━━━━
// Context: opener function injected by App() so the modal is hosted at the
// app root, OUTSIDE any slide CSS transform (a position:fixed element inside a
// transformed ancestor is positioned relative to that ancestor, not the viewport).
const IconPickerContext = React.createContext(null);

// Sorted PascalCase Lucide names (skip the kebab-case dupes). Memoized.
let _iconNamesCache = null;
function allIconNames() {
  if (_iconNamesCache) return _iconNamesCache;
  if (!_iconsMap) return [];
  _iconNamesCache = Object.keys(_iconsMap).filter(k => /^[A-Z]/.test(k)).sort();
  return _iconNamesCache;
}

// Curated default set for the empty-query view — reuse the AI's "Common:" list.
const COMMON_ICON_NAMES = ((typeof ICON_LIST === "string" ? ICON_LIST : "").split("Common:")[1] || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// Search by name substring + alias words (e.g. "rocket"→Rocket, "warning"→AlertTriangle).
// Prefix matches first; capped so a keystroke never renders thousands of icons.
function searchIconNames(q) {
  const query = (q || "").trim().toLowerCase();
  if (!query) return COMMON_ICON_NAMES;
  const all = allIconNames();
  const aliasHits = Object.keys(ICON_ALIASES)
    .filter(k => k.toLowerCase().includes(query))
    .map(k => ICON_ALIASES[k]);
  const seen = new Set();
  const out = [];
  for (const n of [...all.filter(n => n.toLowerCase().startsWith(query)),
                   ...all.filter(n => n.toLowerCase().includes(query) && !n.toLowerCase().startsWith(query)),
                   ...aliasHits]) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= 120) break;
  }
  return out;
}

function IconPicker({ value, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [ready, setReady] = useState(!!_iconsMap);
  const [raw, setRaw] = useState("");
  useEffect(() => { ensureIcons(() => setReady(true)); }, []);
  const results = ready ? searchIconNames(q) : [];
  const swatch = (name) => (
    <button key={name} onClick={() => onPick(name)} title={name}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, padding: "6px 4px", height: 58, borderRadius: 8,
        background: name === value ? T.accent + "22" : "transparent", border: `1px solid ${name === value ? T.accent : "transparent"}`,
        color: T.text, cursor: "pointer" }}
      onMouseEnter={(e) => { if (name !== value) e.currentTarget.style.background = T.bgInput; }}
      onMouseLeave={(e) => { if (name !== value) e.currentTarget.style.background = "transparent"; }}>
      <span style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{getIcon(name, { size: 22, color: T.text, strokeWidth: 1.75 })}</span>
      <span style={{ fontFamily: FONT.mono, fontSize: 8, color: T.textDim, maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </button>
  );
  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", maxHeight: "76vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
          <span style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text }}>Pick an icon</span>
          {value && <button onClick={() => onPick(null)} style={{ fontFamily: FONT.mono, fontSize: 11, color: T.red, background: "none", border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>Clear</button>}
        </div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons (e.g. rocket, shield, chart)…"
          onKeyDown={(e) => { if (e.key === "Escape") { onClose(); return; } e.stopPropagation(); if (e.key === "Enter") { const r = searchIconNames(q); if (r[0]) onPick(r[0]); } }}
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", fontFamily: FONT.body, fontSize: 14, background: T.bgInput, color: T.text, border: `1px solid ${T.border}`, borderRadius: 8, outline: "none", marginBottom: 12, flexShrink: 0 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 4, flex: 1, minHeight: 0, overflowY: "auto", marginBottom: 12 }}>
          {!ready && <span style={{ fontFamily: FONT.mono, fontSize: 12, color: T.textDim, padding: 8 }}>Loading icons…</span>}
          {ready && results.length === 0 && <span style={{ fontFamily: FONT.mono, fontSize: 12, color: T.textDim, padding: 8 }}>No matches — try the emoji/name field below.</span>}
          {results.map(swatch)}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", borderTop: `1px solid ${T.border}`, paddingTop: 12, flexShrink: 0 }}>
          <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim, flexShrink: 0 }}>Emoji / name:</span>
          <input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="🚀 or AlertTriangle"
            onKeyDown={(e) => { if (e.key === "Escape") { onClose(); return; } e.stopPropagation(); if (e.key === "Enter" && raw.trim()) onPick(raw.trim()); }}
            style={{ flex: 1, padding: "6px 10px", fontFamily: FONT.mono, fontSize: 13, background: T.bgInput, color: T.text, border: `1px solid ${T.border}`, borderRadius: 6, outline: "none" }} />
          <button onClick={() => { if (raw.trim()) onPick(raw.trim()); }} style={{ padding: "6px 12px", fontFamily: FONT.body, fontSize: 13, background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Set</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// Wraps an icon in edit mode: click to open the picker. When there is no icon
// yet it renders a subtle ghost "+" so an icon can be added. Outside edit mode
// (or with no provider) it renders children untouched — zero render-path impact.
function EditableIcon({ value, onPick, editable, size = 20, children }) {
  const openPicker = React.useContext(IconPickerContext);
  const [hover, setHover] = useState(false);
  if (!editable || !openPicker) return children || null;
  const click = (e) => { e.stopPropagation(); e.preventDefault(); openPicker(value, onPick); };
  if (value) {
    return <span onClick={click} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title="Change icon" style={{ display: "inline-flex", cursor: "pointer", borderRadius: 6, transition: "box-shadow 0.15s", boxShadow: hover ? `0 0 0 2px ${T.accent}` : "none" }}>{children}</span>;
  }
  const d = Math.round(size * 1.6);
  return <span onClick={click} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    title="Add icon" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: d, height: d, borderRadius: "50%", border: `1px dashed ${T.accent}`, color: T.accent, fontSize: Math.round(size * 0.9), lineHeight: 1, cursor: "pointer", flexShrink: 0, opacity: hover ? 0.85 : 0.25, transition: "opacity 0.15s" }}>+</span>;
}


