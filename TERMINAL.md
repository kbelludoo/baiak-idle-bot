# Driver terminal (sem navegador, sem Chromium)

O jogo é idle e server-authoritative: o cliente só escolhe a hunt (`mode` +
`stage`) e o servidor simula o combate. Por isso dá para farmar 24/7 **sem
Chromium, sem Xvfb e sem SwiftShader** — só o runtime Bun, uma conexão WebSocket
e um poll tRPC de tempo em tempo.

É o modo indicado para VPS pequena (Oracle Cloud Always Free, 1 OCPU / 1 GB):
o driver com navegador precisa de ~700 MB+ só de Chromium, o terminal fica na
casa dos ~100 MB de RSS e ~0-3% de CPU em regime.

## Instalação em 1 comando (Ubuntu 22.04/24.04 ou Oracle Linux 8/9)

```bash
# no servidor: envie o projeto (baiak-term.tar.gz) e extraia
mkdir -p ~/baiak-bot-ts && tar xzf baiak-term.tar.gz -C ~/baiak-bot-ts
cd ~/baiak-bot-ts

# instala Bun, cria o .env, cria swap se faltar RAM, roda o --probe
# e registra o serviço systemd (sobe sozinho no boot)
bash instalar_terminal.sh
```

O script pergunta apenas o `BAIAK_TOKEN` (F12 > Application > Local Storage >
`baiak-idle-token`). Ele **não** instala Chromium, **não** abre porta nenhuma
(só conexão de saída) e usa `sudo` só para pacotes, swap e systemd.

## Rodar na mão (sem systemd)

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd ~/baiak-bot-ts

bun run src/term/main.ts --probe --session-sec=30   # diagnóstico: join + frames
bash iniciar_terminal.sh                            # 24/7 no terminal
bun run src/term/main.ts --hunt-id=glooth-cave      # hunt fixa
```

## Serviço systemd

```bash
journalctl -u baiak-term -f          # logs ao vivo
sudo systemctl restart baiak-term    # aplicar código novo
sudo systemctl stop baiak-term
bash instalar_terminal.sh uninstall  # remove o serviço (mantém .env e data/)
```

Limites aplicados na unidade (só quando o cgroup v2 existe): `MemoryHigh=256M`,
`MemoryMax=384M`, `CPUQuota=60%`, `Nice=5`. Em 1 OCPU isso deixa folga para o
sshd e para o sistema.

## Docker (alternativa)

```bash
docker compose -f docker-compose.term.yml up -d --build
```

A imagem é `oven/bun:1-debian` (sem Chromium) com `mem_limit: 256M`. Em 1 GB de
RAM o daemon do Docker consome ~150 MB, então **preferir o Bun nativo** se der.

## Migrando do modo navegador (Docker) para o terminal

Numa VM `VM.Standard.E2.1.Micro` (1 OCPU / 1 GB) o driver com Chromium consome
quase toda a RAM. Antes de subir o terminal, veja o que está rodando e pare o
container antigo — o `.env` e o token são reaproveitados pelo instalador:

```bash
free -m | head -2                 # quanto sobrou de RAM
docker ps --format '{{.Names}}'   # baiak-bot-ts, baiak-monitor, ...
docker stop baiak-bot-ts          # libera ~700 MB (nada é removido)
free -m | head -2

mkdir -p ~/baiak-bot-ts && tar xzf ~/baiak-term.tar.gz -C ~/baiak-bot-ts
cd ~/baiak-bot-ts && bash instalar_terminal.sh
```

Para voltar ao modo navegador depois: `docker start baiak-bot-ts` (não rode os
dois ao mesmo tempo com a mesma conta — a sessão é única).

## Flags

| Flag | Padrão | Para que serve |
| --- | --- | --- |
| `--probe` | — | matchmake + handshake + imprime os frames (diagnóstico) |
| `--once` | — | entra na hunt, espera `--session-sec` e sai |
| `--hunt-id=<id>` | melhor hunt p/ o nível | hunt alvo |
| `--character=<nome>` | 1º de `characters.list` | personagem |
| `--log-sec=<n>` | 60 | intervalo do log de status |
| `--poll-sec=<n>` | 120 | poll tRPC de level/gold/stamina (0 desliga) |
| `--stale-sec=<n>` | 120 | reconecta após N s sem frames |
| `--recycle-sec=<n>` | 0 | recicla a sessão a cada N s (0 = nunca) |
| `--session-sec=<n>` | 20 | duração do `--probe`/`--once` |
| `--origin=<url>` | `https://baiakidle.com` | origem do jogo |
| `--token=<token>` | `BAIAK_TOKEN` | token (alternativa ao `.env`) |
| `--no-sell` / `--no-rewards` / `--no-treino` / `--no-arena` / `--no-codex` | ligadas | desligam automações |
| `--no-equip` | — | desliga o auto-equip de itens da mochila |
| `--equip-min-tier=<n>` | 3 (épico) | raridade mínima para equipar (1–7) |
| `--no-loop` | — | não envia o loop de hunts (mantém a stage atual) |
| `--no-tree` | — | não gasta pontos da árvore de talentos no boot |
| `--control-port=<n>` | 8080 | porta do painel HTTP (0 desliga) |
| `--auto-boss` | — | auto-boss com avaliação de segurança JEV |

