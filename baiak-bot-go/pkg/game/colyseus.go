package game

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"baiak-bot/pkg/network"
)

type Endpoint struct {
	HTTP   string
	WS     string
	Origin string
}

func EndpointFromOrigin(origin string) Endpoint {
	if origin == "" {
		origin = "https://baiakidle.com"
	}
	u, err := url.Parse(origin)
	if err != nil {
		u = &url.URL{Scheme: "https", Host: "baiakidle.com"}
	}
	secure := u.Scheme == "https" || u.Scheme == "wss"
	wsScheme := "ws"
	if secure {
		wsScheme = "wss"
	}
	prefix := strings.TrimRight(u.Path, "/")
	return Endpoint{
		HTTP:   fmt.Sprintf("%s://%s%s/rt", u.Scheme, u.Host, prefix),
		WS:     fmt.Sprintf("%s://%s%s/rt", wsScheme, u.Host, prefix),
		Origin: fmt.Sprintf("%s://%s", u.Scheme, u.Host),
	}
}

type Seat struct {
	RoomName          string `json:"name"`
	RoomID            string `json:"roomId"`
	ProcessID         string `json:"processId"`
	SessionID         string `json:"sessionId"`
	ReconnectionToken string `json:"reconnectionToken"`
	PublicAddress     string `json:"publicAddress"`
}

type MatchmakeResponse struct {
	Room              *Seat  `json:"room"`
	SessionID         string `json:"sessionId"`
	ReconnectionToken string `json:"reconnectionToken"`
	Error             string `json:"error"`
	Code              int    `json:"code"`
}

type Room struct {
	Seat              Seat
	Endpoint          Endpoint
	Socket            *network.SocketClient
	ReconnectionToken string
	SerializerID      string
	Joined            bool
	Closed            bool
	JoinedAt          time.Time
	LastFrameAt       time.Time

	handlersMu sync.RWMutex
	handlers   map[string][]func(payload any)
	waitersMu  sync.Mutex
	joinWait   chan struct{}
	logFn      func(string)
}

func (r *Room) On(msgType string, handler func(payload any)) {
	r.handlersMu.Lock()
	defer r.handlersMu.Unlock()
	r.handlers[msgType] = append(r.handlers[msgType], handler)
}

func (r *Room) emit(msgType string, payload any) {
	r.handlersMu.RLock()
	handlers := append([]func(any){}, r.handlers[msgType]...)
	r.handlersMu.RUnlock()

	for _, h := range handlers {
		h(payload)
	}
}

func (r *Room) Send(msgType string, payload any) error {
	if r.Closed || r.Socket == nil {
		return fmt.Errorf("sala fechada")
	}
	data, err := EncodeRoomData(msgType, payload)
	if err != nil {
		return err
	}
	return r.Socket.SendBinary(data)
}

func (r *Room) Close() {
	r.Closed = true
	if r.Socket != nil {
		r.Socket.Close()
	}
}

// Matchmake realiza POST em /rt/matchmake/{method}/{roomName}
func Matchmake(ctx context.Context, endpoint Endpoint, method, roomName string, body any, bindIP string) (*Seat, error) {
	reqURL := fmt.Sprintf("%s/matchmake/%s/%s", endpoint.HTTP, method, url.PathEscape(roomName))
	payloadBytes, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(payloadBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json")
	req.Header.Set("user-agent", DefaultUserAgent)
	req.Header.Set("origin", endpoint.Origin)

	httpCli := network.NewHTTPClient(endpoint.HTTP, 15*time.Second, bindIP)
	res, err := httpCli.Client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("matchmake request falhou: %w", err)
	}
	defer res.Body.Close()

	bodyBytes, _ := io.ReadAll(res.Body)
	var mmRes MatchmakeResponse
	if err := json.Unmarshal(bodyBytes, &mmRes); err != nil {
		return nil, fmt.Errorf("matchmake decode error (status %d): %s", res.StatusCode, string(bodyBytes))
	}

	if mmRes.Error != "" {
		return nil, fmt.Errorf("matchmake error: %s (code %d)", mmRes.Error, mmRes.Code)
	}
	if mmRes.Room == nil || mmRes.Room.RoomID == "" {
		return nil, fmt.Errorf("matchmake resposta sem roomId: %s", string(bodyBytes))
	}

	seat := mmRes.Room
	seat.RoomName = roomName
	if mmRes.SessionID != "" {
		seat.SessionID = mmRes.SessionID
	}
	if mmRes.ReconnectionToken != "" {
		seat.ReconnectionToken = mmRes.ReconnectionToken
	}

	return seat, nil
}

