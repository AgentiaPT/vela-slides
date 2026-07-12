# Coverage-Gap Report — Block Renderers, Security Sanitizers & Render Battery

Slice: `src/parts/part-blocks.jsx` (27 block renderers) + sanitizers in
`src/parts/part-imports.jsx` + `src/parts/part-blocks.jsx` + the render/security
node suites. Repo root: `/home/user/vela-slides`.

Nothing was modified. All test commands were run to capture real results.

---

## 1. Stack execution results (real, this run)

| Suite | Command | Result | Notes |
|-------|---------|--------|-------|
| CSS exfil | `node tests/test_css_exfil.cjs` | ✅ **68 passed, 0 failed** | Pure-JS (no jsdom). Covers `scrubColorFields`, `scrubLayoutFields`, `STYLE_VALUE_REJECT`, `cssUrl`, `cssColor`, `isSvgStyleSafe`, `sanitizeBlock` wiring, matrix/bgImage sinks. |
| SVG mutation-XSS | `node tests/test_svg_mxss.cjs` | ✅ **46 passed, 0 failed** | Needed `npm i jsdom` first (installed cleanly). Rawtext-family blocklist, comment/PI smuggling, network auto-load suite (image-set/image/cross-fade/src/feImage/use/`<image>` aliasing), fragment-ref preservation. |
| data: image URI | `node tests/test_data_image_uri.cjs` | ✅ **18 passed, 0 failed** | Needed jsdom. Raster passthrough vs. `data:image/svg+xml` routed through the SVG sanitizer; non-image `data:` dropped. |
| AI image preserve | `node tests/test_image_preserve.cjs` | ✅ **11 passed, 0 failed** | `stripImageSrcs`/`restoreImageSrcs`/`preserveImages` round-trips (L/R + grid-cell). |
| Standalone HTML export | `node tests/test_standalone_html.cjs` | ✅ **17 passed, 0 failed** | Babel "deoptimised >500KB" notes are benign. |
| Python CI suite | `python3 tests/test_vela.py` | ✅ **356 passed** | CLAUDE.md says 349; suite has grown. Static string/regex guards + subprocess wiring for all node suites above. |

**Environment note:** `jsdom` is **not** committed; two suites hard-skip
(`exit 2`) without it. `npm i jsdom` succeeded in-container. `tests/test_review_ui.cjs`
(32 Playwright e2e review-mode tests, in CI) was **not** run here — it needs a
browser/server and is out of this slice (review/comments UI, not block render).

---

## 2. Block coverage matrix (all 27 types)

**Key finding first:** No automated test in the **CI gate** (`test_vela.py`)
React-renders *any* block. `test_vela.py` is 100% static string/regex analysis of
the concatenated JSX plus node-subprocess **sanitizer** suites — it never mounts
React. The only places blocks actually render are the **in-browser batteries**,
which are **not part of the CI gate** (`.github/workflows/ci.yml` runs only
`test_vela.py --unit/--integration`, `test_serve`, `test_desktop`,
`test_review_ui.cjs`, `concat.py`, and the pptx e2e — none exercise
`RenderBlock`):

- `part-test.jsx` (`VELA_TESTS` battery, auto-runs on mount) — **does NOT render blocks.** It checks utility functions, reducer actions, and *component existence* (`typeof RenderBlock === "function"`). Zero `RenderBlock` invocations.
- `part-uitest.jsx` (159 UI tests via `window.__velaRunUITests()` / `vela-drive.js uitests`) — renders the **whole app with the demo deck**, but block assertions are generic only: "At least 1 slide renders", "Slide has visible headings", "Slide has multiple blocks". It navigates a handful of slides; it does not iterate block types or branches.
- Offline harness (`render-offline.js` + `vela-drive.js shot/uitests`) — renders `examples/vela-demo.vela`, whose thumbnails/gallery mount **every** slide. **The demo deck contains all 27 block types** (verified by counting `"type"` keys), so each type *does* get exercised for "renders without throwing" — but only if someone runs the harness, and with **no per-type / per-branch assertion**.

Legend: **❌** = no render anywhere in the CI gate (true for every block);
**🟡** = implicitly rendered by the demo deck in the *non-CI* UI harness (smoke
only, no assertion); **✅** = explicit per-type render assertion (none exist).

