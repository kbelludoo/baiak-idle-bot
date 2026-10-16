package game

import (
	"math"
	"sort"
)

type HuntSimulation struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	TTK          float64 `json:"ttk"`
	KillsPerHour float64 `json:"killsPerHour"`
	GoldPerHour  float64 `json:"goldPerHour"`
	ExpPerHour   float64 `json:"expPerHour"`
	CanTank      bool    `json:"canTank"`
	BalanceScore float64 `json:"balanceScore"`
	MinLevel     int     `json:"minLevel"`
}

// EstimateDPS calcula o DPS estimado calibrado pelo motor
func EstimateDPS(level int, party bool) float64 {
	lvl := float64(level)
	if lvl < 1 {
		lvl = 1
	}
	n := 1.0
	if party {
		n = 1.25
	}
	// Com magias de rotação e área comuns (power=3, aoe=3): 0.24 + 0.36 + 0.24 = 0.84 * 1.25 = 1.05 * level
	return math.Max(0.5, lvl*(0.24+0.12*3.0+0.08*3.0)*n)
}

// SimulateHunt simula uma hunt específica contra o nível do personagem
func SimulateHunt(huntID string, level int) *HuntSimulation {
	facts, ok := GetHuntFacts(huntID)
	if !ok || facts.AvgHp <= 0 {
		return nil
	}

	dps := EstimateDPS(level, true)
	ttk := facts.AvgHp / math.Max(dps, 1.0)
	spawnS := facts.SpawnMs / 1000.0
	if spawnS < 0.2 {
		spawnS = 0.2
	}
	alive := float64(facts.MaxAlive)
	if alive < 1 {
		alive = 1
	}

	killsH := (alive / math.Max(ttk+spawnS, spawnS)) * 3600.0

	prior := 1.0
	if p, hasPrior := getEngine().Priors[huntID]; hasPrior {
		prior = p
	}
	if huntID == "refiner-cave" {
		prior = math.Max(prior, 2.2)
	}

	goldKill := facts.GoldKill * prior
	goldH := killsH * goldKill
	expH := killsH * facts.AvgExp

	incoming := facts.AvgDmg * alive / math.Max(ttk, 0.25)
	sustain := float64(level) * 18.0
	canTank := incoming < sustain*5.0 || facts.AvgHp <= float64(level)*40.0

	return &HuntSimulation{
		ID:           huntID,
		Name:         facts.Name,
		TTK:          math.Round(ttk*100) / 100,
		KillsPerHour: math.Round(killsH),
		GoldPerHour:  math.Round(goldH),
		ExpPerHour:   math.Round(expH),
		CanTank:      canTank,
		MinLevel:     facts.MinLevel,
	}
}

// RankHunts simula e ordena todas as hunts disponíveis para o nível de acordo com a prioridade
func RankHunts(level int, priority string) []HuntSimulation {
	all := GetAllHunts()
	var sims []HuntSimulation

	maxExp := 1.0
	maxGold := 1.0

	for _, h := range all {
		if h.MinLevel <= level {
			if s := SimulateHunt(h.ID, level); s != nil {
				if s.ExpPerHour > maxExp {
					maxExp = s.ExpPerHour
				}
				if s.GoldPerHour > maxGold {
					maxGold = s.GoldPerHour
				}
				sims = append(sims, *s)
			}
		}
	}

	for i := range sims {
		expNorm := sims[i].ExpPerHour / maxExp
		goldNorm := sims[i].GoldPerHour / maxGold
		sims[i].BalanceScore = 0.55*expNorm + 0.45*goldNorm
	}

	sort.Slice(sims, func(i, j int) bool {
		// Primeiro critério: tankável
		if sims[i].CanTank != sims[j].CanTank {
			return sims[i].CanTank
		}

		if priority == "gold" {
			return sims[i].GoldPerHour > sims[j].GoldPerHour
		}
		if priority == "xp" {
			return sims[i].ExpPerHour > sims[j].ExpPerHour
		}

		// Balanced
		if sims[i].BalanceScore != sims[j].BalanceScore {
			return sims[i].BalanceScore > sims[j].BalanceScore
		}
		return sims[i].ExpPerHour > sims[j].ExpPerHour
	})

	return sims
}

// PickBestHunt escolhe a melhor hunt para o nível e estratégia
func PickBestHunt(level int, priority string) string {
	ranked := RankHunts(level, priority)
	if len(ranked) == 0 {
		return "troll-cave"
	}
	return ranked[0].ID
}
