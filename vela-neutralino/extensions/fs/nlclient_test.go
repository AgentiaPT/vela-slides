package main

import (
	"bufio"
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestFrameRoundTrip(t *testing.T) {
	payloads := [][]byte{
		[]byte("hi"),
		make([]byte, 200),   // 2-byte extended length
		make([]byte, 70000), // 8-byte extended length
	}
	for i := range payloads[1] {
		payloads[1][i] = byte(i)
	}
	for _, p := range payloads {
		frame := encodeClientFrame(0x1, p)
		br := bufio.NewReader(bytes.NewReader(frame))
		op, got, err := readServerFrame(br)
		if err != nil {
			t.Fatalf("readServerFrame err: %v", err)
		}
		if op != 0x1 {
			t.Fatalf("opcode = %d, want 1", op)
		}
		if len(got) != len(p) {
			t.Fatalf("payload len = %d, want %d", len(got), len(p))
		}
		for i := range got {
			if got[i] != p[i] {
				t.Fatalf("payload[%d] = %d, want %d", i, got[i], p[i])
			}
		}
	}
}

func TestBroadcastMessageShape(t *testing.T) {
	raw, err := broadcastMessage("tok123", "velaFsReady", map[string]string{"port": "5", "token": "abc"})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if m["method"] != "app.broadcast" {
		t.Fatalf("method = %v, want app.broadcast", m["method"])
	}
	if m["accessToken"] != "tok123" {
		t.Fatalf("accessToken = %v", m["accessToken"])
	}
	data := m["data"].(map[string]interface{})
	if data["event"] != "velaFsReady" {
		t.Fatalf("event = %v", data["event"])
	}
	inner := data["data"].(map[string]interface{})
	if inner["port"] != "5" || inner["token"] != "abc" {
		t.Fatalf("inner data = %v", inner)
	}
	if m["id"] == nil || m["id"] == "" {
		t.Fatal("message must carry an id")
	}
}

// TestWsDialAndSendEndToEnd stands up a compliant WebSocket server (manual
// upgrade + frame decode) and drives the real wsDial + frame write path against
// it. This validates the client handshake and masked-frame codec end-to-end in
// Go; the Neutralino-specific URL params / message routing are covered by the
// documented protocol (see nlclient.go header).
func TestWsDialAndSendEndToEnd(t *testing.T) {
	got := make(chan []byte, 1)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Sec-WebSocket-Key")
		if key == "" || r.URL.Query().Get("extensionId") == "" {
			http.Error(w, "bad upgrade", http.StatusBadRequest)
			return
		}
		sum := sha1.Sum([]byte(key + wsMagic))
		accept := base64.StdEncoding.EncodeToString(sum[:])
		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Error("no hijack support")
			return
		}
		conn, buf, err := hj.Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		resp := "HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
			"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
		buf.WriteString(resp)
		buf.Flush()
		_, payload, err := readServerFrame(buf.Reader)
		if err != nil {
			return
		}
		got <- payload
	})
	ts := httptest.NewServer(handler)
	defer ts.Close()

	port := strconv.Itoa(ts.Listener.Addr().(*net.TCPAddr).Port)
	cfg := nlConfig{Port: port, Token: "tok", ConnectToken: "ct", ExtensionID: "ai.vela.fs"}

	conn, _, err := wsDial(cfg)
	if err != nil {
		t.Fatalf("wsDial failed: %v", err)
	}
	defer conn.Close()
	msg, _ := broadcastMessage(cfg.Token, "velaFsReady", map[string]string{"port": "9"})
	if _, err := conn.Write(encodeClientFrame(0x1, msg)); err != nil {
		t.Fatalf("write frame: %v", err)
	}

	select {
	case payload := <-got:
		var m map[string]interface{}
		if err := json.Unmarshal(payload, &m); err != nil {
			t.Fatalf("server got non-JSON frame: %v", err)
		}
		if m["method"] != "app.broadcast" {
			t.Fatalf("server got method %v", m["method"])
		}
	case <-time.After(3 * time.Second):
		t.Fatal("server never received the broadcast frame")
	}
}

func TestNlConfigUsable(t *testing.T) {
	if (nlConfig{Port: "1", Token: "t", ExtensionID: "e"}).usable() != true {
		t.Fatal("complete config must be usable")
	}
	for _, c := range []nlConfig{
		{Token: "t", ExtensionID: "e"},
		{Port: "1", ExtensionID: "e"},
		{Port: "1", Token: "t"},
	} {
		if c.usable() {
			t.Fatalf("incomplete config %+v must be unusable", c)
		}
	}
}