| # | Block (`case`) | CI render? | Harness smoke? | Rendered by | Untested branches / props | Notes |
|---|----------------|:---:|:---:|-------------|---------------------------|-------|
| 1 | `heading` | ❌ | 🟡 | demo deck (109×) | `**bold**` markdown strip, `icon`+`iconColor` slot, `align` L/C/R, `maxWidth`+center margin, `weight`, `size` scale, `block.style` merge | High demo presence; no assertion of markdown stripping. |
| 2 | `text` | ❌ | 🟡 | demo deck (77×) | `italic`, `bold`, `maxWidth` centering, `multiline`, `size`/`color` overrides | |
| 3 | `bullets` | ❌ | 🟡 | demo deck (14×) | string-item vs object-item, per-item `link`/`color`, `gap`, `AddItem` affordance (edit-only) | `BulletItem` sub-component never asserted. |
| 4 | `image` | ❌ | 🟡 | demo deck (1×) | `_solo` full-bleed path, `fit`, `rounded`, `shadow`, `maxWidth/maxHeight`, `caption`, empty-src placeholder, `ZoomWrap`, `link` | **Src sanitization** *is* tested (data-URI suite) but **render** is not. Only 1 image in demo. |
| 5 | `code` | ❌ | 🟡 | demo deck (4×) | `CodeBlock` sub-component: language, line handling, copy, syntax coloring | Delegated component wholly unasserted. |
| 6 | `grid` | ❌ | 🟡 | demo deck (25×) | `cols`, per-cell `bg`/`padding`/`border`/`borderRadius`/`direction=row`/`align`, cell-level `link`, nested `GridCellBlock`, sanitized cell `style` guard | Heavy demo use; nested block recursion never asserted. |
| 7 | `callout` | ❌ | 🟡 | demo deck (18×) | `CalloutBlock` sub-component: variant/tone, icon, title/body | Delegated component unasserted. |
| 8 | `metric` | ❌ | 🟡 | demo deck (12×) | `align`, `icon`+`iconColor`, `size`, `label`/`labelColor`, value formatting | |
| 9 | `quote` | ❌ | 🟡 | demo deck (3×) | `author` line, smart-quote prefix/suffix, `size` | |
| 10 | `divider` | ❌ | 🟡 | demo deck (2×) | `color`, `spacing`, `block.style` | Trivial. |
| 11 | `spacer` | ❌ | 🟡 | demo deck (146×) | `h` height | Trivial; most-used block. |
| 12 | `svg` | ❌ | 🟡 | demo deck (8×) | Theme-token injection (`{{color}}`/`{{accent}}`/`{{bg}}`/`{{muted}}`), `ZoomWrap`, `caption`, `bg`/`padding`/`rounded`/`align` | **Sanitizer path richly tested** (mXSS 46, data-URI 18) but the **token-injection + render wrapper** are not asserted end-to-end. |
| 13 | `badge` | ❌ | 🟡 | demo deck (22×) | `bg`/`border` (padded vs bare), `icon` slot, `size`-driven padding math | |
| 14 | `icon` | ❌ | 🟡 | demo deck (8×) | `circle!==false` (IconBubble vs bare), unknown-name `⚠` fallback (edit vs non-edit), `size` map, `strokeWidth`, `label` | Unknown-icon fallback branch untested. |
| 15 | `icon-row` | ❌ | 🟡 | demo deck (8×) | `cols>1` grid vs column, per-item `IconRowItem`, `gap` | |
| 16 | `flow` | ❌ | 🟡 | demo deck (10×) | `direction=vertical`/horizontal, `connectorStyle` arrow/dashed/line, per-item **`gate`** (+`gateIcon`/`gateLabel`/`gateColor`), **`loop`** H & V (+`loopStyle` dotted/solid, `loopLabel`, marker defs), `sublabel`, `labelSize` scale | **Richest branch surface in the file; entirely unasserted.** Gates & loops are the block's headline feature. |
| 17 | `table` | ❌ | 🟡 | demo deck (2×) | headerless mode (col count from rows), `striped`, `headerBg`/`headerColor`/`cellColor`/`borderColor`, first-col emphasis, add-row | Only 2 tables in demo; striped/headerless likely never hit. |
| 18 | `progress` | ❌ | 🟡 | demo deck (2×) | single-value vs `items[]` mode, `leftLabel`/`rightLabel`+icons, `showValue`, `annotation`, value clamp 0–100, `height`/`trackColor` | Dual data-shape branch untested. |
| 19 | `steps` | ❌ | 🟡 | demo deck (3×) | numbered connector line, `lineColor`, per-item title/text | Sub-render below line 1023 not fully inspected; low demo count. |
| 20 | `tag-group` | ❌ | 🟡 | demo deck (5×) | tag styling, per-item variants | |
| 21 | `timeline` | ❌ | 🟡 | demo deck (2×) | **`direction=vertical` vs horizontal** (two distinct layouts), `date`/`title`/`text` optional, `lineColor`/`dotColor`/`dateColor`/`titleColor`/`textColor`, `titleSize`/`textSize` | Both layout branches unasserted; only 2 in demo. |
| 22 | `comparison` | ❌ | 🟡 | demo deck (1×) | `items[0]`/`items[1]` sides, per-side `icon`/`title`/`color`, string vs object points, **`hideDivider`**, `dividerLabel`, per-point add/delete/link | **Only 1 in demo; `hideDivider` + custom colors almost certainly never rendered.** |
| 23 | `funnel` | ❌ | 🟡 | demo deck (1×) | SVG polygon geometry by count, per-item `highlight` (dashed+⚠), `value`, `drop` label, `color` | Pure inline-SVG generation; only 1 in demo. |
| 24 | `cycle` | ❌ | 🟡 | demo deck (1×) | circular SVG layout, `centerLabel`/`centerSub`, per-node arc markers, `icon` (emoji text), default color cycle | Trig-heavy geometry with zero numeric assertions. |
| 25 | `number-row` | ❌ | 🟡 | demo deck (1×) | `showIcons`, `bordered`, `compact` (sizing branch), per-item `color`/`icon`/`value`/`label`, dividers | Compact/bordered branches untested. |
| 26 | `matrix` | ❌ | 🟡 | demo deck (1×) | `quadrants` vs `items` key duality (`qKey`), `xLeft/xRight/yTop/yBottom` axis labels (+rotated Y), `cssColor` quadrant sink, per-point add/delete/link, 4-quadrant radii | **`cssColor` quadrant sink IS security-tested** (css-exfil suite) but the 2×2 render + axis-label branches are not. |
| 27 | `checklist` | ❌ | 🟡 | demo deck (1×) | 4 statuses (`done`/`partial`/`blocked`/`pending`) each with distinct icon/color/label, `showLabels`, string vs object items, `partial` half-fill visual | All 4 status branches unasserted; only 1 in demo (single status). |
| — | `default` | ❌ | ❌ | — | Unknown type → `return null` | No test asserts unknown types are safely dropped at render (they *are* filtered earlier by `SAFE_BLOCK_TYPES`). |

