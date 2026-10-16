package game

// AccountConfig modelo de configuração de conta no accounts.json
type AccountConfig struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Enabled     bool            `json:"enabled"`
	Credentials GameCredentials `json:"credentials"`
	Settings    GameSettings    `json:"settings"`
}

type GameCredentials struct {
	Token  string `json:"token"`
	Origin string `json:"origin,omitempty"` // Padrão: "https://baiakidle.com"
}

type GameSettings struct {
	HuntTarget       string `json:"huntTarget,omitempty"`       // Hunt fixa opcional (ex: "vexclaw-lair", "refiner-cave")
	Priority         string `json:"priority,omitempty"`         // "gold" | "xp" | "balanced" (se vazio, auto: gold até 3 slots, depois xp)
	AutoHunt         bool   `json:"autoHunt"`                   // Padrão: true
	AutoSell         bool   `json:"autoSell"`                   // Padrão: true (vende drops e materiais)
	AutoRewards      bool   `json:"autoRewards"`                // Padrão: true (coleta baús/recompensas)
	AutoTreino       bool   `json:"autoTreino"`                 // Padrão: true (vai para Treino Online em <= 50% stam)
	AutoArena        bool   `json:"autoArena"`                  // Padrão: true (entra na arena diária)
	AutoCodex        bool   `json:"autoCodex"`                  // Padrão: true
	AutoTree         bool   `json:"autoTree"`                   // Padrão: true (gasta pontos de talentos)
	AutoBoss         bool   `json:"autoBoss"`                   // Auto boss seguro
	AutoBuyPartySlot bool   `json:"autoBuyPartySlot"`           // Compra 3º slot ao atingir 100kk gold
	EquipMinTier     int    `json:"equipMinTier,omitempty"`     // Mínimo de tier protegido (padrão 3 = épico+)
	BindIP           string `json:"bindIP,omitempty"`           // IP local de saída (VPS multi-IP)
}

// CharacterInfo retornado pela API tRPC characters.list
type CharacterInfo struct {
	ID       any    `json:"id"`
	Name     string `json:"name"`
	Vocation string `json:"vocation"`
	Level    int    `json:"level"`
	Stamina  int    `json:"stamina,omitempty"`
	Gold     int64  `json:"gold,omitempty"`
}

// PartyConfig retornado pela API tRPC characters.partyConfig
type PartyConfig struct {
	Leader   any   `json:"leader"`
	Disabled []any `json:"disabled"`
}

// DecodedFrame representa um frame do Colyseus
type DecodedFrame struct {
	Opcode  byte   `json:"opcode"`
	Frame   string `json:"frame,omitempty"`
	Type    string `json:"type,omitempty"`
	Payload any    `json:"payload,omitempty"`
}
