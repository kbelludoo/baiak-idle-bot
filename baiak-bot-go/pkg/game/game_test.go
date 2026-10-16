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
