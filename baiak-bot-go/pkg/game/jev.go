package game

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

var (
	reSoul       = regexp.MustCompile(`(?i)(soulbleeder|soulhexer|soulshredder|soultainter|soulcutter|soulbiter|soulcrusher|soulpiercer|soulful\s+legs|ring\s+of\s+souls|\bsoul\b)`)
	reInferniarch = regexp.MustCompile(`(?i)inferniarch`)
	reFalcon     = regexp.MustCompile(`(?i)falcon`)
	reNaga       = regexp.MustCompile(`(?i)naga`)
	reGhostChest = regexp.MustCompile(`(?i)ghost\s+chestplate`)
	reEldritch   = regexp.MustCompile(`(?i)(eldritch|fabulous\s+legs)`)
	reCobra      = regexp.MustCompile(`(?i)(cobra|death\s+oyoroi|toga\s+mortis)`)
	reLion       = regexp.MustCompile(`(?i)(lion|dark\s+whispers)`)
	reGnome      = regexp.MustCompile(`(?i)gnome`)
	rePlasma     = regexp.MustCompile(`(?i)(collar\s+of\s+(?:blue|red)\s+plasma|ring\s+of\s+(?:blue|red)\s+plasma)`)
	rePrismatic  = regexp.MustCompile(`(?i)(prismatic|ornate|depth|yalahari|depth\s+galea|alicorn)`)
)

type ItemAttribute struct {
	ID    int `json:"id"`
	Level int `json:"level"`
}

// EstimateItemMarketValueCoins calcula o valor justo de mercado de um item em coins
func EstimateItemMarketValueCoins(name string, tier, upLevel int, attrs []ItemAttribute) int {
	if strings.TrimSpace(name) == "" {
		return 0
	}
	baseValue := 40

	// 1. Famílias BiS / Nobres
	switch {
	case reSoul.MatchString(name):
		baseValue = 350
	case reInferniarch.MatchString(name):
		baseValue = 250
	case reFalcon.MatchString(name):
		baseValue = 220
	case reNaga.MatchString(name):
		baseValue = 180
	case reGhostChest.MatchString(name):
		baseValue = 160
	case reEldritch.MatchString(name):
		baseValue = 150
	case reCobra.MatchString(name):
		baseValue = 140
	case reLion.MatchString(name):
		baseValue = 130
	case reGnome.MatchString(name):
		baseValue = 120
	case rePlasma.MatchString(name):
		baseValue = 100
	case rePrismatic.MatchString(name):
		baseValue = 70
	}

	// 2. Bônus por Tier da Forja
	tierBonus := 0
	switch {
	case tier == 1:
		tierBonus = 40
	case tier == 2:
		tierBonus = 120
	case tier == 3:
		tierBonus = 300
	case tier == 4:
		tierBonus = 700
	case tier >= 5:
		tierBonus = 1500 + (tier-5)*1000
	}

	// 3. Bônus por Atributos Raros
	attrBonus := 0
	for _, a := range attrs {
		switch {
		case a.Level >= 10:
			attrBonus += 100
		case a.Level >= 8:
			attrBonus += 50
		case a.Level >= 6:
			attrBonus += 20
		}
	}

	// 4. Bônus por Nível de Upgrade (+1 a +12)
	upBonus := 0
	switch {
	case upLevel >= 11:
		upBonus = 500
	case upLevel >= 9:
		upBonus = 200
	case upLevel >= 7:
		upBonus = 80
	case upLevel >= 5:
		upBonus = 30
	case upLevel >= 3:
		upBonus = 10
	}

	return baseValue + tierBonus + attrBonus + upBonus
}

// JevClient integra diretamente com a API TypeSafe AI (System One / Jev)
type JevClient struct {
	endpoint string
	apiKey   string
	model    string
	client   *http.Client
}

