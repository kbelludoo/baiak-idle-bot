# ⚔️ Baiak Idle — Bot Inteligente & Headless 24/7

Bot completo de alta performance para o jogo [Baiak Idle](https://baiakidle.com/jogar/), desenvolvido para rodar tanto em **computadores comuns (Windows, Linux, macOS)** com ou sem interface visual, quanto em servidores **Linux / VPS via Docker**.

---

## ✨ Funcionalidades Principais

- 🏹 **Auto Hunt Inteligente com Profiler:** Analisa rendimento real de Gold/hora e Kills/hora, priorizando monstros de morte rápida e alto drop.
- 🥋 **Auto Treino Dinâmico:** Alterna automaticamente para o treino online quando a stamina zera e volta a caçar quando recuperar.
- 💰 **Auto Sell Nativo:** Vende itens da pouch automaticamente no cooldown seguro do servidor (75%+ cheia).
- 🎒 **Auto Open Bags:** Abre Glooth Bags e baús automaticamente.
- 👹 **Auto Boss:** Executa rotação de chefes configurados.
- 🛡️ **Anti-Bot Nativo:** Dispara eventos de presença humana real (`isTrusted: true`) contínuos, evitando bloqueios do jogo.
- 🔄 **Watchdog com Auto-Reconexão:** Detecta modais de desconexão (*"Sessão Expirada"*, *"Sessão Aberta em Outro Lugar"* ou quedas de WebSocket) e reconecta automaticamente sem você precisar intervir.
- 🖥️ **Modo Visual ou Segundo Plano:** Escolha se quer ver a janela do jogo abrindo na sua tela ou se prefere deixar rodando 100% invisível em background.
- 📺 **Transmissão 480p:** MJPEG ~12 fps no dashboard (`http://host:8080/`), sem slideshow de JPEG e sem 4K.

---

## 🚀 Como Usar no seu Computador (Mais Fácil Impossível)

### 🪟 No Windows (1 Clique)

1. **Baixe este projeto** (baixe o ZIP pelo GitHub e extraia, ou use `git clone`).
2. Tenha o [Python](https://www.python.org/downloads/) instalado (marque a caixinha **"Add Python to PATH"** na instalação).
3. Dê **dois cliques** no arquivo:
   ```cmd
   iniciar.bat
   ```
4. Na primeira vez, ele vai pedir para você colar o seu **`BAIAK_TOKEN`** no terminal. Cole o token e aperte **ENTER**.
5. O script vai criar o ambiente virtual, instalar os pacotes necessários e abrir o jogo automaticamente!

---

### 🐧 No Linux ou 🍎 macOS

1. Abra o terminal na pasta do bot.
2. Dê permissão de execução e inicie:
   ```bash
   chmod +x iniciar.sh
   ./iniciar.sh
   ```
3. Na primeira execução, se você não tiver criado o arquivo `.env`, o script solicitará seu token no terminal e iniciará tudo sozinho.

---

### 🐳 Em Servidor Linux / VPS (com Docker)

Para manter rodando 24/7 no seu servidor:

```bash
# 1. Copie o arquivo de configuração
cp .env.example .env
nano .env   # Cole seu BAIAK_TOKEN

# 2. Inicie o container em segundo plano
docker compose up -d --build

# 3. Acompanhe os logs ao vivo
docker compose logs -f

# 4. Transmissão 480p (dashboard + MJPEG)
# http://IP-DA-VPS:8080/
# http://IP-DA-VPS:8080/api/stream.mjpeg
```

---

## 🔑 Como Obter seu `BAIAK_TOKEN`

É super simples e leva menos de 10 segundos:

1. Abra o jogo no seu navegador comum logado na sua conta: [https://baiakidle.com/jogar/](https://baiakidle.com/jogar/)
2. Pressione a tecla **F12** do teclado para abrir as ferramentas de desenvolvedor.
3. No menu superior, vá até a aba **Application** (ou **Aplicativo**).
4. No menu lateral esquerdo, clique em **Local Storage** > `https://baiakidle.com`.
5. Procure a chave chamada **`baiak-idle-token`**.
6. Dê dois cliques no valor correspondente (um código de 64 caracteres) e copie (**Ctrl + C**).
7. Cole no seu arquivo `.env` ou quando o instalador solicitar!

---

## ⚙️ Opções do Arquivo `.env`

Você pode personalizar o comportamento do bot editando o arquivo `.env`:

| Variável | Padrão | Descrição |
|---|---|---|
| `BAIAK_TOKEN` | *obrigatório* | Seu token de autenticação de 64 caracteres. |
| `HEADLESS` | `false` no PC / `true` na VPS | `false` para ver a janela do navegador; `true` para rodar invisível. |
| `AUTO_HUNT` | `true` | Mantém o loop de caça. Sempre na **última hunt** (não escolhe “melhor”). |
| `FORCE_HUNT` | `false` | Se `true`, entra em `HUNT_ID` em vez da última hunt. |
| `HUNT_ID` | vazio | Ignorado salvo com `FORCE_HUNT=true`. |
| `AUTO_TREINO` | `true` | Alterna para treino quando a stamina acabar. |
| `AUTO_SELL` | `true` | Vende o loot da pouch quando atingir o limite. |
| `SELL_THRESHOLD_PCT` | `75` | Porcentagem da bolsa cheia para acionar a venda. |
| `AUTO_HEAL` | `true` | Habilita configuração automática de cura e poções de HP/Mana. |
| `HEAL_BELOW_PCT` | `75` | % de vida para usar magia de cura automática. |
| `HP_POTION_BELOW_PCT` | `60` | % de vida para usar a melhor poção de HP disponível. |
| `MANA_POTION_BELOW_PCT` | `65` | % de mana para usar a melhor poção de Mana disponível. |
| `REDUCE_VFX` | `true` | Reduz efeitos visuais para consumir menos CPU. |
| `SCREENSHOT_INTERVAL` | `0` | Intervalo em segundos para salvar screenshot em `data/` (0 = desliga). |
| `LIVE_STREAM` | `true` | Transmissão 480p MJPEG no dashboard (`/api/stream.mjpeg`). |
| `STREAM_FPS` | `12` | FPS alvo (4–24). 12 é o equilíbrio qualidade/CPU. |
| `STREAM_WIDTH` / `STREAM_HEIGHT` | `854` / `480` | Resolução do stream (não use 1080p/4K). |
| `STREAM_QUALITY` | `70` | JPEG 40–85. |

---

## 📁 Estrutura do Projeto

```text
├── iniciar.bat              # Script 1-clique para Windows
├── iniciar.sh               # Script 1-clique para Linux/Mac
├── stream.py                # Buffer + CDP screencast 480p (MJPEG)
├── server.py                # Dashboard HTTP + /api/stream.mjpeg
├── page_potion.js           # Gerenciador de cura e poções HP/MP por slot
├── chrome.py                # Configurações otimizadas do Chromium
├── hunts.py                 # Tabela e inteligência de seleção de hunts
├── config.py                # Leitura segura de flags e ambiente
├── Dockerfile               # Imagem para execução em containers
├── docker-compose.yml       # Orquestração do container para VPS
├── requirements.txt         # Dependências mínimas (Playwright)
├── .env.example             # Modelo de configuração
└── .gitignore               # Proteção para nunca enviar tokens ao GitHub
```

---

## ⚠️ Segurança

- **NUNCA compartilhe o seu arquivo `.env` nem o seu `BAIAK_TOKEN` com ninguém.** O arquivo `.env` já está no `.gitignore` para garantir que não seja enviado ao GitHub acidentalmente.
