package engine

import (
	"fmt"
	"sync"
)

// BotManager coordena todas as contas ativas do processo
type BotManager struct {
	mu      sync.RWMutex
	bots    []GameBot
	botByID map[string]GameBot
}

func NewBotManager() *BotManager {
	return &BotManager{
		bots:    make([]GameBot, 0),
		botByID: make(map[string]GameBot),
	}
}

func (m *BotManager) Register(b GameBot) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bots = append(m.bots, b)
	m.botByID[b.ID()] = b
}

func (m *BotManager) GetAllStatuses() []AccountStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var list []AccountStatus
	for _, b := range m.bots {
		list = append(list, b.GetStatus())
	}
	return list
}

func (m *BotManager) GetBot(id string) (GameBot, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	b, ok := m.botByID[id]
	return b, ok
}

func (m *BotManager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.bots)
}

func (m *BotManager) ExecuteAction(accountID, action string, payload map[string]any) (any, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if len(m.bots) == 0 {
		return nil, fmt.Errorf("nenhuma conta registrada")
	}

	if accountID == "" || accountID == "all" {
		// Executa em todas as contas se accountID for vazio ou "all"
		var results = make(map[string]any)
		for _, b := range m.bots {
			res, err := b.ExecuteAction(action, payload)
			if err != nil {
				results[b.ID()] = fmt.Sprintf("erro: %v", err)
			} else {
				results[b.ID()] = res
			}
		}
		return results, nil
	}

	b, ok := m.botByID[accountID]
	if !ok {
		return nil, fmt.Errorf("conta '%s' não encontrada", accountID)
	}

	return b.ExecuteAction(action, payload)
}

func (m *BotManager) SupplyTurnstileToken(accountID, token string) error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if len(m.bots) == 0 {
		return fmt.Errorf("nenhuma conta registrada")
	}

	if accountID != "" && accountID != "all" {
		if b, ok := m.botByID[accountID]; ok {
			return b.SupplyTurnstileToken(token)
		}
		return fmt.Errorf("conta '%s' não encontrada", accountID)
	}

	// Entrega para todas as contas
	for _, b := range m.bots {
		_ = b.SupplyTurnstileToken(token)
	}
	return nil
}