func NewJevClient() *JevClient {
	key := os.Getenv("TYPESAFE_API_KEY")
	if key == "" {
		key = os.Getenv("EXPERIENTIAL_API_KEY")
	}
	if key == "" {
		key = os.Getenv("JEV_API_KEY")
	}
	if key == "" {
		// Chave padrão oficial TypeSafe AI
		key = "apikey_291e3f2562a58b34746ac07157b8954a1d6_daabcd7490ca03df70997fb848a84fd1b117a4601d6bbe377e9404130a113aee"
	}

	endpoint := os.Getenv("JEV_ENDPOINT")
	if endpoint == "" {
		endpoint = "https://api.typesafe.ai/v1/systemone"
	}

	return &JevClient{
		endpoint: endpoint,
		apiKey:   key,
		model:    "jev-latest",
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

type jevRequest struct {
	Model     string                 `json:"model"`
	State     map[string]any         `json:"state"`
	Questions map[string]jevQuestion `json:"questions"`
}

type jevQuestion struct {
	Type         string   `json:"type"`
	Instructions string   `json:"instructions"`
	Criteria     []string `json:"criteria,omitempty"`
}

type jevResponse struct {
	Ok      bool                   `json:"ok"`
	Answers map[string]jevAnswer   `json:"answers"`
	Error   string                 `json:"error,omitempty"`
}

type jevAnswer struct {
	Choice     string   `json:"choice,omitempty"`
	Confidence *float64 `json:"confidence,omitempty"`
	Score      *float64 `json:"score,omitempty"`
	Noul       *float64 `json:"noul,omitempty"`
}

// EvaluateItemForAuction avalia se um item da bag deve ser listado em leilão
func (j *JevClient) EvaluateItemForAuction(ctx context.Context, name string, tier, upLevel int, attrs []ItemAttribute) (bool, int, int, string) {
	estVal := EstimateItemMarketValueCoins(name, tier, upLevel, attrs)
	targetPrice := int(float64(estVal) * 0.85)
	if targetPrice < 25 {
		targetPrice = 25
	}

	// Itens comuns ou de valor irrisório (< 80 coins) não justificam leilão
	if estVal < 80 {
		return false, targetPrice, estVal, fmt.Sprintf("Item de baixo valor (estVal=%dc < 80c)", estVal)
	}

	// Consulta JEV System One para decisão probabilística tipada
	reqBody := jevRequest{
		Model: j.model,
		State: map[string]any{
			"item_name":             name,
			"tier":                  tier,
			"up_level":              upLevel,
			"estimated_value_coins": estVal,
			"target_price_coins":    targetPrice,
		},
		Questions: map[string]jevQuestion{
			"should_auction": {
				Type:         "noul",
				Instructions: "Maximize o lucro em coins. O item é valioso o suficiente no mercado para valer a pena colocar à venda em leilão?",
			},
		},
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		// Fallback determinístico
		return estVal >= 80, targetPrice, estVal, fmt.Sprintf("Fallback heurístico (estVal=%dc)", estVal)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, j.endpoint, bytes.NewReader(jsonBytes))
	if err != nil {
		return estVal >= 80, targetPrice, estVal, fmt.Sprintf("Fallback heurístico (estVal=%dc)", estVal)
	}
	httpReq.Header.Set("Authorization", "Bearer "+j.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := j.client.Do(httpReq)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			_ = resp.Body.Close()
		}
		return estVal >= 80, targetPrice, estVal, fmt.Sprintf("JEV fallback (estVal=%dc)", estVal)
	}
	defer resp.Body.Close()

	var jResp jevResponse
	if err := json.NewDecoder(resp.Body).Decode(&jResp); err != nil {
		return estVal >= 80, targetPrice, estVal, fmt.Sprintf("JEV fallback decode (estVal=%dc)", estVal)
	}

	if ans, ok := jResp.Answers["should_auction"]; ok && ans.Noul != nil {
		shouldSell := *ans.Noul > 0.50
		return shouldSell, targetPrice, estVal, fmt.Sprintf("JEV System One noul=%.2f (estVal=%dc)", *ans.Noul, estVal)
	}

	return estVal >= 80, targetPrice, estVal, fmt.Sprintf("JEV heurística estVal=%dc", estVal)
}

// EvaluateGoldForAuction calcula se e quanto gold deve ser anunciado no leilão
func (j *JevClient) EvaluateGoldForAuction(goldBalance int64, medianRate int64) (bool, int64, int, string) {
	feeGold := int64(5000000)   // 5kk de taxa
	minGold := int64(100000000) // 100kk mínimo para venda expressiva
	maxToSell := int64(800000000)

	if goldBalance < minGold+feeGold {
		return false, 0, 0, fmt.Sprintf("Saldo insuficiente (%d < 105kk)", goldBalance)
	}

	goldToSell := goldBalance - feeGold
	if goldToSell > maxToSell {
		goldToSell = maxToSell
	}

	if medianRate <= 0 {
		medianRate = 5000000 // 5kk por coin padrão
	}

	targetCoins := int(goldToSell / medianRate)
	if targetCoins < 25 {
		targetCoins = 25
	}

	return true, goldToSell, targetCoins, fmt.Sprintf("Venda de %dkk por %d coins (taxa ref %dkk/c)", goldToSell/1000000, targetCoins, medianRate/1000000)
}
