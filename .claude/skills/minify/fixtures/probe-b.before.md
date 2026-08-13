## Triage — how much of this skill your change needs

**§0 (the five non-negotiables) is mandatory for every change, always.** Then:

**Full read required** (§1–§6) if your change does ANY of: reads a new or
existing deck-supplied field anywhere; touches a sanitizer, encoder, allowlist,
or `SAFE_*` key set; touches an exporter (PDF/PPTX/Markdown/standalone HTML);
touches `part-imports.jsx`, `part-pdf.jsx`, `part-pdf-extract.jsx`,
`part-pdf-vector.jsx`, `part-export-md.jsx`, `part-pptx.jsx`, `serve.py`,
`assemble.py`, `agent_backend.py`, or anything under `vela-neutralino/`;
touches storage/reload paths, the startup patch, CI/release/build scripts, or
any `dangerouslySetInnerHTML`/`<style>`/CSS-sink/native-bridge code.

**Quick path** (§0 + the table in §2 as a lookup + §5's gates) is enough ONLY
when the change is confined to app-chrome/editor UI with static, code-authored
values — e.g. repositioning existing editor controls, adding a button that
dispatches an existing action, changing static styling of app chrome — and
reads no deck value it doesn't already receive sanitized. Two hard rules stay
in force on the quick path: never interpolate any deck-derived value into a
style/URL/DOM sink without its §2 helper, and never introduce a new external
fetch. **If in doubt — or if mid-change you touch anything in the full-read
list — stop and read the whole skill.** The post-edit lint and CI gates run
regardless of path.
