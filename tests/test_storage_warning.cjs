// Regression test for CR2: in Claude.ai artifact mode, the deck lives only in
// browser localStorage (no file), so users need a visible, dismissible nudge
// to export/back up their work. Source-pattern check on part-app.jsx.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "skills/vela-slides/app/parts/part-app.jsx"), "utf8");

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("  ✅ " + n); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d ? " — " + d : "")); };

// (a) references velaIsArtifactMode for the warning
if (/velaIsArtifactMode/.test(src)) ok("references velaIsArtifactMode");
else bad("references velaIsArtifactMode");

// (b) has backup/export warning copy
if (/(export|back ?up)/i.test(src) && /(localStorage|browser storage|claude\.ai)/i.test(src) && /storage-warning/.test(src)) {
  ok("has backup/export warning copy near storage-warning banner");
} else {
  bad("has backup/export warning copy near storage-warning banner");
}

// (c) stable test ids for banner + dismiss control
if (/data-testid="storage-warning"/.test(src)) ok('has data-testid="storage-warning"');
else bad('has data-testid="storage-warning"');

if (/data-testid="storage-warning-dismiss"/.test(src)) ok('has data-testid="storage-warning-dismiss"');
else bad('has data-testid="storage-warning-dismiss"');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 2 : 0);