**Bottom line:** **0 of 27** block types have an explicit render assertion.
In the CI gate, **0 of 27** render at all. Under the (opt-in, non-CI) UI harness,
all 27 get "does it throw?" smoke coverage via the demo deck — but the *branch/prop*
surface (flow gates & loops, timeline/progress dual layouts, table striped/headerless,
comparison hideDivider, checklist statuses, number-row compact/bordered, funnel/cycle
geometry) is essentially untested. Blocks appearing **once** in the demo deck
(image, comparison, funnel, cycle, number-row, matrix, checklist) have the weakest
even-smoke coverage — a single fixed variant.

---

## 3. Security / sanitizer coverage matrix

Sanitizers live in `part-imports.jsx` (import-time) and are also called at the
render sink for `svg`. Coverage here is **strong** — the security surface is by
far the best-tested part of this slice.

*(Gaps described at class level per the repo's Security-Fix Disclosure Discipline —
no payloads/repro strings.)*

| Sanitizer / attack class | Covered? | By which suite | Gaps (high-level) |
|--------------------------|:---:|----------------|-------------------|
| **SVG mutation-XSS** (rawtext-family element smuggling, comment/CDATA/PI round-trip, `<style>` walk-descent) | ✅ Strong | `test_svg_mxss.cjs` (jsdom round-trip) + `test_vela.py` source guards (allowlist, `SVG_ALLOWED_TAGS`, node-drop) | Functional suite is **jsdom-gated** — silently *skips* if jsdom absent (not committed). A CI without the jsdom install step would pass with the functional layer dark; only source-string guards remain. |
| **SVG external auto-load / zero-click exfil** (`url()`, `image-set`/`image()`/`cross-fade()`/`src()` string sources, `feImage`/`use`/`<image>` href/src/srcset, HTML-aliasing of `<image>`→`<img>`) | ✅ Strong | `test_svg_mxss.cjs` network suite + `test_css_exfil.cjs` (`isSvgStyleSafe`) | Well covered incl. same-origin `data:` bypass and fragment-ref preservation. |
| **`href`/`xlink:href` scheme allowlist** (`javascript:`/`data:`/`vbscript:`, whitespace/control-char obfuscation) | ✅ | `test_svg_mxss.cjs` (`<a>` https preserved, click-link cases) | Scheme-folding logic (tab/newline stripping) exercised via mXSS payloads; `openExternalLink` re-sink at click time (`part-imports.jsx:426`) has **no dedicated test**. |
| **CSS exfil on color scalars** (auto-load values in `bg`/`accent`/24 color keys, over-long values, `url()`/`expression`/`@import`/`://`/comment-split) | ✅ Strong | `test_css_exfil.cjs` (68) | `STYLE_VALUE_REJECT` name-agnostic function reject verified; legit shadows/fontFamily preserved. |
| **CSS exfil on layout scalars** (`scrubLayoutFields`) | ✅ | `test_css_exfil.cjs` | Verified strips `url()`/injection, keeps `calc()`/`%`/`px`. |
| **`cssUrl` / `cssColor` sinks** (bgImage `url()` quoting/escaping, matrix quadrant color) | ✅ | `test_css_exfil.cjs` (sink-wiring + escaping) | Newline strip, embedded-quote escape covered. |
| **`data:` image URI** (raster allowlist vs `data:image/svg+xml` routed to SVG sanitizer; non-image `data:` dropped) | ✅ | `test_data_image_uri.cjs` (18) + `test_vela.py` wiring | jsdom-gated skip risk (same as above). Applies to image block `src`, slide `bgImage`, branding `logo`. |
| **`sanitizeBlock` field wiring** (scrub color+layout on block, `items`, `quadrants`, cell blocks; markup length clamp 50 000; nested L/R/blocks recursion) | ✅ | `test_css_exfil.cjs` + `test_vela.py` source guards | Recursion depth / adversarial deeply-nested decks not stress-tested; length-clamp value not asserted functionally. |
| **AI image-src preservation** (model round-trip can't smuggle/lose real `src`) | ✅ | `test_image_preserve.cjs` (11) | Security-adjacent (integrity, not injection). |
| **Unknown-block filtering** (`SAFE_BLOCK_TYPES` gate before render) | 🟡 Partial | `test_vela.py` membership guards (each type ∈ `SAFE_BLOCK_TYPES`/`VALID_BLOCK_TYPES`) | Membership asserted; no *functional* test that a non-allowlisted type is actually dropped by `sanitizeBlock`/`RenderBlock` default. |
| **`sanitizeStudyNotes` diagram** (chat/notes SVG routed through `sanitizeSvgMarkup`, 8 000 clamp) | ✅ | `test_vela.py` source guard | Outside strict block slice but shares the sanitizer. |

**Sanitizer summary:** attack-class coverage is comprehensive and defense-in-depth
(import-time + render-sink). The **systemic risk is the jsdom gate**: three of the
strongest functional suites (`test_svg_mxss`, `test_data_image_uri`) `exit 2` /
skip when jsdom is missing, and jsdom is not committed. If a CI runner ever lacks
the install step, those layers go silently dark, leaving only string-match guards.

---

## 4. Detailed gaps (ranked)

1. **No React-render test in the CI gate for any block** — *whole slice.*
   `tests/test_vela.py` never mounts `RenderBlock`; `part-test.jsx` only checks
   `typeof RenderBlock === "function"` (`part-test.jsx:213`). A regression that
   throws inside any renderer branch passes CI. **A test should:** render each of
   the 27 types (minimal + branch-exercising props) via `renderToStaticMarkup` (or
   promote the `vela-drive.js uitests` battery into the CI gate) and assert no
   throw + a type-distinctive DOM signature (e.g. `data-block-type`).

2. **`flow` gates & loops unasserted** — `part-blocks.jsx:878-952`.
   The block's headline feature (`item.gate`, `block.loop` H/V, `loopStyle`,
   `connectorStyle`, `direction`) has the largest branch surface and zero
   assertions. **Assert:** gate node + loop `<path>`/`<marker>` render for both
   orientations and each connector style.

