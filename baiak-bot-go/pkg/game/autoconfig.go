package game

import (
	"context"
	"fmt"
	"strings"
)

// Spells e rotações de Max DPS por vocação e nível
func GetRecommendedRotation(voc string, level int) []string {
	v := strings.ToLower(voc)
	switch v {
	case "knight":
		if level >= 90 {
			return []string{"exori gran", "exori", "exori min", "exori mas"}
		}
		if level >= 70 {
			return []string{"exori", "exori min", "exori mas", "exori scu"}
		}
		if level >= 35 {
			return []string{"exori", "exori mas", "exori scu", "exori ico"}
		}
		return []string{"exori ico", "exori ico scu", "exori hur", "exori"}

	case "monk":
		if level >= 90 {
			return []string{"exori gran mas pug", "exori mas pug", "exori mas nia", "exori med pug"}
		}
		if level >= 60 {
			return []string{"exori mas pug", "exori mas nia", "exori amp pug", "exori pug"}
		}
		return []string{"exori pug", "exori nia", "exori amp pug", "exori mas pug"}

	case "paladin":
		if level >= 70 {
			return []string{"exevo mas san", "exori dir san", "exori dir moe", "exori gran con"}
		}
		if level >= 50 {
			return []string{"exevo mas san", "exori san", "exori con", "utori san"}
		}
		return []string{"exori con", "exori san", "utori san", "exori"}

	case "sorcerer":
		if level >= 90 {
			return []string{"exevo gran mas flam", "exori max flam", "exori gran flam", "exevo vis hur"}
		}
		return []string{"exevo flam hur", "exori flam", "exori vis", "exori mort"}

	case "druid":
		if level >= 90 {
			return []string{"exevo gran mas frigo", "exori max frigo", "exori gran frigo", "exevo frigo hur"}
		}
		return []string{"exevo frigo hur", "exori frigo", "exori tera", "exori infir tera"}

	default:
		return []string{}
	}
}

// GetRecommendedHeal retorna a melhor magia de cura para a vocação
func GetRecommendedHeal(voc string, level int) string {
	v := strings.ToLower(voc)
	switch v {
	case "knight":
		return "exura ico"
	case "paladin":
		if level >= 35 {
			return "exura san"
		}
		return "exura"
	case "monk":
		if level >= 40 {
			return "exura med pug"
		}
		return "exura pug"
	default:
		if level >= 50 {
			return "exura gran"
		}
		return "exura"
	}
}

// GetRecommendedPotions retorna as poções Best-in-Slot
func GetRecommendedPotions(voc string, level int) (hpPot string, manaPot string) {
	v := strings.ToLower(voc)
	hpPot = "ultimate health potion"
	manaPot = "ultimate mana potion"

	if level >= 130 {
		hpPot = "supreme health potion"
		manaPot = "distilled ultimate mana potion"
	} else if level >= 80 {
		hpPot = "ultimate health potion"
		manaPot = "great mana potion"
	}

	if v == "paladin" || v == "monk" {
		if level >= 130 {
			hpPot = "ultimate spirit potion"
		} else if level >= 80 {
			hpPot = "great spirit potion"
		}
	}

	return hpPot, manaPot
}

// SyncPartyAutoConfig envia pacotes de supplies, magias e poções BiS para toda a party
func SyncPartyAutoConfig(ctx context.Context, trpc *TRPCClient, room *Room, chars []CharacterInfo, logFn func(string)) {
	if room == nil || room.Closed {
		return
	}

	// 1. Determinar estritamente as poções necessárias para os personagens ativos (evita comprar dezenas de milhares de poções à toa)
	neededPotions := make(map[string]bool)
	for slotIdx, c := range chars {
		if slotIdx > 3 {
			break
		}
		hpPot, manaPot := GetRecommendedPotions(c.Vocation, c.Level)
		if hpPot != "" {
			neededPotions[hpPot] = true
		}
		if manaPot != "" {
			neededPotions[manaPot] = true
		}
	}

	var refillNames []string
	buySupplyCfg := make(map[string]any)
	for pot := range neededPotions {
		refillNames = append(refillNames, pot)
		buySupplyCfg[pot] = map[string]any{
			"min": 30,
			"qty": 100,
		}
	}

	// Se nenhuma poção foi mapeada por segurança, usar standard de emergência
	if len(refillNames) == 0 {
		refillNames = []string{"ultimate health potion", "ultimate mana potion"}
		buySupplyCfg["ultimate health potion"] = map[string]any{"min": 20, "qty": 50}
		buySupplyCfg["ultimate mana potion"] = map[string]any{"min": 20, "qty": 50}
	}

	_ = room.Send("autorefill", map[string]any{
		"names": refillNames,
	})

	_ = room.Send("autobuysupply", map[string]any{
		"cfg": buySupplyCfg,
	})

	// 2. Configurar rotação, cura e poções para cada slot ativo
	for slotIdx, c := range chars {
		if slotIdx > 3 {
			break
		}
		healSpell := GetRecommendedHeal(c.Vocation, c.Level)
		rotation := GetRecommendedRotation(c.Vocation, c.Level)
		hpPot, manaPot := GetRecommendedPotions(c.Vocation, c.Level)

		manaBelow := 70
		if strings.ToLower(c.Vocation) == "knight" {
			manaBelow = 42
		} else if strings.ToLower(c.Vocation) == "monk" {
			manaBelow = 65
		}

		_ = room.Send("helper", map[string]any{
			"slot": slotIdx,
			"cfg": map[string]any{
				"healEnabled": true,
				"healSpell":   healSpell,
				"healBelow":   70,
			},
		})

		_ = room.Send("rotation", map[string]any{
			"slot":   slotIdx,
			"spells": rotation,
		})

		for _, spell := range rotation {
			if strings.Contains(spell, "mas") || strings.Contains(spell, "gran") {
				_ = room.Send("spellminmobs", map[string]any{
					"slot":    slotIdx,
					"words":   spell,
					"minMobs": 2,
				})
			}
		}

		_ = room.Send("potion", map[string]any{
			"slot":  slotIdx,
			"kind":  "hp",
			"name":  hpPot,
			"below": 70,
		})

		_ = room.Send("potion", map[string]any{
			"slot":  slotIdx,
			"kind":  "mana",
			"name":  manaPot,
			"below": manaBelow,
		})

		logFn(fmt.Sprintf("[autoconfig] Slot %d (%s Lv %d %s): heal=%s@70%% rot=[%s] hp=%s@70%% mana=%s@%d%%",
			slotIdx, c.Name, c.Level, c.Vocation, healSpell, strings.Join(rotation, ", "), hpPot, manaPot, manaBelow))
	}
}
