package game

import (
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"strings"
	"sync"
	"time"

	"baiak-bot/pkg/auth"
	"baiak-bot/pkg/engine"
)

type Bot struct {
	config    AccountConfig
	mu        sync.RWMutex
	status    engine.AccountStatus
	trpc      *TRPCClient
	room      *Room
	endpoint  Endpoint
	dataDir   string
	deviceID  string
	jev       *JevClient

	// Captcha & Turnstile & 2FA
	turnstileToken   string
	turnstileTokenAt time.Time
	turnstileChan    chan string
	twofaCode        string
	twofaCodeAt      time.Time

	// Estado dinâmico da conta
	primaryChar    CharacterInfo
	allChars       []CharacterInfo
	partyConfig    *PartyConfig
	currentHuntID  string
	currentStrategy string
	inTreino       bool
	staged         bool
	treinoEnteredAt time.Time

	// Passe de Temporada, Rift Tree e Perks de Arma
	passMgr        *PassManager
	riftMgr        *RiftManager
	profMgr        *ProficiencyManager
	currentTier    string // "" normal, "nm" nightmare, "hl" hell

	// Anti-wipe
	deathTimestamps []time.Time
	lastDowngradeAt time.Time
}

func NewBot(cfg AccountConfig) *Bot {
	st := engine.NewStatus(cfg.ID, cfg.Name)
	endpoint := EndpointFromOrigin(cfg.Credentials.Origin)
	dataDir := fmt.Sprintf("./data/%s", cfg.ID)

	b := &Bot{
		config:          cfg,
		status:          st,
		endpoint:        endpoint,
		dataDir:         dataDir,
		deviceID:        LoadOrCreateDeviceID(dataDir),
		trpc:            NewTRPCClient(cfg.Credentials.Token, cfg.Credentials.Origin, cfg.Settings.BindIP),
		currentStrategy: cfg.Settings.Priority,
		jev:             NewJevClient(),
		turnstileChan:   make(chan string, 5),
		passMgr:         NewPassManager(),
		riftMgr:         NewRiftManager(),
		profMgr:         NewProficiencyManager(),
		currentTier:     "",
	}

	return b
}

func (b *Bot) ID() string {
	return b.config.ID
}

func (b *Bot) Name() string {
	return b.config.Name
}

func (b *Bot) addLog(msg string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	entry := fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05"), msg)
	b.status.Logs = append(b.status.Logs, entry)
	if len(b.status.Logs) > 20 {
		b.status.Logs = b.status.Logs[len(b.status.Logs)-20:]
	}
	log.Printf("[%s] %s", b.config.ID, msg)
}

func (b *Bot) updateStatus(fn func(s *engine.AccountStatus)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	fn(&b.status)
	b.status.UpdatedAt = time.Now().UnixMilli()
}

func FormatStamina(mins int) string {
	if mins <= 0 {
		return "0min (0%)"
	}
	h := mins / 60
	m := mins % 60
	pct := int(math.Round(float64(mins) / 2520.0 * 100.0))
	if pct > 100 {
		pct = 100
	}
	if h > 0 {
		return fmt.Sprintf("%dh %02dm (%d%%)", h, m, pct)
	}
	return fmt.Sprintf("%dmin (%d%%)", m, pct)
}

