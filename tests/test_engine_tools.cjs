// Behavioral CI coverage for the Vera AI engine's tool layer (src/parts/part-engine.jsx).
// Closes the biggest structural hole flagged by the coverage analysis (report G1/G3/G4):
// 0 of the 22 executeTool handlers, the ReAct-loop anti-cost-amplification caps, and the
// model-output JSON parser had any CI test. This harness reuses the exact eval-extraction
// pattern of test_image_preserve.cjs — it pulls the REAL functions out of the source by
// brace-matching and runs them under Node with tiny stubs (no browser, no model, no network).
//
// SECURITY NOTE: MAX_TOOLS_PER_TURN / MAX_TOTAL_TOOLS / MAX_MESSAGES_BYTES are anti-abuse
// controls that bound the cost of a single AI turn (they protect against runaway tool
// fan-out / unbounded input-token growth driven by injected instructions). The tests below
// assert only that the loop STOPS at the documented limits — no payloads, no bypass detail.
const fs = require("fs");
const path = require("path");

const engSrc = fs.readFileSync(path.join(__dirname, "..", "src/parts/part-engine.jsx"), "utf8");
const impSrc = fs.readFileSync(path.join(__dirname, "..", "src/parts/part-imports.jsx"), "utf8");

// Extract a top-level `function NAME(...) {...}` by capturing from its declaration
// up to the next top-level function/const. Brace-matching is unsafe here because
// these handlers embed `{`/`}` inside template literals and regex literals
// (e.g. deck_stats' markdown, find_replace's escape regex), so a naive depth
// counter over-runs. All target functions are top-level and their inner helpers
// are indented arrows, so the next col-0 declaration is a reliable boundary.
function extractFrom(src, name) {
  const decl = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(");
  const m = decl.exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  const start = m.index;
  const after = src.slice(start + m[0].length);
  const b = after.search(/\n(?:async function |function |const [A-Za-z])/);
  const end = b < 0 ? src.length : start + m[0].length + b;
  return src.slice(start, end); // may include trailing comment lines (harmless in eval)
}
const extract = (name) => extractFrom(engSrc, name);

// ── Deterministic stubs the extracted code closes over (module scope) ──
let _uidN = 0;
const uid = () => "id" + (++_uidN);                 // deterministic (real uid() is random)
const now = () => "2026-01-01T00:00:00.000Z";       // deterministic timestamp
const dbg = () => {};                                // silence engine debug logging
const defaultBranding = { enabled: false };

// Real helpers the handlers/loop depend on, extracted from source.
// eslint-disable-next-line no-eval
eval(extractFrom(impSrc, "collectComments"));
// eslint-disable-next-line no-eval
eval(extract("preserveImages"));
// eslint-disable-next-line no-eval
eval(extract("restoreKeepOriginal"));
// eslint-disable-next-line no-eval
eval(extract("parseJSONResponse"));
// eslint-disable-next-line no-eval
eval(extract("executeTool"));

// Cost-amplification caps — read the REAL values straight from source so a
// changed constant is reflected here (and separately asserted below).
const capOf = (n) => { const m = engSrc.match(new RegExp("const\\s+" + n + "\\s*=\\s*([^;]+);")); if (!m) throw new Error("cap " + n + " not found"); return eval(m[1]); };
const MAX_TOOLS_PER_TURN = capOf("MAX_TOOLS_PER_TURN");
const MAX_TOTAL_TOOLS = capOf("MAX_TOTAL_TOOLS");
const MAX_MESSAGES_BYTES = capOf("MAX_MESSAGES_BYTES");

// Loop-only stubs so the REAL callVera can run headless. buildSystemPrompt only
// needs to emit a "## BOARD STATE" section the loop greps for compact feedback;
// callVeraStep is the single network seam — we feed it canned model responses.
function buildSystemPrompt() { return "## BOARD STATE\n(board)\n\n## CANVAS\n"; }
function extractSlideImages() { return []; }
let _stepQueue = [], _stepCalls = 0;
async function callVeraStep() { _stepCalls++; return _stepQueue.length ? (_stepQueue.length === 1 ? _stepQueue[0] : _stepQueue.shift()) : { message: "done", tool_calls: [] }; }
// eslint-disable-next-line no-eval
eval(extract("callVera"));

// ── Test harness (mirrors test_image_preserve.cjs print + exit contract) ──
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const eq = (n, a, b) => { if (a === b) ok(n); else bad(n, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const truthy = (n, v, d) => { if (v) ok(n); else bad(n, d); };

// Build a fresh fixture deck for each handler (executeTool mutates in place).
function fixture() {
  return {
    branding: { enabled: false },
    lanes: [
      { id: "L1", title: "Intro", collapsed: false, items: [
        { id: "M1", title: "Welcome", status: "todo", importance: "must", order: 1, slides: [
          { title: "Hello", bg: "#000", duration: 30, blocks: [{ type: "heading", text: "Hello World" }, { type: "bullets", items: ["alpha", "beta"] }] },
          { bg: "#111", blocks: [{ type: "text", text: "the quick brown fox" }] },
        ], comments: [{ id: "c-open", text: "fix this", status: "open" }] },
        { id: "M2", title: "Agenda", status: "todo", importance: "should", order: 2, slides: [
          { blocks: [{ type: "table", rows: [] }], comments: [{ id: "c-slide", text: "slide note", status: "open" }] },
        ] },
      ] },
      { id: "L2", title: "Deep Dive", collapsed: false, items: [
        { id: "M3", title: "Details", status: "done", importance: "must", order: 1, slides: [] },
      ] },
    ],
  };
}
// executeTool with no attached images unless a test provides them.
const run = (name, input, ws, imgs) => executeTool(name, input, ws, imgs || []);

// ─────────────────────────────────────────────────────────────────────────
// PART A — executeTool: all 22 handlers, happy path + a not-found/edge path.
// ─────────────────────────────────────────────────────────────────────────

// 1. add_lane — grows lanes; dup guard rejects.
{
  const ws = fixture();
  run("add_lane", { title: "Outro" }, ws);
  eq("add_lane grows lane count", ws.lanes.length, 3);
  const before = ws.lanes.length;
  const msg = run("add_lane", { title: "intro" }, ws); // case-insensitive dup
  truthy("add_lane rejects duplicate (case-insensitive)", ws.lanes.length === before && /already exists/.test(msg), msg);
}

// 2. add_item — appends item with default importance "should".
{
  const ws = fixture();
  run("add_item", { lane_title: "Intro", title: "New Mod" }, ws);
  const lane = ws.lanes.find((l) => l.title === "Intro");
  const it = lane.items.find((i) => i.title === "New Mod");
  truthy("add_item appends item", !!it, "item not added");
  eq("add_item defaults importance to should", it && it.importance, "should");
  truthy("add_item not-found lane returns message", /not found/.test(run("add_item", { lane_title: "Ghost", title: "X" }, ws)), "no error");
}

// 3. batch_add_items — adds N items in one call.
{
  const ws = fixture();
  run("batch_add_items", { lane_title: "Deep Dive", items: [{ title: "A" }, { title: "B", importance: "must" }, { title: "C" }] }, ws);
  const lane = ws.lanes.find((l) => l.title === "Deep Dive");
  eq("batch_add_items adds all items", lane.items.length, 4); // 1 existing + 3
  eq("batch_add_items honors per-item importance", lane.items.find((i) => i.title === "B").importance, "must");
}

// 4. remove_item — fuzzy-matches and removes.
{
  const ws = fixture();
  run("remove_item", { item_name: "Welcome" }, ws);
  const lane = ws.lanes.find((l) => l.title === "Intro");
  truthy("remove_item removes matched item", !lane.items.some((i) => i.title === "Welcome"), "still present");
  truthy("remove_item not-found returns message", /not found/.test(run("remove_item", { item_name: "Nonexistent" }, ws)), "no error");
}

// 5. remove_lane — drops lane, message reports item count.
{
  const ws = fixture();
  const msg = run("remove_lane", { lane_title: "Intro" }, ws);
  truthy("remove_lane removes lane", !ws.lanes.some((l) => l.title === "Intro"), "still present");
  truthy("remove_lane reports cascaded item count", /2 items/.test(msg), msg);
}

// 6. rename_item — renames matched item.
{
  const ws = fixture();
  run("rename_item", { item_name: "Agenda", new_title: "Overview" }, ws);
  truthy("rename_item renames", ws.lanes.some((l) => l.items.some((i) => i.title === "Overview")), "not renamed");
}

// 7. rename_lane — renames matched lane.
{
  const ws = fixture();
  run("rename_lane", { lane_title: "Deep Dive", new_title: "Details Lane" }, ws);
  truthy("rename_lane renames", ws.lanes.some((l) => l.title === "Details Lane"), "not renamed");
}

// 8. move_item — cross-lane move; missing target path.
{
  const ws = fixture();
  run("move_item", { item_name: "Welcome", target_lane_title: "Deep Dive" }, ws);
  const intro = ws.lanes.find((l) => l.title === "Intro");
  const deep = ws.lanes.find((l) => l.title === "Deep Dive");
  truthy("move_item removes from source lane", !intro.items.some((i) => i.title === "Welcome"), "still in source");
  truthy("move_item adds to target lane", deep.items.some((i) => i.title === "Welcome"), "not in target");
  truthy("move_item missing target returns message", /not found/.test(run("move_item", { item_name: "Agenda", target_lane_title: "Ghost" }, ws)), "no error");
}

// 9. update_status — sets status; signed-off stamps signedOffAt.
{
  const ws = fixture();
  run("update_status", { item_name: "Welcome", status: "signed-off" }, ws);
  const it = ws.lanes[0].items.find((i) => i.title === "Welcome");
  eq("update_status sets status", it.status, "signed-off");
  truthy("update_status signed-off stamps signedOffAt", !!it.signedOffAt, "no timestamp");
}

// 10. set_importance — sets importance value.
{
  const ws = fixture();
  run("set_importance", { item_name: "Agenda", importance: "must" }, ws);
  eq("set_importance updates value", ws.lanes[0].items.find((i) => i.title === "Agenda").importance, "must");
}

// 11. set_slides — replaces slide array; returns jump link.
{
  const ws = fixture();
  const raw = run("set_slides", { item_name: "Details", slides: [{ blocks: [{ type: "heading", text: "S1" }] }, { blocks: [] }] }, ws);
  const it = ws.lanes[1].items.find((i) => i.title === "Details");
  eq("set_slides replaces slide array", it.slides.length, 2);
  truthy("set_slides returns jump to itemId", raw && raw.jump && raw.jump.itemId === "M3" && raw.jump.slideIdx === 0, JSON.stringify(raw));
}

// 12. add_slide — appends slide; jump points at new index.
{
  const ws = fixture();
  const raw = run("add_slide", { item_name: "Welcome", slide: { blocks: [{ type: "text", text: "added" }] } }, ws);
  const it = ws.lanes[0].items.find((i) => i.title === "Welcome");
  eq("add_slide appends slide", it.slides.length, 3);
  eq("add_slide jump targets last slide", raw.jump.slideIdx, 2);
}

// 13. edit_slide — merge-vs-replace branch + patch semantics + image preservation.
{
  // (a) Same block count → per-block merge; image src is never clobbered by an echo.
  const ws = fixture();
  const img = "data:image/png;base64," + "A".repeat(300);
  ws.lanes[0].items[0].slides[1].blocks = [{ type: "image", src: img, caption: "orig" }];
  run("edit_slide", { item_name: "Welcome", slide_index: 1, patch: { bg: "#222", blocks: [{ type: "image", src: "keep-original", caption: "new" }] } }, ws);
  const s = ws.lanes[0].items[0].slides[1];
  eq("edit_slide merges top-level slide prop", s.bg, "#222");
  eq("edit_slide keeps real image src on keep-original echo", s.blocks[0].src, img);
  eq("edit_slide applies block-level edit (caption)", s.blocks[0].caption, "new");

  // (b) Different block count → replace path preserves dropped images.
  const ws2 = fixture();
  ws2.lanes[0].items[0].slides[1].blocks = [{ type: "heading", text: "H" }, { type: "image", src: img }];
  run("edit_slide", { item_name: "Welcome", slide_index: 1, patch: { blocks: [{ type: "heading", text: "H2" }] } }, ws2);
  const s2 = ws2.lanes[0].items[0].slides[1];
  truthy("edit_slide replace-branch re-appends dropped image", s2.blocks.some((b) => b.type === "image" && b.src === img), JSON.stringify(s2.blocks.map((b) => b.type)));

  // (c) Out-of-range slide index → message, no mutation.
  const ws3 = fixture();
  const raw = run("edit_slide", { item_name: "Details", slide_index: 5, patch: { bg: "#000" } }, ws3);
  truthy("edit_slide out-of-range slide returns message", raw && /not found/.test(raw.text), JSON.stringify(raw));
}

// 14. add_image_to_slide — inserts attached image at given index; no-image path.
{
  const ws = fixture();
  const imgs = [{ dataUrl: "data:image/png;base64," + "Q".repeat(40) }];
  run("add_image_to_slide", { item_name: "Welcome", slide_index: 0, caption: "cap" }, ws, imgs);
  const blocks = ws.lanes[0].items[0].slides[0].blocks;
  const im = blocks.find((b) => b.type === "image");
  truthy("add_image_to_slide appends attached image", im && im.src === imgs[0].dataUrl && im.caption === "cap", JSON.stringify(im));
  truthy("add_image_to_slide with no attachment returns message", /No attached image/.test(run("add_image_to_slide", { item_name: "Welcome", slide_index: 0 }, ws, []).text), "no error");
}

// 15. clear_all — empties all lanes.
{
  const ws = fixture();
  run("clear_all", {}, ws);
  eq("clear_all empties lanes", ws.lanes.length, 0);
}

// 16. set_branding — merges only allow-listed fields.
{
  const ws = fixture();
  run("set_branding", { enabled: true, accentColor: "#f00", bogusField: "x" }, ws);
  eq("set_branding enables branding", ws.branding.enabled, true);
  eq("set_branding merges allowed field", ws.branding.accentColor, "#f00");
  truthy("set_branding drops non-allowlisted field", ws.branding.bogusField === undefined, "leaked field");
}

// 17. find_slides — query + block_type + property_missing filters.
{
  const ws = fixture();
  const rq = run("find_slides", { query: "quick brown" }, ws);
  truthy("find_slides text query matches", rq && Array.isArray(rq.jump) && rq.jump.length >= 1, JSON.stringify(rq).slice(0, 80));
  const rb = run("find_slides", { block_type: "table" }, ws);
  truthy("find_slides block_type filter matches", rb && rb.jump && rb.jump.length === 1, JSON.stringify(rb).slice(0, 80));
  const rm = run("find_slides", { property_missing: "duration" }, ws);
  truthy("find_slides property_missing filter matches slides lacking prop", rm && rm.jump && rm.jump.length >= 1, JSON.stringify(rm).slice(0, 80));
  truthy("find_slides with no criteria returns guidance", /Need at least one/.test(run("find_slides", {}, ws)), "no guidance");
  truthy("find_slides no-match returns message", /No matches/.test(run("find_slides", { query: "zzzznotpresent" }, ws)), "unexpected match");
}

// 18. find_replace — case-insensitive, scope resolution (all / lane: / module:).
{
  const ws = fixture();
  const r = run("find_replace", { find: "hello", replace: "Hi" }, ws); // case-insensitive: "Hello"
  truthy("find_replace is case-insensitive", ws.lanes[0].items[0].slides[0].blocks[0].text === "Hi World", ws.lanes[0].items[0].slides[0].blocks[0].text);
  truthy("find_replace reports occurrence count", /Replaced \d+ occurrence/.test(r.text), r.text);

  // module: scope only touches matching module titles.
  const ws2 = fixture();
  ws2.lanes[0].items[1].slides[0].blocks = [{ type: "text", text: "fox" }];
  ws2.lanes[0].items[0].slides[1].blocks = [{ type: "text", text: "fox" }];
  run("find_replace", { find: "fox", replace: "cat", scope: "module:Agenda" }, ws2);
  eq("find_replace module: scope hits target module", ws2.lanes[0].items[1].slides[0].blocks[0].text, "cat");
  eq("find_replace module: scope skips other module", ws2.lanes[0].items[0].slides[1].blocks[0].text, "fox");

  // lane: scope restricts to a lane.
  const ws3 = fixture();
  ws3.lanes[1].items[0].slides = [{ blocks: [{ type: "text", text: "target" }] }];
  ws3.lanes[0].items[0].slides[1].blocks = [{ type: "text", text: "target" }];
  run("find_replace", { find: "target", replace: "done", scope: "lane:Deep" }, ws3);
  eq("find_replace lane: scope hits target lane", ws3.lanes[1].items[0].slides[0].blocks[0].text, "done");
  eq("find_replace lane: scope skips other lane", ws3.lanes[0].items[0].slides[1].blocks[0].text, "target");
  truthy("find_replace no-match returns message", /No occurrences/.test(run("find_replace", { find: "nowaythisexists", replace: "x" }, ws3)), "unexpected");
}

// 19. deck_stats — aggregation + issue detection.
{
  const ws = fixture();
  const report = run("deck_stats", {}, ws);
  truthy("deck_stats counts lanes/modules/slides", /2 lanes/.test(report) && /3 modules/.test(report) && /3 slides/.test(report), report.split("\n")[1]);
  truthy("deck_stats reports block type distribution", /Block types:/.test(report), "no dist");
  truthy("deck_stats flags empty module", /empty module/.test(report), "no empty-module warning"); // M3 has 0 slides
}

// 20. batch_restyle — slide-level style + block_patch targeting + scope.
{
  const ws = fixture();
  const r = run("batch_restyle", { bg: "#abc", block_patch: { type: "heading", props: { size: "lg" } } }, ws);
  truthy("batch_restyle applies slide-level bg", ws.lanes[0].items[0].slides[0].bg === "#abc", "bg not applied");
  eq("batch_restyle block_patch targets matching type", ws.lanes[0].items[0].slides[0].blocks[0].size, "lg");
  truthy("batch_restyle leaves non-matching block untouched", ws.lanes[0].items[0].slides[0].blocks[1].size === undefined, "bled into bullets");
  truthy("batch_restyle needs a property", /Need at least one/.test(run("batch_restyle", {}, ws)), "no guard");

  // scope: module restricts application.
  const ws2 = fixture();
  run("batch_restyle", { color: "#eee", scope: "module:Agenda" }, ws2);
  eq("batch_restyle module: scope hits target", ws2.lanes[0].items[1].slides[0].color, "#eee");
  truthy("batch_restyle module: scope skips others", ws2.lanes[0].items[0].slides[0].color === undefined, "bled across scope");
}

// 21. list_comments — status filter + collection.
{
  const ws = fixture();
  const r = run("list_comments", { status: "open" }, ws);
  truthy("list_comments collects open comments", r.text && /2 comment/.test(r.text) && /fix this/.test(r.text), (r.text || "").slice(0, 60));
  truthy("list_comments none-matching returns message", /No resolved comments/.test(run("list_comments", { status: "resolved" }, ws)), "unexpected");
}

// 22. resolve_comment — id lookup flips status; missing id path.
{
  const ws = fixture();
  const r = run("resolve_comment", { id: "c-open" }, ws);
  eq("resolve_comment flips module comment to resolved", ws.lanes[0].items[0].comments[0].status, "resolved");
  truthy("resolve_comment stamps resolvedAt", !!ws.lanes[0].items[0].comments[0].resolvedAt, "no timestamp");
  truthy("resolve_comment resolves slide-level comment", (run("resolve_comment", { id: "c-slide" }, ws), ws.lanes[0].items[1].slides[0].comments[0].status === "resolved"), "slide comment not resolved");
  truthy("resolve_comment missing id returns message", /Missing comment id/.test(run("resolve_comment", {}, ws)), "no guard");
  truthy("resolve_comment unknown id returns not-found", /not found/.test(run("resolve_comment", { id: "nope" }, ws)), "no not-found");
}

// Unknown-tool fallback (switch default).
truthy("executeTool unknown tool returns fallback", /Unknown tool/.test(run("no_such_tool", {}, fixture())), "no fallback");

// ─────────────────────────────────────────────────────────────────────────
// PART B — parseJSONResponse robustness on adversarial / malformed model output (G4).
// ─────────────────────────────────────────────────────────────────────────
{
  eq("parseJSONResponse parses bare JSON", JSON.stringify(parseJSONResponse('{"a":1}')), '{"a":1}');
  eq("parseJSONResponse strips ```json fence", JSON.stringify(parseJSONResponse('```json\n{"b":2}\n```')), '{"b":2}');
  const rec = parseJSONResponse('Here is your result: {"tool_calls":[]} thanks!');
  truthy("parseJSONResponse recovers embedded object from prose", rec && Array.isArray(rec.tool_calls), JSON.stringify(rec));
  eq("parseJSONResponse returns null on non-JSON text", parseJSONResponse("no json at all here"), null);
  eq("parseJSONResponse returns null on truncated/broken JSON", parseJSONResponse('{"a": 1, "b":'), null);
  eq("parseJSONResponse returns null on empty string", parseJSONResponse(""), null);
}

// ─────────────────────────────────────────────────────────────────────────
// PART C — ReAct-loop cost-amplification caps enforced behaviorally (G1, SECURITY).
// The loop must STOP at the documented limits regardless of what the model requests.
// ─────────────────────────────────────────────────────────────────────────

// Constant sanity — pins the documented cap values so a silent weakening is caught.
eq("MAX_TOOLS_PER_TURN constant value", MAX_TOOLS_PER_TURN, 16);
eq("MAX_TOTAL_TOOLS constant value", MAX_TOTAL_TOOLS, 40);
eq("MAX_MESSAGES_BYTES constant value", MAX_MESSAGES_BYTES, 200 * 1024);

// Helper: build N harmless add_lane tool calls (each grows a plain fixture deck).
const nCalls = (n) => Array.from({ length: n }, (_, i) => ({ tool: "add_lane", input: { title: "L" + i } }));
// Count "calling" tool events emitted during one loop run.
const countCb = () => { let n = 0; const cb = (ev) => { if (ev.type === "calling") n++; }; cb.count = () => n; return cb; };

// The cap tests run the REAL callVera loop with callVeraStep stubbed to a canned
// model response. They share module globals (_stepQueue/_stepCalls), so they must
// run SEQUENTIALLY (await each) — never overlapped — to avoid clobbering.
(async () => {
  // C1. Per-turn cap: a single model turn that requests far more tools than the
  //     per-turn limit must execute at most MAX_TOOLS_PER_TURN of them, then continue.
  {
    _stepCalls = 0;
    const cb = countCb();
    _stepQueue = [
      { tool_calls: nCalls(MAX_TOOLS_PER_TURN + 8), message: "batch" }, // over the per-turn cap
      { message: "done", tool_calls: [] },
    ];
    const out = await callVera("go", [], null, 0, null, null, {}, "", cb, [], null);
    eq("C1 per-turn cap truncates tool calls in one turn", cb.count(), MAX_TOOLS_PER_TURN);
    truthy("C1 loop continues after truncation (returns result)", !!out && /tools/.test(out.debug || ""), JSON.stringify(out && out.debug));
  }

  // C2. Total cap: a model that keeps requesting a full per-turn batch every turn
  //     must be stopped once the cumulative total reaches MAX_TOTAL_TOOLS.
  {
    _stepCalls = 0;
    const cb = countCb();
    // Single steady response reused every turn (queue length 1 → not consumed).
    _stepQueue = [{ tool_calls: nCalls(MAX_TOOLS_PER_TURN), message: "more" }];
    await callVera("go", [], null, 0, null, null, {}, "", cb, [], null);
    eq("C2 total-tools cap stops at cumulative limit", cb.count(), MAX_TOTAL_TOOLS);
  }

  // C3. Messages-bytes cap: once the accumulated conversation payload exceeds the
  //     byte bound, the ReAct loop halts even if the model would keep going. We
  //     prove this by observing the loop makes exactly ONE model round-trip: a huge
  //     assistant payload trips the bound at the end of the first turn.
  {
    _stepCalls = 0;
    const huge = "x".repeat(MAX_MESSAGES_BYTES + 4096); // pushes serialized messages past the bound
    _stepQueue = [{ tool_calls: [{ tool: "add_lane", input: { title: "One" } }], message: huge }];
    await callVera("go", [], null, 0, null, null, {}, "", null, [], null);
    eq("C3 messages-bytes cap halts loop after first over-budget turn", _stepCalls, 1);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 2 : 0);
})();
