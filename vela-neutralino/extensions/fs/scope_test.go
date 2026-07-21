package main

import "testing"

func TestNormPath(t *testing.T) {
	cases := map[string]string{
		`C:\Users\me\decks\`:   "C:/Users/me/decks",
		"/home/me/decks/":      "/home/me/decks",
		"/home/me/decks///":    "/home/me/decks",
		"/":                    "",
		"":                     "",
		`\\server\share\x`:     "//server/share/x",
	}
	for in, want := range cases {
		if got := normPath(in); got != want {
			t.Fatalf("normPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidRootRejectsVolumeShallowSystem(t *testing.T) {
	reject := []string{
		"", "/", "C:", "z:", "//server", // volume roots
		"/etc", "/usr", "/home", "/var", "/tmp", "/root", "/opt", // shallow single-segment
		"/etc/cron.d", "/usr/local/bin", "/var/spool/cron", // system subtrees (depth>=2)
		"c:/windows/system32", "c:/program files/x",
	}
	for _, p := range reject {
		if validRoot(normPath(p)) {
			t.Fatalf("validRoot(%q) must be false", p)
		}
	}
	accept := []string{
		"/home/me/decks", "/home/me/.vela", "/Users/me/Documents/decks",
		"/root/.vela", "C:/Users/me/decks", "/mnt/data/decks",
	}
	for _, p := range accept {
		if !validRoot(normPath(p)) {
			t.Fatalf("validRoot(%q) must be true", p)
		}
	}
}

func TestHomeVelaIsAcceptedRoot(t *testing.T) {
	// /home/<user>/.vela must be accepted (home roots are NOT denylisted).
	for _, p := range []string{"/home/alice/.vela", "/Users/bob/.vela", "/root/.vela"} {
		if !validRoot(normPath(p)) {
			t.Fatalf("home ~/.vela root %q must be accepted", p)
		}
	}
}

func TestUnderRoot(t *testing.T) {
	roots := []string{"/home/me/decks", "/home/me/.vela"}
	ok := []string{"/home/me/decks", "/home/me/decks/a.vela", "/home/me/.vela/config.json"}
	for _, p := range ok {
		if !underRoot(roots, p) {
			t.Fatalf("underRoot(%q) must be true", p)
		}
	}
	bad := []string{
		"/home/me/decksX/a.vela",              // sibling prefix, not under root
		"/home/me/decks/../../etc/passwd",     // traversal
		"/etc/passwd",                          // outside
		"/home/me/decks/../secret",             // traversal one level
		"",                                     // empty
	}
	for _, p := range bad {
		if underRoot(roots, p) {
			t.Fatalf("underRoot(%q) must be false", p)
		}
	}
}

func TestSafeBasename(t *testing.T) {
	for _, ok := range []string{"deck.vela", "my-deck.json", "a.b.vela", "Deck_1.vela"} {
		if _, err := safeBasename(ok); err != nil {
			t.Fatalf("safeBasename(%q) must be ok, got %v", ok, err)
		}
	}
	for _, bad := range []string{
		"", ".", "..", "../x", "a/b", `a\b`, "/etc/passwd", `C:\x`, "C:x",
		"..\\x", "foo/../bar", "a\x00b", "x/..", ":evil",
	} {
		if _, err := safeBasename(bad); err == nil {
			t.Fatalf("safeBasename(%q) must be rejected", bad)
		}
	}
}

func TestAllowedSaveExt(t *testing.T) {
	for _, ok := range []string{"a.vela", "a.json", "A.VELA", "deck.JSON"} {
		if !allowedSaveExt(ok) {
			t.Fatalf("allowedSaveExt(%q) must be true", ok)
		}
	}
	for _, bad := range []string{"a.sh", "a.js", "noext", "a.tmp", "a.vela.tmp", "a.jsonx", ".vela.bak"} {
		if allowedSaveExt(bad) {
			t.Fatalf("allowedSaveExt(%q) must be false", bad)
		}
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"My Deck":            "My-Deck",
		"  spaced  out  ":    "spaced-out",
		"weird***chars!!!":   "weirdchars",
		"":                   "Untitled",
		"---":                "Untitled",
		"a/b\\c":             "abc",
		"multi   space":      "multi-space",
	}
	for in, want := range cases {
		if got := slugify(in); got != want {
			t.Fatalf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
}