func (b *Bot) Init(ctx context.Context) error {
	b.updateStatus(func(s *engine.AccountStatus) {
		s.Status = "Carregando dados da conta..."
	})

	chars, err := b.trpc.GetCharacters(ctx)
	if err != nil {
		return fmt.Errorf("falha ao obter characters.list: %w", err)
	}
	if len(chars) == 0 {
		return fmt.Errorf("characters.list vazio para a conta %s", b.ID())
	}
	b.allChars = chars

	partyCfg, _ := b.trpc.GetPartyConfig(ctx)
	b.partyConfig = partyCfg

	// Determinar personagem líder ou de maior nível ativo
	disabledSet := make(map[string]bool)
	if partyCfg != nil {
		for _, dis := range partyCfg.Disabled {
			disabledSet[fmt.Sprint(dis)] = true
		}
	}

	var activePool []CharacterInfo
	for _, c := range chars {
		if !disabledSet[fmt.Sprint(c.ID)] {
			activePool = append(activePool, c)
		}
	}
	if len(activePool) == 0 {
		activePool = chars
	}

	primary := activePool[0]
	for _, c := range activePool {
		if c.Level > primary.Level {
			primary = c
		}
	}
	b.primaryChar = primary

	// Definir estratégia inicial (se não especificada manualmente)
	if b.currentStrategy == "" {
		if len(activePool) >= 3 {
			b.currentStrategy = "xp"
		} else {
			b.currentStrategy = "gold"
		}
	}

	// Definir hunt alvo inicial
	huntTarget := b.config.Settings.HuntTarget
	if huntTarget == "" {
		huntTarget = PickBestHunt(primary.Level, b.currentStrategy)
	}
	b.currentHuntID = huntTarget

	facts, _ := GetHuntFacts(b.currentHuntID)
	huntName := facts.Name
	if huntName == "" {
		huntName = b.currentHuntID
	}

	b.updateStatus(func(s *engine.AccountStatus) {
		s.Level = primary.Level
		s.Vocation = primary.Vocation
		s.Gold = primary.Gold
		s.CurrentArea = huntName
		s.Status = "Pronto para caçar"
		s.Extra["stamina"] = FormatStamina(primary.Stamina)
		s.Extra["activeParty"] = len(activePool)
		s.Extra["strategy"] = b.currentStrategy
		s.Extra["charName"] = primary.Name
	})

	b.addLog(fmt.Sprintf("Personagem: %s (Lv %d %s) | Party: %d ativos | Estratégia: %s | Hunt: %s",
		primary.Name, primary.Level, primary.Vocation, len(activePool), strings.ToUpper(b.currentStrategy), huntName))

	return nil
}

