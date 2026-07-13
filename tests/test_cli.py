#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""
Vela CLI behavioral test suite — untested subcommands + exact exit codes.

Standalone companion to tests/test_vela.py. Every check drives the real
`skills/vela-slides/scripts/vela.py` CLI through subprocess (cwd = a throwaway
tempdir) and asserts BOTH the effect (file created / block removed / slide
inserted at the right index / stdout) AND the exact exit-code VALUE — not just
`returncode != 0` the way the existing suite does.

Focus (from coverage-analysis/01-reducer-cli-deck.md §2b):
  Untested subcommands ........ deck extract, deck ship, deck init,
                                deck assemble (CLI wrapper), slide insert,
                                slide remove-block, slide append
  Exit-code VALUES ............ EXIT_OK=0, EXIT_FAIL=1, EXIT_USAGE=2,
                                EXIT_NOT_FOUND=3, EXIT_VALIDATION=4,
                                EXIT_CONFLICT=5 (deck init overwrite guard)
  Security control ............ _safe_resolve path-traversal guard;
                                package-skill.py symlink-hardening (dev tool)

Run:  python3 tests/test_cli.py
Exit: 0 if all green, 1 otherwise. Prints "N passed, N failed" summary. No network.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

# ── Locate the CLI + module ─────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SCRIPTS = os.path.join(REPO, "skills", "vela-slides", "scripts")
VELA_PY = os.path.join(SCRIPTS, "vela.py")

# Import the module purely to read the exit-code constants (no main() runs).
sys.path.insert(0, SCRIPTS)
import vela  # noqa: E402

# The skill packager is a dev tool (never shipped); import it directly to
# exercise its symlink-hardening in-process.
sys.path.insert(0, os.path.join(REPO, "tools", "vela-dev", "scripts"))
import importlib  # noqa: E402
package_skill = importlib.import_module("package-skill")  # noqa: E402

EXIT_OK = vela.EXIT_OK                # 0
EXIT_FAIL = vela.EXIT_FAIL           # 1
EXIT_USAGE = vela.EXIT_USAGE         # 2
EXIT_NOT_FOUND = vela.EXIT_NOT_FOUND  # 3
EXIT_VALIDATION = vela.EXIT_VALIDATION  # 4
EXIT_CONFLICT = vela.EXIT_CONFLICT   # 5

# ── Tiny test harness (pass/fail counters, repo-style summary) ──────────
_passed = 0
_failed = 0


def ok(label):
    global _passed
    _passed += 1
    print(f"  PASS  {label}")


def fail(label, detail=""):
    global _failed
    _failed += 1
    print(f"  FAIL  {label}")
    if detail:
        for line in str(detail).rstrip().splitlines():
            print(f"          {line}")


def check(cond, label, detail=""):
    if cond:
        ok(label)
    else:
        fail(label, detail)


def check_exit(result, expected_code, label):
    """Assert the exact exit-code VALUE (the whole point of this suite)."""
    if result.returncode == expected_code:
        ok(f"{label} → exit {expected_code}")
    else:
        fail(f"{label} → exit {expected_code}",
             f"got exit {result.returncode}\nstdout: {result.stdout.strip()}\nstderr: {result.stderr.strip()}")


# ── Deck fixtures (built fresh in a tempdir; committed files untouched) ──
def _good_deck():
    return {
        "deckTitle": "CLI Exit-Code Deck",
        "lanes": [{"title": "Main", "items": [{
            "title": "Module A",
            "status": "done",
            "importance": "must",
            "slides": [
                {"bg": "#0f172a", "color": "#e2e8f0", "accent": "#3b82f6", "duration": 30,
                 "blocks": [
                     {"type": "badge", "text": "INTRO"},
                     {"type": "heading", "text": "Slide One", "size": "2xl"},
                     {"type": "text", "text": "Body one.", "size": "md"},
                 ]},
                {"bg": "#0f172a", "color": "#e2e8f0", "accent": "#3b82f6", "duration": 60,
                 "blocks": [
                     {"type": "heading", "text": "Slide Two", "size": "2xl"},
                     {"type": "bullets", "items": ["A", "B"]},
                 ]},
                {"bg": "#1e293b", "color": "#e2e8f0", "accent": "#3b82f6", "duration": 45,
                 "blocks": [
                     {"type": "heading", "text": "Slide Three", "size": "2xl"},
                 ]},
            ],
        }]}],
    }


