package game

import (
	"context"
	"fmt"
)

// SafeBoss representa um boss com requisitos seguros para farm
type SafeBoss struct {
	ID       string
	Name     string
	MinLevel int
}

// Lista de archfoes e bosses diários de dificuldade controlada
var SafeBossCatalog = []SafeBoss{
	{ID: "shadowpelt", Name: "Shadowpelt", MinLevel: 5},
	{ID: "darkfang", Name: "Darkfang", MinLevel: 15},
	{ID: "bloodback", Name: "Bloodback", MinLevel: 15},
	{ID: "black_vixen", Name: "Black Vixen", MinLevel: 20},
	{ID: "sharpclaw", Name: "Sharpclaw", MinLevel: 20},
	{ID: "utua_stone_sting", Name: "Utua Stone Sting", MinLevel: 35},
	{ID: "amenef_the_burning", Name: "Amenef the Burning", MinLevel: 50},
	{ID: "brokul", Name: "Brokul", MinLevel: 50},
	{ID: "scarlett", Name: "Scarlett Etzel", MinLevel: 80},
	{ID: "ahau", Name: "Ahau", MinLevel: 60},
	{ID: "kusuma", Name: "Kusuma", MinLevel: 60},
	{ID: "brain_head", Name: "Brain Head", MinLevel: 70},
	{ID: "neferi_the_spy", Name: "Neferi the Spy", MinLevel: 70},
	{ID: "drume", Name: "Drume", MinLevel: 90},
	{ID: "oberon", Name: "Grand Master Oberon", MinLevel: 100},
}

// RunSafeBosses executa um boss seguro se a party estiver forte e sem wipes recentes
func RunSafeBosses(ctx context.Context, room *Room, playerLevel int, recentDeaths int, logFn func(string)) bool {
	if room == nil || room.Closed || recentDeaths > 0 || playerLevel < 120 {
		return false
	}

	for _, b := range SafeBossCatalog {
		if playerLevel >= b.MinLevel*2 && playerLevel >= b.MinLevel+50 {
			_ = room.Send("boss", map[string]any{
				"bossId":   b.ID,
				"fromCity": false,
			})
			logFn(fmt.Sprintf("⚔️ [Auto-Boss] Iniciando combate com boss seguro: %s (Lv %d)", b.Name, b.MinLevel))
			return true
		}
	}
	return false
}

// RunDailyRewards resgata recompensas diárias, passe de temporada e baús
func RunDailyRewards(room *Room, logFn func(string)) {
	if room == nil || room.Closed {
		return
	}
	_ = room.Send("dailyclaim", map[string]any{})
	_ = room.Send("bpclaim", map[string]any{})
	_ = room.Send("reward", map[string]any{"action": "collectall"})
	_ = room.Send("sellreward", map[string]any{})
	logFn("🎁 [Daily] Resgatadas recompensas diárias, missões e passe de temporada")
}

// RunAutoPrey alinha as presas (prey) ao monstro principal da hunt ativa
func RunAutoPrey(room *Room, currentHuntID string, logFn func(string)) {
	if room == nil || room.Closed {
		return
	}
	facts, ok := GetHuntFacts(currentHuntID)
	if !ok || len(facts.Monsters) == 0 {
		return
	}
	targetMob := facts.Monsters[0]
	if targetMob == "" {
		return
	}

	_ = room.Send("prey", map[string]any{
		"slot":       0,
		"action":     "pick",
		"monsterKey": targetMob,
	})
	_ = room.Send("prey", map[string]any{
		"slot":   0,
		"action": "lock",
	})
	logFn(fmt.Sprintf("🎯 [Prey] Presa vinculada ao monstro '%s' (Hunt: %s)", targetMob, facts.Name))
}

// RunGuildTasks sincroniza tarefas do clã / guilda
func RunGuildTasks(room *Room, logFn func(string)) {
	if room == nil || room.Closed {
		return
	}
	_ = room.Send("guildtaskflush", map[string]any{})
	logFn("🛡️ [Guild] Sincronização de tarefas de guilda efetuada")
}

// RunCharmsAuto vincula runas de bestiário ofensivas aos monstros da hunt ativa
func RunCharmsAuto(room *Room, currentHuntID string) {
	if room == nil || room.Closed {
		return
	}
	facts, ok := GetHuntFacts(currentHuntID)
	if !ok || len(facts.Monsters) == 0 {
		return
	}
	for i, mob := range facts.Monsters {
		if i > 2 {
			break
		}
		_ = room.Send("charmassign", map[string]any{
			"charmId":    i,
			"monsterKey": mob,
		})
	}
}
