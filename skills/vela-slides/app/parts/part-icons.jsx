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


