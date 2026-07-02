// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Vela Battery Test ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Auto-runs on mount, shows toast notification, copy details button

const VELA_TESTS = [
  // ── Config & Utilities ──
  { name: "VELA_VERSION defined", fn: () => typeof VELA_VERSION === "string" && VELA_VERSION.length > 0 },
  { name: "Theme (T) has required keys", fn: () => ["bg", "bgPanel", "text", "accent", "border", "red", "green"].every((k) => T[k]) },
  { name: "FONT object valid", fn: () => ["display", "body", "mono"].every((k) => FONT[k]) },
  { name: "fmtTime works", fn: () => fmtTime(90) !== "" && fmtTime(0) === "" && fmtTime(3600).includes("1h") },
  { name: "fmtTime humanizes (no raw minutes)", fn: () => !fmtTime(13620).includes("227") && fmtTime(13620).includes("h") },
  { name: "sumDurations works", fn: () => sumDurations([{ duration: 60 }, { duration: 30 }]) === 90 && sumDurations([]) === 0 },
  { name: "uid() returns unique IDs", fn: () => { const a = uid(), b = uid(); return a !== b && a.length > 0; } },
  { name: "now() returns ISO string", fn: () => now().includes("T") && now().includes("Z") },
  { name: "fmtSize works", fn: () => fmtSize(1024).includes("KB") },
  { name: "S.btn returns style object", fn: () => typeof S.btn() === "object" && S.btn().cursor === "pointer" },
  { name: "S.primaryBtn returns style", fn: () => typeof S.primaryBtn() === "object" },
  { name: "S.input returns style", fn: () => typeof S.input() === "object" },

  // ── Image Paste Layout (v12.78) ──
  { name: "pasteImageLayout is function", fn: () => typeof pasteImageLayout === "function" },
  { name: "pasteImageLayout: empty slide stacks", fn: () => pasteImageLayout({ blocks: [] }, 1) === "stack" },
  { name: "pasteImageLayout: title-only slide stacks", fn: () => pasteImageLayout({ blocks: [{ type: "heading", text: "Hi" }] }, 1) === "stack" },
  { name: "pasteImageLayout: heading+subtitle stacks", fn: () => pasteImageLayout({ blocks: [{ type: "heading", text: "Hi" }, { type: "subtitle", text: "Sub" }] }, 1) === "stack" },
  { name: "pasteImageLayout: content slide → image-right", fn: () => pasteImageLayout({ blocks: [{ type: "heading", text: "Hi" }, { type: "bullets", items: ["a", "b"] }] }, 1) === "image-right" },
  { name: "pasteImageLayout: 3 text blocks → image-right", fn: () => pasteImageLayout({ blocks: [{ type: "heading", text: "a" }, { type: "text", text: "b" }, { type: "text", text: "c" }] }, 1) === "image-right" },
  { name: "pasteImageLayout: wide image stacks even with content", fn: () => pasteImageLayout({ blocks: [{ type: "bullets", items: ["a"] }] }, 1.78) === "stack" },
  { name: "pasteImageLayout: 1.6 aspect counts as wide", fn: () => pasteImageLayout({ blocks: [{ type: "bullets", items: ["a"] }] }, 1.6) === "stack" },
  { name: "pasteImageLayout: 1.5 aspect → image-right", fn: () => pasteImageLayout({ blocks: [{ type: "bullets", items: ["a"] }] }, 1.5) === "image-right" },
  { name: "pasteImageLayout: explicit image-left preserved", fn: () => pasteImageLayout({ layout: "image-left", blocks: [{ type: "bullets", items: ["a"] }] }, 1) === "image-left" },
  { name: "pasteImageLayout: explicit cols preserved", fn: () => pasteImageLayout({ layout: "cols", L: [], R: [], blocks: [] }, 1) === "cols" },
  { name: "pasteImageLayout: spacer/divider ignored (title stacks)", fn: () => pasteImageLayout({ blocks: [{ type: "heading", text: "Hi" }, { type: "spacer" }, { type: "divider" }] }, 1) === "stack" },

  // ── Editing UX Batch (v12.75): imageAspect ──
  { name: "imageAspect is function", fn: () => typeof imageAspect === "function" },
  { name: "imageAspect returns a Promise", fn: () => imageAspect("data:image/png;base64,x") instanceof Promise },

  // ── Editing UX Batch (v12.75): Icon Picker ──
  { name: "IconPicker component exists", fn: () => typeof IconPicker === "function" },
  { name: "EditableIcon component exists", fn: () => typeof EditableIcon === "function" },
  { name: "allIconNames returns a populated, sorted list", fn: () => { const names = allIconNames(); return Array.isArray(names) && names.length > 100 && names[0] <= names[1]; } },
  { name: "searchIconNames prefix-matches by name", fn: () => searchIconNames("rocket").includes("Rocket") },
  { name: "searchIconNames: empty query returns curated common list", fn: () => searchIconNames("") === COMMON_ICON_NAMES && COMMON_ICON_NAMES.length > 5 },

  // ── Editing UX Batch (v12.75): Add-Item affordance ──
  { name: "blankItemFor: bullets → placeholder string", fn: () => blankItemFor("bullets") === "New point" },
  { name: "blankItemFor: icon-row → placeholder object", fn: () => { const b = blankItemFor("icon-row"); return b.icon === "Circle" && b.title === "Title" && b.text === "Description"; } },
  { name: "blankItemFor: grid → heading+text blocks", fn: () => { const b = blankItemFor("grid"); return Array.isArray(b.blocks) && b.blocks.some((x) => x.type === "heading") && b.blocks.some((x) => x.type === "text"); } },
  { name: "blankItemFor: unknown type falls back to generic item", fn: () => blankItemFor("nonsense-type").text === "New item" },
  { name: "newItemFor: clones last sibling's style, resets content", fn: () => {
    const block = { type: "icon-row", items: [{ icon: "Rocket", iconColor: "#fff", title: "A", text: "B" }] };
    const next = newItemFor(block, "icon-row");
    return next.icon === "Rocket" && next.iconColor === "#fff" && next.title === "Title" && next.text === "Description";
  }},
  { name: "newItemFor: drops link from the cloned sibling", fn: () => {
    const block = { type: "bullets", items: [{ text: "A", link: "https://x" }] };
    return newItemFor(block, "bullets").link === undefined;
  }},
  { name: "newItemFor: bare-string sibling (bullets) falls back to blank", fn: () => {
    const block = { type: "bullets", items: ["Existing point"] };
    return newItemFor(block, "bullets") === "New point";
  }},
  { name: "newItemFor: empty list falls back to blankItemFor", fn: () => {
    const block = { type: "steps", items: [] };
    const next = newItemFor(block, "steps");
    return next.title === "Step title" && next.text === "Description";
  }},
  { name: "newItemFor: grid clones via cloneGridCell", fn: () => {
    const block = { type: "grid", items: [{ padding: 20, blocks: [{ type: "heading", text: "Old" }, { type: "text", text: "Old body" }] }] };
    const next = newItemFor(block, "grid");
    return next.padding === 20 && next.blocks[0].text === "Title" && next.blocks[1].text === "Description";
  }},
  { name: "cloneGridCell: resets text/value/label, keeps structure, drops link", fn: () => {
    const cell = { padding: 12, link: "https://x", blocks: [{ type: "heading", text: "Old Title" }, { type: "metric", value: "42", label: "Old Label" }] };
    const c = cloneGridCell(cell);
    return c.padding === 12 && c.link === undefined && c.blocks[0].text === "Title" && c.blocks[1].value === "00" && c.blocks[1].label === "Label";
  }},
  { name: "clonePoint: string form resets to placeholder", fn: () => clonePoint("Old point") === "New point" },
  { name: "clonePoint: object form resets text, keeps color, drops link", fn: () => {
    const p = clonePoint({ text: "Old", color: "#fff", link: "https://x" });
    return p.text === "New point" && p.color === "#fff" && p.link === undefined;
  }},
  { name: "addItemAt appends to items via onChange", fn: () => {
    let patch; addItemAt({ items: ["a", "b"] }, (p) => { patch = p; }, "c");
    return Array.isArray(patch.items) && patch.items.length === 3 && patch.items[2] === "c";
  }},
  { name: "AddItem affordance component exists", fn: () => typeof AddItem === "function" },

  // ── Editing UX Batch (v12.75): Per-item toolbar (ItemChrome) ──
  { name: "ItemChrome component exists", fn: () => typeof ItemChrome === "function" },
  { name: "ItemChrome wires delete + link actions", fn: () => { const src = ItemChrome.toString(); return src.includes("onDelete") && src.includes("onSetLink"); } },
  { name: "removeItemAt filters the target index", fn: () => {
    let patch; removeItemAt({ items: ["a", "b", "c"] }, (p) => { patch = p; }, 1);
    return patch.items.length === 2 && patch.items[0] === "a" && patch.items[1] === "c";
  }},
  { name: "setItemLink upgrades a bare string item", fn: () => {
    let patch; setItemLink({ items: ["hello"] }, (p) => { patch = p; }, 0, "https://x");
    return patch.items[0].text === "hello" && patch.items[0].link === "https://x";
  }},
  { name: "setItemLink clears an existing link", fn: () => {
    let patch; setItemLink({ items: [{ text: "hi", link: "https://x" }] }, (p) => { patch = p; }, 0, "");
    return patch.items[0].link === undefined;
  }},
  { name: "patchItemAt merges a partial patch", fn: () => {
    let patch; patchItemAt({ items: [{ icon: "Old", text: "Keep" }] }, (p) => { patch = p; }, 0, { icon: "New" });
    return patch.items[0].icon === "New" && patch.items[0].text === "Keep";
  }},

  // ── Block Reference & Design Rules ──
  { name: "BLOCK_REFERENCE defined", fn: () => typeof BLOCK_REFERENCE === "string" && BLOCK_REFERENCE.length > 100 },
  { name: "DESIGN_RULES defined", fn: () => typeof DESIGN_RULES === "string" && DESIGN_RULES.length > 50 },
  { name: "CANVAS_RULES defined", fn: () => typeof CANVAS_RULES === "string" && CANVAS_RULES.includes("960") },
  { name: "ICON_LIST defined", fn: () => typeof ICON_LIST === "string" && ICON_LIST.length > 20 },
  { name: "DESIGN_PROMPT_FOOTER defined", fn: () => typeof DESIGN_PROMPT_FOOTER === "string" && DESIGN_PROMPT_FOOTER.length > 100 },

  // ── Engine Functions ──
  { name: "callClaudeAPI is function", fn: () => typeof callClaudeAPI === "function" },
  { name: "parseJSONResponse works", fn: () => { const r = parseJSONResponse('```json\n{"a":1}\n```'); return r && r.a === 1; } },
  { name: "parseJSONResponse handles garbage", fn: () => parseJSONResponse("not json") === null },
  { name: "restoreImageSrcs is function", fn: () => typeof restoreImageSrcs === "function" },
  { name: "improveSlide is function", fn: () => typeof improveSlide === "function" },
  { name: "callSlideDesignAPI is function", fn: () => typeof callSlideDesignAPI === "function" },
  { name: "buildDesignCtx is function", fn: () => typeof buildDesignCtx === "function" },
  { name: "quickEditSlide is function", fn: () => typeof quickEditSlide === "function" },
  { name: "generateSlide is function", fn: () => typeof generateSlide === "function" },
  { name: "executeTool is function", fn: () => typeof executeTool === "function" },
  { name: "ALT_DIRECTIONS has 4 items", fn: () => Array.isArray(ALT_DIRECTIONS) && ALT_DIRECTIONS.length === 4 },
  { name: "preserveImages is function", fn: () => typeof preserveImages === "function" },
  { name: "edit_slide keeps image when patch echoes [IMAGE] placeholder", fn: () => {
    const bigsrc = "data:image/png;base64," + "A".repeat(300);
    const ws = { lanes: [{ id: "l1", title: "L", items: [{ id: "i1", title: "Deck", slides: [{ blocks: [{ type: "heading", text: "Old" }, { type: "image", src: bigsrc }] }] }] }] };
    executeTool("edit_slide", { item_name: "Deck", slide_index: 0, patch: { blocks: [{ type: "heading", text: "New" }, { type: "image", src: "[IMAGE]" }] } }, ws);
    const b = ws.lanes[0].items[0].slides[0].blocks;
    return b[0].text === "New" && b[1].type === "image" && b[1].src === bigsrc;
  }},
  { name: "edit_slide re-appends image when patch drops it", fn: () => {
    const bigsrc = "data:image/png;base64," + "B".repeat(300);
    const ws = { lanes: [{ id: "l1", title: "L", items: [{ id: "i1", title: "Deck", slides: [{ blocks: [{ type: "heading", text: "Old" }, { type: "image", src: bigsrc }] }] }] }] };
    executeTool("edit_slide", { item_name: "Deck", slide_index: 0, patch: { blocks: [{ type: "heading", text: "Only heading now" }] } }, ws);
    const b = ws.lanes[0].items[0].slides[0].blocks;
    return b.some((x) => x.type === "image" && x.src === bigsrc);
  }},

  // ── v10: Teacher Mode Engine ──
  { name: "buildTeacherPrompt is function", fn: () => typeof buildTeacherPrompt === "function" },
  { name: "callVeraTeacher is function", fn: () => typeof callVeraTeacher === "function" },
  { name: "buildTeacherPrompt returns string with QUESTIONS", fn: () => {
    const prompt = buildTeacherPrompt([{ title: "L1", items: [{ id: "i1", title: "Test", slides: [{ blocks: [{ type: "heading", text: "Hi" }] }] }] }], "i1", 0);
    return typeof prompt === "string" && prompt.includes("QUESTIONS") && prompt.includes("teaching assistant");
  }},
  { name: "buildTeacherPrompt includes SVG instructions", fn: () => {
    const prompt = buildTeacherPrompt([{ title: "L1", items: [{ id: "i1", title: "T", slides: [{ blocks: [] }] }] }], "i1", 0);
    return prompt.includes("SVG") && prompt.includes("viewBox");
  }},
  { name: "buildTeacherPrompt includes slide content", fn: () => {
    const prompt = buildTeacherPrompt([{ title: "L1", items: [{ id: "i1", title: "Agents", slides: [{ blocks: [{ type: "heading", text: "ReAct" }] }] }] }], "i1", 0);
    return prompt.includes("ReAct") && prompt.includes("Agents");
  }},

  // ── Reducer ──
  { name: "innerReducer is function", fn: () => typeof innerReducer === "function" },
  { name: "reducer (with undo) is function", fn: () => typeof reducer === "function" },
  { name: "Reducer handles ADD_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [] }] }], selectedId: "i1", slideIndex: 0 };
    const r = innerReducer(s, { type: "ADD_SLIDE", id: "i1", slide: { blocks: [] } });
    return r.lanes[0].items[0].slides.length === 1;
  }},
  { name: "Reducer handles REMOVE_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [{ blocks: [] }, { blocks: [] }] }] }], selectedId: "i1", slideIndex: 1 };
    const r = innerReducer(s, { type: "REMOVE_SLIDE", id: "i1", index: 0 });
    return r.lanes[0].items[0].slides.length === 1;
  }},
  { name: "Reducer handles UPDATE_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [{ blocks: [], bg: "#000" }] }] }], selectedId: "i1", slideIndex: 0 };
    const r = innerReducer(s, { type: "UPDATE_SLIDE", id: "i1", index: 0, patch: { bg: "#fff", blocks: [{ type: "heading", text: "Hi" }] } });
    return r.lanes[0].items[0].slides[0].bg === "#fff";
  }},
  { name: "Reducer handles DUPLICATE_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [{ blocks: [{ type: "heading", text: "X" }] }] }] }], selectedId: "i1", slideIndex: 0 };
    const r = innerReducer(s, { type: "DUPLICATE_SLIDE", id: "i1", index: 0 });
    return r.lanes[0].items[0].slides.length === 2;
  }},
  { name: "Reducer handles MOVE_SLIDE", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "i1", slides: [{ blocks: [], _t: "a" }, { blocks: [], _t: "b" }] }] }], selectedId: "i1", slideIndex: 0 };
    const r = innerReducer(s, { type: "MOVE_SLIDE", id: "i1", from: 0, dir: 1 });
    return r.lanes[0].items[0].slides[0]._t === "b";
  }},

  // ── Sprint 7-1: section DnD / add-menu / empty-section drop ──
  { name: "ADD_ITEM appends by default", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "a", order: 1, slides: [] }, { id: "b", order: 2, slides: [] }] }] };
    const r = innerReducer(s, { type: "ADD_ITEM", laneId: "l1", title: "C" });
    const items = r.lanes[0].items;
    return items.length === 3 && items[items.length - 1].title === "C";
  }},
  { name: "ADD_ITEM beforeId inserts at position", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "a", order: 1, slides: [] }, { id: "b", order: 2, slides: [] }] }] };
    const r = innerReducer(s, { type: "ADD_ITEM", laneId: "l1", title: "X", beforeId: "b" });
    const items = [...r.lanes[0].items].sort((p, q) => p.order - q.order);
    return items[1].title === "X" && items[2].id === "b" && items.every((it, i) => it.order === i + 1);
  }},
  { name: "ADD_ITEM afterId + select inserts after and selects", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "a", order: 1, slides: [] }, { id: "b", order: 2, slides: [] }] }], selectedId: null };
    const r = innerReducer(s, { type: "ADD_ITEM", laneId: "l1", title: "Y", afterId: "a", select: true });
    const items = [...r.lanes[0].items].sort((p, q) => p.order - q.order);
    return items[1].title === "Y" && r.selectedId === items[1].id;
  }},
  { name: "DRAG_REORDER moves section before target", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "a", order: 1, slides: [] }, { id: "b", order: 2, slides: [] }, { id: "c", order: 3, slides: [] }] }] };
    const r = innerReducer(s, { type: "DRAG_REORDER", id: "c", targetLaneId: "l1", beforeId: "a", afterId: null });
    const order = [...r.lanes[0].items].sort((p, q) => p.order - q.order).map((i) => i.id);
    return order.join(",") === "c,a,b";
  }},
  { name: "MOVE_SLIDE_TO_MODULE drops slide into empty section", fn: () => {
    const s = { lanes: [{ id: "l1", items: [{ id: "src", slides: [{ blocks: [{ type: "heading", text: "S1" }] }] }, { id: "empty", slides: [] }] }] };
    const r = innerReducer(s, { type: "MOVE_SLIDE_TO_MODULE", fromId: "src", toId: "empty", index: 0, toIndex: 0 });
    const items = r.lanes[0].items;
    return items[0].slides.length === 0 && items[1].slides.length === 1 && r.selectedId === "empty";
  }},
  { name: "buildBlankSlide reuses styling, blank blocks", fn: () => {
    const blank = buildBlankSlide({ bg: "#123456", accent: "#abcdef", blocks: [{ type: "heading", text: "old" }], comments: [{ id: "c" }] });
    return blank.bg === "#123456" && blank.accent === "#abcdef" && Array.isArray(blank.blocks) && blank.blocks.length === 0 && !blank.comments;
  }},
  { name: "buildBlankSlide handles no previous slide", fn: () => {
    const blank = buildBlankSlide(null);
    return Array.isArray(blank.blocks) && blank.blocks.length === 0;
  }},

  // ── v10: Reducer — Teacher Mode & veraMode ──
  { name: "Reducer init has veraMode=editor", fn: () => init.veraMode === "editor" },
  { name: "Reducer init has teacherHistory={}", fn: () => typeof init.teacherHistory === "object" && Object.keys(init.teacherHistory).length === 0 },
  { name: "Reducer SET_VERA_MODE switches to student", fn: () => {
    const r = innerReducer(init, { type: "SET_VERA_MODE", mode: "student" });
    return r.veraMode === "student" && typeof r.teacherHistory === "object";
  }},
  { name: "Reducer SET_VERA_MODE switches back to editor", fn: () => {
    const s = { ...init, veraMode: "student", teacherHistory: { "x-0": [{ role: "assistant", content: "hi" }] } };
    const r = innerReducer(s, { type: "SET_VERA_MODE", mode: "editor" });
    return r.veraMode === "editor" && Object.keys(r.teacherHistory).length === 0;
  }},
  { name: "Reducer TEACHER_MSG adds to keyed history", fn: () => {
    const r = innerReducer(init, { type: "TEACHER_MSG", key: "s1-0", role: "assistant", content: "hello", questions: ["Q1?"] });
    return r.teacherHistory["s1-0"]?.length === 1 && r.teacherHistory["s1-0"][0].content === "hello" && r.teacherHistory["s1-0"][0].questions[0] === "Q1?";
  }},
  { name: "Reducer TEACHER_MSG preserves other slide keys", fn: () => {
    const s = { ...init, teacherHistory: { "s1-0": [{ role: "assistant", content: "a" }] } };
    const r = innerReducer(s, { type: "TEACHER_MSG", key: "s1-1", role: "assistant", content: "b" });
    return r.teacherHistory["s1-0"]?.length === 1 && r.teacherHistory["s1-1"]?.length === 1;
  }},
  { name: "Reducer TEACHER_LOADING toggles", fn: () => {
    const r = innerReducer(init, { type: "TEACHER_LOADING", value: true });
    return r.teacherLoading === true;
  }},
  { name: "Reducer TEACHER_CLEAR clears only target key", fn: () => {
    const s = { ...init, teacherHistory: { "s1-0": [{ role: "assistant", content: "a" }], "s1-1": [{ role: "assistant", content: "b" }] } };
    const r = innerReducer(s, { type: "TEACHER_CLEAR", key: "s1-0" });
    return r.teacherHistory["s1-0"]?.length === 0 && r.teacherHistory["s1-1"]?.length === 1;
  }},

  // ── Components exist ──
  { name: "SlidePanel component exists", fn: () => typeof SlidePanel === "function" },
  { name: "ModuleList component exists", fn: () => typeof ModuleList === "function" },
  { name: "ConceptRow component exists", fn: () => typeof ConceptRow === "function" },
  { name: "App component exists", fn: () => typeof App === "function" },
  { name: "FullscreenSlide component exists", fn: () => typeof FullscreenSlide === "function" },
  { name: "FullscreenSlide component exists", fn: () => typeof FullscreenSlide === "function" },
  { name: "getSlideSource returns source info", fn: () => typeof getSlideSource === "function" },
  { name: "RenderBlock component exists", fn: () => typeof RenderBlock === "function" },
  { name: "BrandingPanel component exists", fn: () => typeof BrandingPanel === "function" },

  // ── v10: Components ──
  { name: "TeacherPanel component exists", fn: () => typeof TeacherPanel === "function" },
  { name: "TeacherMessage component exists", fn: () => typeof TeacherMessage === "function" },
  { name: "GalleryView component exists", fn: () => typeof GalleryView === "function" },
  { name: "getSlideTitle function exists", fn: () => typeof getSlideTitle === "function" },
  { name: "getSlideTitle extracts heading", fn: () => {
    const title = getSlideTitle({ blocks: [{ type: "heading", text: "My Title" }] }, 0);
    return title === "My Title";
  }},
  { name: "getSlideTitle falls back to index", fn: () => {
    const title = getSlideTitle({ blocks: [{ type: "spacer", h: 8 }] }, 3);
    return title === "Slide 4";
  }},

  // ── Icons ──
  { name: "Icon components available (lucide-react)", fn: () => {
    try { return [ChevronLeft, ChevronRight, Plus, X, Maximize2, Minimize2, Presentation].every((c) => typeof c === "function" || typeof c === "object"); }
    catch { return false; }
  }},
  { name: "VelaIcon exists", fn: () => typeof VelaIcon === "function" },

  // ── Feature: Scroll navigation", fn: () => true ──
  { name: "Scroll nav (wheel handler) exists in SlidePanel", fn: () => {
    // Check by rendering — we just verify the component string has wheel reference
    const src = SlidePanel.toString();
    return src.includes("wheel") || src.includes("onWheel") || src.includes("SCROLL");
  }},

  // ── Feature: F5 intercept ──
  { name: "F5 key handled", fn: () => SlidePanel.toString().includes("F5") },

  // ── Feature: Delete key ──
  { name: "Delete key handler exists", fn: () => SlidePanel.toString().includes("Delete") },
];

