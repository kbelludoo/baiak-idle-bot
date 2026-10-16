package game

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
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

type AuctionBrowseListing struct {
	ID           int64          `json:"id"`
	Type         string         `json:"type"` // "item" | "gold"
	Item         *InventoryItem `json:"item,omitempty"`
	GoldAmount   float64        `json:"goldAmount,omitempty"`
	StartPrice   float64        `json:"startPrice"`
	CurrentPrice float64        `json:"currentPrice"`
	BidCount     int            `json:"bidCount"`
	Status       string         `json:"status"`
	CreatedAt    float64        `json:"createdAt"`
	EndsAt       float64        `json:"endsAt"`
	IsOwn        bool           `json:"isOwn"`
	IsLeading    bool           `json:"isLeading"`
}

type CoinBalances struct {
	Coins       int `json:"coins"`
	MarketCoins int `json:"marketCoins"`
	EventCoins  int `json:"eventCoins"`
}

type AuthWindowInfo struct {
	LeftMs float64 `json:"leftMs"`
}

// RunAuctionCycle executa o ciclo completo de leilão:
// 1. Coleta itens e gold encerrados da caixa de entrada
// 2. Executa o Sniper para arrematar lotes e itens com alto spread e lucrar coins
// 3. Cria novos anúncios de itens valiosos e gold excedente
func RunAuctionCycle(ctx context.Context, b *Bot) {
	if b.room == nil || b.room.Closed {
		return
	}

	// 1. Coleta automática de itens e gold da Caixa de Entrada (vendas encerradas, compras arrematadas ou itens devolvidos)
	_ = b.room.Send("inboxtakeall", map[string]any{})
	_ = b.room.Send("goldinboxclaim", map[string]any{})

	// 2. Atualizar saldos de moedas e janela de 2FA
	bal, leftMs := RefreshCoinAndAuthStatus(ctx, b)

	// 3. Executar o Sniper de Leilão (compras e arremates com base em JEV)
	RunAuctionSniper(ctx, b, bal)

	// 4. Consulta anúncios próprios ativos em auction.mine
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

	// Se já temos 10 anúncios ativos (teto do jogo), não tenta anunciar mais
	if activeCount >= 10 {
		return
	}

	pw := b.GetPassword()
	twofaCode := b.GetTwofaCode()

	// 5. Avaliar itens da mochila via items.summary e JEV
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
				if shouldSell && estVal >= 100 {
					if pw == "" && leftMs <= 0 {
						b.addLog(fmt.Sprintf("[JEV-AUCTION] 📢 Item valioso na bag: %s (Tier %d) — Valor est. ~%dc. Defina credentials.password para anunciar!",
							it.Name, int(it.Tier), estVal))
						continue
					}

					token := b.GetTurnstileToken()
					payload := map[string]any{
						"itemHash":      it.Hash,
						"startPrice":    targetPrice,
						"durationHours": 24,
						"password":      pw,
						"twofaCode":     twofaCode,
						"smsCode":       twofaCode,
						"pushProof":     "",
						"confirmText":   it.Name, // Confirmação exata exigida pelo servidor
						"captchaToken":  token,
					}

					res, err := b.trpc.Mutate(ctx, "auction.create", payload)
					if err != nil {
						errStr := strings.ToLower(err.Error())
						if strings.Contains(errStr, "captcha") || strings.Contains(errStr, "turnstile") || token == "" {
							b.addLog(fmt.Sprintf("[JEV-AUCTION] ⚠️ Captcha Turnstile necessário para anunciar %s: acionando solver...", it.Name))
							b.TriggerCaptchaSolver()
						} else if strings.Contains(errStr, "2fa") || strings.Contains(errStr, "sms") || strings.Contains(errStr, "reauth") {
							b.addLog(fmt.Sprintf("[JEV-AUCTION] 🔐 Reautenticação 2FA necessária para listar %s. Use /api/action 'reauth_2fa' com o código de 6 dígitos.", it.Name))
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

	// 6. Venda de Gold Excedente (quando saldo > 105kk e sem anúncio próprio ativo de gold)
	if !hasActiveGold && activeCount < 10 {
		shouldSell, goldToSell, targetCoins, reason := b.jev.EvaluateGoldForAuction(b.primaryChar.Gold, 5000000)
		if shouldSell {
			if pw == "" && leftMs <= 0 {
				b.addLog(fmt.Sprintf("[AUCTION] 📢 Saldo de %dkk gold elegível para leilão (~%d coins). Defina credentials.password para anunciar!",
					goldToSell/1000000, targetCoins))
				return
			}

			token := b.GetTurnstileToken()
			payload := map[string]any{
				"goldAmount":    goldToSell,
				"startPrice":    targetCoins,
				"durationHours": 24,
				"password":      pw,
				"twofaCode":     twofaCode,
				"smsCode":       twofaCode,
				"pushProof":     "",
				"confirmText":   "CONFIRMAR",
				"captchaToken":  token,
			}

			res, err := b.trpc.Mutate(ctx, "auction.createGold", payload)
			if err != nil {
				errStr := strings.ToLower(err.Error())
				if strings.Contains(errStr, "captcha") || strings.Contains(errStr, "turnstile") || token == "" {
					b.addLog(fmt.Sprintf("[AUCTION] ⚠️ Captcha Turnstile necessário para anunciar %dkk gold: acionando solver...", goldToSell/1000000))
					b.TriggerCaptchaSolver()
				} else if strings.Contains(errStr, "2fa") || strings.Contains(errStr, "sms") || strings.Contains(errStr, "reauth") {
					b.addLog(fmt.Sprintf("[AUCTION] 🔐 Reautenticação 2FA necessária para listar gold. Use /api/action 'reauth_2fa' com o código de 6 dígitos."))
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

// RunAuctionSniper monitora os leilões ativos da comunidade e dá lances lucrativos
func RunAuctionSniper(ctx context.Context, b *Bot, bal CoinBalances) {
	totalUsableCoins := bal.Coins + bal.MarketCoins
	if totalUsableCoins < 25 {
		// No Baiak Idle, o lance mínimo da plataforma é 25 coins
		return
	}

	browseRaw, err := b.trpc.Query(ctx, "auction.browse", nil)
	if err != nil {
		return
	}

	rawBytes, _ := json.Marshal(browseRaw)
	var browseResp struct {
		Rows []AuctionBrowseListing `json:"rows"`
	}
	if err := json.Unmarshal(rawBytes, &browseResp); err != nil {
		return
	}

	nowMs := float64(time.Now().UnixMilli())

	for _, l := range browseResp.Rows {
		if l.Status != "active" || l.IsOwn || l.IsLeading {
			continue
		}

		// Cálculo do lance mínimo de acordo com as regras do jogo
		var minBid float64
		if l.BidCount <= 0 {
			minBid = l.StartPrice
		} else {
			inSoftClose := (l.EndsAt - nowMs) <= 60000.0
			step := 1.0
			if inSoftClose {
				step = math.Max(1.0, math.Ceil(l.CurrentPrice*0.10))
			}
			minBid = l.CurrentPrice + step
		}

		if minBid < 25 {
			minBid = 25
		}

		// Se o lance excede nosso saldo total disponível, pula
		if int(minBid) > totalUsableCoins {
			continue
		}

		minsLeft := (l.EndsAt - nowMs) / 60000.0

		// Caso A: Lote de Gold super barato (ex: taxa >= 8kk por coin)
		if l.Type == "gold" && l.GoldAmount > 0 {
			goldPerCoin := l.GoldAmount / minBid
			// Taxa de referência do mercado é ~5kk por coin. Se pagar 8kk+ por coin, é muito lucrativo
			if goldPerCoin >= 8000000 && (minsLeft <= 5.0 || l.BidCount == 0) {
				curr := "normal"
				if bal.MarketCoins >= int(minBid) {
					curr = "market"
				}
				payload := map[string]any{
					"listingId": l.ID,
					"maxAmount": int(minBid),
					"currency":  curr,
				}
				_, err := b.trpc.Mutate(ctx, "auction.bid", payload)
				if err != nil {
					b.addLog(fmt.Sprintf("[SNIPER] ⚠️ Falha ao arrematar %dkk gold (ID #%d): %v", int(l.GoldAmount/1000000), l.ID, err))
				} else {
					b.addLog(fmt.Sprintf("[SNIPER] 🎯 LANCE DADO em %dkk gold por %d coins (Taxa excelente: %.1fkk/c)! Aguardando finalização.",
						int(l.GoldAmount/1000000), int(minBid), goldPerCoin/1000000))
					return // Executa 1 lance por ciclo para preservar moedas
				}
			}
		}

		// Caso B: Item valioso com grande margem de revenda
		if l.Type == "item" && l.Item != nil {
			estVal := EstimateItemMarketValueCoins(l.Item.Name, int(l.Item.Tier), int(l.Item.UpLevel), l.Item.Attrs)
			// Margem mínima de 35 coins de lucro
			if estVal >= int(minBid)+35 && (minsLeft <= 5.0 || l.BidCount == 0) {
				curr := "normal"
				if bal.MarketCoins >= int(minBid) {
					curr = "market"
				}
				payload := map[string]any{
					"listingId": l.ID,
					"maxAmount": int(minBid),
					"currency":  curr,
				}
				_, err := b.trpc.Mutate(ctx, "auction.bid", payload)
				if err != nil {
					b.addLog(fmt.Sprintf("[SNIPER] ⚠️ Falha ao arrematar item %s (Tier %d): %v", l.Item.Name, int(l.Item.Tier), err))
				} else {
					b.addLog(fmt.Sprintf("[SNIPER] 🎯 LANCE DADO no item %s (Tier %d, +%d) por %d coins (Valor de mercado: ~%dc | Margem: +%dc)!",
						l.Item.Name, int(l.Item.Tier), int(l.Item.UpLevel), int(minBid), estVal, estVal-int(minBid)))
					return
				}
			}
		}
	}
}

// RefreshCoinAndAuthStatus consulta o saldo de moedas e a janela de 2FA
func RefreshCoinAndAuthStatus(ctx context.Context, b *Bot) (CoinBalances, float64) {
	var bal CoinBalances
	var leftMs float64 = 0

	balRaw, err := b.trpc.Query(ctx, "coin.balances", nil)
	if err == nil {
		bBytes, _ := json.Marshal(balRaw)
		_ = json.Unmarshal(bBytes, &bal)
	}

	authRaw, err := b.trpc.Query(ctx, "coin.authWindow", nil)
	if err == nil {
		var win AuthWindowInfo
		wBytes, _ := json.Marshal(authRaw)
		if err := json.Unmarshal(wBytes, &win); err == nil {
			leftMs = win.LeftMs
		}
	}

	b.UpdateCoinStatus(bal.Coins, bal.MarketCoins, leftMs)
	return bal, leftMs
}
