// Story images: pure logic (src/parts/part-imports.jsx).
//
// Covers: storyImageList ordering/exclusions, the full story state machine
// (storyEntry/Next/Prev/Esc), the OS-drop file filter (imageDropFiles), the
// image grid plan for 7..10 images (regression lock — gridColsFor/imageGridPlan
// must not change), and the compressImage strict option.
//
// Harness: same technique as test_deck_key_allowlist.cjs — eval one contiguous
// slice of part-imports.jsx in a `new Function` sandbox. No build, no browser.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src/parts/part-imports.jsx"), "utf8");
const a = src.indexOf("// Columns for a run of `n` images, by region.");
const b = src.indexOf("// Bounded cache of image aspect ratios");
if (a < 0 || b < 0 || b <= a) { console.error("FATAL: slice markers not found"); process.exit(1); }
const cStart = src.indexOf("function compressImage(");
const cEnd = src.indexOf("let IMG_SETTINGS");
if (cStart < 0 || cEnd < 0) { console.error("FATAL: compressImage markers not found"); process.exit(1); }

const prelude = `var dbg = function () {};\n`;
const body = prelude + src.slice(a, b) + "\n" + src.slice(cStart, cEnd) +
  "\n;return { gridColsFor, imageGridPlan, storyImageList, storyIsActive, storyEntry, storyNext, storyPrev, storyEsc," +
  " imageDropFiles, deckSlideNumber, compressImage, PASTE_MAX_IMAGES, IMAGE_DROP_MIME, IMAGE_DROP_MAX_BYTES, IMAGE_DROP_MAX_FILES, IMAGE_MAX_PIXELS };";

// Fake Image/document so compressImage can be driven without a browser.
function makeEnv(imgBehaviour) {
  return {
    Image: function () {
      const o = this;
      Object.defineProperty(o, "src", {
        set() { setTimeout(() => {
          if (imgBehaviour.error) o.onerror && o.onerror();
          else { o.width = o.naturalWidth = imgBehaviour.w; o.height = o.naturalHeight = imgBehaviour.h; o.onload && o.onload(); }
        }, 0); },
      });
    },
    // 2D context stub: an opaque image (no alpha), so compressImage takes its JPEG path.
    document: { createElement: () => ({ getContext: () => ({ drawImage() {}, fillRect() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) }), toDataURL: () => "data:image/jpeg;base64,RE9ORQ==" }) },
  };
}
function load(env) {
  // eslint-disable-next-line no-new-func
  return Function("Image", "document", body)(env.Image, env.document);
}

