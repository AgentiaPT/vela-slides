# Vela Quick Start — Brainstorm Hypotheses

**Date:** 2026-04-01
**Status:** RAW — no filtering, no evaluation. All ideas saved.

---

## RESEARCH FINDINGS SUMMARY

### What Vela IS today
- 963KB single-file React app, runs inside Claude.ai artifacts
- 21 semantic block types, AI-native (Vera engine with 20 tools)
- CLI (vela.py) with deck/slide/server commands
- Local dev server (serve.py) with Jupyter-style browser, live sync
- Gallery site on GitHub Pages with live first-slide previews
- 5 example decks, rich reference docs (design patterns, themes, block schema)
- SKILL.md prompt for Claude.ai skill upload (ZIP distribution)
- Compact DSL format for LLM generation (32-47% token savings)

### How competitors onboard
- **Slidev**: `npm init slidev` → edit markdown → live reload. 60 seconds to value.
- **Marp**: VS Code extension → add `marp: true` to .md → preview appears. Zero new tools.
- **reveal.js**: Clone repo, open index.html. Simple but verbose.
- **Gamma.app**: Type a sentence → complete styled deck in 30 seconds. Zero install.
- **v0.dev**: Describe UI → working React component in 5 seconds. Real code, not mockup.
- **bolt.new**: Describe app → running full-stack app in browser. Zero local setup.
- **Excalidraw**: excalidraw.com zero-install, npm lib for embedding, MCP server for agents

### Winning onboarding patterns
1. ONE INPUT → COMPLETE OUTPUT (Gamma, v0, bolt)
2. ZERO INSTALL (Gamma, v0, bolt, Excalidraw)
3. MEET USERS WHERE THEY ARE (Marp in VS Code, Copilot in PowerPoint)
4. SINGLE COMMAND (Slidev npm init)
5. LIVE PREVIEW / IMMEDIATE FEEDBACK (all successful tools)
6. REAL OUTPUT NOT DEMO (v0 gives real React, bolt gives running app)

---

## HYPOTHESIS 1: "The Prompt IS the Product"

Vela's quick start is NOT a CLI, NOT an npm package, NOT a config file.
It's a prompt. A single, shareable, copy-pasteable prompt.

**How it works:**
- Dev copies a ~500 word "Vela bootstrap prompt" into any Claude conversation
- The prompt contains: deck schema, block types, assembly instructions
- They say "make me a presentation about X"
- Claude generates deck JSON + assembles it into an artifact
- They see live slides immediately

**Why this might work:**
- Zero install, zero clone, zero config
- Works in Claude.ai, Claude Code, Cursor, any agent that speaks Claude
- The prompt IS the distribution mechanism (like .cursorrules but for conversations)
- Shareable via gist, tweet, blog post, README
- Devs already share prompts — this fits the culture

**Why this might NOT work:**
- The full SKILL.md is 12K+ tokens — too big for casual copy-paste
- Without the full vela.jsx engine, output is just JSON (no rendering)
- Loses the Vera AI engine, demo mode, all the rich features

**Variant: "The Prompt + URL"**
- Prompt teaches agent to generate deck JSON
- Agent writes .vela file, runs `curl` to fetch vela.jsx from GitHub Pages
- Assembles locally — or just directs user to gallery viewer URL with ?deck= param

---

## HYPOTHESIS 2: "The Excalidraw Model" — Layered Distribution

Excalidraw nailed multi-layer distribution. Each layer reaches a different audience:

| Layer | Excalidraw | Vela Equivalent |
|-------|-----------|-----------------|
| **Zero-install web app** | excalidraw.com | agentiapt.github.io/vela-slides (gallery exists!) |
| **Embeddable npm library** | @excalidraw/excalidraw | @vela-slides/viewer (React component) |
| **MCP server for agents** | excalidraw-mcp | vela-mcp (tools: create_deck, edit_slide, preview) |
| **VS Code extension** | Excalidraw VS Code | Vela VS Code (preview .vela files) |
| **Shareable format** | .excalidraw JSON | .vela JSON |

