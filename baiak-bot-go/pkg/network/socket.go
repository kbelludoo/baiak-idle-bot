package network

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type BinaryMessageHandler func(data []byte)
type DisconnectHandler func(err error)

// SocketClient gerencia conexão WebSocket com escrita thread-safe e keepalive
type SocketClient struct {
	url          string
	headers      http.Header
	bindIP       string
	conn         *websocket.Conn
	writeMu      sync.Mutex
	mu           sync.RWMutex
	isConnected  bool
	onBinaryMsg  BinaryMessageHandler
	onDisconnect DisconnectHandler
}

func NewSocketClient(url string, headers http.Header, bindIP string, onMsg BinaryMessageHandler, onDisc DisconnectHandler) *SocketClient {
	if headers == nil {
		headers = make(http.Header)
	}
	if headers.Get("User-Agent") == "" {
		headers.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	}

	return &SocketClient{
		url:          url,
		headers:      headers,
		bindIP:       bindIP,
		onBinaryMsg:  onMsg,
		onDisconnect: onDisc,
	}
}

func (s *SocketClient) Connect() error {
	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
	}

	if s.bindIP != "" {
		localTCPAddr, err := net.ResolveTCPAddr("tcp", s.bindIP+":0")
		if err == nil {
			dialer.NetDialContext = (&net.Dialer{
				Timeout:   15 * time.Second,
				KeepAlive: 30 * time.Second,
				LocalAddr: localTCPAddr,
			}).DialContext
		}
	}

	conn, _, err := dialer.Dial(s.url, s.headers)
	if err != nil {
		return fmt.Errorf("websocket dial failed: %w", err)
	}

	s.mu.Lock()
	s.conn = conn
	s.isConnected = true
	s.mu.Unlock()

	go s.readLoop()
	return nil
}

func (s *SocketClient) readLoop() {
	defer func() {
		s.Close()
	}()

	s.conn.SetReadLimit(16 * 1024 * 1024) // 16MB max packet

	s.conn.SetPongHandler(func(string) error {
		_ = s.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_ = s.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		msgType, message, err := s.conn.ReadMessage()
		if err != nil {
			s.mu.Lock()
			wasConnected := s.isConnected
			s.isConnected = false
			s.mu.Unlock()

			if wasConnected && s.onDisconnect != nil {
				s.onDisconnect(err)
			}
			return
		}

		if msgType == websocket.BinaryMessage || msgType == websocket.TextMessage {
			if s.onBinaryMsg != nil {
				s.onBinaryMsg(message)
			}
		}
	}
}

func (s *SocketClient) SendBinary(data []byte) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	conn := s.conn
	connected := s.isConnected
	s.mu.RUnlock()

	if !connected || conn == nil {
		return fmt.Errorf("socket não conectado")
	}

	_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return conn.WriteMessage(websocket.BinaryMessage, data)
}

func (s *SocketClient) SendJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return s.SendBinary(data)
}

func (s *SocketClient) SendText(text string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	conn := s.conn
	connected := s.isConnected
	s.mu.RUnlock()

	if !connected || conn == nil {
		return fmt.Errorf("socket não conectado")
	}

	_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return conn.WriteMessage(websocket.TextMessage, []byte(text))
}

func (s *SocketClient) SendPing() error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.mu.RLock()
	conn := s.conn
	connected := s.isConnected
	s.mu.RUnlock()

	if !connected || conn == nil {
		return nil
	}

	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return conn.WriteMessage(websocket.PingMessage, []byte{})
}

func (s *SocketClient) IsConnected() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isConnected
}

func (s *SocketClient) Close() {
	s.mu.Lock()
	if !s.isConnected {
		s.mu.Unlock()
		return
	}
	s.isConnected = false
	conn := s.conn
	s.conn = nil
	s.mu.Unlock()

	if conn != nil {
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		_ = conn.Close()
	}
}
