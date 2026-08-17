// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
export default function App() {
  const [dark, setDark] = useState(() => typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : true);
  T = dark ? themes.dark : themes.light;
  const [hist, rawDispatch] = useReducer(reducer, historyInit);
  const dispatch = useCallback((action) => {
    // Mark replacement before React processes its reducer queue. A promise can
    // settle in the same task as LOAD; this synchronous signal closes that gap.
    if (action && (action.type === "LOAD" || action.type === "NEW_DECK" || action.type === "RESET")) velaPrepareDeckReplacement();
    rawDispatch(action);
  }, []);
  const state = hist.present;
  velaSyncDeckEpoch(state._deckEpoch);
  const historyRef = useRef(hist);
  historyRef.current = hist;
  const demoUnavailableReason = getDemoUnavailableReason(state);
  const aiOk = useAIAvailable();
  IMG_SETTINGS = { maxWidth: state.branding?.imgMaxWidth ?? defaultBranding.imgMaxWidth, quality: state.branding?.imgQuality ?? defaultBranding.imgQuality };
  const [confirmReset, setConfirmReset] = useState(false);
  const loaded = useRef(false);
  const slideActionsRef = useRef(null);
  const [, forceRibbon] = useReducer((x) => x + 1, 0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [jsonModal, setJsonModal] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showStats, setShowStats] = useState(false);
  // CR: in a Claude.ai artifact the deck only lives in browser localStorage
  // (no file) — nudge users to export/back up. Dismiss persists for the
  // session (sessionStorage) so it doesn't reappear on every re-render but
  // does come back if the artifact is reloaded fresh.
  const [storageWarningDismissed, setStorageWarningDismissed] = useState(() => {
    try { return sessionStorage.getItem("vela-storage-warning-dismissed") === "1"; } catch { return false; }
  });
  const [newDeckDialog, setNewDeckDialog] = useState(false);
  const [pdfExport, setPdfExport] = useState(false);
  const [pptxExport, setPptxExport] = useState(false);
  const [standaloneExport, setStandaloneExport] = useState(false);
  const [mergeDialog, setMergeDialog] = useState(null); // { localDeck, patchDeck }
  const [mdIncludeNotes, setMdIncludeNotes] = useState(true);
  const [iconPicker, setIconPicker] = useState(null); // { value, onPick } — searchable icon picker
  const openIconPicker = useCallback((value, onPick) => setIconPicker({ value, onPick }), []);
  const fileInputRef = useRef(null);

  // ━━━ Local mode: two-way sync with serve.py ━━━━━━━━━━━━━━━━━━━━
  const localSyncTimer = useRef(null);
  const _localSyncIncoming = useRef(false);
  const _localSyncState = useRef(null);
  const postDemoFlushTimer = useRef(null);
  const postDemoFlushRequest = useRef(null);
  const postDemoFlushModes = useRef({ local: false, storage: false });
  const flushLocalStateRef = useRef(null);
  const flushStorageStateRef = useRef(null);
  const requestPostDemoFlushRef = useRef(null);
  _localSyncState.current = state; // always up-to-date

  const demoSaveLocked = () => document.documentElement.dataset.velaDemoRunning === "true";
  const stateForPostDemoFlush = (request) => {
    const current = _localSyncState.current;
    if (!request?.useCurrent) return request?.state;
    return current?._deckEpoch === request.epoch ? current : null;
  };
  flushLocalStateRef.current = (request, allowIncoming = false) => {
    if (!loaded.current || demoSaveLocked() || (!allowIncoming && _localSyncIncoming.current)) return false;
    const source = request ? stateForPostDemoFlush(request) : _localSyncState.current;
    if (!source || !window.__velaSendDeckUpdate) return false;
    const save = extractSave(source);
    // Never let an empty or transient deck overwrite the local source file.
    const totalSlides = (save.lanes || []).reduce((n, l) => n + (l.items || []).reduce((m, i) => m + (i.slides?.length || 0), 0), 0);
    if (!save.lanes?.length || !totalSlides) return false;
    delete save.chatMessages; delete save.chatLoading; delete save.fullscreen;
    delete save.lastDebug; delete save._bootstrap; delete save._version;
    try {
      window.__velaSendDeckUpdate({ deckTitle: source.deckTitle, lanes: save.lanes, branding: save.branding, guidelines: save.guidelines });
      return true;
    } catch (error) {
      dbg("Local save error:", error);
      return false;
    }
  };
  flushStorageStateRef.current = (request) => {
    if (!loaded.current || demoSaveLocked()) return false;
    const source = request ? stateForPostDemoFlush(request) : _localSyncState.current;
    if (!source) return false;
    const save = extractSave(source);
    save.chatMessages = (save.chatMessages || []).map((m) => m.images ? { ...m, images: m.images.map(() => "[img]") } : m);
    save._version = 3;
    try {
      saveKV(MASTER_KEY, save);
      return true;
    } catch (error) {
      dbg("Storage save error:", error);
      return false;
    }
  };
  requestPostDemoFlushRef.current = (request, modes = { local: VELA_LOCAL_MODE, storage: !VELA_LOCAL_MODE }) => {
    if (!request?.state) return false;
    postDemoFlushRequest.current = request;
    postDemoFlushModes.current = {
      local: postDemoFlushModes.current.local || !!modes.local,
      storage: postDemoFlushModes.current.storage || !!modes.storage,
    };
    clearTimeout(postDemoFlushTimer.current);
    const attempt = () => {
      if (demoSaveLocked() || (postDemoFlushModes.current.local && _localSyncIncoming.current)) {
        postDemoFlushTimer.current = setTimeout(attempt, 100);
        return;
      }
      const pendingRequest = postDemoFlushRequest.current;
      const pendingModes = postDemoFlushModes.current;
      postDemoFlushRequest.current = null;
      postDemoFlushModes.current = { local: false, storage: false };
      if (pendingModes.local) flushLocalStateRef.current?.(pendingRequest, true);
      if (pendingModes.storage) flushStorageStateRef.current?.(pendingRequest);
    };
    attempt();
    return true;
  };

  useEffect(() => {
    return () => {
      clearTimeout(postDemoFlushTimer.current);
      const pendingRequest = postDemoFlushRequest.current;
      const pendingModes = postDemoFlushModes.current;
      if (pendingRequest && !demoSaveLocked()) {
        if (pendingModes.local) flushLocalStateRef.current?.(pendingRequest, true);
        if (pendingModes.storage) flushStorageStateRef.current?.(pendingRequest);
      }
      postDemoFlushRequest.current = null;
      postDemoFlushModes.current = { local: false, storage: false };
    };
  }, []);

  // ━━━ Desktop save-status (Neutralino) ━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // deck-io reports every save transition through window.__velaOnSaveStatus so
  // a failed/stalled file write is NEVER silent (the reported Windows bug). Null
  // outside the desktop shell (artifact / serve.py never emit) → pill hidden.
  const [saveStatus, setSaveStatus] = useState(() => {
    try { return (typeof window !== "undefined" && window.__velaSaveState) || null; } catch { return null; }
  });
  const [saveFailToast, setSaveFailToast] = useState(false);
  const saveFailToastTimer = useRef(null);
  const prevSaveStateRef = useRef(saveStatus && saveStatus.state);
  // CR3/D6: armed = a failure toast is allowed to fire. It disarms once shown and
  // only re-arms after a genuine `saved` transition — so reconnecting→failed (with
  // no successful save in between) never re-raises a dismissed toast.
  const saveFailToastArmed = useRef(true);

  // Expose UI context for channel bridge (browser → Claude Code)
  useEffect(() => {
    if (!VELA_LOCAL_MODE) return;
    window.__velaGetCurrentSlide = () => {
      const s = _localSyncState.current;
      if (!s || !s.selectedId) return null;
      let slideNum = 0;
      for (const lane of (s.lanes || [])) {
        for (const item of (lane.items || [])) {
          for (let si = 0; si < (item.slides || []).length; si++) {
            slideNum++;
            if (item.id === s.selectedId && si === s.slideIndex) {
              const slide = item.slides[si];
              const heading = (slide.blocks || []).find(b => b.type === "heading");
              return {
                slide_number: slideNum,
                slide_index: s.slideIndex,
                module_title: item.title,
                slide_title: heading ? heading.text : (slide.title || `Slide ${slideNum}`),
                block_count: (slide.blocks || []).length,
                block_types: (slide.blocks || []).filter(b => b.type !== "spacer").map(b => b.type),
              };
            }
          }
        }
      }
      return null;
    };
    return () => { window.__velaGetCurrentSlide = null; };
  }, []);

  // VELA:DEV-ONLY:BEGIN
  // ━━━ Test-only affordances — DEV BUILDS ONLY ━━━━━━━━━━━━━━━━━━━━━
  // The UI battery drives a handful of states that have no offline UI path
  // (study notes, block injection, the unified AI-working flag). These are
  // writable globals, so they are kept off the production surface by TWO
  // independent layers (ASVS V14.1.3 / V14.2.2):
  //   1. runtime gate — installed only in local/desktop mode, or when a test
  //      harness explicitly opts in by setting window.__velaTestMode BEFORE
  //      the app boots (vela-drive.js does this via addInitScript);
  //   2. build-time strip — concat.py --release drops this whole fenced block,
  //      so a release bundle carries no test-hook code at all.
  // Keep every test affordance inside the fence, and keep the fenced code free
  // of anything the app itself depends on.
  useEffect(() => {
    if (!velaTestSurfaceEnabled()) return;
    const _patchCurrent = (patch) => {
      const s = _localSyncState.current;
      if (!s || !s.selectedId) return false;
      dispatch({ type: "UPDATE_SLIDE", id: s.selectedId, index: s.slideIndex, patch, merge: true });
      return true;
    };
    window.__velaTestHooks = {
      // Patch the current slide with a studyNotes object — lets the Study Notes
      // suite exercise the offline student-mode renderer without a live API.
      injectStudyNotes: (studyNotes) => _patchCurrent({ studyNotes }),
      // Replace the current slide's blocks (Editor UX / alignment suites: place
      // a known centered heading and assert the editor path renders it centered).
      injectBlocks: (blocks, extra) => _patchCurrent({ blocks, ...(extra || {}) }),
      // Keep the slide object identity while its block arrangement changes. This
      // reproduces storage/live-update renders that must not reuse old image caps.
      mutateBlocksInPlaceForTest: (blocks, extra) => {
        const s = _localSyncState.current;
        if (!s?.selectedId) return false;
        let selectedItem = null;
        for (const lane of (s.lanes || [])) {
          selectedItem = lane.items?.find((item) => item.id === s.selectedId) || null;
          if (selectedItem) break;
        }
        const currentSlide = selectedItem?.slides?.[s.slideIndex];
        if (!currentSlide) return false;
        currentSlide.blocks = blocks;
        Object.assign(currentSlide, extra || {});
        dispatch({ type: "SET_GUIDELINES", guidelines: s.guidelines });
        return true;
      },
      // On-screen slide identity {itemId, slideIdx, accent} for assertions.
      getSelection: () => {
        const s = _localSyncState.current;
        if (!s || !s.selectedId) return null;
        let accent = null;
        for (const l of (s.lanes || [])) { const it = (l.items || []).find((i) => i.id === s.selectedId); if (it) { accent = it.slides?.[s.slideIndex]?.accent || null; break; } }
        return { itemId: s.selectedId, slideIdx: s.slideIndex, accent };
      },
      getChatState: () => {
        const s = _localSyncState.current;
        return s ? {
          open: s.chatOpen,
          loading: s.chatLoading,
          debug: s.lastDebug,
          aiWork: s.aiWork,
          messages: s.chatMessages,
        } : null;
      },
      getVeraMode: () => _localSyncState.current?.veraMode || null,
      restoreStartupDeck: () => {
        if (!VELA_TEST_STARTUP_PATCH) return false;
        const raw = JSON.parse(JSON.stringify(VELA_TEST_STARTUP_PATCH));
        const sanitized = validateAndSanitizeDeck(raw);
        sanitized.deckTitle = sanitizeDeckTitle(raw.deckTitle);
        dispatch({ type: "LOAD", payload: sanitized });
        return true;
      },
      loadReplacementDeckForTest: () => {
        if (!VELA_TEST_STARTUP_PATCH) return false;
        const raw = JSON.parse(JSON.stringify(VELA_TEST_STARTUP_PATCH));
        raw.deckTitle = "Replacement deck sentinel";
        raw.guidelines = "replacement epoch retained";
        raw.branding = { ...(raw.branding || {}), accentColor: "#123456", footerLeft: "Replacement branding sentinel" };
        const rawFirstLane = raw.lanes?.[0];
        const rawFirstItem = rawFirstLane?.items?.[0];
        if (rawFirstLane) rawFirstLane.title = "Replacement lane sentinel";
        if (rawFirstItem) {
          rawFirstItem.title = "Replacement module sentinel";
          if (!Array.isArray(rawFirstItem.slides)) rawFirstItem.slides = [];
          rawFirstItem.slides[0] = { ...(rawFirstItem.slides[0] || {}), blocks: [{ type: "heading", text: "REPLACEMENT CONTENT SENTINEL", size: "2xl" }] };
          rawFirstItem.slides[1] = { ...(rawFirstItem.slides[1] || rawFirstItem.slides[0]), blocks: [{ type: "heading", text: "REPLACEMENT NAVIGATION SENTINEL", size: "2xl" }] };
        }
        const sanitized = validateAndSanitizeDeck(raw);
        sanitized.deckTitle = sanitizeDeckTitle(raw.deckTitle);
        sanitized.guidelines = "replacement epoch retained";
        const firstItem = sanitized.lanes?.[0]?.items?.[0];
        if (firstItem) {
          if (!firstItem.slides?.length) firstItem.slides = [{ blocks: [] }];
        }
        sanitized.selectedId = firstItem?.id || null;
        sanitized.slideIndex = 0;
        dispatch({ type: "LOAD", payload: sanitized });
        return true;
      },
      getDeckStateForTest: () => {
        const s = _localSyncState.current;
        const firstLane = s?.lanes?.[0];
        const firstItem = s?.lanes?.[0]?.items?.[0];
        let selectedItem = null;
        for (const lane of (s?.lanes || [])) {
          selectedItem = lane.items?.find((item) => item.id === s.selectedId) || null;
          if (selectedItem) break;
        }
        return s ? {
          deckTitle: s.deckTitle,
          guidelines: s.guidelines,
          firstLaneTitle: firstLane?.title || null,
          firstItemId: firstItem?.id || null,
          firstItemTitle: firstItem?.title || null,
          firstBlockText: firstItem?.slides?.[0]?.blocks?.[0]?.text || null,
          selectedBlockText: selectedItem?.slides?.[s.slideIndex]?.blocks?.[0]?.text || null,
          brandingAccentColor: s.branding?.accentColor || null,
          brandingFooterLeft: s.branding?.footerLeft || null,
          epoch: s._deckEpoch,
          selectedId: s.selectedId,
          slideIndex: s.slideIndex,
          fullscreen: !!s.fullscreen,
          veraMode: s.veraMode,
          chatLoading: s.chatLoading,
          teacherLoading: s.teacherLoading,
          aiWork: s.aiWork,
          chatMessages: JSON.parse(JSON.stringify(s.chatMessages || [])),
          teacherHistory: JSON.parse(JSON.stringify(s.teacherHistory || {})),
        } : null;
      },
      setChatOpenForTest: (open) => dispatch({ type: "SET_CHAT", open: !!open }),
      setVeraModeForTest: (mode) => dispatch({ type: "SET_VERA_MODE", mode }),
      installDeferredAgentTransport: () => {
        window.__velaDeferredAI?.restore?.();
        const originalReady = window.__velaAgentReady;
        const originalSend = window.__velaAgentSend;
        const calls = [];
        const control = {
          pending: () => calls.length,
          resolveNext: (reply) => {
            const call = calls.shift();
            if (!call) throw new Error("No deferred AI call is pending");
            call.resolve(reply);
          },
          rejectNext: (message) => {
            const call = calls.shift();
            if (!call) throw new Error("No deferred AI call is pending");
            call.reject(new Error(message || "Deferred AI failure"));
          },
          restore: () => {
            window.__velaAgentReady = originalReady;
            window.__velaAgentSend = originalSend;
            window.__velaDeferredAI = null;
            window.dispatchEvent(new Event("vela-agent-update"));
          },
        };
        window.__velaDeferredAI = control;
        window.__velaAgentReady = true;
        window.__velaAgentSend = (payload) => new Promise((resolve, reject) => calls.push({ payload, resolve, reject }));
        window.dispatchEvent(new Event("vela-agent-update"));
        return control;
      },
      getDeckEpoch: () => _localSyncState.current?._deckEpoch ?? null,
      resetDeckForTest: () => dispatch({ type: "RESET" }),
      newDeckForTest: () => dispatch({ type: "NEW_DECK", title: "Tour interruption", prompt: "", images: [] }),
      getGuidelinesForTest: () => _localSyncState.current?.guidelines || "",
      setGuidelinesForTest: (value) => dispatch({ type: "SET_GUIDELINES", guidelines: value }),
      capturePostDemoFlushForTest: () => {
        const current = _localSyncState.current;
        return current ? {
          state: JSON.parse(JSON.stringify(extractSave(current))),
          epoch: current._deckEpoch,
          useCurrent: true,
        } : null;
      },
      flushDemoSaveForTest: (request, modes) => requestPostDemoFlushRef.current?.(request, modes),
      getHistoryCounts: () => ({
        past: historyRef.current.past.length,
        future: historyRef.current.future.length,
      }),
      addTeacherMessage: (key, content) => dispatch({ type: "TEACHER_MSG", key, role: "user", content }),
      getTeacherHistory: () => JSON.parse(JSON.stringify(_localSyncState.current?.teacherHistory || {})),
      clearTeacherHistory: (key) => dispatch({ type: "TEACHER_CLEAR", key }),
      // Drive the unified AI-working flag without a live AI backend, so the
      // vera-thinking / magic-reveal contract is assertable offline.
      setAIWork: (value) => { dispatch({ type: "SET_AI_WORK", value: value || null }); return true; },
    };
    return () => { window.__velaTestHooks = null; };
  }, [dispatch]);
  // VELA:DEV-ONLY:END

  // Send deck changes to local server (browser → file)
  useEffect(() => {
    // Always cancel pending sync-out timers first — a stale timer captures
    // the OLD deck via closure and would write it to the NEW file path after
    // a deck switch (the _localSyncIncoming guard skips setting a new timer
    // but must still kill the old one).
    clearTimeout(localSyncTimer.current);
    if (!VELA_LOCAL_MODE || !loaded.current || _localSyncIncoming.current ||
        document.documentElement.dataset.velaDemoRunning === "true") return;
    localSyncTimer.current = setTimeout(() => flushLocalStateRef.current?.(null), 600);
    return () => clearTimeout(localSyncTimer.current);
  }, [state.lanes, state.branding, state.deckTitle, state.guidelines]);

  // Receive deck updates from local server (file → browser)
  useEffect(() => {
    if (!VELA_LOCAL_MODE) return;
    window.__velaReceiveDeckUpdate = (deck) => {
      if (!deck || !deck.lanes) return;
      _localSyncIncoming.current = true;
      try {
        const cur = _localSyncState.current;
        const sanitized = validateAndSanitizeDeck(deck);
        // Preserve lane/item IDs so selection stays valid
        if (cur.lanes && sanitized.lanes && cur.lanes.length === sanitized.lanes.length) {
          for (let li = 0; li < sanitized.lanes.length; li++) {
            sanitized.lanes[li].id = cur.lanes[li].id;
            if (sanitized.lanes[li].items && cur.lanes[li].items) {
              const minItems = Math.min(sanitized.lanes[li].items.length, cur.lanes[li].items.length);
              for (let ii = 0; ii < minItems; ii++) {
                sanitized.lanes[li].items[ii].id = cur.lanes[li].items[ii].id;
              }
            }
          }
        }
        // Check if this is a different deck (picker switch) vs same-deck external edit
        const isDifferentDeck = !cur.lanes?.length || cur.lanes.length !== sanitized.lanes.length ||
          sanitized.lanes.some((sl, li) => sl.items?.length !== cur.lanes[li]?.items?.length);
        // Only update CONTENT fields — preserve ALL UI state
        const payload = {
          ...cur,                                                    // keep everything
          lanes: sanitized.lanes,                                    // update content
          deckTitle: deck.deckTitle || cur.deckTitle,                 // update title
          branding: deck.branding ? { ...defaultBranding, ...sanitized.branding } : cur.branding, // sanitized (scrubbed) branding, not raw deck.branding (v12.67)
          guidelines: deck.guidelines !== undefined ? deck.guidelines : cur.guidelines,
          // Reset selection when switching to a different deck so auto-select picks the first module
          ...(isDifferentDeck ? { selectedId: null, slideIndex: 0 } : {}),
        };
        dispatch({ type: "LOAD", payload });
      } catch (e) {
        // Fail closed: a malicious .vela edited on disk is pushed here over the serve.py
        // long-poll channel — never load it raw/unsanitized if validation fails.
        dbg("[local-sync] Sanitize failed, dropping update (not loading raw):", e);
      }
      setTimeout(() => { _localSyncIncoming.current = false; }, 1000);
    };
    return () => { window.__velaReceiveDeckUpdate = null; };
  }, []);

  // Desktop save-status: subscribe to deck-io's transitions (wired by nl-boot).
  // Installed only where a shell actually feeds the channel — the desktop /
  // local-preview build (VELA_LOCAL_MODE), or a host that already published a
  // status before mount (nl-boot mirrors the latest into window.__velaSaveState,
  // and the headless harness seeds a falsy-but-present value to opt the UI
  // battery in). The hosted artifact matches none of these, so it never gains a
  // writable global that can push arbitrary UI state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!(VELA_LOCAL_MODE || window.__velaSaveState != null)) return;
    window.__velaOnSaveStatus = (s) => setSaveStatus(s || null);
    if (window.__velaSaveState) setSaveStatus(window.__velaSaveState);
    return () => { if (window.__velaOnSaveStatus) window.__velaOnSaveStatus = null; };
  }, []);

  // One-shot toast on the FIRST transition into a failed save, so a user not
  // watching the header still notices. The header pill is the persistent signal;
  // the toast auto-dismisses. Re-arms only after a subsequent successful save.
  useEffect(() => {
    const cur = saveStatus && saveStatus.state;
    const prev = prevSaveStateRef.current;
    if (cur === "failed" && prev !== "failed" && saveFailToastArmed.current) {
      setSaveFailToast(true);
      saveFailToastArmed.current = false; // stay disarmed until a real successful save
      clearTimeout(saveFailToastTimer.current);
      saveFailToastTimer.current = setTimeout(() => setSaveFailToast(false), 8000);
    } else if (cur === "saved") {
      setSaveFailToast(false);
      saveFailToastArmed.current = true; // genuine success re-arms the one-shot toast
    }
    prevSaveStateRef.current = cur;
  }, [saveStatus]);
  useEffect(() => () => clearTimeout(saveFailToastTimer.current), []);

  // ━━━ Change tracking (since last load/export) ━━━━━━━━━━━━━━━━━━━
  const snapshotRef = useRef(new Map()); // moduleId → JSON string of slides
  const takeSnapshot = useCallback((st) => {
    const snap = new Map();
    for (const lane of st.lanes || []) for (const item of lane.items || []) {
      snap.set(item.id, JSON.stringify(item.slides || []));
    }
    snapshotRef.current = snap;
  }, []);
  const getChanges = useCallback(() => {
    const snap = snapshotRef.current;
    let added = 0, changed = 0, totalSlides = 0;
    for (const lane of state.lanes || []) for (const item of lane.items || []) {
      const cur = JSON.stringify(item.slides || []);
      totalSlides += (item.slides || []).length;
      if (!snap.has(item.id)) { added += (item.slides || []).length; }
      else if (snap.get(item.id) !== cur) { changed++; }
    }
    return { added, changed, totalSlides, dirty: added > 0 || changed > 0 };
  }, [state.lanes]);

  // ━━━ Mobile ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState("list"); // "list" | "slides" | "chat"
  const [mobileMenu, setMobileMenu] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [tocWidth, setTocWidth] = useState(() => { try { const v = parseInt(localStorage.getItem("vela-toc-width")); return v >= 160 && v <= 600 ? v : 270; } catch { return 270; } });
  const tocDragRef = useRef(null);
  const prevSelectedRef = useRef(null);

  // Auto-switch tabs on select/deselect
  useEffect(() => {
    if (!isMobile) return;
    if (state.selectedId && !prevSelectedRef.current) setMobileTab("slides");
    if (!state.selectedId && prevSelectedRef.current) setMobileTab("list");
    prevSelectedRef.current = state.selectedId;
  }, [state.selectedId, isMobile]);

  // TOC toggle shortcut: [
  useEffect(() => {
    if (isMobile) return;
    const h = (e) => { if (e.key === "[" && !e.ctrlKey && !e.metaKey && !["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); setTocCollapsed((c) => !c); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [isMobile]);

  // Theme toggle shortcut: D
  useEffect(() => {
    const h = (e) => { if (e.key === "d" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); setDark((d) => !d); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ── URL hash ↔ slide position sync (local mode only) ──
  const hashRestored = useRef(false);

  // (hash restore is done inline in the initial LOAD sequence above)

  // Write hash on navigation (only after restore is done) — flat global slide index
  useEffect(() => {
    if (!VELA_LOCAL_MODE || !hashRestored.current) return;
    if (state.selectedId && state.lanes) {
      let globalIdx = 0;
      for (const lane of state.lanes) {
        for (const item of lane.items) {
          if (item.id === state.selectedId) {
            globalIdx += state.slideIndex;
            const h = `#s=${globalIdx}`;
            if (location.hash !== h) history.replaceState(null, "", h);
            return;
          }
          globalIdx += (item.slides?.length || 0);
        }
      }
    } else if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, [state.selectedId, state.slideIndex]);

  // Global fullscreen: F5 or 'f' when no module selected → auto-select first with slides
  useEffect(() => {
    const h = (e) => {
      if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName) || e.target.isContentEditable) return;
      const isF5 = e.key === "F5";
      const isF = e.key === "f" && !e.metaKey && !e.ctrlKey;
      if (!isF5 && !isF) return;
      if (isF5) { e.preventDefault(); e.stopPropagation(); }
      if (state.fullscreen || state.selectedId) return; // SlidePanel handles it when selected
      // Find first module with slides
      for (const lane of state.lanes) {
        for (const item of lane.items) {
          if (item.slides?.length > 0) {
            dispatch({ type: "SELECT", id: item.id });
            dispatch({ type: "SET_SLIDE_INDEX", index: 0 });
            dispatch({ type: "SET_FULLSCREEN", value: true });
            return;
          }
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [state.fullscreen, state.selectedId, state.lanes, dispatch]);

  // ━━━ Storage: Load (single key — v3) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  useEffect(() => {
    (async () => {
      let loadedDeck = null;
      // In LOCAL_MODE the file on disk (via STARTUP_PATCH) is authoritative.
      // Skip localStorage entirely — it may contain a stale deck from a
      // previous session/file and would cause a flash of old content or,
      // worse, get synced back to disk overwriting the new file.
      if (!VELA_LOCAL_MODE) {
      try {
        let data = null;
        // Try v3 monolithic format (single key, includes slides)
        try {
          const raw = await window.storage.get(MASTER_KEY);
          if (raw?.value) data = JSON.parse(raw.value);
        } catch(_) {}

        if (data && data._version === 3) {
          // v3: full deck in one key
          delete data._version;
          // Re-sanitize slide content and branding read back from storage —
          // see resanitizeLoadedLanes / resanitizeLoadedBranding (F-11
          // backstop, part-imports.jsx). Only touch the key if the stored deck
          // actually carries one, so a deck with no branding field at all keeps
          // that exact shape through the LOAD spread. (v13.26 / v13.27)
          data.lanes = resanitizeLoadedLanes(data.lanes);
          if ("branding" in data) data.branding = resanitizeLoadedBranding(data.branding);
          dispatch({ type: "LOAD", payload: data });
          loadedDeck = data;
        } else if (data && data._version === 2) {
          // v2 distributed: migrate — read module keys sequentially
          const ids = allItemIds(data.lanes);
          const slidesMap = {};
          for (const id of ids) {
            try {
              const r = await window.storage.get(MOD_PREFIX + id);
              if (r?.value) slidesMap[id] = JSON.parse(r.value);
            } catch(_) {}
            // Small delay between reads to avoid rate limit
            await new Promise(r => setTimeout(r, 50));
          }
          const payload = {
            ...data,
            lanes: data.lanes.map((l) => ({
              ...l,
              items: l.items.map((item) => ({ ...item, slides: slidesMap[item.id] || item.slides || [] })),
            })),
          };
          delete payload._version;
          // Re-sanitize slide content and branding read back from storage —
          // see resanitizeLoadedLanes / resanitizeLoadedBranding (F-11
          // backstop, part-imports.jsx). Only touch the key if the stored deck
          // actually carries one, so a deck with no branding field at all keeps
          // that exact shape through the LOAD spread. (v13.26 / v13.27)
          payload.lanes = resanitizeLoadedLanes(payload.lanes);
          if ("branding" in payload) payload.branding = resanitizeLoadedBranding(payload.branding);
          dispatch({ type: "LOAD", payload });
          loadedDeck = payload;
          // Clean up old distributed keys in background
          setTimeout(async () => {
            for (const id of ids) { try { await window.storage.delete(MOD_PREFIX + id); } catch(_) {} }
            dbg("Storage: migrated v2→v3, cleaned", ids.length, "module keys");
          }, 3000);
        } else if (data) {
          // v1 legacy monolithic
          // Re-sanitize slide content and branding read back from storage —
          // see resanitizeLoadedLanes / resanitizeLoadedBranding (F-11
          // backstop, part-imports.jsx). Only touch the key if the stored deck
          // actually carries one, so a deck with no branding field at all keeps
          // that exact shape through the LOAD spread. (v13.26 / v13.27)
          data.lanes = resanitizeLoadedLanes(data.lanes);
          if ("branding" in data) data.branding = resanitizeLoadedBranding(data.branding);
          dispatch({ type: "LOAD", payload: data });
          loadedDeck = data;
        }
      } catch (err) { dbg("Load error:", err); }
      } // end !VELA_LOCAL_MODE
      // ━━━ Startup Patch: first run OR new version merge ━━━━━━━━━
      if (STARTUP_PATCH) {
        if (VELA_LOCAL_MODE) {
          // Local/folder mode: file on disk is always authoritative — apply directly
          // (localStorage may contain a different deck from the same origin)
          try { applyStartupPatch(loadedDeck || { lanes: [] }, dispatch); } catch (err) { dbg("[PATCH] Error:", err); }
        } else if (!loadedDeck) {
          // First run — no saved data, apply patch directly
          try { applyStartupPatch({ lanes: [] }, dispatch); } catch (err) { dbg("[PATCH] Error:", err); }
        } else if (STARTUP_PATCH._patchId && loadedDeck._lastPatchId !== STARTUP_PATCH._patchId) {
          // New patch version detected — show merge dialog
          dbg("[PATCH] New version detected:", STARTUP_PATCH._patchId, "vs stored:", loadedDeck._lastPatchId);
          try {
            const sanitized = validateAndSanitizeDeck(STARTUP_PATCH);
            sanitized.deckTitle = sanitizeDeckTitle(STARTUP_PATCH.deckTitle);
            sanitized._patchId = STARTUP_PATCH._patchId;
            setMergeDialog({ localDeck: loadedDeck, patchDeck: sanitized });
          } catch (e) { dbg("[PATCH] Sanitize failed:", e); }
        }
      }
      loaded.current = true;
      // Restore slide position from URL hash (flat global slide index)
      if (VELA_LOCAL_MODE && location.hash) {
        const params = new URLSearchParams(location.hash.slice(1));
        const globalIdx = parseInt(params.get("s"), 10);
        if (!isNaN(globalIdx) && globalIdx >= 0) {
          setTimeout(() => {
            const lanes = _localSyncState.current?.lanes;
            if (!lanes) { hashRestored.current = true; return; }
            let remaining = globalIdx;
            for (const lane of lanes) {
              for (const item of lane.items) {
                const count = item.slides?.length || 0;
                if (remaining < count) {
                  dispatch({ type: "SELECT", id: item.id, slideIndex: remaining });
                  hashRestored.current = true;
                  return;
                }
                remaining -= count;
              }
            }
            hashRestored.current = true;
          }, 50);
          return;
        }
      }
      hashRestored.current = true;
    })();
  }, []);

  // Snapshot after first load
  const snapshotted = useRef(false);
  useEffect(() => {
    if (loaded.current && !snapshotted.current && state.lanes?.length) {
      takeSnapshot(state);
      snapshotted.current = true;
    }
  }, [state.lanes, takeSnapshot]);

  // Auto-select first module with slides — re-triggers on full deck loads
  // Skip auto-select if URL hash has a slide to restore
  const _hasHashRestore = VELA_LOCAL_MODE && location.hash && !isNaN(parseInt(new URLSearchParams(location.hash.slice(1)).get("s"), 10));
  const pendingAutoSelect = useRef(!_hasHashRestore); // false if hash will restore
  const selectFirstModule = useCallback(() => { pendingAutoSelect.current = true; }, []);
  useEffect(() => {
    if (!loaded.current || !pendingAutoSelect.current || state.selectedId) return;
    for (const lane of state.lanes) {
      for (const item of lane.items) {
        if (item.slides?.length > 0) {
          dispatch({ type: "SELECT", id: item.id });
          dispatch({ type: "SET_SLIDE_INDEX", index: 0 });
          pendingAutoSelect.current = false;
          return;
        }
      }
    }
  }, [state.lanes, state.selectedId]);

  // An empty deck should be immediately editable: seed a first section so the
  // user can add slides right away (no "create deck" / "add section" step).
  // Skipped while an AI build is pending/streaming — Vera populates the deck then.
  //
  // The seed must NOT fire during initial hydration, when state.lanes is
  // transiently [] before the deck is applied — the deck can arrive either
  // synchronously (STARTUP_PATCH) or asynchronously over the folder-sync
  // channel, so a plain "lanes===0" check (or a next-tick recheck) races it and
  // appends a spurious "New section" to the real deck on every load. Gate the
  // seed behind an "armed" flag that flips true only once we have either seen
  // loaded content (lanes>0) or waited out a short grace window for a genuinely
  // empty deck. Using state (not a ref) so arming re-runs the seed effect.
  const [seedArmed, setSeedArmed] = useState(false);
  useEffect(() => {
    if (seedArmed) return;
    if (state.lanes.length > 0) { setSeedArmed(true); return; }
    const t = setTimeout(() => setSeedArmed(true), 1500);
    return () => clearTimeout(t);
  }, [state.lanes.length, seedArmed]);
  useEffect(() => {
    if (!loaded.current || !seedArmed || state.lanes.length !== 0) return;
    if (state._bootstrap || state.chatLoading) return;
    dispatch({ type: "INSERT_ITEM", title: "New section" });
  }, [seedArmed, state.lanes.length, state._bootstrap, state.chatLoading]);

  // ━━━ Storage: Save (single key — v3, debounced) ━━━━━━━━━━━━━━━━━━━
  // In LOCAL_MODE the file on disk is the source of truth (synced via
  // __velaSendDeckUpdate). Skip localStorage saves to avoid stale data
  // persisting across deck switches and app restarts.
  const saveTimer = useRef(null);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    if (!loaded.current || VELA_LOCAL_MODE ||
        document.documentElement.dataset.velaDemoRunning === "true") return;
    saveTimer.current = setTimeout(() => flushStorageStateRef.current?.(null), 1500);
    return () => clearTimeout(saveTimer.current);
  }, [state.lanes, state.chatMessages, state.branding, state.deckTitle, state.guidelines]);

  // Sync browser tab title with deck title
  React.useEffect(() => {
    const name = state.deckTitle || "Untitled";
    document.title = name === "Untitled" ? "Vela Slides" : `${name} — Vela Slides`;
  }, [state.deckTitle]);

  // Export
  const exportDeck = () => {
    // Export the canonical Vela deck format (.vela) \u2014 the same shape as
    // examples/*.vela and what the `vela` CLI reads: deckTitle + lanes (+ branding
    // + guidelines). No app-state wrapper (chat/selection are not part of a deck).
    const save = extractSave(state);
    const title = state.deckTitle || "Untitled";
    const deck = { deckTitle: title, lanes: save.lanes || [] };
    if (save.branding) deck.branding = save.branding;
    if (save.guidelines) deck.guidelines = save.guidelines;
    const blob = new Blob([JSON.stringify(deck, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `${(title.replace(/[\u2014\u2013]/g, "-").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/[^\w\s.-]/g, "").replace(/\s+/g, "-").replace(/-{2,}/g, "-").replace(/_{2,}/g, "_").replace(/^[-_.]+|[-_.]+$/g, "").slice(0, 80)) || "vela-deck"}-${new Date().toISOString().slice(0, 10)}.vela`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    takeSnapshot(state);
  };

  // Import
  const loadDeckFile = useCallback((file) => {
    if (!file || file.size > MAX_IMPORT_SIZE) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext !== "json" && ext !== "vela") return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = JSON.parse(reader.result);
        let deckData, deckName;
        if (raw._vela && raw.data) { deckData = raw.data; deckName = sanitizeString(raw.name || "Imported", 60); }
        else if (raw.lanes) { deckData = raw; deckName = raw.deckTitle || "Imported"; }
        else throw new Error("Unrecognized format");
        const sanitized = validateAndSanitizeDeck(deckData);
        sanitized.deckTitle = sanitizeDeckTitle(deckName);
        dispatch({ type: "LOAD", payload: sanitized });
        dispatch({ type: "DESELECT" });
        selectFirstModule();
        takeSnapshot(sanitized);
      } catch (err) { dbg("Import error:", err); }
    };
    reader.readAsText(file);
  }, [takeSnapshot]);

  const importDeck = (e) => { const file = e.target.files?.[0]; if (!file) return; e.target.value = ""; loadDeckFile(file); };

  const [fileDragOver, setFileDragOver] = useState(false);
  const dragCountRef = useRef(0);
  const handleGlobalDragEnter = useCallback((e) => { e.preventDefault(); if (e.dataTransfer?.types?.includes("Files")) { dragCountRef.current++; setFileDragOver(true); } }, []);
  const handleGlobalDragLeave = useCallback((e) => { e.preventDefault(); dragCountRef.current--; if (dragCountRef.current <= 0) { dragCountRef.current = 0; setFileDragOver(false); } }, []);
  const handleGlobalDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }, []);
  const handleGlobalDrop = useCallback((e) => { e.preventDefault(); e.stopPropagation(); dragCountRef.current = 0; setFileDragOver(false); const file = e.dataTransfer?.files?.[0]; if (file) loadDeckFile(file); }, [loadDeckFile]);

  // Title editing
  const startEditTitle = () => { setTitleDraft(state.deckTitle || "Untitled"); setEditingTitle(true); };
  const commitTitle = () => { dispatch({ type: "SET_TITLE", title: titleDraft.trim() || "Untitled" }); setEditingTitle(false); };

  // Keyboard: undo/redo
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); e.stopPropagation(); dispatch({ type: e.shiftKey ? "REDO" : "UNDO" }); }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") { e.preventDefault(); e.stopPropagation(); dispatch({ type: "REDO" }); }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) { e.preventDefault(); setShowShortcuts((v) => !v); }
      if (e.key === "r" && !e.metaKey && !e.ctrlKey && !(e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) { e.preventDefault(); window.dispatchEvent(new CustomEvent("vela-toggle-review")); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Review mode toggle via custom event (keyboard shortcut R)
  useEffect(() => {
    const h = () => {
      const entering = !state.reviewMode;
      dispatch({ type: "SET_REVIEW_MODE", value: entering });
      if (entering) { dispatch({ type: "SET_COMMENTS_PANEL", open: true }); dispatch({ type: "SET_CHAT", open: false }); }
      else { dispatch({ type: "SET_COMMENTS_PANEL", open: false }); }
    };
    window.addEventListener("vela-toggle-review", h);
    return () => window.removeEventListener("vela-toggle-review", h);
  }, [state.reviewMode]);

  let selectedConcept = null;
  for (const l of state.lanes) { const f = l.items.find((i) => i.id === state.selectedId); if (f) { selectedConcept = f; break; } }
  const total = state.lanes.reduce((s, l) => s + l.items.length, 0);
  // Presentation totals exclude hidden slides; "…All" variants include them (for the stats dialog).
  const deckTime = state.lanes.reduce((s, l) => s + l.items.reduce((a, i) => a + sumVisibleDurations(i.slides), 0), 0);
  const deckTimeAll = state.lanes.reduce((s, l) => s + l.items.reduce((a, i) => a + sumDurations(i.slides), 0), 0);
  const slideCountAll = state.lanes.reduce((s, l) => s + l.items.reduce((a, i) => a + (i.slides?.length || 0), 0), 0);
  const slideCountVisible = state.lanes.reduce((s, l) => s + l.items.reduce((a, i) => a + visibleSlides(i.slides).length, 0), 0);
  const hiddenSlideCount = slideCountAll - slideCountVisible;
  const maxModuleTime = React.useMemo(() => { let m = 0; for (const l of state.lanes) for (const i of l.items) { const t = i.slides.reduce((a, s) => a + (s.duration || 0), 0); if (t > m) m = t; } return m || 1; }, [state.lanes]);

  // ━━━ Mobile helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const showList = isMobile ? mobileTab === "list" : !(tocCollapsed && selectedConcept);
  const showSlides = !isMobile || mobileTab === "slides";
  const showChat = !isMobile ? state.chatOpen : mobileTab === "chat";
  const showCommentsPanel = !isMobile ? state.commentsPanelOpen : mobileTab === "comments";
  const slideCount = selectedConcept?.slides?.length || 0;

  // Presentation mode: show nothing until deck is loaded and first module selected
  if (VELA_PRESENTATION_MODE && (!state.selectedId || !state.lanes.length)) {
    return <div style={{ width: "100vw", height: "100vh", background: T.bg }} />;
  }

  // In-app TEST panels (render battery + UI battery runner). Declared null here
  // and assigned only inside the fence, so a release build keeps a valid `null`
  // with no reference to the gate or the panels — the same declare-outside /
  // assign-inside shape part-uitest.jsx uses for its _hooks stub. These mounted
  // on every non-presentation boot before v13.25, which meant a hosted artifact
  // ran the render battery at startup and registered the UI battery's Ctrl+Alt+T
  // and custom-event triggers. Both are test affordances; neither belongs on a
  // surface an untrusted deck shares.
  let devTestPanels = null;
  // VELA:DEV-ONLY:BEGIN
  if (velaTestSurfaceEnabled()) devTestPanels = <><VelaBatteryTest /><VelaUITestRunner /></>;
  // VELA:DEV-ONLY:END

  return (
    <IconPickerContext.Provider value={openIconPicker}>
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", background: T.bg, color: T.text, fontFamily: FONT.body, overflow: "hidden", position: "relative" }}
      onDragEnter={handleGlobalDragEnter} onDragLeave={handleGlobalDragLeave} onDragOver={handleGlobalDragOver} onDrop={handleGlobalDrop}>
      <style>{getCss()}</style>
      <input ref={fileInputRef} type="file" accept=".json,.vela" onChange={importDeck} style={{ display: "none" }} />
      {fileDragOver && <div style={{ position: "absolute", inset: 0, zIndex: 99999, background: "rgba(59,130,246,0.12)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ background: T.bgPanel, border: `2px dashed ${T.accent}`, borderRadius: 16, padding: "40px 60px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
          <span style={{ fontSize: 40 }}>📂</span>
          <span style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>Drop deck to load</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim }}>.json or .vela</span>
        </div>
      </div>}

      {/* One-shot save-failure toast (desktop). The header pill is the persistent signal; this just catches the eye once. */}
      {saveFailToast && <div data-testid="save-failed-toast" style={{ position: "fixed", left: 16, bottom: 16, zIndex: 100000, maxWidth: 340, background: T.bgPanel, border: `1px solid ${T.red}`, borderLeft: `3px solid ${T.red}`, borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.4)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontFamily: FONT.body }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: T.red, fontSize: 14, fontWeight: 700 }}>Save failed</span>
          <div style={{ flex: 1 }} />
          <span onClick={() => setSaveFailToast(false)} title="Dismiss" style={{ cursor: "pointer", color: T.textDim, fontSize: 14, lineHeight: 1 }}>{"✕"}</span>
        </div>
        {/* The desktop shell hands us {state, at, name} — a basename only, never an absolute path. */}
        <div style={{ fontSize: 12, color: T.textMuted }}>Vela couldn't write to {saveStatus && saveStatus.name ? <span style={{ fontFamily: FONT.mono }}>{saveStatus.name}</span> : "your file"}. Your work is safe in the app.</div>
        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          <button data-testid="save-failed-toast-retry" onClick={() => { try { if (window.__velaForceSave) window.__velaForceSave(); } catch {} setSaveFailToast(false); }} style={{ padding: "4px 12px", background: T.red, color: "#fff", border: "none", borderRadius: 5, fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Retry</button>
        </div>
      </div>}

      {/* ── TOP BAR — title left, actions right, dropdown buttons ── */}
      {!state.fullscreen && <header style={{ padding: isMobile ? "6px 10px" : "0 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: isMobile ? 8 : 10, background: T.bgPanel, flexShrink: 0, height: isMobile ? 40 : 44 }}>
        {/* Left: icon + title + time */}
        {isMobile && mobileTab !== "list" && <button onClick={() => { setMobileTab("list"); if (mobileTab === "slides") dispatch({ type: "DESELECT" }); }} style={S.btn({ padding: "2px 4px", color: T.accent, fontSize: 16 })}>{"←"}</button>}
        <span onClick={() => { if (typeof window !== "undefined" && typeof window.__velaOpenDeckPicker === "function") { window.__velaOpenDeckPicker(); } else { setShowChangelog(true); } }} style={{ cursor: "pointer", display: "flex", alignItems: "center" }} title={typeof window !== "undefined" && typeof window.__velaOpenDeckPicker === "function" ? "Open deck (Ctrl+O)" : "About"}><VelaIcon size={20} /></span>
        {/* Desktop save-status pill — beside the sail icon so "which file + is it saved" read together. Hidden unless the desktop shell emits a status. */}
        {!isMobile && saveStatus && (() => {
          // Payload from the desktop shell is {state, at, name}: a file BASENAME, no
          // absolute path and no raw platform error (those stay shell-side).
          const st = saveStatus.state;
          const at = saveStatus.at;
          const nm = saveStatus.name ? String(saveStatus.name) : "";
          const forFile = nm ? ` ${nm}` : " your file";
          const timeStr = at ? (() => { try { return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } })() : "";
          const base = { display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, userSelect: "none" };
          if (st === "saved") return <span data-testid="save-status-pill" data-save-state="saved" title={`Saved${nm ? " to " + nm : ""}${timeStr ? " at " + timeStr : ""}`} style={{ ...base, color: T.textDim, cursor: "default" }}>{"✓"} Saved</span>;
          if (st === "saving") return <span data-testid="save-status-pill" data-save-state="saving" title={`Saving to${forFile}…`} style={{ ...base, color: T.textMuted, cursor: "default" }}>{"⟳"} Saving…</span>;
          // Written, but the shell could not read the bytes back to confirm them.
          // Shown distinctly rather than as a confident "Saved" the user can't rely on.
          if (st === "unverified") return <span data-testid="save-status-pill" data-save-state="unverified" title={`Written to${forFile}, but Vela couldn't read it back to confirm. Keep a backup if this persists.`} style={{ ...base, color: T.amber, background: T.amber + "18", cursor: "default" }}>{"✓?"} Saved (unverified)</span>;
          if (st === "reconnecting") return <span data-testid="save-status-pill" data-save-state="reconnecting" title="Lost the connection to your file — reconnecting. Restart Vela if this persists." style={{ ...base, color: T.amber, background: T.amber + "18", cursor: "default" }}>{"◍"} Reconnecting…</span>;
          // failed
          return <span data-testid="save-status-pill" data-save-state="failed" role="button" onClick={() => { try { if (window.__velaForceSave) window.__velaForceSave(); } catch {} }} title={`Vela couldn't write to${forFile} — click to retry`} style={{ ...base, color: T.red, background: T.red + "18", cursor: "pointer" }}><span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.red }}>●</span> <span data-testid="save-status-retry">Couldn't save — Retry</span></span>;
        })()}
        {editingTitle ? (
          <input autoFocus value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitTitle(); if (e.key === "Escape") setEditingTitle(false); }}
            onBlur={commitTitle}
            style={S.input({ padding: "3px 8px", fontSize: 14, fontWeight: 700, width: 200, minWidth: 60, flexShrink: 1, border: `1px solid ${T.accent}`, fontFamily: FONT.display })} />
        ) : (
          <span onClick={startEditTitle} style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: FONT.display, cursor: "pointer", padding: "2px 4px", borderRadius: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1, minWidth: 0, maxWidth: isMobile ? "40vw" : undefined }} title={state.deckTitle || "Untitled"}>{state.deckTitle || "Untitled"}</span>
        )}
        {!isMobile && (deckTime > 0 || total > 0) && <span onClick={() => setShowStats(true)} title={`${deckTimeAll > 0 ? fmtTime(deckTimeAll) + " total · " : ""}${slideCountVisible} slides · ${total} sections${hiddenSlideCount > 0 ? ` · ${hiddenSlideCount} hidden` : ""} — click for stats`} style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.text, whiteSpace: "nowrap", flexShrink: 0, background: T.accent + "12", padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}>{deckTime > 0 ? `⏱${fmtTimeMin(deckTime)} · ` : ""}{slideCountVisible}sl · {total}§{hiddenSlideCount > 0 ? <span style={{ opacity: 0.6 }}> · {hiddenSlideCount}⊘</span> : ""}</span>}
        {/* Spacer — pushes actions right */}
        <div style={{ flex: 1, minWidth: isMobile ? 4 : 0 }} />
        {/* Right: deck-level actions with dropdowns */}
        {!isMobile && <>
          {/* View dropdown — shows current ratio */}
          {(() => {
            const sa = slideActionsRef.current;
            const pr = sa?.previewRatio || "16:9";
            const has = !!selectedConcept;
            const label = PREVIEW_RATIOS.find((r) => r.id === pr)?.label || "16:9";
            return <div style={{ position: "relative" }}>
              <button onClick={() => { setViewMenu((v) => !v); setExportMenu(false); }} disabled={!has} style={S.btn({ padding: "4px 10px", fontSize: 14, color: has ? T.text : T.textDim, opacity: has ? 1 : 0.4, display: "flex", alignItems: "center", gap: 4, background: viewMenu ? T.accent + "15" : "transparent", borderRadius: 4 })}>{"👁"} {label} <span style={{ fontSize: 9, opacity: 0.5 }}>▾</span></button>
              {viewMenu && <>
                <div onClick={() => setViewMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
                <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 9999, marginTop: 4, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", padding: "4px 0", minWidth: 120 }}>
                  {PREVIEW_RATIOS.map((r) => <button key={r.id} onClick={() => { sa?.setPreviewRatio?.(r.id); setViewMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: pr === r.id ? T.accent + "20" : "transparent", border: "none", color: pr === r.id ? T.accent : T.text, fontFamily: FONT.mono, fontSize: 14, fontWeight: pr === r.id ? 700 : 400, cursor: "pointer", textAlign: "left" }}>{pr === r.id && <span style={{ color: T.accent }}>✓</span>}{r.label}</button>)}
                </div>
              </>}
            </div>;
          })()}
          {/* Batch / Brand / Present */}
          {(() => {
            const sa = slideActionsRef.current;
            const has = !!selectedConcept;
            return <>
              <button data-testid="batch-edit-toggle" onClick={() => sa?.toggleBatchEdit?.()} disabled={!aiOk || !has || !sa?.slidesCount} title={aiOk ? "Batch edit across slides" : VELA_AI_UNAVAILABLE_MSG} style={S.btn({ padding: "4px 10px", fontSize: 14, color: !aiOk ? T.textDim + "60" : sa?.showBatchEdit ? T.accent : (sa?.improving ? T.red : T.textDim), background: sa?.showBatchEdit || sa?.improving ? T.accent + "20" : "transparent", borderRadius: 4, opacity: aiOk && has && sa?.slidesCount ? 1 : 0.4, display: "flex", alignItems: "center", gap: 4, cursor: aiOk ? "pointer" : "not-allowed" })}>{sa?.improving ? "⏹" : "🔄"} Batch</button>
              <button data-testid="brand-toggle" onClick={() => sa?.toggleBranding?.()} disabled={!has} title="Branding & guidelines" style={S.btn({ padding: "4px 10px", fontSize: 14, color: sa?.showBranding ? T.accent : (sa?.hasBranding ? T.accent : T.textDim), background: sa?.showBranding ? T.accent + "20" : "transparent", borderRadius: 4, opacity: has ? 1 : 0.4, display: "flex", alignItems: "center", gap: 4 })}>{"🎨"} Brand</button>
              <button onClick={() => sa?.present?.()} disabled={!has} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 14px", background: has ? T.green : T.border, color: has ? "#fff" : T.textDim, border: "none", borderRadius: 6, cursor: has ? "pointer" : "default", opacity: has ? 1 : 0.5, fontFamily: FONT.mono, fontSize: 14, fontWeight: 700 }}>{"▶"} Present</button>
            </>;
          })()}
          <div style={{ width: 1, height: 22, background: T.border, flexShrink: 0 }} />
          {/* New Deck */}
          <button onClick={() => setNewDeckDialog(true)} style={S.btn({ padding: "4px 10px", fontSize: 14, color: T.accent, display: "flex", alignItems: "center", gap: 4, borderRadius: 4 })}>{"+"} New</button>
          {/* Import */}
          <button onClick={() => fileInputRef.current?.click()} style={S.btn({ padding: "4px 10px", fontSize: 14, color: T.textMuted, display: "flex", alignItems: "center", gap: 4, borderRadius: 4 })}>{"📥"} Import</button>
          {/* Export dropdown */}
          <div style={{ position: "relative" }}>
            <button data-testid="export-menu-toggle" onClick={() => { setExportMenu((v) => !v); setViewMenu(false); }} style={S.btn({ padding: "4px 10px", fontSize: 14, color: exportMenu ? T.accent : T.textMuted, display: "flex", alignItems: "center", gap: 4, background: exportMenu ? T.accent + "15" : "transparent", borderRadius: 4 })}>{"📤"} Export <span style={{ fontSize: 9, opacity: 0.5 }}>▾</span></button>
            {exportMenu && <>
              <div onClick={() => setExportMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
              <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 9999, marginTop: 4, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", padding: "4px 0", minWidth: 180 }}>
                {(() => { const ch = getChanges(); return <button onClick={() => { exportDeck(); setExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: ch.dirty ? T.red : T.text, fontFamily: FONT.body, fontSize: 14, cursor: "pointer", textAlign: "left" }}><Download size={14} /> Export Vela {ch.dirty && <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.red }}>●</span>}</button>; })()}
                <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
                {total > 0 && <button data-testid="export-pdf-menu-item" onClick={() => { setPdfExport(true); setExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, cursor: "pointer", textAlign: "left" }}><FileDown size={14} /> Export PDF</button>}
                {total > 0 && <button data-testid="export-pptx-menu-item" onClick={() => { setPptxExport(true); setExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, cursor: "pointer", textAlign: "left" }}><FileDown size={14} /> PowerPoint (.pptx)</button>}
                {total > 0 && <button onClick={() => { exportMarkdown(state, { includeNotes: mdIncludeNotes }); setExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, cursor: "pointer", textAlign: "left" }}><FileDown size={14} /> Export Markdown</button>}
                {total > 0 && (() => { const soReason = velaStandaloneExportGateReason(); return <button onClick={() => { setStandaloneExport(true); setExportMenu(false); }} disabled={!!soReason} title={soReason || "One shareable .html file with this deck baked in"} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: soReason ? T.textDim + "60" : T.text, fontFamily: FONT.body, fontSize: 14, cursor: soReason ? "not-allowed" : "pointer", textAlign: "left" }}>{"🌐"} Standalone HTML</button>; })()}
                <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
                <button onClick={() => { setJsonModal(jsonModal ? null : 'copy'); setExportMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, cursor: "pointer", textAlign: "left" }}>{"{ }"} Copy / Paste JSON</button>
              </div>
            </>}
          </div>
          {velaIsArtifactMode() && <><div style={{ width: 1, height: 22, background: T.border, flexShrink: 0 }} />
          <CostBadge /></>}
          <button data-testid="run-demo" onClick={() => window.dispatchEvent(new CustomEvent("vela-run-demo"))} disabled={!!demoUnavailableReason} style={S.btn({ padding: "4px 10px", fontSize: 14, color: T.textMuted, borderRadius: 4, display: "flex", alignItems: "center", gap: 4, opacity: demoUnavailableReason ? 0.4 : 1, cursor: demoUnavailableReason ? "not-allowed" : "pointer" })} title={demoUnavailableReason || "Run product tour"}>{"🎬"}</button>
          <div style={{ width: 1, height: 22, background: T.border, flexShrink: 0 }} />
          <button data-testid="comments-toggle" onClick={() => { const entering = !state.reviewMode; dispatch({ type: "SET_REVIEW_MODE", value: entering }); if (entering) { dispatch({ type: "SET_COMMENTS_PANEL", open: true }); dispatch({ type: "SET_CHAT", open: false }); } else { dispatch({ type: "SET_COMMENTS_PANEL", open: false }); } }} style={S.btn({ padding: "4px 10px", fontSize: 14, background: state.reviewMode ? T.amber : "transparent", color: state.reviewMode ? "#fff" : T.amber, borderRadius: 4, display: "flex", alignItems: "center", gap: 4 })}>{"💬"} Comments</button>
          <button onClick={() => { dispatch({ type: "SET_CHAT", open: !state.chatOpen }); if (!state.chatOpen) { dispatch({ type: "SET_COMMENTS_PANEL", open: false }); dispatch({ type: "SET_REVIEW_MODE", value: false }); } }} style={S.btn({ padding: "4px 10px", fontSize: 14, background: state.chatOpen ? T.accent : "transparent", color: state.chatOpen ? "#fff" : T.accent, borderRadius: 4, display: "flex", alignItems: "center", gap: 4 })}>{"🤖"} Vera</button>
        </>}
        {isMobile && <>
          <button onClick={() => setNewDeckDialog(true)} style={{ padding: "4px 10px", fontSize: 14, color: T.accent, background: "transparent", border: `1px solid ${T.accent}40`, borderRadius: 4, cursor: "pointer", flexShrink: 0, fontWeight: 700 }} title="New Deck">{"+"}</button>
          {total > 0 && <button onClick={() => { const sa = slideActionsRef.current; if (sa?.present) sa.present(); }} style={{ padding: "4px 10px", background: T.green, color: "#fff", border: "none", borderRadius: 4, fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }} title="Present">{"▶"}</button>}
          <button onClick={() => setMobileMenu((v) => !v)} style={{ padding: "2px 6px", fontSize: 18, color: mobileMenu ? T.accent : T.textMuted, background: "transparent", border: "none", cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>{"⋯"}</button>
        </>}
        {isMobile && mobileMenu && <div style={{ position: "relative" }}>
          <div onClick={() => setMobileMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div style={{ position: "absolute", top: 4, right: 0, zIndex: 9999, background: T.bgPanel, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", padding: "6px 0", minWidth: 200 }}>
            {total > 0 && deckTime > 0 && <div style={{ padding: "6px 14px", fontFamily: FONT.mono, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${T.border}` }}><span style={{ color: T.accent }}>{"⏱"} {fmtTime(deckTime)}</span></div>}
            <button onClick={() => { setNewDeckDialog(true); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.accent, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer", fontWeight: 600 }}>{"⛵"} New Deck</button>
            <button onClick={() => { fileInputRef.current?.click(); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"📥"} Import</button>
            <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
            {total > 0 && <button onClick={() => { const sa = slideActionsRef.current; if (sa?.present) sa.present(); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.green, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer", fontWeight: 600 }}>{"▶"} Present</button>}
            {total > 0 && (() => {
              const sa = slideActionsRef.current;
              const pr = sa?.previewRatio || "auto";
              return <div style={{ display: "flex", gap: 4, padding: "6px 14px", borderTop: `1px solid ${T.border}` }}>
                {PREVIEW_RATIOS.map((r) => <button key={r.id} onClick={() => { sa?.setPreviewRatio?.(r.id); setMobileMenu(false); }}
                  style={{ flex: 1, padding: "5px 0", background: pr === r.id ? T.accent + "25" : "transparent", border: `1px solid ${pr === r.id ? T.accent + "50" : T.border}`, borderRadius: 4, color: pr === r.id ? T.accent : T.textDim, fontFamily: FONT.mono, fontSize: 10, fontWeight: pr === r.id ? 700 : 400, cursor: "pointer" }}>{r.label}</button>)}
              </div>;
            })()}
            {total > 0 && (() => {
              const sa = slideActionsRef.current;
              return <>
                <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
                {selectedConcept && <button onClick={() => { if (aiOk) { sa?.toggleBatchEdit?.(); setMobileMenu(false); if (isMobile && mobileTab !== "slides") setMobileTab("slides"); } }} disabled={!aiOk} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: !aiOk ? T.textDim + "60" : sa?.improving ? T.red : T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: aiOk ? "pointer" : "not-allowed" }}>{!aiOk ? "✨ AI not enabled" : sa?.improving ? "⏹ Stop Improve" : "✨ Improve / Batch"}</button>}
                <button onClick={() => { sa?.toggleBranding?.(); setMobileMenu(false); if (isMobile && mobileTab !== "slides") setMobileTab("slides"); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: sa?.hasBranding ? T.accent : T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"🎨"} Brand & Guidelines</button>
              </>;
            })()}
            <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
            <button onClick={() => { setJsonModal(jsonModal ? null : "copy"); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"{ }"} JSON</button>
            {total > 0 && <button onClick={() => { setPdfExport(true); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"📄"} PDF</button>}
            {total > 0 && <button data-testid="export-pptx-menu-item-mobile" onClick={() => { setPptxExport(true); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"📊"} PowerPoint (.pptx)</button>}
            {total > 0 && <button onClick={() => { exportMarkdown(state, { includeNotes: mdIncludeNotes }); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"📝"} Markdown</button>}
            {total > 0 && (() => { const soReason = velaStandaloneExportGateReason(); return <button onClick={() => { if (!soReason) { setStandaloneExport(true); setMobileMenu(false); } }} disabled={!!soReason} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: soReason ? T.textDim + "60" : T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: soReason ? "not-allowed" : "pointer" }}>{"🌐"} Standalone HTML</button>; })()}
            {total > 0 && <button onClick={() => { exportDeck(); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.text, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"📤"} Export Vela</button>}
            <div style={{ height: 1, background: T.border, margin: "2px 8px" }} />
            <button onClick={() => { dispatch({ type: "SET_COMMENTS_PANEL", open: true }); dispatch({ type: "SET_CHAT", open: false }); dispatch({ type: "SET_REVIEW_MODE", value: true }); setMobileTab("comments"); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.amber, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"💬"} Comments</button>
            <button onClick={() => { dispatch({ type: "SET_CHAT", open: !state.chatOpen }); dispatch({ type: "SET_COMMENTS_PANEL", open: false }); setMobileTab("chat"); setMobileMenu(false); }} style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", color: T.accent, fontFamily: FONT.body, fontSize: 14, textAlign: "left", cursor: "pointer" }}>{"🤖"} Vera</button>
          </div>
        </div>}
      </header>}

      {/* ── STORAGE WARNING (artifact mode only) ────────────── */}
      {velaIsArtifactMode() && !storageWarningDismissed && (
        <div data-testid="storage-warning" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: T.amber + "15", borderBottom: `1px solid ${T.amber}40`, fontFamily: FONT.mono, fontSize: 11, color: T.text }}>
          <span style={{ fontSize: 13 }}>⚠️</span>
          <span style={{ flex: 1 }}>This deck is saved in Claude.ai / your browser's local storage, not a file — it can be lost if storage is cleared. Export often (📤 Export) to back up your work.</span>
          <button
            data-testid="storage-warning-dismiss"
            onClick={() => { setStorageWarningDismissed(true); try { sessionStorage.setItem("vela-storage-warning-dismissed", "1"); } catch {} }}
            title="Dismiss"
            style={{ background: "transparent", border: "none", color: T.textDim, cursor: "pointer", fontSize: 14, fontFamily: FONT.mono, lineHeight: 1, padding: "2px 4px", flexShrink: 0 }}
          >✕</button>
        </div>
      )}

      {/* ── BODY ────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* List panel */}
        {showList && <div style={{ width: !isMobile ? (selectedConcept ? tocWidth : undefined) : "100%", minWidth: isMobile ? 0 : (selectedConcept ? 160 : 0), maxWidth: !isMobile && selectedConcept ? 600 : undefined, flex: !isMobile && !selectedConcept ? 1 : (isMobile ? 1 : undefined), overflowY: "auto", padding: "8px 0", borderRight: !isMobile && selectedConcept ? `1px solid ${T.border}` : "none", flexShrink: 0 }}>
          {total === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, padding: 20 }}>
              <div style={{ fontSize: 36, opacity: 0.15 }}>⛵</div>
              <div style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim, textAlign: "center", lineHeight: 1.7, maxWidth: 280 }}>Your deck is ready. Add a section to start, ask <span style={{ color: T.accent, cursor: "pointer" }} onClick={() => { dispatch({ type: "SET_CHAT", open: true }); if (isMobile) setMobileTab("chat"); }}>Vera</span>, or drop a <span style={{ color: T.accent }}>.json</span> / <span style={{ color: T.accent }}>.vela</span> file.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { dispatch({ type: "INSERT_ITEM", title: "New section" }); if (isMobile) setMobileTab("list"); }} style={{ padding: "8px 18px", fontSize: 14, fontFamily: FONT.body, fontWeight: 600, color: "#fff", background: T.accent, border: "none", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>{"＋"} Add section</button>
                <button onClick={() => { dispatch({ type: "SET_CHAT", open: true }); if (isMobile) setMobileTab("chat"); }} style={S.btn({ padding: "8px 14px", color: T.accent, border: `1px solid ${T.accent}40`, borderRadius: 6, fontSize: 14, display: "flex", alignItems: "center", gap: 4 })}>🤖 Vera</button>
              </div>
            </div>
          )}
          {total > 0 && <ModuleList lanes={state.lanes} selectedId={state.selectedId} slideIndex={state.slideIndex} selectedSlideIndices={state.selectedSlideIndices} collapsedSections={state.collapsedSections} dispatch={dispatch} maxModuleTime={maxModuleTime} guidelines={state.guidelines} reviewMode={state.reviewMode} deckEpoch={state._deckEpoch} />}
        </div>}

        {/* TOC toggle */}
        {!isMobile && selectedConcept && <div
          title="Drag to resize · Double-click to collapse"
          onDoubleClick={() => setTocCollapsed(!tocCollapsed)}
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = tocCollapsed ? 270 : tocWidth;
            if (tocCollapsed) { setTocCollapsed(false); }
            let lastW = startW;
            const onMove = (ev) => {
              lastW = Math.max(160, Math.min(600, startW + (ev.clientX - startX)));
              setTocWidth(lastW);
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
              try { localStorage.setItem("vela-toc-width", String(lastW)); } catch {}
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          style={{ width: 6, flexShrink: 0, cursor: "col-resize", background: "transparent", borderRight: `1px solid ${T.border}`, transition: "background .15s", userSelect: "none" }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.accent + "30"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        />}

        {/* Slides panel */}
        {showSlides && selectedConcept && <SlidePanel state={state} concept={selectedConcept} slideIndex={state.slideIndex} fullscreen={state.fullscreen} dispatch={dispatch} lanes={state.lanes} branding={state.branding} guidelines={state.guidelines} isMobile={isMobile} fontScale={state.fontScale} actionsRef={slideActionsRef} onRibbonUpdate={forceRibbon} />}
        {showSlides && !selectedConcept && isMobile && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 20 }}>
            <span style={{ fontSize: 32, opacity: 0.15 }}>🎬</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim }}>Select a module from the list</span>
            <button onClick={() => setMobileTab("list")} style={S.btn({ padding: "6px 14px", color: T.accent, border: `1px solid ${T.accent}40`, borderRadius: 4 })}>← Back to list</button>
          </div>
        )}

        {/* Chat panel */}
        {showChat && !showCommentsPanel && <ChatPanel state={state} dispatch={dispatch} isMobile={isMobile} getLayoutStats={() => slideActionsRef.current?.getLayoutStats?.()} />}
        {/* Comments panel */}
        {showCommentsPanel && !showChat && <CommentsPanel state={state} dispatch={dispatch} isMobile={isMobile} />}
      </div>

      {/* ── MOBILE BOTTOM NAV ──────────────────────────────── */}
      {isMobile && <nav style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bgPanel, display: "flex", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <button className={`mob-tab ${mobileTab === "list" ? "mob-tab-active" : ""}`} onClick={() => setMobileTab("list")} style={{ color: mobileTab === "list" ? T.accent : T.textDim }}>
          <Presentation size={16} /><span>Index</span>
        </button>
        <button className={`mob-tab ${mobileTab === "slides" ? "mob-tab-active" : ""}`} onClick={() => setMobileTab("slides")} style={{ color: mobileTab === "slides" ? T.accent : T.textDim }}>
          <Maximize2 size={16} /><span>Slides</span>
          {slideCount > 0 && <span style={{ fontSize: 9, color: T.textDim }}>{slideCount}</span>}
        </button>
        <button className={`mob-tab ${mobileTab === "comments" ? "mob-tab-active" : ""}`} onClick={() => { setMobileTab("comments"); dispatch({ type: "SET_COMMENTS_PANEL", open: true }); dispatch({ type: "SET_CHAT", open: false }); }} style={{ color: mobileTab === "comments" ? T.amber : T.textDim }}>
          <span style={{ fontSize: 16 }}>💬</span><span>Comments</span>
        </button>
        <button className={`mob-tab ${mobileTab === "chat" ? "mob-tab-active" : ""}`} onClick={() => { setMobileTab("chat"); dispatch({ type: "SET_CHAT", open: true }); dispatch({ type: "SET_COMMENTS_PANEL", open: false }); }} style={{ color: mobileTab === "chat" ? T.accent : T.textDim }}>
          <span style={{ fontSize: 16 }}>🤖</span><span>Vera</span>
        </button>
      </nav>}

      {/* ── APP FOOTER BAR ───────────────────────────────── */}
      {!state.fullscreen && !isMobile && <div data-vela-footer style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bgPanel, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", height: 24 }}>
        <span onClick={() => setShowChangelog(true)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }} title="About Vela">
          <VelaIcon size={12} />
          <span style={{ fontFamily: FONT.mono, fontSize: 9, fontWeight: 600, color: T.textDim, letterSpacing: "0.05em" }}>VELA v{VELA_VERSION}</span>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 12, height: 12, borderRadius: "50%", border: `1px solid ${T.textDim}50`, fontSize: 9, fontFamily: FONT.mono, fontWeight: 700, color: T.textDim, lineHeight: 1, opacity: 0.6 }}>i</span>
        </span>
        <AgentStatusChip />
        <span onClick={() => setShowShortcuts(true)} style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textMuted, cursor: "pointer" }} title="Keyboard shortcuts">Press <kbd style={{ fontSize: 8, background: T.bgInput, border: `1px solid ${T.border}`, borderRadius: 2, padding: "0 3px", color: T.text }}>?</kbd> for shortcuts</span>
        <span style={{ fontFamily: FONT.body, fontSize: 9, color: T.textDim }}>© 2025-present <a href="https://www.linkedin.com/in/rquintino/" target="_blank" rel="noopener noreferrer" style={{ color: T.textMuted, textDecoration: "none" }}>Rui Quintino</a> · <a href="https://github.com/agentiapt/vela-slides/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" style={{ color: T.textDim, textDecoration: "none" }}>ELv2</a></span>
      </div>}

      {jsonModal && <JsonClipboardModal mode={jsonModal} setMode={setJsonModal} state={state} dispatch={dispatch} />}
      {iconPicker && <IconPicker value={iconPicker.value} onPick={(name) => { iconPicker.onPick(name || undefined); setIconPicker(null); }} onClose={() => setIconPicker(null)} />}
      {!isMobile && showShortcuts && <ShortcutHelp onClose={() => setShowShortcuts(false)} />}
      {showChangelog && <ChangelogDialog onClose={() => setShowChangelog(false)} />}
      {showStats && <StatsDialog state={state} onClose={() => setShowStats(false)} />}
      {newDeckDialog && <NewDeckDialog onClose={() => setNewDeckDialog(false)} onSubmit={async ({ title, prompt, images }) => {
        // Desktop: allocate a NEW file in the same folder first, so creating a
        // deck never overwrites the one currently open (CR). If allocation FAILS
        // (returns null), abort — proceeding would let the blank deck autosave
        // over the open file. No-op / always-proceed elsewhere (artifact, serve).
        if (typeof window !== "undefined" && typeof window.__velaNewDeckFile === "function") {
          let path = null;
          try { path = await window.__velaNewDeckFile(title || "Untitled"); } catch {}
          if (!path) { alert("Couldn't create a new deck file in this folder — your current deck was left untouched."); return; }
        }
        dispatch({ type: "NEW_DECK", title, prompt, images });
        if (isMobile) setMobileTab("chat");
      }} />}
      {pdfExport && <PdfExportModal slides={collectAllSlides(state.lanes, state.branding)} branding={state.branding} deckTitle={state.deckTitle} onClose={() => setPdfExport(false)} />}
      {pptxExport && <PptxExportModal slides={collectAllSlides(state.lanes, state.branding)} branding={state.branding} deckTitle={state.deckTitle} onClose={() => setPptxExport(false)} />}
      {standaloneExport && <StandaloneHtmlModal state={state} onClose={() => setStandaloneExport(false)} />}
      {mergeDialog && <MergePatchDialog localDeck={mergeDialog.localDeck} patchDeck={mergeDialog.patchDeck} onComplete={(result) => {
        setMergeDialog(null);
        if (result) {
          const patchId = result._lastPatchId || "";
          delete result._lastPatchId;
          try { const s = validateAndSanitizeDeck(result); s.deckTitle = sanitizeDeckTitle(result.deckTitle); s._lastPatchId = patchId; dispatch({ type: "LOAD", payload: s }); dispatch({ type: "DESELECT" }); selectFirstModule(); } catch(e) { /* fail closed: do not load the raw merged deck if sanitization fails */ dbg("[PATCH] Merge sanitize failed, not loading raw:", e); }
        } else {
          // User skipped — store current patchId so we don't ask again
          if (STARTUP_PATCH?._patchId) {
            const save = extractSave(state);
            save._lastPatchId = STARTUP_PATCH._patchId;
            save._version = 3;
            saveKV(MASTER_KEY, save).catch(() => {});
          }
        }
      }} />}
      {devTestPanels}
      {!VELA_PRESENTATION_MODE && <VelaDemoRunner appState={state} dispatch={dispatch} requestPostDemoFlush={(request) => requestPostDemoFlushRef.current?.(request)} demoUi={{ tocCollapsed, setTocCollapsed, viewMenu, setViewMenu, exportMenu, setExportMenu, pptxExport, setPptxExport, pdfExport, setPdfExport }} />}
    </div>
    </IconPickerContext.Provider>
  );
}
