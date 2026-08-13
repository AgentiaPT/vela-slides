## Triage — how much of this skill your change needs

§0 (the five non-negotiables) = MANDATORY for every change, always. Then:

PATH=full → read §1–§6. REQUIRED if the change does:
· reads any deck-supplied field (new or existing) anywhere
· touches sanitizer / encoder / allowlist / `SAFE_*` key set
· touches exporter (PDF|PPTX|Markdown|standalone HTML)
· touches `part-imports.jsx` `part-pdf.jsx` `part-pdf-extract.jsx` `part-pdf-vector.jsx` `part-export-md.jsx` `part-pptx.jsx` `serve.py` `assemble.py` `agent_backend.py` | anything under `vela-neutralino/`
· touches storage/reload path | startup patch | CI/release/build script | any `dangerouslySetInnerHTML` / `<style>` / CSS-sink / native-bridge code

PATH=quick → §0 + §2 table as lookup + §5 gates. ENOUGH if:
· change confined to app-chrome/editor UI with static code-authored values (e.g. reposition an existing editor control, add a button dispatching an existing action, change static styling of app chrome),
· reads no deck value it doesn't already receive sanitized
QUICK-PATH INVARIANTS (stay in force): NEVER interpolate any deck-derived value into a style/URL/DOM sink without its §2 helper; NEVER introduce a new external fetch.

ELSE in doubt — or you touch a full-read item mid-change — STOP, read the whole skill.
NOTE post-edit lint + CI gates run after the change.