function VelaBatteryTest() {
  const [results, setResults] = useState(null);
  const [show, setShow] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Run tests after brief delay to let everything mount
    const timer = setTimeout(() => {
      const res = VELA_TESTS.map((t) => {
        try { return { name: t.name, pass: !!t.fn(), error: null }; }
        catch (e) { return { name: t.name, pass: false, error: e.message }; }
      });
      setResults(res);
      if (res.every((r) => r.pass)) setTimeout(() => setShow(false), 3000);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  if (!results || !show) return null;

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const allGood = failed === 0;

  const copyDetails = () => {
    const lines = [
      `VELA v${VELA_VERSION} Battery Test — ${new Date().toISOString()}`,
      `Result: ${passed}/${results.length} passed${failed > 0 ? ` | ${failed} FAILED` : ""}`,
      "",
      ...results.map((r) => `${r.pass ? "✅" : "❌"} ${r.name}${r.error ? ` — ${r.error}` : ""}`),
    ];
    velaClipboard(lines.join("\n")); setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, fontFamily: FONT.mono }}>
      {/* Toast notification */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 14px", borderRadius: 8,
        background: allGood ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)",
        color: "#fff", fontSize: 12, fontWeight: 700,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)", backdropFilter: "blur(8px)",
        animation: "fade-in 0.3s ease",
        cursor: "pointer",
      }} onClick={() => setShow(false)}>
        <span style={{ fontSize: 16 }}>{allGood ? "✅" : "❌"}</span>
        <span>Battery: {passed}/{results.length}{failed > 0 ? ` (${failed} fail)` : " OK"}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>v{VELA_VERSION}</span>
        <button onClick={(e) => { e.stopPropagation(); copyDetails(); }} style={{
          background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)",
          color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer",
          fontSize: 10, fontFamily: FONT.mono, fontWeight: 600,
        }}>{copied ? "Copied!" : "📋 Copy"}</button>
        {allGood && <button onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("vela-run-uitests")); setShow(false); }} style={{
          background: "rgba(59,130,246,0.4)", border: "1px solid rgba(59,130,246,0.6)",
          color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer",
          fontSize: 10, fontFamily: FONT.mono, fontWeight: 600,
        }}>🧪 UI Tests</button>}
        <button onClick={(e) => { e.stopPropagation(); setShow(false); }} style={{
          background: "none", border: "none", color: "rgba(255,255,255,0.6)",
          cursor: "pointer", fontSize: 14, padding: "0 2px",
        }}>✕</button>
      </div>
      {/* Failed test quick list */}
      {failed > 0 && (
        <div style={{
          padding: "6px 10px", borderRadius: 6,
          background: "rgba(0,0,0,0.85)", border: "1px solid rgba(239,68,68,0.4)",
          maxWidth: 320, maxHeight: 200, overflowY: "auto",
        }}>
          {results.filter((r) => !r.pass).map((r, i) => (
            <div key={i} style={{ fontSize: 9, color: "#f87171", padding: "2px 0", lineHeight: 1.4 }}>
              ❌ {r.name}{r.error ? ` — ${r.error}` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

