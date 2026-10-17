package game

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// =========================================================================
// 1. PASSE DE TEMPORADA & RECOMPENSAS DIÁRIAS
// =========================================================================

type PassManager struct {
	mu           sync.Mutex
	pendingTiers []int
	open         bool
	premium      bool
	lastClaimAt  time.Time
}

func NewPassManager() *PassManager {
	return &PassManager{
		pendingTiers: make([]int, 0),
	}
}

func (pm *PassManager) HandleBPStatus(payload any, logFn func(string)) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	m, ok := payload.(map[string]any)
	if !ok {
		return
	}

	if open, ok := m["open"].(bool); ok {
		pm.open = open
	}
	if prem, ok := m["premium"].(bool); ok {
		pm.premium = prem
	}

	var tiers []int
	collectTiers := func(arr []any) {
		for _, v := range arr {
			if n, ok := v.(float64); ok {
				tiers = append(tiers, int(n))
			} else if n, ok := v.(int); ok {
				tiers = append(tiers, n)
			}
		}
	}

	if pt, ok := m["pendingTiers"].([]any); ok {
		collectTiers(pt)
	}
	if pm.premium {
		if ppt, ok := m["pendingPremium"].([]any); ok {
			collectTiers(ppt)
		}
	}

	// Remove duplicatas
	tierMap := make(map[int]bool)
	uniqueTiers := make([]int, 0)
	for _, t := range tiers {
		if !tierMap[t] {
			tierMap[t] = true
			uniqueTiers = append(uniqueTiers, t)
		}
	}
	pm.pendingTiers = uniqueTiers

	if len(uniqueTiers) > 0 {
		logFn(fmt.Sprintf("🎫 [Passe de Temporada] %d degraus pendentes para resgate: %v", len(uniqueTiers), uniqueTiers))
	}
}

func (pm *PassManager) CheckAndClaim(ctx context.Context, room *Room, logFn func(string)) {
	if room == nil || room.Closed {
		return
	}

	// 1. Recompensa diária de login
	_ = room.Send("dailystatus", map[string]any{})
	_ = room.Send("dailyclaim", map[string]any{})

	// 2. Sincronizar estado do Passe de Temporada
	_ = room.Send("bpstatus", map[string]any{"fresh": true})

	// 3. Entregar missões diárias concluídas
	_ = room.Send("bpdeliver", map[string]any{})

	// 4. Resgatar degraus do passe (tiers: [] resgata todos no protocolo oficial do jogo)
	pm.mu.Lock()
	tiersToClaim := make([]int, len(pm.pendingTiers))
	copy(tiersToClaim, pm.pendingTiers)
	pm.pendingTiers = nil
	pm.mu.Unlock()

	_ = room.Send("bpclaim", map[string]any{
		"tiers": []int{},
	})
	if len(tiersToClaim) > 0 {
		_ = room.Send("bpclaim", map[string]any{
			"tiers": tiersToClaim,
		})
		logFn(fmt.Sprintf("🎁 [Passe de Temporada] Reivindicadas recompensas dos degraus: %v", tiersToClaim))
	}
}

// =========================================================================
// 2. RIFT TREE (ÁRVORE DE ENDGAME)
// =========================================================================

type RiftManager struct {
	mu                sync.RWMutex
	nightmareUnlocked bool
	hellUnlocked      bool
	points            int
	nightmarePoints   int
	ranks             map[string]int
}

func NewRiftManager() *RiftManager {
	return &RiftManager{
		ranks: make(map[string]int),
	}
}

func (rm *RiftManager) HandleProgression(payload any, logFn func(string)) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	m, ok := payload.(map[string]any)
	if !ok {
		return false
	}

	getInt := func(v any) int {
		if f, ok := v.(float64); ok {
			return int(f)
		}
		if i, ok := v.(int); ok {
			return i
		}
		return 0
	}

	newUnlock := false

	// Pontos normais de progressão
	if ptsVal, ok := m["points"]; ok {
		rm.points = getInt(ptsVal)
	}

	// Pontos de Nightmare
	if nmVal, ok := m["nightmarePoints"]; ok {
		rm.nightmarePoints = getInt(nmVal)
	}

	// Flags explícitas de desbloqueio do servidor
	if unl, ok := m["unlocked"].(map[string]any); ok {
		if nmUnl, ok := unl["nm"].(bool); nmUnl && ok && !rm.nightmareUnlocked {
			rm.nightmareUnlocked = true
			newUnlock = true
			logFn("⚡ [Progression] Flag oficial nm detectada: TIER NIGHTMARE DESBLOQUEADO!")
		}
		if hlUnl, ok := unl["hl"].(bool); hlUnl && ok && !rm.hellUnlocked {
			rm.hellUnlocked = true
			newUnlock = true
			logFn("🔥 [Progression] Flag oficial hl detectada: TIER HELL DESBLOQUEADO!")
		}
	}

	// Desbloqueio por pontuação (7.500 pontos exigidos)
	if rm.points >= 7500 && !rm.nightmareUnlocked {
		rm.nightmareUnlocked = true
		newUnlock = true
		logFn(fmt.Sprintf("⚡ [Progression] %d pontos alcançados (>= 7.500)! TIER NIGHTMARE DESBLOQUEADO!", rm.points))
	}

	if (rm.nightmarePoints >= 7500 || rm.points >= 15000) && !rm.hellUnlocked {
		if nmMap, ok := m["nightmare"].(map[string]any); ok {
			if pts := getInt(nmMap["points"]); pts >= 7500 {
				rm.hellUnlocked = true
				newUnlock = true
				logFn(fmt.Sprintf("🔥 [Progression] %d pontos no Nightmare alcançados! TIER HELL DESBLOQUEADO!", pts))
			}
		} else if rm.nightmarePoints >= 7500 {
			rm.hellUnlocked = true
			newUnlock = true
			logFn(fmt.Sprintf("🔥 [Progression] %d pontos no Nightmare alcançados! TIER HELL DESBLOQUEADO!", rm.nightmarePoints))
		}
	}

	return newUnlock
}

