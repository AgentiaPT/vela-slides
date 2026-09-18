#!/usr/bin/env python3
# © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
"""Canonical output encoder for deck text that reaches a terminal or a log.

WHY THIS EXISTS
---------------
Deck JSON is untrusted (CLAUDE.md / docs/SECURITY.md). Every read-only CLI
command prints deck-supplied strings — titles, block text, validation messages.
A terminal emulator interprets C0/C1 control bytes in those strings as
commands, so an inspected deck could repaint the operator's screen: window-title
spoofing, cursor addressing that forges earlier output, hyperlink relabeling,
and clipboard writes where the emulator enables them. Unicode format characters
(bidi overrides, zero-width) add the display-spoofing half of the same class:
what the operator reads stops matching what the file holds.

This is CWE-150 (Improper Neutralization of Escape, Meta, or Control Sequences).
`serve.py` already defends its own listing label for exactly this reason; the
CLI had no equivalent, which is the gap this module closes.

DESIGN RULES (each one is load-bearing — see the comments at each guard)
  * ESCAPE, never silently strip. A strip is lossy, so two different decks can
    render identically and an attacker picks the collision. An escape keeps the
    strings distinct AND makes the attempt visible. Caret notation (`^[`) is the
    form `less` and `cat -v` already use, so it reads as "control byte" to
    anyone who has inspected a binary file.
  * ALLOWLIST by Unicode general category, not a denylist of known sequences.
    A regex that matches `ESC [ ... m` is defeated by a split or novel sequence;
    a category test has no such gap.
  * ONE PASS. Escaping twice double-escapes, and a second pass over already
    encoded text is how bypasses appear (secure-coding skill §3.6).
  * TYPE-CHECK FIRST, COERCE NEVER. A non-string deck value returns the
    fallback; `str(v)` on an attacker-shaped object is not a safety net.
  * ESCAPE AND WIDTH-CAP TOGETHER. An escape-free string is still a screen
    flood, and capping after escaping can cut an escape in half.

TWO POLICIES, CHOSEN BY SINK — do not merge them:
  * `term_text`  — CONTENT sinks (block text, slide dumps, validation messages).
    No NFKC and no whitespace collapse: NFKC is lossy for legitimate authored
    content (it rewrites `mc²`→`mc2`, `∀x∈ℝ`→`∀x∈R`, `½`→`1⁄2`), and combining
    marks are load-bearing in many scripts (Devanagari, Thai, Vietnamese).
  * `term_label` — IDENTITY sinks (the one-line deck/slide label in a table row).
    Adds NFKC folding and whitespace collapse, because there spoofing
    resistance matters more than typographic fidelity — the same trade-off
    `serve.py::_display_label` makes for the web listing.

NOT a data-path transform. `deck extract-text` → `patch-text` is a round-trip
edit; encoding on that path would write corruption back into the deck. Encode
at the DISPLAY sink only.
"""

import unicodedata

# Categories that may never reach a terminal. Expressed as a category test
# rather than a character list because the list is unbounded and grows with each
# Unicode release:
#   Cc — C0 controls, DEL, and the C1 range (0x80-0x9F). C1 matters: 0x9B is the
#        8-bit CSI introducer and several emulators honor it inside UTF-8 text.
#   Cf — format characters. This is the bidi-override / zero-width class
#        (Trojan Source): text that renders in a different order than it is
#        stored, or hides entirely.
#   Co — private use. Font-dependent arbitrary glyphs; used to forge icons.
#   Cn — unassigned. Renders as tofu now, as something else on a newer font.
#   Zl/Zp — line and paragraph separators; they break single-line layout.
_ESCAPE_CATEGORIES = frozenset(("Cc",))
_DROP_CATEGORIES = frozenset(("Cf", "Co", "Cn", "Zl", "Zp"))

# Cc characters that carry real layout meaning and are safe to keep in a
# multi-line content sink. CR is deliberately NOT here: it returns the cursor to
# column zero, which overwrites a line the operator already read, and no deck
# value has a legitimate use for it. (GitHub CLI's sanitizer does pass CR; this
# is a considered deviation, because Vela prints fixed-width single-line rows.)
_KEEP_IN_TEXT = ("\n", "\t")

# Glyphs that render blank but are NOT str.isspace(), so `" ".join(s.split())`
# leaves them intact. A run of these pushes a label's real suffix off the row
# just as effectively as spaces. Mirrors serve.py::_BLANK_GLYPHS.
_BLANK_GLYPHS = "᠎⠀ᅟᅠㅤﾠ឴឵"

# Combining marks are legitimate (Devanagari, Thai, Vietnamese, emoji variation
# selectors) but an unbounded run stacks glyphs outside the intended cell
# ("Zalgo"). Cap the run instead of dropping the class.
_MAX_COMBINING_RUN = 2

# Zero-width joiner is category Cf, so the rule above would escape it and break
# every multi-part emoji (a common, harmless thing in a deck title). It is only
# admitted BETWEEN two non-ASCII characters — i.e. joining pictographs — which
# is where it is legitimate. Adjacent to ASCII it is an invisible separator used
# to break up a word, so there it stays escaped.
_ZWJ = "‍"

