# Protocolo cliente -> servidor (extraído de index.js)

São **209 tipos distintos** de mensagem cliente -> servidor.
A fonte é o próprio bundle do jogo (`index.js`, ~4,5 MB), obtida por análise estática: varredura de todas as 271 ocorrências de `.send(` mais o rastreamento dos wrappers que repassam o tipo por variável (`rm`, `MS`, a closure `d` e o callback registrado por `Kje`).

| tipo | payload (chaves) | o que faz |
|---|---|---|
| `PING` | (sem payload) | Keepalive do transporte Colyseus: enviado a cada intervalMs pelo helper de keep-alive. |
| `PONG` | (sem payload) | Resposta ao "PING" cru do servidor no transporte WebSocket (`o==="PING"&&this.send("PONG")`). |
| `achinfo` | {} | Pede dados de conquistas (resposta em `onMessage("achinfo")`). |
| `altarforge` | {} | Inicia uma forja no Altar (resposta em `onMessage("altarresult")`). |
| `appearance` | {colors, lookType, addons, aura, mount} OU {slot, colors, lookType, addons, aura, mount} | Altera aparência/outfit; a variante com `slot` escolhe o personagem. |
| `arenaCancel` | {} | Sai da fila de matchmaking da arena. |
| `arenaChallenge` | {name: string} | Desafia um jogador pelo nome na arena PvP. |
| `arenaChallengeReply` | {challengeId, accept: boolean} | Aceita/recusa um desafio de arena. |
| `arenaQueue` | {} | Entra na fila de matchmaking da arena. |
| `aucshare` | {listingId} | Compartilha um anúncio de leilão no chat. |
| `autoboss` | {action} | Liga/desliga o auto-boss; actions vistas: "start", "sync". |
| `autobosslist` | {ids, preset} | Define a lista de bosses de um preset do auto-boss. |
| `autobosspreset` | {action, idx} | Gerencia presets do auto-boss; actions vistas: "select", "unlock". |
| `autobuysupply` | {cfg} | Config do auto-compra de supplies. |
| `autoorderrarity` | {on: boolean} | Liga/desliga ordenação automática por raridade. |
| `autorefill` | {names: string[]} | Lista de itens do auto-refill. |
| `autosellfull` | {on: boolean} | Liga/desliga auto-venda quando a bag enche. |
| `autosellpct` | {pct: number} | Percentual de gatilho da auto-venda. |
| `bagmove` | {hash, to} | Move um item da bag para outro destino. |
| `benchcfg` | {charId, patch} | Aplica patch de config do banco (personagens de apoio). |
| `benchequip` | {} | Pede os equipamentos do banco (resposta `onMessage("benchequip")`). |
| `boardsdebug` | {on: boolean, slot?} | Liga/desliga diagnóstico do tactics board; com `slot` faz polling a cada 1s. |
| `boss` | {bossId, fromCity: boolean} | Inicia uma luta de boss (da cidade ou não). |
| `bossloadout` | {slot, patch} | Aplica patch de loadout num slot de boss. |
| `bosspass` | (sem payload) | Abre/resgata o boss pass. |
| `bossslot` | {slot, bossId} | Atribui um boss a um slot do auto-boss. |
| `bphistory` | (sem payload) | Pede o histórico do battle pass (disparado por clique em botão do DOM). |
| `bpstatus` | (sem payload) | Pede o status do battle pass (ao abrir o modal / em timeout de 5s). |
| `buycart` | {items, token} | Compra o carrinho da loja. |
| `buydgcosmetic` | {id} | Compra um cosmético de dungeon. |
| `buyfloor` | {id} | Compra acesso a um andar da torre. |
| `buymercart` | {items} | Compra os itens do carrinho do mercador. |
| `buynickchange` | {nick} | Compra troca de nick. |
| `buypartyslot` | {} | Compra um slot extra de party. |
| `buyrename` | {slot, name} | Renomeia o personagem de um slot. |
| `buysexchange` | {slot} | Compra troca de sexo/gênero de um slot. |
| `buyslot` | {} | Compra um slot extra de personagem. |
| `challengeresp` | {token} | Responde a um desafio PvP com o token recebido. |
| `charmassign` | {id, monsterKey} | Atribui um charm a um monstro. |
| `charmbuy` | {id} | Compra um charm. |
| `charmreset` | {} | Reseta as atribuições de charm. |
| `charmunassign` | {id} | Remove a atribuição de um charm. |
| `chestmove` | {hash, to, idx, slot} OU {fromIdx, fromSlot, to:"bag"|"chest", idx, slot, name, count, src:"backpack"|"pouch"} | Move itens entre bag e baú (2ª forma = move genérico de container). |
| `chestorg` | {idx, mode} | Organiza o baú (modo de auto-sort). |
| `cityPos` | {tx, ty} | Reporta a posição em tiles do jogador na cidade (a cada ~1.5s). |
| `cityPresence` | {away: boolean} | Marca presença na cidade vs. ausente (entrar/sair, aba oculta, resume, teleporte). |
| `clean` | {ch: string} OU {} | Comando de staff /clean: limpa um canal específico ou todos. |
| `clearimbue` | {uid, slot, hash} | Remove o imbue de um item. |
| `codexauto` | {enabled, gear, pay, payTiers: [], targets: [], protectFrom, protectForge, protectImbue} | Salva a config do auto-codex. |
| `codexblock` | {names: string[]} | Lista de monstros bloqueados no codex. |
| `codexdeliver` | {id} | Entrega (turn-in) uma entrada do codex. |
| `codexpreview` | {id} | Pré-visualiza a recompensa do codex. |
| `codexunlock` | {id} | Desbloqueia uma entrada do codex. |
| `commmsg` | {text} | Envia mensagem no canal da comunidade. |
| `commsync` | (sem payload) | Pede resync do estado da comunidade após mutações tRPC. |
| `cpong` | {t} | Responde ao `cping` do servidor (latência). |
| `craftcollect` | {kind} | Coleta um craft concluído. |
| `craftstart` | {kind, step, hash} | Inicia um passo de craft. |
| `dailyclaim` | {} | Resgata a recompensa diária. |
| `dailystatus` | {} | Pede o status da recompensa diária. |
| `deathinfo` | {} | Pede o painel de informações de morte. |
| `decopick` | {seq} | Recolhe uma decoração da casa. |
| `decoplace` | {itemId, tx, ty} | Posiciona uma decoração num tile da casa. |
| `decorotate` | {seq} | Rotaciona uma decoração posicionada. |
| `destroy` | {uid, hash} | Destrói um item. |
| `destroymat` | {name, qty, from} | Destrói materiais. |
| `destroystore` | {uid, hash, password} | Destrói uma store (com senha). |
| `dgAuto` | {} | Liga/desliga o modo automático na sala de dungeon. |
| `dgEquip` | {uid, slot, where, hash} | Equipa item dentro da sala de dungeon. |
| `dgEquipMat` | {name, slot, where} | Equipa material dentro da dungeon. |
| `dgLeave` | {} | Sai da dungeon. |
| `dgResumeAsk` | {} | Pergunta se pode retomar uma dungeon interrompida. |
| `dgStart` | {} | Inicia a dungeon. |
| `dgUnequip` | {slot, where} | Desequipa item dentro da dungeon. |
| `dgcosmetics` | {} | Pede a lista de cosméticos de dungeon. |
| `equip` | {uid, to, slot, hash} | Equipa item da bag no slot. |
| `equipMat` | {name, to, slot} | Equipa um material. |
| `equipbag` | {hash, char} | Equipa a bag inteira num personagem. |
| `eventclaim` | {id} | Resgata recompensa de evento. |
| `eventgold` | {amount} | Ação de gold do evento. |
| `eventopen` | {} | Abre/pede dados do evento. |
| `expAuto` | {on: boolean} | Liga/desliga modo automático na expedição. |
| `expCreate` | {expeditionId, name, level, isPrivate, password, vocLimits} | Cria (e entra em) uma sala de expedição. |
| `expDisband` | {} | Desfaz a expedição. |
| `expEdit` | {name, level, vocLimits} | Edita a configuração da sala de expedição. |
| `expEnter` | {roomId} | Entra numa sala de expedição. |
| `expInvite` | {name} | Convida um jogador para a expedição. |
| `expKick` | {charId} | Expulsa um membro da expedição. |
| `expLeave` | {} | Sai da expedição. |
| `expReady` | {} | Marca pronto na expedição. |
| `expRooms` | {search, page, fitMe, vocs: [], minLevel, maxLevel} | Lista/busca salas de expedição. |
| `expStart` | {} | Inicia a expedição. |
| `extreport` | {ext: string} | Reporta periodicamente o token de "ext" do cliente. |
| `falconforge` | {shield} | Forja do Falcão com opção de shield. |
| `flashoffer:buy` | {key} | Compra uma flash offer. |
| `flashoffer:reject` | {key, surface} | Recusa uma flash offer. |
| `flashoffer:shown` | {key} | Marca a flash offer como exibida. |
| `flashoffers` | {} | Pede as flash offers disponíveis. |
| `floors` | {} | Pede dados/andares possuídos da torre. |
| `forgestep` | {uid, kind, until, attrId, target} | Passo de forja de atributo em um item. |
| `forgetierauto` | {kind, on: boolean} | Liga/desliga auto forge tier. |
| `forgetierconv` | {kind} | Converte forge tier. |
| `forgetierfuse` | {first, second, core, safe, conv} | Funde dois forge tiers. |
| `forgetierstate` | {} | Pede o estado do forge tier. |
| `forgetiertransfer` | {donor, receiver, conv} | Transfere forge tier entre itens. |
| `gmcmd` | {cmd: string, arg?: string} | Canal genérico de comandos de GM/staff. cmds distintos: addvip, banok, banpreview, bansearch, blockarena, broadcastping, coin, dust, expe, grantok, info, infoedit, infohist, item, pos, resetboss, resetbosspass, save, unbanlist, unbanok, unblockarena, uptime. |
| `goldinboxclaim` | {} | Resgata gold do inbox. |
| `guildBoss` | {fromCity} | Inicia o boss de guilda. |
| `guildmsg` | {text} | Envia mensagem no chat da guilda. |
| `guildsync` | (sem payload) | Pede resync do estado da guilda após mutações tRPC. |
| `guildtaskflush` | {} | Dá flush nas tarefas da guilda. |
| `guildvault` | {amount} | Deposita no cofre da guilda. |
| `guildwaratk` | {warId, defenderAccountId} | Ataca um defensor na guerra de guildas. |
| `helper` | {slot, cfg} | Config do helper (auto-suporte) de um slot. |
| `housedecobuy` | {itemId, qty} | Compra decoração de casa. |
| `housedecoinfo` | {} | Pede o inventário de decoração. |
| `houseguest` | {add: string} | Convida um guest para a casa. |
| `househome` | {houseId} | Define/teleporta para a casa. |
| `houseinfo` | {} | Pede informações da casa. |
| `houseleave` | {} | Sai da casa. |
| `houserent` | {months} | Paga aluguel por N meses. |
| `houserepair` | {houseId, slot} | Repara a casa. |
| `houseskin` | {skinId} | Aplica skin na casa. |
| `houseupgrade` | {houseId, slot} | Melhora a casa. |
| `ignadd` | {name} | Adiciona jogador à lista de ignorados. |
| `igndel` | {playerId} | Remove da lista de ignorados. |
| `ignlist` | {} | Pede a lista de ignorados. |
| `imbue` | {uid, slot, id, tier, auto, hash} | Aplica imbue num item. |
| `imbueauto` | {uid, slot, on, hash} | Liga/desliga auto-imbue de um item. |
| `inboxtake` | {name, count} | Retira itens do inbox. |
| `inboxtakeall` | {} | Retira tudo do inbox. |
| `leaveearly` | (sem payload) | Sai mais cedo da dungeon/hunt (sala `Gr`). |
| `loop` | {hunts: string[]} | Configura a lista de hunts do loop. |
| `lootdest` | {dest} | Define o destino do loot. |
| `lootskip` | {names: string[]} | Lista de itens ignorados no loot. |
| `matmove` | {name, to, qty} | Move materiais. |
| `mode` | {mode} | Troca o modo de jogo (ex.: "testdmg", "city"). |
| `move` | {dx, dy} OU objeto de clique no mapa {tx, ty, sx, sy, ...} | Movimento na sala atual: passo direcional ou destino por tile clicado. |
| `msg` | {channel, text} | Envia mensagem de chat num canal específico. |
| `mute` | {name, ch, mins} | Silencia um jogador num canal por N minutos (staff). |
| `nosellitems` | {names: string[]} | Itens que nunca devem ser vendidos. |
| `offlineinfo` | (sem payload) | Pede informações de progresso offline. |
| `offlinemode` | {mode, huntId} | Define o modo/hunt offline. |
| `panelsmin` | {panels} | Sincroniza o estado de painéis minimizados (UI). |
| `partyChar` | {characterId} | Define o personagem na party. |
| `partyInvite` | {name} | Convida para a party. |
| `partyInviteCancel` | {inviteId} | Cancela um convite de party. |
| `partyInviteReply` | {inviteId, accept} | Aceita/recusa convite de party. |
| `partyKick` | {accountId} | Expulsa membro da party. |
| `partyLeader` | {accountId} | Define o líder da party. |
| `partyLeave` | {} | Sai da party. |
| `partyPolicy` | {onMemberFall: "wait"|"city"|"continue"} OU {onLeaderFall: "dissolve"|"transfer"} | Política da party quando membro/líder cai. |
| `partyWeight` | {accountId, weight} | Define o peso (loot share) de um membro. |
| `partypending` | {} | Pede convites de party pendentes. |
| `pm` | {to, text} | Envia mensagem privada. |
| `potion` | {slot, kind, name, below} | Configuração de poções de um slot. |
| `potmove` | {name, to} | Move poções. |
| `prey` | {slot, action, monsterKey} | Sistema de prey: seleciona/troca o monstro do slot. |
| `profile` | {} OU {name} | Pede o perfil de um jogador (ou o próprio). |
| `promote` | {slot} | Promove um personagem (ex.: a líder/principal). |
| `protectboss` | {on: boolean} | Protege loot de boss. |
| `protectclasses` | {classes} | Classes protegidas na auto-venda. |
| `protecttiers` | {tiers} | Tiers protegidos na auto-venda. |
| `pvploadout` | {slot, patch} | Aplica patch de loadout de PvP. |
| `ready` | {} | Handshake de pronto após entrar na sala de hunt. |
| `recharge` | {hash} | Recarrega um consumível usando gold. |
| `report` | {id, reason, comment} | Denuncia uma mensagem de chat. |
| `reroll` | {uid, locked} | Rerolla atributos de um item. |
| `rerollstep` | {uid, locked, targets, mode, autoLock} | Passo do reroll de atributos. |
| `resetstats` | {panel} | Reseta a distribuição de stats de um painel. |
| `resetsupply` | {} | Reseta a configuração de supplies. |
| `reward` | {action, bag, ...extras} | Ações de recompensa/baú (payload montado pela UI, chaves extras variáveis). |
| `rotation` | {slot, spells} | Define a rotação de magias da action bar. |
| `say` | {text} | Fala no canal/sala atual. |
| `sellall` | {protected} | Vende tudo respeitando a lista de protegidos. |
| `sellreward` | {} | Vende os itens de recompensa. |
| `setleader` | {charId} | Define o personagem principal/líder. |
| `sharebuild` | {hash} | Compartilha um build no chat. |
| `shareresolve` | {token} | Resolve um token de build compartilhado. |
| `spellminmobs` | {slot, words, minMobs} | Mínimo de mobs para usar determinada magia. |
| `stage` | {huntId} | Seleciona/inicia um estágio de hunt. |
| `supplyflag` | {names: string[]} | Itens marcados como supply. |
| `supplymove` | {name, from, to, qty} | Move supplies entre containers. |
| `tacticsboard` | {kind, slot, board} | Configura o tactics board. |
| `testdmg` | {act: "enter"|"reset"|"report"|"exit"|"run"|"atk"|"slot"|"dummies", ...} | Modo de teste de dano (overlay de dev). |
| `tocity` | {} | Volta para a cidade. |
| `tree` | {slot, action, nodeId, code} | Ação na árvore de talentos. |
| `turn` | {dir} | Vira/olha para uma direção. |
| `tutreward` | {} | Resgata recompensa de tutorial. |
| `unequip` | {from, slot} | Desequipa um item. |
| `unmute` | {name, ch} | Remove o silenciamento de um jogador num canal. |
| `upgrade` | {uid, kind, attrId} | Melhora um atributo de item. |
| `useitem` | {name, from, hash} OU {name, from, all: true} | Usa um item (individual ou todos). |
| `usepotion` | {name, from, count} | Usa poção. |
| `vault` | {idx, amount, dir} | Deposita/retira do vault. |
| `vipadd` | {name} | Adiciona jogador à VIP list. |
| `vipdel` | {playerId} | Remove jogador da VIP list. |
| `vipfav` | {playerId, favorite: boolean} | Favorita/desfavorita um VIP. |
| `viplist` | {} | Pede a VIP list (o wrapper `rm` envia `{}` por padrão). |
| `visibility` | {hidden: document.hidden} | Reporta mudança de visibilidade da aba. |
| `who` | {} | Pede a lista de quem está online. |
| `wzCreate` | {name} | Cria (e entra em) uma sala "wz" (world boss/arena). |
| `wzEnter` | {roomId} | Entra numa sala wz. |
| `wzKick` | {charId} | Expulsa um membro da sala wz. |
| `wzLeave` | (sem payload) | Sai da sala wz. |
| `wzReady` | (sem payload) | Marca pronto na sala wz. |
| `wzRooms` | {search, page} | Lista/busca salas wz. |
| `wzStart` | (sem payload) | Inicia a sala wz. |
| `wzloadout` | {patch} | Aplica patch de loadout na sala wz. |

