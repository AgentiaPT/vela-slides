// Vela filesystem broker.
//
// This compiled binary is the ONLY process in the desktop app with filesystem
// access. The webview page has NO ambient filesystem authority: `filesystem.*`
// is absent from neutralino.config.json's nativeAllowList, so a deck-driven
// DOM-XSS that reaches page execution can no longer call the raw Neutralino
// transport to read or overwrite arbitrary files. Instead the page can only
// *request* one of a small set of narrow, semantic, folder-scoped operations
// from this broker — the Electron contextIsolation/contextBridge model. The
// page never holds or widens the trust policy; the broker owns it.
//
// Transport mirrors the agent gatekeeper (extensions/agent): a loopback-only
// HTTP server on an ephemeral 127.0.0.1 port, authenticated by a random
// per-launch token, CORS-pinned to this window's loopback origin. The broker
// hands its {port, token} to the page WITHOUT the page touching the filesystem,
// by pushing a Neutralino extension→app event (app.broadcast, see nlclient.go).
//
// SECURITY INVARIANTS (covered by *_test.go + tests/test_desktop.py):
//   - every path resolves inside a validated trust root (~/.vela + the chosen
//     decks folder); volume / shallow / system roots are refused (scope.go).
//   - deck names must be safe basenames; saves must end in .vela/.json.
//   - requests without the matching token are rejected (401); bind is loopback
//     only; a foreign browser Origin is refused even with a valid token.
//   - the broker self-terminates when the Neutralino app exits (Neutralino never
//     kills extensions — upstream #1299), via stdin EOF + port/handle watches.

package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// fsReadyEvent is the Neutralino event the page listens for to learn the
// broker's {port, token}. Kept in lockstep with resources/js/fs-bridge.js.
const fsReadyEvent = "velaFsReady"

var st *store

func writeJSON(w http.ResponseWriter, code int, obj interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(obj)
}

func tokensMatch(provided, expected string) bool {
	if len(provided) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func decodeBody(r *http.Request, dst interface{}) error {
	return json.NewDecoder(io.LimitReader(r.Body, 64<<20)).Decode(dst)
}

func newServer(token, nlPort string) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
	})

	authed := func(next func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				writeJSON(w, http.StatusNotFound, map[string]interface{}{"ok": false, "error": "not found"})
				return
			}
			if !tokensMatch(r.Header.Get("x-vela-token"), token) {
				writeJSON(w, http.StatusUnauthorized, map[string]interface{}{"ok": false, "error": "unauthorized"})
				return
			}
			next(w, r)
		}
	}

	// ── Folder ──────────────────────────────────────────────────────────────
	mux.HandleFunc("/folder", authed(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Path string `json:"path"`
		}
		if err := decodeBody(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errObj("bad json"))
			return
		}
		folder, err := st.setFolder(req.Path)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errObj(err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "folder": folder})
	}))

	// ── Decks ───────────────────────────────────────────────────────────────
	mux.HandleFunc("/decks/list", authed(func(w http.ResponseWriter, r *http.Request) {
		names, err := st.listDecks()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errObj(err.Error()))
			return
		}
		decks := make([]map[string]string, 0, len(names))
		for _, n := range names {
			decks = append(decks, map[string]string{"name": n})
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "decks": decks})
	}))

	mux.HandleFunc("/decks/read", authed(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name string `json:"name"`
		}
		if err := decodeBody(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errObj("bad json"))
			return
		}
		content, err := st.readDeck(req.Name)
		if err != nil {
			writeJSON(w, statusFor(err), errObj(err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "content": content})
	}))

	mux.HandleFunc("/decks/save", authed(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name    string `json:"name"`
			Content string `json:"content"`
		}
		if err := decodeBody(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errObj("bad json"))
			return
		}
		if err := st.saveDeck(req.Name, req.Content); err != nil {
			writeJSON(w, statusFor(err), errObj(err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
	}))

	mux.HandleFunc("/decks/new", authed(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Title string `json:"title"`
		}
		if err := decodeBody(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errObj("bad json"))
			return
		}
		name, err := st.newDeck(req.Title)
		if err != nil {
			writeJSON(w, statusFor(err), errObj(err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "name": name})
	}))

	mux.HandleFunc("/decks/exists", authed(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name string `json:"name"`
		}
		if err := decodeBody(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errObj("bad json"))
			return
		}
		ok, err := st.deckExists(req.Name)
		if err != nil {
			writeJSON(w, statusFor(err), errObj(err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "exists": ok})
	}))

	// ── Watch (long-poll; echo-suppressed external-edit detection) ───────────
	mux.HandleFunc("/watch/set", authed(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name string `json:"name"`
		}
		if err := decodeBody(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errObj("bad json"))
			return
		}
		st.setCurrent(req.Name)
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
	}))

	mux.HandleFunc("/watch/poll", authed(func(w http.ResponseWriter, r *http.Request) {
		deadline := time.Now().Add(25 * time.Second)
		for time.Now().Before(deadline) {
			if changed, name := st.checkChanged(); changed {
				writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "changed": true, "name": name})
				return
			}
			select {
			case <-r.Context().Done():
				return
			case <-time.After(300 * time.Millisecond):
			}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "changed": false})
	}))

	// ── Config (~/.vela/config.json) ─────────────────────────────────────────
	mux.HandleFunc("/config/get", authed(func(w http.ResponseWriter, r *http.Request) {
		content, err := st.readConfig()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errObj(err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "content": content})
	}))

	mux.HandleFunc("/config/put", authed(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Content string `json:"content"`
		}
		if err := decodeBody(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errObj("bad json"))
			return
		}
		if err := st.writeConfig(req.Content); err != nil {
			writeJSON(w, http.StatusInternalServerError, errObj(err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
	}))

	// ── Per-folder trust (<folder>/.vela/trust.json) ─────────────────────────
	mux.HandleFunc("/trust/get", authed(func(w http.ResponseWriter, r *http.Request) {
		content, err := st.readTrust()
		if err != nil {
			writeJSON(w, statusFor(err), errObj(err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "content": content})
	}))

	mux.HandleFunc("/trust/put", authed(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Content string `json:"content"`
		}
		if err := decodeBody(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, errObj("bad json"))
			return
		}
		if err := st.writeTrust(req.Content); err != nil {
			writeJSON(w, statusFor(err), errObj(err.Error()))
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
	}))

	// ── Agent handshake relay ────────────────────────────────────────────────
	// The page can no longer read the AGENT gatekeeper's handshake files (no FS).
	// The broker reads them (keyed by this window's NL_PORT, same scheme as the
	// gatekeeper) and relays {port, token} so agents-bridge.js can reach the
	// agent extension. Only these two fixed files are ever exposed.
	mux.HandleFunc("/agent-handshake", authed(func(w http.ResponseWriter, r *http.Request) {
		hs := readAgentHandshake(st.homeVela, nlPort)
		if hs == nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "available": false})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "available": true, "port": hs["port"], "token": hs["token"]})
	}))

	return withCORS(mux, nlPort)
}

