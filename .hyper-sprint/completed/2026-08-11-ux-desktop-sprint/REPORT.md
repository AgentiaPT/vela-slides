# UX/Desktop Hyper-Sprint Proof Report

**Date:** 2026-08-11  
**Release:** Vela 13.37  
**Outcome:** Programmatic acceptance passed for all 11 requested outcomes. Recorded visual demo and screenshots are unavailable because this environment contains no Chromium executable and its package proxy denied the single provisioning attempt.

## Acceptance outcomes

1. **Brand line can be removed at 0 px — passed.** The branding control and renderer preserve a numeric zero rather than replacing it with the default height. Branding also exposes an explicit accent-line on/off control. Focused proof: `tests/test_ux_sprint.cjs` assertions for the 0 px control, 0 px renderer, and explicit toggle.
2. **Branding configuration is a professional right-side pane — passed.** Branding now opens as a full-height, scrollable right-side inspector with a close affordance. It overlays rather than vertically compressing the fixed-aspect editor canvas. Focused proof: the right-inspector contract in `tests/test_ux_sprint.cjs`.
3. **Presenter gallery control remains visible — passed programmatically.** The gallery action is an accessible semantic button with a Lucide grid icon, backed by high-contrast shared presenter-control styling rather than a low-opacity emoji over arbitrary artwork. Focused proof: the presenter gallery assertion in `tests/test_ux_sprint.cjs`.
4. **Presenter edit control remains visible — passed programmatically.** The edit action is an accessible semantic button using the same high-contrast chrome. Existing intentional rules remain: edit is hidden in Student mode and presenter controls retain the existing mobile policy. Focused proof: the presenter edit assertion in `tests/test_ux_sprint.cjs`.
5. **Neutralino HTML export avoids duplicate React hook declarations — passed.** Standalone export removes a pre-existing generated Neutralino UMD shim before inserting its canonical shim. The regression sends a synthetic Neutralino-prefixed source through the real vendored Babel transform. Focused proof: `tests/test_standalone_html.cjs` (18 checks) plus release JSX Babel parsing.
6. **Gallery/overview is discoverable from the editor — passed.** The existing labeled editor Overview action remains in the primary slide toolbar, while presenter Gallery is now a clear high-contrast grid button. The canonical suite covers gallery presence and editor access.
7. **Slides can be deleted directly from the editor TOC — passed.** Each TOC row has a direct, accessible trash action. It stops row-selection propagation and uses the existing multiselect-aware delete path. Focused proof: the TOC delete assertion in `tests/test_ux_sprint.cjs`; reducer deletion and undo coverage remains green in the canonical suite.
8. **Full-bleed block toolbar is no longer clipped — passed programmatically.** Block-level hover actions use a positive inside inset instead of escaping above/right of full-bleed content. Existing table/code/PPTX DOM contracts and column clipping behavior remain intact. Focused proof: `tests/test_block_toolbar_clip.cjs` (4/4).
9. **Neutralino native title includes the deck title — passed.** Boot code observes React-managed `document.title`, normalizes historical title orders to `Vela Slides — <Deck Title>`, removes repeated branding, bounds/control-filters the title, and mirrors it through the enumerated `window.setTitle` capability. Focused proof: `tests/test_desktop.py` and `tests/test_nl_boot.cjs`.
10. **Text-block link badges are consistently anchored — passed programmatically.** Block badges use a stable positive inside anchor; linked inline text/badges shrink-wrap to their content rather than anchoring to the far slide edge. Focused proof: two link-placement assertions in `tests/test_ux_sprint.cjs`; canonical link sanitization/export checks remain green.
11. **Keyboard control returns after Neutralino regains focus — passed by source/integration contract.** Neutralino boot listens for native `windowFocus`, browser `focus`, and visible `visibilitychange`, restoring a stable keyboard target only when the document/body owns focus. It does not steal focus from inputs, contenteditable elements, or dialog controls. Focused proof: `tests/test_desktop.py` and JavaScript syntax validation. Native Alt+Tab behavior still requires a provisioned packaged-app environment for manual confirmation.

## Exact verification

| Check | Result |
|---|---|
| `python3 tests/test_vela.py` | **PASS — 503 passed, 0 failed** |
| `node tests/test_ux_sprint.cjs` | **PASS — 9 passed, 0 failed** |
| `node tests/test_block_toolbar_clip.cjs` | **PASS — 4 passed, 0 failed** |
| `node tests/test_standalone_html.cjs` | **PASS — 18 passed, 0 failed** |
| `python3 -m unittest tests.test_desktop -v` | **PASS — 38 tests** |
| `node tests/test_nl_boot.cjs` | **PASS — title retry regression** |
| `python3 tools/vela-dev/scripts/concat.py src/parts /tmp/vela-built.jsx` | **PASS — 14 parts, STARTUP_PATCH present, no duplicate declarations** |
| `cmp -s /tmp/vela-built.jsx skills/vela-slides/app/vela.jsx` | **PASS — generated source synchronized** |
| `python3 tools/vela-dev/scripts/concat.py --release --out /tmp/vela-release.jsx src/parts` | **PASS — 3 dev-only blocks stripped; no test hooks** |
| `python3 tools/vela-dev/scripts/lint.py --parts src/parts` | **PASS — 0 errors; 6 known heuristic balance warnings** |
| `python3 vela-neutralino/scripts/sync-vela.py --check` | **PASS — desktop source current** |
| `python3 -m json.tool vela-neutralino/neutralino.config.json` | **PASS** |
| `node --check vela-neutralino/resources/js/nl-boot.js` | **PASS** |
| Vendored Babel transform of release JSX | **PASS** |
| `git diff --check` | **PASS** |

The Hyper-Sprint offline builder also completed successfully:

```bash
node .hyper-sprint/render-offline.js examples/vela-demo.vela /tmp/vela-readiness-vout
node --check /tmp/vela-readiness-vout/app.js
```

It produced `render.html` and a non-empty external `app.js`; generated JavaScript syntax validation passed.

## Visual-proof limitation

No recorded visual demo or screenshots are included. The limitation is environmental, not represented as a visual pass:

```bash
node tools/vela-dev/scripts/vela-drive.js shot \
  /tmp/vela-readiness-vout/render.html /tmp/vela-readiness-editor.png
```

The driver failed before navigation because Playwright's Chromium executable was absent. `/opt/pw-browsers` does not exist, no Chrome/Chromium binary is available on `PATH`, and a filesystem search found no compatible executable.

One permitted OS-package provisioning attempt was made:

```bash
apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y chromium
```

The configured package proxy returned HTTP 403 for the Ubuntu archive, security, updates, and backports metadata, so apt could not install Chromium. The attempt was not retried. Consequently pixel-level contrast, hover/focus appearance, extreme link geometry, presenter/gallery interaction, and native Alt+Tab behavior remain appropriate follow-up smoke checks in an environment with Chromium and a packaged Neutralino runtime.

## Evidence provenance

This report condenses the sprint's recon, implementation, readiness, and independent blind-verification notes. Raw logs were intentionally not copied into this tracked artifact; the acceptance claims above are backed by the exact commands and summarized terminal outcomes rather than giant or environment-sensitive output.
