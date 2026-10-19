#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""validate.py: a gradient in slide bg must be reported (CR2)."""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VALIDATE = os.path.join(os.path.dirname(HERE), "skills", "vela-slides", "scripts", "validate.py")


def deck(**slide):
    s = {"duration": 60, "color": "#E6F1FF", "blocks": [{"type": "heading", "text": "Hi"}]}
    s.update(slide)
    return {"deckTitle": "T", "lanes": [{"title": "L", "items": [{"title": "I", "slides": [s]}]}]}


def run(d):
    with tempfile.TemporaryDirectory() as t:
        p = os.path.join(t, "d.vela")
        with open(p, "w") as f:
            json.dump(d, f)
        r = subprocess.run([sys.executable, VALIDATE, p], capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr


fails = 0


def check(ok, name):
    global fails
    print(("PASS " if ok else "FAIL ") + name)
    fails += 0 if ok else 1


G = "linear-gradient(135deg, #0f172a, #1e293b)"
rc, out = run(deck(bg="#0A0F1C"))
check(rc == 0, "solid bg passes")
rc, out = run(deck(bg="#0A0F1C", bgGradient=G))
check(rc == 0, "bgGradient passes")
rc, out = run(deck(bg=G))
check(rc != 0, "gradient in bg fails")
check("L1/I1/S1" in out and "bgGradient" in out, "message names slide and bgGradient")
rc, out = run(deck(bg="#0A0F1C", bgGradient="linear-gradient(red; url(x))"))
check(rc == 0 and "bgGradient" in out, "invalid bgGradient only warns")
if fails:
    print(f"{fails} failed")
    sys.exit(1)
print("all passed")
