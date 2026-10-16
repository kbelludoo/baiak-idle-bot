package game

import (
	_ "embed"
	"encoding/json"
	"sync"
)

//go:embed engine_hunts.json
var embeddedEngineHuntsJSON []byte

type HuntInfo struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	MinLevel int      `json:"minLevel"`
	Monsters []string `json:"monsters"`
	MaxAlive int      `json:"maxAlive"`
	SpawnMs  float64  `json:"spawnMs"`
	AvgHp    float64  `json:"avgHp"`
	AvgExp   float64  `json:"avgExp"`
	GoldKill float64  `json:"goldKill"`
	AvgDmg   float64  `json:"avgDmg"`
}

type EngineData struct {
	Hunts    []HuntInfo         `json:"hunts"`
	Priors   map[string]float64 `json:"priors"`
	byID     map[string]HuntInfo
	loadOnce sync.Once
}

var globalEngine EngineData

func getEngine() *EngineData {
	globalEngine.loadOnce.Do(func() {
		_ = json.Unmarshal(embeddedEngineHuntsJSON, &globalEngine)
		globalEngine.byID = make(map[string]HuntInfo)
		for _, h := range globalEngine.Hunts {
			globalEngine.byID[h.ID] = h
		}
	})
	return &globalEngine
}

// GetHuntFacts devolve as informações de catálogo da hunt
func GetHuntFacts(id string) (HuntInfo, bool) {
	eng := getEngine()
	h, ok := eng.byID[id]
	return h, ok
}

// GetAllHunts lista todas as hunts do motor
func GetAllHunts() []HuntInfo {
	return getEngine().Hunts
}

// PreferredHuntTable mapeia níveis mínimos para a melhor hunt estática de transição
var PreferredHuntTable = map[int]string{
	1: "troll-cave", 8: "elf-lair", 9: "amazon-camp", 10: "minotaur", 15: "cyclopolis",
	30: "refiner-cave", 50: "giant-spider", 60: "glooth-cave", 80: "dragon-lair",
	90: "werebadge-cave", 100: "hydra-cave", 130: "wyrm-cave", 140: "werehyaena-cave",
	150: "asura-lair", 170: "wereliones-cave", 180: "draken-lair", 190: "cobra-cave",
	200: "undeadragon-lair", 210: "falcon", 220: "grimeleech-cave", 240: "choking-cave",
	250: "guzzlemaw-cave", 270: "lionknight-cave", 290: "megadragon-cave", 300: "naga-lair",
	350: "gazer-lair", 450: "inferniarch-lair", 500: "livraria-cave", 610: "lavafungos-cave",
}
