// Minimal Neutralino extension→app event client (RFC6455 WebSocket, stdlib only).
//
// WHY THIS EXISTS
// The page no longer has filesystem authority, so it can no longer read the
// broker's handshake files to learn the broker's {port, token}. Neutralino's
// documented extension protocol lets an extension push an event to the app: the
// extension opens the same loopback WebSocket the webview uses, sends an
// `app.broadcast` message, and the page receives it via Neutralino.events.on().
// That is the ONLY app→extension-free way to hand the page the broker's
// coordinates without granting it any filesystem or app→extension messaging
// capability (extensions.dispatch/broadcast stay OUT of the allowlist).
//
// SCOPE OF THIS FILE
// A tiny WebSocket *client*: TCP dial → HTTP Upgrade handshake → masked text
// frames. It intentionally implements only what the broadcast needs (client
// masking, text frames, ping/pong, close). The frame codec is unit-tested
// end-to-end against a compliant in-process server (nlclient_test.go). The
// Neutralino-specific bits — the connect URL query params and the app.broadcast
// message shape — follow the documented protocol and can only be verified fully
// in a real Neutralino runtime (out of scope here; see report).

package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"time"
)

const wsMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

type nlConfig struct {
	Port         string
	Token        string // nlToken — the accessToken every message must carry
	ConnectToken string // nlConnectToken — query param on the WS URL
	ExtensionID  string // nlExtensionId — query param on the WS URL
}

func (c nlConfig) usable() bool {
	return c.Port != "" && c.Token != "" && c.ExtensionID != ""
}

// randMask returns 4 cryptographically-random mask bytes.
func randMask() [4]byte {
	var k [4]byte
	_, _ = rand.Read(k[:])
	return k
}

// encodeClientFrame builds a masked WebSocket frame (client frames MUST be
// masked, RFC6455 §5.3). opcode 0x1 = text, 0x8 = close, 0xA = pong.
func encodeClientFrame(opcode byte, payload []byte) []byte {
	var out []byte
	out = append(out, 0x80|opcode) // FIN + opcode
	n := len(payload)
	switch {
	case n < 126:
		out = append(out, 0x80|byte(n))
	case n <= 0xFFFF:
		out = append(out, 0x80|126)
		var ext [2]byte
		binary.BigEndian.PutUint16(ext[:], uint16(n))
		out = append(out, ext[:]...)
	default:
		out = append(out, 0x80|127)
		var ext [8]byte
		binary.BigEndian.PutUint64(ext[:], uint64(n))
		out = append(out, ext[:]...)
	}
	mask := randMask()
	out = append(out, mask[:]...)
	for i := 0; i < n; i++ {
		out = append(out, payload[i]^mask[i%4])
	}
	return out
}

// readServerFrame reads one (unmasked) server frame. Returns opcode + payload.
// Handles the length forms; server→client frames are never masked.
func readServerFrame(r *bufio.Reader) (byte, []byte, error) {
	h0, err := r.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	opcode := h0 & 0x0F
	h1, err := r.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	masked := h1&0x80 != 0
	n := int(h1 & 0x7F)
	switch n {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return 0, nil, err
		}
		n = int(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return 0, nil, err
		}
		n = int(binary.BigEndian.Uint64(ext[:]))
	}
	var mask [4]byte
	if masked {
		if _, err := io.ReadFull(r, mask[:]); err != nil {
			return 0, nil, err
		}
	}
	payload := make([]byte, n)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
	}
	return opcode, payload, nil
}

// broadcastMessage builds the app.broadcast envelope Neutralino routes to the
// page as an event. The page listens via Neutralino.events.on(event, …).
func broadcastMessage(token, event string, data interface{}) ([]byte, error) {
	idb := make([]byte, 16)
	_, _ = rand.Read(idb)
	msg := map[string]interface{}{
		"id":          hex.EncodeToString(idb),
		"method":      "app.broadcast",
		"accessToken": token,
		"data": map[string]interface{}{
			"event": event,
			"data":  data,
		},
	}
	return json.Marshal(msg)
}

