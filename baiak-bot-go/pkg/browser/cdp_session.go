package browser

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/coder/websocket"
)

// cdpSession routes flattened CDP requests on one shared connection. Events stay
// on conn.events with their Session field intact; the owner routes that stream.
type cdpSession struct {
	conn *cdpConn
	id   string
}

func (c *cdpConn) session(id string) *cdpSession { return &cdpSession{conn: c, id: id} }

func (s *cdpSession) send(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	if s == nil {
		return nil, errors.New("no CDP session")
	}
	return s.conn.sendSession(ctx, s.id, method, params)
}

func (c *cdpConn) sendSession(ctx context.Context, sessionID, method string, params map[string]any) (json.RawMessage, error) {
	if c == nil || c.ws == nil {
		return nil, errors.New("no CDP connection")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case <-c.closed:
		return nil, fmt.Errorf("cdp connection closed: %v", c.readErr)
	default:
	}
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	ch := make(chan cdpMessage, 1)
	c.pending[id] = ch
	c.mu.Unlock()
	defer c.dropPending(id)

	payload := map[string]any{"id": id, "method": method}
	if sessionID != "" {
		payload["sessionId"] = sessionID
	}
	if params != nil {
		payload["params"] = params
	}
	buf, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	// A queued operation must still respect its own deadline. A canceled
	// request never enters websocket.Write and leaves other sessions usable.
	select {
	case c.writeGate <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.closed:
		return nil, fmt.Errorf("cdp connection closed: %v", c.readErr)
	}
	if err = ctx.Err(); err == nil {
		err = c.ws.Write(ctx, websocket.MessageText, buf)
	}
	<-c.writeGate
	if err != nil {
		return nil, fmt.Errorf("cdp write %s: %w", method, err)
	}
	select {
	case msg := <-ch:
		return cdpSessionResult(msg, sessionID)
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-c.closed:
		// A response delivered immediately before EOF remains a valid result.
		select {
		case msg := <-ch:
			return cdpSessionResult(msg, sessionID)
		default:
			return nil, fmt.Errorf("cdp connection closed: %v", c.readErr)
		}
	}
}

func cdpSessionResult(msg cdpMessage, sessionID string) (json.RawMessage, error) {
	// Some browser-level protocol errors omit sessionId, including a detached
	// target. Preserve the meaningful protocol error before checking routing.
	if msg.Error != nil {
		return nil, msg.Error
	}
	if msg.Session != sessionID {
		return nil, fmt.Errorf("cdp response session mismatch: expected %q, got %q", sessionID, msg.Session)
	}
	return msg.Result, nil
}

// EvaluateContext evaluates in a context belonging to this endpoint. Zero
// requests its default context; frame adapters must supply their selected ID.
func (s *cdpSession) EvaluateContext(ctx context.Context, expression string, contextID int64) (json.RawMessage, error) {
	return s.EvaluateWorld(ctx, expression, contextID, "")
}

// EvaluateWorld prefers a system-unique execution context when available. CDP
// forbids sending uniqueContextId together with its reusable numeric contextId.
func (s *cdpSession) EvaluateWorld(ctx context.Context, expression string, contextID int64, uniqueID string) (json.RawMessage, error) {
	if contextID < 0 {
		return nil, errors.New("invalid execution context ID")
	}
	params := map[string]any{
		"expression":    expression,
		"awaitPromise":  true,
		"returnByValue": true,
	}
	if uniqueID != "" {
		params["uniqueContextId"] = uniqueID
	} else if contextID != 0 {
		params["contextId"] = contextID
	}
	res, err := s.send(ctx, "Runtime.evaluate", params)
	if err != nil {
		return nil, err
	}
	return cdpEvaluationValue(res)
}

// EvaluateContext evaluates within the page connection's selected context.
func (s *StealthSession) EvaluateContext(ctx context.Context, expression string, contextID int64) (json.RawMessage, error) {
	if s == nil || s.pageCDP == nil {
		return nil, errors.New("no browser session")
	}
	return s.pageCDP.session("").EvaluateContext(ctx, expression, contextID)
}

func cdpEvaluationValue(res json.RawMessage) (json.RawMessage, error) {
	var out struct {
		Result struct {
			Subtype     string          `json:"subtype"`
			Value       json.RawMessage `json:"value"`
			Description string          `json:"description"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text      string `json:"text"`
			Exception *struct {
				Description string          `json:"description"`
				Value       json.RawMessage `json:"value"`
			} `json:"exception"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(res, &out); err != nil {
		return nil, err
	}
	if out.ExceptionDetails != nil {
		description := out.ExceptionDetails.Text
		if exception := out.ExceptionDetails.Exception; exception != nil {
			if exception.Description != "" {
				description = exception.Description
			} else {
				var value string
				if json.Unmarshal(exception.Value, &value) == nil && value != "" {
					description = value
				}
			}
		}
		return nil, fmt.Errorf("evaluate: %s", description)
	}
	if out.Result.Subtype == "error" {
		return nil, fmt.Errorf("evaluate: %s", out.Result.Description)
	}
	return out.Result.Value, nil
}
