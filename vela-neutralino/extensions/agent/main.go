// Vela hardened agent gatekeeper.
//
// This compiled binary is the ONLY process in the desktop app permitted to
// spawn a child process, and it can spawn nothing but the two whitelisted
// agent CLIs (`claude` / `copilot`). The webview never receives
// `os.spawnProcess` (it is absent from neutralino.config.json's
// nativeAllowList), so a deck-driven DOM-XSS cannot reach arbitrary command
// execution — at worst it can ask this gatekeeper to run one of the two
// agents, which is itself gated by the session-confirm UI in the webview.
//
// Node-free by design: a single static Go binary, stdlib only, cross-compiled
// per OS during the build. The agents are invoked as native executables, so
// there is no npm/.cmd shim to route through a shell.
//
// Transport: a loopback-only HTTP server on an ephemeral 127.0.0.1 port,
// authenticated by a random per-launch token. Both values are written to
// ~/.vela/agent-ext.{port,token} for the webview to read (the webview already
// has filesystem read on ~/.vela via fsGuard). This mirrors the serve.py
// channel pattern the monolith already speaks (part-engine.jsx).
//
// SECURITY INVARIANTS (covered by main_test.go + tests/test_desktop.py):
//   - provider id is validated against a hardcoded allowlist; unknown -> 400.
//   - the binary is a constant; the prompt is DATA only — passed on stdin
//     (claude) or as a single argv element (copilot). os/exec passes args as a
//     real array (no shell), so the prompt can never be reinterpreted.
//   - every agent runs with all filesystem / shell / web / edit tools disabled.
//   - requests without the matching token are rejected.

package main