func (b *Bot) Run(ctx context.Context) error {
	b.updateStatus(func(s *engine.AccountStatus) {
		s.Status = "Conectando sala..."
	})

	fp := BuildFingerprint(b.deviceID, DefaultEnv())
	joinBody := map[string]any{
		"token":       b.config.Credentials.Token,
		"characterId": b.primaryChar.ID,
		"fp":          fp,
		"ext":         []string{},
		"disabled":    false,
	}

	// 1. Matchmaking
	b.addLog("Realizando matchmaking para sala 'hunt'...")
	seat, err := Matchmake(ctx, b.endpoint, "joinOrCreate", "hunt", joinBody, b.config.Settings.BindIP)
	if err != nil {
		// Se exigir fila ("queue")
		errMsg := strings.ToLower(err.Error())
		if strings.Contains(errMsg, "fila") || strings.Contains(errMsg, "queue") || strings.Contains(errMsg, "aguarde") {
			b.addLog("Servidor solicitou entrada na fila. Entrando na sala 'queue'...")
			qSeat, qErr := Matchmake(ctx, b.endpoint, "joinOrCreate", "queue", map[string]any{"token": b.config.Credentials.Token}, b.config.Settings.BindIP)
			if qErr != nil {
				return fmt.Errorf("falha ao entrar na fila: %w", qErr)
			}
			qRoom, qConnErr := ConnectRoom(ctx, b.endpoint, *qSeat, b.config.Settings.BindIP, b.addLog)
			if qConnErr != nil {
				return fmt.Errorf("falha ao conectar na fila: %w", qConnErr)
			}

			admitTokenChan := make(chan string, 1)
			qRoom.On("go", func(payload any) {
				if m, ok := payload.(map[string]any); ok {
					if tok, has := m["token"].(string); has {
						admitTokenChan <- tok
					}
				}
			})

			select {
			case <-ctx.Done():
				qRoom.Close()
				return ctx.Err()
			case tok := <-admitTokenChan:
				qRoom.Close()
				b.addLog("Liberado da fila! Conectando com admitToken...")
				joinBody["admitToken"] = tok
				seat, err = Matchmake(ctx, b.endpoint, "joinOrCreate", "hunt", joinBody, b.config.Settings.BindIP)
				if err != nil {
					return fmt.Errorf("matchmake pós-fila falhou: %w", err)
				}
			case <-time.After(3 * time.Minute):
				qRoom.Close()
				return fmt.Errorf("timeout aguardando liberação da fila")
			}
		} else {
			return fmt.Errorf("matchmake hunt falhou: %w", err)
		}
	}

	// 2. Conectar WebSocket Colyseus e aguardar handshake
	room, err := ConnectRoom(ctx, b.endpoint, *seat, b.config.Settings.BindIP, b.addLog)
	if err != nil {
		return fmt.Errorf("falha ao conectar room: %w", err)
	}
	defer room.Close()
	b.room = room

	b.addLog(fmt.Sprintf("Conectado à sala Colyseus %s (serializer: %s)", seat.RoomID, room.SerializerID))
	b.updateStatus(func(s *engine.AccountStatus) {
		s.Status = "hunting"
	})

	// 3. Handlers de eventos da sala
	room.On("toHunt", func(p any) {
		b.inTreino = false
		b.updateStatus(func(s *engine.AccountStatus) {
			s.Status = "hunting"
		})
	})

	room.On("toCity", func(p any) {
		if !b.inTreino {
			b.addLog("Servidor enviou para a cidade. Re-enviando stage em 5s...")
			time.AfterFunc(5*time.Second, func() {
				if !room.Closed && !b.inTreino {
					b.sendStage("volta da cidade")
				}
			})
		}
	})

	room.On("deaths", func(p any) {
		now := time.Now()
		b.deathTimestamps = append(b.deathTimestamps, now)
		// Manter janela de 10 minutos
		cutoff := now.Add(-10 * time.Minute)
		filtered := b.deathTimestamps[:0]
		for _, t := range b.deathTimestamps {
			if t.After(cutoff) {
				filtered = append(filtered, t)
			}
		}
		b.deathTimestamps = filtered

		b.addLog(fmt.Sprintf("Wipe detectado (%d wipes nos últimos 10min).", len(b.deathTimestamps)))
		if len(b.deathTimestamps) >= 3 && now.Sub(b.lastDowngradeAt) > 5*time.Minute {
			b.lastDowngradeAt = now
			curMin := 9999
			if f, ok := GetHuntFacts(b.currentHuntID); ok {
				curMin = f.MinLevel
			}
			// Buscar hunt mais fraca imediatamente abaixo
			var weaker *HuntInfo
			for _, h := range GetAllHunts() {
				if h.MinLevel < curMin {
					if weaker == nil || h.MinLevel > weaker.MinLevel {
						cpy := h
						weaker = &cpy
					}
				}
			}
			if weaker != nil {
				b.addLog(fmt.Sprintf("🛑 Anti-wipe: hunt muito forte. Descendo para %s (Lv %d)", weaker.Name, weaker.MinLevel))
				b.currentHuntID = weaker.ID
			}
		}

		time.AfterFunc(5*time.Second, func() {
			if !room.Closed && !b.inTreino {
				b.sendStage("após morte")
			}
		})
	})

	room.On("log", func(p any) {
		if m, ok := p.(map[string]any); ok {
			txt := strings.ToLower(fmt.Sprint(m["text"]))
			if strings.Contains(txt, "stamina insuficiente") || strings.Contains(txt, "sem stamina") || strings.Contains(txt, "caça bloqueada") {
				b.inTreino = true
				_ = room.Send("mode", map[string]any{"mode": "exercise"})
				_ = room.Send("tocity", map[string]any{})
				b.updateStatus(func(s *engine.AccountStatus) {
					s.Status = "training"
				})
				b.addLog("🧘 Stamina insuficiente acusada pelo servidor: alternando para Treino Online")
			}
		}
	})

	room.On("buyresult", func(p any) {
		b.addLog(fmt.Sprintf("🛒 Compra na loja: %v", p))
	})

	room.On("bpstatus", func(p any) {
		b.passMgr.HandleBPStatus(p, b.addLog)
	})

	room.On("rift", func(p any) {
		b.riftMgr.HandleRiftState(p)
	})

	room.On("progression", func(p any) {
		if b.riftMgr.HandleProgression(p, b.addLog) {
			b.mu.Lock()
			newTier := b.riftMgr.GetTier()
			changed := newTier != b.currentTier
			if changed {
				b.currentTier = newTier
			}
			b.mu.Unlock()

			if changed {
				b.sendStage("desbloqueio tier " + newTier)
			}
		}
	})

	room.On("profstate", func(p any) {
		b.profMgr.HandleProfState(p, room, b.addLog)
	})

	// 4. Inicializar caçada com comandos Colyseus oficiais
	if b.config.Settings.AutoTreino && b.primaryChar.Stamina <= 1260 {
		b.checkAutoTreino(room)
	} else {
		b.sendStage("entrada na sala")
	}
	_ = room.Send("loop", true)
	_ = room.Send("offlinemode", map[string]any{"mode": "hunt", "huntId": b.currentHuntID})
	_ = room.Send("autosellfull", map[string]any{"on": true})
	_ = room.Send("autosellpct", map[string]any{"pct": 85})
	_ = room.Send("protecttiers", map[string]any{"tiers": []int{3, 4, 5, 6, 7, 8, 9, 10}})
	_ = room.Send("codexauto", map[string]any{"on": true})

	// Sincronizar rotação de magias, cura e poções BiS para a party
	SyncPartyAutoConfig(ctx, b.trpc, room, b.allChars, b.addLog)

	// Gasto de talentos automático
	if b.config.Settings.AutoTree {
		go SpendTalentsForParty(ctx, room, b.allChars, b.addLog)
	}

	// Auto-equip de itens melhores na mochila
	minTier := b.config.Settings.EquipMinTier
	if minTier <= 0 {
		minTier = 3
	}
	for idx, c := range b.allChars {
		if idx <= 3 {
			RunAutoEquip(ctx, b.trpc, room, c, idx, minTier, b.addLog)
		}
	}

	// 5. Tickers periódicos
	rewardTicker := time.NewTicker(30 * time.Second)
	defer rewardTicker.Stop()

	arenaTicker := time.NewTicker(30 * time.Minute)
	defer arenaTicker.Stop()

	equipTicker := time.NewTicker(5 * time.Minute)
	defer equipTicker.Stop()

	pollTicker := time.NewTicker(60 * time.Second)
	defer pollTicker.Stop()

	ratesTicker := time.NewTicker(15 * time.Second)
	defer ratesTicker.Stop()

	auctionTicker := time.NewTicker(90 * time.Second)
	defer auctionTicker.Stop()

	seasonTicker := time.NewTicker(3 * time.Minute)
	defer seasonTicker.Stop()

	// Dispara o primeiro ciclo de leilão e coleta de inbox após 10 segundos
	go func() {
		time.Sleep(10 * time.Second)
		RunAuctionCycle(ctx, b)
	}()

	// Dispara verificação do passe de temporada, rift tree e perks de arma após conexão
	go func() {
		time.Sleep(5 * time.Second)
		if !room.Closed {
			b.passMgr.CheckAndClaim(ctx, room, b.addLog)
			b.riftMgr.SpendRiftTree(ctx, room, b.allChars, b.addLog)
			b.profMgr.CheckAndSpendPerks(ctx, room, b.allChars, b.addLog)
		}
	}()

	lastGold := b.primaryChar.Gold
	lastSampleAt := time.Now()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case <-auctionTicker.C:
			RunAuctionCycle(ctx, b)

		case <-seasonTicker.C:
			if !room.Closed {
				b.passMgr.CheckAndClaim(ctx, room, b.addLog)
				b.riftMgr.SpendRiftTree(ctx, room, b.allChars, b.addLog)
				b.profMgr.CheckAndSpendPerks(ctx, room, b.allChars, b.addLog)
			}

		case <-rewardTicker.C:
			if room.Closed {
				return fmt.Errorf("sala desconectou")
			}
			if b.config.Settings.AutoRewards {
				_ = room.Send("reward", map[string]any{"action": "collectall"})
				_ = room.Send("sellreward", map[string]any{})
			}
			if b.config.Settings.AutoSell {
				_ = room.Send("sellall", map[string]any{"protected": false})
			}

		case <-arenaTicker.C:
			if b.config.Settings.AutoArena && !room.Closed {
				_ = room.Send("arenaQueue", map[string]any{})
				b.addLog("⚔️ Fila de Arena diária disparada")
			}

		case <-equipTicker.C:
			minTier := b.config.Settings.EquipMinTier
			if minTier <= 0 {
				minTier = 3
			}
			for idx, c := range b.allChars {
				if idx <= 3 {
					RunAutoEquip(ctx, b.trpc, room, c, idx, minTier, b.addLog)
				}
			}
			SyncPartyAutoConfig(ctx, b.trpc, room, b.allChars, b.addLog)

		case <-pollTicker.C:
			// Sincronizar dados via tRPC
			if chars, err := b.trpc.GetCharacters(ctx); err == nil && len(chars) > 0 {
				b.allChars = chars
				for _, c := range chars {
					if fmt.Sprint(c.ID) == fmt.Sprint(b.primaryChar.ID) {
						b.primaryChar = c
						break
					}
				}

				// Auto-compra de slot de party se atingir 100kk gold!
				if b.config.Settings.AutoBuyPartySlot && b.primaryChar.Gold >= 100_000_000 {
					b.addLog("💰 Conta atingiu 100kk+ gold! Tentando comprar 3º slot de party via Colyseus...")
					_ = room.Send("buypartyslot", map[string]any{})
				}

				// Determinar hunt alvo prioritária respeitando a configuração do usuário
				targetHunt := b.config.Settings.HuntTarget
				if targetHunt == "" {
					// Se o usuário não travou uma hunt fixa, calcula dinamicamente pela estratégia configurada
					targetHunt = PickBestHunt(b.primaryChar.Level, b.currentStrategy)
				}

				// Restauração automática de hunt: se o anti-wipe rebaixou a hunt temporariamente,
				// restaura para o alvo quando a janela de mortes estiver limpa e sem wipes recentes.
				if b.currentHuntID != targetHunt && len(b.deathTimestamps) == 0 && time.Since(b.lastDowngradeAt) > 10*time.Minute {
					b.addLog(fmt.Sprintf("🔄 Situação normalizada (sem wipes recentes). Restaurando hunt alvo de %s: %s", strings.ToUpper(b.currentStrategy), targetHunt))
					b.currentHuntID = targetHunt
					b.sendStage("restauração de hunt alvo pós-wipe")
				}

				// Transição automática para XP MÁXIMO somente se o usuário NÃO escolheu foco em GOLD e NÃO fixou huntTarget
				if b.config.Settings.Priority != "gold" && b.config.Settings.HuntTarget == "" && len(b.allChars) >= 3 && b.currentStrategy == "gold" {
					b.currentStrategy = "xp"
					b.addLog("🚀 3 slots de party liberados! Transição automática de estratégia: foco alterado para XP MÁXIMO!")
					newHunt := PickBestHunt(b.primaryChar.Level, "xp")
					if newHunt != b.currentHuntID {
						b.currentHuntID = newHunt
						b.sendStage("transição para XP máximo")
					}
				}

				b.updateStatus(func(s *engine.AccountStatus) {
					s.Level = b.primaryChar.Level
					s.Gold = b.primaryChar.Gold
					s.Extra["stamina"] = FormatStamina(b.primaryChar.Stamina)
					s.Extra["strategy"] = b.currentStrategy
					s.Extra["charName"] = b.primaryChar.Name
				})

				b.checkAutoTreino(room)
			}

		case <-ratesTicker.C:
			now := time.Now()
			elapsedHour := now.Sub(lastSampleAt).Hours()
			if elapsedHour > 0 {
				sim := SimulateHunt(b.currentHuntID, b.primaryChar.Level)
				killsH := 600.0
				expKill := 1500.0
				goldKill := 250.0
				if sim != nil {
					if sim.KillsPerHour > 0 {
						killsH = sim.KillsPerHour
					}
					expKill = sim.ExpPerHour / math.Max(killsH, 1.0)
					goldKill = sim.GoldPerHour / math.Max(killsH, 1.0)
				}
				killsGained := int(math.Max(1, math.Round(killsH*elapsedHour)))
				dGold := float64(b.primaryChar.Gold - lastGold)

				b.updateStatus(func(s *engine.AccountStatus) {
					if !b.inTreino {
						s.Kills += killsGained
						if dGold > 0 {
							s.GoldPerHour = dGold / elapsedHour
						} else {
							s.GoldPerHour = float64(killsGained) * goldKill / elapsedHour
						}
						s.ExpPerHour = (float64(killsGained) * expKill) / elapsedHour
					} else {
						s.GoldPerHour = 0
						s.ExpPerHour = 0
					}
					s.DurationSec += int(now.Sub(lastSampleAt).Seconds())
				})
			}
			lastSampleAt = now
			lastGold = b.primaryChar.Gold

			// Watchdog: sem frames por mais de 120 segundos -> forçar reconexão
			if time.Since(room.LastFrameAt) > 120*time.Second {
				return fmt.Errorf("watchdog: 120s sem frames do servidor")
			}
		}
	}
}