## Tipos em mais de um lugar com payloads diferentes

- `move` (8 sites): `{dx,dy}` no movimento direcional e o objeto cru do clique no canvas `{tx,ty,sx,sy,...}` — dependendo da sala ativa vai para `oi`, `Bn`, `li.current()` ou `yn.current()`.
- `appearance` (2): `{colors,lookType,addons,aura,mount}` (sem slot) e `{slot,colors,lookType,addons,aura,mount}`.
- `chestmove` (2+): `{hash,to,idx,slot}` e o move genérico `{fromIdx,fromSlot,to,idx,slot} / {name,count,src,to,idx,slot}`.
- `gmcmd` (23 sites): `{cmd}` sem arg (uptime, pos, save, dust, resetbosspass, unbanlist) vs `{cmd,arg}` com arg string/JSON (item, coin, addvip, banok, infoedit...).
- `useitem` (2): `{name,from,hash}` vs `{name,from,all:true}`.
- `clean` (2): `{ch}` (canal) vs `{}` (tudo).
- `testdmg`: `{act:"enter"}` na troca de modo e `{act:"reset"|"report"|"exit"|"run"|"atk"|"slot"|"dummies", ...}` no overlay.
- `partyPolicy`: `{onMemberFall}` ou `{onLeaderFall}` (mutuamente exclusivos).
- `cityPresence` (15 sites), `commsync` (5), `guildsync` (3), `bpstatus` (3), `viplist` (3), `floors`/`forgetierstate`/`ready`/`say`/`pm`/`turn`/`mute`/`pvploadout`/`wzLeave` (2 cada): mesma forma, só variam valores/contexto.