**The key insight from Excalidraw:**
- The DATA FORMAT is the product, not the app
- The app is just one viewer of the format
- MCP server lets ANY agent produce .excalidraw files
- Multiple surfaces render the same data

**For Vela this means:**
- The .vela format is the product
- Gallery site = zero-install viewer
- MCP server = any agent can CREATE decks
- CLI = power user workflow
- Claude.ai skill = integrated experience
- All surfaces read the same .vela JSON

---

## HYPOTHESIS 3: "MCP Server as Developer On-Ramp"

An MCP server that wraps vela.py CLI commands. Devs add one line to their
MCP config and their coding agent (Claude Code, Cursor, etc.) gains Vela powers.

**Tools the MCP server would expose:**
- `vela_create_deck(topic, style?)` → generates .vela file using agent + schema knowledge
- `vela_preview(deck_path)` → starts serve.py, returns URL
- `vela_ship(deck_path)` → validate + assemble + minify → standalone HTML
- `vela_edit_slide(deck_path, slide_num, instruction)` → natural language edit
- `vela_list_slides(deck_path)` → structured slide overview
- `vela_add_slide(deck_path, position, description)` → insert new slide
- `vela_validate(deck_path)` → quality audit
- `vela_export_pdf(deck_path)` → PDF output

**What makes this AI-native (not JSON editing):**
- The MCP tools take NATURAL LANGUAGE descriptions, not raw JSON
- The server internally knows the schema, design patterns, themes
- Agent says "add a metrics slide showing 3 KPIs" → server generates the blocks
- The human never sees or edits JSON

**Why devs would love this:**
- One config line: `"vela": {"command": "npx @vela-slides/mcp"}`
- Works with Claude Code, Cursor, Windsurf, Cline, any MCP client
- "Make me a presentation" just works from any conversation
- Output is a real HTML file they can open, share, deploy

**Open question:**
- Does the MCP server itself generate deck JSON? Or does it delegate to the LLM?
- If it delegates: it's just a thin CLI wrapper (simpler but less AI-native)
- If it generates: it needs its own LLM call or embedded templates (more complex)

---

## HYPOTHESIS 4: "CLAUDE.md as a Skill Distribution Channel"

What if the quick start for Claude Code users is literally:

```bash
npx @vela-slides/init
```

This command:
1. Copies a CLAUDE.md snippet into the project (or appends to existing)
2. Copies SKILL.md reference into .claude/ or .vela/
3. Copies a starter deck example
4. That's it

Now when the dev opens Claude Code in that project and says "make me a presentation
about our API," Claude reads the CLAUDE.md, knows about Vela, generates the deck.

**Why this is interesting:**
- CLAUDE.md is already how Claude Code learns about projects
- No MCP server needed, no running processes
- The "skill" is just context in a markdown file
- Works TODAY with zero infrastructure
- Similar to how .cursorrules distribute Cursor knowledge

**Variant: community CLAUDE.md registry**
- A repo of CLAUDE.md snippets for different tools
- "Want Vela? Add this snippet to your CLAUDE.md"
- Like awesome-cursorrules but for Claude Code

---

## HYPOTHESIS 5: "Gallery as Playground" (v0.dev Model)

The GitHub Pages gallery already exists. What if it becomes the primary quick start?

**Current state:** Static gallery showing example decks with live previews.

**What if it became:**
- A "playground" where you paste deck JSON and see it rendered live
- A shareable URL: `agentiapt.github.io/vela-slides/?deck=BASE64_ENCODED_JSON`
- A "fork this deck" button that copies JSON to clipboard
- An "Open in Claude" button that pre-fills a Claude.ai conversation

