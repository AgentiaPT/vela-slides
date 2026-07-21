package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// newTestStore builds a store rooted at a fresh temp home, with a temp decks
// folder already selected. Returns the store and the folder path (forward-slash).
func newTestStore(t *testing.T) (*store, string) {
	t.Helper()
	home := t.TempDir()
	s := newStore(home)
	folder := filepath.Join(t.TempDir(), "decks")
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := s.setFolder(folder); err != nil {
		t.Fatalf("setFolder(%q) failed: %v", folder, err)
	}
	return s, filepath.ToSlash(folder)
}

func TestSetFolderRejectsUnsafeRoots(t *testing.T) {
	s := newStore(t.TempDir())
	for _, bad := range []string{"/", "/etc", "/usr", "C:", ""} {
		if _, err := s.setFolder(bad); err == nil {
			t.Fatalf("setFolder(%q) must be rejected", bad)
		}
	}
	// A normal nested folder is accepted.
	folder := filepath.Join(t.TempDir(), "decks")
	os.MkdirAll(folder, 0o755)
	if _, err := s.setFolder(folder); err != nil {
		t.Fatalf("nested folder must be accepted: %v", err)
	}
	// A non-existent folder is rejected.
	if _, err := s.setFolder(filepath.Join(t.TempDir(), "does-not-exist")); err == nil {
		t.Fatal("non-existent folder must be rejected")
	}
}

func TestReadSaveList(t *testing.T) {
	s, folder := newTestStore(t)
	os.WriteFile(filepath.FromSlash(folder+"/a.vela"), []byte(`{"deckTitle":"A"}`), 0o644)
	os.WriteFile(filepath.FromSlash(folder+"/b.json"), []byte(`{}`), 0o644)
	os.WriteFile(filepath.FromSlash(folder+"/skip.txt"), []byte(`x`), 0o644)

	names, err := s.listDecks()
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 2 || names[0] != "a.vela" || names[1] != "b.json" {
		t.Fatalf("listDecks = %v, want [a.vela b.json]", names)
	}

	content, err := s.readDeck("a.vela")
	if err != nil || !strings.Contains(content, `"A"`) {
		t.Fatalf("readDeck failed: %q %v", content, err)
	}

	if err := s.saveDeck("c.vela", `{"deckTitle":"C"}`); err != nil {
		t.Fatalf("saveDeck failed: %v", err)
	}
	got, _ := os.ReadFile(filepath.FromSlash(folder + "/c.vela"))
	if !strings.Contains(string(got), `"C"`) {
		t.Fatalf("saved content wrong: %q", got)
	}
}

func TestSaveEnforcesExtensionAllowlist(t *testing.T) {
	s, _ := newTestStore(t)
	for _, bad := range []string{"evil.sh", "evil.js", "noext", "evil.tmp"} {
		if err := s.saveDeck(bad, "x"); err == nil {
			t.Fatalf("saveDeck(%q) must be rejected by the extension allowlist", bad)
		}
	}
	for _, ok := range []string{"good.vela", "good.json"} {
		if err := s.saveDeck(ok, "{}"); err != nil {
			t.Fatalf("saveDeck(%q) must be allowed: %v", ok, err)
		}
	}
}

func TestReadSaveRejectTraversal(t *testing.T) {
	s, _ := newTestStore(t)
	for _, bad := range []string{"../secret.vela", "..\\secret.vela", "/etc/passwd", "sub/deck.vela"} {
		if _, err := s.readDeck(bad); err == nil {
			t.Fatalf("readDeck(%q) must be rejected", bad)
		}
		if err := s.saveDeck(bad, "{}"); err == nil {
			t.Fatalf("saveDeck(%q) must be rejected", bad)
		}
	}
}

func TestNewDeckSlugAndDedupe(t *testing.T) {
	s, folder := newTestStore(t)
	n1, err := s.newDeck("My Deck")
	if err != nil || n1 != "My-Deck.vela" {
		t.Fatalf("newDeck #1 = %q %v, want My-Deck.vela", n1, err)
	}
	n2, err := s.newDeck("My Deck")
	if err != nil || n2 != "My-Deck-2.vela" {
		t.Fatalf("newDeck #2 = %q %v, want My-Deck-2.vela", n2, err)
	}
	if _, err := os.Stat(filepath.FromSlash(folder + "/My-Deck.vela")); err != nil {
		t.Fatalf("new deck file must exist: %v", err)
	}
	// Empty title falls back to Untitled.
	n3, _ := s.newDeck("")
	if n3 != "Untitled.vela" {
		t.Fatalf("empty title = %q, want Untitled.vela", n3)
	}
}

