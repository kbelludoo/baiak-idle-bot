package game

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// TalentNodeOrder nós recomendados em ordem prioritária por vocação
var PriorityTalentNodes = map[string][]string{
	"knight": {
		"k_fury", "k_iron_skin", "k_vitality", "k_blade_mastery", "k_shield_mastery",
		"k_berserk", "k_endurance", "k_bloodlust", "k_juggernaut",
	},
	"paladin": {
		"p_accuracy", "p_divine_power", "p_swiftness", "p_holy_aura", "p_sharpshooter",
		"p_divine_fury", "p_vitality", "p_blessed_steel",
	},
	"monk": {
		"m_fist_mastery", "m_inner_peace", "m_iron_body", "m_zenith", "m_flurry",
		"m_vitality", "m_spirit_surge",
	},
	"sorcerer": {
		"s_magic_surge", "s_arcane_wisdom", "s_elemental_mastery", "s_inferno", "s_spark",
		"s_vitality", "s_mana_shield",
	},
	"druid": {
		"d_earth_mastery", "d_frost_mastery", "d_nature_call", "d_wild_growth", "d_blizzard",
		"d_vitality", "d_mana_shield",
	},
}

// SpendTalentsForParty gasta pontos da árvore de talentos para os personagens da party
func SpendTalentsForParty(ctx context.Context, room *Room, chars []CharacterInfo, logFn func(string)) {
	if room == nil || room.Closed {
		return
	}

	for slotIdx, c := range chars {
		if slotIdx > 3 {
			break
		}
		voc := strings.ToLower(c.Vocation)
		nodes := PriorityTalentNodes[voc]
		if len(nodes) == 0 {
			nodes = PriorityTalentNodes["knight"]
		}

		// Enviar nós em ordem até o teto de nível do personagem
		pointsToSpend := c.Level
		if pointsToSpend > 50 {
			pointsToSpend = 50 // Em lote de 50 envios por ciclo
		}

		spent := 0
		for _, nodeID := range nodes {
			for rank := 0; rank < 5; rank++ {
				if spent >= pointsToSpend {
					break
				}
				_ = room.Send("tree", map[string]any{
					"slot":   slotIdx,
					"action": "spend",
					"nodeId": nodeID,
				})
				spent++
				time.Sleep(20 * time.Millisecond)
			}
			if spent >= pointsToSpend {
				break
			}
		}

		logFn(fmt.Sprintf("[tree] Slot %d (%s Lv %d %s): Aplicados pontos de talentos nos nós prioritários (%d envios)",
			slotIdx, c.Name, c.Level, c.Vocation, spent))
	}
}
