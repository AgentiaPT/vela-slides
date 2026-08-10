// script-escape.js -- canonical JS mirror of escape_for_script_context()
// (skills/vela-slides/scripts/assemble.py). Escapes the characters that can
// break out of an inline <script> block or terminate a JS string/template
// literal when deck (or other externally-supplied) JSON is spliced into
// source text: <, >, &, U+2028, U+2029. Keep in sync with the Python helper
// -- tests/test_vela.py asserts byte-for-byte parity across every call site.
//
// This is the ONE canonical JS implementation, dual-loadable:
//   - Node, CommonJS `require()`: tools/vela-dev/scripts/render-offline.js.
//   - Neutralino webview, classic (non-module) <script>: nl-boot.js's other
//     sibling files (deck-io.js, agents-bridge.js, ...) are ES modules pulled
//     in via `import`, but ESM `import` requires the target to declare
//     `export` bindings -- which would make this file unrequireable from
//     plain Node (no --experimental flags / .mjs renaming). Since
//     render-offline.js must `require()` it, this file stays CommonJS-only
//     and is instead loaded into the webview as a classic <script> BEFORE
//     nl-boot.js's module script (see index.html -- same load-order trick
//     already used for storage-shim.js), which attaches a global that
//     nl-boot.js reads directly. One implementation, two loader shapes.
(function (root) {
  function escapeForScriptContext(jsonStr) {
    return jsonStr
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { escapeForScriptContext };
  } else {
    root.escapeForScriptContext = escapeForScriptContext;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