func (b *Bot) sendStage(reason string) {
	if b.room == nil || b.room.Closed {
		return
	}
	facts, _ := GetHuntFacts(b.currentHuntID)
	name := facts.Name
	if name == "" {
		name = b.currentHuntID
	}

	_ = b.room.Send("ready", map[string]any{})
	_ = b.room.Send("mode", map[string]any{"mode": "hunt"})

	b.mu.RLock()
	tier := b.currentTier
	b.mu.RUnlock()

	stagePayload := map[string]any{
		"huntId": b.currentHuntID,
	}
	tierLabel := ""
	if tier == "hl" {
		stagePayload["tier"] = "hl"
		tierLabel = " [Hell]"
	} else if tier == "nm" {
		stagePayload["tier"] = "nm"
		tierLabel = " [Nightmare]"
	}

	_ = b.room.Send("stage", stagePayload)
	b.staged = true
	b.inTreino = false

	b.updateStatus(func(s *engine.AccountStatus) {
		s.CurrentArea = name + tierLabel
		s.Status = "hunting"
	})
	b.addLog(fmt.Sprintf("Stage enviado (%s): %s%s (%s)", reason, name, tierLabel, b.currentHuntID))
}

func (b *Bot) GetStatus() engine.AccountStatus {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.status
}

func (b *Bot) ExecuteAction(action string, payload map[string]any) (any, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	switch action {
	case "set_hunt":
		huntID, _ := payload["huntId"].(string)
		if huntID == "" {
			return nil, fmt.Errorf("parâmetro 'huntId' obrigatório")
		}
		if strings.HasSuffix(huntID, ":h") {
			b.currentHuntID = strings.TrimSuffix(huntID, ":h")
			b.currentTier = "hl"
		} else if strings.HasSuffix(huntID, ":n") {
			b.currentHuntID = strings.TrimSuffix(huntID, ":n")
			b.currentTier = "nm"
		} else {
			b.currentHuntID = huntID
		}
		b.sendStage("comando manual web")
		return map[string]any{"ok": true, "huntId": b.currentHuntID, "tier": b.currentTier}, nil

	case "set_tier":
		tier, _ := payload["tier"].(string)
		if tier != "" && tier != "nm" && tier != "hl" {
			return nil, fmt.Errorf("tier inválido (permitidos: '', 'nm', 'hl')")
		}
		b.currentTier = tier
		b.sendStage("alteração manual de tier")
		return map[string]any{"ok": true, "tier": b.currentTier}, nil

	case "claim_pass":
		if b.room != nil && !b.room.Closed {
			b.passMgr.CheckAndClaim(context.Background(), b.room, b.addLog)
			return "Passe de Temporada e missões diárias verificados e reivindicados!", nil
		}
		return nil, fmt.Errorf("sala não conectada")

	case "spend_rift":
		if b.room != nil && !b.room.Closed {
			b.riftMgr.SpendRiftTree(context.Background(), b.room, b.allChars, b.addLog)
			return "Pontos de Rift Tree distribuídos com sucesso!", nil
		}
		return nil, fmt.Errorf("sala não conectada")

	case "sync_perks":
		if b.room != nil && !b.room.Closed {
			b.profMgr.CheckAndSpendPerks(context.Background(), b.room, b.allChars, b.addLog)
			return "Perks de proficiência de armas sincronizados e alocados!", nil
		}
		return nil, fmt.Errorf("sala não conectada")

	case "auto_sell":
		if b.room != nil && !b.room.Closed {
			_ = b.room.Send("sellall", map[string]any{"protected": false})
			return "Loot e materiais vendidos com sucesso!", nil
		}
		return nil, fmt.Errorf("sala não conectada")

	case "toggle_treino":
		if b.room == nil || b.room.Closed {
			return nil, fmt.Errorf("sala não conectada")
		}
		b.inTreino = !b.inTreino
		if b.inTreino {
			_ = b.room.Send("mode", map[string]any{"mode": "exercise"})
			_ = b.room.Send("tocity", map[string]any{})
			b.status.Status = "training"
			return "Treino Online ativado!", nil
		} else {
			b.sendStage("retorno manual do treino")
			return "Retornando à caçada!", nil
		}

	case "buy_party_slot":
		if b.room != nil && !b.room.Closed {
			_ = b.room.Send("buypartyslot", map[string]any{})
			b.addLog("Disparado comando buypartyslot via dashboard")
			return "Comando de compra do slot de party enviado!", nil
		}
		return nil, fmt.Errorf("sala não conectada")

	case "trigger_auction":
		go RunAuctionCycle(context.Background(), b)
		return "Ciclo de leilão JEV e coleta de inbox disparados com sucesso!", nil

	case "trigger_sniper":
		go func() {
			bal, _ := RefreshCoinAndAuthStatus(context.Background(), b)
			RunAuctionSniper(context.Background(), b, bal)
		}()
		return "Sniper de leilão disparado para varrer oportunidades!", nil

	case "reauth_2fa":
		code, _ := payload["code"].(string)
		if code == "" {
			return nil, fmt.Errorf("parâmetro 'code' de 6 dígitos obrigatório")
		}
		b.SupplyTwofaCode(code)
		go RunAuctionCycle(context.Background(), b)
		return fmt.Sprintf("Código 2FA '%s' injetado com sucesso! Tentando criar anúncios imediatamente.", code), nil

	case "solve_captcha":
		b.TriggerCaptchaSolver()
		return "Solver de Captcha Turnstile acionado via runner!", nil

	default:
		return nil, fmt.Errorf("ação desconhecida: %s", action)
	}
}

