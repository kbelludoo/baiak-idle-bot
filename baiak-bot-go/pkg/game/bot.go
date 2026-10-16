package game

import (
	"context"
	"fmt"
	"log"
	"math"
	"strings"
	"sync"
	"time"

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

	// Estado dinâmico da conta
	primaryChar    CharacterInfo
	allChars       []CharacterInfo
	partyConfig    *PartyConfig
	currentHuntID  string
	currentStrategy string
	inTreino       bool
	staged         bool
	treinoEnteredAt time.Time

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
		s.Extra["stamina"] = fmt.Sprintf("%dmin", primary.Stamina)
		s.Extra["activeParty"] = len(activePool)
		s.Extra["strategy"] = b.currentStrategy
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

	// 4. Inicializar caçada com comandos Colyseus oficiais
	b.sendStage("entrada na sala")
	_ = room.Send("loop", true)
	_ = room.Send("offlinemode", map[string]any{"mode": "hunt", "huntId": b.currentHuntID})
	_ = room.Send("autosellfull", map[string]any{"on": true})
	_ = room.Send("autosellpct", map[string]any{"pct": 85})
	_ = room.Send("protecttiers", map[string]any{"tiers": []int{3, 4, 5, 6, 7, 8, 9, 10}})
	_ = room.Send("codexauto", map[string]any{"on": true})

	// 5. Tickers periódicos
	rewardTicker := time.NewTicker(30 * time.Second)
	defer rewardTicker.Stop()

	arenaTicker := time.NewTicker(30 * time.Minute)
	defer arenaTicker.Stop()

	staminaTicker := time.NewTicker(10 * time.Second)
	defer staminaTicker.Stop()

	pollTicker := time.NewTicker(60 * time.Second)
	defer pollTicker.Stop()

	ratesTicker := time.NewTicker(15 * time.Second)
	defer ratesTicker.Stop()

	lastGold := b.primaryChar.Gold
	lastKills := b.status.Kills
	lastSampleAt := time.Now()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

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

		case <-staminaTicker.C:
			if b.config.Settings.AutoTreino {
				stam := b.primaryChar.Stamina
				// Stamina máxima é 2520 min (42h). 50% = 1260 min.
				if !b.inTreino && stam > 0 && stam <= 1260 {
					b.inTreino = true
					b.treinoEnteredAt = time.Now()
					_ = room.Send("mode", map[string]any{"mode": "exercise"})
					_ = room.Send("tocity", map[string]any{})
					b.updateStatus(func(s *engine.AccountStatus) {
						s.Status = "training"
					})
					b.addLog(fmt.Sprintf("🧘 Stamina <= 50%% (%dmin) -> alternando para Treino Online", stam))
				} else if b.inTreino && stam >= 2520 {
					b.inTreino = false
					b.sendStage("stamina 100% recuperada")
					b.updateStatus(func(s *engine.AccountStatus) {
						s.Status = "hunting"
					})
					b.addLog("⚔️ Stamina 100% recuperada -> retornando para a hunt")
				}
			}

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

				// Transição automática para XP MÁXIMO se tiver 3 slots
				if len(b.allChars) >= 3 && b.currentStrategy == "gold" {
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
					s.Extra["stamina"] = fmt.Sprintf("%dmin", b.primaryChar.Stamina)
					s.Extra["strategy"] = b.currentStrategy
				})
			}

		case <-ratesTicker.C:
			now := time.Now()
			elapsedHour := now.Sub(lastSampleAt).Hours()
			if elapsedHour > 0 {
				dGold := float64(b.primaryChar.Gold - lastGold)
				dKills := float64(b.status.Kills - lastKills)

				sim := SimulateHunt(b.currentHuntID, b.primaryChar.Level)
				expKill := 1500.0
				if sim != nil {
					expKill = sim.ExpPerHour / math.Max(sim.KillsPerHour, 1.0)
				}

				b.updateStatus(func(s *engine.AccountStatus) {
					if !b.inTreino {
						s.GoldPerHour = math.Max(0, dGold/elapsedHour)
						s.ExpPerHour = math.Max(0, (dKills*expKill)/elapsedHour)
					} else {
						s.GoldPerHour = 0
						s.ExpPerHour = 0
					}
					s.DurationSec += int(now.Sub(lastSampleAt).Seconds())
				})
			}
			lastSampleAt = now
			lastGold = b.primaryChar.Gold
			lastKills = b.status.Kills

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
	_ = b.room.Send("stage", map[string]any{"huntId": b.currentHuntID})
	b.staged = true
	b.inTreino = false

	b.updateStatus(func(s *engine.AccountStatus) {
		s.CurrentArea = name
		s.Status = "hunting"
	})
	b.addLog(fmt.Sprintf("Stage enviado (%s): %s (%s)", reason, name, b.currentHuntID))
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
		b.currentHuntID = huntID
		b.sendStage("comando manual web")
		return map[string]any{"ok": true, "huntId": huntID}, nil

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

	default:
		return nil, fmt.Errorf("ação desconhecida: %s", action)
	}
}
