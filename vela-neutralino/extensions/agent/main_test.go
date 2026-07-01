// Security-invariant tests for the Vela agent gatekeeper.
// Run: `go test ./...` from vela-neutralino/extensions/agent (stdlib only, no
// network/agents needed — the exec layer is replaced with a mock `runner`).

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestProviderAllowlist(t *testing.T) {
	for _, ok := range []string{"claude-code", "copilot-cli"} {
		if !providerAllowed(ok) {
			t.Fatalf("expected %q allowed", ok)
		}
	}
	for _, bad := range []string{"bash", "node", "../../bin/sh", "", "claude"} {
		if providerAllowed(bad) {
			t.Fatalf("expected %q rejected", bad)
		}
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func TestSendArgsClaudeDisablesAllTools(t *testing.T) {
	a := sendArgs("claude-code", "PROMPT", "")
	if !contains(a, "-p") || !contains(a, "--disallowed-tools") {
		t.Fatal("claude must run print mode with disallowed-tools")
	}
	idx := indexOf(a, "--disallowed-tools")
	tools := a[idx+1]
	for _, want := range []string{"Bash", "Edit", "Write", "Read", "WebFetch", "WebSearch"} {
		if !strings.Contains(tools, want) {
			t.Fatalf("claude must disable %s", want)
		}
	}
	if contains(a, "--allow-all-tools") {
		t.Fatal("claude must never allow-all-tools")
	}
	// claude takes the prompt on stdin, never as an arg.
	if contains(a, "PROMPT") {
		t.Fatal("claude prompt must not be an argv element")
	}
}

func TestSendArgsCopilotDeniesEveryTool(t *testing.T) {
	a := sendArgs("copilot-cli", "PROMPT", "gpt-5.2")
	if a[0] != "-p" || a[1] != "PROMPT" {
		t.Fatal("copilot prompt must be the single -p argv element")
	}
	if !contains(a, "-s") || !contains(a, "--no-ask-user") {
		t.Fatal("copilot must run silent + no-ask-user")
	}
	for _, tool := range []string{"shell", "write", "read", "url"} {
		if !contains(a, tool) {
			t.Fatalf("copilot must --deny-tool %s", tool)
		}
	}
	if contains(a, "--allow-all-tools") || contains(a, "--allow-tool") {
		t.Fatal("copilot must never allow tools")
	}
	if !contains(a, "--model") || !contains(a, "gpt-5.2") {
		t.Fatal("copilot --model should pass through when set")
	}
	if contains(sendArgs("copilot-cli", "x", ""), "--model") {
		t.Fatal("copilot --model should be absent when unset")
	}
}

func indexOf(s []string, v string) int {
	for i, x := range s {
		if x == v {
			return i
		}
	}
	return -1
}

func TestResolveAgentBinRejectsMissing(t *testing.T) {
	if _, err := resolveAgentBin("vela-nonexistent-agent-xyz"); err == nil {
		t.Fatal("missing binary must be rejected")
	}
}

func TestResolveAgentBinAbsolute(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PATHEXT / ACL semantics differ; covered on POSIX")
	}
	dir := t.TempDir() // 0700, under a sticky /tmp — accepted
	bin := filepath.Join(dir, "faux-agent")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	got, err := resolveAgentBin("faux-agent")
	if err != nil {
		t.Fatalf("expected resolution, got error: %v", err)
	}
	if !filepath.IsAbs(got) {
		t.Fatalf("resolved path must be absolute, got %q", got)
	}
	if got != bin {
		t.Fatalf("resolved %q, want %q", got, bin)
	}
}

func TestResolveAgentBinRejectsWorldWritable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("world-writable check is POSIX-only (FileMode != NTFS ACL)")
	}
	// A world-writable binary file — any local account could rewrite it.
	dir := t.TempDir()
	bin := filepath.Join(dir, "faux-agent")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(bin, 0o777); err != nil { // set exact bits, bypassing umask
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if _, err := resolveAgentBin("faux-agent"); err == nil {
		t.Fatal("world-writable binary must be rejected")
	}

	// A binary in a world-writable, non-sticky directory — swap-able.
	wdir := filepath.Join(t.TempDir(), "open")
	if err := os.Mkdir(wdir, 0o777); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(wdir, 0o777); err != nil { // clear any umask masking
		t.Fatal(err)
	}
	wbin := filepath.Join(wdir, "faux-agent")
	if err := os.WriteFile(wbin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", wdir)
	if _, err := resolveAgentBin("faux-agent"); err == nil {
		t.Fatal("binary under world-writable non-sticky dir must be rejected")
	}
}

func TestSerialiseConversation(t *testing.T) {
	s := serialiseConversation("sys", []message{
		{Role: "user", Content: json.RawMessage(`"u1"`)},
		{Role: "assistant", Content: json.RawMessage(`"a1"`)},
	})
	for _, want := range []string{"<SYSTEM>", "sys", "<USER>", "u1", "<ASSISTANT>", "a1"} {
		if !strings.Contains(s, want) {
			t.Fatalf("serialised transcript missing %q", want)
		}
	}
}

func TestParseClaudeAndStripChrome(t *testing.T) {
	r := parseClaude(`{"result":"answer","model":"claude-x","total_cost_usd":0.02}`)
	if r.Text != "answer" || r.Model != "claude-x" {
		t.Fatalf("bad parse: %+v", r)
	}
	if parseClaude("not json").Text != "not json" {
		t.Fatal("claude fallback should keep raw text")
	}
	if stripChrome("\x1b[31mred\x1b[0m") != "red" {
		t.Fatal("ANSI must be stripped")
	}
	if stripChrome("see [note] here") != "see [note] here" {
		t.Fatal("bracketed words must survive")
	}
}

func TestParsePort(t *testing.T) {
	cases := map[string]string{
		`57784`:   "57784", // number form (Neutralino sends nlPort as a number)
		`"57784"`: "57784", // string form
		`0`:       "",
		`null`:    "",
		`"abc"`:   "abc",
	}
	for raw, want := range cases {
		if got := parsePort([]byte(raw)); got != want {
			t.Fatalf("parsePort(%s) = %q, want %q", raw, got, want)
		}
	}
	if parsePort(nil) != "" {
		t.Fatal("parsePort(nil) must be empty")
	}
}

func TestTokensMatch(t *testing.T) {
	if !tokensMatch("abc", "abc") {
		t.Fatal("equal tokens should match")
	}
	for _, bad := range [][2]string{{"abc", "abd"}, {"abc", "abcd"}, {"", "x"}} {
		if tokensMatch(bad[0], bad[1]) {
			t.Fatalf("%v should not match", bad)
		}
	}
}

// ── HTTP layer with a mocked agent runner ───────────────────────────────────

func TestServerAuthAndRouting(t *testing.T) {
	const token = "secret-token"
	orig := runner
	runner = func(ctx context.Context, bin string, args []string, stdin string) (string, error) {
		if bin == "claude" && contains(args, "--version") {
			return "claude 1.2.3", nil
		}
		return `{"result":"ok"}`, nil
	}
	defer func() { runner = orig }()

	const nlPort = "45999"
	ts := httptest.NewServer(newServer(token, nlPort))
	defer ts.Close()

	post := func(path, tok string, body interface{}) (int, map[string]interface{}) {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req, _ := http.NewRequest(http.MethodPost, ts.URL+path, &buf)
		if tok != "" {
			req.Header.Set("x-vela-token", tok)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}

	if code, _ := post("/detect", "", nil); code != http.StatusUnauthorized {
		t.Fatalf("missing token must be 401, got %d", code)
	}
	if code, _ := post("/detect", "wrong", nil); code != http.StatusUnauthorized {
		t.Fatalf("wrong token must be 401, got %d", code)
	}
	if code, body := post("/detect", token, nil); code != 200 || body["providers"] == nil {
		t.Fatalf("detect failed: %d %v", code, body)
	}
	if code, body := post("/send", token, map[string]interface{}{
		"provider": "claude-code", "messages": []map[string]string{{"role": "user", "content": "hi"}},
	}); code != 200 || body["text"] != "ok" {
		t.Fatalf("send failed: %d %v", code, body)
	}
	if code, _ := post("/send", token, map[string]interface{}{"provider": "bash"}); code != http.StatusBadRequest {
		t.Fatalf("unknown provider must be 400, got %d", code)
	}

	// CORS preflight from this window's own loopback origin: OPTIONS must
	// succeed without a token, echo that exact origin (never a wildcard), and
	// advertise the custom header.
	const webOrigin = "http://localhost:" + nlPort
	optReq, _ := http.NewRequest(http.MethodOptions, ts.URL+"/detect", nil)
	optReq.Header.Set("Origin", webOrigin)
	optResp, err := http.DefaultClient.Do(optReq)
	if err != nil {
		t.Fatal(err)
	}
	optResp.Body.Close()
	if optResp.StatusCode != http.StatusNoContent {
		t.Fatalf("OPTIONS preflight must be 204, got %d", optResp.StatusCode)
	}
	if got := optResp.Header.Get("Access-Control-Allow-Origin"); got != webOrigin {
		t.Fatalf("preflight must echo the window origin, got %q", got)
	}
	if !strings.Contains(optResp.Header.Get("Access-Control-Allow-Headers"), "x-vela-token") {
		t.Fatal("preflight must allow x-vela-token header")
	}

	// A foreign browser origin must be refused outright (defense-in-depth against
	// a leaked token being replayed from another page) — even for OPTIONS.
	badReq, _ := http.NewRequest(http.MethodOptions, ts.URL+"/detect", nil)
	badReq.Header.Set("Origin", "https://evil.example")
	badResp, err := http.DefaultClient.Do(badReq)
	if err != nil {
		t.Fatal(err)
	}
	badResp.Body.Close()
	if badResp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign-origin preflight must be 403, got %d", badResp.StatusCode)
	}
	if badResp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("foreign origin must not receive an Access-Control-Allow-Origin")
	}

	// A foreign-origin POST carrying the *correct* token is still refused by the
	// origin gate before it can reach the spawn path.
	var pb bytes.Buffer
	_ = json.NewEncoder(&pb).Encode(map[string]interface{}{"provider": "claude-code"})
	fReq, _ := http.NewRequest(http.MethodPost, ts.URL+"/send", &pb)
	fReq.Header.Set("x-vela-token", token)
	fReq.Header.Set("Origin", "https://evil.example")
	fResp, err := http.DefaultClient.Do(fReq)
	if err != nil {
		t.Fatal(err)
	}
	fResp.Body.Close()
	if fResp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign-origin /send with valid token must be 403, got %d", fResp.StatusCode)
	}
}

func TestAllowedOrigin(t *testing.T) {
	// With the window's NL_PORT known, only that exact loopback origin passes.
	for _, ok := range []string{"http://localhost:45999", "http://127.0.0.1:45999", ""} {
		if !allowedOrigin(ok, "45999") {
			t.Fatalf("origin %q should be allowed", ok)
		}
	}
	for _, bad := range []string{
		"http://localhost:5173",       // wrong port
		"http://evil.example",         // remote host
		"https://localhost:45999",     // https, not the loopback http origin
		"http://localhost.evil.com:45999",
		"null",
	} {
		if allowedOrigin(bad, "45999") {
			t.Fatalf("origin %q should be rejected", bad)
		}
	}
	// Handshake missed (nlPort unknown): any loopback http origin is allowed,
	// every off-machine origin still rejected.
	if !allowedOrigin("http://localhost:1234", "") || !allowedOrigin("http://127.0.0.1:9", "") {
		t.Fatal("loopback origins must be allowed when nlPort is unknown")
	}
	if allowedOrigin("http://evil.example", "") {
		t.Fatal("remote origin must be rejected even when nlPort is unknown")
	}
}