func errObj(msg string) map[string]interface{} {
	return map[string]interface{}{"ok": false, "error": msg}
}

// statusFor maps a store error to an HTTP status. A validation reject (bad name /
// extension / escape / unsafe root) is a 400; a missing selection is a 400; other
// I/O errors are 500.
func statusFor(err error) int {
	switch {
	case errors.Is(err, errBadName), errors.Is(err, errBadExt), errors.Is(err, errEscape),
		errors.Is(err, errBadRoot), errors.Is(err, errNoFolder), errors.Is(err, errNotDir):
		return http.StatusBadRequest
	case os.IsNotExist(err):
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

// readAgentHandshake reads the agent gatekeeper's port/token files (keyed by
// NL_PORT, with an unkeyed fallback) from ~/.vela.
func readAgentHandshake(homeVela, nlPort string) map[string]string {
	suffixes := []string{}
	if nlPort != "" {
		suffixes = append(suffixes, "-"+nlPort)
	}
	suffixes = append(suffixes, "")
	for _, sfx := range suffixes {
		pb, e1 := os.ReadFile(filepath.FromSlash(homeVela + "/agent-ext" + sfx + ".port"))
		tb, e2 := os.ReadFile(filepath.FromSlash(homeVela + "/agent-ext" + sfx + ".token"))
		if e1 == nil && e2 == nil {
			port := strings.TrimSpace(string(pb))
			tok := strings.TrimSpace(string(tb))
			if port != "" && tok != "" {
				return map[string]string{"port": port, "token": tok}
			}
		}
	}
	return nil
}

// ── CORS (origin-pinned to this window's loopback, never a wildcard) ─────────

func allowedOrigin(origin, nlPort string) bool {
	if origin == "" {
		return true
	}
	for _, host := range []string{"http://localhost", "http://127.0.0.1"} {
		if nlPort != "" {
			if origin == host+":"+nlPort {
				return true
			}
			continue
		}
		if origin == host || strings.HasPrefix(origin, host+":") {
			return true
		}
	}
	return false
}

func withCORS(next http.Handler, nlPort string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if !allowedOrigin(origin, nlPort) {
			writeJSON(w, http.StatusForbidden, errObj("forbidden origin"))
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, x-vela-token")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

func velaDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".vela"), nil
}

func logf(dir, format string, args ...interface{}) {
	if d := os.Getenv("VELA_FS_LOG_DIR"); d != "" {
		dir = d
	}
	_ = os.MkdirAll(dir, 0o700)
	f, err := os.OpenFile(filepath.Join(dir, "fs-ext.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "[%s] "+format+"\n", append([]interface{}{time.Now().Format("15:04:05")}, args...)...)
}

// nlHandshake is the JSON line Neutralino feeds the extension on stdin.
type nlHandshake struct {
	NlPort         json.RawMessage `json:"nlPort"`
	NlToken        string          `json:"nlToken"`
	NlConnectToken string          `json:"nlConnectToken"`
	NlExtensionID  string          `json:"nlExtensionId"`
}

func parsePort(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var n float64
	if json.Unmarshal(raw, &n) == nil && n > 0 {
		return strconv.Itoa(int(n))
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return ""
}

// readHandshake reads the Neutralino stdin handshake and returns the parsed
// config plus a channel closed on stdin EOF (the primary "app exited" signal).
func readHandshake(dir string) (nlConfig, <-chan struct{}) {
	ch := make(chan nlConfig, 1)
	stdinClosed := make(chan struct{})
	go func() {
		r := bufio.NewReader(os.Stdin)
		line, _ := r.ReadString('\n')
		logf(dir, "stdin handshake: %.200s", strings.TrimSpace(line))
		var cfg nlConfig
		var h nlHandshake
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &h) == nil {
			cfg = nlConfig{Port: parsePort(h.NlPort), Token: h.NlToken, ConnectToken: h.NlConnectToken, ExtensionID: h.NlExtensionID}
		}
		ch <- cfg
		_, _ = io.Copy(io.Discard, r) // blocks until stdin EOF (app exit)
		close(stdinClosed)
	}()
	select {
	case c := <-ch:
		return c, stdinClosed
	case <-time.After(3 * time.Second):
		return nlConfig{}, stdinClosed
	}
}

func portOpen(addr string) bool {
	c, err := net.DialTimeout("tcp", addr, 800*time.Millisecond)
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}

func main() {
	dir, err := velaDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[vela-fs] cannot locate home: %v\n", err)
		os.Exit(1)
	}
	_ = os.MkdirAll(dir, 0o700)
	startedAt := time.Now()

	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[vela-fs] cannot locate home: %v\n", err)
		os.Exit(1)
	}
	st = newStore(home)

	cfg, stdinClosed := readHandshake(dir)
	nlPort := cfg.Port
	suffix := ""
	if nlPort != "" {
		suffix = "-" + nlPort
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		fmt.Fprintf(os.Stderr, "[vela-fs] cannot mint token: %v\n", err)
		os.Exit(1)
	}
	token := hex.EncodeToString(tokenBytes)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintf(os.Stderr, "[vela-fs] cannot bind loopback: %v\n", err)
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	// Handshake files (0600, keyed by NL_PORT) are written for parity with the
	// agent gatekeeper and for local debugging ONLY. The page does NOT read them
	// (it has no filesystem authority) — it receives {port, token} via the
	// app.broadcast event below. Cleaned up on shutdown.
	portFile := filepath.Join(dir, "fs-ext"+suffix+".port")
	tokenFile := filepath.Join(dir, "fs-ext"+suffix+".token")
	_ = os.WriteFile(tokenFile, []byte(token), 0o600)
	_ = os.WriteFile(portFile, []byte(fmt.Sprintf("%d", port)), 0o600)

	logf(dir, "start pid=%d nlPort=%q extId=%q port=%d", os.Getpid(), nlPort, cfg.ExtensionID, port)

	cleanup := func() {
		_ = os.Remove(portFile)
		_ = os.Remove(tokenFile)
	}

	// Push {port, token} to the page over the Neutralino app.broadcast channel.
	stopBroadcast := make(chan struct{})
	go broadcastLoop(cfg, fsReadyEvent, map[string]string{"port": strconv.Itoa(port), "token": token},
		stopBroadcast, func(f string, a ...interface{}) { logf(dir, f, a...) })

	srv := &http.Server{Handler: newServer(token, nlPort)}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)

	// Self-terminate on Neutralino exit (upstream #1299). stdin EOF is primary
	// (immune to ephemeral-port reuse); the port/handle watches are fallbacks.
	go func() {
		<-stdinClosed
		if up := time.Since(startedAt); up < 5*time.Second {
			logf(dir, "stdin closed early (%.1fs) — ignoring, relying on port watch", up.Seconds())
			return
		}
		logf(dir, "stdin EOF (neutralino exit), exiting nlPort=%s", nlPort)
		sig <- syscall.SIGTERM
	}()

	if parentGone := watchParentExit(dir); parentGone != nil {
		go func() {
			<-parentGone
			logf(dir, "parent-handle: app exited, sending SIGTERM")
			sig <- syscall.SIGTERM
		}()
	}

	go func() {
		ppid := os.Getppid()
		misses := 0
		for {
			time.Sleep(4 * time.Second)
			alive := true
			if nlPort != "" {
				alive = portOpen("127.0.0.1:" + nlPort)
			} else if ppid > 1 {
				alive = parentAlive(ppid)
			}
			if alive {
				misses = 0
				continue
			}
			if misses++; misses >= 2 {
				logf(dir, "port/ppid watch: neutralino gone, sending SIGTERM")
				sig <- syscall.SIGTERM
				return
			}
		}
	}()

	go func() {
		s := <-sig
		logf(dir, "shutdown: received %v", s)
		close(stopBroadcast)
		cleanup()
		ctx, c := context.WithTimeout(context.Background(), 2*time.Second)
		defer c()
		_ = srv.Shutdown(ctx)
		os.Exit(0)
	}()

	logf(dir, "ready: serving on 127.0.0.1:%d", port)
	fmt.Printf("[vela-fs] listening on 127.0.0.1:%d\n", port)
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintf(os.Stderr, "[vela-fs] server error: %v\n", err)
		cleanup()
		os.Exit(1)
	}
}
