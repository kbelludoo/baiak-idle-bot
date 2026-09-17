# Baiak Idle Bot — TypeScript/Bun parity port

Esta pasta é uma porta do orquestrador Python para TypeScript/Bun. Ela reutiliza em runtime os mesmos `page_*.js` e `kernel_bot.js` usados pelo bot Python, evitando duplicar seletores e regras de automação.

## Teste rápido com Docker

A partir da raiz do repositório:

```bash
cp bot-ts/.env.example bot-ts/.env
# edite bot-ts/.env e informe BAIAK_TOKEN

docker compose -f bot-ts/docker-compose.yml up -d --build
docker compose -f bot-ts/docker-compose.yml logs -f
```

Dashboard/status:

- `http://localhost:8080/`
- `http://localhost:8080/api/status`
- `http://localhost:8080/stream`

## Teste local com Bun

```bash
cd bot-ts
bun install
bun run check
bun test
bun run start
```

Para execução local, os scripts DOM são encontrados automaticamente em `../bot`. No Docker, eles são copiados para `/app/runtime` e `BAIAK_RUNTIME_DIR` aponta para esse diretório.

## Paridade coberta

- autenticação/cookies/localStorage e perfil persistente do Chromium;
- watchdog/reconexão e presença via CDP;
- decode nativo dos frames MessagePack do WebSocket (`combatlog`, `log`, `notify`, `state/init/sync/player/snapshot`);
- contagem de kills/waves e estado de level/gold/stamina;
- loop de hunt e retomada da última hunt / `FORCE_HUNT`;
- treino automático por stamina;
- auto heal/potions;
- auto-sell nativo e threshold configurável;
- slots/recrutamento/promoção;
- bags, boss, equip, prey e extras via os mesmos scripts do Python;
- stream MJPEG e dashboard Bun.

A versão Python permanece intacta para teste A/B. Não considere a porta superior em performance até medir CPU/RAM/latência numa sessão real do jogo.
