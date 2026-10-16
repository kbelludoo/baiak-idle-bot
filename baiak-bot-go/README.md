# ⚡ Baiak Idle - Native Go Multi-Account Bot Engine

Motor completo, ultra-leve e nativo em **Go** para o **Baiak Idle**, seguindo estritamente a arquitetura de alta performance do `bot-template-go`.

---

## 🚀 Destaques & Performance

- **Consumo de Memória:** ~2 a 4 MB de RAM total para todas as contas (vs 150MB+ em TypeScript e 500MB+ em Chromium).
- **Multi-Account Nativo:** Gerenciamento de múltiplas contas em goroutines isoladas via `pkg/engine/manager.go`.
- **Supervisor com Auto-Recovery:** Recuperação automática de panics e reconexão com backoff exponencial via `pkg/engine/supervisor.go`.
- **Protocolo Colyseus 0.16:** Matchmaking, handshake binário (opcode `0x0A`), e codec MessagePack (`0x0D`) nativo via `pkg/game/protocol.go`.
- **Cliente tRPC v10:** Consultas e mutações diretas em `characters.list`, `characters.partyConfig`, etc.
- **Motor de Simulação de Hunts:** Catálogo completo de hunts com cálculo de TTK, sustentação (can_tank), rendimento de ouro/h e xp/h.
- **Transição Automática:** Foco automático em Gold para acumular 100kk, compra automática do 3º slot (`buypartyslot`), e chaveamento imediato para XP Máximo assim que 3 personagens estiverem ativos.
- **Automações Integradas:** Auto-Sell (venda de materiais e drops com proteção de tiers), Auto-Treino (gestão de stamina), Auto-Arena diária, Auto-Codex e anti-wipe inteligente.
- **Dashboard Web + Console Terminal:** Monitor em tempo real no terminal e interface web moderna (`http://localhost:3001`).

---

## 📁 Estrutura do Projeto

```
baiak-bot-go/
├── accounts.example.json      # Modelo de configuração de contas
├── accounts.json              # Configuração ativa das contas
├── go.mod / go.sum            # Módulo Go e dependências
├── main.go                    # Ponto de entrada, dashboard de terminal e supervisor
├── pkg/
│   ├── engine/                # Interfaces fundamentais do motor
│   │   ├── bot.go             # Interface GameBot e AccountStatus
│   │   ├── manager.go         # BotManager thread-safe
│   │   └── supervisor.go      # Supervisor com recovery e loop de reconexão
│   ├── network/               # Camada de rede de baixo nível
│   │   ├── http_client.go     # Cliente HTTP com suporte a bind de IP local
│   │   └── socket.go          # Cliente WebSocket thread-safe (Gorilla)
│   ├── game/                  # Lógica de negócio do Baiak Idle
│   │   ├── types.go           # Estruturas de contas, pacotes e telemetria
│   │   ├── fingerprint.go     # Gerador de fingerprint (djb2 hash do jogo)
│   │   ├── protocol.go        # Codec de frames Colyseus 0.16 e MsgPack
│   │   ├── trpc.go            # Cliente tRPC v10 com unwrapping automático
│   │   ├── hunts.go           # Catálogo embutido de hunts e monstros
│   │   ├── sim.go             # Simulador de DPS, TTK, Gold/h e XP/h
│   │   └── bot.go             # Implementação completa do GameBot
│   └── server/                # Servidor Web e Dashboard
│       ├── index.html         # Painel Web embutido com controles em tempo real
│       └── server.go          # Endpoints HTTP (/ e /api/status, /api/action)
```

---

## 🛠️ Como Executar

### 1. Compilar Localmente (Windows)
```powershell
go build -o baiak-bot.exe .
.\baiak-bot.exe
```

### 2. Compilar para Linux (VPS)
```powershell
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -ldflags="-s -w" -o baiak-bot-linux .
```

### 3. Executar Conta Específica
Se você quiser rodar apenas uma conta do `accounts.json`:
```powershell
$env:ACCOUNT="acc-1"; .\baiak-bot.exe
```

---

## 🌐 Dashboard Web

Acesse `http://localhost:3001` no navegador para visualizar:
- Status de cada bot em tempo real (HP, Nível, Vocação, Ouro, Stamina, Hunt).
- Estatísticas globais (Ouro total farmado, Kills, RAM em tempo real).
- Ações manuais de 1 clique:
  - 🎯 **Mudar Hunt**: Escolher qualquer hunt dinamicamente.
  - 💰 **Vender Loot**: Dispara `sellall` protegendo itens raros.
  - 🧘 **Treino Online**: Alterna entre treino para recuperar stamina e hunt.
  - ⭐ **Comprar Slot**: Dispara compra do 3º slot da party (100kk gold).
