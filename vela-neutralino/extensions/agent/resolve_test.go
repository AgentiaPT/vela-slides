// Behavioural tests for the path-confinement service (resolve.go).
//
// These build real links on disk rather than mocking the filesystem — the whole
// point of the endpoint is that string logic cannot answer the question, so a
// test that only exercised string logic would prove nothing.
//
// Run: `go test ./...` from vela-neutralino/extensions/agent.

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// mkSymlink creates a link, skipping the test when the platform refuses (an
// unprivileged Windows runner without Developer Mode cannot create symlinks).
func mkSymlink(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink unsupported on this Windows runner: %v", err)
		}
		t.Fatalf("symlink %s -> %s: %v", link, target, err)
	}
}

// buildTree lays out the shape this endpoint exists to detect:
//
//	root/            ← the "decks folder" the guard has allowed
//	  real.vela      ← an ordinary deck
//	  sub/inner.vela ← an ordinary deck one level down
//	  escape.vela    → outside/secret.txt      (file link out of the root)
//	  outdir/        → outside/                (directory link out of the root)
//	outside/secret.txt
func buildTree(t *testing.T) (root, outside string) {
	t.Helper()
	base := t.TempDir()
	root = filepath.Join(base, "root")
	outside = filepath.Join(base, "outside")
	for _, d := range []string{root, outside, filepath.Join(root, "sub")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range [][2]string{
		{filepath.Join(root, "real.vela"), `{"deckTitle":"real"}`},
		{filepath.Join(root, "sub", "inner.vela"), `{"deckTitle":"inner"}`},
		{filepath.Join(outside, "secret.txt"), "secret"},
	} {
		if err := os.WriteFile(f[0], []byte(f[1]), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	mkSymlink(t, filepath.Join(outside, "secret.txt"), filepath.Join(root, "escape.vela"))
	mkSymlink(t, outside, filepath.Join(root, "outdir"))
	return root, outside
}

func entryFor(t *testing.T, root string, names ...string) map[string]resolveEntry {
	t.Helper()
	res, err := checkNames(root, names)
	if err != nil {
		t.Fatalf("checkNames: %v", err)
	}
	return res.Entries
}

func TestOrdinaryDecksStayInsideTheRoot(t *testing.T) {
	root, _ := buildTree(t)
	got := entryFor(t, root, "real.vela", "sub/inner.vela")
	for name, e := range got {
		if !e.OK {
			t.Fatalf("%s should be inside the root, got error %q", name, e.Error)
		}
	}
}

func TestFileLinkOutOfRootIsRefused(t *testing.T) {
	// The reported issue: lexically inside the folder, physically outside.
	root, _ := buildTree(t)
	e := entryFor(t, root, "escape.vela")["escape.vela"]
	if e.OK || e.Error != "escapes" {
		t.Fatalf("file link out of the root was accepted: %+v", e)
	}
}

func TestDirectoryLinkOutOfRootIsRefused(t *testing.T) {
	// The nastier variant — it silently relocates listing and saving, and a
	// per-file approval model would not catch it either.
	root, _ := buildTree(t)
	e := entryFor(t, root, "outdir/secret.txt")["outdir/secret.txt"]
	if e.OK || e.Error != "escapes" {
		t.Fatalf("path through a directory link was accepted: %+v", e)
	}
}

func TestTraversalIsRefused(t *testing.T) {
	root, _ := buildTree(t)
	e := entryFor(t, root, "../outside/secret.txt")["../outside/secret.txt"]
	if e.OK {
		t.Fatal("traversal out of the root was accepted")
	}
}

func TestTrailingSlashCannotEscape(t *testing.T) {
	// openat(fd, path, O_NOFOLLOW) follows a symlink when the path ends in "/",
	// and os.Root did not account for that until recently (CVE-2026-39822).
	// sanitizeName strips the separator so this does not depend on the
	// toolchain's patch level.
	root, _ := buildTree(t)
	for _, name := range []string{"escape.vela/", "outdir/"} {
		if entryFor(t, root, name)[name].OK {
			t.Fatalf("%q escaped via a trailing separator", name)
		}
	}
}

func TestAbsoluteNamesAreRefused(t *testing.T) {
	// os.Root takes root-relative names. Accepting an absolute one and guessing
	// what it meant is how confinement bugs start.
	root, outside := buildTree(t)
	abs := filepath.Join(outside, "secret.txt")
	e := entryFor(t, root, abs)[abs]
	if e.OK || e.Error != "invalid" {
		t.Fatalf("absolute name was not refused: %+v", e)
	}
}

func TestMissingDeckIsDistinguishableFromAnEscape(t *testing.T) {
	// A deleted deck is not an attack. Collapsing the two would either brick
	// normal use or teach users to click through a real warning.
	root, _ := buildTree(t)
	e := entryFor(t, root, "nope.vela")["nope.vela"]
	if e.OK || e.Error != "missing" {
		t.Fatalf("missing deck reported as %+v, want error \"missing\"", e)
	}
}

func TestUnusableRootFailsClosed(t *testing.T) {
	// If confinement cannot be established at all, every name is refused —
	// never silently accepted.
	got := entryFor(t, filepath.Join(t.TempDir(), "not-a-folder"), "a.vela")
	if got["a.vela"].OK {
		t.Fatal("names under an unopenable root were accepted")
	}
}

func TestErrorsCarryNoHostDetail(t *testing.T) {
	// Error strings travel back to a webview that may be under attacker
	// control; they must never become a disclosure channel. Raw OS errors embed
	// absolute paths, so only the fixed vocabulary may cross the wire.
	root, _ := buildTree(t)
	allowed := map[string]bool{"": true, "missing": true, "escapes": true, "invalid": true}
	for name, e := range entryFor(t, root, "real.vela", "escape.vela", "nope.vela", "/abs") {
		if !allowed[e.Error] {
			t.Fatalf("%s produced a free-form error %q", name, e.Error)
		}
	}
}

func TestRevealResolvesALinkedRoot(t *testing.T) {
	// The "~/Decks → ~/Dropbox/Decks" setup must keep working, and the guard
	// needs the physical form so it can hold it to the same standard as the
	// name the user picked.
	base := t.TempDir()
	target := filepath.Join(base, "Dropbox", "Decks")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "Decks")
	mkSymlink(t, target, link)

	res, err := revealRoot(link)
	if err != nil {
		t.Fatalf("revealRoot: %v", err)
	}
	if res.Degraded {
		t.Skip("filesystem could not resolve links on this runner")
	}
	want, err := filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	if res.Path != filepath.Clean(want) {
		t.Fatalf("revealRoot = %q, want %q", res.Path, want)
	}
}

func TestConfinementHoldsInsideALinkedRoot(t *testing.T) {
	// A root that is itself a link is confined from its target onward — the
	// convenience case does not cost the guarantee.
	root, _ := buildTree(t)
	base := t.TempDir()
	link := filepath.Join(base, "Linked")
	mkSymlink(t, root, link)

	got := entryFor(t, link, "real.vela", "escape.vela")
	if !got["real.vela"].OK {
		t.Fatal("ordinary deck refused inside a linked root")
	}
	if got["escape.vela"].OK {
		t.Fatal("escaping link accepted inside a linked root")
	}
}

func TestRevealMissingRootIsError(t *testing.T) {
	if _, err := revealRoot(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Fatal("expected an error for a missing root")
	}
}

func TestRejectsOversizedRequests(t *testing.T) {
	root, _ := buildTree(t)
	many := make([]string, maxResolveNames+1)
	for i := range many {
		many[i] = "a.vela"
	}
	if _, err := checkNames(root, many); err == nil {
		t.Fatal("expected too-many-names to be refused")
	}
	long := make([]byte, maxResolvePath+1)
	for i := range long {
		long[i] = 'a'
	}
	name := string(long)
	if entryFor(t, root, name)[name].Error != "invalid" {
		t.Fatal("expected an over-long name to be refused")
	}
}

func TestResolveEndpointRequiresToken(t *testing.T) {
	srv := httptest.NewServer(newServer("s3cret", ""))
	defer srv.Close()

	body, _ := json.Marshal(resolveRequest{Root: t.TempDir(), Names: []string{"a.vela"}})
	post := func(token string) int {
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/resolve", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("x-vela-token", token)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	if code := post(""); code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated /resolve returned %d, want 401", code)
	}
	if code := post("wrong"); code != http.StatusUnauthorized {
		t.Fatalf("bad-token /resolve returned %d, want 401", code)
	}
	if code := post("s3cret"); code != http.StatusOK {
		t.Fatalf("authenticated /resolve returned %d, want 200", code)
	}
}

func TestResolveEndpointRefusesForeignOrigin(t *testing.T) {
	// /resolve inherits the same origin gate as /send: a page that guessed the
	// port must not be able to drive it even with a leaked token.
	srv := httptest.NewServer(newServer("s3cret", "1234"))
	defer srv.Close()

	body, _ := json.Marshal(resolveRequest{Root: t.TempDir(), Names: []string{"a.vela"}})
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/resolve", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-vela-token", "s3cret")
	req.Header.Set("Origin", "https://evil.example")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign-origin /resolve returned %d, want 403", res.StatusCode)
	}
}

func TestResolveEndpointRoundTrip(t *testing.T) {
	root, _ := buildTree(t)
	srv := httptest.NewServer(newServer("s3cret", ""))
	defer srv.Close()

	body, _ := json.Marshal(resolveRequest{Root: root, Names: []string{"real.vela", "escape.vela"}})
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/resolve", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-vela-token", "s3cret")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	var decoded struct {
		OK      bool                    `json:"ok"`
		Entries map[string]resolveEntry `json:"entries"`
	}
	if err := json.NewDecoder(res.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if !decoded.OK {
		t.Fatal("expected ok:true")
	}
	if !decoded.Entries["real.vela"].OK {
		t.Fatal("ordinary deck refused over the wire")
	}
	if decoded.Entries["escape.vela"].OK {
		t.Fatal("escaping link accepted over the wire")
	}
}