// wsDial performs the client Upgrade handshake and returns the live conn plus a
// buffered reader positioned right after the response headers.
func wsDial(cfg nlConfig) (net.Conn, *bufio.Reader, error) {
	addr := "127.0.0.1:" + cfg.Port
	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		return nil, nil, err
	}
	q := url.Values{}
	q.Set("extensionId", cfg.ExtensionID)
	if cfg.ConnectToken != "" {
		q.Set("connectToken", cfg.ConnectToken)
	}
	keyb := make([]byte, 16)
	_, _ = rand.Read(keyb)
	key := base64.StdEncoding.EncodeToString(keyb)
	req := "GET /?" + q.Encode() + " HTTP/1.1\r\n" +
		"Host: " + addr + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n"
	_ = conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
	if _, err := io.WriteString(conn, req); err != nil {
		conn.Close()
		return nil, nil, err
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	br := bufio.NewReader(conn)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, nil, err
	}
	if !strings.Contains(statusLine, " 101") {
		conn.Close()
		return nil, nil, fmt.Errorf("ws upgrade failed: %s", strings.TrimSpace(statusLine))
	}
	// Verify Sec-WebSocket-Accept and drain the rest of the headers.
	sum := sha1.Sum([]byte(key + wsMagic))
	wantAccept := base64.StdEncoding.EncodeToString(sum[:])
	acceptOK := false
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, nil, err
		}
		t := strings.TrimSpace(line)
		if t == "" {
			break
		}
		if strings.HasPrefix(strings.ToLower(t), "sec-websocket-accept:") {
			if strings.TrimSpace(t[len("sec-websocket-accept:"):]) == wantAccept {
				acceptOK = true
			}
		}
	}
	if !acceptOK {
		conn.Close()
		return nil, nil, errors.New("ws upgrade: bad Sec-WebSocket-Accept")
	}
	_ = conn.SetReadDeadline(time.Time{})
	return conn, br, nil
}

// broadcastLoop keeps a WebSocket to the Neutralino server open and re-emits the
// event on a ticker. Re-emitting is deliberate: Neutralino events are fire-and-
// forget, so the page may attach its listener after the first send; a periodic
// re-broadcast guarantees the page catches the next one whenever it is ready.
// App→extension messaging is NOT used (it would require a forbidden allowlist
// entry), so the broker simply keeps announcing. Reconnects on any error.
func broadcastLoop(cfg nlConfig, event string, data interface{}, stop <-chan struct{}, logf func(string, ...interface{})) {
	if !cfg.usable() {
		logf("nlclient: incomplete handshake (port/token/extId) — event bootstrap DISABLED")
		return
	}
	for {
		select {
		case <-stop:
			return
		default:
		}
		conn, br, err := wsDial(cfg)
		if err != nil {
			logf("nlclient: dial failed: %v (retrying)", err)
			if sleepOrStop(stop, time.Second) {
				return
			}
			continue
		}
		logf("nlclient: connected, announcing %q", event)
		// Drain server frames (ping→pong, ignore rest) so the socket stays healthy.
		readErr := make(chan error, 1)
		go func() {
			for {
				op, payload, err := readServerFrame(br)
				if err != nil {
					readErr <- err
					return
				}
				if op == 0x9 { // ping → pong
					_, _ = conn.Write(encodeClientFrame(0xA, payload))
				} else if op == 0x8 { // close
					readErr <- errors.New("server closed")
					return
				}
			}
		}()
		msg, err := broadcastMessage(cfg.Token, event, data)
		if err != nil {
			conn.Close()
			return
		}
		if !announce(conn, msg, stop, readErr, logf) {
			conn.Close()
			return // stop requested
		}
		conn.Close()
		if sleepOrStop(stop, time.Second) {
			return
		}
	}
}

// announce sends the broadcast immediately and then every second until the
// socket errors or stop fires. Returns false only when stop was requested.
func announce(conn net.Conn, msg []byte, stop <-chan struct{}, readErr <-chan error, logf func(string, ...interface{})) bool {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		if _, err := conn.Write(encodeClientFrame(0x1, msg)); err != nil {
			logf("nlclient: write failed: %v (reconnecting)", err)
			return true
		}
		select {
		case <-stop:
			_, _ = conn.Write(encodeClientFrame(0x8, nil)) // polite close
			return false
		case <-readErr:
			return true // reconnect
		case <-t.C:
		}
	}
}

func sleepOrStop(stop <-chan struct{}, d time.Duration) bool {
	select {
	case <-stop:
		return true
	case <-time.After(d):
		return false
	}
}
