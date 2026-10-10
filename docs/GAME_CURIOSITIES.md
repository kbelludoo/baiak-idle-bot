# GAME_CURIOSITIES — Baiak Idle (caça ao \`index.js\`)

> **Alvo:** \`C:\Users\kbell\Downloads\baiak-idle-bot-main\index.js\` — 4.529.213 bytes, 2.363 linhas (minificado).
> **Método:** somente leitura; busca por substring + leitura de contexto. Nada do bundle foi executado.
> **Como citar:** \`L<linha> @<offset em bytes>\`. As linhas 2, 5, 15, 25, 46, 569, 741–743, 808–812, 1914, 1992/1993, 2301, 2310, 2359 e 2362 concentram quase tudo.
> **Aviso:** este bundle é o **cliente**. Ele **carrega e obedece** às flags de anti-cheat/durabilidade/reconciliação, mas **a regra do servidor não está aqui**. Onde só existe o nome da flag, está marcado como *não encontrado (lado servidor)*.

---

## 1. Painel / ferramentas de ADMIN ou GM

### 1.1 Lista de comandos por cargo (a própria UI entrega)
A tabela \`_Ne\` (\`L569 @2917088\`, 2.532 bytes) é a fonte de verdade: cada comando tem \`usage\`, \`desc\` e \`minGroup\`. Grupos: **1 = jogador, 2 = GM, 3 = CM** (\`ZN=2\` em \`L15 @1878863\`; \`accountGroup\` chega na mensagem \`joined\`, \`L2359 @4476930\`).

**Geral (minGroup 1)**
- \`/pm <nome> <msg>\` — privado (alias \`/w\`).
- \`/commands\` — mostra a lista (\`function PNe()\`).
- \`/profile [nome]\` — abre o perfil (seu ou de outro).
- \`/uptime\` — tempo no ar desde o último restart; **staff vê o detalhe da frota**.

**Staff (GM+, minGroup 2)**
- \`/pos\` — sua posição (x, y, z) e o mapa carregado.
- \`/i <id|nome>[, qtd[, tier]]\` — cria o item e manda pra backpack; **o 3º valor é o tier da forja (0-10, só em equipamento)**.
- \`/dust\` — enche o pó da forja até o teto atual da conta (teste da Forja de Tier) e dispara \`forgetierstate\`.
- \`/info <nome>\` — abre a ficha do jogador; **editar exige CM+**.
- \`/expe [mapa | auto]\` — painel da expedição **do dia**; com nome do mapa troca direto, \`auto\` volta ao sorteio.
- \`/expe <jogador>, <nível>\` — **(minGroup 3)** põe a escada da expedição do jogador nesse degrau em **todos** os mapas (cada um até o próprio teto).
- \`/resetbosspass\` — zera o uso diário de Boss Pass de **todas** as contas.
- \`/resetboss <all | all, jogador | boss, jogador>\` — zera o tempo de boss (cd global + por-boss).
- \`/blockarena <jogador> [horas]\` — bloqueia a Arena PvP (sem horas = permanente).
- \`/unblockarena <jogador>\` — libera o bloqueio.
- \`/ban [busca]\` — janela para banir conta (ou conta+IP+device).
- \`/b\` — janela para publicar anúncio/divulgação (FAB).
- \`/unban\` — lista bans ativos numa popup com busca para revogar.
- \`/mute <nome> [min]\` / \`/unmute <nome>\` — mute no **canal público ativo**.
- \`/clean [canal]\` — limpa o histórico de **todos** os canais públicos para todos; com canal, só ele.
- \`/save\` — flush no banco da sessão de todos os online, **sem derrubar ninguém**.

**CM+ (minGroup 3)**
- \`/coin <all|jogador>, <qtd>\` — entrega Event Coin (**confirma num modal**).
- \`/addvip <all|jogador>, <dias>\` — entrega dias de VIP (**confirma num modal**).

### 1.2 Os comandos de rede realmente enviados (\`gmcmd\`)
Handler dos slash-commands em \`L2359 @4488672\`; envios \`l.send("gmcmd",{cmd:...})\`:
\`uptime\`, \`pos\`, \`item\`, \`dust\`, \`save\`, \`info\`, \`infoedit\`, \`infohist\`, \`expe\`, \`grantok\`, \`addvip\`, \`coin\`, \`resetbosspass\`, \`resetboss\`, \`blockarena\`, \`unblockarena\`, \`bansearch\`, \`banpreview\`, \`banok\`, \`unbanlist\`, \`broadcastping\`.
- \`staffinfo\` → abre o editor de ficha; ao salvar manda \`infoedit {token, patch}\`; histórico manda \`infohist {token, kind, cursor}\` (\`@4484603\`).
- \`grantconfirm\` → modal de confirmação que devolve \`grantok\` (\`@4484522\`).
- \`expemaps\` → painel de expedições que devolve \`expe\` (\`@4484400\`); \`gmreply\` imprime o texto do GM (\`@4484400\`).
- \`banlist\`/\`unbanok\` — revogação em massa por popup (\`@4489750+\`).

### 1.3 Gating de staff
- \`ZN = 2\` é o limiar (\`L15 @1878863\`); \`K1e=(e=1)=>e>=ZN\`.
- **Furo curioso:** \`/uptime\` é respondido **antes** do \`if((m.accountGroup??1)<ZN) return !1\` — **qualquer jogador consegue emitir o gmcmd \`uptime\`** (\`L2359 @4488680\`).
- \`mue=()=>(m.accountGroup??1)>=2\` é o gate de vários extras (ex.: aba "Containers" nas configs, \`L743 @3438438\`).
- Hash do item só aparece no tooltip para \`accountGroup>=2\` (\`L294 @2650252\`).
- Botão de teste **"+10.000 pontos (teste)"** no painel de Guild War quando \`accountGroup>=2\` (\`L1914 @3847249\`).

### 1.4 Estado de painel admin "morto"
\`adminOpen\`, \`adminWired\`, \`adminCat\`, \`adminEditing\`, \`adminMsg\`, \`adminDraft\`, \`adminTab:"store"\`, \`adminStages\`, \`storeCatalog\`, \`partySlotPrices\`, \`monsterMult\` existem **só** na store de UI (\`L46 @2326446\`) e **não têm nenhuma UI/render no bundle** — resquício de um painel admin in-game que não foi embarcado.

### 1.5 Tabelas de painel do site (nomes de ações perigosas)
Em \`L15 @1927508\` há o catálogo de painéis com \`tables\` e \`danger\`:
- \`whitelist\` — "Whitelist anti-multibox": contas isentas do limite de **1 conta por IP/dispositivo** (\`mc_whitelist\`).
- \`logs\` — \`audit_log\`, \`admin_grant_log\`, \`staff_edit_log\`, \`item_log\`, \`item_metrics_daily\`, \`boss_drop_log\`, \`boss_refund_log\`, \`boss_exit_log\`, \`log_reward_bag_opens\`, \`log_casket_opens\`.
- \`gameconfig\` — **\`danger:!0\`**: "APAGA o que você configurou no painel: catálogo da loja, preços de consumíveis, rates de exp/skill/ml, overrides de hunts, chances de drop e runtime".

---

## 2. Anti-cheat / antifraude

### 2.1 Presença humana obrigatória (o "antibot" de ação)
\`L46 @2306013\` em diante:
- \`Pke(5000)\` = janela de **5 s**; \`EJ.note()\` só aceita \`event.isTrusted === true\` de \`pointerdown\`, \`keydown\`, \`touchstart\` e \`pointermove\` (**throttle de 500 ms**).
- \`Bke()\` → se \`enforce\` e **não** for ação de sistema e **não** houver presença → **barra**. \`$ke()\` → modo observação: só conta e avisa.
- \`function At(e,t,a){zke(e,a?.system===!0,t)}\` (\`L46 @2307276\`) envolve os envios.
- **35 ações gate** (\`At("...")\`, todas em \`L2359\`): \`upgrade\`, \`reroll\`, \`imbue\`, \`charmbuy\`, \`charmassign\`, \`charmunassign\`, \`charmreset\`, \`craftstart\`, \`craftcollect\`, \`altarforge\`, \`falconforge\`, \`forgetierfuse\`, \`forgetiertransfer\`, \`forgetierconv\`, \`prey\`, \`buyslot\`, \`sellall\`, \`goldinboxclaim\`, \`reward\`, \`boss\`, \`guildBoss\`, \`bosspass\`, \`autoboss\`, \`autobosslist\`, \`protecttiers\`, \`protectclasses\`, \`protectboss\`, \`lootskip\`, \`nosellitems\`, \`sellreward\`, \`buycart\`, \`buyfloor\`, \`buydgcosmetic\`, \`buymercart\`, \`dailyclaim\`, \`flashofferbuy\`.
- **NÃO são gate:** equipar/desequipar, \`rotation\`, \`helper\`, \`potion\`, \`stage\`, \`tacticsboard\`, \`mode\`, \`spellminmobs\`, \`benchcfg\`, \`promote\`.

### 2.2 Consequência de falhar
- \`Dke(barrado)\` incrementa \`antibot_blocked_count\` ou \`antibot_wouldblock_count\` no \`localStorage\` e solta \`console.warn\`: \`[antibot] ação "<x>" BARRADA|seria barrada (observação) — sem presença humana recente\`.
- Com \`antibot_presence_enforce\` desligado a ação **passa mesmo assim** (modo observação).

### 2.3 Honeypot de DOM
\`L46 @2307464\`: botão injetado \`id="sell-all-now"\`, texto **"Vender tudo"**, \`display:none\`, \`aria-hidden\`, \`tabIndex=-1\`. Clique nele → incrementa \`antibot_honeypot_hits\` e \`console.warn("[antibot] honeypot clicado — automação de DOM provável")\`.

### 2.4 Desafio (challenge) com Cloudflare Turnstile
\`L46 @2310310\`:
- \`challenge\` (servidor) → modal **"Confirme que você é humano para continuar"** / **"Verificação automática rápida — o jogo continua normalmente."**
- Usa \`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit\`, \`theme:"dark"\`, \`language:"pt-br"\`, sitekey na const \`XX\`.
- \`challengeresult {ok}\` fecha; sucesso escreve **"Liberado! Continuando..."**; falha de carregamento sugere desativar bloqueador de anúncios.
- Flags: \`antibot_challenge_enforce\`, \`antibot_challenge_expire\`.

### 2.5 Fingerprint de ambiente/extensões ("ext")
\`L46 @2307631–2309400\`:
- **Nativo:** compara \`Function.prototype.toString\` com \`/\[native code\]/\` em \`WebSocket\` / \`WebSocket.prototype.send\`, \`fetch\`, \`XMLHttpRequest.open/send\`, \`CanvasRenderingContext2D.drawImage/getImageData\`, \`HTMLCanvasElement.getContext\`, \`requestAnimationFrame\`, \`EventTarget.prototype.addEventListener\` e no próprio \`toString\`.
  Marcadores: \`p:ws.ctor\`, \`p:ws.send\`, \`p:fetch\`, \`p:xhr.open\`, \`p:xhr.send\`, \`p:canvas.ctx\`, \`p:canvas.draw\`, \`p:canvas.data\`, \`p:raf\`, \`p:evt.add\`, \`s:tostring\`.
- **Globals:** \`GM_info\`, \`GM_xmlhttpRequest\`, \`GM_setValue\`, \`unsafeWindow\` → \`g:gm\`.
- **Automação:** \`_phantom\`, \`__nightmare\`, \`callPhantom\`, \`__selenium_unwrapped\`, \`__webdriver_evaluate\`, \`__driver_evaluate\`, \`domAutomation\`, \`_Selenium_IDE_Recorder\`, \`__playwright\`, \`__pwInitScripts\`, \`__puppeteer\`, \`__PW_inspect\` → \`g:automation\`; \`navigator.webdriver===true\` → \`s:webdriver\`; \`/headless/i\` no UA → \`g:automation\`.
- **Extensões:** \`chrome-extension://\` (até **8**, \`Gke=8\`) e \`moz-extension://\` → \`x:moz\` / \`x:<32 hex>\`. Varredura inicial + \`MutationObserver\` (desliga em 30 s) + varredura a cada **60 s**.
- **Formato/limite:** regex \`^[a-z]:[a-z0-9._-]{1,40}$\`, dedup, sort, **máx. 24 itens** (\`qK=24\`), validado em \`x3e()\`.
- **Envio:** a cada **60 s** (\`setInterval(...,6e4)\`) manda \`extreport {ext}\` **somente se mudou** (dirty flag + \`Xke()\`) — \`L2359 @4488369\`.

### 2.6 Bloqueios de entrada (o que o servidor devolve e a tela mostra)
\`L2362 @4508978\`:
- \`EXT_BLOCK\` → overlay **"EXTENSÃO NÃO PERMITIDA"**.
- \`IP_LIMIT_VPN\` → **"CONEXÃO VIA VPN OU PROXY"**.
- \`IP_LIMIT\` → **"LIMITE DE CONTAS SIMULTÂNEAS"** ("só é permitido uma por vez", com botão "Ir para o site" para desconectar a sessão).
- \`MAINTENANCE\` → overlay de manutenção; \`BANIDO:\` → overlay **"BANIDO"**.

### 2.7 Catálogo completo de flags (nomes internos)
\`JN\` em \`L15 @1876570\` — **82 flags**. As de interesse antifraude/fraude:
\`cpf_check\`, \`market_require_cpf\`, \`block_ip\`, \`block_vpn\`, \`block_ext\`, \`antibot_presence_enforce\`, \`antibot_challenge_enforce\`, \`antibot_action_rate\`, \`antibot_challenge_expire\`, \`log_error\`, \`log_warn\`, \`log_info\`, \`durability_reconnect\`, \`durability_boss_ledger\`, \`durability_strict_owner\`, \`durability_grant_outbox\`, \`item_fullsync\`, \`item_reconcile\`, \`seller_reputation\`, \`push_verify\`, \`marketplace\`, \`auction_market\`, \`auction_stacks\`, \`account_recovery\`, \`account_deletion\`.
**A lógica de \`durability_*\`, \`item_fullsync\` e \`item_reconcile\` NÃO está no bundle → não encontrado (lado servidor).** O cliente só recebe \`features\` e obedece.

### 2.8 Quirk relevante: staff joga com o anticheat "desarmado"
\`function J1e(e,t=1)\` (\`L15 @1879260\`): se \`grupo >= 2\`, o cliente **reescreve as flags**:
- \`marketplace\` → sempre \`false\` (\`Tk\`);
- as 18 flags de \`X1e\` (\`aura\`, \`mount\`, \`market_require_cpf\`, \`block_ip/vpn/ext\`, os 4 \`antibot_*\`, \`cpf_check\`, \`log_*\`, os 4 \`durability_*\`, \`item_fullsync\`, \`item_reconcile\`) **não são forçadas a \`true\`**;
- **todas as outras** são forçadas a \`true\`.
Ou seja: para staff, o cliente **desliga localmente** presença humana, captcha, durabilidade e logs.

### 2.9 Tráfego contínuo
- \`cping\`/\`cpong\` — keepalive com timestamp.
- \`extreport\` — a cada 60 s (só quando muda).
- \`Sot()\` renova o timestamp do token de reconexão no \`sessionStorage\`.

---

## 3. Overlays de desenvolvimento / só-staff

### 3.1 \`testdmg\` — "Teste de Dano"
\`L1992 @4086295\` (overlay) e \`L1993 @4094806\` (relatório).
- Só aparece se \`(m.lastMode==="testdmg" || m.testDmg.on) && Ts()\`; e \`testdmg.allowed\` vem do servidor (\`testdmgstate\`).
- Ancorado em \`#hud-topright\` (ou \`top:150px;right:8px\`).
- **Dummies por tile:** 1 / 5 / 10 / até **20** (\`dummiesMax:20\`); o tooltip avisa *"N boneco(s) empilhado(s) no mesmo sqm — magia de área acerta todos"*.
- **Durações fixas:** **15 s, 30 s, 45 s, 60 s** (\`SKe=[15e3,3e4,45e3,6e4]\`); a janela fechada é o que se compara.
- **Modos (\`qKe\`):** \`Tudo\` (rotação + ataque base), \`Só base\` (só a arma), \`Só magia\` (só a action bar).
- **"Quem ataca"** lista os personagens da party, com toggle por slot (\`off[]\`).
- Texto de ajuda: **"Action bar, party e equipamento valem na hora — mexa e o número muda no mesmo tick. HP e mana ficam cheios e o boneco nunca morre."**
- Botões: **Zerar** / **Dados** (tabela copiável) / **Sair**. Mostra dano/s, total na janela e barra de tempo.
- **Só roda em sessão solo:** em party o botão fica desabilitado com "O teste de dano roda na sessão solo — saia da party para abrir."
- Entrada por teleporte: \`send("testdmg",{act:"enter"})\`; ações \`reset|report|exit|dummies|run\`.
- Estado (\`L2359 @4476385\`): \`allowed, on, atk, off[], runLeft, runTotal, runDone, dummies, dummiesMax\`.

### 3.2 \`boardsdebug\` — "🔍 Diagnóstico da prancha (equipe)"
\`L1993 @4100025\` (conteúdo) e \`@4101719\` (chip).
- Gate: \`(m.accountGroup??1) >= 2\` **e** \`boardsDiagOpen\`.
- Chip flutuante \`🔍\` com título **"Diagnóstico da prancha (equipe)"**; pede o retrato ao servidor (\`send("boardsdebug",{on,slot})\`) e atualiza **a cada 1 s**.
- Mostra: personagem (voc, slot, posição), coleção (caçada/boss, nº de pranchas, feature on/off), **prancha ativa + confiança (%) + "espelhada — a party volta pro oeste" / "como desenhada"**, tile alvo, tiles em "Nunca aqui", **"Não aplicou porque"** (motivo do skip) e **"Cadeia testada, na ordem"**.
- É literalmente um debug do motivo de a IA de posicionamento não ter aplicado a tática.

### 3.3 Outros itens só de staff/dev
- **Aura "ADM"** — \`{id:84, effectId:747, offX:8, offY:10, onTop:!0}\`, **fora da lista da loja**. Existe também outfit \`ADM\` (male 2705 / female 2703).
- \`accountGroup>=2\` libera a aba **Containers** nas configurações (\`L743 @3438438\`).
- O estado \`adminOpen\`/\`adminCat\`/... é morto (ver §1.4).

---

## 4. Easter eggs, piadas e nomes internos

- **A pegadinha do \`!reward\`** (a melhor): a mensagem \`chatjoke\` (\`L569 @2926518\`) faz o chat levar um timeout de verdade e mostra um modal:
  - título: **"Você levou um timeout de {n} segundos!"** (\`L2 @22646\`);
  - corpo: **"Aqui não tem “!reward”. Relaxa, é brincadeira — o chat volta sozinho quando zerar."** (\`L2 @22724\`);
  - toast: **"Timeout de {time} — aqui não tem “!reward”. Foi de brincadeira."**;
  - botão **"Entendi"**, contador regressivo no modal, timeout padrão **5 s** (\`D2e=5e3\`, \`L15 @1889253\`).
- **Formatação brasileiríssima de números:** \`1e6 → "kk"\`, \`1e9 → "kkk"\` (\`L741 @3323200\`, \`L808 @3520933\`). \`15e9\` aparece como "15kkk".
- **Notas de dev dentro do filtro de apelido** (\`L15 @1930046\`, campo \`note\`), provando que alguém pensou caso a caso:
  - \`term:"god", mode:"exact", note:"como 'contém' mataria Godric"\`
  - \`term:"mod", mode:"exact", note:"staff — como 'contém' mataria Modric"\`
  - \`term:"bot", mode:"exact", note:"como 'contém' mataria Robot"\`
  - \`term:"cu",  mode:"exact", note:"como 'contém' mataria Cunha"\`
  - \`term:"baiakidle"/"ownerbaiak" → note:"marca do servidor"\`.
- **Honeypot invisível com o texto "Vender tudo"** (\`L46 @2307464\`).
- **Consolo no relatório offline:** *"Nenhuma skill subiu de nível — mas os tries acumulados foram guardados."*
- **Item com tratamento único:** \`Vge = new Set(["ferumbras' hat"])\` — tem caminho de proteção próprio ("trophy").
- **Outfits curiosos fora da loja:** \`Steve\`, \`Beta Defender\`, \`Quiverhorn\`, \`ADM\`, \`Clown\`, \`Grim Reaper\` (\`L15 @1250037+\`).
- **Console.warn em português** no meio de um bundle inglês: \`[antibot] challenge: falha ao montar o captcha\`, \`[antibot] honeypot clicado — automação de DOM provável\`.
- **Nome do arquivo de token de reconexão:** \`"rc_hunt_v1"\` (\`L2359 @4495938\`).

---

## 5. Números e limites curiosos

### 5.1 Loja em Coins — catálogo completo embutido como JSON
\`mye=JSON.parse(\`...\`)\` em \`L15 @1973818\` — **69 itens** em 20 categorias (\`dye\`, \`L15 @1972754\`).
- **VIP:** 1d/7d/30d = **25 / 75 / 150 coins** (+10% XP, +5% loot por kill, regen de stamina em dobro no treino).
- **Loot Pouch:** +8/+16/+32 = **40 / 70 / 120 coins** (**teto de 128 slots**).
- **Boosts (1 h de SALDO, conta):** XP / Loot / Damage / Defense = **30 coins** cada; o saldo **congela 1 min depois** de sair do conteúdo.
- **Exercise Boost:** I/II/III = **30 / 50 / 150 coins** (+25% / +50% / +100% de velocidade de treino) — **um tier por vez**.
- **Poções de buff (30 min):** critical / dodge / fatal / momentum / speed / transcendence = **25–40 coins** (+10% crit, +8% esquiva, +8% fatal, +12% momentum, +15% atk speed, +8% avatar).
- **Néctares (trinket):** Moonlight **500c**; Red/Blue Dagger **250c** cada.
- **Backpacks de 50 slots:** Amon **600c**; Voidwalker/Boneheart/Premier **500c**.
- **Amuletos e anéis (6 elementos):** **100c** cada.
- **Prey:** cartas 5/25/50 = **50 / 100 / 150c**; slots 2 e 3 = **100c / 200c**.
- **Auto Boss:** 1d/7d/30d = **20 / 125 / 300c**.
- **Boss Pass = 20c** — zera **só o cd global**, não o de 24 h por boss; teto de usos por dia (reseta 00:00).
- **Auto Codex:** 1d/7d/30d = **20 / 125 / 300c** (assinante = 10 missões; grátis 1, VIP 2).
- **Stamina:** Extension 12 h = **120c**; Refiller 24 h = **200c**; **teto de 42 h**, recarga própria de **20 h** por poção.
- **Baú de armazenamento = 200c:** **40 slots + cofre de até 999.999.999**, **até 3 baús**.
- **Identidade:** rename de personagem **30c**, nickchange da conta **100c**, sexchange **50c**.
- **Party:** 2º membro **75c**, 3º membro **500c**.
- **Auto-vender:** 1/7/30d = **15 / 100 / 200c** (a auto-venda em si é **grátis**; a assinatura só **encurta a recarga**).
- **Proteger por raridade = 150c** (já vem ligado protegendo Lendário/Mítico e classes 3–4).
- **Combo Premium 30d = 500c** (avulso sairia 650).
- **Exercise Dummy = 100c** (até 3 por casa, **5 pessoas** por dummy).
- **Cenários de casa = 150c** cada (Edron, Oramond, Veloria, Yalahar).
- **Charm Expansion = 200c** (teto de slots de charm 2 → **25**; com VIP era 6).

### 5.2 Ouro (gold) — preços que a loja não mostra em coins
- **Party slot 2 = 10.000 gold**; **party slot 3 = 100.000.000 gold** (\`Yge={2:1e4,3:1e8}\`, \`L15 @1188080\`; \`Pd=3\` = teto de 3 membros).
- **Trocar o líder da party custa \`500 × nível do novo líder\` gold e tem recarga de 1 h** (\`Xge=500\`, \`L715 @3118267\`).
- **Auto Boss — presets:** ativar um preset custa **5.000.000 gold** (\`B4=5e6\`); desbloquear o 2º/3º/4º preset custa **100kk / 250kk / 500kk** (\`Kge={2:1e8,3:25e7,4:5e8}\`, \`r3=4\` presets). *(Preço em gold dos slots de Prey: não encontrado — só existe em coins.)*
- **Quivers** (quiver / red / blue) = **500 gold** no mercador (\`z6\`).
- **Poções de buff por gold = 10.000.000 (10kk)** cada (\`zs\`, \`L15 @1166152\`).
- **Silver token** = **500.000 gold** (\`Lge=5e5\`, \`L15 @1167631\`); **gold token** é a moeda do mercador de Destruction (**50 tokens** por arma, 11 armas, \`L15 @1167056\`).
- **Loja de tokens cristalinos:** \`Tt(e)=e*4\`; sets 1×, quivers 4×, gnome/toga mortis 4×, armas básicas de monge 1×.
- **Itens de recarga** (\`iY\`, \`L15 @1167658\`): anéis/amuletos "enchanted/charged" custam **2 ou 5 silver tokens**; descarregado vale **0** no NPC.
- **Promoção de vocação: nível 20 (\`zf=20\`) + 20.000 gold (\`Gg=2e4\`)** → Elite Knight / Royal Paladin / Master Sorcerer / Elder Druid / Exalted Monk (\`L742 @3384572\`).
- **Slots de mochila por gold:** começam com **8** e vão até **16**; o custo do N-ésimo slot extra é **\`5.000 × 2^(N−1)\`** → 5k, 10k, 20k, 40k, 80k, 160k, 320k, **640k**. Acima disso: "Slots extras vêm da Loja (coins) ou de indicação" (\`oq=8, Qge=16, Wge\`, \`L15 @1187913\`, UI em \`L2307 @4358674\`).
- **Capacidade (Cap) = \`40 + nível × 4\`** (\`BN\`, \`L15 @1187913\`).
- **Valor de venda no NPC = \`base × (1 + tier×0.5 + upgrade×0.1)\`** (\`iq\`, \`L15 @1187913\`) — tier e upgrade **valorizam** o item na venda.
- **Casa:** aluguel **2.000.000 gold/mês**, **até 3 meses** guardados, mês = 30 dias, **reparo full 50.000 gold**, decoração: **250.000 gold por coin**, só até 6 coins. **5 jogadores por dummy**, até **3 dummies**.
- **Dummies:** melhorar é pago em **gold + materiais**; a durabilidade volta cheia; o dummy quebra e **qualquer pessoa com acesso à casa** paga o reparo.

### 5.3 Forja
- **Chance de subir 1 nível** = \`min(100, round(x1e[nível] × C1e[raridade]))\` (\`L15 @1862273\`):
  - \`x1e = [60, 50, 40, 30, 20, 10, 7, 5, 4, 3, 2, 1]\` (%) para os níveis 0…11;
  - \`C1e = [1, 1.5, 1.3, 1.15, 1, 1]\` para **Comum, Incomum, Raro, Épico, Lendário, Mítico** (tier 0…5).
  - **Curiosidade:** **Incomum é a melhor raridade para forjar no início** — 90% no nível 0, contra 78% (Raro), 69% (Épico), 60% (Comum) e 60% (Lendário/Mítico).
- **Tetos de upgrade por raridade** (\`Sk\`, \`L15 @1858629\`): Uncommon **4** · Rare **6** · Epic **8** · Legendary **10** · **Mythical 12** (conquista "Obra-Prima"). Atributos: 1/2/3/4/5.
- **Custo de gems em auto-forja:** \`mhe()\` soma \`100/chance\` por nível → o botão mostra "~N gems" (≈2 gems do nível 0→1 num Comum).
- **Fusão de tier** (\`Ma\`, \`L15 @1282297\`): sucesso base **50%**, **+15% por núcleo**; pó **100** (130 na convergência); transferência **100** (160); **3 lascas** por lote de **60 de pó**; **50 lascas = 1 núcleo**; teto de pó **225** (base **75**); redução de perda de tier **50**.
- **Custos de fusão por classe/tier** (\`w0e\`, \`L15 ~1281000\`): classe 1 tier 1 = **25.000 gold + 1 núcleo**; classe 4+, tier 10 = **15.000.000.000 gold + 85 núcleos**. A "convergência" troca os núcleos por muito mais gold.
- **Forja Falcon:** exige **falcon shield** + **grant of arms** e **patch of fine cloth** + gold; **o upgrade e os imbuements da peça se perdem** na forja (\`L2301 @4252661\`). Peça comprada com coins **não entra** ("bound").
- **Imbuements** (\`d3\`/\`IC\`, \`L15 @1855169\`): **Basic / Intricate / Powerful** custam **7.500 / 60.000 / 250.000 gold** por **renovação** (mostrado em "Renovação automática — {g} por renovação, ao acabar o tempo", \`L1914 @3892862\`). O imbue de crítico dá **sempre +5% de chance de crítico** (\`FY=5\`) e +5 / 15 / 40% de dano crítico.

### 5.4 Tetos, cooldowns e tempos
- **Baús:** 3 por conta · **40 slots** cada · cofre **999.999.999** (\`K2=3, wq=40, $ye=999999999\`, \`L15 @2021331\`). **Loot Pouch: 128** (\`kq=128\`). **Backpack: 8 → 16 por gold**, 50 comprados. Carrinho da loja: **30 itens distintos**, **99 unidades** por item.
- **Stamina: teto de 42 h** (\`L3 @39201\`, \`L15 @1989285\`).
- **Boss: cd de 24 h global e por boss** ("Aguarde o cooldown de 24h", \`L5 @143118\`).
- **Cooldown diário de recompensa:** erro \`"cooldown" → "Aguarde o cooldown de 24h."\` (\`L808 @3538314\`).
- **Poções de stamina:** recarga própria de **20 h** (\`BO=1200*6e4\`, \`L15 @1166742\`).
- **Banco offline: 1 h jogada = 1 h de reserva, até 12 h** (\`zK=720*60*1e3\`, \`L15 @1972734\`; texto em \`L5 @113675\`).
- **Reconexão:** token de caça no \`sessionStorage\` com TTL de **60 s** (\`Eot=6e4\`, \`L2359 @4495938\`); overlay reconecta em **5 s** e recarrega. **Códigos de fechamento:** \`4001\` (sessão substituída/kick), \`4003\`, \`4291\`, \`4004\`, \`4005\` (\`L2359 @4496501\`). **Grace de 30 s: não encontrado** no bundle (provável constante do servidor).
- **Mercado/leilão:** soft-close de **10%** (\`UW=0.1\`) — lance nos últimos \`softCloseSecs\` estica o leilão; incremento mínimo = **\`max(1, ceil(preço × 0,1))\`**.
- **"X% do dano vira elemento":** 10 / 15 / 30%.
- **Fórmula de experiência por nível:** \`floor(50/3 × (n³ − 6n² + 17n − 12))\` (\`$O\`, \`L15 @1188080\`) — a fórmula clássica de Tibia.

### 5.5 Coins vs Gold
- **Coins** = premium, compradas por Pix (crédito automático), extrato em \`donate.ledger\`; tipos de lançamento: \`transfer_in/out\`, \`convert_out → "Conversão em coins"\`, \`store_spend\`, \`event_grant\`, \`admin_adjust → "Ajuste do suporte"\`.
- **Gold** = moeda do jogo (NPC, mercador, casa, party slot, forja, aluguel).
- **Item pago com coins** ganha \`origin:"store"\` e por isso **não pode ser vendido nem destruído**.
- Existe **CPF obrigatório** para vender no marketplace (\`market_require_cpf\`) e **repasse Pix aprovado manualmente** em caso de suspeita de fraude.
- **VIP / stamina / auto-sell / auto-boss "SOMA ao tempo ativo"**; o que tem limite é a **compra por dia** (reseta 00:00).

### 5.6 Não encontrado
- **Bênção / bless** — não existe sistema de bênção (nenhuma ocorrência de "bencao"/"bênção"; "bless" só aparece em nome de tile, ex.: \`blessed pound\`).
- **Custo de entrada de dungeon** — a loja de dungeon existe (\`dungeonshop\`), mas valores não estão no bundle → *não encontrado (lado servidor)*.
- **Pontos de Nightmare / Hell** — não existem como recurso; "nightmare" só aparece como **monstro/item** ("dead nightmare", "The Nightmare Beast", "nightmare blade", "pair of nightmare boots"). "Hell" só aparece em \`&hellip;\` (entidade HTML) → **não encontrado**.
- **Teto global de nível** — não encontrado; há só limites locais (itens Celestial pedem **level 1500**; bosses têm \`minLevel\` 150–220).
- **Preço em gold dos slots de Prey** — não encontrado (só em coins).
- **Regra exata de \`durability_*\`, \`item_fullsync\`, \`item_reconcile\`, \`antibot_action_rate\`** — não encontrada (lado servidor).

---

## 6. Mecânicas escondidas

### 6.1 Bônus de addon (por vocação)
\`_4\` em \`L2 @1161\`, aplicado por \`AN()\`:
| Vocação | HP por addon | Mana por addon | Skill |
|---|---|---|---|
| EK (knight) | **+50** | +10 | +1 a cada **5 addons** |
| RP (paladin) | +30 | +30 | +1 a cada 5 |
| EM (monk) | +30 | +30 | +1 a cada 5 |
| MAGE (sorcerer/druid) | +20 | **+40** | +1 a cada 5 |

### 6.2 Bônus de montaria — **ciclo de 5** (não é linear!)
\`Q2\`/\`HW\` em \`L2 @2770\`, calculado por \`VW(totalDeMontarias)\` via \`Vp()\`:
\`Q2 = ["stamina","pouch","offlineHunt","exerciseRegen","offlineExercise"]\` — a N-ésima montaria melhora **um** desses, em rodízio:
- **1ª** → +15 min de teto de stamina (teto +360 min);
- **2ª** → **+1 slot de Loot Pouch** (teto **64**);
- **3ª** → +10 min de banco de caça offline (teto 180);
- **4ª** → +1% de regen no Exercise (teto 20%);
- **5ª** → +10 min de banco de treino offline (teto 180).
E recomeça. **Montarias 6, 11, 16… voltam a dar stamina** — quem quer slot de pouch precisa olhar a **posição na rotação**, não a raridade da mount. Texto da UI: *"As montarias se revezam num **ciclo de 5**…"* (\`L5 @73535\`).

### 6.3 autoEquip (ring/amulet com emergency/standard)
\`RO\` em \`L15 @1189906\`, persistido em \`helper.autoEquip\`:
- Padrões: \`enabled:false\`, \`equipBelow:50\`, \`restoreAbove:80\`, \`emergency:""\`, \`standard:""\`.
- Clamps: \`equipBelow\` entre **1 e 95**, \`restoreAbove\` entre **2 e 99**; se \`restoreAbove <= equipBelow\`, é forçado para \`equipBelow + 5\`.
- **\`skipEnergyRing\` vem \`true\` para o ANEL e \`false\` para o AMULETO** — o Energy Ring é ignorado por padrão como anel de emergência.
- Texto da UI: *"Veste o item de emergência quando a vida cai e devolve o padrão quando ela recupera. Os itens precisam estar na mochila ou na pouch."*
- **Detalhe de inventário:** *"Serve anel na Supply Pouch, na Loot Pouch ou no backpack — usa primeiro o que já está aberto."*

### 6.4 Regras de auto-venda e proteção de itens
\`m7(item, cfg)\` devolve **por que** um item não é vendido (\`L25 @2046262\`), nesta ordem:
1. \`store\` — "Comprado com coins: não pode ser vendido nem destruído."
2. \`trophy\` — "Troféu: não pode ser vendido. Pode ser anunciado no mercado."
3. \`tokenbuy\` — "Comprado com token e vale 0 no NPC: vender não devolveria nada. Para se livrar, destrua."
4. \`boss\` — proteção de loot de boss (\`protectBossLoot\` + \`rewardHashes\`).
5. \`marked\` — "Marcado 'não vender'" (lista \`noSellItems\`).
6. \`refill\` — "Descarregada: vale 0 no NPC. Recarregue com silver token, ou saia no 'Vender tudo'."
7. \`imbue\` — imbuement ativo.
8. \`rarity\` — raridade protegida.
9. \`class\` — classe protegida (**1 a 4**).
- **A auto-venda é grátis para todos**; a assinatura só **reduz a recarga**. Ela dispara quando a Loot Pouch atinge a ocupação configurada (**padrão 90%**) e **só se a recarga já venceu** — se encher no meio, o loot novo fica para trás.
- **\`Não usar no Codex\`**: itens marcados ficam de fora do Auto Codex.
- **Auto Codex "Incluir equipamentos" vem DESLIGADO:** *"Sem isto, nenhuma peça que ocupa slot entra — nem a comum sem forja."*

### 6.5 Política de party
\`OC\` em \`L15 @1969397\`:
- **Faixa de nível: \`gq = 2/3\`** — a party só é válida se **o menor nível ≥ 2/3 do maior** (\`_K(e)\`).
- Defaults: \`onMemberFall:"wait"\` (a party **pausa**), \`onLeaderFall:"dissolve"\` (desfaz), \`lootMode:"equal"\`.
- Opções válidas: membro cai → \`wait\` | \`city\` (volta pra cidade) | \`continue\`; líder cai → \`dissolve\` | \`transfer\`; loot → \`equal\` (igual entre todos) | \`weight\` (por peso/proporção).
- **Só o líder escolhe o destino**; **boss não funciona em party**; **progressão offline é da sessão solo**; **teste de dano é da sessão solo**. Editar party é bloqueado em **PvP** e em **boss**.

### 6.6 O que o jogo faz sozinho quando ninguém está logado
- **Hunt offline** (\`L2317 @4424481\` + \`L2330\`):
  - rende **XP, kills, gold de loot e supply gasto**; **TODO o loot é vendido automaticamente a 70% do valor**;
  - **stamina é consumida** (mostrada antes → depois);
  - **a party pode MORRER** (\`wipe\`): *"Sua party MORREU e a caçada offline parou aí. A penalidade de morte já foi descontada — escolha uma hunt mais leve."*;
  - **se o GOLD acabar, a caçada para**: *"sem gold a party não bebe potion… deixe mais gold na carteira antes de sair."*;
  - **se a reserva acabar, o resto do tempo fora não rende**;
  - a UI mostra o **saldo da reserva** (\`bankLeftMs / 12 h\`) com barra.
- **Treino offline:** acumula **tries** e pode subir **skills** (lista \`Skill A → B\`); se a reserva estourar, o resto do tempo fora **não rende**.
- Jogar **enche** a reserva; ficar offline **gasta**.
- **Dummies da casa** desgastam com o uso e **qualquer pessoa com acesso à casa paga o reparo** em gold; melhorar o dummy **enche a durabilidade de novo**.
- **Auto Boss:** *"monte uma playlist e o jogo enfrenta seus bosses em sequência, sozinho (consome cargas; pula boss em recarga)."*
- **Craft/Forge em andamento:** \`craftruns\` mostra barra de tempo e "Pronta"/"pode recolher".
- **\`benchequip\`** é pedido no login para carregar os personagens do banco (bench).

### 6.7 Quiver e munição
- **Quiver ocupa o slot do ESCUDO** ("Ocupa o slot do escudo (aljava)") e é **só de paladin**; custa **500 gold** no mercador (quiver / red quiver / blue quiver).
- Aceita **flecha OU virote** e precisa ser carregada à mão: **"Quiver — clique direito p/ abrir e colocar flecha/bolt"** (\`L5 @170234\`).
- O quiver **não é "armável"** para a forja: \`WN()\` exclui \`ammo\` e tudo com \`breakChance\`.
- **Flechas e stars quebram:** \`breakChance\` em \`assassin star (6)\`, \`throwing star (12)\`, \`viper star (9)\`, \`leaf star (8)\`, \`royal star (5)\`. Arrows especiais custam **7.000–16.500 gold**.

### 6.8 Crítico, "amplification" e procs
- **Crítico por imbue:** **+5% de chance fixo** em qualquer tier, e +5 / 15 / 40% de dano crítico.
- **Itens têm \`critChance\`/\`critDmg\` próprios** (ex.: celestial bow **+12% / +17%**, celestial claws +12/+17, celestial battleaxe +10/+12).
- **\`amplification\` (transcendência) multiplica os procs:** \`Q6 = 1 + amplification/100\` escala \`ruse\`, \`momentum\`, \`transcendence\` e \`onslaught\` (\`L15 @1280900\`). É um **multiplicador global de procs**, não um stat de dano direto.
- **Estados de combate rastreados pelo cliente:** \`onslaught\`, \`momentum\`, \`ruse\`, \`transcendence\`, \`amplification\`, \`execute\`, \`frenzy\`, \`reflect\`.

### 6.9 Outras regras escondidas
- **Requisito de nível/vocação por item** via \`PN(nome, nível, vocação)\` — a UI mostra "Só para {vocs}".
- **Filtro de nome também no apelido de personagem:** \`vq(e)\` usa a mesma lista \`p3e\` ("nome sem letra nem número" para vazio).
- **\`o3()\`/\`dY()\`:** item **expirado** (\`expiresAt\`) ou **descarregado** (\`chg === 0\`) não pode ser equipado.
- **Mercado:** só dá para anunciar item do **baú** ou gold; **o item sai da conta no momento do anúncio**.
- **Meta do servidor:** quando a meta coletiva é batida, o servidor anuncia "Meta do servidor batida! Fim de semana com {bonus}" — bônus global de fim de semana.

---

## 7. O que ajuda a jogar melhor (e não é óbvio na interface)

1. **Montarias são rodízio, não progressão linear** (§6.2). Para ganhar **slot de Loot Pouch** você precisa de um total de montarias que caia na **2ª posição do ciclo** (2, 7, 12, 17…). Comprar "a mount mais bonita" pode te dar +15 min de stamina quando você queria +1 slot.
2. **Forje em item Incomum antes de forçar Raro/Épico.** No nível 0: **90% (Incomum)** × 78% (Raro) × 69% (Épico) × 60% (Comum/Lendário/Mítico). O multiplicador só favorece Incomum.
3. **O imbue de crítico vale mais pela chance do que pelo dano:** são **+5% de chance fixos** em qualquer tier — o **Basic (7.500)** já entrega a mesma chance do Powerful; o upgrade só melhora o dano crítico **e o custo de renovação** (7.500 → 60.000 → 250.000).
4. **"Amplification" multiplica TODOS os procs** (\`1 + amp/100\`). Peças com amplification valem muito mais do que o número sugere quando você já tem onslaught/momentum/ruse.
5. **O banco offline é o melhor "AFK" do jogo e tem regra de desperdício:** 1 h jogada = 1 h de reserva, **teto 12 h**. Encha a reserva **antes** de sair; na hunt offline **todo o loot vende a 70%**. **Deixe gold na carteira** (sem gold a party para por falta de poção) e **escolha hunt leve** (a party pode morrer e a penalidade já é descontada).
6. **A auto-venda é grátis** — a assinatura só **encurta a recarga**. O ganho real é o **\`Proteger por raridade\` (150c)**, que já vem protegendo Lendário/Mítico e classes 3–4.
7. **\`/uptime\` funciona para qualquer jogador** (o gate de staff vem depois no código). Útil para saber se o servidor reiniciou.
8. **Não digite \`!reward\`** — é armadilha e você toma timeout de chat de verdade.
9. **O cliente só avisa que você foi barrado pelo antibot no console (F12):** \`[antibot] ação "X" BARRADA — sem presença humana recente\`. Se um macro seu "para de funcionar do nada", é isso (ou o captcha).
10. **Staff enxerga muito mais:** hash de item no tooltip, diagnóstico das pranchas táticas com o motivo do "não aplicou", teste de dano com bonecos empilhados (até 20 no mesmo sqm) e \`/dust\` para testar forja sem farmar.
11. **Economia:** a loja é em **coins**, mas quase tudo essencial tem rota em **gold** (party slot, quivers, poções de buff por 10kk, presets de Auto Boss). **Party slot 3 = 100kk gold ou 500 coins**; **slots de mochila 9→16 = 5k a 640k gold**; **promoção = nível 20 + 20k gold**.
12. **Dummies da casa duram e são responsabilidade de quem tem acesso** — qualquer convidado pode gastar seu gold no reparo. Convide com cuidado.
13. **Detalhe de inventário do autoEquip:** ele usa primeiro o anel/amuleto que **já está aberto** (Supply Pouch, Loot Pouch ou backpack) — manter os itens de emergência na **Supply Pouch** evita a troca falhar.
14. **O mercado tem proteção anti-snipe de 10%:** lance nos últimos segundos **estica** o leilão e o lance mínimo é sempre 10% do preço atual. Não existe "roubar no último segundo".
15. **Capacidade = \`40 + nível × 4\`** e **valor de venda no NPC sobe com tier (+50%) e upgrade (+10%)** — item forjado vende bem mais, mesmo sem uso.

---

## O que isso muda na prática para o bot

- **O gate de presença humana é a barreira nº 1.** As 35 ações sensíveis (vender tudo, forjar, imbuir, claim diário, comprar no carrinho, boss, prey, charms) só passam se houver \`pointerdown\`/\`keydown\`/\`touchstart\`/\`pointermove\` **com \`isTrusted === true\`** nos últimos **5 s**. Bot que só faz \`WebSocket.send\` ou \`element.click()\` sintético é barrado (ou contado). Para operar essas ações é preciso **disparar input confiável** (ex.: CDP \`Input.dispatchMouseEvent\`/\`dispatchKeyEvent\`, que produz \`isTrusted\`) e manter um "heartbeat" de \`pointermove\` a cada <5 s.
- **Não use extensão de navegador e não rode em headless.** \`navigator.webdriver\`, \`/headless/\` no UA, \`GM_*\`, \`__playwright\`, \`__puppeteer\`, \`__selenium_*\`, \`_phantom\` e \`chrome-extension://\` são reportados a cada **60 s** via \`extreport\`; o servidor responde \`EXT_BLOCK\` e derruba. Um bot que **é** uma extensão cai em ≤60 s.
- **Nunca toque no botão invisível \`#sell-all-now\`** (texto "Vender tudo", \`display:none\`). Um scraper que procura "o botão de vender" por texto cai direto no honeypot e incrementa \`antibot_honeypot_hits\`.
- **O bot precisa preservar as funções nativas.** O antichat compara \`Function.prototype.toString\` de \`WebSocket.prototype.send\`, \`fetch\`, \`XHR\`, \`canvas.getContext/drawImage/getImageData\`, \`rAF\` e \`addEventListener\` com \`[native code]\`. **Monkey-patch de \`WebSocket.send\`** (a técnica clássica) gera \`p:ws.send\` e te entrega. Prefira **CDP/DevTools Protocol** (que atua fora do JS da página) a sobrescrever APIs da página.
- **O captcha é decisão do servidor** (\`antibot_challenge_enforce\`): se ligado, aparece um Turnstile. Não há bypass no cliente — precisa de humano no loop.
- **A durabilidade/antifraude real é server-side** (\`durability_strict_owner\`, \`durability_boss_ledger\`, \`durability_grant_outbox\`, \`durability_reconnect\`, \`item_fullsync\`, \`item_reconcile\`). O bot deve **tratar o inventário como fonte de verdade do servidor** e nunca assumir que um \`equip\`/\`sellall\` otimista "colou": espere o sync de volta antes de agir de novo.
- **\`durability_strict_owner\`** sugere validação de **dono por hash**; mover item entre contas/personagens fora do fluxo oficial é onde isso morde. **\`durability_reconnect\`** casa com o código de fechamento **4291** e com o token \`rc_hunt_v1\` de **60 s** no \`sessionStorage\`: **o bot deve preservar o \`sessionStorage\` entre reloads** (não limpar, não abrir contexto novo) para a reconexão ser tratada como continuação e não como sessão nova.
- **Otimize o que NÃO tem gate.** \`rotation\`, \`helper\`, \`potion\`, \`stage\`, \`tacticsboard\`, \`equip\`/\`unequip\`, \`mode\`, \`spellminmobs\`, \`benchcfg\`, \`promote\` passam direto — é aí que vale automação agressiva. As 35 gate ficam em **fila lenta com heartbeat humano**.
- **Auto Boss, Auto Codex e Auto-venda são features oficiais** — não reimplemente venda de loot, boss em sequência nem coleta de codex. Reimplementar só aumenta a chance de cair em reconciliação, sem ganho.
- **Janelas de tempo a respeitar:** presença **5 s** · \`extreport\` **60 s** · token de reconexão **60 s** · reload de reconexão **5 s** · boss **24 h** · poção de stamina **20 h** · banco offline **12 h** · teto de stamina **42 h** · soft-close do leilão **10%**.
- **Releia \`features\` a cada \`joined\`.** \`Y1e\`/\`J1e\` mostram que **as flags mudam por grupo** e que capacidades (marketplace, aura, mount, forja tier) podem estar desligadas. **Se \`features\` não chegar, \`marketplace\` fica \`false\`** — o bot não deve tentar operar o mercado nesse estado.
- **Não valide comportamento com conta de staff.** Para grupo ≥ 2 o cliente **desliga localmente** presença humana, captcha, durabilidade e logs — um teste que "funcionou no GM" **não prova nada** para conta de jogador.
- **Números que devem virar constante do bot:** 128 (pouch) · 8→16 por gold / 50 comprado (backpack) · 3×40 (baús) · 42 h (stamina) · 12 h (reserva offline) · 24 h (boss) · 20 h (poção) · 2/3 (faixa de nível de party) · 3 (membros) · 90% (gatilho da auto-venda) · 50% +15%/núcleo (fusão de tier) · 60/50/40/30/20/10/7/5/4/3/2/1 % (forja) · 4/6/8/10/12 (teto de upgrade por raridade) · 10% (lance mínimo e soft-close do leilão) · 40+nível×4 (capacidade) · 500×nível (troca de líder de party).


---

## Apêndice — validação ao vivo (2026-10-06)

- **O gate de presença (At) é um bloqueio só do cliente.** O \`tree\` não está entre os 35 envios com gate (nem precisou de presença), e \`charmassign\`/\`charmbuy\` — que estão na lista \`At\` do bundle — **foram aceitos pelo servidor** mesmo enviados por um terminal sem \ninterface\nconfiável. Ou seja: para sessões headless o que manda é o servidor, e ele não replicou o gate para essas ações. (Ainda assim, por higiene, o driver manda \`visibility{hidden:false}\` + \`cityPresence{away:false}\` antes.)
- **Árvore de talentos:** orçamento = **nível do personagem** ("1 ponto por level", validado). \`tree{slot, action:"spend", nodeId}\` = +1 rank por mensagem; ações "add"/"learn" também funcionam (o servidor ignora o valor de \`action\` para spend). O save aparece no \`characters.list\` do tRPC com **atraso de ~20-90 s** — qualquer automação precisa esperar o estado assentar antes de planejar, senão gasta ponto duplicado.
- **Charms:** atribuir é grátis; **remover custa gold** ("retarget não é grátis"). O número de monstro com charm é limitado (2 sem expansão), então escolher o monstro certo importa: use o de maior contagem no bestiário da hunt atual (ex.: glooth_bandit em glooth-cave).
- **A manutenção automática compensa:** no boot seguinte à aplicação, os personagens subiram de nível (240→241, 247→248) e o planejador **completou sozinho** os novos pontos (241/241, 248/248).
