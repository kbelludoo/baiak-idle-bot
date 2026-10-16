package browser

// Minimal Chrome DevTools Protocol client over WebSocket.
// Launches a real Chromium instance (Chrome/Edge/Brave) with a stealth
// fingerprint and exposes navigate/evaluate/mouse primitives. No third-party
// automation framework — every message is hand-shaped CDP JSON.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type cdpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *cdpError) Error() string { return fmt.Sprintf("cdp error %d: %s", e.Code, e.Message) }

type cdpMessage struct {
	ID      int             `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *cdpError       `json:"error,omitempty"`
	Session string          `json:"sessionId,omitempty"`
}

const maxCDPEventBytes = 1 << 20

type cdpConn struct {
	ws        *websocket.Conn
	writeGate chan struct{}
	mu        sync.Mutex
	nextID    int
	pending   map[int]chan cdpMessage
	events    chan cdpMessage
	closed    chan struct{}
	readErr   error
}

func dialCDP(ctx context.Context, wsURL string) (*cdpConn, error) {
	ws, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("cdp dial: %w", err)
	}
	// CDP frames (DOM snapshots, evaluate results) exceed the 32KB default.
	ws.SetReadLimit(64 << 20)
	c := &cdpConn{
		ws:        ws,
		writeGate: make(chan struct{}, 1),
		pending:   make(map[int]chan cdpMessage),
		events:    make(chan cdpMessage, 256),
		closed:    make(chan struct{}),
	}
	go c.readLoop()
	return c, nil
}

func (c *cdpConn) readLoop() {
	defer func() {
		c.mu.Lock()
		clear(c.pending)
		c.mu.Unlock()
		close(c.closed)
		// Close immediately after publishing the cause. A handshake here could
		// delay waiters, and close() would wait for this reader itself.
		_ = c.ws.CloseNow()
	}()
	for {
		_, data, err := c.ws.Read(context.Background())
		if err != nil {
			c.readErr = err
			return
		}
		var msg cdpMessage
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		if msg.ID != 0 {
			c.mu.Lock()
			ch := c.pending[msg.ID]
			delete(c.pending, msg.ID)
			c.mu.Unlock()
			if ch != nil {
				ch <- msg
			}
			continue
		}
		if len(data) > maxCDPEventBytes {
			c.readErr = fmt.Errorf("cdp event exceeds %d bytes", maxCDPEventBytes)
			return
		}
		select {
		case c.events <- msg:
		default:
			// Missing a navigation, interception or attachment event can leave
			// an unobserved document or a renderer waiting for the debugger.
			c.readErr = fmt.Errorf("cdp event queue overflow (capacity %d)", cap(c.events))
			return
		}
	}
}

func (c *cdpConn) send(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	return c.sendSession(ctx, "", method, params)
}

// cdpCall is one independent CDP command, used by sendAll.
type cdpCall struct {
	method string
	params map[string]any
}

// sendAll issues independent commands on one connection in parallel. The
// connection already serializes WebSocket writes through writeGate and matches
// replies by id, so concurrency is safe. Startup issues several enables that
// do not depend on each other; running them together saves a round trip each.
func (c *cdpConn) sendAll(ctx context.Context, calls []cdpCall) error {
	if len(calls) == 1 {
		if _, err := c.send(ctx, calls[0].method, calls[0].params); err != nil {
			return &cdpCallError{method: calls[0].method, err: err}
		}
		return nil
	}
	errs := make([]error, len(calls))
	var wg sync.WaitGroup
	wg.Add(len(calls))
	for i := range calls {
		go func(i int) {
			defer wg.Done()
			_, errs[i] = c.send(ctx, calls[i].method, calls[i].params)
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			// Keep the failing method visible: callers report it to the agent.
			return &cdpCallError{method: calls[i].method, err: err}
		}
	}
	return nil
}

// cdpCallError names the command that failed inside a parallel batch.
type cdpCallError struct {
	method string
	err    error
}

func (e *cdpCallError) Error() string { return e.method + ": " + e.err.Error() }
func (e *cdpCallError) Unwrap() error { return e.err }

func (c *cdpConn) dropPending(id int) {
	c.mu.Lock()
	delete(c.pending, id)
	c.mu.Unlock()
}

func (c *cdpConn) waitEvent(ctx context.Context, method string, timeout time.Duration) (cdpMessage, error) {
	tctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		select {
		case msg := <-c.events:
			if msg.Method == method {
				return msg, nil
			}
		case <-tctx.Done():
			return cdpMessage{}, fmt.Errorf("timeout waiting for %s", method)
		case <-c.closed:
			return cdpMessage{}, fmt.Errorf("cdp connection closed: %v", c.readErr)
		}
	}
}

func (c *cdpConn) close() {
	if c == nil || c.ws == nil {
		return
	}
	_ = c.ws.Close(websocket.StatusNormalClosure, "")
	<-c.closed
}

// StealthConfig controls how the automation browser is launched.
type StealthConfig struct {
	BrowserPath string
	Headless    bool
	Width       int
	Height      int
	Lang        string
	// ProfileDir, when set, reuses a persistent user-data-dir instead of a
	// throwaway temp profile. reCAPTCHA reputation is per-profile: after one
	// manual pass, later automated checkbox clicks stop escalating.
	ProfileDir string
}

func DefaultStealthConfig() StealthConfig {
	return StealthConfig{
		Width:  1280,
		Height: 720,
		Lang:   "pt-BR",
	}
}

// StealthSession is a live CDP-controlled browser with stealth patches applied.
type StealthSession struct {
	proc        *exec.Cmd
	userDataDir string
	cleanupDir  string
	persisted   bool
	browserCDP  *cdpConn
	pageCDP     *cdpConn
	targetID    string
}

// LaunchStealth starts a real Chromium instance patched against common
// automation detectors (webdriver flag, missing chrome runtime, empty plugin
// list, permissions probe). Returns a session with an about:blank page ready.
func LaunchStealth(ctx context.Context, cfg StealthConfig) (*StealthSession, error) {
	browserPath := cfg.BrowserPath
	if browserPath == "" {
		var err error
		browserPath, err = FindSystemBrowser()
		if err != nil {
			return nil, err
		}
	}
	if cfg.Width == 0 {
		cfg.Width = 1366
	}
	if cfg.Height == 0 {
		cfg.Height = 768
	}
	if cfg.Lang == "" {
		cfg.Lang = "en-US"
	}

	userDataDir := cfg.ProfileDir
	persisted := false
	if userDataDir != "" {
		if err := os.MkdirAll(userDataDir, 0o700); err != nil {
			return nil, fmt.Errorf("profile dir: %w", err)
		}
		persisted = true
	} else {
		var err error
		userDataDir, err = os.MkdirTemp("", "aigobrowser-stealth-*")
		if err != nil {
			return nil, err
		}
	}

	args := stealthLaunchArgs(cfg, userDataDir, persisted)

	// Ensure no stale DevToolsActivePort from previous runs
	_ = os.Remove(filepath.Join(userDataDir, "DevToolsActivePort"))

	proc := exec.Command(browserPath, args...)
	var stderrBuf bytes.Buffer
	proc.Stdout = nil
	proc.Stderr = &stderrBuf
	if os.Getenv("AIGOBROWSER_CDP_DEBUG") != "" {
		proc.Stdout = os.Stderr
		proc.Stderr = os.Stderr
	}
	if err := proc.Start(); err != nil {
		if !persisted {
			os.RemoveAll(userDataDir)
		}
		return nil, fmt.Errorf("launch browser: %w", err)
	}

	port, wsPath, err := waitDevToolsPort(userDataDir, 15*time.Second)
	if err != nil {
		killTree(proc)
		if !persisted {
			os.RemoveAll(userDataDir)
		}
		if stderrBuf.Len() > 0 {
			return nil, fmt.Errorf("%w (chrome stderr: %s)", err, strings.TrimSpace(stderrBuf.String()))
		}
		return nil, err
	}

	browserCDP, err := dialCDP(ctx, fmt.Sprintf("ws://127.0.0.1:%d%s", port, wsPath))
	if err != nil {
		killTree(proc)
		if !persisted {
			os.RemoveAll(userDataDir)
		}
		return nil, err
	}

	createRes, err := browserCDP.send(ctx, "Target.createTarget", map[string]any{"url": "about:blank"})
	if err != nil {
		browserCDP.close()
		killTree(proc)
		if !persisted {
			os.RemoveAll(userDataDir)
		}
		return nil, fmt.Errorf("create target: %w", err)
	}
	var created struct {
		TargetID string `json:"targetId"`
	}
	if err := json.Unmarshal(createRes, &created); err != nil || created.TargetID == "" {
		browserCDP.close()
		killTree(proc)
		if !persisted {
			os.RemoveAll(userDataDir)
		}
		return nil, errors.New("no targetId from Target.createTarget")
	}

	pageCDP, err := dialCDP(ctx, fmt.Sprintf("ws://127.0.0.1:%d/devtools/page/%s", port, created.TargetID))
	if err != nil {
		browserCDP.close()
		killTree(proc)
		if !persisted {
			os.RemoveAll(userDataDir)
		}
		return nil, fmt.Errorf("dial page target: %w", err)
	}

	// These enables are independent of each other, so they share one round trip
	// instead of stalling startup three times.
	if err := pageCDP.sendAll(ctx, []cdpCall{
		{method: "Page.enable"},
		{method: "Runtime.enable"},
		{method: "Page.addScriptToEvaluateOnNewDocument", params: map[string]any{"source": stealthScript}},
	}); err != nil {
		pageCDP.close()
		browserCDP.close()
		killTree(proc)
		if !persisted {
			os.RemoveAll(userDataDir)
		}
		return nil, fmt.Errorf("install stealth script: %w", err)
	}

	return &StealthSession{
		proc:        proc,
		userDataDir: userDataDir,
		cleanupDir:  userDataDir,
		persisted:   persisted,
		browserCDP:  browserCDP,
		pageCDP:     pageCDP,
		targetID:    created.TargetID,
	}, nil
}

// Attach connects to an existing running browser (Brave/Chrome/Edge)
// started with --remote-debugging-port=<port>.
func Attach(ctx context.Context, port int) (*StealthSession, error) {
	return AttachTab(ctx, port, "")
}

// AttachTab connects to an existing running browser filtering by target URL match.
func AttachTab(ctx context.Context, port int, urlPattern string) (*StealthSession, error) {
	if port <= 0 {
		port = 9222
	}
	resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/json", port))
	if err != nil {
		return nil, fmt.Errorf("connect to browser on port %d: %w", port, err)
	}
	defer resp.Body.Close()

	var targets []struct {
		ID                   string `json:"id"`
		Title                string `json:"title"`
		Type                 string `json:"type"`
		URL                  string `json:"url"`
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&targets); err != nil {
		return nil, fmt.Errorf("decode targets: %w", err)
	}

	var chosenWS string
	var targetID string
	if urlPattern != "" {
		for _, t := range targets {
			if (t.Type == "page" || t.Type == "iframe") && (strings.Contains(t.URL, urlPattern) || strings.Contains(t.ID, urlPattern)) {
				chosenWS = t.WebSocketDebuggerURL
				targetID = t.ID
				break
			}
		}
	}
	if chosenWS == "" {
		for _, t := range targets {
			if t.Type == "page" && t.WebSocketDebuggerURL != "" {
				chosenWS = t.WebSocketDebuggerURL
				targetID = t.ID
				break
			}
		}
	}
	if chosenWS == "" {
		return nil, errors.New("no active page tab found in attached browser")
	}

	pageCDP, err := dialCDP(ctx, chosenWS)
	if err != nil {
		return nil, fmt.Errorf("dial page target: %w", err)
	}
	if _, err := pageCDP.send(ctx, "Page.enable", nil); err != nil {
		pageCDP.close()
		return nil, err
	}
	if _, err := pageCDP.send(ctx, "Runtime.enable", nil); err != nil {
		pageCDP.close()
		return nil, err
	}

	return &StealthSession{
		proc:       nil,
		cleanupDir: "",
		pageCDP:    pageCDP,
		targetID:   targetID,
	}, nil
}

func waitDevToolsPort(profileDir string, timeout time.Duration) (int, string, error) {
	deadline := time.Now().Add(timeout)
	portFile := filepath.Join(profileDir, "DevToolsActivePort")
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(portFile)
		if err == nil {
			lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
			if len(lines) >= 2 {
				port, perr := strconv.Atoi(strings.TrimSpace(lines[0]))
				path := strings.TrimSpace(lines[1])
				if perr == nil && port > 0 && strings.HasPrefix(path, "/") {
					return port, path, nil
				}
			}
		}
		// A short interval keeps launch latency near the process' own startup
		// cost instead of adding up to a full polling period on every launch.
		time.Sleep(5 * time.Millisecond)
	}
	return 0, "", errors.New("DevToolsActivePort never appeared")
}

// Navigate loads a URL and waits for the load event.
func (s *StealthSession) Navigate(ctx context.Context, targetURL string) error {
	res, err := s.pageCDP.send(ctx, "Page.navigate", map[string]any{"url": targetURL})
	if err != nil {
		return err
	}
	var nav struct {
		ErrorText string `json:"errorText"`
	}
	if err := json.Unmarshal(res, &nav); err == nil && nav.ErrorText != "" {
		return fmt.Errorf("navigate %s: %s", targetURL, nav.ErrorText)
	}
	if _, err := s.pageCDP.waitEvent(ctx, "Page.loadEventFired", 30*time.Second); err != nil {
		return err
	}
	time.Sleep(250 * time.Millisecond)
	return nil
}

// Evaluate runs an expression in the page context and returns the JSON value.
func (s *StealthSession) Evaluate(ctx context.Context, expr string) (json.RawMessage, error) {
	return s.EvaluateContext(ctx, expr, 0)
}

// MouseJitter dispatches a few small mouse moves so pointer-driven scripts
// (reCAPTCHA telemetry) observe live input rather than a static cursor.
func (s *StealthSession) MouseJitter(ctx context.Context, steps int) {
	if steps <= 0 {
		steps = 3
	}
	base := time.Now().UnixNano()
	for i := 0; i < steps; i++ {
		x := 200 + int((base+int64(i*7919))%900)
		y := 150 + int((base+int64(i*104729))%500)
		_, _ = s.pageCDP.send(ctx, "Input.dispatchMouseEvent", map[string]any{
			"type":    "mouseMoved",
			"x":       x,
			"y":       y,
			"buttons": 0,
		})
		time.Sleep(time.Duration(80+i*40) * time.Millisecond)
	}
}

// KeyActivity dispatches realistic key events so input telemetry sees
// typing, not just pointer motion.
func (s *StealthSession) KeyActivity(ctx context.Context, text string) {
	for _, r := range text {
		key := string(r)
		_, _ = s.pageCDP.send(ctx, "Input.dispatchKeyEvent", map[string]any{
			"type": "keyDown",
			"text": key,
			"key":  key,
		})
		_, _ = s.pageCDP.send(ctx, "Input.dispatchKeyEvent", map[string]any{
			"type": "keyUp",
			"key":  key,
		})
		time.Sleep(time.Duration(45+int(r%50)) * time.Millisecond)
	}
}

// SendCDP exposes raw CDP commands to the underlying page target.
func (s *StealthSession) SendCDP(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	return s.pageCDP.send(ctx, method, params)
}

// InsertText sends text directly into the focused element using CDP Input.insertText.
func (s *StealthSession) InsertText(ctx context.Context, text string) error {
	_, err := s.pageCDP.send(ctx, "Input.insertText", map[string]any{"text": text})
	return err
}

// ClickAt performs a full mouse press/release at page coordinates.
func (s *StealthSession) ClickAt(ctx context.Context, x, y float64) error {
	if _, err := s.pageCDP.send(ctx, "Input.dispatchMouseEvent", map[string]any{
		"type": "mouseMoved", "x": x, "y": y, "buttons": 0,
	}); err != nil {
		return err
	}
	time.Sleep(80 * time.Millisecond)
	if _, err := s.pageCDP.send(ctx, "Input.dispatchMouseEvent", map[string]any{
		"type": "mousePressed", "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1,
	}); err != nil {
		return err
	}
	time.Sleep(60 * time.Millisecond)
	if _, err := s.pageCDP.send(ctx, "Input.dispatchMouseEvent", map[string]any{
		"type": "mouseReleased", "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1,
	}); err != nil {
		return err
	}
	return nil
}

// Screenshot captures the viewport as PNG bytes.
func (s *StealthSession) Screenshot(ctx context.Context) ([]byte, error) {
	res, err := s.pageCDP.send(ctx, "Page.captureScreenshot", map[string]any{"format": "png"})
	if err != nil {
		return nil, err
	}
	var out struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(res, &out); err != nil {
		return nil, err
	}
	return base64.StdEncoding.DecodeString(out.Data)
}

// GetCookies returns the network cookies matching the given URLs.
func (s *StealthSession) GetCookies(ctx context.Context, urls ...string) (json.RawMessage, error) {
	params := map[string]any{}
	if len(urls) > 0 {
		params["urls"] = urls
	}
	res, err := s.pageCDP.send(ctx, "Network.getCookies", params)
	if err != nil {
		return nil, err
	}
	return res, nil
}

// AddInitScript installs a script evaluated before every new document in
// this tab — the slot the ticket-relay hook uses so it exists before any
// page script can reach fetch or WebSocket.
func (s *StealthSession) AddInitScript(ctx context.Context, source string) error {
	_, err := s.pageCDP.send(ctx, "Page.addScriptToEvaluateOnNewDocument", map[string]any{"source": source})
	return err
}

// SetCookies sets network cookies into the browser context.
func (s *StealthSession) SetCookies(ctx context.Context, cookies []map[string]any) error {
	_, _ = s.pageCDP.send(ctx, "Network.enable", nil)
	cleaned := make([]map[string]any, 0, len(cookies))
	for _, c := range cookies {
		m := map[string]any{
			"name":  c["name"],
			"value": c["value"],
		}
		if dom, ok := c["domain"]; ok && dom != nil {
			m["domain"] = dom
		}
		if p, ok := c["path"]; ok && p != nil {
			m["path"] = p
		}
		if sec, ok := c["secure"]; ok && sec != nil {
			m["secure"] = sec
		}
		if ho, ok := c["httpOnly"]; ok && ho != nil {
			m["httpOnly"] = ho
		}
		if exp, ok := c["expires"]; ok && exp != nil {
			if f, ok := exp.(float64); ok && f > 0 {
				m["expires"] = f
			}
		}
		cleaned = append(cleaned, m)
	}
	_, err := s.pageCDP.send(ctx, "Network.setCookies", map[string]any{"cookies": cleaned})
	return err
}

// Close tears down CDP connections, kills the browser tree, removes the profile.
func (s *StealthSession) Close() {
	if s == nil {
		return
	}
	if s.browserCDP != nil && s.targetID != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_, _ = s.browserCDP.send(ctx, "Target.closeTarget", map[string]any{"targetId": s.targetID})
		cancel()
	}
	if s.pageCDP != nil {
		s.pageCDP.close()
	}
	if s.browserCDP != nil {
		s.browserCDP.close()
	}
	if s.proc != nil {
		killTree(s.proc)
	}
	if s.cleanupDir != "" && !s.persisted {
		for i := 0; i < 5; i++ {
			if err := os.RemoveAll(s.cleanupDir); err == nil {
				break
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
}

func killTree(proc *exec.Cmd) {
	if proc == nil || proc.Process == nil {
		return
	}
	if runtime.GOOS == "windows" {
		_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(proc.Process.Pid)).Run()
		return
	}
	_ = proc.Process.Kill()
}
