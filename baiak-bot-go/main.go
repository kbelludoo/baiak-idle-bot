package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"baiak-bot/pkg/engine"
	"baiak-bot/pkg/game"
	"baiak-bot/pkg/server"
)

//go:embed accounts.example.json
var defaultAccountsJSON []byte

func formatGold(n int64) string {
	if n < 1000 {
		return fmt.Sprintf("%d", n)
	}
	if n < 1_000_000 {
		return fmt.Sprintf("%.1fk", float64(n)/1000.0)
	}
	return fmt.Sprintf("%.2fkk", float64(n)/1_000_000.0)
}

func main() {
	log.Println("================================================================================")
	log.Println("       ⚡ BAIAK IDLE - MULTI-ACCOUNT BOT ENGINE (NATIVE GO ULTRA-LEVE) ⚡       ")
	log.Println("================================================================================")

	configFile := "accounts.json"
	content, err := os.ReadFile(configFile)
	if err != nil {
		log.Printf("Aviso: %s não encontrado. Criando a partir de accounts.example.json...", configFile)
		_ = os.WriteFile(configFile, defaultAccountsJSON, 0644)
		content = defaultAccountsJSON
	}

	var accountConfigs []game.AccountConfig
	if err := json.Unmarshal(content, &accountConfigs); err != nil {
		log.Fatalf("Falha ao analisar %s: %v", configFile, err)
	}

	targetAcc := os.Getenv("ACCOUNT")
	var activeConfigs []game.AccountConfig

	for _, a := range accountConfigs {
		if !a.Enabled && a.ID != targetAcc {
			continue
		}
		if targetAcc != "" && a.ID != targetAcc {
			continue
		}
		activeConfigs = append(activeConfigs, a)
	}

	if len(activeConfigs) == 0 {
		log.Println("⚠️ Nenhuma conta com 'enabled: true' encontrada em accounts.json.")
		log.Println("Edite accounts.json com seu token e habilite sua conta para iniciar.")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	manager := engine.NewBotManager()

	log.Printf("Iniciando %d conta(s) em Goroutines isoladas com supervisor…\n", len(activeConfigs))
	for _, cfg := range activeConfigs {
		b := game.NewBot(cfg)
		manager.Register(b)
		go engine.RunWithSupervisor(ctx, b)
	}

	// 2. Servidor Web / Dashboard HTTP
	webPort := 3001
	if p := os.Getenv("PORT"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			webPort = v
		}
	}

	srv := server.NewServer(webPort, manager)
	go func() {
		log.Printf("[Web Server] Dashboard online em http://localhost:%d\n", webPort)
		if err := srv.Start(); err != nil {
			log.Printf("[Web Server] Encerrado: %v", err)
		}
	}()

	// 3. Monitor no Terminal (atualiza a cada 4 segundos com estatísticas de RAM)
	go func() {
		time.Sleep(2 * time.Second)
		ticker := time.NewTicker(4 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				var m runtime.MemStats
				runtime.ReadMemStats(&m)
				allocMB := float64(m.Alloc) / 1024.0 / 1024.0
				sysMB := float64(m.Sys) / 1024.0 / 1024.0

				statuses := manager.GetAllStatuses()
				var totalGold int64 = 0
				totalKills := 0
				huntingCount := 0

				for _, st := range statuses {
					totalGold += st.Gold
					totalKills += st.Kills
					if st.Status == "hunting" {
						huntingCount++
					}
				}

				fmt.Print("\033[H\033[2J") // Limpar tela do terminal
				fmt.Println("================================================================================")
				fmt.Printf("   ⚡ BAIAK BOT CONSOLE — RAM: %.2f MB (Sys: %.2f MB) | Goroutines: %d\n", allocMB, sysMB, runtime.NumGoroutine())
				fmt.Printf("   📊 Contas: %d/%d Caçando | Ouro Total: %s | Total Kills: %d\n", huntingCount, len(statuses), formatGold(totalGold), totalKills)
				fmt.Printf("   🌐 Dashboard Web: http://localhost:%d\n", webPort)
				fmt.Println("================================================================================")

				for _, st := range statuses {
					stamina := "n/a"
					strategy := "AUTO"
					if s, ok := st.Extra["stamina"].(string); ok {
						stamina = s
					}
					if strat, ok := st.Extra["strategy"].(string); ok {
						strategy = strat
					}

					fmt.Printf("▸ [%s] %s (Lv. %d %s) | Status: %s | Foco: %s\n", st.ID, st.Name, st.Level, st.Vocation, st.Status, strategy)
					fmt.Printf("  Ouro: %s | Stamina: %s | Kills: %d | Hunt: %s\n", formatGold(st.Gold), stamina, st.Kills, st.CurrentArea)
					if st.ExpPerHour > 0 || st.GoldPerHour > 0 {
						fmt.Printf("  Rendimento: EXP/H: %s | Gold/H: %s\n", formatGold(int64(st.ExpPerHour)), formatGold(int64(st.GoldPerHour)))
					}
					fmt.Println("--------------------------------------------------------------------------------")
				}
			}
		}
	}()

	// 4. Aguardar encerramento gracioso via Sinais do SO
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("\nEncerrando bot com segurança...")
	cancel()
	time.Sleep(1 * time.Second)
	log.Println("Desligamento concluído.")
}
