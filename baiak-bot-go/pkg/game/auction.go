package game

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type AuctionMineListing struct {
	ID           any     `json:"id"`
	Status       string  `json:"status"`
	Type         string  `json:"type"`
	CurrentPrice float64 `json:"currentPrice"`
	GoldAmount   float64 `json:"goldAmount,omitempty"`
	BidCount     int     `json:"bidCount"`
	EndsAt       float64 `json:"endsAt"`
	CreatedAt    float64 `json:"createdAt"`
}

// RunAuctionCycle executa o ciclo completo de leilão: coleta de inbox, anúncio de itens valiosos e venda de gold
func RunAuctionCycle(ctx context.Context, b *Bot) {
	if b.room == nil || b.room.Closed {
		return
	}

	// 1. Coleta automática de itens e gold da Caixa de Entrada (vendas encerradas ou devolvidas)
	_ = b.room.Send("inboxtakeall", map[string]any{})
	_ = b.room.Send("goldinboxclaim", map[string]any{})

	// 2. Consulta anúncios próprios ativos em auction.mine
	mineRaw, err := b.trpc.Query(ctx, "auction.mine", nil)
	if err != nil {
		return
	}

	rawBytes, _ := json.Marshal(mineRaw)
	var myListings []AuctionMineListing
	_ = json.Unmarshal(rawBytes, &myListings)

	nowMs := float64(time.Now().UnixMilli())
	activeCount := 0
	hasActiveGold := false

	for _, l := range myListings {
		isActive := l.Status == "active" || l.EndsAt > nowMs
		if isActive {
			activeCount++
			if l.Type == "gold" || l.GoldAmount > 0 {
				hasActiveGold = true
			}
		}
	}

	// 3. Avaliar itens da mochila via items.summary e JEV
	if activeCount < 10 {
		summaryRaw, err := b.trpc.Query(ctx, "items.summary", nil)
		if err == nil {
			var summary struct {
				Items []InventoryItem `json:"items"`
			}
			sBytes, _ := json.Marshal(summaryRaw)
			if err := json.Unmarshal(sBytes, &summary); err == nil {
				for _, it := range summary.Items {
					if activeCount >= 10 {
						break
					}
					// Itens equipados ou sem hash único não são leiloados
					if it.Location == "equipped" || it.Hash == "" {
						continue
					}

					// Avalia com JEV
					shouldSell, targetPrice, estVal, reason := b.jev.EvaluateItemForAuction(ctx, it.Name, int(it.Tier), int(it.UpLevel), nil)
					if shouldSell && estVal >= 80 {
						pw := b.GetPassword()
						token := b.GetTurnstileToken()

						payload := map[string]any{
							"itemHash":      it.Hash,
							"startPrice":    targetPrice,
							"durationHours": 24,
							"password":      pw,
							"twofaCode":     "",
							"smsCode":       "",
							"pushProof":     "",
							"confirmText":   "CONFIRMAR",
							"captchaToken":  token,
						}

						res, err := b.trpc.Mutate(ctx, "auction.create", payload)
						if err != nil {
							errStr := strings.ToLower(err.Error())
							if strings.Contains(errStr, "captcha") || strings.Contains(errStr, "challenge") || strings.Contains(errStr, "turnstile") {
								b.addLog(fmt.Sprintf("[JEV-AUCTION] ⚠️ Servidor pediu Captcha Turnstile ao anunciar %s: acionando solver...", it.Name))
								b.TriggerCaptchaSolver()
							} else if strings.Contains(errStr, "reauth") || strings.Contains(errStr, "password") {
								b.addLog(fmt.Sprintf("[JEV-AUCTION] ⚠️ Falha de senha ao anunciar %s: configure credentials.password no accounts.json", it.Name))
							} else {
								b.addLog(fmt.Sprintf("[JEV-AUCTION] Erro ao anunciar %s: %v", it.Name, err))
							}
							continue
						}

						_ = res
						activeCount++
						b.addLog(fmt.Sprintf("[JEV-AUCTION] ✔ Item anunciado no leilão: %s (Tier %d, +%d) por %d coins (Valor est. ~%dc) | %s",
							it.Name, int(it.Tier), int(it.UpLevel), targetPrice, estVal, reason))
						time.Sleep(1 * time.Second) // Throttle
					}
				}
			}
		}
	}

	// 4. Venda de Gold Excedente (quando saldo > 105kk e sem anúncio próprio ativo de gold)
	if !hasActiveGold && activeCount < 10 {
		shouldSell, goldToSell, targetCoins, reason := b.jev.EvaluateGoldForAuction(b.primaryChar.Gold, 5000000)
		if shouldSell {
			pw := b.GetPassword()
			token := b.GetTurnstileToken()

			payload := map[string]any{
				"goldAmount":    goldToSell,
				"startPrice":    targetCoins,
				"durationHours": 24,
				"password":      pw,
				"twofaCode":     "",
				"smsCode":       "",
				"pushProof":     "",
				"confirmText":   "CONFIRMAR",
				"captchaToken":  token,
			}

			res, err := b.trpc.Mutate(ctx, "auction.createGold", payload)
			if err != nil {
				errStr := strings.ToLower(err.Error())
				if strings.Contains(errStr, "captcha") || strings.Contains(errStr, "challenge") || strings.Contains(errStr, "turnstile") {
					b.addLog(fmt.Sprintf("[AUCTION] ⚠️ Servidor pediu Captcha Turnstile ao anunciar %dkk gold: acionando solver...", goldToSell/1000000))
					b.TriggerCaptchaSolver()
				} else if strings.Contains(errStr, "reauth") || strings.Contains(errStr, "password") {
					b.addLog(fmt.Sprintf("[AUCTION] ⚠️ Falha de senha ao anunciar gold: configure credentials.password no accounts.json"))
				} else {
					b.addLog(fmt.Sprintf("[AUCTION] Erro ao anunciar gold: %v", err))
				}
				return
			}

			_ = res
			b.addLog(fmt.Sprintf("[AUCTION] 💰 Anúncio de GOLD criado: %dkk por %d coins! (%s)", goldToSell/1000000, targetCoins, reason))
		}
	}
}