3. **jsdom-gated security suites can silently skip** — `test_vela.py:388-425`,
   `test_svg_mxss.cjs:20`, `test_data_image_uri.cjs:22`. **Assert/fix:** either
   commit jsdom as a dev-dep or make the CI gate *fail* (not skip) when the
   functional SVG/data-URI suites can't load, so the mXSS/exfil layer can't go
   dark unnoticed.

4. **Dual-layout / dual-shape blocks test only one path** —
   `timeline` vertical vs horizontal (`:1082` vs `:1105`), `progress` single-value
   vs `items[]` (`:979`), `matrix` `quadrants` vs `items` key (`:1310/1320`),
   `table` headerless vs headered + `striped` (`:957/968`). **Assert:** both
   branches of each render.

5. **`checklist` four status branches** — `part-blocks.jsx:1378-1399`.
   `done`/`partial`/`blocked`/`pending` each drive distinct icon/color/half-fill.
   Only single-status instances exist in the demo deck. **Assert:** each status'
   marker + label renders.

6. **Delegated sub-components never asserted** — `CodeBlock` (`:772`),
   `CalloutBlock` (`:800`), `BulletItem` (`:757`), `IconRowItem` (`:872`),
   `GridCellBlock` (`:787`), `ItemChrome`/`AddItem`/`EditableText`/`EditableIcon`.
   These carry real branching (code language, callout tone, nested grid recursion)
   and are invisible to current tests. **Assert:** at least a render smoke per
   sub-component.