## Mensagens que dependem de UI/DOM

Vários payloads não são construídos por lógica de jogo, e sim lidos de inputs/modais — um bot headless precisa montar o objeto na mão:

- `clean, mute, unmute, report, say, pm, msg, guildmsg, commmsg, who, ignadd, igndel, ignlist, vipadd, vipdel, vipfav, sharebuild, shareresolve, aucshare, profile` — todos disparados por campos/botões do chat (`W.room`, a sala Colyseus `"chat"`).
- `expCreate, expEdit, wzCreate` — payload vem de formulários (name/level/password/vocLimits).
- `partyPolicy, codexauto, loop, autorefill, autobuysupply, lootskip, nosellitems, supplyflag, rotation, helper, potion, tacticsboard, spellminmobs, benchcfg, bossloadout, pvploadout, wzloadout, reward` — objetos de configuração montados por painéis (patch/config assíncronos).
- `bpstatus, bphistory` — os únicos senders são botões do modal de battle pass; a função é registrada por setter e chamada de listeners do DOM.
- `boardsdebug, testdmg` — overlays de dev; `testdmg` ainda depende de estado do overlay.
- `flashoffer:shown/reject/buy`, `decopick/decoplace/decorotate`, `tree`, `forgestep/rerollstep/reroll/imbue/upgrade`, `guildwaratk`, `arenaChallengeReply`, `challengeresp`, `partyInviteReply` — carregam `key`/`seq`/`token`/`hash`/`warId`/`challengeId` que vêm do state do servidor (anti-tamper); sem esses valores o servidor tende a rejeitar.

