// Cluster L source-pattern tests: gallery hide toggle (CR4), brand line 0px (CR8), TOC slide delete (CR14).
const fs = require("fs");
const path = require("path");
const rd = (f) => fs.readFileSync(path.join(__dirname, "..", "src/parts", f), "utf8");
const slides = rd("part-slides.jsx"), list = rd("part-list.jsx"), brand = rd("part-branding.jsx");
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n); } };

t("CR4: gallery hide button dispatches TOGGLE_SLIDE_HIDDEN", /data-testid="gallery-hide-slide"[^]{0,300}TOGGLE_SLIDE_HIDDEN/.test(slides));
t("CR4: gallery hide button shows hidden state", /data-hidden=\{s\.slide\.hidden/.test(slides) && slides.includes('"🙈" : "👁"'));
t("CR4: gallery hide sits before delete button", slides.indexOf("gallery-hide-slide") < slides.indexOf("gallery-delete-slide"));
t("CR8: branding accent height has no falsy-zero default", !/accentHeight \|\| 4/.test(brand + slides));
t("CR8: bar renders only when height > 0", /accentH > 0 && <div data-testid="branding-accent-bar"/.test(brand));
t("CR8: unset height defaults to 4", /typeof b\.accentHeight === "number" \? b\.accentHeight : 4/.test(brand));
t("CR8: logo offset ignores a zero-height bar", /accentH > 0 \? accentH \+ 8 : 10/.test(brand));
t("CR14: TOC slide row has delete icon calling ctxDelete", /data-testid="slide-row-delete"[^]{0,200}ctxDelete\(si\)/.test(list));

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
