package server

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strings"
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

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleDashboard)
	mux.HandleFunc("/api/status", s.handleAPIStatus)
	mux.HandleFunc("/api/summary", s.handleAPISummary)
	mux.HandleFunc("/api/fleet", s.handleAPISummary) // alias de compatibilidade
	mux.HandleFunc("/api/action", s.handleAPIAction)
	mux.HandleFunc("/api/ticket", s.handleAPITicket)

	addr := fmt.Sprintf(":%d", s.port)
	return http.ListenAndServe(addr, withCORS(mux))
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(indexHTML)
}

func (s *Server) handleAPISummary(w http.ResponseWriter, r *http.Request) {
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
		staminaStr := "42h"
		if sVal, ok := st.Extra["stamina"].(string); ok && sVal != "" {
			staminaStr = sVal
		}
		isInTreino := st.Status == "training"
		telemetryMap := map[string]any{
			"gold":    st.Gold,
			"level":   st.Level,
			"kills":   st.Kills,
			"stamina": staminaStr,
		}
		accLabel := st.ID
		if strings.HasPrefix(st.ID, "acc-") {
			accLabel = "Conta " + strings.TrimPrefix(st.ID, "acc-")
		}
		botsMap[st.ID] = map[string]any{
			"label":     accLabel,
			"name":      "",
			"online":    isOnline,
			"reachable": true,
			"status": map[string]any{
				"status":      st.Status,
				"treino":      isInTreino,
				"state": map[string]any{
					"inTreino": isInTreino,
				},
				"telemetry":   telemetryMap,
				"kills":       st.Kills,
				"vocation":    st.Vocation,
				"currentArea": st.CurrentArea,
				"online":      isOnline,
				"uptimeSec":   st.DurationSec,
				"gold":        st.Gold,
				"level":       st.Level,
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

	summaryMap := map[string]any{
		"botsOnline":       onlineCount,
		"botsTotal":        len(statuses),
		"totalXpPerHour":   totalExpH,
		"totalLootPerHour": totalGoldH,
		"totalGold":        totalGold,
	}

	data := map[string]any{
		"summary": summaryMap,
		"fleet":   summaryMap, // alias retrocompatível
		"bots":    botsMap,
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

	var raw map[string]any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": fmt.Sprintf("JSON inválido: %v", err)})
		return
	}

	var token string
	for _, key := range []string{"turnstileToken", "turnstile_token", "ticket", "token"} {
		if v, ok := raw[key].(string); ok && strings.TrimSpace(v) != "" {
			token = strings.TrimSpace(v)
			break
		}
	}

	if token == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "Campos 'turnstileToken', 'ticket' ou 'token' são obrigatórios"})
		return
	}

	accID, _ := raw["accountId"].(string)
	if err := s.manager.SupplyTurnstileToken(accID, token); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      true,
		"message": "Turnstile token entregue com sucesso!",
	})
}