## Painel HTTP (`/api/status`, `/api/overview`)

- Bind padrão é **127.0.0.1** (`CONTROL_HOST=0.0.0.0` só se quiser expor).
- Leitura (GET) é livre; **escrita (POST) exige** loopback **ou** token em
  `CONTROL_TOKEN` (envie em `x-api-key`, `Authorization: Bearer` ou `?token=`).
- Métricas do `/api/overview` são as reais da telemetria da sessão (kills/h,
  gold/h medidos) — sem números fixos.
- Dashboard em `docs/index.html`: abra o arquivo no navegador e deixe o campo
  *API URL* apontando para `http://localhost:8080` (o painel envia CORS `*`).
  Cole o `BAIAK_TOKEN` no campo de API para as ações (POST) funcionarem.

## Variáveis do `.env` (terminal)

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `BAIAK_TOKEN` | — | obrigatório (F12 > Application > Local Storage > `baiak-idle-token`) |
| `HUNT_ID` | — | hunt fixa (senão a melhor para o nível) |
| `CHARACTER_NAME` | 1º da conta | personagem |
| `TERM_ORIGIN` | `https://baiakidle.com` | origem do jogo |
| `USER_DATA_DIR` | `./data` | guarda o `baiak_device` (fp precisa ser estável) |
| `AUTO_SELL`/`AUTO_REWARDS`/`AUTO_TREINO`/`AUTO_ARENA`/`AUTO_CODEX` | `true` | `=false` desliga |
| `AUTO_EQUIP` | `true` | equipa itens da mochila a cada 5 min |
| `EQUIP_MIN_TIER` | 3 | raridade mínima do auto-equip |
| `AUTO_LOOP` | `true` | mantém o loop de hunts |
| `AUTO_TREE` | `true` | gasta pontos da árvore de talentos |
| `AUTO_BOSS` | `false` | `=true` ativa auto-boss |
| `CONTROL_HOST` | `127.0.0.1` | bind do painel |
| `CONTROL_PORT` | 8080 | porta do painel (`PORT` só como fallback) |
| `CONTROL_TOKEN` | — | token exigido para POST remoto |
| `TERM_UA`/`TERM_SCREEN_W`/`TERM_SCREEN_H`/`TERM_LANG`/`TERM_TZ_OFFSET` | padrões do driver | fingerprint do dispositivo |
| `TREE_PACE_MS`/`TREE_ADJACENCY`/`TREE_SURVIVAL`/`TREE_SLOTS` | 30 / 1.5 / 0.35 | política de compra da árvore |

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `tRPC query characters.list falhou (401...)` | token expirado/inválido | pegue um token novo no Local Storage |
| `join da hunt falhou [ip]` / code 4290 | limite de IP do jogo | 1 sessão por IP; não abra o jogo no navegador junto |
| socket recusado antes do handshake | Cloudflare/anti-bot barrando IP de datacenter | teste `--probe`; IP de VPS pode ser recusado |
| `join da hunt falhou [boss]` (4294) | boss ativo no personagem | o driver já re-tenta sozinho |
| `sessão parada: Ns sem frames` | sala caiu | reconexão automática com backoff |
| `maintenance` / 4295 | manutenção do servidor | esperar; o driver re-tenta |

O processamento de erro do jogo é o mesmo do driver com navegador: o driver
terminal reaproveita `src/protocol.ts`, `src/trpc.ts`, `src/telemetry.ts` e
`src/hunts.ts` — só muda o transporte (WebSocket nativo em vez de CDP).