_DEFAULT_TEXT_MAX = 50000
_DEFAULT_LABEL_MAX = 200
_ELLIPSIS = "…"


def _escape(ch):
    """Caret notation for a control byte, matching `less`/`cat -v` convention."""
    code = ord(ch)
    if code < 0x20:
        return "^" + chr(code + 0x40)      # 0x00->^@ … 0x1F->^_
    if code == 0x7F:
        return "^?"                         # DEL
    return "^" + chr(code - 0x40)           # C1 0x80->^@ … 0x9F->^_ (0x9B->^[)


def _encode(value, fallback, max_len, keep_ws, fold):
    """Single-pass encoder shared by term_text and term_label.

    `keep_ws` decides whether newline/tab survive; `fold` turns on the
    identity-sink behaviour (NFKC + whitespace collapse).
    """
    # TYPE-CHECK FIRST (secure-coding §3.2). A non-string deck value — a dict
    # with a crafted __str__, a list, a number — must not be coerced into the
    # encoder; it is simply not a displayable value.
    if not isinstance(value, str):
        return fallback

    # Fast path for the overwhelmingly common case. isprintable() is False for
    # every Cc and Cf codepoint, so this can only short-circuit strings that the
    # slow path would have returned unchanged anyway — it cannot open a hole.
    if value.isascii() and value.isprintable():
        out = value
        return _clip(out, max_len) if out else fallback

    if fold:
        # Canonicalize BEFORE filtering, so a compatibility form cannot smuggle
        # a character past a test aimed at its canonical twin. Only on the
        # identity path — NFKC is lossy for authored content (see module docs).
        value = unicodedata.normalize("NFKC", value)

    out = []
    combining_run = 0
    last_index = len(value) - 1
    for i, ch in enumerate(value):
        category = unicodedata.category(ch)

        if keep_ws and ch in _KEEP_IN_TEXT:
            out.append(ch)
            combining_run = 0
            continue

        if ch in _BLANK_GLYPHS:
            out.append(" ")
            combining_run = 0
            continue

        if ch == _ZWJ and 0 < i < last_index \
                and not value[i - 1].isascii() and not value[i + 1].isascii():
            out.append(ch)          # emoji joiner between pictographs — keep
            continue

        if category in _ESCAPE_CATEGORIES:
            out.append(_escape(ch))
            combining_run = 0
            continue

        if category in _DROP_CATEGORIES:
            # Format/private-use/unassigned have no visible form to preserve, so
            # there is nothing to make visible by escaping — drop them. The
            # bidi class is the reason: keeping them would reorder the display.
            combining_run = 0
            continue

        if category == "Cs":
            # Lone surrogate — ill-formed in UTF-8. Fail closed on the whole
            # value rather than emit a half-decoded string.
            return fallback

        if category in ("Mn", "Me"):
            combining_run += 1
            if combining_run > _MAX_COMBINING_RUN:
                continue
        else:
            combining_run = 0

        out.append(ch)

    result = "".join(out)
    if fold:
        result = " ".join(result.split())
    return _clip(result, max_len) or fallback


def _clip(text, max_len):
    """Bound the width in the same pass that escaped it.

    A value with no control characters is still a screen flood, and clipping
    after the caller has composed a line can cut a caret pair in half.
    """
    if max_len is None or len(text) <= max_len:
        return text
    return text[: max(0, max_len - 1)] + _ELLIPSIS


def term_text(value, fallback="", max_len=_DEFAULT_TEXT_MAX):
    """Encode deck text bound for a CONTENT sink. Keeps newline and tab."""
    return _encode(value, fallback, max_len, keep_ws=True, fold=False)


def term_label(value, fallback="?", max_len=_DEFAULT_LABEL_MAX):
    """Encode a deck value used as a one-line IDENTITY label (table rows)."""
    return _encode(value, fallback, max_len, keep_ws=False, fold=True)


class Untrusted:
    """A deck-supplied string whose DEFAULT rendering is already encoded.

    Carrying a deck value in this type makes the safe path the automatic one:
    `f"{value}"`, `"{}".format(value)`, `str(value)` and `print(value)` all go
    through `term_text`. The raw bytes are reachable only through `.raw`, which
    is deliberately easy to grep for and is for non-display uses (writing the
    value back to a deck file, hashing, comparison) — never for a terminal.
    """

    __slots__ = ("_raw",)

    def __init__(self, value):
        self._raw = value

    @property
    def raw(self):
        """The original value. Never pass this to a terminal sink."""
        return self._raw

    def __str__(self):
        return term_text(self._raw)

    def __format__(self, spec):
        # Apply the caller's format spec to the ENCODED text, so width and
        # alignment in an f-string cannot be computed from unencoded input.
        return format(term_text(self._raw), spec)

    def __repr__(self):
        return "Untrusted(%r)" % (term_text(self._raw),)

    def __bool__(self):
        return bool(self._raw)
