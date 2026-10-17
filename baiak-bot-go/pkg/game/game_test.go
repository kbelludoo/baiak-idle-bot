package game

import (
	"testing"
)

func TestProtocolEncodingDecoding(t *testing.T) {
	msgType := "stage"
	payload := map[string]any{"huntId": "vexclaw-lair"}

	encoded, err := EncodeRoomData(msgType, payload)
	if err != nil {
		t.Fatalf("EncodeRoomData falhou: %v", err)
	}

	frame, err := DecodeFrame(encoded)
	if err != nil {
		t.Fatalf("DecodeFrame falhou: %v", err)
	}

	if frame.Opcode != OpRoomData {
		t.Errorf("Opcode esperado %d, obtido %d", OpRoomData, frame.Opcode)
	}

	if frame.Type != msgType {
		t.Errorf("Type esperado %s, obtido %s", msgType, frame.Type)
	}

	pMap, ok := frame.Payload.(map[string]any)
	if !ok {
		t.Fatalf("Payload esperado map[string]any, obtido %T", frame.Payload)
	}

	if pMap["huntId"] != "vexclaw-lair" {
		t.Errorf("huntId esperado vexclaw-lair, obtido %v", pMap["huntId"])
	}
}

func TestSimulateHuntAndRanking(t *testing.T) {
	// Testar simulação de refiner-cave (Stone Refiner)
	sim := SimulateHunt("refiner-cave", 100)
	if sim == nil {
		t.Fatalf("SimulateHunt retornou nil")
	}

	if sim.GoldPerHour <= 0 {
		t.Errorf("GoldPerHour esperado > 0, obtido %f", sim.GoldPerHour)
	}

	if sim.ExpPerHour <= 0 {
		t.Errorf("ExpPerHour esperado > 0, obtido %f", sim.ExpPerHour)
	}

	// Testar ranking para level 300
	rankedGold := RankHunts(300, "gold")
	if len(rankedGold) == 0 {
		t.Fatalf("RankHunts retornou lista vazia")
	}

	// A primeira hunt de gold para nível 300 deve ser vexclaw-lair ou similar de alto gold
	bestGold := PickBestHunt(300, "gold")
	if bestGold == "" {
		t.Errorf("PickBestHunt retornou string vazia")
	}

	bestXP := PickBestHunt(300, "xp")
	if bestXP == "" {
		t.Errorf("PickBestHunt retornou string vazia")
	}
}

func TestPassManager(t *testing.T) {
	pm := NewPassManager()
	var logs []string
	logFn := func(s string) {
		logs = append(logs, s)
	}

	pm.HandleBPStatus(map[string]any{
		"open":           true,
		"premium":        true,
		"pendingTiers":   []any{1.0, 2.0, 3.0},
		"pendingPremium": []any{2.0, 3.0, 4.0},
	}, logFn)

	if len(pm.pendingTiers) != 4 {
		t.Errorf("Esperado 4 degraus únicos pendentes, obtido %d", len(pm.pendingTiers))
	}
	if len(logs) == 0 {
		t.Errorf("Esperado log informando degraus pendentes")
	}
}

func TestRiftManagerProgression(t *testing.T) {
	rm := NewRiftManager()
	var logs []string
	logFn := func(s string) {
		logs = append(logs, s)
	}

	// Menos de 7500 pontos -> normal
	unlocked := rm.HandleProgression(map[string]any{"points": 5000.0}, logFn)
	if unlocked || rm.IsNightmare() || rm.GetTier() != "" {
		t.Errorf("Nightmare não deveria estar desbloqueado com 5000 pontos")
	}

	// 7500 pontos -> desbloqueia Nightmare
	unlocked = rm.HandleProgression(map[string]any{"points": 7500.0}, logFn)
	if !unlocked || !rm.IsNightmare() || rm.GetTier() != "nm" {
		t.Errorf("Nightmare deveria ter desbloqueado com 7500 pontos, tier: %s", rm.GetTier())
	}

	// 7500 nightmare points -> desbloqueia Hell
	unlocked = rm.HandleProgression(map[string]any{"nightmarePoints": 7500.0}, logFn)
	if !unlocked || !rm.IsHell() || rm.GetTier() != "hl" {
		t.Errorf("Hell deveria ter desbloqueado com 7500 nightmarePoints, tier: %s", rm.GetTier())
	}
}

func TestProficiencyManager(t *testing.T) {
	pm := NewProficiencyManager()
	if pm == nil {
		t.Fatalf("ProficiencyManager é nil")
	}
}

