// Path-canonicalisation service for the webview's filesystem guard.
//
// The webview's fs-guard.js can only compare path *strings*: the Neutralino
// client API exposes no realpath, and getStats reports neither links nor
// reparse points. So a path whose components are all textually inside an
// allowed root can still land somewhere else entirely once the OS resolves it.
// This file gives the guard the one primitive it cannot get on its own — a
// look at what a path physically is — over the loopback channel that already
// exists for the agent bridge.
//
// Two operations, deliberately asymmetric:
//
//	clean   (default)  → one bool per path: "no component of this path is a
//	                     link / reparse point / non-regular file". Discloses
//	                     nothing about the filesystem beyond that bit, so it is
//	                     safe to expose on the hot path and is not rate-limited.
//	reveal  (opt-in)   → the physical path. Needed once per trust root so a
//	                     legitimately symlinked decks folder (a very common
//	                     "~/Decks → ~/Dropbox/Decks" setup) still works. This
//	                     one IS an information oracle, so it is rate-limited to
//	                     a rate that comfortably covers real use (a handful of
//	                     roots per session) while being useless for sweeping the
//	                     filesystem.
//
// The gatekeeper holds NO allowlist and makes NO policy decision: it reports
// what the filesystem says and the webview's guard decides. Keeping the roots
// solely in fs-guard.js means there is exactly one allowlist to audit and no
// second copy to drift out of sync.
//
// NOTE (maintainer): this narrows a check-then-use gap; it does not close it.
// Resolution happens here and the read/write happens later in another process,
// so a local attacker able to swap a path between the two still wins the race.
// Closing that needs the file operation itself to move behind an
// openat/O_NOFOLLOW-style call — see SECURITY.md.

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	maxResolvePaths = 128  // per request; bounds the work a single call can buy
	maxResolvePath  = 4096 // per path, characters
)

// componentsBelow splits the part of `p` that lies underneath `base` into path
// components. It returns ok=false when `p` is not lexically under `base` — the
// caller treats that as "not clean" rather than silently checking the wrong
// thing. Both arguments must already be cleaned and absolute.
func componentsBelow(base, p string) ([]string, bool) {
	if base == "" {
		return nil, false
	}
	if p == base {
		return nil, true
	}
	sep := string(filepath.Separator)
	prefix := strings.TrimSuffix(base, sep) + sep
	if !strings.HasPrefix(p, prefix) {
		return nil, false
	}
	rest := strings.Trim(p[len(prefix):], sep)
	if rest == "" {
		return nil, true
	}
	return strings.Split(rest, sep), true
}

// allComponents splits an absolute path into the components below its volume
// root ("/" on POSIX, "C:\" or a UNC share on Windows).
func allComponents(p string) (string, []string, error) {
	if !filepath.IsAbs(p) {
		return "", nil, errors.New("path must be absolute")
	}
	sep := string(filepath.Separator)
	vol := filepath.VolumeName(p)
	root := vol + sep
	rest := strings.Trim(strings.TrimPrefix(p, vol), sep)
	if rest == "" {
		return root, nil, nil
	}
	return root, strings.Split(rest, sep), nil
}

// isPlainEntry reports whether a directory entry is an ordinary directory or
// regular file. Everything else — symlink, Windows junction / mount point /
// other reparse point, device, socket, FIFO — is rejected.
//
// This is deliberately a POSITIVE test rather than a list of bad mode bits.
// Windows reparse points report differently across Go versions (ModeSymlink
// before 1.23, ModeIrregular after; see golang/go#63703), and filepath.
// EvalSymlinks is itself unreliable around junctions on Windows. Asking "is
// this an ordinary file or directory?" is stable across both, and fails closed
// on anything the OS models as unusual.
func isPlainEntry(fi os.FileInfo) bool {
	m := fi.Mode()
	return m.IsDir() || m.IsRegular()
}

// pathIsClean walks `p` component by component and reports whether every step
// is an ordinary directory or file. When `base` is non-empty, components at or
// above `base` are taken on trust (the caller vetted the root when it
// registered it) and only the components below it are walked — otherwise a
// legitimately symlinked decks root would make every file inside it look dirty.
//
// A missing path is an error, not "unclean": the caller distinguishes "this
// deck is gone" from "this deck is not what it appears to be".
func pathIsClean(base, p string) (bool, error) {
	if p == "" {
		return false, errors.New("empty path")
	}
	clean := filepath.Clean(p)
	if !filepath.IsAbs(clean) {
		return false, errors.New("path must be absolute")
	}

	var prefix string
	var parts []string
	if base != "" {
		cb := filepath.Clean(base)
		below, ok := componentsBelow(cb, clean)
		if !ok {
			// Not under the claimed base — refuse rather than guess.
			return false, nil
		}
		prefix, parts = cb, below
	} else {
		root, all, err := allComponents(clean)
		if err != nil {
			return false, err
		}
		prefix, parts = root, all
	}

	cur := prefix
	for _, part := range parts {
		if part == "" {
			continue
		}
		cur = filepath.Join(cur, part)
		fi, err := os.Lstat(cur)
		if err != nil {
			return false, err
		}
		if !isPlainEntry(fi) {
			return false, nil
		}
	}
	return true, nil
}