func (rm *RiftManager) HandleRiftState(payload any) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	m, ok := payload.(map[string]any)
	if !ok {
		return
	}

	if rMap, ok := m["ranks"].(map[string]any); ok {
		for k, v := range rMap {
			if num, ok := v.(float64); ok {
				rm.ranks[k] = int(num)
			} else if num, ok := v.(int); ok {
				rm.ranks[k] = num
			}
		}
	}
}

func (rm *RiftManager) IsNightmare() bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.nightmareUnlocked
}

func (rm *RiftManager) IsHell() bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.hellUnlocked
}

func (rm *RiftManager) GetTier() string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	if rm.hellUnlocked {
		return "hl"
	}
	if rm.nightmareUnlocked {
		return "nm"
	}
	return ""
}

var PriorityNightmareRiftNodes = []string{
	"rn_dmg1", "rn_ward1", "rn_crit1", "rn_critdmg1", "rn_dmg2", "rn_ward2",
	"rn_vital1", "rn_leech1", "rn_exp1", "rn_loot1", "rn_res1", "rn_mind1",
}

var PriorityHellRiftNodes = []string{
	"rh_dmg1", "rh_ward1", "rh_crit1", "rh_critdmg1", "rh_dmg2", "rh_ward2",
	"rh_vital1", "rh_leech1", "rh_exp1", "rh_loot1", "rh_res1", "rh_forge1",
}

func (rm *RiftManager) SpendRiftTree(ctx context.Context, room *Room, chars []CharacterInfo, logFn func(string)) {
	if room == nil || room.Closed {
		return
	}

	rm.mu.RLock()
	isNightmare := rm.nightmareUnlocked
	isHell := rm.hellUnlocked
	rm.mu.RUnlock()

	if !isNightmare && !isHell {
		return
	}

	nodesToTry := PriorityNightmareRiftNodes
	if isHell {
		nodesToTry = append(PriorityHellRiftNodes, PriorityNightmareRiftNodes...)
	}

	maxSlots := len(chars)
	if maxSlots > 3 {
		maxSlots = 3
	}
	if maxSlots == 0 {
		maxSlots = 1
	}

	for slotIdx := 0; slotIdx < maxSlots; slotIdx++ {
		for _, nodeID := range nodesToTry {
			_ = room.Send("rift", map[string]any{
				"slot":   slotIdx,
				"nodeId": nodeID,
			})
			time.Sleep(25 * time.Millisecond)
		}
	}
}

// =========================================================================
// 3. PROFICIÊNCIA DE ARMAS & PERKS
// =========================================================================

type ProficiencyManager struct {
	mu            sync.Mutex
	lastAllocated map[int]int // slot -> level já alocado
}

func NewProficiencyManager() *ProficiencyManager {
	return &ProficiencyManager{
		lastAllocated: make(map[int]int),
	}
}

func (pm *ProficiencyManager) HandleProfState(payload any, room *Room, logFn func(string)) {
	if room == nil || room.Closed {
		return
	}

	m, ok := payload.(map[string]any)
	if !ok {
		return
	}

	slot := 0
	if s, ok := m["slot"].(float64); ok {
		slot = int(s)
	} else if s, ok := m["slot"].(int); ok {
		slot = s
	}

	item := ""
	if it, ok := m["item"].(string); ok {
		item = it
	}

	level := 0
	if l, ok := m["level"].(float64); ok {
		level = int(l)
	} else if l, ok := m["level"].(int); ok {
		level = l
	}

	if item == "" || level <= 0 {
		return
	}

	pm.mu.Lock()
	lastLvl := pm.lastAllocated[slot]
	pm.mu.Unlock()

	// Contar perks atuais configurados
	currentPerksCount := 0
	if perksArr, ok := m["perks"].([]any); ok {
		currentPerksCount = len(perksArr)
	}

	maxPerkLevel := level
	if maxPerkLevel > 7 {
		maxPerkLevel = 7
	}

	if currentPerksCount < maxPerkLevel || level > lastLvl {
		// Montar perks ofensivos/dano do nível 1 até maxPerkLevel
		newPerks := make([][]int, 0, maxPerkLevel)
		for lvl := 1; lvl <= maxPerkLevel; lvl++ {
			newPerks = append(newPerks, []int{lvl, 0})
		}

		_ = room.Send("prof", map[string]any{
			"slot":  slot,
			"item":  item,
			"perks": newPerks,
		})

		pm.mu.Lock()
		pm.lastAllocated[slot] = level
		pm.mu.Unlock()

		logFn(fmt.Sprintf("🗡️ [Perks de Arma] Slot %d arma '%s' (Nível %d): %d perks alocados com sucesso!", slot, item, level, len(newPerks)))
	}
}

func (pm *ProficiencyManager) CheckAndSpendPerks(ctx context.Context, room *Room, chars []CharacterInfo, logFn func(string)) {
	if room == nil || room.Closed {
		return
	}

	maxSlots := len(chars)
	if maxSlots > 3 {
		maxSlots = 3
	}
	if maxSlots == 0 {
		maxSlots = 1
	}

	for slotIdx := 0; slotIdx < maxSlots; slotIdx++ {
		_ = room.Send("profstate", map[string]any{
			"slot": slotIdx,
		})
		time.Sleep(50 * time.Millisecond)
	}
}
