// Filesystem store for the Vela broker.
//
// The broker is the ONLY process in the desktop app with filesystem access.
// Every method here resolves a semantic request (list/read/save/new decks,
// read/write the fixed config + trust files) inside a validated trust root and
// nowhere else. Trust roots are: ~/.vela (derived by the broker from $HOME —
// NEVER from the page) and the single decks folder the user chose in the OS
// folder dialog (the page passes only the chosen string; the broker validates
// it with the ported fs-guard predicates before trusting it).

package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// WATCHER_IGNORE_MS mirrors deck-io.js: writes we performed ourselves within
// this window are echoes and must not surface as external edits.
const watcherIgnoreMS = 400

var (
	errNoFolder   = errors.New("no decks folder selected")
	errBadRoot    = errors.New("refusing unsafe folder root")
	errNotDir     = errors.New("folder is not a directory")
	errEscape     = errors.New("path escapes trust root")
)

type store struct {
	mu            sync.Mutex
	homeVela      string   // normalized ~/.vela (internal config root)
	roots         []string // normalized trust roots (homeVela + the decks folder)
	folder        string   // normalized current decks folder ("" until /folder)
	currentDeck   string   // basename of the deck being watched
	lastWriteAt   time.Time
	watchBaseline int64 // mtime (unixnano) of currentDeck last reconciled
}

func newStore(home string) *store {
	hv := normPath(home) + "/.vela"
	return &store{homeVela: hv, roots: []string{hv}}
}

// addRoot registers a normalized root once (idempotent). Caller holds mu.
func (s *store) addRoot(n string) {
	for _, r := range s.roots {
		if r == n {
			return
		}
	}
	s.roots = append(s.roots, n)
}

// setFolder validates the user-chosen decks folder and registers it as the
// decks trust root. The page supplies only the string returned by
// os.showFolderDialog; the broker is what decides whether to trust it.
func (s *store) setFolder(path string) (string, error) {
	n := normPath(path)
	if !validRoot(n) {
		return "", errBadRoot
	}
	info, err := os.Stat(n)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errNotDir
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.folder = n
	s.addRoot(n)
	return n, nil
}

func (s *store) folderRoot() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.folder == "" {
		return "", errNoFolder
	}
	return s.folder, nil
}

// resolveInFolder validates name as a safe basename, joins it under the current
// folder, and refuses any symlink that escapes the trust roots.
func (s *store) resolveInFolder(name string) (string, error) {
	folder, err := s.folderRoot()
	if err != nil {
		return "", err
	}
	base, err := safeBasename(name)
	if err != nil {
		return "", err
	}
	p := folder + "/" + base
	if !underRoot(s.snapshotRoots(), p) {
		return "", errEscape
	}
	// Symlink-escape guard: if the target exists and resolves (through symlinks)
	// outside the trust roots, refuse it.
	if real, err := filepath.EvalSymlinks(filepath.FromSlash(p)); err == nil {
		if !underRoot(s.snapshotRoots(), filepath.ToSlash(real)) {
			return "", errEscape
		}
	}
	return p, nil
}

func (s *store) snapshotRoots() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.roots...)
}

func (s *store) listDecks() ([]string, error) {
	folder, err := s.folderRoot()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(filepath.FromSlash(folder))
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if isDeckFile(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

func (s *store) readDeck(name string) (string, error) {
	p, err := s.resolveInFolder(name)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(filepath.FromSlash(p))
	if err != nil {
		return "", err
	}
	s.setCurrent(name)
	return string(b), nil
}

func (s *store) deckExists(name string) (bool, error) {
	p, err := s.resolveInFolder(name)
	if err != nil {
		return false, err
	}
	info, err := os.Stat(filepath.FromSlash(p))
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return !info.IsDir(), nil
}

// saveDeck enforces BOTH a safe basename AND the .vela/.json write allowlist,
// then writes atomically inside the folder. Refusing any other extension here
// (native code) means page script cannot drop an executable/config file.
func (s *store) saveDeck(name, content string) error {
	if !allowedSaveExt(name) {
		return errBadExt
	}
	p, err := s.resolveInFolder(name)
	if err != nil {
		return err
	}
	if err := refuseSymlinkTarget(p); err != nil {
		return err
	}
	if err := atomicWrite(p, content); err != nil {
		return err
	}
	s.mu.Lock()
	s.lastWriteAt = time.Now()
	s.currentDeck = name
	s.watchBaseline = fileMtime(p)
	s.mu.Unlock()
	return nil
}

var slugStrip = regexp.MustCompile(`[^\w\s.-]`)
var slugSpace = regexp.MustCompile(`\s+`)
var slugDash = regexp.MustCompile(`-{2,}`)
var slugEnds = regexp.MustCompile(`^[-.]+|[-.]+$`)

// slugify ports deck-io.js newDeck() slug rules (minus Unicode NFKD, which needs
// a non-stdlib dependency; non-ASCII is stripped by the \w class either way, so
// the only difference is an accented char decomposes to "" instead of its ASCII
// base — cosmetic, never a path-safety change).
func slugify(title string) string {
	t := title
	if t == "" {
		t = "Untitled"
	}
	t = slugStrip.ReplaceAllString(t, "")
	t = slugSpace.ReplaceAllString(t, "-")
	t = slugDash.ReplaceAllString(t, "-")
	// slice(0,60) by rune
	r := []rune(t)
	if len(r) > 60 {
		r = r[:60]
	}
	t = string(r)
	t = slugEnds.ReplaceAllString(t, "")
	if t == "" {
		t = "Untitled"
	}
	return t
}

// newDeck allocates a unique "<slug>.vela" (then -2, -3, …), creates a minimal
// valid deck, and makes it the watched deck. Slug + dedupe run in the broker so
// the page never composes a filename.
func (s *store) newDeck(title string) (string, error) {
	folder, err := s.folderRoot()
	if err != nil {
		return "", err
	}
	existing, err := s.listDecks()
	if err != nil {
		existing = nil
	}
	lower := map[string]bool{}
	for _, e := range existing {
		lower[strings.ToLower(e)] = true
	}
	slug := slugify(title)
	name := slug + ".vela"
	for n := 1; lower[strings.ToLower(name)]; {
		n++
		name = slug + "-" + itoa(n) + ".vela"
	}
	// Compose the same minimal deck deck-io.js wrote.
	dt := title
	if dt == "" {
		dt = "Untitled"
	}
	obj := map[string]interface{}{"deckTitle": dt, "lanes": []interface{}{}}
	buf, _ := json.MarshalIndent(obj, "", "  ")
	p := folder + "/" + name
	if !underRoot(s.snapshotRoots(), p) {
		return "", errEscape
	}
	if err := atomicWrite(p, string(buf)); err != nil {
		return "", err
	}
	s.mu.Lock()
	s.lastWriteAt = time.Now()
	s.currentDeck = name
	s.watchBaseline = fileMtime(p)
	s.mu.Unlock()
	return name, nil
}

// ── Config (~/.vela/config.json) ──────────────────────────────────────────

func (s *store) configPath() string { return s.homeVela + "/config.json" }

func (s *store) readConfig() (string, error) {
	b, err := os.ReadFile(filepath.FromSlash(s.configPath()))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil // missing → empty; caller applies defaults
		}
		return "", err
	}
	return string(b), nil
}

