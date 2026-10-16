package game

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type InventoryItem struct {
	Name     string  `json:"name"`
	Tier     float64 `json:"tier"`
	FTier    float64 `json:"ftier"`
	UpLevel  float64 `json:"upLevel"`
	UID      any     `json:"uid"`
	Hash     string  `json:"hash"`
	Location string  `json:"location"`
	CharID   any     `json:"charId"`
}

type CatalogItem struct {
	Slot  string   `json:"slot"`
	Atk   float64  `json:"atk"`
	Def   float64  `json:"def"`
	Arm   float64  `json:"arm"`
	Level float64  `json:"level"`
	Vocs  []string `json:"vocs"`
}

func calcItemScore(it InventoryItem, cat CatalogItem) float64 {
	base := cat.Atk
	if cat.Def > base {
		base = cat.Def
	}
	if cat.Arm > base {
		base = cat.Arm
	}
	return base*(1.0+it.Tier*0.5+it.UpLevel*0.1) + it.FTier*5.0
}

// RunAutoEquip inspeciona a mochila via tRPC e equipa itens estritamente melhores
func RunAutoEquip(ctx context.Context, trpc *TRPCClient, room *Room, char CharacterInfo, charSlot int, minTier int, logFn func(string)) int {
	if room == nil || room.Closed {
		return 0
	}

	summaryRaw, err := trpc.Query(ctx, "items.summary", nil)
	if err != nil {
		return 0
	}

	rawBytes, _ := json.Marshal(summaryRaw)
	var summary struct {
		Items   []InventoryItem        `json:"items"`
		Catalog map[string]CatalogItem `json:"catalog"`
	}
	if err := json.Unmarshal(rawBytes, &summary); err != nil {
		return 0
	}

	equippedMap := make(map[string]float64)
	for _, it := range summary.Items {
		if it.Location == "equipped" {
			cat := summary.Catalog[it.Name]
			if cat.Slot != "" {
				equippedMap[cat.Slot] = calcItemScore(it, cat)
			}
		}
	}

	// Avaliar itens na mochila
	equippedCount := 0
	for _, it := range summary.Items {
		if it.Location == "equipped" || it.Hash == "" {
			continue
		}
		if int(it.Tier) < minTier {
			continue
		}
		cat, exists := summary.Catalog[it.Name]
		if !exists || cat.Slot == "" {
			continue
		}
		if cat.Level > float64(char.Level) {
			continue
		}
		// Checar vocação
		if len(cat.Vocs) > 0 {
			match := false
			for _, v := range cat.Vocs {
				if strings.EqualFold(v, char.Vocation) {
					match = true
					break
				}
			}
			if !match {
				continue
			}
		}

		score := calcItemScore(it, cat)
		curScore := equippedMap[cat.Slot]
		if score > curScore {
			// Item estritamente melhor!
			_ = room.Send("equip", map[string]any{
				"uid":  it.UID,
				"to":   cat.Slot,
				"slot": charSlot,
				"hash": it.Hash,
			})
			equippedMap[cat.Slot] = score
			equippedCount++
			logFn(fmt.Sprintf("[auto-equip] Slot %d (%s): Equipado %s (Tier %d) no slot '%s' (Score %.0f > %.0f)",
				charSlot, char.Name, it.Name, int(it.Tier), cat.Slot, score, curScore))
			if equippedCount >= 4 {
				break
			}
		}
	}

	return equippedCount
}
