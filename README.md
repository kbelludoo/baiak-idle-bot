# ⚔️ Baiak Idle — 100% Native Go Bot & GitHub Pages Auto-Relay

Motor de alta performance em **Go puro** para o **Baiak Idle**, sem Node.js, sem Puppeteer, sem Chromium e sem consumo excessivo de memória.

Executa **24/7 na VPS** consumindo apenas **~2.5 MB de RAM** para todas as contas combinadas, com integração direta ao **GitHub Pages** para resolução de Captchas Cloudflare Turnstile com **0 MB de uso na VPS**.

---

## 🚀 Destaques da Arquitetura

- **100% Nativo em Go:** Binário único compilado estaticamente (`baiak-bot-linux`).
- **Memória Mínima:** Apenas ~2.5 MB de RAM na VPS para gerenciar toda a frota (3+ contas caçando simultaneamente via WebSocket Colyseus e tRPC).
- **GitHub Pages Turnstile Solver:** Widget Turnstile hospedado no GitHub Pages (`https://kbelludoo.github.io/baiak-idle-bot/`). Ao abrir a página no navegador ou celular, o captcha é resolvido sem headless browser na VPS e o token é entregue via `POST /api/ticket`.
- **Leilão & Sniper Autônomo:**
  - Vende gold excedente (> 100kk) e equipamentos raros não equipados (Avaliados via TypeSafe AI / Jev).
  - Sniper inteligente que monitora `auction.browse` e arremata ofertas com margem de lucro sem necessidade de captcha/2fa.
- **Auto-Config de Party & BiS:** Rotação de magias, poções supremas e talentos aplicados automaticamente.
- **Auto-Hunt Anti-Wipe:** Simulação matemática de TTK e dano recebido, com downgrade automático de hunt em caso de risco.

---

## 📁 Estrutura do Repositório

```
.
├── baiak-bot-go/              # Motor 100% nativo em Go
│   ├── accounts.example.json  # Modelo de configuração das contas
│   ├── main.go                # Supervisor, console e inicialização do servidor
│   ├── go.mod / go.sum        # Dependências Go
│   └── pkg/
│       ├── engine/            # Interfaces de bots, manager e supervisor
│       ├── game/              # Colyseus WebSocket, tRPC, Leilão, Hunts e Jev
│       ├── network/           # Clientes HTTP e WebSocket com bind de IP
│       └── server/            # Servidor Web (Dashboard + API REST com CORS)
├── docs/                      # GitHub Pages (Turnstile Solver & Bot Dashboard)
│   ├── index.html             # Painel interativo com widget Turnstile
│   ├── GAME_SYSTEMS.md        # Documentação dos sistemas de jogo
│   └── GAME_CURIOSITIES.md    # Curiosidades e mecânicas
└── README.md
```

---

## 🌐 Dashboard & Captcha Relay via GitHub Pages

Acesse o painel hospedado:
👉 **[https://kbelludoo.github.io/baiak-idle-bot/](https://kbelludoo.github.io/baiak-idle-bot/)**

1. A página conecta automaticamente à API pública da VPS via túnel seguro Cloudflare.
2. O widget Cloudflare Turnstile oficial (`sitekey: 0x4AAAAAAD1KLtRAtKEsbKdT`) é renderizado no cliente.
3. Assim que o desafio é concluído, o token gerado é despachado via `POST /api/ticket` diretamente para a VPS, liberando a criação imediata de anúncios de leilão.

---

## 🛠️ Compilação e Execução

### Compilar binário para Linux (VPS):
```bash
cd baiak-bot-go
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o baiak-bot-linux main.go
```

### Executar localmente (Windows):
```powershell
cd baiak-bot-go
go run main.go
```