// ConnectRoom conecta o WebSocket Colyseus e aguarda o handshake inicial (OP_JOIN_ROOM)
func ConnectRoom(ctx context.Context, endpoint Endpoint, seat Seat, bindIP string, logFn func(string)) (*Room, error) {
	wsBase := endpoint.WS
	if seat.PublicAddress != "" {
		wsBase = fmt.Sprintf("wss://%s", seat.PublicAddress)
	}
	wsURL := fmt.Sprintf("%s/%s/%s?sessionId=%s", wsBase, seat.ProcessID, seat.RoomID, url.QueryEscape(seat.SessionID))

	room := &Room{
		Seat:        seat,
		Endpoint:    endpoint,
		handlers:    make(map[string][]func(payload any)),
		joinWait:    make(chan struct{}),
		logFn:       logFn,
		LastFrameAt: time.Now(),
	}

	headers := make(http.Header)
	headers.Set("User-Agent", DefaultUserAgent)
	headers.Set("Origin", endpoint.Origin)

	onBinary := func(data []byte) {
		room.LastFrameAt = time.Now()
		frame, err := DecodeFrame(data)
		if err != nil || frame == nil {
			return
		}

		if frame.Opcode == OpJoinRoom {
			// Servidor mandou handshake: cliente precisa responder imediatamente com byte 0x0A (10)
			if room.Socket != nil {
				_ = room.Socket.SendBinary([]byte{OpJoinRoom})
			}
			room.Joined = true
			room.JoinedAt = time.Now()
			if p, ok := frame.Payload.(map[string]string); ok {
				room.ReconnectionToken = p["reconnectionToken"]
				room.SerializerID = p["serializerId"]
			}
			room.waitersMu.Lock()
			select {
			case <-room.joinWait:
			default:
				close(room.joinWait)
			}
			room.waitersMu.Unlock()
			room.emit("__join", frame.Payload)
			return
		}

		if frame.Opcode == OpError {
			room.emit("__error", frame.Payload)
			return
		}

		if frame.Opcode == OpLeaveRoom {
			room.Closed = true
			room.emit("__leave", frame.Payload)
			return
		}

		if frame.Opcode == OpRoomData {
			if frame.Type != "" {
				room.emit(frame.Type, frame.Payload)
			}
			room.emit("__data", frame)
			return
		}

		if frame.Opcode == OpRoomState || frame.Opcode == OpRoomStatePatch || frame.Opcode == OpRoomDataSchema {
			room.emit("__state", frame.Payload)
			return
		}
	}

	onDisconnect := func(err error) {
		room.Closed = true
		room.emit("__close", map[string]any{"error": fmt.Sprint(err)})
	}

	sock := network.NewSocketClient(wsURL, headers, bindIP, onBinary, onDisconnect)

	if err := sock.Connect(); err != nil {
		return nil, fmt.Errorf("falha ao conectar WebSocket: %w", err)
	}
	room.Socket = sock

	// Aguarda handshake OP_JOIN_ROOM com timeout de 15 segundos
	select {
	case <-ctx.Done():
		room.Close()
		return nil, ctx.Err()
	case <-room.joinWait:
		return room, nil
	case <-time.After(15 * time.Second):
		room.Close()
		return nil, fmt.Errorf("timeout aguardando handshake da sala (room %s)", seat.RoomID)
	}
}