import (
	"bufio"
	"bytes"
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
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ---------------------------------------------------------------------------
// Provider allowlist — the ONLY binaries this gatekeeper will ever launch.
// ---------------------------------------------------------------------------

type provider struct {
	ID    string
	Label string
	Bin   string
	// promptViaArg true => the prompt is passed as the -p argument (copilot);
	// false => the prompt is written to the child's stdin (claude).
	PromptViaArg bool
}

var providers = map[string]provider{
	"claude-code": {ID: "claude-code", Label: "Claude Code", Bin: "claude", PromptViaArg: false},
	"copilot-cli": {ID: "copilot-cli", Label: "GitHub Copilot CLI", Bin: "copilot", PromptViaArg: true},
}

func providerAllowed(id string) bool {
	_, ok := providers[id]
	return ok
}

// sendArgs returns the locked argument template for a provider. The prompt is
// only embedded for copilot (which has no stdin path); claude reads stdin.
//
// Neither template ever grants a tool: claude disables them all explicitly,
// copilot denies each capability and is never given --allow-tool /
// --allow-all-tools.
func sendArgs(id, prompt, model string) []string {
	switch id {
	case "claude-code":
		return []string{
			"-p",
			"--output-format", "json",
			"--dangerously-skip-permissions",
			"--disallowed-tools",
			"Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task",
		}
	case "copilot-cli":
		a := []string{
			"-p", prompt,
			"-s",
			"--no-ask-user",
			"--deny-tool", "shell",
			"--deny-tool", "write",
			"--deny-tool", "read",
			"--deny-tool", "url",
		}
		if model != "" {
			a = append(a, "--model", model)
		}
		return a
	}
	return nil
}

// ---------------------------------------------------------------------------
// Prompt serialisation — collapse {system, messages} into one transcript.
// ---------------------------------------------------------------------------

type message struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

func contentToString(raw json.RawMessage) string {
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return string(raw) // non-string content (multipart) — keep its JSON form
}

func serialiseConversation(system string, messages []message) string {
	var parts []string
	if system != "" {
		parts = append(parts, "<SYSTEM>\n"+system+"\n</SYSTEM>")
	}
	for _, m := range messages {
		role := strings.ToUpper(m.Role)
		if role == "" {
			role = "USER"
		}
		parts = append(parts, "<"+role+">\n"+contentToString(m.Content)+"\n</"+role+">")
	}
	return strings.Join(parts, "\n\n")
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

var ansiRe = regexp.MustCompile("\x1b\\[[0-9;]*[A-Za-z]")
var brailleRe = regexp.MustCompile("[⠀-⣿]")

func stripChrome(s string) string {
	s = ansiRe.ReplaceAllString(s, "")
	s = brailleRe.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

type sendResult struct {
	Text  string                 `json:"text"`
	Model string                 `json:"model"`
	Stats map[string]interface{} `json:"stats"`
}

func parseClaude(stdout string) sendResult {
	var env struct {
		Result      string  `json:"result"`
		Model       string  `json:"model"`
		SessionID   string  `json:"session_id"`
		TotalCost   float64 `json:"total_cost_usd"`
		Usage       struct {
			InputTokens         int `json:"input_tokens"`
			OutputTokens        int `json:"output_tokens"`
			CacheReadInputTokens int `json:"cache_read_input_tokens"`
			CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal([]byte(stdout), &env); err != nil {
		return sendResult{Text: stripChrome(stdout), Model: "claude-code", Stats: map[string]interface{}{}}
	}
	model := env.Model
	if model == "" {
		model = "claude-code"
	}
	return sendResult{
		Text:  env.Result,
		Model: model,
		Stats: map[string]interface{}{
			"model":               model,
			"input_tokens":        env.Usage.InputTokens,
			"output_tokens":       env.Usage.OutputTokens,
			"cache_read_tokens":   env.Usage.CacheReadInputTokens,
			"cache_create_tokens": env.Usage.CacheCreationInputTokens,
			"cost_usd":            env.TotalCost,
		},
	}
}

func parseCopilot(stdout string) sendResult {
	return sendResult{Text: stripChrome(stdout), Model: "copilot-cli", Stats: map[string]interface{}{"model": "copilot-cli"}}
}

// ---------------------------------------------------------------------------
// Child-process execution (the one place a process is created).
// runner is a package var so tests can substitute a mock — production code
// always uses execAgent, which never invokes a shell.
// ---------------------------------------------------------------------------

var runner = execAgent

// Live agent process trees. The shutdown handler reaps these before exiting:
// os.Exit reaps nothing itself, and on Unix a bare exit would orphan the whole
// group. Keyed by the tree so concurrent /send calls never collide.
var (
	liveMu    sync.Mutex
	liveTrees = map[*childTree]struct{}{}
)

func trackTree(t *childTree)   { liveMu.Lock(); liveTrees[t] = struct{}{}; liveMu.Unlock() }
func untrackTree(t *childTree) { liveMu.Lock(); delete(liveTrees, t); liveMu.Unlock() }

// reapChildren tears down every in-flight agent tree. Called from the shutdown
// path so closing the desktop window never leaves an agent (and its node
// subtree) running.
func reapChildren() {
	liveMu.Lock()
	defer liveMu.Unlock()
	for t := range liveTrees {
		t.killTree()
	}
}

func execAgent(ctx context.Context, bin string, args []string, stdin string) (string, error) {
	if _, err := exec.LookPath(bin); err != nil {
		return "", fmt.Errorf("agent binary not found: %s", bin)
	}
	cmd := exec.CommandContext(ctx, bin, args...) // args is a real argv — no shell
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Bind the agent's whole process tree to a job (Windows) / process group
	// (Unix) so a timeout, ctx cancel, or gatekeeper exit tears down the node
	// subtree too — not just the direct child (see procwatch_*.go). newChildTree
	// also wires cmd.Cancel to kill the tree on ctx cancellation. WaitDelay is a
	// backstop so a stuck child cannot wedge Wait if Cancel fails to reap it.
	tree := newChildTree(cmd)
	cmd.WaitDelay = 10 * time.Second
	if err := cmd.Start(); err != nil {
		tree.dispose()
		// An already-expired context surfaces here (Start refuses to launch);
		// report it as a timeout, matching the Wait path below.
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("%s timed out", bin)
		}
		return "", fmt.Errorf("%s failed to start: %v", bin, err)
	}
	_ = tree.enrol(cmd)
	trackTree(tree)
	err := cmd.Wait()
	untrackTree(tree)
	tree.dispose()

	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("%s timed out", bin)
	}
	if err != nil {
		msg := err.Error()
		if _, ok := err.(*exec.ExitError); ok {
			if s := strings.TrimSpace(stderr.String()); s != "" {
				msg = s
			}
			if len(msg) > 400 {
				msg = msg[:400]
			}
		}
		return "", fmt.Errorf("%s failed: %s", bin, msg)
	}
	return stdout.String(), nil
}

func detect(ctx context.Context, id string) map[string]interface{} {
	p, ok := providers[id]
	if !ok {
		return map[string]interface{}{"available": false, "version": nil}
	}
	c, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := runner(c, p.Bin, []string{"--version"}, "")
	if err != nil {
		return map[string]interface{}{"id": id, "label": p.Label, "available": false, "version": nil}
	}
	m := regexp.MustCompile(`\d+\.\d+(?:\.\d+)?`).FindString(stripChrome(out))
	var ver interface{}
	if m != "" {
		ver = m
	}
	return map[string]interface{}{"id": id, "label": p.Label, "available": m != "", "version": ver}
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

func tokensMatch(provided, expected string) bool {
	if len(provided) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

type sendRequest struct {
	Provider    string    `json:"provider"`
	System      string    `json:"system"`
	Messages    []message `json:"messages"`
	Model       string    `json:"model"`
	CallType    string    `json:"_callType"`
}

func writeJSON(w http.ResponseWriter, code int, obj interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(obj)
}

func newServer(token string) http.Handler {
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

	mux.HandleFunc("/detect", authed(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"ok": true,
			"providers": map[string]interface{}{
				"claude-code": detect(ctx, "claude-code"),
				"copilot-cli": detect(ctx, "copilot-cli"),
			},
		})
	}))

	mux.HandleFunc("/send", authed(func(w http.ResponseWriter, r *http.Request) {
		var req sendRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 16<<20)).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "bad json"})
			return
		}
		if !providerAllowed(req.Provider) {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "unknown provider"})
			return
		}
		p := providers[req.Provider]
		prompt := serialiseConversation(req.System, req.Messages)
		stdin := ""
		if !p.PromptViaArg {
			stdin = prompt
		}
		args := sendArgs(req.Provider, prompt, req.Model)

		timeout := 180 * time.Second
		if req.CallType == "create" {
			timeout = 300 * time.Second
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()

		t0 := time.Now()
		out, err := runner(ctx, p.Bin, args, stdin)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"ok": false, "error": err.Error()})
			return
		}
		var res sendResult
		if req.Provider == "claude-code" {
			res = parseClaude(out)
		} else {
			res = parseCopilot(out)
		}
		res.Stats["duration_ms"] = time.Since(t0).Milliseconds()
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"ok":         true,
			"text":       res.Text,
			"request_id": fmt.Sprintf("ext-%d", t0.UnixNano()),
			"stats":      res.Stats,
		})
	}))

	return withCORS(mux)
}