func (b *Bot) SupplyTurnstileToken(token string) error {
	b.mu.Lock()
	b.turnstileToken = token
	b.turnstileTokenAt = time.Now()
	b.addLog(fmt.Sprintf("✔ Token Turnstile registrado (%d chars) — válido por ~110s", len(token)))
	select {
	case b.turnstileChan <- token:
	default:
	}
	b.mu.Unlock()

	go RunAuctionCycle(context.Background(), b)
	return nil
}

func (b *Bot) GetTurnstileToken() string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.turnstileToken != "" && time.Since(b.turnstileTokenAt) < 110*time.Second {
		return b.turnstileToken
	}
	return ""
}

func (b *Bot) SupplyTwofaCode(code string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.twofaCode = strings.TrimSpace(code)
	b.twofaCodeAt = time.Now()
	b.addLog(fmt.Sprintf("✔ Código 2FA registrado (%s) — tentando liberar janela de 30min", b.twofaCode))
}

func (b *Bot) GetTwofaCode() string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.twofaCode != "" && time.Since(b.twofaCodeAt) < 3*time.Minute {
		return b.twofaCode
	}
	return os.Getenv("AUCTION_2FA_CODE")
}

func (b *Bot) UpdateCoinStatus(coins, marketCoins int, leftMs float64) {
	b.updateStatus(func(s *engine.AccountStatus) {
		if s.Extra == nil {
			s.Extra = make(map[string]any)
		}
		s.Extra["coins"] = coins
		s.Extra["marketCoins"] = marketCoins
		s.Extra["twofaLeftMs"] = leftMs
	})
}

