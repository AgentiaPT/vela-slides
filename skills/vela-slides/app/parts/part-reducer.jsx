// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Reducer ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const init = { deckTitle: "Untitled", guidelines: "", lanes: [], selectedId: null, slideIndex: 0, fullscreen: false, fontScale: 1, chatOpen: false, chatMessages: [{ role: "assistant", content: "Welcome aboard Vela. Paste your agenda or tell me where we're sailing. ⛵🖖", ts: now() }], chatLoading: false, lastDebug: "", branding: { ...defaultBranding }, veraMode: "editor", teacherHistory: {}, teacherLoading: false };

const NO_HISTORY = new Set(["SELECT", "SET_SLIDE_INDEX", "SET_FULLSCREEN", "SET_FONT_SCALE", "DESELECT", "SET_CHAT", "ADD_MSG", "SET_LOADING", "SET_DEBUG", "TOGGLE_LANE", "LOAD", "SET_TITLE", "STREAM_TOOL", "FINALIZE_STREAM", "RESET_CHAT", "NEW_DECK", "CLEAR_BOOTSTRAP", "SET_VERA_MODE", "TEACHER_MSG", "TEACHER_LOADING", "TEACHER_CLEAR"]);
const MAX_HISTORY = 50;

function innerReducer(state, a) {
  const mapItems = (fn) => ({ ...state, lanes: state.lanes.map((l) => ({ ...l, items: l.items.map(fn) })) });
  switch (a.type) {
    // BUG FIX v12: clamp slideIndex on LOAD to prevent stale index pointing at deleted slides
    case "LOAD": {
      _fullRewrite = true;
      // Mark all modules as loaded (safe to save)
      if (a.payload?.lanes) for (const l of a.payload.lanes) for (const i of l.items) _loadedMods.add(i.id);
      const loaded = { ...state, ...a.payload, veraMode: "editor", teacherHistory: {}, teacherLoading: false };
      if (loaded.selectedId && loaded.slideIndex > 0) {
        let maxSlides = 0;
        for (const l of loaded.lanes) { const it = l.items.find((i) => i.id === loaded.selectedId); if (it) { maxSlides = it.slides?.length || 0; break; } }
        if (loaded.slideIndex >= maxSlides) loaded.slideIndex = Math.max(0, maxSlides - 1);
      }
      return loaded;
    }
    case "ADD_LANE": { if (state.lanes.find((l) => l.title.toLowerCase() === a.title.toLowerCase())) return state; return { ...state, lanes: [...state.lanes, { id: uid(), title: a.title, collapsed: false, items: [] }] }; }
    case "REMOVE_LANE": { const rl = state.lanes.find((l) => l.id === a.id); if (rl) rl.items.forEach((i) => _deletedMods.add(i.id)); return { ...state, lanes: state.lanes.filter((l) => l.id !== a.id), selectedId: null }; }
    case "RENAME_LANE": return { ...state, lanes: state.lanes.map((l) => l.id === a.id ? { ...l, title: a.title } : l) };
    case "SET_ITEM_NOTES": return mapItems((i) => i.id === a.id ? { ...i, notes: a.notes } : i);
    case "TOGGLE_LANE": return { ...state, lanes: state.lanes.map((l) => l.id === a.id ? { ...l, collapsed: !l.collapsed } : l) };
    case "ADD_ITEM": { const lane = state.lanes.find((l) => l.id === a.laneId); if (!lane) return state; const nid = uid(); if (a.slides?.length) _dirtyMods.add(nid); _loadedMods.add(nid); return { ...state, lanes: state.lanes.map((l) => l.id === a.laneId ? { ...l, items: [...l.items, { id: nid, title: a.title, notes: a.notes || "", status: "todo", importance: a.importance || "should", order: lane.items.length + 1, slides: a.slides || [], createdAt: now() }] } : l) }; }
    case "IMPORT_CONCEPTS": {
      let lanes = state.lanes.length > 0 ? [...state.lanes] : [{ id: uid(), title: "Imported", items: [] }];
      const laneId = lanes[0].id;
      const newItems = (a.concepts || []).map((c) => {
        const nid = uid();
        if (c.slides?.length) _dirtyMods.add(nid);
        return { id: nid, title: c.title || "Imported", status: "todo", importance: "should",
        order: lanes[0].items.length + 1, slides: Array.isArray(c.slides) ? c.slides : [], createdAt: now() };
      });
      lanes = lanes.map((l) => l.id === laneId ? { ...l, items: [...l.items, ...newItems] } : l);
      return { ...state, lanes, selectedId: newItems[0]?.id || state.selectedId, slideIndex: 0 };
    }
    case "BATCH_ADD": { const lane = state.lanes.find((l) => l.id === a.laneId); if (!lane) return state; let o = lane.items.length + 1; const items = a.items.map((it, i) => { const nid = uid(); const sl = (typeof it === "object" && it.slides) || []; if (sl.length) _dirtyMods.add(nid); return { id: nid, title: typeof it === "string" ? it : it.title, status: "todo", importance: (typeof it === "object" && it.importance) || "should", order: o + i, slides: sl, createdAt: now() }; }); return { ...state, lanes: state.lanes.map((l) => l.id === a.laneId ? { ...l, items: [...l.items, ...items] } : l) }; }
    case "REMOVE_ITEM": _deletedMods.add(a.id); return { ...state, lanes: state.lanes.map((l) => ({ ...l, items: l.items.filter((i) => i.id !== a.id) })), selectedId: state.selectedId === a.id ? null : state.selectedId };
    case "RENAME_ITEM": return mapItems((i) => i.id === a.id ? { ...i, title: a.title } : i);
    case "CYCLE_STATUS": return mapItems((i) => { if (i.id !== a.id) return i; const next = STATUS_META[i.status].next; if (!next) return i; return { ...i, status: next, ...(next === "signed-off" ? { signedOffAt: now() } : next === "todo" ? { signedOffAt: undefined } : {}) }; });
    case "SET_STATUS": case "SET_IMPORTANCE": return mapItems((i) => i.id === a.id ? { ...i, ...(a.status ? { status: a.status } : {}), ...(a.importance ? { importance: a.importance } : {}) } : i);
    case "TOGGLE_PRESENT_CARD": return mapItems((i) => i.id === a.id ? { ...i, presentCard: !i.presentCard } : i);
    case "MOVE_ITEM": { let moved = null; const without = state.lanes.map((l) => { const f = l.items.find((i) => i.id === a.id); if (f) moved = f; return { ...l, items: l.items.filter((i) => i.id !== a.id) }; }); if (!moved) return state; return { ...state, lanes: without.map((l) => l.id === a.targetLaneId ? { ...l, items: [...l.items, moved] } : l) }; }
    case "REORDER": return { ...state, lanes: state.lanes.map((l) => { const sorted = [...l.items].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)); const idx = sorted.findIndex((i) => i.id === a.id); if (idx < 0) return l; const t = a.dir === "up" ? idx - 1 : idx + 1; if (t < 0 || t >= sorted.length) return l; const items = [...sorted]; [items[idx], items[t]] = [items[t], items[idx]]; return { ...l, items: items.map((it, i) => ({ ...it, order: i + 1 })) }; }) };
    case "DRAG_REORDER": {
      let moved = null;
      const without = state.lanes.map((l) => { const f = l.items.find((i) => i.id === a.id); if (f) moved = f; return { ...l, items: l.items.filter((i) => i.id !== a.id) }; });
      if (!moved) return state;
      return { ...state, lanes: without.map((l) => {
        if (l.id !== a.targetLaneId) return l;
        const sorted = [...l.items].sort((x, y) => (x.order ?? 999) - (y.order ?? 999));
        let insertIdx = sorted.length;
        if (a.beforeId) { const bi = sorted.findIndex((i) => i.id === a.beforeId); if (bi >= 0) insertIdx = bi; }
        else if (a.afterId) { const ai = sorted.findIndex((i) => i.id === a.afterId); if (ai >= 0) insertIdx = ai + 1; }
        sorted.splice(insertIdx, 0, moved);
        return { ...l, items: sorted.map((it, i) => ({ ...it, order: i + 1 })) };
      }) };
    }
    case "SET_SLIDES": _dirtyMods.add(a.id); return mapItems((i) => i.id === a.id ? { ...i, slides: a.slides } : i);
    case "ADD_SLIDE": _dirtyMods.add(a.id); return mapItems((i) => i.id === a.id ? { ...i, slides: [...i.slides, a.slide] } : i);
    case "INSERT_SLIDE": _dirtyMods.add(a.id); return mapItems((i) => { if (i.id !== a.id) return i; const ns = [...i.slides]; ns.splice(a.index, 0, a.slide); return { ...i, slides: ns }; });
    case "UPDATE_SLIDE": _dirtyMods.add(a.id); return mapItems((i) => i.id === a.id ? { ...i, slides: i.slides.map((s, idx) => { if (idx !== a.index) return s; const p = a.patch || {}; const updated = a.merge ? { ...s, ...p } : { title: s.title, duration: s.duration, ...p }; if (s.timeLock && !a.merge && !("timeLock" in p)) { updated.timeLock = true; updated.duration = s.duration; } return updated; }) } : i);
    case "REMOVE_SLIDE": _dirtyMods.add(a.id); return mapItems((i) => i.id === a.id ? { ...i, slides: i.slides.filter((_, idx) => idx !== a.index) } : i);
    case "DUPLICATE_SLIDE": _dirtyMods.add(a.id); return mapItems((i) => { if (i.id !== a.id || !i.slides[a.index]) return i; const dup = JSON.parse(JSON.stringify(i.slides[a.index])); const ns = [...i.slides]; ns.splice(a.index + 1, 0, dup); return { ...i, slides: ns }; });
    case "MOVE_SLIDE": _dirtyMods.add(a.id); return mapItems((i) => { if (i.id !== a.id) return i; const ns = [...i.slides]; const t = a.from + a.dir; if (t < 0 || t >= ns.length) return i; [ns[a.from], ns[t]] = [ns[t], ns[a.from]]; return { ...i, slides: ns }; });
    case "REORDER_SLIDE": _dirtyMods.add(a.id); return mapItems((i) => { if (i.id !== a.id) return i; const ns = [...i.slides]; const [moved] = ns.splice(a.from, 1); ns.splice(a.to, 0, moved); return { ...i, slides: ns }; });
    case "MOVE_SLIDE_TO_MODULE": { let slide = null; _dirtyMods.add(a.fromId); _dirtyMods.add(a.toId); return { ...state, lanes: state.lanes.map((l) => ({ ...l, items: l.items.map((i) => { if (i.id === a.fromId) { slide = i.slides[a.index]; return { ...i, slides: i.slides.filter((_, idx) => idx !== a.index) }; } return i; }).map((i) => { if (i.id === a.toId && slide) { if (a.toIndex != null) { const _ns = [...i.slides]; _ns.splice(a.toIndex, 0, slide); return { ...i, slides: _ns }; } return { ...i, slides: [...i.slides, slide] }; } return i; }) })), selectedId: a.toId, slideIndex: a.toIndex != null ? a.toIndex : (() => { for (const l of state.lanes) { const it = l.items.find((i) => i.id === a.toId); if (it) return it.slides?.length || 0; } return 0; })() }; }
    case "SELECT": return { ...state, selectedId: a.id, slideIndex: a.slideIndex ?? 0 };
    case "SET_SLIDE_INDEX": return { ...state, slideIndex: a.index };
    case "SET_FULLSCREEN": return { ...state, fullscreen: a.value, fontScale: a.value ? state.fontScale : 1 };
    case "SET_FONT_SCALE": return { ...state, fontScale: a.value };
    case "DESELECT": return { ...state, selectedId: null, slideIndex: 0, fullscreen: false, fontScale: 1 };
    case "SET_CHAT": return { ...state, chatOpen: a.open };
    case "RESET_CHAT": return { ...state, chatMessages: [{ role: "assistant", content: "Chat cleared. What's next? ⛵🖖", ts: now() }], chatLoading: false };
    case "NEW_DECK": {
      _fullRewrite = true;
      return { ...init, deckTitle: a.title || "Untitled", chatOpen: true, chatMessages: [{ role: "assistant", content: "Setting sail on a new deck — let me build this for you. ⛵🖖", ts: now() }], _bootstrap: { prompt: a.prompt, images: a.images || [] } };
    }
    case "CLEAR_BOOTSTRAP": return { ...state, _bootstrap: null };
    case "SET_VERA_MODE": return { ...state, veraMode: a.mode, teacherHistory: {}, teacherLoading: false };
    case "TEACHER_MSG": { const k = a.key || "default"; const prev = state.teacherHistory[k] || []; return { ...state, teacherHistory: { ...state.teacherHistory, [k]: [...prev, { role: a.role, content: a.content, questions: a.questions || null, ts: now() }] } }; }
    case "TEACHER_LOADING": return { ...state, teacherLoading: a.value };
    case "TEACHER_CLEAR": { const k = a.key || "default"; return { ...state, teacherHistory: { ...state.teacherHistory, [k]: [] }, teacherLoading: false }; }
    case "ADD_MSG": return { ...state, chatMessages: [...state.chatMessages, { role: a.role, content: a.content, images: a.images || null, jumps: a.jumps || null, tools: a.tools || null, _streaming: a._streaming || false, _thinking: false, ts: now() }] };
    case "STREAM_TOOL": {
      const msgs = [...state.chatMessages];
      const last = msgs.length - 1;
      if (last < 0 || !msgs[last]._streaming) return state;
      const msg = { ...msgs[last] };
      if (a.event.type === "thinking") { msg._thinking = true; }
      else if (a.event.type === "calling") { msg._thinking = false; msg.tools = [...(msg.tools || []), { name: a.event.name, input: a.event.input, result: null, jump: null, index: a.event.index, status: "running" }]; }
      else if (a.event.type === "done") { msg.tools = (msg.tools || []).map((t) => t.index === a.event.index ? { ...t, result: a.event.result, jump: a.event.jump, status: "done" } : t); }
      msgs[last] = msg;
      return { ...state, chatMessages: msgs };
    }
    case "FINALIZE_STREAM": {
      const msgs = [...state.chatMessages];
      const last = msgs.length - 1;
      if (last < 0 || !msgs[last]._streaming) return state;
      msgs[last] = { ...msgs[last], content: typeof a.content === "string" ? a.content : String(a.content || ""), jumps: a.jumps, _streaming: false, _thinking: false };
      return { ...state, chatMessages: msgs };
    }
    case "SET_LOADING": return { ...state, chatLoading: a.value };
    case "SET_DEBUG": return { ...state, lastDebug: a.text };
    case "LOAD_LANES": return { ...state, lanes: a.lanes };
    case "SET_BRANDING": return { ...state, branding: { ...state.branding, ...a.branding } };
    case "SET_GUIDELINES": return { ...state, guidelines: a.guidelines };
    case "RESET": return { ...init, chatOpen: state.chatOpen };
    case "SET_TITLE": return { ...state, deckTitle: a.title };
    default: return state;
  }
}