**The flow:**
1. Dev sees a Vela deck shared on Twitter/HN/Reddit (just a URL)
2. Clicks the link → sees live slides in browser (zero install)
3. Clicks "Remix" → gets deck JSON + instructions to modify via any AI agent
4. OR clicks "Open in Claude Code" → opens with context to iterate

**Why this matters:**
- The GALLERY is the virality mechanism (like CodePen, JSFiddle)
- Every deck becomes a shareable artifact with its own URL
- Devs discover Vela by SEEING other people's decks, not by reading docs
- The "aha moment" is seeing a beautiful deck, not installing a tool

**Excalidraw parallel:**
- Excalidraw scenes are shareable via URL
- People discover Excalidraw by clicking links others share
- The tool sells itself through its output

---

## HYPOTHESIS 6: "npx vela" — The Slidev Play

Slidev proved that `npm init slidev` is enough for devs. One command, done.

```bash
npx @vela-slides/create
```

**What this does:**
1. Prompts: "What's your presentation about?" (one line)
2. Prompts: "Style?" (dark/light/vibrant/minimal — or skip for default)
3. Generates a starter .vela deck (using templates, NOT an LLM call)
4. Starts serve.py → opens browser with live preview
5. Prints: "Now open Claude Code and say 'improve my presentation'"