func (s *store) writeConfig(content string) error {
	if err := ensureDir(s.homeVela); err != nil {
		return err
	}
	return atomicWrite(s.configPath(), content)
}

// ── Per-folder trust (<folder>/.vela/trust.json) ──────────────────────────

func (s *store) trustPath() (string, error) {
	folder, err := s.folderRoot()
	if err != nil {
		return "", err
	}
	return folder + "/.vela/trust.json", nil
}

func (s *store) readTrust() (string, error) {
	p, err := s.trustPath()
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(filepath.FromSlash(p))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(b), nil
}

func (s *store) writeTrust(content string) error {
	folder, err := s.folderRoot()
	if err != nil {
		return err
	}
	if err := ensureDir(folder + "/.vela"); err != nil {
		return err
	}
	return atomicWrite(folder+"/.vela/trust.json", content)
}

// ── Watch (echo-suppressed external-edit detection for the current deck) ───

func (s *store) setCurrent(name string) {
	s.mu.Lock()
	s.currentDeck = name
	if s.folder != "" && name != "" {
		s.watchBaseline = fileMtime(s.folder + "/" + name)
	}
	s.mu.Unlock()
}

// checkChanged reports whether the current deck file changed on disk since the
// last reconciled baseline, suppressing echoes of our own writes (a change
// within watcherIgnoreMS of our last save is ignored, matching deck-io.js). On a
// genuine external change it advances the baseline and returns the deck name.
func (s *store) checkChanged() (bool, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.folder == "" || s.currentDeck == "" {
		return false, ""
	}
	m := fileMtime(s.folder + "/" + s.currentDeck)
	if m == 0 || m == s.watchBaseline {
		return false, ""
	}
	if time.Since(s.lastWriteAt) < watcherIgnoreMS*time.Millisecond {
		// Our own echo — accept the new mtime as baseline without reporting it.
		s.watchBaseline = m
		return false, ""
	}
	s.watchBaseline = m
	return true, s.currentDeck
}

func fileMtime(path string) int64 {
	info, err := os.Stat(filepath.FromSlash(path))
	if err != nil {
		return 0
	}
	return info.ModTime().UnixNano()
}

// ── shared filesystem helpers ──────────────────────────────────────────────

func ensureDir(path string) error {
	p := filepath.FromSlash(path)
	if info, err := os.Stat(p); err == nil {
		if info.IsDir() {
			return nil
		}
		return errNotDir
	}
	return os.MkdirAll(p, 0o700)
}

// refuseSymlinkTarget rejects writing THROUGH an existing symlink (so a planted
// symlink at the deck path cannot redirect a save outside the folder).
func refuseSymlinkTarget(path string) error {
	info, err := os.Lstat(filepath.FromSlash(path))
	if err != nil {
		return nil // does not exist yet — fine
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errEscape
	}
	return nil
}

// atomicWrite writes tmp then renames over the target, matching the tmp+move
// pattern the JS consumers used (config-store.js / trust.js / deck-io.js). A
// crash mid-write leaves either the old file intact or the new one committed.
func atomicWrite(path, content string) error {
	p := filepath.FromSlash(path)
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		// Fallback for filesystems refusing rename-over-existing.
		_ = os.Remove(p)
		if werr := os.WriteFile(p, []byte(content), 0o600); werr != nil {
			return werr
		}
		_ = os.Remove(tmp)
	}
	return nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
