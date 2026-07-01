// Regression test for CR: AI edits must never drop existing images.
// Extracts preserveImages + restoreImageSrcs from part-engine.jsx and exercises
// the image-loss scenarios (drop / placeholder-echo / reorder / count-mismatch).
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "skills/vela-slides/app/parts/part-engine.jsx"), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  // brace-match to end of function
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
}

// eslint-disable-next-line no-eval
eval(extract("restoreImageSrcs"));
// eslint-disable-next-line no-eval
eval(extract("preserveImages"));
// eslint-disable-next-line no-eval
eval(extract("stripImageSrcs"));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };
const imgCount = (bl) => bl.filter((b) => b.type === "image").length;
const IMG = { type: "image", src: "data:image/png;base64," + "A".repeat(300), caption: "orig" };

// 1. Model drops the image entirely → it must be re-appended.
{
  const orig = [{ type: "heading", text: "H" }, IMG];
  const out = preserveImages([{ type: "heading", text: "H2" }, { type: "text", text: "new" }], orig);
  if (imgCount(out) === 1 && out.find((b) => b.type === "image").src === IMG.src) ok("dropped image is re-appended with real src");
  else bad("dropped image is re-appended", JSON.stringify(out.map((b) => b.type)));
}

// 2. Model echoes the placeholder src → real src restored, model edits kept.
{
  const orig = [IMG];
  const out = preserveImages([{ type: "image", src: "keep-original", caption: "edited", maxWidth: "60%" }], orig);
  const im = out.find((b) => b.type === "image");
  if (im.src === IMG.src && im.caption === "edited" && im.maxWidth === "60%") ok("placeholder echo restores real src, keeps model edits");
  else bad("placeholder echo restore", JSON.stringify(im));
}

// 3. Reorder: image moved before heading → src preserved.
{
  const orig = [{ type: "heading", text: "H" }, IMG];
  const out = preserveImages([{ type: "image", src: "keep-original" }, { type: "heading", text: "H" }], orig);
  if (out[0].type === "image" && out[0].src === IMG.src) ok("reordered image keeps real src");
  else bad("reordered image", JSON.stringify(out.map((b) => b.type + ":" + (b.src ? b.src.slice(0, 12) : ""))));
}

// 4. No original images → passthrough unchanged.
{
  const nb = [{ type: "text", text: "x" }];
  if (preserveImages(nb, [{ type: "heading", text: "H" }]) === nb) ok("no-op when no original images");
  else bad("no-op passthrough");
}

// 5. restoreImageSrcs re-appends dropped image (design-API path).
{
  const orig = [{ type: "heading", text: "H" }, IMG];
  const improved = { blocks: [{ type: "heading", text: "H2" }] };
  restoreImageSrcs(improved, orig);
  if (imgCount(improved.blocks) === 1 && improved.blocks.find((b) => b.type === "image").src === IMG.src) ok("restoreImageSrcs re-appends dropped image");
  else bad("restoreImageSrcs re-append", JSON.stringify(improved.blocks.map((b) => b.type)));
}

// 6. Two images, model keeps one → the other is re-appended (both survive).
{
  const IMG2 = { type: "image", src: "data:image/png;base64," + "B".repeat(300) };
  const orig = [IMG, IMG2];
  const out = preserveImages([{ type: "image", src: "keep-original" }], orig);
  const srcs = out.filter((b) => b.type === "image").map((b) => b.src);
  if (srcs.length === 2 && srcs.includes(IMG.src) && srcs.includes(IMG2.src)) ok("both images survive when model keeps only one");
  else bad("two-image survival", JSON.stringify(srcs.map((s) => s.slice(0, 24))));
}

// 7. stripImageSrcs must NOT strip split-column (L/R) images — there is no
//    restore path for them, so stripping would turn them into "keep-original"
//    (data loss). Regression guard.
{
  const slide = { layout: "cols", blocks: [], L: [{ type: "image", src: IMG.src }], R: [{ type: "image", src: IMG.src, caption: "r" }] };
  const stripped = stripImageSrcs(slide);
  if (stripped.L[0].src === IMG.src && stripped.R[0].src === IMG.src) ok("stripImageSrcs leaves L/R images intact (no restore path)");
  else bad("stripImageSrcs clobbered L/R", JSON.stringify([stripped.L[0].src.slice(0, 16), stripped.R[0].src.slice(0, 16)]));
  // top-level blocks image still stripped
  const s2 = stripImageSrcs({ blocks: [{ type: "image", src: IMG.src }] });
  if (s2.blocks[0].src === "keep-original") ok("stripImageSrcs still strips top-level block images"); else bad("stripImageSrcs top-level", s2.blocks[0].src);
}

// 8. preserveImages protects an L/R array the same way (edit_slide L/R path).
{
  const origL = [{ type: "image", src: IMG.src, caption: "L" }];
  const out = preserveImages([{ type: "heading", text: "H" }], origL); // model dropped the image
  if (out.filter((b) => b.type === "image").length === 1 && out.find((b) => b.type === "image").src === IMG.src) ok("preserveImages guards L/R arrays (dropped image re-appended)");
  else bad("preserveImages L/R guard", JSON.stringify(out.map((b) => b.type)));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