7. **`openExternalLink` click-time re-sanitization** — `part-imports.jsx:426`.
   Second line of defense for link schemes; only indirectly exercised. **Assert:**
   `javascript:`/`data:` links are neutralized at the click sink (class-level, no
   payloads).

8. **Geometry-only SVG blocks** — `funnel` (`:1196`), `cycle` (`:1229`).
   Trig/polygon math with per-item `highlight`/`drop`/`centerLabel`; single fixed
   instance in demo. **Assert:** N-item render produces N stages/nodes without NaN
   in path coords.

9. **Blocks that appear exactly once in the demo deck** — image, comparison,
   funnel, cycle, number-row, matrix, checklist. Even the harness smoke only ever
   sees one frozen variant. **Assert:** a dedicated multi-variant fixture deck.

10. **`default` / unknown-type render** — `part-blocks.jsx:1406`. Assert
    unknown types yield `null` (and are dropped by `sanitizeBlock`) as a
    fail-closed contract test.

---

## 5. Quick wins vs. deep gaps

**Quick wins (low effort, high value):**
- Commit `jsdom` as a dev-dependency (or fail-not-skip in CI) — closes the single
  biggest *systemic* risk; the suites already exist and pass (#3).
- Add a `renderToStaticMarkup` smoke loop over all 27 types with minimal props —
  ~30 lines, converts every ❌ to a real ✅ for "renders without throwing" (#1).
- Assert the `default` case returns `null` (#10) — one-liner.
- Add per-status `checklist` and both-orientation `timeline`/`table`-striped
  assertions (#4, #5) — small, deterministic DOM checks.

**Deep gaps (real engineering):**
- Branch-complete coverage of `flow` gates & loops and the SVG-geometry blocks
  (`funnel`/`cycle`/`matrix`) — needs a fixture deck plus DOM/structure assertions,
  ideally promoted into the CI gate rather than the opt-in harness (#2, #8, #9).
- Coverage for the delegated sub-components (`CodeBlock`, `CalloutBlock`, grid
  recursion) with their own branch matrices (#6).
- Making the in-browser UI battery (`part-uitest.jsx`) part of the CI gate so
  render regressions are caught automatically, not only when a human runs
  `vela-drive.js uitests` (#1).

**Strong areas (leave as-is):** the injection/exfil **sanitizer** surface — CSS
exfil, SVG mutation-XSS, external auto-load, `data:` URI, scheme allowlists — is
comprehensively and redundantly tested (68 + 46 + 18 assertions plus source
guards). The gap is almost entirely on the **rendering** side, not the security
side.