// realPath returns the physical location of an existing path. The bool result
// reports DEGRADED resolution: the path exists but the OS could not be asked
// where it really points.
//
// That degraded case is not hypothetical — filepath.EvalSymlinks fails on
// Windows for paths containing a junction (a volume mounted as a subdirectory
// is enough) and its output is not stable there in general; see golang/go#40104
// and #63703. Failing the whole open in that situation would lock real users
// out of their decks, so we hand back the lexically-cleaned path and let the
// caller decide. The per-file `clean` walk above does not depend on
// EvalSymlinks and still applies, so a degraded root does not mean an unguarded
// one.
func realPath(p string) (string, bool, error) {
	if p == "" {
		return "", false, errors.New("empty path")
	}
	clean := filepath.Clean(p)
	if !filepath.IsAbs(clean) {
		return "", false, errors.New("path must be absolute")
	}
	if _, err := os.Lstat(clean); err != nil {
		return "", false, err
	}
	r, err := filepath.EvalSymlinks(clean)
	if err != nil {
		return clean, true, nil
	}
	return filepath.Clean(r), false, nil
}

// ---------------------------------------------------------------------------
// Rate limiting (reveal mode only)
// ---------------------------------------------------------------------------

// tokenBucket is a plain refilling bucket. Legitimate reveal traffic is a
// handful of calls per session (one per trust root, plus a folder reswitch);
// enumeration needs thousands. A slow refill separates the two cleanly without
// ever getting in a real user's way.
type tokenBucket struct {
	mu       sync.Mutex
	tokens   float64
	capacity float64
	perSec   float64
	last     time.Time
}

func newTokenBucket(capacity, perSec float64) *tokenBucket {
	return &tokenBucket{tokens: capacity, capacity: capacity, perSec: perSec, last: time.Now()}
}

func (b *tokenBucket) allowN(n int) bool {
	if n <= 0 {
		return true
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	if elapsed := now.Sub(b.last).Seconds(); elapsed > 0 {
		b.tokens += elapsed * b.perSec
		if b.tokens > b.capacity {
			b.tokens = b.capacity
		}
		b.last = now
	}
	want := float64(n)
	if b.tokens < want {
		return false
	}
	b.tokens -= want
	return true
}

// ---------------------------------------------------------------------------
// Request / response
// ---------------------------------------------------------------------------

type resolveRequest struct {
	// Base is an already-trusted root. Components at or above it are not
	// re-walked. Ignored in reveal mode.
	Base string `json:"base"`
	// Paths to inspect. Absolute, cleaned by the server before use.
	Paths []string `json:"paths"`
	// Reveal asks for physical paths instead of clean/dirty bits.
	Reveal bool `json:"reveal"`
}

type resolveEntry struct {
	// Clean is set in default mode: true when no component below Base is a
	// link, reparse point, or other non-ordinary entry.
	Clean bool `json:"clean"`
	// Path is set in reveal mode: the physical location.
	Path string `json:"path,omitempty"`
	// Degraded marks a reveal whose resolution the OS could not complete.
	Degraded bool `json:"degraded,omitempty"`
	// Error is a short, non-sensitive reason ("missing", "invalid", "denied").
	// Never the raw OS error — those embed paths and would turn an error
	// string into the very oracle the clean/reveal split exists to avoid.
	Error string `json:"error,omitempty"`
}

// classifyErr maps an OS error onto a small fixed vocabulary. Callers only
// need to tell "gone" from "cannot tell", and a fixed vocabulary keeps host
// details out of a response the webview may later render.
func classifyErr(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, os.ErrNotExist):
		return "missing"
	case errors.Is(err, os.ErrPermission):
		return "denied"
	default:
		return "invalid"
	}
}

// resolvePaths runs one request. Returned entries are keyed by the caller's
// original (uncleaned) path string so the webview can match them up without
// having to reimplement the server's cleaning rules.
func resolvePaths(req resolveRequest, bucket *tokenBucket) (map[string]resolveEntry, error) {
	if len(req.Paths) == 0 {
		return map[string]resolveEntry{}, nil
	}
	if len(req.Paths) > maxResolvePaths {
		return nil, errors.New("too many paths")
	}
	for _, p := range req.Paths {
		if len(p) > maxResolvePath {
			return nil, errors.New("path too long")
		}
	}
	if req.Reveal && bucket != nil && !bucket.allowN(len(req.Paths)) {
		return nil, errors.New("rate limited")
	}

	out := make(map[string]resolveEntry, len(req.Paths))
	for _, p := range req.Paths {
		if req.Reveal {
			phys, degraded, err := realPath(p)
			if err != nil {
				out[p] = resolveEntry{Error: classifyErr(err)}
				continue
			}
			out[p] = resolveEntry{Path: phys, Degraded: degraded, Clean: !degraded}
			continue
		}
		ok, err := pathIsClean(req.Base, p)
		if err != nil {
			out[p] = resolveEntry{Error: classifyErr(err)}
			continue
		}
		out[p] = resolveEntry{Clean: ok}
	}
	return out, nil
}