## Contexto útil para um bot headless

- Salas Colyseus: `"chat"` (`W.room`, é a sala de chat/social — nela trafegam say/pm/guild/vip/ignore/mute/report/share*), `"hunt"`, `"partyhunt"`, `"queue"` (matchmaking de arena) e salas dinâmicas via `joinById(roomId,{token})` (dungeon `dg*`, expedição `exp*`, world boss `wz*`, `pvp*/arena*`).
- Opções de join observadas: `{token: <auth>, characterId, fp, ext, shard: |characterId|%16, disabled}` — `fp`/`ext` são gerados no cliente (`ad()`, `gu()`), então o bot precisa replicá-los.
- Além do WebSocket, o cliente fala **tRPC em `/api/trpc`** (guild/community/broadcasts/auction). Várias ações fazem mutação tRPC **e depois** enviam `guildsync`/`commsync` pela sala de chat — ou seja, algumas features exigem HTTP, não só socket.
- `PING`/`PONG` são keepalive do transporte Colyseus, não mensagens de jogo.

## Prioridade para o driver terminal

**(a) Seguro e idempotente** — `helper, potion, rotation, spellminmobs, autosellfull, autosellpct, nosellitems, protecttiers, reward, dailyclaim, inboxtakeall, offlinemode, loop, prey, autoboss`

São mensagens de configuração/estado desejado: reenviar o mesmo payload é inofensivo, o servidor apenas regrava a preferência, e nenhuma delas depende de ler o state antes de montar o objeto.

**(b) Exige leitura de estado antes** — `equip, sellall, codexdeliver, tree, forgestep, imbue, reroll`

O payload carrega `uid`/`hash`/`code`/`nodeId`/índices que só existem no state do servidor, então o driver precisa observar a sala (ou o snapshot) antes de enviar, sob pena de operar no item/entrada errada ou ser rejeitado.

**(c) Depende de token/estado do servidor ou de payload de UI** — `challengeresp, arenaChallengeReply, partyInviteReply, decopick, say, pm, msg`

São dirigidas por evento (`token`/`challengeId`/`inviteId`/`seq` chegam do servidor e expiram) ou por texto livre do usuário, e várias só têm sender amarrado a um listener do DOM — o bot tem de capturar o evento e montar o payload manualmente para responder.