const historyInit = { past: [], present: init, future: [] };

function reducer(hist, a) {
  if (a.type === "UNDO") {
    if (hist.past.length === 0) return hist;
    const prev = hist.past[hist.past.length - 1];
    // Force-clear loading state — if Vera was mid-flight, the async op is now stale
    const cleaned = { ...prev, chatLoading: false };
    // Clamp selectedId/slideIndex — restored state may reference modules/slides modified after snapshot
    if (cleaned.selectedId && cleaned.lanes) {
      let found = false;
      for (const l of cleaned.lanes) { const it = l.items.find((i) => i.id === cleaned.selectedId); if (it) { found = true; const max = (it.slides || []).length; if (cleaned.slideIndex >= max) cleaned.slideIndex = Math.max(0, max - 1); break; } }
      if (!found) {
        // Select first available module instead of null
        const firstItem = cleaned.lanes.flatMap(l => l.items)[0];
        cleaned.selectedId = firstItem?.id || null;
        cleaned.slideIndex = 0;
      }
    }
    // Finalize any streaming assistant message so UI isn't stuck
    if (cleaned.chatMessages?.length > 0) {
      const last = cleaned.chatMessages[cleaned.chatMessages.length - 1];
      if (last._streaming) {
        cleaned.chatMessages = [...cleaned.chatMessages];
        cleaned.chatMessages[cleaned.chatMessages.length - 1] = { ...last, _streaming: false, _thinking: false, content: last.content || "(undone)" };
      }
    }
    // Inject undo marker so Vera knows deck state was reverted
    cleaned.chatMessages = [...(cleaned.chatMessages || []), { role: "assistant", content: "⟲ Deck state was reverted by undo. My previous actions may no longer be reflected in the current slides.", ts: now(), _system: true }];
    return { past: hist.past.slice(0, -1), present: cleaned, future: [hist.present, ...hist.future].slice(0, MAX_HISTORY) };
  }
  if (a.type === "REDO") {
    if (hist.future.length === 0) return hist;
    const next = hist.future[0];
    const cleaned = { ...next, chatLoading: false };
    // Clamp selectedId/slideIndex
    if (cleaned.selectedId && cleaned.lanes) {
      let found = false;
      for (const l of cleaned.lanes) { const it = l.items.find((i) => i.id === cleaned.selectedId); if (it) { found = true; const max = (it.slides || []).length; if (cleaned.slideIndex >= max) cleaned.slideIndex = Math.max(0, max - 1); break; } }
      if (!found) {
        const firstItem = cleaned.lanes.flatMap(l => l.items)[0];
        cleaned.selectedId = firstItem?.id || null;
        cleaned.slideIndex = 0;
      }
    }
    if (cleaned.chatMessages?.length > 0) {
      const last = cleaned.chatMessages[cleaned.chatMessages.length - 1];
      if (last._streaming) {
        cleaned.chatMessages = [...cleaned.chatMessages];
        cleaned.chatMessages[cleaned.chatMessages.length - 1] = { ...last, _streaming: false, _thinking: false, content: last.content || "(redone)" };
      }
    }
    cleaned.chatMessages = [...(cleaned.chatMessages || []), { role: "assistant", content: "⟳ Deck state was restored by redo.", ts: now(), _system: true }];
    return { past: [...hist.past, hist.present].slice(-MAX_HISTORY), present: cleaned, future: hist.future.slice(1) };
  }
  const newPresent = innerReducer(hist.present, a);
  if (newPresent === hist.present) return hist;
  if (NO_HISTORY.has(a.type)) return { ...hist, present: newPresent };
  return { past: [...hist.past, hist.present].slice(-MAX_HISTORY), present: newPresent, future: [] };
}