func TestSymlinkEscapeRejected(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink semantics differ on Windows")
	}
	s, folder := newTestStore(t)
	// Create a secret file OUTSIDE the folder and a symlink to it INSIDE.
	secret := filepath.Join(t.TempDir(), "secret.vela")
	os.WriteFile(secret, []byte("TOPSECRET"), 0o644)
	link := filepath.FromSlash(folder + "/link.vela")
	if err := os.Symlink(secret, link); err != nil {
		t.Skipf("cannot create symlink: %v", err)
	}
	if _, err := s.readDeck("link.vela"); err == nil {
		t.Fatal("reading through an escaping symlink must be rejected")
	}
	if err := s.saveDeck("link.vela", "x"); err == nil {
		t.Fatal("writing through an escaping symlink must be rejected")
	}
}

func TestConfigRoundTrip(t *testing.T) {
	s, _ := newTestStore(t)
	// Missing config → empty string (caller applies defaults).
	if c, err := s.readConfig(); err != nil || c != "" {
		t.Fatalf("missing config: %q %v", c, err)
	}
	if err := s.writeConfig(`{"agent":"claude-code"}`); err != nil {
		t.Fatal(err)
	}
	c, err := s.readConfig()
	if err != nil || !strings.Contains(c, "claude-code") {
		t.Fatalf("config round trip failed: %q %v", c, err)
	}
	// Written under ~/.vela, atomically (no leftover .tmp).
	if _, err := os.Stat(filepath.FromSlash(s.configPath() + ".tmp")); err == nil {
		t.Fatal("atomic write left a .tmp file behind")
	}
}

func TestTrustRoundTrip(t *testing.T) {
	s, folder := newTestStore(t)
	if c, _ := s.readTrust(); c != "" {
		t.Fatal("missing trust must read empty")
	}
	if err := s.writeTrust(`{"_v":1,"decks":{"a.vela":{"at":"now"}}}`); err != nil {
		t.Fatal(err)
	}
	c, _ := s.readTrust()
	if !strings.Contains(c, "a.vela") {
		t.Fatalf("trust round trip failed: %q", c)
	}
	// Lives under <folder>/.vela/trust.json.
	if _, err := os.Stat(filepath.FromSlash(folder + "/.vela/trust.json")); err != nil {
		t.Fatalf("trust.json must be under the folder's .vela: %v", err)
	}
}

func TestWatchChangeDetectionAndEchoSuppression(t *testing.T) {
	s, folder := newTestStore(t)
	os.WriteFile(filepath.FromSlash(folder+"/w.vela"), []byte(`{"v":1}`), 0o644)
	s.setCurrent("w.vela")
	// No change yet.
	if changed, _ := s.checkChanged(); changed {
		t.Fatal("no change should be reported immediately after setCurrent")
	}
	// Our own save is an echo → suppressed.
	if err := s.saveDeck("w.vela", `{"v":2}`); err != nil {
		t.Fatal(err)
	}
	if changed, _ := s.checkChanged(); changed {
		t.Fatal("our own write must be echo-suppressed")
	}
	// An external edit AFTER the debounce window → reported once.
	time.Sleep((watcherIgnoreMS + 60) * time.Millisecond)
	os.WriteFile(filepath.FromSlash(folder+"/w.vela"), []byte(`{"v":3,"ext":true}`), 0o644)
	changed, name := s.checkChanged()
	if !changed || name != "w.vela" {
		t.Fatalf("external edit must be reported: changed=%v name=%q", changed, name)
	}
	// Reported only once — baseline advanced.
	if changed, _ := s.checkChanged(); changed {
		t.Fatal("external edit must be reported at most once")
	}
}

func TestAgentHandshakeRelay(t *testing.T) {
	s := newStore(t.TempDir())
	os.MkdirAll(filepath.FromSlash(s.homeVela), 0o700)
	os.WriteFile(filepath.FromSlash(s.homeVela+"/agent-ext-45999.port"), []byte("60123\n"), 0o600)
	os.WriteFile(filepath.FromSlash(s.homeVela+"/agent-ext-45999.token"), []byte("abctoken\n"), 0o600)
	hs := readAgentHandshake(s.homeVela, "45999")
	if hs == nil || hs["port"] != "60123" || hs["token"] != "abctoken" {
		t.Fatalf("agent handshake relay = %v", hs)
	}
	// Missing → nil.
	if readAgentHandshake(t.TempDir(), "1") != nil {
		t.Fatal("missing agent handshake must relay nil")
	}
}
