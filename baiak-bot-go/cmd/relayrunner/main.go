package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"baiak-bot/pkg/browser"
)

func main() {
	browserPath := flag.String("browser-path", "", "caminho do executavel chromium")
	gameURL := flag.String("game", "https://baiakidle.com", "url do jogo")
	tunnelURL := flag.String("tunnel", "", "url base do cloudflare tunnel")
	cookie := flag.String("cookie", "", "cookie de sessao")
	timeout := flag.Duration("timeout", 100*time.Second, "tempo limite")
	flag.Parse()

	if *tunnelURL == "" {
		*tunnelURL = os.Getenv("TICKET_RELAY_TUNNEL")
	}
	if *gameURL == "" {
		*gameURL = "https://baiakidle.com"
	}
	if *cookie == "" {
		*cookie = os.Getenv("TIBIDLE_SESSION")
	}

	if *tunnelURL == "" {
		log.Fatal("Parâmetro -tunnel ou variável TICKET_RELAY_TUNNEL é obrigatório")
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	cfg := browser.DefaultStealthConfig()
	if *browserPath != "" {
		cfg.BrowserPath = *browserPath
	}
	cfg.Headless = false // No runner com xvfb, headless=false garante contexto gráfico real

	log.Printf("[relayrunner] Iniciando Chromium com Stealth: %s", cfg.BrowserPath)
	session, err := browser.LaunchStealth(ctx, cfg)
	if err != nil {
		log.Fatalf("[relayrunner] falha ao iniciar sessão stealth: %v", err)
	}
	defer session.Close()

	// Injeta o hook de relay para interceptar requisições ou renderizar Turnstile
	hook := browser.TicketRelayHook(*tunnelURL)
	if err := session.AddInitScript(ctx, hook); err != nil {
		log.Fatalf("[relayrunner] falha ao injetar hook: %v", err)
	}

	log.Printf("[relayrunner] Navegando para %s ...", *gameURL)
	if err := session.Navigate(ctx, *gameURL); err != nil {
		log.Fatalf("[relayrunner] falha na navegação: %v", err)
	}

	// Executa solver in-page diretamente no domínio oficial do jogo
	renderScript := fmt.Sprintf(`(() => {
		const div = document.createElement('div');
		div.id = 'turnstile-auto-container';
		document.body.appendChild(div);
		const s = document.createElement('script');
		s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
		s.async = true;
		s.onload = () => {
			if (window.turnstile) {
				window.turnstile.render(div, {
					sitekey: '0x4AAAAAAD1KLtRAtKEsbKdT',
					callback: (t) => {
						window.__turnstileSolved = t;
						fetch('%s/api/ticket', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ turnstileToken: t })
						}).catch(() => {});
					}
				});
			}
		};
		document.head.appendChild(s);
	})()`, *tunnelURL)

	_, _ = session.Evaluate(ctx, renderScript)

	// Auto-clicker para checkbox do Turnstile caso o Cloudflare exiba desafio interativo
	go func() {
		clickTicker := time.NewTicker(2 * time.Second)
		defer clickTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-clickTicker.C:
				res, err := session.Evaluate(ctx, `(() => {
					const iframes = Array.from(document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]'));
					for (const f of iframes) {
						const r = f.getBoundingClientRect();
						if (r.width > 20 && r.height > 20) {
							return { x: r.left + 30, y: r.top + r.height / 2 };
						}
					}
					return null;
				})()`)
				if err == nil && string(res) != "null" && string(res) != "" {
					var pt struct {
						X float64 `json:"x"`
						Y float64 `json:"y"`
					}
					if json.Unmarshal(res, &pt) == nil && pt.X > 0 {
						log.Printf("[relayrunner] Detectado checkbox do Turnstile em (%.0f, %.0f) -> Clicando automaticamente...", pt.X, pt.Y)
						session.MouseJitter(ctx, 3)
						_ = session.ClickAt(ctx, pt.X, pt.Y)
					}
				}
			}
		}
	}()

	log.Printf("[relayrunner] Aguardando resolução do Turnstile...")
	pollTicker := time.NewTicker(1 * time.Second)
	defer pollTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Fatalf("[relayrunner] Timeout de %v atingido sem captura do token", *timeout)
		case <-pollTicker.C:
			res, err := session.Evaluate(ctx, `window.__turnstileSolved || (window.__ticketRelay ? window.__ticketRelay.token : "")`)
			if err == nil {
				var tok string
				_ = json.Unmarshal(res, &tok)
				if len(tok) > 20 {
					log.Printf("✔ [relayrunner] Token capturado com sucesso (%d chars)! Notificando VPS...", len(tok))
					// Garante entrega na VPS
					postBody, _ := json.Marshal(map[string]string{"turnstileToken": tok})
					hc := &http.Client{Timeout: 10 * time.Second}
					_, _ = hc.Post(*tunnelURL+"/api/ticket", "application/json", bytes.NewReader(postBody))
					log.Printf("✔ [relayrunner] Concluído com sucesso!")
					return
				}
			}
		}
	}
}
