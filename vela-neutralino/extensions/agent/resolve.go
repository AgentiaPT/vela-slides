// Path confinement service for the webview's filesystem guard.
//
// The webview's fs-guard.js can only compare path *strings*: the Neutralino
// client API exposes no realpath, and getStats reports neither links nor
// reparse points. So a name that reads as being inside the decks folder can
// still land somewhere else once the OS resolves it. This file answers the one
// question the guard cannot answer on its own — "does this name stay inside
// the folder?" — over the loopback channel that already exists for the agent
// bridge.
//
// The answer comes from os.Root (Go 1.24), the standard library's
// traversal-resistant file API, rather than from hand-rolled path walking.
// os.Root resolves each component with openat/O_NOFOLLOW (RESOLVE_BENEATH
// where available) and refuses anything that escapes the root, whether via
// "..", a symlink, or a Windows junction or other reparse point. Two reasons
// that matters here beyond the obvious one of not reimplementing it:
//
//   - Windows. filepath.EvalSymlinks is unreliable there (it fails outright on
//     paths containing a junction) and Lstat's reparse-point mode bits moved
//     between Go versions. os.Root has a real Windows implementation.
//   - The check is resolved per component by the kernel rather than by a
//     sequence of stat calls we make ourselves, so there is no window between
//     our own checks for a path to change underneath us.
//
// The gatekeeper holds NO allowlist and makes NO policy decision: it reports
// whether a name stays inside a root the caller named, and fs-guard.js decides
// what may be a root in the first place. One allowlist, in one place.
//
// NOTE (maintainer): this still does not make the overall operation atomic.
// The check happens here and the read or write happens afterwards in the
// webview, so a local attacker able to swap a path between the two can still
// win that race. Closing it needs the file operation itself to move behind
// os.Root — see SECURITY.md.

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const (
	maxResolveNames = 256  // per request; bounds the work one call can buy
	maxResolvePath  = 4096 // per name, characters
)

// sanitizeName prepares a caller-supplied relative name for os.Root.
//
// The trailing separator strip is deliberate and load-bearing: on Unix,
// openat(fd, path, O_NOFOLLOW) follows a symlink when the path ends in "/",
// and os.Root did not account for that until recently (CVE-2026-39822). We
// strip it ourselves so the guard does not depend on the toolchain's patch
// level for that specific escape.
func sanitizeName(name string) (string, error) {
	n := strings.TrimRight(strings.ReplaceAll(name, "\\", "/"), "/")
	if n == "" {
		return "", errors.New("empty name")
	}
	if len(n) > maxResolvePath {
		return "", errors.New("name too long")
	}
	if filepath.IsAbs(n) || filepath.VolumeName(n) != "" {
		// os.Root takes root-relative names; an absolute one is a caller bug,
		// and guessing what it meant is how confinement bugs start.
		return "", errors.New("name must be relative")
	}
	return n, nil
}

// classifyErr maps an os.Root failure onto a small fixed vocabulary.
//
// Callers only need to tell "gone" from "does not stay inside the folder", and
// a fixed vocabulary keeps host detail out of a response the webview may later
// render. Anything unrecognised is reported as an escape: unknown reasons fail
// closed.
func classifyErr(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, os.ErrNotExist):
		return "missing"
	default:
		return "escapes"
	}
}

type resolveRequest struct {
	// Root is an absolute directory the caller has already accepted as a trust
	// root. Confinement is evaluated relative to it.
	Root string `json:"root"`
	// Names are root-relative paths to check.
	Names []string `json:"names"`
	// Reveal asks where Root itself physically lives, instead of checking
	// names. The guard needs this once per root so it can hold the resolved
	// form to the same standard as the name the user picked — a folder that is
	// itself a link must not become a way in.
	Reveal bool `json:"reveal"`
}

type resolveEntry struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"` // "missing" | "escapes" | "invalid"
}

type resolveResult struct {
	Entries map[string]resolveEntry `json:"entries,omitempty"`
	Path    string                  `json:"path,omitempty"`
	// Degraded marks a reveal the OS could not complete. Not fatal: the
	// per-name confinement checks do not depend on it.
	Degraded bool `json:"degraded,omitempty"`
}

// revealRoot reports where a root physically lives.
//
// filepath.EvalSymlinks is confined to this one call, and its failure degrades
// rather than blocking: it fails on Windows for paths containing a junction
// (a volume mounted as a subdirectory is enough), and locking a user out of
// their decks over that would be a worse outcome than a root we could not
// double-check. Every name inside the root is still confined by os.Root.
func revealRoot(root string) (resolveResult, error) {
	if root == "" || !filepath.IsAbs(root) {
		return resolveResult{}, errors.New("root must be absolute")
	}
	clean := filepath.Clean(root)
	if _, err := os.Lstat(clean); err != nil {
		return resolveResult{}, err
	}
	phys, err := filepath.EvalSymlinks(clean)
	if err != nil {
		return resolveResult{Path: clean, Degraded: true}, nil
	}
	return resolveResult{Path: filepath.Clean(phys)}, nil
}

// checkNames reports, for each name, whether it stays inside root.
//
// A single os.Root handle serves the whole batch — that is what makes vetting
// a folder listing one call rather than one call per deck.
func checkNames(root string, names []string) (resolveResult, error) {
	if root == "" || !filepath.IsAbs(root) {
		return resolveResult{}, errors.New("root must be absolute")
	}
	if len(names) > maxResolveNames {
		return resolveResult{}, errors.New("too many names")
	}
	entries := make(map[string]resolveEntry, len(names))
	if len(names) == 0 {
		return resolveResult{Entries: entries}, nil
	}

	r, err := os.OpenRoot(filepath.Clean(root))
	if err != nil {
		// The root itself is unusable. Report every name as an escape rather
		// than as missing: we could not establish confinement at all.
		for _, name := range names {
			entries[name] = resolveEntry{Error: "escapes"}
		}
		return resolveResult{Entries: entries}, nil
	}
	defer r.Close()

	for _, name := range names {
		safe, err := sanitizeName(name)
		if err != nil {
			entries[name] = resolveEntry{Error: "invalid"}
			continue
		}
		// Stat, not Lstat: this permits a link that stays inside the root and
		// refuses one that leaves it, which is the property we actually want.
		if _, err := r.Stat(safe); err != nil {
			entries[name] = resolveEntry{Error: classifyErr(err)}
			continue
		}
		entries[name] = resolveEntry{OK: true}
	}
	return resolveResult{Entries: entries}, nil
}

func resolve(req resolveRequest) (resolveResult, error) {
	if req.Reveal {
		return revealRoot(req.Root)
	}
	return checkNames(req.Root, req.Names)
}
