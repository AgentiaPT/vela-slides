// Path-scoping predicates for the Vela filesystem broker.
//
// These are the SECURITY BOUNDARY of the desktop file layer. The webview page
// holds NO ambient filesystem authority anymore (filesystem.* is absent from
// neutralino.config.json's nativeAllowList) — every file operation is a narrow,
// semantic request to this broker, and the broker resolves that request only
// inside a small set of trust roots. Even a deck-driven DOM-XSS that reaches
// page execution can, at most, ask the broker to perform one of the enumerated
// operations on a validated basename inside a validated root — never hold or
// widen the policy, and never name an arbitrary path.
//
// The root predicates below are a 1:1 port of the JS guard that previously ran
// in the page (resources/js/fs-guard.js). They now run in the broker, where
// page script cannot reach them. Keep them in lockstep with that history: a
// volume root, a shallow single-segment POSIX root, and OS-critical system
// subtrees are all refused as trust roots (home roots are deliberately NOT
// refused so a legitimate ~/.vela is always allowed).

package main

import (
	"errors"
	"regexp"
	"strings"
)

var (
	reVolumeDrive = regexp.MustCompile(`^[a-zA-Z]:$`)
	reUNCHost     = regexp.MustCompile(`^//[^/]+$`)
)

// normPath mirrors fs-guard.js norm(): backslashes → forward slashes, trailing
// slashes stripped. A bare "/" normalizes to "" (rejected by the empty check).
func normPath(p string) string {
	s := strings.ReplaceAll(p, "\\", "/")
	// strip trailing slashes (but keep an all-slash string collapsing to "")
	s = strings.TrimRight(s, "/")
	return s
}

// isVolumeRoot refuses a normalized path with no segment beyond the volume root:
// "" (POSIX "/"), a bare Windows drive spec ("C:"), or a UNC host with no share
// ("//server"). Real decks and ~/.vela always live in a nested folder.
func isVolumeRoot(n string) bool {
	return n == "" || reVolumeDrive.MatchString(n) || reUNCHost.MatchString(n)
}

// isShallowRoot refuses a single-segment absolute POSIX root such as /etc, /usr,
// /home, /var, /tmp, /root — every real trust root is nested at least two
// segments deep, so refusing these shrinks the blast radius at no cost.
func isShallowRoot(n string) bool {
	if strings.HasPrefix(n, "/") && !strings.HasPrefix(n, "//") {
		count := 0
		for _, seg := range strings.Split(n, "/") {
			if seg != "" {
				count++
			}
		}
		return count < 2
	}
	return false
}

// systemRoots are OS-critical subtrees a decks folder or ~/.vela can never
// legitimately live in, but that an attacker reaching a widening primitive would
// target for credential theft / persistence. Refusing these — and anything
// nested under them — caps the depth>=2 gap isShallowRoot leaves open (e.g.
// /etc/cron.d). Deliberately EXCLUDES home roots (/home, /Users, /root).
var systemRoots = []string{
	"/etc", "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/boot",
	"/dev", "/proc", "/sys", "/run", "/var", "/srv", "/opt",
	"c:/windows", "c:/program files", "c:/program files (x86)", "c:/programdata",
}

func isSystemRoot(n string) bool {
	l := strings.ToLower(n)
	for _, r := range systemRoots {
		if l == r || strings.HasPrefix(l, r+"/") {
			return true
		}
	}
	return false
}

// validRoot reports whether a normalized path may be registered as a trust root.
// This is the exact allow() gate from fs-guard.js, now enforced in the broker.
func validRoot(n string) bool {
	return !isVolumeRoot(n) && !isShallowRoot(n) && !isSystemRoot(n)
}

// underRoot reports whether normalized path p resolves inside one of the given
// (already-normalized) roots, with a defense-in-depth reject of any ".." segment
// so a "<root>/../../etc/passwd" can never normalize back inside.
func underRoot(roots []string, p string) bool {
	n := normPath(p)
	if n == "" {
		return false
	}
	for _, seg := range strings.Split(n, "/") {
		if seg == ".." {
			return false
		}
	}
	for _, r := range roots {
		if n == r || strings.HasPrefix(n, r+"/") {
			return true
		}
	}
	return false
}

var errBadName = errors.New("unsafe deck name")

// safeBasename validates that name is a plain filename with no path authority:
// non-empty, no path separators, no traversal, not absolute, no NUL. Returns the
// cleaned basename or errBadName. This is the "name MUST be a safe basename"
// contract for /decks/read and /decks/save — the page can never smuggle a path.
func safeBasename(name string) (string, error) {
	if name == "" {
		return "", errBadName
	}
	// Reject any separator (either slash) or NUL — a basename has none.
	if strings.ContainsAny(name, "/\\\x00") {
		return "", errBadName
	}
	// Reject Windows drive-absolute ("C:foo") and traversal.
	if reVolumeDrive.MatchString(name) || strings.HasPrefix(name, ":") {
		return "", errBadName
	}
	if len(name) >= 2 && name[1] == ':' {
		return "", errBadName
	}
	if name == "." || name == ".." || strings.Contains(name, "..") {
		return "", errBadName
	}
	return name, nil
}

var errBadExt = errors.New("disallowed deck extension")

// allowedSaveExt is the write allowlist enforced by the broker (cheap-win #2):
// a save target must end in .vela or .json. Enforced HERE, in native code, not
// in page JS — so page script cannot write a .sh/.js/.tmp or extension-less file.
func allowedSaveExt(name string) bool {
	l := strings.ToLower(name)
	return strings.HasSuffix(l, ".vela") || strings.HasSuffix(l, ".json")
}

// isDeckFile reports whether a listed entry should surface as a deck (*.vela or
// *.json), mirroring deck-io.js listDecks().
func isDeckFile(name string) bool {
	l := strings.ToLower(name)
	return strings.HasSuffix(l, ".vela") || strings.HasSuffix(l, ".json")
}
