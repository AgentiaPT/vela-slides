// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
// ━━━ Main ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ━━━ Item Fingerprint (for merge detection) ━━━━━━━━━━━━━━━━━━━━━━━
function itemFingerprint(item) {
  const str = JSON.stringify(item.slides || []);
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return h.toString(36);
}

// ━━━ Merge Patch Dialog ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function MergePatchDialog({ localDeck, patchDeck, onComplete }) {
  // Compute diffs
  const localItems = new Map();
  for (const lane of localDeck.lanes || []) for (const item of lane.items || []) {
    localItems.set(item.id, { item, laneId: lane.id, laneTitle: lane.title, fp: itemFingerprint(item) });
  }
  const patchItems = new Map();
  for (const lane of patchDeck.lanes || []) for (const item of lane.items || []) {
    patchItems.set(item.id, { item, laneId: lane.id, laneTitle: lane.title, fp: itemFingerprint(item) });
  }

  // Categorize
  const autoKeep = []; // only in local
  const autoAdd = [];  // only in patch
  const unchanged = []; // same hash
  const conflicts = []; // both exist, different hash

  for (const [id, local] of localItems) {
    const patch = patchItems.get(id);
    if (!patch) { autoKeep.push(local); }
    else if (local.fp === patch.fp) { unchanged.push({ local, patch }); }
    else { conflicts.push({ id, local, patch }); }
  }
  for (const [id, patch] of patchItems) {
    if (!localItems.has(id)) { autoAdd.push(patch); }
  }

  // New lanes only in patch
  const localLaneIds = new Set((localDeck.lanes || []).map(l => l.id));
  const newLanes = (patchDeck.lanes || []).filter(l => !localLaneIds.has(l.id));

  // Track conflict resolutions: "mine" | "theirs" | "both"
  const [resolutions, setResolutions] = React.useState(() => {
    const m = {};
    for (const c of conflicts) m[c.id] = "theirs"; // default to new version
    return m;
  });

  const setRes = (id, val) => setResolutions(prev => ({ ...prev, [id]: val }));

  const handleApply = () => {
    // Start from local deck as base
    const merged = JSON.parse(JSON.stringify(localDeck));

    // Apply conflict resolutions
    for (const c of conflicts) {
      const res = resolutions[c.id];
      if (res === "mine") continue; // keep as-is
      // Find item in merged deck and replace or add
      for (const lane of merged.lanes) {
        const idx = lane.items.findIndex(i => i.id === c.id);
        if (idx >= 0) {
          if (res === "theirs") {
            lane.items[idx] = { ...c.patch.item };
          } else if (res === "both") {
            // Insert new version right after the existing one with a new id
            const copy = { ...c.patch.item, id: uid(), title: c.patch.item.title + " (new)" };
            lane.items.splice(idx + 1, 0, copy);
          }
          break;
        }
      }
    }

    // Add new items from patch into matching or new lanes
    for (const entry of autoAdd) {
      let targetLane = merged.lanes.find(l => l.id === entry.laneId);
      if (!targetLane) {
        const patchLane = (patchDeck.lanes || []).find(l => l.id === entry.laneId);
        targetLane = { id: entry.laneId, title: patchLane?.title || "Imported", collapsed: false, items: [] };
        merged.lanes.push(targetLane);
      }
      targetLane.items.push({ ...entry.item });
    }

    // Add entirely new lanes (with items already included)
    for (const nl of newLanes) {
      if (!merged.lanes.find(l => l.id === nl.id)) {
        merged.lanes.push(JSON.parse(JSON.stringify(nl)));
      }
    }

    // Update deck title if user hasn't changed it
    if (patchDeck.deckTitle && localDeck.deckTitle === "Untitled") {
      merged.deckTitle = sanitizeDeckTitle(patchDeck.deckTitle);
    }

    // Store patchId so we don't ask again
    merged._lastPatchId = patchDeck._patchId || "";

    onComplete(merged);
  };

  const totalAuto = autoKeep.length + autoAdd.length + unchanged.length;

  return (
    <ModalBackdrop onClose={() => onComplete(null)}>
      <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>⛵</span>
          <span style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700 }}>New Deck Version Available</span>
        </div>

        {/* Auto-resolved summary */}
        <div style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textDim, marginBottom: 12, lineHeight: 1.6 }}>
          {autoAdd.length > 0 && <div style={{ color: "#34d399" }}>+ {autoAdd.length} new module{autoAdd.length > 1 ? "s" : ""} will be added</div>}
          {autoKeep.length > 0 && <div style={{ color: "#60a5fa" }}>● {autoKeep.length} module{autoKeep.length > 1 ? "s" : ""} you added — keeping</div>}
          {unchanged.length > 0 && <div style={{ color: T.textDim }}>= {unchanged.length} unchanged</div>}
          {newLanes.length > 0 && <div style={{ color: "#34d399" }}>+ {newLanes.length} new section{newLanes.length > 1 ? "s" : ""} will be added</div>}
        </div>

        {/* Conflicts — interactive */}
        {conflicts.length > 0 && <>
          <div style={{ fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            {conflicts.length} module{conflicts.length > 1 ? "s" : ""} changed in both — choose:
          </div>
          {conflicts.map(c => {
            const res = resolutions[c.id];
            const localSlides = c.local.item.slides?.length || 0;
            const patchSlides = c.patch.item.slides?.length || 0;
            const localTime = (c.local.item.slides || []).reduce((a, s) => a + (s.duration || 0), 0);
            const patchTime = (c.patch.item.slides || []).reduce((a, s) => a + (s.duration || 0), 0);
            return (
              <div key={c.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, background: T.bg }}>
                <div style={{ fontFamily: FONT.display, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  📦 {c.local.item.title || c.id}
                  <span style={{ fontFamily: FONT.mono, fontSize: 9, color: T.textDim, marginLeft: 8 }}>in {c.local.laneTitle}</span>
                </div>
                <div style={{ display: "flex", gap: 12, fontFamily: FONT.mono, fontSize: 10, color: T.textDim, marginBottom: 8 }}>
                  <span>Yours: {localSlides} slide{localSlides !== 1 ? "s" : ""}, {localTime}s</span>
                  <span>New: {patchSlides} slide{patchSlides !== 1 ? "s" : ""}, {patchTime}s</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["mine", "theirs", "both"].map(opt => (
                    <button key={opt} onClick={() => setRes(c.id, opt)} style={{
                      padding: "4px 10px", fontSize: 11, fontFamily: FONT.body, fontWeight: res === opt ? 700 : 400,
                      background: res === opt ? (opt === "mine" ? "#3b82f620" : opt === "theirs" ? "#34d39920" : "#f59e0b20") : "transparent",
                      color: res === opt ? (opt === "mine" ? "#60a5fa" : opt === "theirs" ? "#34d399" : "#f59e0b") : T.textDim,
                      border: `1px solid ${res === opt ? (opt === "mine" ? "#3b82f650" : opt === "theirs" ? "#34d39950" : "#f59e0b50") : T.border}`,
                      borderRadius: 4, cursor: "pointer"
                    }}>
                      {opt === "mine" ? "Keep Mine" : opt === "theirs" ? "Use New" : "Keep Both"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </>}

        {/* No conflicts */}
        {conflicts.length === 0 && (autoAdd.length > 0 || newLanes.length > 0) && (
          <div style={{ fontFamily: FONT.body, fontSize: 14, color: T.textMuted, marginBottom: 8 }}>
            No conflicts — new content will be merged alongside your existing deck.
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          <button onClick={() => onComplete(null)} style={{ padding: "6px 16px", fontSize: 14, fontFamily: FONT.body, background: "transparent", color: T.textDim, border: `1px solid ${T.border}`, borderRadius: 6, cursor: "pointer" }}>
            Skip
          </button>
          <button onClick={() => { const p = JSON.parse(JSON.stringify(patchDeck)); p._lastPatchId = patchDeck._patchId || ""; onComplete(p); }} style={{ padding: "6px 16px", fontSize: 14, fontFamily: FONT.body, background: "transparent", color: "#f59e0b", border: `1px solid #f59e0b50`, borderRadius: 6, cursor: "pointer" }}>
            Load New (replace all)
          </button>
          <button onClick={handleApply} style={{ padding: "6px 16px", fontSize: 14, fontFamily: FONT.body, fontWeight: 600, background: T.accent, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            Merge
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