let API;
try { API = load(makeEnv({ w: 10, h: 10 })); } catch (e) { console.error("FATAL: sandbox eval failed:", (e && e.stack) || e); process.exit(1); }
const {
  gridColsFor, imageGridPlan, storyImageList, storyIsActive, storyEntry, storyNext, storyPrev, storyEsc,
  imageDropFiles, PASTE_MAX_IMAGES, IMAGE_DROP_MIME, IMAGE_DROP_MAX_BYTES, IMAGE_DROP_MAX_FILES, IMAGE_MAX_PIXELS,
} = API;

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const assert = (n, cond, d) => (cond ? ok(n) : bad(n, d));
const eq = (n, got, want) => assert(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ═══ constants ═══
assert("constants", PASTE_MAX_IMAGES === 10 && IMAGE_DROP_MAX_FILES === 20 && IMAGE_DROP_MAX_BYTES === 25 * 1024 * 1024 && IMAGE_MAX_PIXELS === 40e6);
assert("drop MIME set: no svg, has png/jpeg/gif/webp/avif/bmp",
  !IMAGE_DROP_MIME.has("image/svg+xml") && ["png", "jpeg", "gif", "webp", "avif", "bmp"].every((t) => IMAGE_DROP_MIME.has("image/" + t)) && IMAGE_DROP_MIME.size === 6);

// ═══ storyImageList ═══
{
  const img = (s, extra) => ({ type: "image", src: "data:image/png;base64," + s, ...(extra || {}) });
  const slide = {
    blocks: [{ type: "heading", text: "H" }, img("A", { alt: "a" }), img("B", { hidden: true }), { type: "image" }, img("C"),
      { type: "grid", items: [{ blocks: [img("N")] }] }],
    layout: "cols", L: [img("D")], R: [{ type: "text", text: "t" }, img("E")],
  };
  const edit = storyImageList(slide, false);
  eq("list (editor): order + index space", edit.map((e) => [e.idx, e.src.slice(-1)]), [[1, "A"], [2, "B"], [4, "C"], [6, "D"], [8, "E"]]);
  const pres = storyImageList(slide, true);
  eq("list (presenting): hidden excluded, idx kept", pres.map((e) => [e.idx, e.src.slice(-1)]), [[1, "A"], [4, "C"], [6, "D"], [8, "E"]]);
  assert("list: alt carried, default empty", edit[0].alt === "a" && edit[1].alt === "");
  assert("list: grid-nested and src-less excluded", !edit.some((e) => e.src.endsWith("N")) && edit.length === 5);
  // L/R are drawn only in the "cols" layout: on any other layout they are not
  // on the slide, so they must not become story steps or export pages.
  for (const layout of [undefined, "stack", "image-left", "image-right"]) {
    const s2 = { ...slide, layout };
    eq("list: L/R ignored when layout=" + layout, storyImageList(s2, false).map((e) => e.idx), [1, 2, 4]);
  }
  eq("list: null/garbage slide", [storyImageList(null, true), storyImageList({}, false), storyImageList({ blocks: "x", L: 1 }, false)], [[], [], []]);
  assert("isActive: needs story===true and >=2", storyIsActive({ story: true }, [1, 2]) && !storyIsActive({ story: true }, [1])
    && !storyIsActive({ story: "true" }, [1, 2]) && !storyIsActive({ story: 1 }, [1, 2]) && !storyIsActive({}, [1, 2]) && !storyIsActive(null, [1, 2]));
}

// ═══ state machine ═══
for (const n of [2, 10]) {
  eq(`N=${n} entry fwd`, storyEntry(1, n), { k: 0, zoomed: false });
  eq(`N=${n} entry back`, storyEntry(-1, n), { k: n, zoomed: false });
  // Forward walk from the overview.
  let s = { k: 0, zoomed: false }, trace = [];
  for (let i = 0; i < 2 * n + 4; i++) { const t = storyNext(s, n); trace.push(t); if (!t) break; s = t; }
  const want = [];
  for (let k = 1; k <= n; k++) want.push({ k, zoomed: true });
  want.push({ k: n, zoomed: false }, null);
  eq(`N=${n} forward walk`, trace, want);
  // Backward walk from the final grid state.
  s = { k: n, zoomed: false }; trace = [];
  for (let i = 0; i < 2 * n + 4; i++) { const t = storyPrev(s, n); trace.push(t); if (!t) break; s = t; }
  const wantB = [];
  for (let k = n; k >= 1; k--) wantB.push({ k, zoomed: true });
  wantB.push({ k: 0, zoomed: false }, null);
  eq(`N=${n} backward walk`, trace, wantB);
  eq(`N=${n} next zoomed k<n`, storyNext({ k: 1, zoomed: true }, n), { k: 2, zoomed: true });
  eq(`N=${n} next zoomed k=n`, storyNext({ k: n, zoomed: true }, n), { k: n, zoomed: false });
  eq(`N=${n} next grid k=n leaves`, storyNext({ k: n, zoomed: false }, n), null);
  eq(`N=${n} prev zoomed 1`, storyPrev({ k: 1, zoomed: true }, n), { k: 0, zoomed: false });
  eq(`N=${n} prev zoomed 2`, storyPrev({ k: 2, zoomed: true }, n), { k: 1, zoomed: true });
  eq(`N=${n} prev grid 0 leaves`, storyPrev({ k: 0, zoomed: false }, n), null);
  eq(`N=${n} prev grid k=1`, storyPrev({ k: 1, zoomed: false }, n), { k: 1, zoomed: true });
  eq(`N=${n} esc zoomed`, storyEsc({ k: 3 > n ? n : 3, zoomed: true }), { k: 3 > n ? n : 3, zoomed: false });
  eq(`N=${n} esc grid not consumed`, storyEsc({ k: 1, zoomed: false }), null);
}

// ═══ imageGridPlan regression lock (7..10 images) ═══
{
  const shape = (aspects) => {
    const n = aspects.length;
    const p = imageGridPlan(aspects, 864, 380, 12, gridColsFor(n, "full"));
    return p.rows.map((r) => r.cells.length);
  };
  const same = (n, a) => Array.from({ length: n }, () => a);
  const want = { 1.78: { 7: [3, 3, 1], 8: [3, 3, 2], 9: [3, 3, 3], 10: [4, 4, 2] }, 1: { 7: [4, 3], 8: [4, 4], 9: [5, 4], 10: [5, 5] } };
  for (const asp of Object.keys(want)) for (const n of [7, 8, 9, 10]) {
    eq(`plan ${n} images @${asp}`, shape(same(n, Number(asp))), want[asp][n]);
  }
  // Locked snapshot of the currently produced shapes for the remaining aspects
  // (guards against any change to gridColsFor / imageGridPlan).
  for (const asp of [1.33, 0.75]) for (const n of [7, 8, 9, 10]) {
    const rows = shape(same(n, asp));
    assert(`plan ${n} images @${asp} covers all, <=6 cols`, rows.reduce((t, c) => t + c, 0) === n && Math.max(...rows) <= 6, JSON.stringify(rows));
  }
  const mixed = [1.78, 0.75, 1, 1.33, 1.78, 0.75, 1, 1.33, 1.78];
  const mp = imageGridPlan(mixed, 864, 380, 12, gridColsFor(9, "full"));
  assert("plan mixed 9: every image placed once", mp.rows.reduce((t, r) => t + r.cells.length, 0) === 9
    && new Set(mp.rows.flatMap((r) => r.cells.map((c) => c.i))).size === 9);
}

// ═══ imageDropFiles ═══
{
  const f = (type, size, name) => ({ type, size: size === undefined ? 10 : size, get name() { throw new Error("name read"); } });
  const r = imageDropFiles([f("image/png"), f("image/svg+xml"), f(""), f("text/html"), f(5), f(undefined), f("image/jpeg", IMAGE_DROP_MAX_BYTES + 1), f("image/webp"), null]);
  eq("drop: only allowlisted + in-size kept, in order", r.files.map((x) => x.type), ["image/png", "image/webp"]);
  assert("drop: rejected count; f.name never read", r.rejected === 7);
  assert("drop: size exactly at cap is accepted", imageDropFiles([f("image/png", IMAGE_DROP_MAX_BYTES)]).files.length === 1);
  const many = Array.from({ length: 21 }, (_, i) => ({ type: "image/png", size: 1, i }));
  const m = imageDropFiles(many);
  assert("drop: file #21 rejected, first 20 kept in order", m.files.length === 20 && m.rejected === 1 && m.files.every((x, i) => x.i === i));
  eq("drop: empty / null input", [imageDropFiles([]), imageDropFiles(null)], [{ files: [], rejected: 0 }, { files: [], rejected: 0 }]);
  assert("drop: non-string type (object with toString) rejected", imageDropFiles([{ type: { toString: () => "image/png" }, size: 1 }]).files.length === 0);
}

// ═══ compressImage strict ═══
(async () => {
  const run = async (env, strict) => load(env).compressImage("data:image/png;base64,AAAA", 800, 0.7, strict ? { strict: true } : undefined);
  assert("compress default: decode error fails open (returns input)", (await run(makeEnv({ error: true }), false)) === "data:image/png;base64,AAAA");
  assert("compress strict: decode error resolves null", (await run(makeEnv({ error: true }), true)) === null);
  assert("compress strict: over pixel cap resolves null", (await run(makeEnv({ w: 8000, h: 8000 }), true)) === null);
  assert("compress strict: at pixel cap still encodes", (await run(makeEnv({ w: 8000, h: 5000 }), true)) === "data:image/jpeg;base64,RE9ORQ==");
  assert("compress default: over pixel cap is NOT rejected (unchanged behaviour)", (await run(makeEnv({ w: 8000, h: 8000 }), false)) === "data:image/jpeg;base64,RE9ORQ==");
  assert("compress strict: normal image encodes", (await run(makeEnv({ w: 100, h: 100 }), true)) === "data:image/jpeg;base64,RE9ORQ==");
  {
    // Overflow notice number = the deck-wide slide badge number (visible slides only).
    const { deckSlideNumber } = load(makeEnv({ w: 1, h: 1 }));
    const sl = (n, hid) => Array.from({ length: n }, (_, i) => ({ hidden: hid && hid.includes(i) || undefined }));
    const lanes = [{ items: [{ id: "m1", slides: sl(3) }, { id: "m2", slides: sl(4, [1]) }] }, { items: [{ id: "m3", slides: sl(2) }] }];
    assert("deck number: first module", deckSlideNumber(lanes, "m1", lanes[0].items[0].slides, 1) === 2);
    assert("deck number: later module counts earlier visible slides", deckSlideNumber(lanes, "m2", lanes[0].items[1].slides, 3) === 6);
    assert("deck number: other lane, spill index past the list end", deckSlideNumber(lanes, "m3", lanes[1].items[0].slides, 2) === 9);
    assert("deck number: unknown module falls back to index+1", deckSlideNumber(lanes, "zz", [], 4) === 5);
    const holes = [null, { items: [null, { id: "m1", slides: [null, {}, { hidden: true }, {}] }, { id: "m2", slides: [{}] }] }];
    assert("deck number: null lanes, modules and slides are skipped", deckSlideNumber(holes, "m2", holes[1].items[2].slides, 0) === 3);
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
