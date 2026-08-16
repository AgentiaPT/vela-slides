// Regression suite for the AI slide adder selection bug (finding 2/4):
// AiSlideAdder inserted a generated slide, dispatched SELECT (which reset the
// slide index to 0), then scheduled a SET_SLIDE_INDEX under a setTimeout
// guarded by operationIsCurrent(), then called onClose(). onClose() unmounts
// the editor, whose cleanup effect nulls the owner ref — so the deferred
// timer could run AFTER the owner was invalidated and silently drop the
// navigation to the new slide. The fix: SELECT already accepts an optional
// slideIndex, so the insert and the select now land as one synchronous
// dispatch pair before onClose() runs — no timer, nothing to race.
const fs = require("fs");
const path = require("path");
const P = (f) => path.join(__dirname, "..", "src/parts", f);
const list = fs.readFileSync(P("part-list.jsx"), "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  \u2705 " + n); };
const bad = (n, d) => { fail++; console.log("  \u274c " + n + (d ? " \u2014 " + d : "")); };

// ---- extract `const generate = async () => { ... };` (brace-matched) ----
function arrowBlock(src, name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("not found: " + name);
  const braceStart = src.indexOf("{", start);
  if (braceStart < 0) throw new Error("no body brace for: " + name);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i).replace(/^const\s+\w+\s*=\s*/, "");
}

// `generate` closes over free variables from the AiSlideAdder component scope
// (props, refs, state, and the two module-level helpers) — supply them via a
// factory, same approach as the existing clearOwnedAiWork harness.
function makeGenerate(ctx) {
  const body = arrowBlock(list, "generate");
  // eslint-disable-next-line no-eval
  const factory = new Function(
    "prompt", "loading", "deckEpoch", "operationOwnerRef", "epochRef",
    "velaDeckEpochIsCurrent", "item", "insertIndex", "generateAiSlide",
    "guidelines", "dispatch", "onClose", "setError", "setLoading",
    "return (" + body + ");"
  );
  return factory(
    ctx.prompt, ctx.loading, ctx.deckEpoch, ctx.operationOwnerRef, ctx.epochRef,
    ctx.velaDeckEpochIsCurrent, ctx.item, ctx.insertIndex, ctx.generateAiSlide,
    ctx.guidelines, ctx.dispatch, ctx.onClose, ctx.setError, ctx.setLoading
  );
}

// Mini reducer mirror — just enough of SELECT/SET_SLIDE_INDEX/INSERT_SLIDE to
// observe where "selected slide" ends up, matching part-reducer.jsx semantics.
function applyMini(state, a) {
  if (a.type === "SELECT") return { ...state, selectedId: a.id, slideIndex: a.slideIndex ?? 0 };
  if (a.type === "SET_SLIDE_INDEX") return { ...state, slideIndex: a.index };
  if (a.type === "INSERT_SLIDE") return { ...state, slides: [...state.slides.slice(0, a.index), a.slide, ...state.slides.slice(a.index)] };
  return state;
}

const wait0 = () => new Promise((r) => setTimeout(r, 0));

// ---- Test 1: successful insertion leaves insertIndex selected, even if the
// editor unmounts (owner invalidated) immediately after generate() finishes ----
{
  const item = { id: "m1", title: "Mod", notes: "", slides: [{ blocks: [] }, { blocks: [] }, { blocks: [] }] };
  const insertIndex = 2; // insert before the last slide
  const dispatches = [];
  let miniState = { selectedId: null, slideIndex: 0, slides: item.slides };
  const dispatch = (a) => { dispatches.push(a); miniState = applyMini(miniState, a); };
  const operationOwnerRef = { current: null };
  const epochRef = { current: 1 };
  let activeEpoch = 1;
  const velaDeckEpochIsCurrent = (epoch) => epoch === activeEpoch;
  const generateAiSlide = async () => ({ blocks: [{ type: "title", text: "New" }] });
  let closed = false;
  // onClose simulates the real unmount cleanup effect
  // (`useEffect(() => () => { operationOwnerRef.current = null; }, [])`) firing
  // synchronously as soon as the panel closes.
  const onClose = () => { closed = true; operationOwnerRef.current = null; };
  const setError = () => {};
  const setLoading = () => {};

  const generate = makeGenerate({
    prompt: "add a summary slide", loading: false, deckEpoch: 1,
    operationOwnerRef, epochRef, velaDeckEpochIsCurrent, item, insertIndex,
    generateAiSlide, guidelines: "", dispatch, onClose, setError, setLoading,
  });

  (async () => {
    await generate();
    await wait0(); // let any deferred (setTimeout-scheduled) dispatch attempt run

    if (dispatches.some((a) => a.type === "SET_SLIDE_INDEX")) {
      bad("navigation no longer depends on a deferred SET_SLIDE_INDEX dispatch",
        "a SET_SLIDE_INDEX dispatch was scheduled — reintroduces the unmount race");
    } else {
      ok("navigation no longer depends on a deferred SET_SLIDE_INDEX dispatch");
    }

    const selectCall = dispatches.find((a) => a.type === "SELECT");
    if (selectCall && selectCall.slideIndex === insertIndex) {
      ok("SELECT carries slideIndex atomically with the insert");
    } else {
      bad("SELECT carries slideIndex atomically with the insert", JSON.stringify(selectCall));
    }

    if (closed && miniState.selectedId === item.id && miniState.slideIndex === insertIndex) {
      ok("insertIndex stays selected after the editor unmounts (onClose)");
    } else {
      bad("insertIndex stays selected after the editor unmounts (onClose)",
        `closed=${closed} selectedId=${miniState.selectedId} slideIndex=${miniState.slideIndex}`);
    }

    runTest2();
  })().catch((e) => { bad("test 1 threw", e.message); runTest2(); });
}

// ---- Test 2: a stale completion (deck replaced mid-request) must not
// navigate the replacement deck at all — no dispatch of any kind ----
function runTest2() {
  const item = { id: "m1", title: "Mod", notes: "", slides: [{ blocks: [] }] };
  const insertIndex = 1;
  const dispatches = [];
  const dispatch = (a) => dispatches.push(a);
  const operationOwnerRef = { current: null };
  const epochRef = { current: 1 };
  let activeEpoch = 1;
  const velaDeckEpochIsCurrent = (epoch) => epoch === activeEpoch;
  let resolveSlide;
  const generateAiSlide = () => new Promise((r) => { resolveSlide = r; });
  const onClose = () => { operationOwnerRef.current = null; };
  const setError = () => {};
  const setLoading = () => {};

  const generate = makeGenerate({
    prompt: "add a summary slide", loading: false, deckEpoch: 1,
    operationOwnerRef, epochRef, velaDeckEpochIsCurrent, item, insertIndex,
    generateAiSlide, guidelines: "", dispatch, onClose, setError, setLoading,
  });

  const p = generate();
  // Replace the deck while the AI request is still in flight — bumps the
  // globally-tracked active epoch, exactly like a real deck replacement would.
  setTimeout(() => {
    activeEpoch = 2;
    epochRef.current = 2;
    resolveSlide({ blocks: [{ type: "title", text: "New" }] });
  }, 0);

  p.then(() => {
    if (dispatches.length === 0) {
      ok("stale completion after a deck replacement dispatches nothing (no navigation)");
    } else {
      bad("stale completion after a deck replacement dispatches nothing",
        JSON.stringify(dispatches));
    }
    finish();
  }).catch((e) => { bad("test 2 threw", e.message); finish(); });
}

function finish() {
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 2 : 0);
}
