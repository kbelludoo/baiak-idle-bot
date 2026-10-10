# ⚔️ Baiak Idle — Terminal Bot 24/7 com TypeSafe AI (Jev)

Bot headless de alta performance para **Baiak Idle**, escrito 100% em **TypeScript** e executado nativamente com **Bun**. 

Funciona diretamente pelo protocolo **WebSocket Colyseus** e chamadas **tRPC**, **sem navegador, sem Chromium, sem Puppeteer e sem interface gráfica**, consumindo apenas **~7 a 15 MB de RAM** (ideal para rodar 24/7 em instâncias gratuitas da nuvem como a Oracle Cloud Always Free).

---

## 🚀 Principais Funcionalidades

### 1. 🧠 Inteligência TypeSafe AI (Modelo Jev System One)
O bot integra decisões probabilísticas calibradas via [TypeSafe AI](https://typesafe.ai) (`Jev`):
* **🛡️ Auto-Boss Seguro**: Avalia a viabilidade de cada boss cruzando o nível, vocação e margem de segurança antes de entrar no combate. **Evita 100% dos wipes**, ignorando chefes impossíveis.
* **📦 Triagem de Inventário & Proteção de Loot**: Detecta itens raros, itens de famílias nobres (BiS) e tiers altos. Transfere automaticamente para o baú (`chest`) e protege contra venda no NPC.
* **🏷️ Avaliação de Flash Offers**: Analisa ofertas relâmpago do servidor e realiza compra automática (`flashoffer:buy`) apenas se o custo-benefício for comprovadamente vantajoso.
* **📜 Sincronização de Codex & Guilda**: Alinha as metas ativas do Codex com os monstros da hunt atual e sincroniza tarefas da guilda periodicamente.

### 2. 🎯 Simulação Matemática de Hunts (Anti-Wipe)
Diferente de bots com listas estáticas de nível, este bot utiliza um **simulador matemático de combate** (`src/hunt_sim.ts` / `src/game_formula.ts`):
* Simula TTK (Time-to-Kill), DPS, regeneração e sustain de vida/mana.
* Verifica o parâmetro **`can_tank`**: se a party não aguentar a pressão de dano dos monstros, a hunt é descartada, evitando mortes e perda contínua de gold.
* Maximiza o score de equilíbrio entre **XP/h** e **Gold/h**.

### 3. 🧙 Auto-Config de Magias, Rotações e Poções
* No início da sessão e a cada 10 minutos, o bot configura automaticamente a party:
  * **Knight / Tank**: Configura cura prioritária (`exura ico`), rotação completa de 4 magias de dano/área e poções de vida de tier alto (`ultimate/supreme health potion`).
  * **Paladin / Monk / Mages**: Configura cura (`exura gran san`, etc.), rotação ofensiva ideal e poções de mana.
* Ativa **Auto-Refill** e **Auto-Buy Supply** para garantir que o estoque de poções nunca se esgote.

### 4. 🧘 Gestão de Stamina & Treino Online
* Se a stamina cair para **< 15%**, o bot se teleporta para o **Treino Online** para treinar skills e regenerar stamina.
* Quando a stamina atinge **> 85%**, o bot retorna automaticamente à hunt ótima.

---

## 🛠️ Requisitos

* [Bun](https://bun.sh) (v1.1 ou superior)
* Token da conta do jogo (`BAIAK_TOKEN` extraído do Local Storage: `baiak-idle-token`)
* (Opcional) Chave de API TypeSafe (`TYPESAFE_API_KEY`) para habilitar o modelo Jev

---

## ⚙️ Configuração

Copie o arquivo de exemplo e preencha suas credenciais:

```bash
cp .env.example .env
```

Edite o `.env`:
```env
BAIAK_TOKEN=seu_token_aqui
USER_DATA_DIR=./data
TYPESAFE_API_KEY=sua_chave_typesafe_aqui
AUTO_BOSS=true
```

---

## 💻 Como Rodar

### Modo Terminal 24/7
```bash
# Executa o bot terminal
bun run terminal

# Ou com flags personalizadas:
bun run terminal --auto-boss --hunt-id=glooth-cave
```

### Diagnóstico Rápido (Probe)
Conecta, faz o handshake, imprime os frames recebidos e desconecta após alguns segundos:
```bash
bun run terminal:probe
```

### Testes Automatizados
O projeto conta com **178 testes unitários** cobrindo protocolo, fórmulas, simulador de hunts e decisões do Jev:
```bash
bun test
```

---

## ☁️ Rodando 24/7 na Oracle Cloud (OCI Always Free)

O bot está preparado para rodar como serviço `systemd` em VPS Linux (Ubuntu / Debian / Oracle Linux):

1. Clone o repositório na VPS:
   ```bash
   git clone <URL_DO_REPOSITORIO> ~/baiak-bot
   cd ~/baiak-bot
   ```
2. Instale o Bun (se ainda não tiver):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   export PATH="$HOME/.bun/bin:$PATH"
   ```
3. Crie o serviço systemd em `/etc/systemd/system/baiak-term.service`:
   ```ini
   [Unit]
   Description=Baiak Idle - Terminal Bot 24/7
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=ubuntu
   WorkingDirectory=/home/ubuntu/baiak-bot
   EnvironmentFile=-/home/ubuntu/baiak-bot/.env
   Environment=NODE_ENV=production
   ExecStart=/home/ubuntu/.bun/bin/bun run src/term/main.ts
   Restart=always
   RestartSec=10
   MemoryHigh=256M
   MemoryMax=384M

   [Install]
   WantedBy=multi-user.target
   ```
4. Ative e inicie o serviço:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now baiak-term.service
   ```
5. Verifique os logs em tempo real:
   ```bash
   journalctl -u baiak-term.service -f
   ```

---

## 📋 Flags da CLI

| Flag | Padrão | Descrição |
| --- | --- | --- |
| `--auto-boss` | `false` (ou `AUTO_BOSS=true`) | Habilita auto-boss com filtro de segurança Jev |
| `--hunt-id=<id>` | Automática (fórmula) | Força uma hunt específica (ex: `glooth-cave`) |
| `--no-sell` | `false` | Desativa o auto-sell de loot |
| `--no-rewards` | `false` | Desativa a coleta periódica de recompensas |
| `--no-treino` | `false` | Desativa o treino online com stamina baixa |
| `--no-arena` | `false` | Desativa a fila diária de arena PvP |
| `--no-codex` | `false` | Desativa entregas automáticas do Codex |
| `--log-sec=<n>` | `60` | Intervalo em segundos do log de status |
| `--poll-sec=<n>` | `120` | Intervalo em segundos do polling tRPC |

---

## 📄 Licença
MIT