// withCORS lets the Neutralino webview (a different localhost origin) call the
// gatekeeper. The custom x-vela-token header makes browser requests "non-simple",
// so a preflight OPTIONS must be answered before the real request is allowed.
// No credentials are used, so a wildcard origin is safe.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, x-vela-token")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

func velaDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".vela"), nil
}

// logf appends a diagnostic line to ~/.vela/agent-ext.log. Best-effort — used to
// debug extension lifecycle (parent watch / orphan cleanup) on the desktop.
// VELA_AGENT_LOG_DIR overrides the destination (troubleshooting: point it at a
// project-local dir to capture a run without reading the user's home folder).
func logf(dir, format string, args ...interface{}) {
	if d := os.Getenv("VELA_AGENT_LOG_DIR"); d != "" {
		dir = d
	}
	_ = os.MkdirAll(dir, 0o700)
	f, err := os.OpenFile(filepath.Join(dir, "agent-ext.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "[%s] "+format+"\n", append([]interface{}{time.Now().Format("15:04:05")}, args...)...)
}

// Neutralino writes the extension handshake to stdin as a single JSON line:
// {"nlPort":<n>,"nlToken":"...","nlExtensionId":"...","nlConnectToken":"..."}.
type nlHandshake struct {
	NlPort json.RawMessage `json:"nlPort"`
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

// readNlPort reads the Neutralino handshake from stdin and returns its nlPort
// (empty if not received within the timeout / unparseable) together with a
// channel that is closed when stdin reaches EOF.
//
// Neutralino never sends a kill signal to extension processes — they must self
// terminate (see SECURITY.md / upstream issue #1299). It feeds the handshake
// JSON to the extension's stdin and keeps that pipe open for the life of the
// app, closing the write end only when the app exits. So stdin EOF is a
// reliable "parent is gone" signal that — unlike the loopback port watch below
// — is immune to ephemeral-port reuse (the pipe is bound to the actual parent
// process, not a port another window might later grab). It is the primary
// orphan-cleanup trigger; the port watch remains as a fallback.
func readNlPort(dir string) (string, <-chan struct{}) {
	ch := make(chan string, 1)
	stdinClosed := make(chan struct{})
	go func() {
		r := bufio.NewReader(os.Stdin)
		line, _ := r.ReadString('\n')
		logf(dir, "stdin handshake: %.200s", strings.TrimSpace(line))
		port := ""
		var h nlHandshake
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &h) == nil {
			port = parsePort(h.NlPort)
		}
		ch <- port
		_, _ = io.Copy(io.Discard, r) // blocks until stdin EOF (app exit)
		close(stdinClosed)
	}()
	select {
	case p := <-ch:
		return p, stdinClosed
	case <-time.After(3 * time.Second):
		return "", stdinClosed
	}
}

// portOpen reports whether something is accepting TCP connections at addr.
// Used to detect our window's Neutralino process exiting (its NL_PORT closes).
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
		fmt.Fprintf(os.Stderr, "[vela-agent] cannot locate home: %v\n", err)
		os.Exit(1)
	}
	_ = os.MkdirAll(dir, 0o700)
	startedAt := time.Now()

	// Read this window's Neutralino port from the stdin handshake and key our
	// handshake files by it, so multiple Vela windows never collide on one file.
	// stdinClosed fires on stdin EOF — the primary "Neutralino exited" signal.
	nlPort, stdinClosed := readNlPort(dir)
	suffix := ""
	if nlPort != "" {
		suffix = "-" + nlPort
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		fmt.Fprintf(os.Stderr, "[vela-agent] cannot mint token: %v\n", err)
		os.Exit(1)
	}
	token := hex.EncodeToString(tokenBytes)

	portFile := filepath.Join(dir, "agent-ext"+suffix+".port")
	tokenFile := filepath.Join(dir, "agent-ext"+suffix+".token")

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintf(os.Stderr, "[vela-agent] cannot bind loopback: %v\n", err)
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	if err := os.WriteFile(tokenFile, []byte(token), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "[vela-agent] cannot write token: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(portFile, []byte(fmt.Sprintf("%d", port)), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "[vela-agent] cannot write port: %v\n", err)
		os.Exit(1)
	}

	ppid := os.Getppid()
	logf(dir, "start pid=%d ppid=%d parent=%q nlPort=%q port=%d logDir=%q",
		os.Getpid(), ppid, processName(ppid), nlPort, port, os.Getenv("VELA_AGENT_LOG_DIR"))

	cleanup := func() {
		_ = os.Remove(portFile)
		_ = os.Remove(tokenFile)
	}

	srv := &http.Server{Handler: newServer(token)}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)

	// Primary orphan-cleanup signal: stdin EOF. Neutralino keeps the
	// extension's stdin open for the life of the app and closes it on exit, so
	// EOF means "parent is gone" — and unlike the port watch it cannot be fooled
	// by another window reusing this one's old ephemeral nlPort. Guarded by a
	// startup grace window: if stdin closes almost immediately (a platform that
	// hands off the handshake and then closes stdin rather than holding it open),
	// we ignore it and lean on the port watch instead of exiting at launch.
	go func() {
		<-stdinClosed
		if up := time.Since(startedAt); up < 5*time.Second {
			logf(dir, "stdin closed early (%.1fs) — ignoring, relying on port watch", up.Seconds())
			return
		}
		logf(dir, "stdin EOF (neutralino exit), exiting nlPort=%s", nlPort)
		sig <- syscall.SIGTERM
	}()

	// Primary signal on Windows: block on the parent's process HANDLE. It is
	// bound to the actual process object (not the PID number), so it cannot be
	// fooled by PID reuse the way the ppid poll below can. No-op on Unix, where
	// stdin EOF and the poll cover it.
	if parentGone := watchParentExit(dir); parentGone != nil {
		go func() {
			<-parentGone
			logf(dir, "SIGNAL parent-handle: parent exited, sending SIGTERM")
			sig <- syscall.SIGTERM
		}()
	}

	// Fallback signal: this window's Neutralino NL_PORT stops accepting TCP
	// connections (PID-independent). When nlPort is unknown, fall back further to
	// the parent PID. Two consecutive misses (~8s) before exiting, to ride out a
	// transient probe failure.
	go func() {
		misses := 0
		for {
			time.Sleep(4 * time.Second)
			alive := true
			how := ""
			if nlPort != "" {
				alive = portOpen("127.0.0.1:" + nlPort)
				how = "portOpen(" + nlPort + ")"
			} else if ppid > 1 {
				alive = parentAlive(ppid)
				how = fmt.Sprintf("parentAlive(%d)", ppid)
			} else {
				how = "no-signal"
			}
			if alive {
				misses = 0
				continue
			}
			logf(dir, "port/ppid watch: %s reported gone (miss %d/2)", how, misses+1)
			if misses++; misses >= 2 {
				logf(dir, "SIGNAL port/ppid: neutralino gone via %s, sending SIGTERM", how)
				sig <- syscall.SIGTERM
				return
			}
		}
	}()

	// Heartbeat: periodic liveness + watcher state, so a run's log shows exactly
	// which signals were live and what each reported right up to app close.
	go func() {
		for {
			time.Sleep(60 * time.Second)
			po := "n/a"
			if nlPort != "" {
				po = fmt.Sprintf("%v", portOpen("127.0.0.1:"+nlPort))
			}
			logf(dir, "heartbeat uptime=%.0fs ppid=%d parentAlive=%v portOpen=%s",
				time.Since(startedAt).Seconds(), ppid, parentAlive(ppid), po)
		}
	}()

	go func() {
		s := <-sig
		logf(dir, "shutdown: received %v — cleanup+reap+srv.Shutdown", s)
		cleanup()
		reapChildren() // tear down any in-flight agent trees before exiting
		ctx, c := context.WithTimeout(context.Background(), 2*time.Second)
		defer c()
		_ = srv.Shutdown(ctx)
		logf(dir, "shutdown: srv.Shutdown returned, exiting now")
		os.Exit(0)
	}()

	logf(dir, "ready: watchers armed (stdin-eof, parent-handle, port/ppid), serving on 127.0.0.1:%d", port)
	fmt.Printf("[vela-agent] listening on 127.0.0.1:%d\n", port)
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintf(os.Stderr, "[vela-agent] server error: %v\n", err)
		cleanup()
		os.Exit(1)
	}
}