def _bad_deck():
    # Valid JSON, but semantically invalid: unknown block type -> validate.py errors.
    return {
        "deckTitle": "Broken Deck",
        "lanes": [{"title": "Main", "items": [{
            "title": "M", "status": "done", "importance": "must",
            "slides": [{"bg": "#000000", "duration": 10,
                        "blocks": [{"type": "not_a_real_block", "text": "x"}]}],
        }]}],
    }


def _slide_count(deck_path):
    with open(deck_path, encoding="utf-8") as f:
        deck = json.load(f)
    return sum(len(item.get("slides", []))
               for lane in deck.get("lanes", [])
               for item in lane.get("items", []))


# ── package-skill dev-tool checks (happy path + symlink hardening) ──────
def _check_package_skill(tmpdir):
    """Exercise tools/vela-dev/scripts/package-skill.py end to end.

    Two things matter here: (1) it still produces a valid upload archive of
    the real skill tree, and (2) it refuses symlinks so a link planted inside
    a skill tree cannot pull outside-of-root bytes into the archive under an
    in-root member name. build_zip() is called directly against synthetic
    trees for the hardening cases so no production files are touched.
    """
    # (1) Happy path: package the real skill dir; valid zip, SKILL.md present,
    #     no __pycache__ members.
    zip_out = os.path.join(tmpdir, "skill.zip")
    count, skipped = package_skill.build_zip(package_skill.SKILL_DIR, zip_out)
    if os.path.exists(zip_out) and zipfile.is_zipfile(zip_out):
        with zipfile.ZipFile(zip_out) as zf:
            names = zf.namelist()
        check(count > 0
              and any(n.endswith("SKILL.md") for n in names)
              and not any("__pycache__" in n for n in names),
              "package-skill builds a valid archive with SKILL.md and no __pycache__")
    else:
        fail("package-skill produced a valid archive", "zip missing or corrupt")

    # (2) Symlink hardening: build a synthetic skill tree with an outside
    #     secret + a file symlink + a directory symlink pointing at it, plus a
    #     legitimate in-root regular file.
    sroot = os.path.join(tmpdir, "synthparent", "skill")
    outside = os.path.join(tmpdir, "outside")
    os.makedirs(sroot)
    os.makedirs(outside)
    with open(os.path.join(outside, "secret.txt"), "w") as f:
        f.write("SYNTHETIC-ZIP-SECRET")
    with open(os.path.join(sroot, "SKILL.md"), "w") as f:
        f.write("legit in-root content")
    link_ok = True
    try:
        os.symlink(os.path.join(outside, "secret.txt"),
                   os.path.join(sroot, "leaked.txt"))          # outside file link
        os.symlink(outside, os.path.join(sroot, "leakdir"))    # outside dir link
    except (OSError, NotImplementedError):
        link_ok = False  # platform without symlink support — skip link asserts

    hardened_zip = os.path.join(tmpdir, "hardened.zip")
    _, hskipped = package_skill.build_zip(sroot, hardened_zip)
    with zipfile.ZipFile(hardened_zip) as zf:
        hnames = zf.namelist()
        leaked = any(zf.read(n) == b"SYNTHETIC-ZIP-SECRET" for n in hnames)

    # In-root regular file is always packaged.
    check(any(n.endswith("SKILL.md") for n in hnames),
          "package-skill packages the legitimate in-root file")
    if link_ok:
        # Neither link name may appear as a member, and no member may carry
        # the outside secret's bytes.
        member_present = any(n.endswith("leaked.txt") for n in hnames)
        check(not member_present and not leaked and hskipped >= 2,
              "package-skill rejects file+dir symlinks (no outside-root bytes leak)")


