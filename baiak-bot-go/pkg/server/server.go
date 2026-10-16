package server

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"baiak-bot/pkg/engine"
)

//go:embed index.html
var indexHTML []byte

type Server struct {
	port    int
	manager *engine.BotManager
	startAt time.Time
}

func NewServer(port int, manager *engine.BotManager) *Server {
	return &Server{
		port:    port,
		manager: manager,
		startAt: time.Now(),
	}
}

func (s *Server) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleDashboard)
	mux.HandleFunc("/api/status", s.handleAPIStatus)
	mux.HandleFunc("/api/fleet", s.handleAPIFleet)
	mux.HandleFunc("/api/action", s.handleAPIAction)
	mux.HandleFunc("/api/ticket", s.handleAPITicket)

	addr := fmt.Sprintf(":%d", s.port)
	return http.ListenAndServe(addr, mux)
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(indexHTML)
}

func (s *Server) handleAPIFleet(w http.ResponseWriter, r *http.Request) {
	statuses := s.manager.GetAllStatuses()
	var totalGold int64 = 0
	var totalExpH float64 = 0
	var totalGoldH float64 = 0
	onlineCount := 0
	botsMap := make(map[string]any)

	for _, st := range statuses {
		totalGold += st.Gold
		totalExpH += st.ExpPerHour
		totalGoldH += st.GoldPerHour
		isOnline := st.Status == "hunting" || st.Status == "training"
		if isOnline {
			onlineCount++
		}
		botsMap[st.ID] = map[string]any{
			"label":     st.Name,
			"name":      st.Name,
			"online":    isOnline,
			"reachable": true,
			"status": map[string]any{
				"online":    isOnline,
				"uptimeSec": st.DurationSec,
				"gold":      st.Gold,
				"level":     st.Level,
				"hunt": map[string]any{
					"id":   st.CurrentArea,
					"name": st.CurrentArea,
				},
				"rates": map[string]any{
					"xpPerHour":   st.ExpPerHour,
					"goldPerHour": st.GoldPerHour,
				},
			},
		}
	}

	data := map[string]any{
		"fleet": map[string]any{
			"botsOnline":       onlineCount,
			"botsTotal":        len(statuses),
			"totalXpPerHour":   totalExpH,
			"totalLootPerHour": totalGoldH,
			"totalGold":        totalGold,
		},
		"bots": botsMap,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(data)
}

func (s *Server) handleAPIStatus(w http.ResponseWriter, r *http.Request) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	data := map[string]any{
		"uptime":     time.Since(s.startAt).Round(time.Second).String(),
		"goroutines": runtime.NumGoroutine(),
		"ramAllocMB": float64(m.Alloc) / 1024.0 / 1024.0,
		"ramSysMB":   float64(m.Sys) / 1024.0 / 1024.0,
		"accounts":   s.manager.GetAllStatuses(),
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(data)
}

func (s *Server) handleAPIAction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		AccountID string         `json:"accountId"`
		Action    string         `json:"action"`
		Payload   map[string]any `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Action == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "Parâmetros inválidos"})
		return
	}

	result, err := s.manager.ExecuteAction(body.AccountID, body.Action, body.Payload)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     true,
		"result": result,
	})
}

func (s *Server) handleAPITicket(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		AccountID      string `json:"accountId"`
		Ticket         string `json:"ticket"`
		TurnstileToken string `json:"turnstileToken"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Ticket == "" && body.TurnstileToken == "") {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "Campos 'ticket' ou 'turnstileToken' são obrigatórios"})
		return
	}

	token := body.TurnstileToken
	if token == "" {
		token = body.Ticket
	}

	if err := s.manager.SupplyTurnstileToken(body.AccountID, token); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      true,
		"message": "Turnstile token entregue com sucesso!",
	})
}

