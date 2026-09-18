#!/usr/bin/env node
// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//
// Dev-only (never shipped). Parses a JSX file with the vendored Babel and
// reports the first syntax error as JSON on stdout.
//
// Why this exists: concat.py only looked for duplicate declarations, and the
// release-build parse test (tests/test_release_build.cjs) drops the test-only
// parts. An unbalanced bracket in one of those parts therefore reached the
// committed bundle and only showed up two suites later, as an error at EOF.
//
// Exit codes: 0 = parse ok, 1 = syntax error (JSON on stdout), 2 = the
// environment has no vendored Babel (caller must treat this as "skipped").

const fs = require("fs");
const path = require("path");

const BABEL = path.join(__dirname, "../../../vela-neutralino/resources/vendor/babel.min.js");
let Babel;
try { Babel = require(BABEL); }
catch (e) { console.error("no vendored babel: " + e.message); process.exit(2); }

const file = process.argv[2];
if (!file) { console.error("usage: parse-check.js <file.jsx>"); process.exit(2); }

try {
  // code:false / ast:false — parse and validate only, no code generation.
  Babel.transform(fs.readFileSync(file, "utf8"), {
    presets: ["react"], code: false, ast: false, filename: path.basename(file),
  });
  process.exit(0);
} catch (e) {
  const loc = e.loc || {};
  console.log(JSON.stringify({
    message: String(e.message || e).split("\n")[0],
    line: loc.line || 0,
    column: loc.column || 0,
  }));
  process.exit(1);
}
