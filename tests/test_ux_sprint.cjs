const fs = require("fs");
const path = require("path");
const read = (name) => fs.readFileSync(path.join(__dirname, "..", "src/parts", name), "utf8");
const blocks = read("part-blocks.jsx");
const slides = read("part-slides.jsx");
const list = read("part-list.jsx");
let pass = 0, fail = 0;
const check = (name, value) => { if (value) { pass++; console.log("  ✅ " + name); } else { fail++; console.log("  ❌ " + name); } };

check("0px branding accent is preserved by the control", slides.includes("value={b.accentHeight ?? 4}"));
check("0px branding accent is preserved by the renderer", blocks.includes("height: b.accentHeight ?? 4"));
check("accent bar has an explicit on/off control", slides.includes("accentBar: !b.accentBar"));
check("branding opens as a right-side inspector", slides.includes('data-testid="branding-inspector"') && slides.includes("borderLeft:"));
check("present gallery is an accessible high-contrast button", slides.includes('aria-label="Gallery view"') && slides.includes('getIcon("layout-grid"'));
check("present edit is an accessible button", slides.includes('aria-label="Edit while presenting"'));
check("TOC rows expose direct slide deletion", list.includes('data-testid="toc-delete-slide"') && list.includes("ctxDelete(si)"));
check("block link badges use a stable inside anchor", blocks.includes('data-testid="block-link-badge"') && /top: 2, right: 2/.test(blocks));
check("linked text badges follow content width instead of the slide edge", blocks.includes('(b.type === "text" || b.type === "badge") && b.link ? { width: "fit-content", maxWidth: "100%" }'));

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
