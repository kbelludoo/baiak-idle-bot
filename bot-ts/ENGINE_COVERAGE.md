# Engine Coverage

Inventário da cobertura do cliente TS. `covered` significa que há leitura e ação; `partial` significa que há apenas leitura, heurística ou uma parte do fluxo; `missing` significa que ainda não há handler funcional.

## Runtime And Transport

| Área | Status | Evidência | Observação |
|---|---|---|---|
| Browser authentication | covered | `browser.ts`, cookies/localStorage | Token permanece local por perfil |
| WebSocket creation/close | covered | `browser.ts`, `Network.webSocket*` | Estado online acompanha abertura/fechamento |
| `ROOM_DATA` MessagePack | covered | `protocol.ts` | Decodifica tipos e payloads comuns |
| Frame catalog | covered | `protocol_mapper.ts` | Persiste tipos, bytes, paths e amostras limitadas |
| tRPC HTTP queries | partial | `syncAccountChars()` | Apenas `characters.list` está integrado |
| tRPC mutations | missing | nenhuma chamada direta no TS | Ações continuam pelo DOM |
| Turnstile/browser session | covered | Chromium real | Não há cliente socket puro |
| Reconnect after 522/JOIN_TIMEOUT | partial | `watchdog.ts` | Reintenta/recarrega, mas depende do origin `rt2` |

## Observed Server Messages

| Frame type | Status | Handler | Dados extraídos |
|---|---|---|---|
| `combatlog` | covered | `TelemetryStore`, `ProtocolMapper` | dano, vocação, elemento, alvo, crítico, fatal, kill, cura |
| `log` | covered | `TelemetryStore`, `ProtocolMapper` | waves, loot/log textual |
| `notify` | covered | `TelemetryStore`, `ProtocolMapper` | waves e eventos |
| `joined` | covered | `ProtocolMapper` | huntId, wave, group |
| `cping` | covered | catalogado | heartbeat/diagnóstico |
| `fx` | partial | catalogado | efeitos/magias; não usado para decisão |
| `procstats` | partial | catalogado + HUD | dano/estatísticas quando exposto |
| `autobossstate` | partial | `page_boss.js` | fluxo de boss ainda é DOM |
| `offlineInfo`/`offlineReport` | partial | scripts de modal | coleta/fechamento, sem modelo completo |
| `bpstatus` | partial | `page_extra.js` | leitura/ações de passe |
| `charms`/`charmstats` | partial | `page_extra.js` | ações DOM, sem fórmula de dano |
| `tacticsboards` | partial | `page_extra.js` | não alimenta o simulador |
| `features`/gates/config | partial | mapper | catalogados, decisões específicas ainda faltam |

## Gameplay Actions

| Ação | Status | Handler | Gatilho atual |
|---|---|---|---|
| Enter/resume hunt | covered | `page_hunt.js` | `HUNT_MODE`, `FORCE_HUNT`, profiler |
| Engine hunt simulation | covered | `hunt_sim.ts`, `hunts.ts` | TTK, XP/h, gold/h, canTank |
| Observed hunt calibration | covered | `protocol_mapper.ts` | XP/h, net gold/h, dano/s, kills |
| Controlled hunt exploration | partial | `exploration.ts` | política e score; rollback/playlist ainda em evolução |
| Auto-sell | covered | `MAIN_TICK`/action queue | ocupação + cooldown |
| HP/mana/heal helper | covered | `page_potion.js`, `page_spell.js` | estado crítico e configuração |
| Helper/spell setup | covered | `page_spell.js`, `helper_triggers.ts` | level/party/magic/HP/MP/dano; cooldown 10m |
| Auto-equip | covered | `page_equip.js` | fila, cooldown, itens superiores |
| Training | covered | `page_treino.js`, `state_machine.ts` | stamina 15%/85% |
| Party read | partial | HUD + DOM selectors | slots reais; HP/MP dependem da build |
| Party bench/activate | partial | `kernel.ts` | API DOM disponível, não usado automaticamente |
| Daily reward | covered | `MAIN_TICK` | badge/modal/coleta |
| Boss | partial | `page_boss.js` | scheduler existe, resultado depende DOM |
| Prey | partial | `page_prey.js` | scheduler/seleção básica |
| Bags/loot pouch | covered | `page_bags.js`, `page_extra.js` | transferência/configuração |
| Codex | partial | `page_extra.js` | entrega básica |
| Charms | partial | `page_extra.js` | ações, sem resistência/dano aplicado |
| Forge | partial | `page_extra.js` | fluxo DOM básico |
| Imbuement | partial | `page_extra.js` | fluxo DOM básico |
| Supply pouch | partial | `page_extra.js` | configuração/transferência |
| Market | partial | `page_extra.js` | compra deliberadamente bloqueada/scan |
| Auction | partial | `page_extra.js` | dry-run/live opcional |
| House/rent | partial | `page_extra.js` | fluxo DOM básico |
| Guild/tree/battle pass/boosts | partial | `page_extra.js` | scheduler existe, cobertura variável |

## Formula Coverage

| Fórmula | Status | Fonte |
|---|---|---|
| TTK | covered | `avgHp / effectiveDps` |
| Spawn/kills per hour | covered | `spawnMs`, `maxAlive`, AoE |
| XP/h theoretical | covered | `avgExp`, kills/h |
| Gold/h theoretical | covered | `goldKill`, priors |
| XP/h observed | covered | `protocol_map.scores` |
| Net gold/h observed | covered | `protocol_map.scores` |
| Damage per vocation/element/target | covered | `combatlog` mapper |
| Healing per vocation | covered | `combatlog` mapper |
| Incoming damage | partial | só quando o evento traz campos `taken/received/incoming` |
| Enemy resistance | partial | captura se payload expuser `resistances/resists/elements`; base atual não possui valores |
| Player defense/armor | missing | não foi observado campo confiável no payload atual |
| Wipe risk | partial | usa HP/sustain/`msToWipe` quando disponível |
| Calibrated effective DPS | partial | score observado já substitui XP/net gold; resistência ainda depende de payload |

## Next Engineering Targets

1. Correlacionar `joined` com o primeiro `hunt` para impedir mistura entre sessões antigas.
2. Promover `protocol_map.scores` ao `HuntProfiler` sem depender de arquivo stale.
3. Extrair HP/MP por slot de cada snapshot HUD e calcular dano recebido por minuto.
4. Capturar qualquer payload com `resistances`, `resists`, `armor` ou `defense` e tipá-lo.
5. Implementar playlist de exploração com amostra, limite de risco e rollback efetivo.
6. Criar handlers diretos para mutações tRPC somente depois que os paths forem confirmados no bundle/runtime.
