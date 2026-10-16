package game

import (
	"context"
	"testing"
	"time"
)

func TestEstimateItemMarketValueCoins(t *testing.T) {
	// Test Falcon Bow Tier 2 with UpLevel 7
	val := EstimateItemMarketValueCoins("Falcon Bow", 2, 7, nil)
	// Base falcon: 220 + Tier 2: 120 + Up 7: 80 = 420 coins
	if val != 420 {
		t.Fatalf("esperado 420 coins, obteve %d", val)
	}

	// Test regular item Tier 0
	valCommon := EstimateItemMarketValueCoins("Plate Armor", 0, 0, nil)
	if valCommon != 40 {
		t.Fatalf("esperado 40 coins para item comum, obteve %d", valCommon)
	}
}

func TestJevClientEvaluation(t *testing.T) {
	client := NewJevClient()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	shouldSell, price, estVal, reason := client.EvaluateItemForAuction(ctx, "Soulbleeder", 2, 8, nil)
	t.Logf("Resultado JEV Soulbleeder: sell=%v, price=%d, estVal=%d, reason=%s", shouldSell, price, estVal, reason)

	if !shouldSell || estVal < 200 {
		t.Fatalf("esperava Soulbleeder T2 ser aprovado para venda, obteve sell=%v, val=%d", shouldSell, estVal)
	}
}
