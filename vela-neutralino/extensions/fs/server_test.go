package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// setupServer installs a global store with a selected temp folder and returns a
// running test server plus its token.
func setupServer(t *testing.T) (*httptest.Server, string, string) {
	t.Helper()
	home := t.TempDir()
	st = newStore(home)
	folder := filepath.Join(t.TempDir(), "decks")
	os.MkdirAll(folder, 0o755)
	if _, err := st.setFolder(folder); err != nil {
		t.Fatal(err)
	}
	const token = "secret-token"
	const nlPort = "45999"
	ts := httptest.NewServer(newServer(token, nlPort))
	t.Cleanup(ts.Close)
	return ts, token, filepath.ToSlash(folder)
}

func post(t *testing.T, ts *httptest.Server, path, tok string, body interface{}) (int, map[string]interface{}) {
	t.Helper()
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

func TestServerTokenAuth(t *testing.T) {
	ts, token, _ := setupServer(t)
	if code, _ := post(t, ts, "/decks/list", "", nil); code != http.StatusUnauthorized {
		t.Fatalf("missing token must be 401, got %d", code)
	}
	if code, _ := post(t, ts, "/decks/list", "wrong", nil); code != http.StatusUnauthorized {
		t.Fatalf("wrong token must be 401, got %d", code)
	}
	if code, body := post(t, ts, "/decks/list", token, nil); code != 200 || body["ok"] != true {
		t.Fatalf("valid token must be 200 ok, got %d %v", code, body)
	}
}

func TestServerHealthNoAuth(t *testing.T) {
	ts, _, _ := setupServer(t)
	resp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("/health must be 200 without a token, got %d", resp.StatusCode)
	}
}

func TestServerSaveExtensionRejectedOverHTTP(t *testing.T) {
	ts, token, _ := setupServer(t)
	code, body := post(t, ts, "/decks/save", token, map[string]string{"name": "evil.sh", "content": "x"})
	if code != http.StatusBadRequest {
		t.Fatalf("save of .sh must be 400, got %d %v", code, body)
	}
	code, _ = post(t, ts, "/decks/save", token, map[string]string{"name": "ok.vela", "content": "{}"})
	if code != 200 {
		t.Fatalf("save of .vela must be 200, got %d", code)
	}
}

func TestServerReadTraversalRejectedOverHTTP(t *testing.T) {
	ts, token, _ := setupServer(t)
	code, _ := post(t, ts, "/decks/read", token, map[string]string{"name": "../../etc/passwd"})
	if code != http.StatusBadRequest {
		t.Fatalf("traversal read must be 400, got %d", code)
	}
}

func TestServerFolderValidationOverHTTP(t *testing.T) {
	ts, token, _ := setupServer(t)
	code, _ := post(t, ts, "/folder", token, map[string]string{"path": "/etc"})
	if code != http.StatusBadRequest {
		t.Fatalf("setting /etc as folder must be 400, got %d", code)
	}
}

func TestServerCORSForeignOriginRejected(t *testing.T) {
	ts, token, _ := setupServer(t)
	// Foreign-origin POST with the CORRECT token must still be refused (403) by
	// the origin gate before reaching any handler.
	var buf bytes.Buffer
	json.NewEncoder(&buf).Encode(map[string]string{"name": "x.vela", "content": "{}"})
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/decks/save", &buf)
	req.Header.Set("x-vela-token", token)
	req.Header.Set("Origin", "https://evil.example")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign-origin request with valid token must be 403, got %d", resp.StatusCode)
	}
	if resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("foreign origin must not receive an Access-Control-Allow-Origin")
	}
}

func TestAllowedOrigin(t *testing.T) {
	for _, ok := range []string{"http://localhost:45999", "http://127.0.0.1:45999", ""} {
		if !allowedOrigin(ok, "45999") {
			t.Fatalf("origin %q should be allowed", ok)
		}
	}
	for _, bad := range []string{
		"http://localhost:5173", "http://evil.example",
		"https://localhost:45999", "http://localhost.evil.com:45999", "null",
	} {
		if allowedOrigin(bad, "45999") {
			t.Fatalf("origin %q should be rejected", bad)
		}
	}
}