# ── Main ────────────────────────────────────────────────────────────────
def main():
    tmpdir = tempfile.mkdtemp(prefix="vela-cli-exit-")

    def run_vela(*args):
        # cwd = tmpdir so _safe_resolve() and VELA_OUTPUT_DIR anchor on tmpdir.
        return subprocess.run([sys.executable, VELA_PY, *args],
                              capture_output=True, text=True, cwd=tmpdir)

    def write_json(name, obj):
        p = os.path.join(tmpdir, name)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)
        return p

    try:
        # ══ Exit-code constants sanity ══════════════════════════════════
        print("\n── Exit-code constants ──")
        check((EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_NOT_FOUND,
               EXIT_VALIDATION, EXIT_CONFLICT) == (0, 1, 2, 3, 4, 5),
              "vela.py exit-code constants are 0/1/2/3/4/5")

        # ══ deck extract ════════════════════════════════════════════════
        print("\n── deck extract ──")
        embedded = {"deckTitle": "Extracted Deck", "lanes": [{"title": "Main", "items": [
            {"title": "M", "status": "done", "importance": "must",
             "slides": [{"bg": "#000000", "duration": 5, "blocks": [{"type": "heading", "text": "Hi"}]}]}]}]}
        jsx_path = os.path.join(tmpdir, "artifact.jsx")
        with open(jsx_path, "w", encoding="utf-8") as f:
            f.write("const FOO = 1;\nconst STARTUP_PATCH = "
                    + json.dumps(embedded, ensure_ascii=False) + ";\nconst BAR = 2;\n")
        out_vela = os.path.join(tmpdir, "extracted.vela")
        r = run_vela("deck", "extract", jsx_path, out_vela)
        check_exit(r, EXIT_OK, "deck extract (happy)")
        if os.path.exists(out_vela):
            with open(out_vela, encoding="utf-8") as f:
                got = json.load(f)
            check(got.get("deckTitle") == "Extracted Deck",
                  "deck extract wrote the embedded STARTUP_PATCH deck")
        else:
            fail("deck extract wrote the embedded STARTUP_PATCH deck", "output file missing")

        # failure: a .jsx with no STARTUP_PATCH marker -> not found
        nopatch = os.path.join(tmpdir, "nopatch.jsx")
        with open(nopatch, "w", encoding="utf-8") as f:
            f.write("const X = 42;\n")
        r = run_vela("deck", "extract", nopatch)
        check_exit(r, EXIT_NOT_FOUND, "deck extract, no STARTUP_PATCH (failure)")
        # failure: source file does not exist
        r = run_vela("deck", "extract", os.path.join(tmpdir, "ghost.jsx"))
        check_exit(r, EXIT_NOT_FOUND, "deck extract, missing source file")
        # failure: missing arg
        r = run_vela("deck", "extract")
        check_exit(r, EXIT_USAGE, "deck extract, no args")

        # ══ deck assemble (CLI wrapper) ═════════════════════════════════
        print("\n── deck assemble (CLI wrapper) ──")
        good = write_json("good.json", _good_deck())
        asm_out = os.path.join(tmpdir, "assembled.jsx")
        r = run_vela("deck", "assemble", good, "--output", asm_out)
        check_exit(r, EXIT_OK, "deck assemble (happy)")
        check(os.path.exists(asm_out) and os.path.getsize(asm_out) > 100000,
              "deck assemble produced a JSX artifact with injected deck")
        if os.path.exists(asm_out):
            with open(asm_out, encoding="utf-8") as f:
                head = f.read()
            check("const STARTUP_PATCH = null;" not in head
                  and "CLI Exit-Code Deck" in head,
                  "assembled JSX has STARTUP_PATCH marker replaced with the deck")
        # failure: missing deck path -> usage
        r = run_vela("deck", "assemble")
        check_exit(r, EXIT_USAGE, "deck assemble, no args")
        # failure: nonexistent deck file -> not found (via _load_deck)
        r = run_vela("deck", "assemble", os.path.join(tmpdir, "ghost.json"))
        check_exit(r, EXIT_NOT_FOUND, "deck assemble, missing deck file")

        # ══ deck ship ═══════════════════════════════════════════════════
        print("\n── deck ship ──")
        ship_src = write_json("ship.json", _good_deck())
        ship_out = os.path.join(tmpdir, "ship-out.jsx")
        r = run_vela("deck", "ship", ship_src, "--output", ship_out)
        check_exit(r, EXIT_OK, "deck ship valid deck (happy)")
        check(os.path.exists(ship_out), "deck ship produced the JSX artifact")
        # failure: invalid deck fails validation -> EXIT_VALIDATION
        bad = write_json("bad-ship.json", _bad_deck())
        r = run_vela("deck", "ship", bad, "--output", os.path.join(tmpdir, "bad.jsx"))
        check_exit(r, EXIT_VALIDATION, "deck ship invalid deck (failure)")

        # ══ deck validate — exact codes ═════════════════════════════════
        print("\n── deck validate (exact exit codes) ──")
        r = run_vela("deck", "validate", write_json("v-good.json", _good_deck()))
        check_exit(r, EXIT_OK, "deck validate good deck")
        r = run_vela("deck", "validate", write_json("v-bad.json", _bad_deck()))
        check_exit(r, EXIT_VALIDATION, "deck validate bad deck")
        r = run_vela("deck", "validate")
        check_exit(r, EXIT_USAGE, "deck validate, no args")

        # ══ package-skill (dev tool, moved out of the shipped CLI) ═══════
        print("\n── package-skill (dev packager) ──")
        _check_package_skill(tmpdir)

        # ══ deck init ═══════════════════════════════════════════════════
        print("\n── deck init ──")
        init_path = os.path.join(tmpdir, "init.vela")
        r = run_vela("deck", "init", init_path, "--json", "--title", "My Deck",
                     "--palette", '{"$A":"#3b82f6"}',
                     "--themes", '{"d":{"b":"#0f172a","c":"#e2e8f0"}}',
                     "--sections", "Intro,Core,Close")
        check_exit(r, EXIT_OK, "deck init (happy)")
        if os.path.exists(init_path):
            with open(init_path, encoding="utf-8") as f:
                skel = json.load(f)
            check(skel.get("n") == "My Deck"
                  and skel.get("C") == {"$A": "#3b82f6"}
                  and "d" in skel.get("T", {})
                  and len(skel.get("G", [])) == 3
                  and [g["g"] for g in skel["G"]] == ["Intro", "Core", "Close"]
                  and all(g["S"] == [] for g in skel["G"]),
                  "deck init wrote skeleton with palette, themes, 3 empty sections")
        else:
            fail("deck init wrote skeleton", "file missing")
        # failure: no args -> usage
        r = run_vela("deck", "init")
        check_exit(r, EXIT_USAGE, "deck init, no args")

        # ══ slide append (needs a compact G/S deck) ═════════════════════
        print("\n── slide append ──")
        compact_slide = {"t": "d", "n": "Appended", "B": [{"_": "heading", "x": "Hello"}]}
        r = run_vela("slide", "append", init_path, "0", "--json", json.dumps(compact_slide))
        check_exit(r, EXIT_OK, "slide append into section 0 (happy)")
        with open(init_path, encoding="utf-8") as f:
            skel = json.load(f)
        check(len(skel["G"][0]["S"]) == 1 and skel["G"][0]["S"][0].get("n") == "Appended",
              "slide append landed in section 0")
        # happy: @file inline form
        sfile = write_json("appendme.json", {"t": "d", "n": "FromFile", "B": []})
        r = run_vela("slide", "append", init_path, "1", "@" + sfile)
        check_exit(r, EXIT_OK, "slide append via @file")
        with open(init_path, encoding="utf-8") as f:
            skel = json.load(f)
        check(len(skel["G"][1]["S"]) == 1, "slide append @file landed in section 1")
        # failure: section index out of range -> not found
        r = run_vela("slide", "append", init_path, "99", json.dumps(compact_slide))
        check_exit(r, EXIT_NOT_FOUND, "slide append, bad section index (failure)")
        # failure: deck with neither G nor S -> EXIT_FAIL
        noGS = write_json("noGS.vela", {"n": "empty"})
        r = run_vela("slide", "append", noGS, "0", json.dumps(compact_slide))
        check_exit(r, EXIT_FAIL, "slide append, deck has no G/S (failure)")
        # failure: @file path traversal -> usage (via _safe_resolve)
        r = run_vela("slide", "append", init_path, "0", "@../escape.json")
        check_exit(r, EXIT_USAGE, "slide append @file path traversal blocked")

        # ══ slide insert ════════════════════════════════════════════════
        print("\n── slide insert ──")
        ins_deck = write_json("insert-deck.json", _good_deck())
        before = _slide_count(ins_deck)  # 3
        new_slide = {"bg": "#123456", "duration": 12,
                     "blocks": [{"type": "heading", "text": "Inserted Slide"}]}
        new_slide_file = write_json("newslide.json", new_slide)
        r = run_vela("slide", "insert", ins_deck, "2", new_slide_file)
        check_exit(r, EXIT_OK, "slide insert after #2 (happy)")
        check(_slide_count(ins_deck) == before + 1, "slide insert grew slide count by 1")
        # verify it landed at index 3 (1-based) i.e. right after slide 2
        r = run_vela("slide", "view", ins_deck, "3", "--raw", "--json")
        if r.returncode == EXIT_OK:
            viewed = json.loads(r.stdout)
            check(viewed.get("blocks", [{}])[0].get("text") == "Inserted Slide",
                  "inserted slide is at position 3 (right after #2)")
        else:
            fail("inserted slide is at position 3", r.stderr)
        # failure: after_num out of range -> not found
        r = run_vela("slide", "insert", ins_deck, "99", new_slide_file)
        check_exit(r, EXIT_NOT_FOUND, "slide insert, bad after-num (failure)")
        # failure: slide file does not exist (but inside cwd) -> not found
        r = run_vela("slide", "insert", ins_deck, "1", os.path.join(tmpdir, "ghost.json"))
        check_exit(r, EXIT_NOT_FOUND, "slide insert, missing slide file")
        # failure: path traversal on the slide-file arg -> usage (_safe_resolve)
        r = run_vela("slide", "insert", ins_deck, "1", "../../../etc/passwd")
        check_exit(r, EXIT_USAGE, "slide insert path traversal blocked")
        # failure: too few args -> usage
        r = run_vela("slide", "insert", ins_deck, "1")
        check_exit(r, EXIT_USAGE, "slide insert, too few args")

        # ══ slide remove-block ══════════════════════════════════════════
        print("\n── slide remove-block ──")
        rb_deck = write_json("rmblock-deck.json", _good_deck())
        with open(rb_deck, encoding="utf-8") as f:
            slide1_blocks = json.load(f)["lanes"][0]["items"][0]["slides"][0]["blocks"]
        n_blocks = len(slide1_blocks)  # 3; block[0] is the badge
        r = run_vela("slide", "remove-block", rb_deck, "1", "0")
        check_exit(r, EXIT_OK, "slide remove-block (happy)")
        with open(rb_deck, encoding="utf-8") as f:
            after_blocks = json.load(f)["lanes"][0]["items"][0]["slides"][0]["blocks"]
        check(len(after_blocks) == n_blocks - 1
              and after_blocks[0].get("type") == "heading",
              "remove-block dropped block[0] (badge); heading now first")
        # failure: block index out of range -> not found
        r = run_vela("slide", "remove-block", rb_deck, "1", "99")
        check_exit(r, EXIT_NOT_FOUND, "slide remove-block, bad block index (failure)")
        # failure: slide out of range -> not found
        r = run_vela("slide", "remove-block", rb_deck, "99", "0")
        check_exit(r, EXIT_NOT_FOUND, "slide remove-block, bad slide index")
        # failure: too few args -> usage
        r = run_vela("slide", "remove-block", rb_deck, "1")
        check_exit(r, EXIT_USAGE, "slide remove-block, too few args")

        # ══ _safe_resolve path-traversal guard (security control) ═══════
        print("\n── path-traversal guard (_safe_resolve) ──")
        # Absolute escape outside cwd
        r = run_vela("slide", "insert", ins_deck, "1", "/etc/passwd")
        check_exit(r, EXIT_USAGE, "absolute path outside cwd blocked")
        # Relative ../ escape
        r = run_vela("slide", "append", init_path, "0", "@../../secret.json")
        check_exit(r, EXIT_USAGE, "relative ../ traversal blocked")

        # ══ routing usage errors — exact code ═══════════════════════════
        print("\n── routing usage errors ──")
        r = run_vela("bogus", "action")
        check_exit(r, EXIT_USAGE, "unknown resource")
        r = run_vela("deck", "nope")
        check_exit(r, EXIT_USAGE, "unknown action")
        r = run_vela("deck")
        check_exit(r, EXIT_USAGE, "resource with no action")
        # deck find with no filters -> usage
        r = run_vela("deck", "find", good)
        check_exit(r, EXIT_USAGE, "deck find with no filters")

        # ══ EXIT_CONFLICT (5) — deck init overwrite guard ═══════════════
        print("\n── EXIT_CONFLICT (5): deck init overwrite guard ──")
        # init over an existing file without --force must conflict (exit 5) and
        # leave the existing deck untouched.
        r = run_vela("deck", "init", init_path, "--title", "Clobber")
        check_exit(r, EXIT_CONFLICT, "deck init over existing file without --force (conflict)")
        with open(init_path, encoding="utf-8") as f:
            check(json.load(f).get("n") == "My Deck",
                  "deck init conflict left the existing file intact")
        # --force overwrites (throwaway path so init_path stays as-is)
        force_path = os.path.join(tmpdir, "force.vela")
        with open(force_path, "w", encoding="utf-8") as f:
            f.write('{"n":"old"}')
        r = run_vela("deck", "init", force_path, "--force", "--title", "Fresh")
        check_exit(r, EXIT_OK, "deck init --force over existing file")
        with open(force_path, encoding="utf-8") as f:
            check(json.load(f).get("n") == "Fresh", "deck init --force overwrote the file")

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(f"\n{'=' * 50}")
    print(f"CLI exit-code suite: {_passed} passed, {_failed} failed")
    sys.exit(1 if _failed else 0)


if __name__ == "__main__":
    main()
