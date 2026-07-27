// Behavioural tests for the path-canonicalisation service (resolve.go).
//
// These build real links on disk rather than mocking the filesystem — the whole
// point of the endpoint is that string logic cannot answer the question, so a
// test that only exercises string logic would prove nothing.
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

func TestPathIsCleanDetectsLinks(t *testing.T) {
	root, _ := buildTree(t)

	// Ordinary files inside the root are clean, at any depth.
	for _, p := range []string{
		filepath.Join(root, "real.vela"),
		filepath.Join(root, "sub", "inner.vela"),
	} {
		ok, err := pathIsClean(root, p)
		if err != nil {
			t.Fatalf("pathIsClean(%s): unexpected error %v", p, err)
		}
		if !ok {
			t.Fatalf("expected %s to be clean", p)
		}
	}

	// A file link out of the root is the reported vulnerability: lexically
	// inside, physically outside.
	ok, err := pathIsClean(root, filepath.Join(root, "escape.vela"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("file symlink out of the root was reported clean")
	}

	// A DIRECTORY link is the nastier variant — it silently relocates listing
	// and saving, and a per-file approval model would not catch it either.
	ok, err = pathIsClean(root, filepath.Join(root, "outdir", "secret.txt"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("path through a directory symlink was reported clean")
	}
}

func TestPathIsCleanRejectsOutsideBase(t *testing.T) {
	root, outside := buildTree(t)
	// A path that is not under the claimed base must be refused outright rather
	// than checked against the wrong prefix.
	ok, err := pathIsClean(root, filepath.Join(outside, "secret.txt"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("path outside the base was reported clean")
	}
	// Prefix-sibling: "<root>Evil" must not count as being under "<root>".
	sibling := root + "Evil"
	if err := os.MkdirAll(sibling, 0o755); err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(sibling, "x.vela")
	if err := os.WriteFile(f, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if ok, _ := pathIsClean(root, f); ok {
		t.Fatal("prefix-sibling path was reported clean")
	}
}

func TestPathIsCleanWalksWholePathWithoutBase(t *testing.T) {
	root, _ := buildTree(t)
	// With no base, every component from the volume root down is walked — this
	// is how a symlinked ROOT (or a symlinked parent of it) gets caught.
	ok, err := pathIsClean("", filepath.Join(root, "outdir", "secret.txt"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("link component was reported clean in whole-path mode")
	}
}

func TestPathIsCleanMissingPathIsError(t *testing.T) {
	root, _ := buildTree(t)
	// "gone" must be distinguishable from "not what it appears to be" — the
	// webview shows different messages and must not treat a deleted deck as an
	// attack.
	if _, err := pathIsClean(root, filepath.Join(root, "nope.vela")); err == nil {
		t.Fatal("expected an error for a missing path")
	}
}

func TestPathIsCleanRejectsRelative(t *testing.T) {
	if _, err := pathIsClean("", "relative/path.vela"); err == nil {
		t.Fatal("expected an error for a relative path")
	}
}

func TestRealPathResolvesLinkedRoot(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "Dropbox", "Decks")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "Decks")
	mkSymlink(t, target, link)

	// The "~/Decks → ~/Dropbox/Decks" setup must keep working: reveal mode
	// hands back the physical root so the guard can allow both forms.
	phys, degraded, err := realPath(link)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if degraded {
		t.Skip("filesystem could not resolve links on this runner")
	}
	wantPhys, err := filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	if phys != filepath.Clean(wantPhys) {
		t.Fatalf("realPath = %q, want %q", phys, wantPhys)
	}
}

func TestRealPathMissingIsError(t *testing.T) {
	if _, _, err := realPath(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Fatal("expected an error for a missing path")
	}
}

func TestRevealIsRateLimited(t *testing.T) {
	// Reveal mode is an information oracle; the bucket is what keeps it from
	// being usable to sweep the filesystem. Legitimate use is a few calls per
	// session, so a small burst plus a slow refill costs real users nothing.
	root, _ := buildTree(t)
	b := newTokenBucket(3, 0) // no refill, so the limit is deterministic
	req := resolveRequest{Paths: []string{filepath.Join(root, "real.vela")}, Reveal: true}
	for i := 0; i < 3; i++ {
		if _, err := resolvePaths(req, b); err != nil {
			t.Fatalf("call %d should have been allowed: %v", i, err)
		}
	}
	if _, err := resolvePaths(req, b); err == nil {
		t.Fatal("expected the 4th reveal to be rate limited")
	}
	// Clean mode is NOT rate limited — it is on the hot path and discloses
	// nothing beyond one bit per path.
	clean := resolveRequest{Base: root, Paths: []string{filepath.Join(root, "real.vela")}}
	for i := 0; i < 50; i++ {
		if _, err := resolvePaths(clean, b); err != nil {
			t.Fatalf("clean-mode call %d was refused: %v", i, err)
		}
	}
}

func TestResolveRejectsOversizedRequests(t *testing.T) {
	many := make([]string, maxResolvePaths+1)
	for i := range many {
		many[i] = "/tmp/x"
	}
	if _, err := resolvePaths(resolveRequest{Paths: many}, nil); err == nil {
		t.Fatal("expected too-many-paths to be refused")
	}
	long := make([]byte, maxResolvePath+1)
	for i := range long {
		long[i] = 'a'
	}
	if _, err := resolvePaths(resolveRequest{Paths: []string{"/" + string(long)}}, nil); err == nil {
		t.Fatal("expected an over-long path to be refused")
	}
}

func TestResolveErrorsCarryNoHostDetail(t *testing.T) {
	// Error strings travel back to a webview that may be under attacker
	// control; they must never become a second disclosure channel.
	root, _ := buildTree(t)
	entries, err := resolvePaths(resolveRequest{
		Base:  root,
		Paths: []string{filepath.Join(root, "definitely-not-here.vela")},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for p, e := range entries {
		if e.Error != "missing" {
			t.Fatalf("expected a fixed-vocabulary error, got %q", e.Error)
		}
		if e.Path != "" {
			t.Fatalf("clean mode leaked a physical path for %s", p)
		}
	}
}

func TestResolveEndpointRequiresToken(t *testing.T) {
	srv := httptest.NewServer(newServer("s3cret", ""))
	defer srv.Close()

	body, _ := json.Marshal(resolveRequest{Paths: []string{"/tmp"}})
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

	body, _ := json.Marshal(resolveRequest{Paths: []string{"/tmp"}})
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

	body, _ := json.Marshal(resolveRequest{
		Base: root,
		Paths: []string{
			filepath.Join(root, "real.vela"),
			filepath.Join(root, "escape.vela"),
		},
	})
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
	if !decoded.Entries[filepath.Join(root, "real.vela")].Clean {
		t.Fatal("ordinary deck reported unclean over the wire")
	}
	if decoded.Entries[filepath.Join(root, "escape.vela")].Clean {
		t.Fatal("escaping link reported clean over the wire")
	}
}