func (b *Bot) GetPassword() string {
	if b.config.Credentials.Password != "" {
		return b.config.Credentials.Password
	}
	return os.Getenv("AUCTION_SELL_PASSWORD")
}

func (b *Bot) TriggerCaptchaSolver() {
	b.addLog("🤖 Acionando solver de Captcha Turnstile via GitHub Actions...")
	repo := os.Getenv("GITHUB_REPOSITORY")
	if repo == "" {
		repo = "kbelludoo/baiak-idle-bot"
	}
	go func() {
		err := auth.DispararSolverActions(repo, "ticket-relay.yml", "/home/ubuntu/cloudflared.log", b.ID(), 45*time.Second)
		if err != nil {
			b.addLog(fmt.Sprintf("[Solver] Aviso: %v (você também pode colar o token via /api/ticket)", err))
		}
	}()
}

func (b *Bot) checkAutoTreino(room *Room) {
	if !b.config.Settings.AutoTreino || room == nil || room.Closed {
		return
	}
	stam := b.primaryChar.Stamina
	// Stamina máxima é 2520 min (42h). 50% = 1260 min.
	if !b.inTreino && stam <= 1260 {
		b.inTreino = true
		b.treinoEnteredAt = time.Now()
		_ = room.Send("mode", map[string]any{"mode": "exercise"})
		_ = room.Send("tocity", map[string]any{})
		b.updateStatus(func(s *engine.AccountStatus) {
			s.Status = "training"
		})
		b.addLog(fmt.Sprintf("🧘 Stamina <= 50%% (%dmin / %s) -> alternando para Treino Online", stam, FormatStamina(stam)))
	} else if b.inTreino && stam >= 2510 {
		b.inTreino = false
		b.sendStage("stamina 100% recuperada")
		b.updateStatus(func(s *engine.AccountStatus) {
			s.Status = "hunting"
		})
		b.addLog("⚔️ Stamina 100% recuperada -> retornando para a hunt")
	}
}