**Why this could work for devs:**
- `npx` means zero global install
- They see a real deck in 10 seconds (template-based, not AI-generated)
- The AI comes AFTER they have something to look at
- Familiar workflow: create → preview → iterate
- The templates ARE the onboarding (show what's possible)

**Why this might not be AI-native enough:**
- Starting from templates is the OLD way (PowerPoint model)
- The whole point of Vela is: describe → AI builds
- A template-based start undermines the core value prop

**Counter-counter:**
- But devs need to SEE what Vela can do before they trust it
- A beautiful template in 10 seconds proves capability
- THEN they iterate with AI (the AI-native part)
- It's the "show, then tell" pattern

---

## HYPOTHESIS 7: "The Schema is the API"

What if the .vela JSON schema is published as a formal spec, and the quick start
is just: "Here's a JSON schema. Any LLM can generate it."

**How:**
- Publish a JSON Schema (.vela.schema.json) on GitHub / npm / schema store
- Any LLM that knows JSON Schema can generate valid decks
- Viewer at gallery URL renders any valid .vela JSON
- No Vela-specific tooling needed to CREATE — only to VIEW

**This is the "HTML model":**
- HTML has a spec. Any tool can generate it. Browsers render it.
- .vela has a spec. Any LLM can generate it. Vela viewer renders it.
- The FORMAT is open. The VIEWER is the product.

**Why devs might love this:**
- No vendor lock-in
- Works with ANY AI (Claude, GPT, Gemini, local models)
- The schema IS the documentation
- IDE support comes free (JSON Schema → autocomplete in VS Code)

---

## HYPOTHESIS 8: "GitHub Action as Distribution"

A GitHub Action that turns .vela files into deployed presentations.

```yaml
- uses: agentiapt/vela-slides-action@v1
  with:
    deck: slides/quarterly-review.vela
    deploy: github-pages
```

**What this enables:**
- Devs commit .vela files to their repo
- CI builds them into HTML presentations
- Auto-deploys to GitHub Pages
- Every push = updated presentation

**Why this is interesting for dev teams:**
- Presentations live next to code (version controlled)
- Review presentations in PRs (diff the JSON)
- CI validates deck quality (validate.py)
- Deploy is automatic (no manual export step)
- Fits the "docs-as-code" / "slides-as-code" movement

---

## HYPOTHESIS 9: "Claude Code Extension / Custom Slash Command"

What if the quick start is a Claude Code custom slash command?

```
/vela "Create a pitch deck for our developer tool"
```

**How it works:**
- User installs a Claude Code extension or adds a hook
- `/vela` triggers the full Vela workflow: generate → assemble → preview
- Output: HTML file + browser opens automatically
- Iteration: `/vela edit slide 3 "add more metrics"`

**This is the most frictionless path for Claude Code users:**
- One command, one concept
- No understanding of .vela format needed
- AI handles everything
- The slash command IS the product interface

---

## HYPOTHESIS 10: "Vela as an LLM Output Format" (like Mermaid)

Mermaid diagrams became ubiquitous because:
1. Simple text syntax that any LLM can generate
2. Renderers everywhere (GitHub, Notion, VS Code, every markdown tool)
3. You don't "install" Mermaid — you just write it and it appears

**What if .vela becomes the "Mermaid for presentations"?**
- LLMs already know how to generate structured JSON
- A lightweight renderer (web component? iframe embed?) renders .vela anywhere
- GitHub renders .vela files in-repo (via GitHub Action or bot)
- Notion, Obsidian, VS Code extensions render .vela inline

**The distribution is the RENDERER, not the generator.**
- Any LLM generates .vela (the schema is simple enough)
- Renderers proliferate across platforms
- Vela becomes a FORMAT standard, not just a tool

**This is the most ambitious hypothesis:**
- Requires ecosystem adoption (renderers in multiple platforms)
- But if it works, it's the most powerful distribution model
- Mermaid didn't need a startup — it became a standard through ubiquity

---

## HYPOTHESIS 11: "The Starter Deck as Teaching Tool"

What if the quick start IS a Vela deck? A self-referential presentation that:
1. Shows what Vela can do (it IS a Vela deck)
2. Teaches the schema through its own structure
3. Has a "View Source" for each slide (showing the JSON that made it)
4. Ends with "Now ask your AI to modify this deck"

**The flow:**
1. Dev opens gallery URL → sees "Getting Started with Vela" deck
2. Browses through 10 slides showing all block types in action
3. Each slide has a "View JSON" toggle showing the underlying structure
4. Final slide: "Copy this deck. Open your agent. Say 'change the topic to X'"
5. They paste the .vela JSON, agent modifies it, they see the result

**Why this is elegant:**
- The demo IS the documentation IS the quick start
- Self-hosting: Vela teaches itself using itself
- Devs learn by seeing + doing, not by reading docs
- The "source view" satisfies dev curiosity (they want to see the code)

---

## HYPOTHESIS 12: "Dev.to / HN / Twitter Launch as Quick Start"

What if the quick start isn't a technical artifact at all, but a compelling
DEMO + WRITEUP that goes viral?

**"I Built a Presentation Engine That Runs Inside AI Conversations"**
- Post on HN/dev.to/Twitter with:
  - 30-second GIF showing: prompt → complete deck → live slides
  - Link to gallery (zero-install viewing)
  - Link to repo (for those who want to dig in)
  - "Try it: paste this into Claude Code" (the prompt)

**The quick start is the STORY, not the tool.**
- Devs adopt tools they've seen in action
- A viral demo > any amount of documentation
- The gallery URL is the call-to-action (zero friction)
- Power users find the repo from the demo

---

## HYPOTHESIS 13: "Hybrid — Gallery + MCP + CLI"

Maybe it's not one thing. Maybe the quick start is THREE paths, each for a 
different persona:

### Path A: "I just want to see it" (Curious Dev)
→ Gallery URL. Click. Browse decks. Fork one. 30 seconds.

### Path B: "I want my agent to make decks" (AI-Native Dev)  
→ MCP server OR CLAUDE.md snippet. One config. "Make me a deck." 2 minutes.

### Path C: "I want to build with it" (Power Dev)
→ Clone repo. `vela server start`. Full CLI. Programmatic control. 5 minutes.

**Each path has a different "aha moment":**
- A: "Wow, these slides look amazing and they're just JSON"
- B: "Holy shit, my agent just made a complete presentation from one sentence"
- C: "I can script this, version control it, CI/CD it, automate it"

**The quick start PAGE routes people to the right path:**
"What do you want to do?"
→ See examples → Gallery
→ Create with AI → MCP / Agent setup  
→ Build & customize → Clone & CLI

---

## HYPOTHESIS 14: "Web Component / iframe Embed"

A `<vela-slides>` web component that renders a deck from a URL or inline JSON.

```html
<script src="https://agentiapt.github.io/vela-slides/embed.js"></script>
<vela-slides src="https://example.com/my-deck.vela"></vela-slides>
```

**Why:**
- Embeddable ANYWHERE (blogs, docs, READMEs, Notion via iframe)
- Every embedded deck is a distribution vector
- Devs can put slides in their project READMEs
- Conference talk slides live on the speaker's blog
- Zero backend — loads from any URL

---

## HYPOTHESIS 15: "The Anti-Quick-Start — Quality Over Speed"

What if the quick start ISN'T about speed at all?

Every other tool competes on "seconds to first value." What if Vela competes
on QUALITY of output?

**The pitch:** "Other tools give you slides in 10 seconds. Vela gives you
slides worth presenting in 2 minutes."

**The quick start becomes a SHOWCASE:**
- Not "how fast can you start" but "look what Vela produces"
- Gallery of stunning real-world decks (open source conference talks, company all-hands)
- Side-by-side: "Same prompt in Gamma vs. Vela"
- The quick start is: "Be amazed. Then try it."

**For devs specifically:** The quality pitch resonates because devs HATE ugly slides.
They want something that looks good WITHOUT design skills. If Vela's output is
visibly better than alternatives, the quick start writes itself.

---

## REFLECTIONS / META-OBSERVATIONS

1. **Vela already HAS most of the pieces** — gallery, CLI, serve.py, SKILL.md,
   examples. The gap is packaging + routing users to the right entry point.

2. **The AI-native angle is unique.** No other presentation tool is built for
   agent-driven creation. This is the wedge. Don't dilute it with JSON editing.

3. **The .vela format is an underappreciated asset.** It's simple, portable, 
   three-format (full/compact/turbo). If it becomes a standard, everything follows.

4. **The gallery is the sleeper hit.** It exists, it's visual, it's zero-install.
   But it's positioned as a "gallery" not a "playground." Reframing matters.

5. **MCP is the dev distribution channel of 2026.** Every coding agent supports it.
   A Vela MCP server meets devs in their editor. But it needs to be AI-native
   (take natural language, not JSON) to be truly differentiated.

6. **The Excalidraw model is the most complete reference.** Web app + npm lib + 
   MCP server + VS Code extension + open format. Not all are needed at once,
   but the LAYERED approach is the playbook.

7. **Don't choose one path — build the routing.** The quick start should DETECT
   the user's context and route them. In Claude Code? Use CLAUDE.md. In browser?
   Gallery. Want to embed? Web component. Want CI? GitHub Action.

---

## ROUND 4: WILD IDEAS (unfiltered)

### H16: "Vela as a Protocol, Not a Product"
What if .vela is an open presentation protocol with a reference implementation?
Like ActivityPub is a protocol and Mastodon is an implementation.
Multiple viewers, multiple generators, one format.
Submit to a standards body? Too far? Maybe. Saving it.

### H17: "LLM-Optimized Schema on npm"
Publish JUST the schema + examples as an npm/pip package.
`npm install @vela-slides/schema`
Contains: JSON Schema, TypeScript types, 10 example decks, design pattern docs.
No viewer, no CLI — just the knowledge an LLM needs to generate valid decks.
The viewer is separate (gallery URL, or full install).

### H18: "One-Click from GitHub README"
A badge in the README: `[![Open in Vela](badge.svg)](url)`
Clicking it opens the gallery viewer with the starter deck loaded.
Like "Open in Colab" or "Run on Replit" badges.
Zero-click discovery: anyone browsing the repo sees it.

### H19: "AI Conference Talk Template"
Partner with tech conferences. Offer: "Submit your talk with Vela."
Conference speakers are devs. They need slides. They hate making slides.
"Write your talk abstract. Vela generates your slides."
The conference becomes the distribution channel.

### H20: "Reverse: Extract from PowerPoint"
`vela deck import presentation.pptx`
Takes an existing PPTX and converts it to .vela format.
Now devs can MIGRATE existing decks, not start from scratch.
The quick start becomes: "Bring your existing deck. Make it AI-editable."

### H21: "WASM Viewer"
Compile the Vela renderer to a WASM module.
Embed it anywhere — not just React contexts.
A universal .vela viewer that runs in any web context.

### H22: "Vela Bot for GitHub PRs"
A GitHub bot that, when you push a .vela file, posts a comment with
a rendered preview image (screenshot of first slide).
Like how Vercel bot posts preview deploy URLs on PRs.
Makes .vela files visible in the dev workflow.

### H23: "Terminal Presenter Mode"
`vela present deck.vela` — renders slides in the terminal using ASCII art / 
rich text (like `rich` in Python or `slides` in Go).
Devs live in terminals. Meet them there.
See: https://github.com/maaslalani/slides (Go terminal presenter)

### H24: "Obsidian / Notion Plugin"
An Obsidian plugin that renders .vela codeblocks inline.
Devs who use Obsidian for notes can embed presentations in their vault.
```vela
{"deckTitle": "...", "lanes": [...]}
```
Renders as interactive slides inside their note.

### H25: "The 'Hello World' Deck"
What if there's a canonical 3-slide "Hello World" deck that every tutorial uses?
Like `console.log("hello world")` but for presentations.
Slide 1: Title. Slide 2: One point. Slide 3: Thank you.
Small enough to fit in a tweet. Shows the minimal .vela structure.
Every onboarding path starts here.

### H26: "QR Code Sharing"
Every deck rendered in the gallery gets a QR code.
Present from your laptop → audience scans QR → views on their phone.
Built-in distribution for every presentation.

### H27: "Vela Playground in Claude Code Web"
Claude Code on the web (claude.ai/code) supports artifacts.
What if there's a pre-configured Claude Code web session with Vela loaded?
A URL that drops you into Claude Code with CLAUDE.md already set up.
"Open this link. Say 'make me a presentation.' Done."

### H28: "Deck as Gist"
`vela deck share deck.vela` → creates a GitHub Gist → returns a gallery URL
Like Excalidraw sharing: the data IS the URL.
Share presentations via gist links.
Gallery viewer loads from gist API.

### H29: "Progressive Disclosure Quick Start"
A single-page quick start that reveals complexity progressively:
- Level 0: See a deck (click gallery link)
- Level 1: Remix a deck (fork + modify via AI)
- Level 2: Create from scratch (prompt your agent)
- Level 3: Customize (themes, design patterns, custom blocks)
- Level 4: Automate (CI/CD, programmatic, MCP)
Each level links to the next. User self-selects depth.

### H30: "The Rosetta Stone Deck"
A single .vela file that demonstrates ALL 21 block types.
Each slide uses a different block type with a label explaining it.
The ultimate reference deck. Both documentation and demo.
(The vela-demo.vela at 2134 lines might already be close to this.)

---

## TIMING LOG

- 19:53:55 — Research start
- 19:56:18 — Round 1 complete (parallel agents: SKILL.md, CLI, web research, app code)
- 19:59:30 — Round 2 research in (Excalidraw, presentation landscape, gallery site)
- 20:01:00 — Round 3 synthesis start (hypotheses 1-15 + reflections)
- 20:06:23 — Round 3 complete (460 lines)
- 20:08:xx — Round 4 complete (wild ideas H16-H30)

Total research time: ~14 minutes. 15 hypotheses + 15 wild ideas = 30 raw ideas saved.
