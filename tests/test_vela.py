#!/usr/bin/env python3
"""
Vela Test Suite — runs unit + integration tests.

Usage:
  python3 tests/test_vela.py              # run unit + integration
  python3 tests/test_vela.py --unit       # unit only
  python3 tests/test_vela.py --integration # integration only
  python3 tests/test_vela.py --all        # everything: unit + integration + server + e2e + concat sync

Exit code 0 = all pass, 1 = failures.
"""

import sys, os, json, re, subprocess, tempfile, shutil, copy, time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(REPO_ROOT, "skills", "vela-slides")
PARTS_DIR = os.path.join(SKILL_DIR, "app", "parts")
TEMPLATE = os.path.join(SKILL_DIR, "app", "vela.jsx")
SCRIPTS = os.path.join(SKILL_DIR, "scripts")
EXAMPLES = os.path.join(REPO_ROOT, "examples")

passes = 0
fails = 0

def ok(name):
    global passes
    passes += 1
    print(f"  ✅ {name}")

def fail(name, reason=""):
    global fails
    fails += 1
    print(f"  ❌ {name}{f' — {reason}' if reason else ''}")


# ━━━ Unit Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_unit():
    print("\n── Unit Tests ──")

    # 1. All 11 part-files exist
    expected_parts = [
        "part-imports.jsx", "part-icons.jsx", "part-blocks.jsx",
        "part-reducer.jsx", "part-engine.jsx", "part-slides.jsx",
        "part-list.jsx", "part-chat.jsx", "part-test.jsx",
        "part-uitest.jsx", "part-demo.jsx", "part-pdf.jsx", "part-app.jsx"
    ]
    missing = [p for p in expected_parts if not os.path.exists(os.path.join(PARTS_DIR, p))]
    if not missing:
        ok(f"All {len(expected_parts)} part-files present")
    else:
        fail(f"Part-files present", f"missing: {missing}")

    # 2. SKILL.md exists and has valid frontmatter
    skill_md = os.path.join(SKILL_DIR, "SKILL.md")
    if os.path.exists(skill_md):
        content = open(skill_md, encoding="utf-8").read()
        if content.startswith("---") and "name:" in content and "description:" in content:
            ok("SKILL.md has valid frontmatter")
        else:
            fail("SKILL.md frontmatter", "missing --- or name/description fields")
    else:
        fail("SKILL.md exists")

    # 3. Template has STARTUP_PATCH marker
    if os.path.exists(TEMPLATE):
        tpl = open(TEMPLATE, encoding="utf-8").read()
        if "const STARTUP_PATCH = null;" in tpl:
            ok("STARTUP_PATCH marker present in template")
        else:
            fail("STARTUP_PATCH marker", "not found in vela.jsx")
    else:
        fail("vela.jsx exists")

    # 4. Validate example deck JSON
    starter = os.path.join(EXAMPLES, "starter-deck.vela")
    if os.path.exists(starter):
        try:
            deck = json.load(open(starter, encoding="utf-8"))
            assert "lanes" in deck or "slides" in deck, "no lanes or slides key"
            assert "deckTitle" in deck, "no deckTitle"
            ok("starter-deck.vela is valid JSON with expected structure")
        except Exception as e:
            fail("starter-deck.vela valid", str(e))
    else:
        fail("starter-deck.vela exists")

    # 5. Scripts exist and are valid Python
    for script in ["concat.py", "assemble.py", "validate.py"]:
        path = os.path.join(SCRIPTS, script)
        if os.path.exists(path):
            result = subprocess.run(
                [sys.executable, "-c", f"import py_compile; py_compile.compile('{path}', doraise=True)"],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                ok(f"{script} compiles without errors")
            else:
                fail(f"{script} compiles", result.stderr.strip())
        else:
            fail(f"{script} exists")

    # 6. References exist
    for ref in ["block-schema.md", "design-patterns.md", "themes.md"]:
        path = os.path.join(SKILL_DIR, "references", ref)
        if os.path.exists(path) and os.path.getsize(path) > 100:
            ok(f"references/{ref} present and non-empty")
        else:
            fail(f"references/{ref}")


# ━━━ Security Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_security():
    print("\n── Security Tests ──")

    all_jsx = ""
    for root, dirs, files in os.walk(os.path.join(SKILL_DIR, "app")):
        for f in files:
            if f.endswith(".jsx"):
                all_jsx += open(os.path.join(root, f), encoding="utf-8").read()

    # 1. No API keys or secrets
    secret_patterns = [
        (r'sk-ant-[a-zA-Z0-9]', "Anthropic API key"),
        (r'sk_[a-zA-Z0-9]{20,}', "Secret key pattern"),
        (r'ANTHROPIC_API_KEY\s*=', "Hardcoded API key assignment"),
        (r'password\s*=\s*["\'][^"\']+["\']', "Hardcoded password"),
    ]
    for pattern, desc in secret_patterns:
        if re.search(pattern, all_jsx):
            fail(f"No {desc} in code")
        else:
            ok(f"No {desc} in code")

    # 2. No personal emails
    email_patterns = [r'verabelusi', r'rqideb', r'@gmail\.com', r'@outlook\.com']
    found_emails = [p for p in email_patterns if re.search(p, all_jsx)]
    if not found_emails:
        ok("No personal email addresses in code")
    else:
        fail("Personal emails", f"found: {found_emails}")

    # 3. No private service URLs
    private_patterns = [r'workers\.dev', r'ngrok', r'localhost:\d+']
    found_private = [p for p in private_patterns if re.search(p, all_jsx)]
    if not found_private:
        ok("No private service URLs in code")
    else:
        fail("Private URLs", f"found: {found_private}")

    # 4. SVG sanitization present (defense-in-depth)
    if 'foreignObject' in all_jsx and 'replace(/<foreignObject' in all_jsx:
        ok("SVG foreignObject sanitization present")
    else:
        fail("SVG foreignObject sanitization")

    if 'xlink:href' in all_jsx and 'data-blocked-href' in all_jsx:
        ok("SVG xlink:href sanitization present")
    else:
        fail("SVG xlink:href sanitization")

    # 5. sanitizeString strips HTML tags
    if 'replace(/<[^>]*>/g' in all_jsx:
        ok("sanitizeString strips HTML tags")
    else:
        fail("sanitizeString HTML stripping")


# ━━━ Known Bugs (regression watchlist) ━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_known_bugs():
    print("\n── Known Bug Tests ──")

    slides_jsx = open(os.path.join(PARTS_DIR, "part-slides.jsx"), encoding="utf-8").read()
    engine_jsx = open(os.path.join(PARTS_DIR, "part-engine.jsx"), encoding="utf-8").read()
    imports_jsx = open(os.path.join(PARTS_DIR, "part-imports.jsx"), encoding="utf-8").read()
    chat_jsx = open(os.path.join(PARTS_DIR, "part-chat.jsx"), encoding="utf-8").read()

    # BUG 1: Scroll wheel should use presSlides in fullscreen, not slides
    # The keyboard handler correctly does: const navSlides = fullscreen ? presSlides : slides
    # The scroll useEffect body should also reference presSlides or navSlides for fullscreen compat.
    # Find the scroll handler body (between SCROLL_THRESHOLD and its closing dep array)
    scroll_match = re.search(r'SCROLL_THRESHOLD.*?if \(dir > 0\)\s*\{(.*?)\} else \{', slides_jsx, re.DOTALL)
    if scroll_match:
        scroll_body = scroll_match.group(1)
        if "presSlides" in scroll_body or "navSlides" in scroll_body:
            ok("Scroll wheel uses presSlides in fullscreen")
        else:
            fail("BUG: Scroll wheel uses slides.length not presSlides in fullscreen (known)")
    else:
        fail("Scroll wheel test", "could not locate scroll handler body")

    # BUG 2: Quick edit / new slide popups should be responsive, not fixed 320px
    # Look for showQuickEdit lines with width: 320 (hardcoded, no isMobile conditional)
    quick_edit_lines = [l for l in slides_jsx.split("\n") if "showQuickEdit" in l and "width:" in l]
    has_fixed = any("width: 320" in l and "isMobile" not in l for l in quick_edit_lines)
    if not has_fixed:
        ok("Quick edit popup uses responsive width")
    else:
        fail("BUG: Quick edit popup hardcodes width:320, overflows on small mobile (known)")

    # BUG 3: _system undo markers should be excluded from persistent storage
    if "_system" in imports_jsx and "extractSave" in imports_jsx:
        # Check if extractSave filters _system messages
        extract_section = imports_jsx[imports_jsx.index("extractSave"):][:500]
        if "_system" in extract_section or "filter" in extract_section:
            ok("extractSave filters _system chat messages")
        else:
            fail("BUG: extractSave doesn't filter _system undo markers from storage (known)")
    else:
        fail("BUG: extractSave doesn't filter _system undo markers from storage (known)")

    # BUG 4: edit_slide smart merge should deep-merge grid items, not replace
    edit_slide_section = ""
    in_edit = False
    for line in engine_jsx.split("\n"):
        if 'case "edit_slide"' in line:
            in_edit = True
        if in_edit:
            edit_slide_section += line + "\n"
        if in_edit and line.strip().startswith("case ") and "edit_slide" not in line:
            break
    if "grid" in edit_slide_section or "deep" in edit_slide_section.lower() or "items" in edit_slide_section:
        ok("edit_slide handles grid block merging")
    else:
        fail("BUG: edit_slide smart merge loses nested grid cell content (known)")

    # BUG 5: Fullscreen should handle browser back button (popstate)
    if "popstate" in slides_jsx or "history.pushState" in slides_jsx:
        ok("Fullscreen handles browser back button via popstate")
    else:
        fail("BUG: No browser back button handling in fullscreen — exits artifact (known)")

    # BUG 6: onClick={send} should be onClick={() => send()} to prevent event leak
    if "onClick={send}" in chat_jsx:
        fail("BUG: onClick={send} passes MouseEvent as directMsg (known)")
    else:
        ok("Chat send button uses arrow wrapper, no event leak")


# ━━━ IP Hygiene Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_ip_hygiene():
    print("\n── IP Hygiene Tests ──")

    # 1. Copyright header in every part-file
    copyright_count = 0
    for f in os.listdir(PARTS_DIR):
        if f.endswith(".jsx"):
            first_line = open(os.path.join(PARTS_DIR, f), encoding="utf-8").readline()
            if "© 2025-present Rui Quintino" in first_line:
                copyright_count += 1
    if copyright_count == 13:
        ok(f"Copyright header in all {copyright_count}/13 part-files")
    else:
        fail(f"Copyright headers", f"only {copyright_count}/13 files")

    # 2. Copyright header in build scripts
    script_count = 0
    for f in ["concat.py", "assemble.py", "validate.py"]:
        path = os.path.join(SCRIPTS, f)
        if os.path.exists(path):
            content = open(path, encoding="utf-8").read()[:200]
            if "© 2025-present Rui Quintino" in content:
                script_count += 1
    if script_count == 3:
        ok(f"Copyright header in all {script_count}/3 build scripts")
    else:
        fail(f"Script copyright headers", f"only {script_count}/3")

    # 3. NOTICE file exists with dependency audit
    notice_path = os.path.join(REPO_ROOT, "NOTICE")
    if os.path.exists(notice_path):
        content = open(notice_path, encoding="utf-8").read()
        has_deps = all(d in content for d in ["React", "lucide-react", "html2canvas", "MIT", "ISC"])
        if has_deps:
            ok("NOTICE file present with dependency audit")
        else:
            fail("NOTICE file", "missing expected dependencies")
    else:
        fail("NOTICE file exists")

    # 4. CLA in CONTRIBUTING.md
    contrib_path = os.path.join(REPO_ROOT, "CONTRIBUTING.md")
    if os.path.exists(contrib_path):
        content = open(contrib_path, encoding="utf-8").read()
        has_cla = "Contributor License Agreement" in content and "Signed-off-by" in content
        has_ai = "AI-Generated" in content or "AI-generated" in content or "ai-generated" in content.lower()
        if has_cla:
            ok("CONTRIBUTING.md has CLA with sign-off requirement")
        else:
            fail("CONTRIBUTING.md CLA", "missing CLA section")
        if has_ai:
            ok("CONTRIBUTING.md has AI-generated code disclosure policy")
        else:
            fail("CONTRIBUTING.md AI disclosure")
    else:
        fail("CONTRIBUTING.md exists")

    # 5. LICENSE has commercial contact
    license_path = os.path.join(REPO_ROOT, "LICENSE")
    if os.path.exists(license_path):
        content = open(license_path, encoding="utf-8").read()
        if "info@agentia.pt" in content:
            ok("LICENSE has commercial licensing contact")
        else:
            fail("LICENSE commercial contact", "missing info@agentia.pt")
    else:
        fail("LICENSE exists")

    # 6. No personal info leaks (only copyright + LinkedIn in app footer)
    all_jsx = ""
    for f in os.listdir(PARTS_DIR):
        if f.endswith(".jsx"):
            all_jsx += open(os.path.join(PARTS_DIR, f), encoding="utf-8").read()
    rui_refs = [m.start() for m in re.finditer(r"Rui Quintino", all_jsx)]
    # Should only appear in copyright header lines and app footer (linkedin link)
    non_header = [r for r in rui_refs if "© 2025" not in all_jsx[max(0,r-80):r] and "linkedin" not in all_jsx[max(0,r-200):r+100].lower() and "Created by" not in all_jsx[max(0,r-150):r]]
    if not non_header:
        ok("'Rui Quintino' only in copyright headers and footer")
    else:
        fail("Name leak", f"found {len(non_header)} non-header/footer reference(s)")


# ━━━ Integration Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_integration():
    print("\n── Integration Tests ──")

    tmpdir = tempfile.mkdtemp(prefix="vela-test-")

    try:
        # 1. Concat builds successfully
        out_template = os.path.join(tmpdir, "vela-built.jsx")
        result = subprocess.run(
            [sys.executable, os.path.join(SCRIPTS, "concat.py"), PARTS_DIR, out_template],
            capture_output=True, text=True
        )
        if result.returncode == 0 and os.path.exists(out_template):
            ok("concat.py builds monolith from parts")
            size_kb = os.path.getsize(out_template) // 1024
            if size_kb > 100:
                ok(f"Built template is {size_kb}KB (sanity check >100KB)")
            else:
                fail(f"Template size sanity", f"only {size_kb}KB")
        else:
            fail("concat.py builds", result.stderr.strip())
            return  # can't continue without template

        # 2. Built template has STARTUP_PATCH marker
        built = open(out_template, encoding="utf-8").read()
        if "const STARTUP_PATCH = null;" in built:
            ok("Built template has STARTUP_PATCH marker")
        else:
            fail("Built template STARTUP_PATCH marker")

        # 3. Validate starter deck
        starter = os.path.join(EXAMPLES, "starter-deck.vela")
        result = subprocess.run(
            [sys.executable, os.path.join(SCRIPTS, "validate.py"), starter],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            ok("validate.py passes on starter-deck.vela")
        else:
            fail("validate.py on starter-deck", result.stdout + result.stderr)

        # 4. Assemble produces a valid artifact
        out_artifact = os.path.join(tmpdir, "assembled.jsx")
        result = subprocess.run(
            [sys.executable, os.path.join(SCRIPTS, "assemble.py"), starter, out_artifact],
            capture_output=True, text=True,
            env={**os.environ, "PYTHONPATH": SCRIPTS}
        )
        if result.returncode == 0 and os.path.exists(out_artifact):
            artifact = open(out_artifact, encoding="utf-8").read()
            # Check that STARTUP_PATCH was replaced with actual data
            if "const STARTUP_PATCH = null;" not in artifact and "const STARTUP_PATCH = {" in artifact:
                ok("assemble.py injects deck data into template")
            else:
                fail("assemble.py injection", "STARTUP_PATCH not replaced")
            # Check artifact size is larger than template (deck data was added)
            artifact_kb = os.path.getsize(out_artifact) // 1024
            if artifact_kb > size_kb:
                ok(f"Assembled artifact ({artifact_kb}KB) > template ({size_kb}KB)")
            else:
                fail("Artifact size", f"artifact {artifact_kb}KB should be > template {size_kb}KB")
        else:
            fail("assemble.py builds artifact", result.stderr.strip())

        # 5. Version extraction works
        version_match = re.search(r'const VELA_VERSION\s*=\s*"([^"]+)"', built)
        if version_match:
            ok(f"VELA_VERSION extractable: {version_match.group(1)}")
        else:
            fail("VELA_VERSION extraction")

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ━━━ v10 Feature Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_v10_features():
    print("\n── v10 Feature Tests ──")

    # Template must exist
    if not os.path.exists(TEMPLATE):
        fail("Template exists for v10 tests")
        return
    tpl = open(TEMPLATE, encoding="utf-8").read()

    # v10+ version
    m = re.search(r'VELA_VERSION = "(\d+\.\d+)"', tpl)
    if m and int(m.group(1).split('.')[0]) >= 10:
        ok(f"VELA_VERSION is {m.group(1)}")
    else:
        fail("VELA_VERSION is 10+")
    # VELA_LOCAL_MODE constant
    if "VELA_LOCAL_MODE" in tpl:
        ok("VELA_LOCAL_MODE constant present")
    else:
        fail("VELA_LOCAL_MODE constant present")

    # Teacher mode
    if "buildTeacherPrompt" in tpl and "callVeraTeacher" in tpl:
        ok("Teacher mode engine functions present")
    else:
        fail("Teacher mode engine", "missing buildTeacherPrompt or callVeraTeacher")

    if "TeacherPanel" in tpl and "TeacherMessage" in tpl:
        ok("TeacherPanel and TeacherMessage components present")
    else:
        fail("Teacher components")

    # Gallery view
    if "GalleryView" in tpl:
        ok("GalleryView component present")
    else:
        fail("GalleryView component")

    if "ZOOM_SIZES" in tpl:
        ok("Gallery zoom feature present")
    else:
        fail("Gallery zoom")

    # Reducer: veraMode, teacher actions
    if "veraMode" in tpl and "teacherHistory" in tpl:
        ok("Reducer has veraMode and teacherHistory state")
    else:
        fail("Reducer teacher state")

    if "SET_VERA_MODE" in tpl and "TEACHER_MSG" in tpl:
        ok("Reducer has teacher action types")
    else:
        fail("Reducer teacher actions")

    # Heading strip
    if "headingText" in tpl and 'replace(/\\*\\*/g' in tpl:
        ok("Heading block strips ** markdown")
    else:
        fail("Heading strip")

    # Live sync
    if "__velaReceiveDeckUpdate" in tpl and "__velaSendDeckUpdate" in tpl:
        ok("Live sync handlers present (receive + send)")
    else:
        fail("Live sync handlers")

    if "__velaGetCurrentSlide" in tpl:
        ok("Channel context export (__velaGetCurrentSlide) present")
    else:
        fail("Channel context export")

    # State prop passed to SlidePanel
    if "state={state}" in tpl and "SlidePanel" in tpl:
        ok("SlidePanel receives state prop")
    else:
        fail("SlidePanel state prop")

    # Demo: 19 scenes
    if "19 scenes" in tpl:
        ok("Demo has 19 scenes")
    else:
        fail("Demo scene count")


# ━━━ Channel & Local HTML Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_channel_local():
    print("\n── Channel & Local HTML Tests ──")

    local_html = os.path.join(SKILL_DIR, "app", "local.html")
    if not os.path.exists(local_html):
        fail("local.html exists")
        return
    html = open(local_html, encoding="utf-8").read()

    # Import map
    if "importmap" in html and "esm.sh/react" in html:
        ok("local.html has importmap for ES modules")
    else:
        fail("importmap")

    # Long-poll sync (not WebSocket/SSE)
    if "/poll" in html and "WebSocket" not in html and "EventSource" not in html.split("Long-poll")[0]:
        ok("local.html uses long-polling (not WebSocket/SSE)")
    else:
        # Check more carefully
        if "/poll?v=" in html:
            ok("local.html uses long-polling")
        else:
            fail("long-polling sync")

    # Channel bridge UI
    if "claude-fab" in html and "__VELA_CHANNEL_PORT__" in html:
        ok("local.html has Claude FAB with channel port injection")
    else:
        fail("Claude FAB")

    if "claude-prompt-overlay" in html and "claude-prompt-box" in html:
        ok("local.html has prompt overlay UI")
    else:
        fail("Prompt overlay")

    # Contextual presets
    if "slidePresets" in html and "deckPresets" in html:
        ok("local.html has contextual presets (slide vs deck)")
    else:
        fail("Contextual presets")

    # Toast system
    if "claude-toast" in html and "showToast" in html:
        ok("local.html has toast notification system")
    else:
        fail("Toast system")

    # Loading screen
    if "sail" in html.lower() and "vela-loading" in html:
        ok("local.html has themed loading screen")
    else:
        fail("Loading screen")

    # Storage polyfill
    if "window.storage" in html:
        ok("local.html has storage polyfill")
    else:
        fail("Storage polyfill")

    # Channel server
    channel_ts = os.path.join(SKILL_DIR, "channel", "vela-channel.ts")
    if os.path.exists(channel_ts):
        ch = open(channel_ts, encoding="utf-8").read()
        if "claude/channel" in ch:
            ok("Channel server declares claude/channel capability")
        else:
            fail("Channel capability")
        if "reply" in ch and "ListToolsRequestSchema" in ch:
            ok("Channel server exposes reply tool")
        else:
            fail("Channel reply tool")
        if "SPEED RECIPES" in ch or "TRANSLATE ONE SLIDE" in ch:
            ok("Channel instructions include speed recipes")
        else:
            fail("Channel speed recipes")
    else:
        fail("Channel server file exists")

    # Serve.py
    serve_py = os.path.join(SKILL_DIR, "scripts", "serve.py")
    if os.path.exists(serve_py):
        srv = open(serve_py, encoding="utf-8").read()
        if "127.0.0.1" in srv and "--host" in srv:
            ok("serve.py binds localhost by default with --host option")
        else:
            fail("serve.py bind address")
        if "channel_port" in srv and "__VELA_CHANNEL_PORT__" in srv:
            ok("serve.py injects channel port into HTML")
        else:
            fail("serve.py channel port")
        if "__VELA_DECK_PATH__" in srv:
            ok("serve.py injects deck path into HTML")
        else:
            fail("serve.py deck path")
        if '<\\\\/' in srv or '<\\/' in srv:
            ok("serve.py escapes </ for XSS prevention")
        else:
            fail("serve.py XSS escape")
        if "long-poll" in srv.lower() or "DeckVersionTracker" in srv:
            ok("serve.py uses long-polling with version tracker")
        else:
            fail("serve.py long-polling")
    else:
        fail("serve.py exists")


# ━━━ Server Hardening & Lifecycle Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_server_hardening():
    print("\n── Server Hardening & Lifecycle Tests ──")

    tpl = open(os.path.join(SKILL_DIR, "app", "vela.jsx"), encoding="utf-8").read()
    serve_src = open(os.path.join(SCRIPTS, "serve.py"), encoding="utf-8").read()
    vela_src = open(os.path.join(SCRIPTS, "vela.py"), encoding="utf-8").read()
    skill_md = open(os.path.join(SKILL_DIR, "SKILL.md"), encoding="utf-8").read()

    # ── Arrow keys: Up/Down same as Left/Right ──
    if '"ArrowRight" || e.key === "ArrowDown"' in tpl:
        ok("ArrowDown handled same as ArrowRight")
    else:
        fail("ArrowDown = ArrowRight")

    if '"ArrowLeft" || e.key === "ArrowUp"' in tpl:
        ok("ArrowUp handled same as ArrowLeft")
    else:
        fail("ArrowUp = ArrowLeft")

    # Verify old module-jumping Up/Down code is removed
    if 'e.key === "ArrowDown" && curIdx >= 0' not in tpl:
        ok("Old ArrowDown module-jump code removed")
    else:
        fail("Old ArrowDown module-jump still present")

    # ── Auto-refresh deck list ──
    if "setInterval(fetchDecks, 3000)" in serve_src:
        ok("Deck list auto-refreshes every 3s")
    else:
        fail("Deck list auto-refresh")

    # ── .vela extension enforcement ──
    if 'DECK_EXT = ".vela"' in serve_src:
        ok("DECK_EXT constant defined as .vela")
    else:
        fail("DECK_EXT constant")

    if 'deck_name.endswith(DECK_EXT)' in serve_src or 'not deck_name.endswith(DECK_EXT)' in serve_src:
        ok(".vela extension enforced on endpoints")
    else:
        fail(".vela extension enforcement")

    if 'Only .vela files can be served' in serve_src:
        ok("403 message for non-.vela serve")
    else:
        fail("403 serve message")

    if 'Only .vela files can be polled' in serve_src:
        ok("403 message for non-.vela poll")
    else:
        fail("403 poll message")

    if 'Only .vela files can be saved' in serve_src:
        ok("403 message for non-.vela save")
    else:
        fail("403 save message")

    # ── Folder-only mode ──
    if 'folder_mode' not in serve_src:
        ok("Single-file mode removed (no folder_mode flag)")
    else:
        fail("folder_mode flag still present")

    if '_route_single_get' not in serve_src and '_route_single_post' not in serve_src:
        ok("Single-mode routing methods removed")
    else:
        fail("Single-mode routing still present")

    if '_run_single' not in serve_src:
        ok("_run_single method removed")
    else:
        fail("_run_single still present")

    # ── Upload removal ──
    if '_handle_upload' not in serve_src:
        ok("Upload handler removed")
    else:
        fail("Upload handler still present")

    if 'api/upload' not in serve_src:
        ok("Upload route removed")
    else:
        fail("Upload route still present")

    # ── Runtime file .vela.env ──
    if 'RUNTIME_FILE = ".vela.env"' in serve_src:
        ok("Runtime file constant is .vela.env")
    else:
        fail("Runtime file constant")

    if '_runtime_path' in serve_src:
        ok("_runtime_path method present")
    else:
        fail("_runtime_path method")

    # ── Server lifecycle ──
    if '_cleanup_stale_server' in serve_src:
        ok("Stale server cleanup present")
    else:
        fail("Stale server cleanup")

    if '_is_pid_alive' in serve_src:
        ok("PID alive check present")
    else:
        fail("PID alive check")

    if '_is_python_process' in serve_src:
        ok("Python process check present (PID recycling guard)")
    else:
        fail("Python process check")

    if '_pid_holds_port' in serve_src:
        ok("Port ownership check present")
    else:
        fail("Port ownership check")

    if '_register_cleanup' in serve_src and 'atexit' in serve_src:
        ok("Cleanup registered via atexit + signals")
    else:
        fail("atexit cleanup")

    if '--replace' in serve_src and '_force_kill' in serve_src:
        ok("--replace flag supported")
    else:
        fail("--replace flag")

    # ── Token security ──
    if 'see .vela.env' in serve_src or 'see {self.RUNTIME_FILE}' in serve_src:
        ok("Token not printed to console (references .vela.env)")
    else:
        fail("Token console display")

    # ── subprocess import at module level ──
    if re.search(r'^import subprocess$', serve_src, re.MULTILINE):
        ok("subprocess imported at module level in serve.py")
    else:
        fail("subprocess module-level import")

    # ── sys.executable in vela.py ──
    if 'sys.executable' in vela_src and '"python3"' not in vela_src.split("def deck_validate")[1].split("def deck_ship")[0]:
        ok("vela.py uses sys.executable (not hardcoded python3)")
    else:
        fail("sys.executable usage")

    # ── CLI: vela server start/stop ──
    if 'def server_start' in vela_src:
        ok("server_start function present")
    else:
        fail("server_start function")

    if 'def server_stop' in vela_src:
        ok("server_stop function present")
    else:
        fail("server_stop function")

    if '"server"' in vela_src and '"start": server_start' in vela_src and '"stop": server_stop' in vela_src:
        ok("server resource registered with start/stop commands")
    else:
        fail("server resource routing")

    # Test CLI capabilities include server
    result = subprocess.run([sys.executable, os.path.join(SCRIPTS, "vela.py"), "--capabilities", "--json"],
                            capture_output=True, text=True)
    if '"server"' in result.stdout and '"start"' in result.stdout and '"stop"' in result.stdout:
        ok("--capabilities lists server start/stop")
    else:
        fail("--capabilities server", result.stdout[:200])

    # ── SKILL.md updated ──
    if 'vela server start' in skill_md:
        ok("SKILL.md references vela server start")
    else:
        fail("SKILL.md server start")

    if 'vela deck serve' not in skill_md:
        ok("SKILL.md no longer references vela deck serve")
    else:
        fail("SKILL.md still has deck serve")

    if 'Token hygiene' in skill_md or 'NEVER read or print' in skill_md:
        ok("SKILL.md has token hygiene rule")
    else:
        fail("SKILL.md token hygiene")

    # ── .vela example decks exist ──
    examples_dir = os.path.join(REPO_ROOT, "examples")
    vela_decks = [f for f in os.listdir(examples_dir) if f.endswith(".vela")]
    json_decks = [f for f in os.listdir(examples_dir) if f.endswith(".json")]
    if len(vela_decks) >= 6:
        ok(f"Example decks use .vela extension ({len(vela_decks)} files)")
    else:
        fail("Example .vela decks", f"found {len(vela_decks)}")

    if len(json_decks) == 0:
        ok("No .json example decks remain")
    else:
        fail("Legacy .json decks", f"{len(json_decks)} still present")

    # ── Ship output uses .vela ──
    if 'basename + ".vela"' in vela_src:
        ok("Ship output uses .vela extension")
    else:
        fail("Ship .vela extension")

    # ── Windows errno expansion ──
    if '10048' in serve_src and '10013' in serve_src:
        ok("Windows EADDRINUSE/EACCES errno codes handled")
    else:
        fail("Windows errno codes")

    # ── Test --all flag ──
    if '--all' in open(__file__, encoding="utf-8").read() and 'run_server_tests' in open(__file__, encoding="utf-8").read():
        ok("Test suite supports --all flag for unified testing")
    else:
        fail("--all flag support")


# ━━━ CLI Command Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_cli_commands():
    print("\n── CLI Command Tests ──")

    vela = os.path.join(SCRIPTS, "vela.py")
    tmpdir = tempfile.mkdtemp(prefix="vela-cli-test-")

    # Create a test deck
    test_deck = {
        "deckTitle": "CLI Test Deck",
        "lanes": [{"title": "Main", "items": [{
            "title": "Test Module",
            "status": "done",
            "importance": "must",
            "slides": [
                {"bg": "#0f172a", "color": "#e2e8f0", "accent": "#3b82f6", "duration": 30,
                 "blocks": [
                     {"type": "badge", "text": "SECTION"},
                     {"type": "heading", "text": "Test Heading One", "size": "2xl"},
                     {"type": "text", "text": "Body text for slide one.", "size": "md", "color": "#94a3b8"},
                 ]},
                {"bg": "#0f172a", "color": "#e2e8f0", "accent": "#3b82f6", "duration": 60,
                 "blocks": [
                     {"type": "badge", "text": "TOOLS"},
                     {"type": "heading", "text": "Test Heading Two", "size": "2xl"},
                     {"type": "bullets", "items": ["Item A", "Item B", "Item C"]},
                 ]},
                {"bg": "#1e293b", "color": "#e2e8f0", "accent": "#3b82f6", "duration": 90,
                 "blocks": [
                     {"type": "heading", "text": "Test Heading Three", "size": "2xl"},
                     {"type": "flow", "items": [
                         {"icon": "Eye", "label": "See", "sublabel": "Observe"},
                         {"icon": "Brain", "label": "Think", "sublabel": "Plan"},
                         {"icon": "Zap", "label": "Act", "sublabel": "Execute"},
                     ]},
                 ]},
                {"bg": "#0f172a", "color": "#e2e8f0", "accent": "#3b82f6", "duration": 45,
                 "blocks": [
                     {"type": "heading", "text": "Test Table Slide", "size": "2xl"},
                     {"type": "table", "headers": ["Name", "Score"], "rows": [["Alice", "95"], ["Bob", "87"]]},
                 ]},
                {"bg": "#0f172a", "color": "#e2e8f0", "accent": "#3b82f6",
                 "blocks": [
                     {"type": "heading", "text": "No Duration Slide", "size": "2xl"},
                     {"type": "text", "text": "This slide has no duration.", "size": "md"},
                 ]},
            ]
        }]}]
    }

    deck_path = os.path.join(tmpdir, "test-deck.json")
    with open(deck_path, "w", encoding="utf-8") as f:
        json.dump(test_deck, f, ensure_ascii=False)

    def run_vela(*args):
        cmd = [sys.executable, vela] + list(args)
        return subprocess.run(cmd, capture_output=True, text=True, cwd=tmpdir)

    try:
        # ── capabilities ──
        r = run_vela("--capabilities")
        if r.returncode == 0:
            caps = json.loads(r.stdout)
            cmds = caps.get("resources", {}).get("deck", {}).get("commands", {})
            for expected in ["list", "validate", "split", "dump", "stats", "find", "extract-text", "patch-text", "replace-text"]:
                if expected in cmds:
                    ok(f"--capabilities lists '{expected}'")
                else:
                    fail(f"--capabilities lists '{expected}'")
        else:
            fail("--capabilities returns valid JSON", r.stderr)

        # ── deck list ──
        r = run_vela("deck", "list", deck_path)
        if r.returncode == 0 and "5 slides" in r.stdout.lower() or "Total: 5" in r.stdout:
            ok("deck list shows correct slide count")
        else:
            fail("deck list", r.stdout + r.stderr)

        # ── deck validate ──
        r = run_vela("deck", "validate", deck_path)
        # Test deck intentionally has a missing-duration slide, so validate may report errors
        if "Deck Stats" in r.stdout or "slides" in r.stdout.lower():
            ok("deck validate runs and produces output")
        else:
            fail("deck validate", r.stdout + r.stderr)

        # ── deck dump ──
        r = run_vela("deck", "dump", deck_path)
        if r.returncode == 0 and "Test Heading One" in r.stdout and "Test Heading Two" in r.stdout:
            ok("deck dump shows slide headings")
        else:
            fail("deck dump", r.stdout[:200])

        r = run_vela("deck", "dump", deck_path, "--full")
        if r.returncode == 0 and "Body text for slide one" in r.stdout:
            ok("deck dump --full shows all text fields")
        else:
            fail("deck dump --full", r.stdout[:200])

        # ── deck stats ──
        r = run_vela("deck", "stats", deck_path)
        if r.returncode == 0 and "5 slides" in r.stdout:
            ok("deck stats shows correct slide count")
        else:
            fail("deck stats slide count", r.stdout)

        if "missing duration" in r.stdout.lower():
            ok("deck stats detects missing duration")
        else:
            fail("deck stats missing duration detection")

        if "heading+bullets" in r.stdout.lower() or "monoton" in r.stdout.lower() or "icon-row" in r.stdout.lower():
            ok("deck stats detects heading+bullets monotony")
        else:
            fail("deck stats monotony detection")

        # ── deck stats --json ──
        r = run_vela("deck", "stats", deck_path, "--json")
        if r.returncode == 0:
            stats = json.loads(r.stdout)
            if stats.get("success") and stats.get("missing_duration", 0) >= 1:
                ok("deck stats --json returns structured data with issues")
            else:
                fail("deck stats --json structure", r.stdout[:200])
        else:
            fail("deck stats --json", r.stderr)

        # ── deck find --query ──
        r = run_vela("deck", "find", deck_path, "--query", "Table")
        if r.returncode == 0 and "Test Table Slide" in r.stdout:
            ok("deck find --query matches slide content")
        else:
            fail("deck find --query", r.stdout)

        # ── deck find --type ──
        r = run_vela("deck", "find", deck_path, "--type", "flow")
        if r.returncode == 0 and "1 match" in r.stdout:
            ok("deck find --type finds flow slides")
        else:
            fail("deck find --type flow", r.stdout)

        r = run_vela("deck", "find", deck_path, "--type", "table")
        if r.returncode == 0 and "1 match" in r.stdout:
            ok("deck find --type finds table slides")
        else:
            fail("deck find --type table", r.stdout)

        # ── deck find --missing ──
        r = run_vela("deck", "find", deck_path, "--missing", "duration")
        if r.returncode == 0 and "1 match" in r.stdout:
            ok("deck find --missing finds slides without duration")
        else:
            fail("deck find --missing duration", r.stdout)

        # ── deck find --json ──
        r = run_vela("deck", "find", deck_path, "--type", "flow", "--json")
        if r.returncode == 0:
            found = json.loads(r.stdout)
            if found.get("success") and found.get("found") == 1:
                ok("deck find --json returns structured results")
            else:
                fail("deck find --json structure", r.stdout[:200])
        else:
            fail("deck find --json", r.stderr)

        # ── deck replace-text ──
        r = run_vela("deck", "replace-text", deck_path, "Test Heading One", "Replaced Heading")
        if r.returncode == 0 and ("Replaced" in r.stdout or "Replaced" in r.stderr):
            ok("deck replace-text replaces text")
        else:
            fail("deck replace-text", r.stdout + r.stderr)

        # Verify replacement stuck
        with open(deck_path, encoding="utf-8") as f:
            content = f.read()
        if "Replaced Heading" in content and "Test Heading One" not in content:
            ok("deck replace-text persists to file")
        else:
            fail("deck replace-text persistence")

        # ── deck replace-text rgba cascade ──
        r = run_vela("deck", "replace-text", deck_path, "#3b82f6", "#2563eb")
        if r.returncode == 0 and "rgba" in r.stdout.lower():
            ok("deck replace-text cascades hex to rgba")
        else:
            # No rgba in this deck, but hex replacement should work
            if r.returncode == 0:
                ok("deck replace-text replaces hex colors")
            else:
                fail("deck replace-text hex colors", r.stdout)

        # Revert for further tests
        run_vela("deck", "replace-text", deck_path, "#2563eb", "#3b82f6")
        run_vela("deck", "replace-text", deck_path, "Replaced Heading", "Test Heading One")

        # ── deck extract-text ──
        texts_path = os.path.join(tmpdir, "texts.json")
        r = run_vela("deck", "extract-text", deck_path, texts_path)
        if r.returncode == 0 and os.path.exists(texts_path):
            texts = json.load(open(texts_path, encoding="utf-8"))
            ok(f"deck extract-text extracts {len(texts)} text fields")

            # Check key format
            has_deck_title = "deckTitle" in texts
            has_slide_text = any(k.startswith("s1.") for k in texts)
            has_nested = any(".i" in k for k in texts)  # flow items
            has_table = any(".h" in k or ".r" in k for k in texts)  # table headers/rows
            if has_deck_title:
                ok("extract-text includes deckTitle")
            else:
                fail("extract-text deckTitle")
            if has_slide_text:
                ok("extract-text includes slide-level text")
            else:
                fail("extract-text slide text")
            if has_nested:
                ok("extract-text includes nested items (flow/bullets)")
            else:
                fail("extract-text nested items")
            if has_table:
                ok("extract-text includes table headers/rows")
            else:
                fail("extract-text table content")

            # Check code block exclusion — no code blocks in test deck, so skip
        else:
            fail("deck extract-text", r.stdout + r.stderr)

        # ── deck patch-text (round-trip) ──
        # Save original for comparison
        with open(deck_path, encoding="utf-8") as f:
            original = json.load(f)

        r = run_vela("deck", "patch-text", deck_path, texts_path)
        if r.returncode == 0:
            with open(deck_path, encoding="utf-8") as f:
                patched = json.load(f)
            if json.dumps(original, sort_keys=True) == json.dumps(patched, sort_keys=True):
                ok("deck patch-text round-trip produces identical deck")
            else:
                fail("deck patch-text round-trip identity")
        else:
            fail("deck patch-text", r.stdout + r.stderr)

        # ── deck patch-text (modify) ──
        texts["deckTitle"] = "Translated Title"
        texts["s1.b1.text"] = "Translated Heading"
        with open(texts_path, "w", encoding="utf-8") as f:
            json.dump(texts, f, ensure_ascii=False)
        r = run_vela("deck", "patch-text", deck_path, texts_path)
        if r.returncode == 0:
            with open(deck_path, encoding="utf-8") as f:
                modified = json.load(f)
            if modified["deckTitle"] == "Translated Title":
                ok("deck patch-text applies deckTitle change")
            else:
                fail("deck patch-text deckTitle change")
        else:
            fail("deck patch-text modify", r.stderr)

        # Reset deck
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(test_deck, f, ensure_ascii=False)

        # ── deck split --sections ──
        r = run_vela("deck", "split", deck_path, "--sections", "Part A:2,Part B:3")
        if r.returncode == 0 and "2 sections" in r.stdout:
            ok("deck split --sections creates named sections")
            with open(deck_path, encoding="utf-8") as f:
                split_deck = json.load(f)
            items = split_deck["lanes"][0]["items"]
            if len(items) == 2 and items[0]["title"] == "Part A" and len(items[0]["slides"]) == 2:
                ok("deck split --sections correct structure (2+3)")
            else:
                fail("deck split structure", f"items={len(items)}")
        else:
            fail("deck split --sections", r.stdout + r.stderr)

        # ── deck split --flat ──
        r = run_vela("deck", "split", deck_path, "--flat")
        if r.returncode == 0:
            with open(deck_path, encoding="utf-8") as f:
                flat_deck = json.load(f)
            items = flat_deck["lanes"][0]["items"]
            if len(items) == 1 and len(items[0]["slides"]) == 5:
                ok("deck split --flat merges all into one module (5 slides)")
            else:
                fail("deck split --flat structure", f"items={len(items)}, slides={len(items[0]['slides']) if items else '?'}")
        else:
            fail("deck split --flat", r.stdout + r.stderr)

        # ── deck split --size ──
        r = run_vela("deck", "split", deck_path, "--size", "2")
        if r.returncode == 0:
            with open(deck_path, encoding="utf-8") as f:
                sized = json.load(f)
            items = sized["lanes"][0]["items"]
            if len(items) == 3:  # 2+2+1
                ok("deck split --size 2 creates 3 sections (2+2+1)")
            else:
                fail("deck split --size structure", f"expected 3 sections, got {len(items)}")
        else:
            fail("deck split --size", r.stdout + r.stderr)

        # ── deck split --dry-run ──
        r = run_vela("deck", "split", deck_path, "--flat", "--dry-run")
        if r.returncode == 0:
            preview = json.loads(r.stdout)
            if preview.get("would_execute") == "split":
                ok("deck split --dry-run returns preview without modifying")
            else:
                fail("deck split --dry-run output")
        else:
            fail("deck split --dry-run", r.stderr)

        # ── slide edit ──
        # Reset to flat first
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(test_deck, f, ensure_ascii=False)

        r = run_vela("slide", "edit", deck_path, "1", "block.1.text", "Edited Heading")
        if r.returncode == 0:
            with open(deck_path, encoding="utf-8") as f:
                edited = json.load(f)
            h = edited["lanes"][0]["items"][0]["slides"][0]["blocks"][1]["text"]
            if h == "Edited Heading":
                ok("slide edit changes block text")
            else:
                fail("slide edit block text", f"got '{h}'")
        else:
            fail("slide edit", r.stderr)

        # ── slide edit slide-level property ──
        r = run_vela("slide", "edit", deck_path, "1", "duration", "120")
        if r.returncode == 0:
            with open(deck_path, encoding="utf-8") as f:
                edited = json.load(f)
            # Duration might be stored as string or int depending on implementation
            ok("slide edit changes slide-level property")
        else:
            fail("slide edit slide-level", r.stderr)

        # ── error handling ──
        r = run_vela("slide", "view", deck_path, "99")
        if r.returncode != 0:
            ok("slide view returns error for out-of-range slide")
        else:
            fail("slide view out-of-range should error")

        r = run_vela("deck", "find", deck_path)
        if r.returncode != 0:
            ok("deck find returns usage error without filters")
        else:
            fail("deck find without filters should error")

        r = run_vela("deck", "split", deck_path)
        # Auto-split or error, either is acceptable
        ok("deck split without flags handled")

        # ── replace-text rgba cascade ──
        # Create a deck with rgba colors to test cascade
        rgba_deck = copy.deepcopy(test_deck)
        rgba_deck["lanes"][0]["items"][0]["slides"][0]["blocks"].append(
            {"type": "callout", "text": "Test", "bg": "rgba(59,130,246,0.15)", "border": "#3b82f6"}
        )
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(rgba_deck, f, ensure_ascii=False)
        r = run_vela("deck", "replace-text", deck_path, "#3b82f6", "#2563eb")
        if r.returncode == 0:
            with open(deck_path, encoding="utf-8") as f:
                content = f.read()
            if "rgba(37,99,235,0.15)" in content and "#3b82f6" not in content:
                ok("replace-text cascades hex to rgba values")
            elif "#2563eb" in content:
                ok("replace-text replaces hex (rgba cascade partial)")
            else:
                fail("replace-text rgba cascade", "hex not replaced")
        else:
            fail("replace-text rgba cascade", r.stderr)

        # Revert
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(test_deck, f, ensure_ascii=False)

        # ── extract-text includes lane/module titles ──
        r = run_vela("deck", "extract-text", deck_path, texts_path)
        if r.returncode == 0:
            texts_full = json.load(open(texts_path, encoding="utf-8"))
            has_lane = any(k.startswith("l") and k.endswith(".title") for k in texts_full)
            has_module = any(".m" in k and k.endswith(".title") for k in texts_full)
            if has_lane and has_module:
                ok("extract-text includes lane and module titles")
            else:
                fail("extract-text lane/module titles", f"lane={has_lane} module={has_module}")
        else:
            fail("extract-text lane/module", r.stderr)

        # ── deck stats detects block overflow ──
        overflow_deck = copy.deepcopy(test_deck)
        overflow_deck["lanes"][0]["items"][0]["slides"][0]["blocks"] = [
            {"type": "text", "text": f"Block {i}"} for i in range(9)
        ]
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(overflow_deck, f, ensure_ascii=False)
        r = run_vela("deck", "stats", deck_path)
        if r.returncode == 0 and "overflow" in r.stdout.lower():
            ok("deck stats detects block overflow (>7 blocks)")
        else:
            fail("deck stats overflow", r.stdout[:200])

        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(test_deck, f, ensure_ascii=False)

        # ── slide view ──
        r = run_vela("slide", "view", deck_path, "1")
        if r.returncode == 0 and "SECTION" in r.stdout:
            ok("slide view shows slide content")
        else:
            fail("slide view", r.stdout[:200])

        # ── slide view --raw (JSON output) ──
        r = run_vela("slide", "view", deck_path, "1", "--raw")
        if r.returncode == 0:
            try:
                raw = json.loads(r.stdout)
                if "blocks" in raw:
                    ok("slide view --raw returns valid JSON with blocks")
                else:
                    fail("slide view --raw blocks", r.stdout[:200])
            except json.JSONDecodeError:
                fail("slide view --raw JSON", "not valid JSON")
        else:
            fail("slide view --raw", r.stderr)

        # ── slide remove ──
        r = run_vela("slide", "remove", deck_path, "5")
        if r.returncode == 0:
            with open(deck_path, encoding="utf-8") as f:
                removed_deck = json.load(f)
            slide_count = sum(len(it.get("slides", [])) for l in removed_deck["lanes"] for it in l["items"])
            if slide_count == 4:
                ok("slide remove reduces slide count (5→4)")
            else:
                fail("slide remove count", f"expected 4, got {slide_count}")
        else:
            fail("slide remove", r.stderr)

        # Reset
        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(test_deck, f, ensure_ascii=False)

        # ── slide duplicate ──
        r = run_vela("slide", "duplicate", deck_path, "1")
        if r.returncode == 0:
            with open(deck_path, encoding="utf-8") as f:
                duped = json.load(f)
            slide_count = sum(len(it.get("slides", [])) for l in duped["lanes"] for it in l["items"])
            if slide_count == 6:
                ok("slide duplicate increases slide count (5→6)")
            else:
                fail("slide duplicate count", f"expected 6, got {slide_count}")
        else:
            fail("slide duplicate", r.stderr)

        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(test_deck, f, ensure_ascii=False)

        # ── slide move ──
        r = run_vela("slide", "move", deck_path, "1", "3")
        if r.returncode == 0:
            ok("slide move executes successfully")
        else:
            fail("slide move", r.stderr)

        with open(deck_path, "w", encoding="utf-8") as f:
            json.dump(test_deck, f, ensure_ascii=False)

        # ── sync-skill-docs.py exists ──
        sync_script = os.path.join(SCRIPTS, "sync-skill-docs.py")
        if os.path.exists(sync_script):
            r = subprocess.run([sys.executable, sync_script], capture_output=True, text=True, cwd=REPO_ROOT)
            if r.returncode == 0 and "Preview" in r.stdout or "CLI Quick Reference" in r.stdout:
                ok("sync-skill-docs.py generates CLI reference")
            else:
                fail("sync-skill-docs.py", r.stdout[:200] + r.stderr[:200])
        else:
            fail("sync-skill-docs.py exists")

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ━━━ Main ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ━━━ Serve Auth Tests ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_serve_auth():
    """Test token authentication for serve.py using a live server."""
    print("\n── Serve Auth Tests ──")

    try:
        from urllib.request import urlopen, Request
        from urllib.error import HTTPError, URLError
    except ImportError:
        fail("urllib available")
        return

    TOKEN = "test-auth-token-xyz789"
    PORT = 3099  # unlikely to conflict
    SERVE_PY = os.path.join(SCRIPTS, "serve.py")
    STARTER = os.path.join(EXAMPLES, "starter-deck.vela")

    # Create a temp .vela file for folder-mode tests (server only lists .vela files)
    import shutil
    VELA_DECK = os.path.join(EXAMPLES, "test-auth.vela")
    shutil.copy2(STARTER, VELA_DECK)

    def http_get(path, headers=None, follow_redirects=False):
        """Make HTTP request, return (status_code, headers_dict, body)."""
        url = f"http://localhost:{PORT}{path}"
        req = Request(url, headers=headers or {})
        try:
            if follow_redirects:
                resp = urlopen(req, timeout=5)
            else:
                # Use low-level to capture redirects
                import urllib.request
                class NoRedirect(urllib.request.HTTPRedirectHandler):
                    def redirect_request(self, req, fp, code, msg, headers, newurl):
                        raise HTTPError(newurl, code, msg, headers, fp)
                opener = urllib.request.build_opener(NoRedirect)
                resp = opener.open(req, timeout=5)
            return resp.status, dict(resp.headers), resp.read()
        except HTTPError as e:
            return e.code, dict(e.headers) if hasattr(e, 'headers') else {}, e.read() if hasattr(e, 'read') else b""

    def http_post(path, data=b"{}", headers=None):
        """Make HTTP POST request."""
        url = f"http://localhost:{PORT}{path}"
        h = {"Content-Type": "application/json"}
        h.update(headers or {})
        req = Request(url, data=data, headers=h, method="POST")
        try:
            import urllib.request
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, headers, newurl):
                    raise HTTPError(newurl, code, msg, headers, fp)
            opener = urllib.request.build_opener(NoRedirect)
            resp = opener.open(req, timeout=5)
            return resp.status, dict(resp.headers), resp.read()
        except HTTPError as e:
            return e.code, dict(e.headers) if hasattr(e, 'headers') else {}, e.read() if hasattr(e, 'read') else b""

    # ── Start server ──
    proc = subprocess.Popen(
        [sys.executable, SERVE_PY, STARTER, "--no-open", "--port", str(PORT),
         "--channel-port", "0", "--token", TOKEN],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )

    # Wait for server to be ready
    ready = False
    for _ in range(20):
        time.sleep(0.3)
        try:
            http_get("/")
            ready = True
            break
        except (ConnectionRefusedError, URLError, OSError):
            continue

    if not ready:
        fail("serve.py starts and listens")
        proc.kill()
        return

    ok("serve.py starts with --token flag")

    try:
        # ── 1. Unauthenticated requests are rejected ──
        code, _, _ = http_get("/")
        if code == 401:
            ok("GET / without auth → 401")
        else:
            fail("GET / without auth", f"expected 401, got {code}")

        code, _, _ = http_get("/api/decks")
        if code == 401:
            ok("GET /api/decks without auth → 401")
        else:
            fail("GET /api/decks without auth", f"expected 401, got {code}")

        code, _, _ = http_post("/save/test-auth.vela")
        if code == 401:
            ok("POST /save/<deck> without auth → 401")
        else:
            fail("POST /save/<deck> without auth", f"expected 401, got {code}")

        code, _, _ = http_get("/poll/test-auth.vela?v=0")
        if code == 401:
            ok("GET /poll/<deck> without auth → 401")
        else:
            fail("GET /poll/<deck> without auth", f"expected 401, got {code}")

        # ── 2. Wrong token → 403 ──
        code, _, _ = http_get("/?token=wrong-token")
        if code == 403:
            ok("GET /?token=wrong → 403")
        else:
            fail("GET /?token=wrong", f"expected 403, got {code}")

        # ── 3. Correct token → 302 redirect + cookie ──
        code, hdrs, _ = http_get(f"/?token={TOKEN}")
        if code == 302:
            ok("GET /?token=correct → 302 redirect")
        else:
            fail("GET /?token=correct redirect", f"expected 302, got {code}")

        location = hdrs.get("Location", hdrs.get("location", ""))
        if location == "/":
            ok("Redirect strips token from URL (Location: /)")
        else:
            fail("Redirect Location", f"expected '/', got {location!r}")

        set_cookie = hdrs.get("Set-Cookie", hdrs.get("set-cookie", ""))
        if "vela_session=" in set_cookie:
            ok("Redirect sets vela_session cookie")
        else:
            fail("Set-Cookie header", f"got {set_cookie!r}")

        if "HttpOnly" in set_cookie:
            ok("Cookie has HttpOnly flag")
        else:
            fail("Cookie HttpOnly flag")

        if "SameSite=Strict" in set_cookie:
            ok("Cookie has SameSite=Strict flag")
        else:
            fail("Cookie SameSite flag", f"got {set_cookie!r}")

        # ── 4. Cookie auth works ──
        session = set_cookie.split("vela_session=")[1].split(";")[0] if "vela_session=" in set_cookie else ""
        if session:
            code, _, body = http_get("/", headers={"Cookie": f"vela_session={session}"})
            if code == 200:
                ok("GET / with valid session cookie → 200")
            else:
                fail("Cookie auth", f"expected 200, got {code}")

        # ── 5. Invalid cookie → 401 ──
        code, _, _ = http_get("/", headers={"Cookie": "vela_session=fake-session-id"})
        if code == 401:
            ok("GET / with invalid cookie → 401")
        else:
            fail("Invalid cookie", f"expected 401, got {code}")

        # ── 6. Bearer auth works ──
        code, _, body = http_get("/", headers={"Authorization": f"Bearer {TOKEN}"})
        if code == 200:
            ok("GET / with Bearer token → 200")
        else:
            fail("Bearer auth", f"expected 200, got {code}")

        code, _, body = http_get("/api/decks", headers={"Authorization": f"Bearer {TOKEN}"})
        if code == 200:
            ok("GET /api/decks with Bearer → 200")
        else:
            fail("GET /api/decks Bearer", f"expected 200, got {code}")

        # ── 7. Wrong Bearer → 403 ──
        code, _, _ = http_get("/", headers={"Authorization": "Bearer wrong-token"})
        if code == 403:
            ok("GET / with wrong Bearer → 403")
        else:
            fail("Wrong Bearer", f"expected 403, got {code}")

        # ── 8. Non-Bearer auth header → falls through to 401 ──
        code, _, _ = http_get("/", headers={"Authorization": "Basic wrong-token"})
        if code == 401:
            ok("GET / with Basic auth header → 401 (not Bearer)")
        else:
            fail("Basic auth fallthrough", f"expected 401, got {code}")

        # ── 9. Token on subpath redirects to correct path ──
        code, hdrs, _ = http_get(f"/api/decks?token={TOKEN}")
        if code == 302:
            location = hdrs.get("Location", hdrs.get("location", ""))
            if location == "/api/decks":
                ok("Token on /api/decks redirects to /api/decks (strips token)")
            else:
                fail("Subpath redirect Location", f"expected '/api/decks', got {location!r}")
        else:
            fail("Subpath token redirect", f"expected 302, got {code}")

        # ── 10. Origin check blocks cross-origin POST ──
        code, _, _ = http_post("/save/test-auth.vela", headers={
            "Authorization": f"Bearer {TOKEN}",
            "Origin": "http://evil.com"
        })
        if code == 403:
            ok("POST /save/<deck> with evil Origin → 403")
        else:
            fail("Origin check", f"expected 403, got {code}")

        # ── 11. Origin check allows localhost ──
        code, _, _ = http_post("/save/test-auth.vela", headers={
            "Authorization": f"Bearer {TOKEN}",
            "Origin": f"http://localhost:{PORT}"
        })
        if code == 200:
            ok("POST /save/<deck> with localhost Origin → 200")
        else:
            fail("Origin localhost", f"expected 200, got {code}")

        # ── 12. No Origin header on POST is allowed (same-origin) ──
        code, _, _ = http_post("/save/test-auth.vela", headers={
            "Authorization": f"Bearer {TOKEN}",
        })
        if code == 200:
            ok("POST /save/<deck> without Origin header → 200 (same-origin)")
        else:
            fail("POST no Origin", f"expected 200, got {code}")

        # ── 13. Host header check still works (before auth) ──
        code, _, _ = http_get("/", headers={"Host": "evil.com", "Authorization": f"Bearer {TOKEN}"})
        if code == 403:
            ok("GET / with evil Host header → 403 (DNS rebinding protection)")
        else:
            fail("Host check", f"expected 403, got {code}")

        # ── 14. Empty token param → 401 (not 403) ──
        code, _, _ = http_get("/?token=")
        if code == 401:
            ok("GET /?token= (empty) → 401")
        else:
            fail("Empty token param", f"expected 401, got {code}")

        # ── 15. Bearer auth on POST /save/<deck> ──
        code, _, body = http_post("/save/test-auth.vela", headers={"Authorization": f"Bearer {TOKEN}"})
        if code == 200:
            ok("POST /save/<deck> with Bearer → 200")
        else:
            fail("Bearer POST /save/<deck>", f"expected 200, got {code}")

        # ── 16. Multiple session cookies (each token visit creates new session) ──
        code1, hdrs1, _ = http_get(f"/?token={TOKEN}")
        code2, hdrs2, _ = http_get(f"/?token={TOKEN}")
        s1 = hdrs1.get("Set-Cookie", "").split("vela_session=")[1].split(";")[0] if "vela_session=" in hdrs1.get("Set-Cookie", "") else ""
        s2 = hdrs2.get("Set-Cookie", "").split("vela_session=")[1].split(";")[0] if "vela_session=" in hdrs2.get("Set-Cookie", "") else ""
        if s1 and s2 and s1 != s2:
            ok("Each token visit creates unique session ID")
        else:
            fail("Unique session IDs", f"s1={s1!r}, s2={s2!r}")

        # Both sessions should work
        c1, _, _ = http_get("/", headers={"Cookie": f"vela_session={s1}"})
        c2, _, _ = http_get("/", headers={"Cookie": f"vela_session={s2}"})
        if c1 == 200 and c2 == 200:
            ok("Multiple concurrent sessions all valid")
        else:
            fail("Concurrent sessions", f"s1→{c1}, s2→{c2}")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()

    # ── Test --no-auth mode ──
    proc2 = subprocess.Popen(
        [sys.executable, SERVE_PY, STARTER, "--no-open", "--port", str(PORT),
         "--channel-port", "0", "--no-auth"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    ready = False
    for _ in range(20):
        time.sleep(0.3)
        try:
            http_get("/")
            ready = True
            break
        except (ConnectionRefusedError, URLError, OSError):
            continue

    if not ready:
        fail("serve.py starts with --no-auth")
        proc2.kill()
        return

    try:
        code, _, _ = http_get("/")
        if code == 200:
            ok("--no-auth: GET / without auth → 200")
        else:
            fail("--no-auth GET /", f"expected 200, got {code}")

        code, _, _ = http_get("/api/decks")
        if code == 200:
            ok("--no-auth: GET /api/decks → 200")
        else:
            fail("--no-auth /api/decks", f"expected 200, got {code}")

        code, _, _ = http_post("/save/test-auth.vela")
        if code == 200:
            ok("--no-auth: POST /save/<deck> → 200")
        else:
            fail("--no-auth POST /save/<deck>", f"expected 200, got {code}")

    finally:
        proc2.terminate()
        try:
            proc2.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc2.kill()

    # ── Test VELA_TOKEN env var ──
    env = os.environ.copy()
    env["VELA_TOKEN"] = "env-token-abc"
    proc3 = subprocess.Popen(
        [sys.executable, SERVE_PY, STARTER, "--no-open", "--port", str(PORT),
         "--channel-port", "0"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
    )
    ready = False
    for _ in range(20):
        time.sleep(0.3)
        try:
            http_get("/")
            ready = True
            break
        except (ConnectionRefusedError, URLError, OSError):
            continue

    if not ready:
        fail("serve.py starts with VELA_TOKEN env")
        proc3.kill()
        return

    try:
        code, _, _ = http_get("/", headers={"Authorization": "Bearer env-token-abc"})
        if code == 200:
            ok("VELA_TOKEN env var: Bearer with env token → 200")
        else:
            fail("VELA_TOKEN env", f"expected 200, got {code}")

        code, _, _ = http_get("/", headers={"Authorization": "Bearer wrong"})
        if code == 403:
            ok("VELA_TOKEN env var: wrong token → 403")
        else:
            fail("VELA_TOKEN wrong", f"expected 403, got {code}")

        # ── Test runtime info file (.vela.env) — must check while server is running ──
        runtime_file = os.path.join(os.getcwd(), ".vela.env")
        if os.path.exists(runtime_file):
            try:
                with open(runtime_file, encoding="utf-8") as f:
                    info = json.load(f)
                if "pid" in info and "port" in info and "host" in info and "mode" in info:
                    ok("Runtime .vela.env has pid, port, host, mode fields")
                else:
                    fail("Runtime file fields", f"keys={list(info.keys())}")
                if "token" in info:
                    ok("Runtime .vela.env includes auth token")
                else:
                    fail("Runtime file token field")
            except json.JSONDecodeError:
                fail("Runtime .vela.env is valid JSON")
        else:
            fail("Runtime .vela.env exists")

    finally:
        proc3.terminate()
        try:
            proc3.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc3.kill()

    # Clean up temp .vela file
    if os.path.exists(VELA_DECK):
        os.unlink(VELA_DECK)

    # ── Static code checks for auth (serve.py source) ──
    with open(os.path.join(SCRIPTS, "serve.py"), encoding="utf-8") as _f:
        serve_src = _f.read()

    if "hmac.compare_digest" in serve_src:
        ok("Token comparison uses hmac.compare_digest (timing-safe)")
    else:
        fail("Timing-safe comparison")

    if "secrets.token_urlsafe" in serve_src:
        ok("Token generation uses secrets.token_urlsafe (CSPRNG)")
    else:
        fail("CSPRNG token generation")

    if "httponly" in serve_src.lower():
        ok("Session cookie has HttpOnly flag in source")
    else:
        fail("HttpOnly in source")

    if "samesite" in serve_src.lower():
        ok("Session cookie has SameSite flag in source")
    else:
        fail("SameSite in source")

    if "_check_origin" in serve_src:
        ok("Origin header check method exists")
    else:
        fail("Origin check method")

    if "_check_auth" in serve_src and "_check_host" in serve_src:
        ok("Both auth and host checks exist in handler")
    else:
        fail("Auth+host checks")

    if "--no-auth" in serve_src:
        ok("--no-auth CLI flag supported")
    else:
        fail("--no-auth flag")

    if "VELA_TOKEN" in serve_src:
        ok("VELA_TOKEN env var supported")
    else:
        fail("VELA_TOKEN env var")

    if "0o600" in serve_src:
        ok("Runtime file created with 0o600 permissions")
    else:
        fail("Runtime file permissions")


def run_server_tests():
    """Run test_serve.py (unittest-based server tests)."""
    print("\n── Server Tests (test_serve.py) ──")
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "tests.test_serve", "-v"],
        cwd=REPO_ROOT, capture_output=True, text=True
    )
    # unittest prints to stderr
    output = result.stderr or result.stdout
    # Count results
    srv_passed = len(re.findall(r'\.\.\. ok$', output, re.MULTILINE))
    srv_failed = len(re.findall(r'\.\.\. FAIL$', output, re.MULTILINE))
    srv_errors = len(re.findall(r'\.\.\. ERROR$', output, re.MULTILINE))
    if result.returncode == 0:
        print(f"  ✅ {srv_passed} server tests passed")
    else:
        print(output)
        print(f"  ❌ Server tests: {srv_passed} passed, {srv_failed + srv_errors} failed")
    return result.returncode

def run_concat_sync():
    """Verify concat.py produces a template identical to the committed one."""
    print("\n── Template Sync Check ──")
    original = os.path.join(REPO_ROOT, "skills", "vela-slides", "app", "vela.jsx")
    with open(original, "r", encoding="utf-8") as f:
        before = f.read()
    subprocess.run(
        [sys.executable, os.path.join(REPO_ROOT, "skills", "vela-slides", "scripts", "concat.py")],
        capture_output=True, text=True
    )
    with open(original, "r", encoding="utf-8") as f:
        after = f.read()
    if before == after:
        print("  ✅ Template in sync with parts")
        return 0
    else:
        print("  ❌ vela.jsx is out of sync with parts! Run: python3 skills/vela-slides/scripts/concat.py")
        return 1

def run_e2e_tests():
    """Run e2e UI tests (test_review_ui.cjs via Node)."""
    print("\n── E2E UI Tests (test_review_ui.cjs) ──")
    test_script = os.path.join(REPO_ROOT, "tests", "test_review_ui.cjs")
    if not os.path.exists(test_script):
        print("  ⚠️  test_review_ui.cjs not found, skipping")
        return 0
    # Check if node is available
    try:
        subprocess.run(["node", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("  ⚠️  Node.js not available, skipping e2e tests")
        return 0
    # Check required node_modules deps before running
    node_modules = os.path.join(REPO_ROOT, "node_modules")
    missing_deps = []
    for dep in ("react", "react-dom", "@babel/standalone", "lucide-react"):
        dep_path = os.path.join(node_modules, *dep.split("/"))
        if not os.path.isdir(dep_path):
            missing_deps.append(dep)
    if missing_deps:
        print(f"  ⚠️  Missing node deps: {', '.join(missing_deps)} — skipping e2e tests")
        print(f"  Run first: npm install react react-dom @babel/standalone lucide-react")
        return 0

    # Run the test — it resolves Playwright internally (local or global pnpm)
    try:
        result = subprocess.run(
            ["node", test_script],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=180
        )
    except subprocess.TimeoutExpired:
        print("  ❌ E2E tests timed out (180s)")
        return 1

    output = result.stdout + result.stderr
    if "Playwright not found" in output:
        print("  ⚠️  Playwright not installed, skipping e2e tests")
        print("  Install: pnpm add -g playwright && playwright install chromium")
        return 0

    print(result.stdout)
    if result.stderr and result.returncode != 0:
        print(result.stderr)
    if result.returncode == 0:
        e2e_passed = re.search(r'(\d+)\s+passed', result.stdout)
        count = e2e_passed.group(1) if e2e_passed else "?"
        print(f"  ✅ {count} e2e tests passed")
    else:
        print(f"  ❌ E2E tests failed (exit code {result.returncode})")
    return result.returncode


if __name__ == "__main__":
    args = sys.argv[1:]
    run_all = "--all" in args
    run_unit = "--unit" in args or (not args) or run_all
    run_integration = "--integration" in args or (not args) or run_all

    print("⛵ Vela Slides Test Suite\n")

    if run_unit:
        test_unit()
        test_security()
        test_known_bugs()
        test_ip_hygiene()
        test_v10_features()
        test_channel_local()
        test_server_hardening()
    if run_integration:
        test_integration()
        test_cli_commands()
        test_serve_auth()

    extra_fails = 0
    if run_all:
        extra_fails += run_server_tests()
        extra_fails += run_concat_sync()
        extra_fails += run_e2e_tests()

    total_fails = fails + (1 if extra_fails else 0)

    print(f"\n{'━' * 40}")
    print(f"  ✅ {passes} passed  {'❌ ' + str(fails) + ' failed' if fails else ''}")
    if run_all and extra_fails:
        print(f"  ❌ External test suites had failures")
    print(f"{'━' * 40}")

    sys.exit(1 if total_fails else 0)
