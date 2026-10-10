/**
 * Driver terminal: fica na hunt sem navegador, sem Chromium e sem SwiftShader.
 *
 * O jogo é idle e server-authoritative: o cliente escolhe a hunt (`mode`+`stage`)
 * e o servidor simula o resto. Então o terminal só precisa de
 *   1) POST /rt/matchmake/joinOrCreate/hunt  ->  2) WS Colyseus  ->
 *   3) ready/mode/stage  ->  4) reconnect quando a sala cai.
 * O estado (level/gold/stamina) vem dos frames ROOM_DATA e do tRPC, exatamente
 * como o driver com browser — só muda o transporte.
 */

import { Endpoint, Room, endpointFromOrigin } from './colyseus';
import { HuntJoinOptions, connectHunt } from './session';
import { TelemetryStore, staminaStringToMinutes } from '../telemetry';
import { createTrpcClient, normalizeChars } from '../trpc';
import { HUNTS_BY_ID, HUNTS_TABLE, PREFERRED } from '../hunts';
import { buildFingerprint, buildExt, defaultEnv, loadOrCreateDeviceId } from './fingerprint';
import { staminaIsBelow50Pct, staminaIs100Pct } from '../state_machine';
import { rankHunts, simulateHunt } from '../hunt_sim';
import { getJevEngine } from '../jev';
import { KNOWN_BOSSES } from '../boss_runner';
import { PARTY_SLOTS, buildPlan, applyPlan } from './autoconfig';
import { runAutoEquip } from './autoequip';
import { startControlServer } from './control_server';
import { activateTalentTrees } from './tree_runner';
import { installCharmAssigner } from './charms';

export interface CharacterInfo {
  id: string | number;
  name: string;
  vocation: string;
  level: number;
}

export interface HunterOptions {
  token: string;
  origin?: string;
  huntId?: string;
  characterName?: string;
  /** Intervalo do poll tRPC (level/gold/stamina). 0 desliga. */
  pollSec?: number;
  /** Intervalo do log de status. */
  logSec?: number;
  /** Sem nenhum frame por N segundos => sessão morta, reconecta. */
  staleSec?: number;
  /** recicla a sessão a cada N segundos (0 = nunca). */
  recycleSec?: number;
  deviceId?: string;
  dataDir?: string;
  /** Só no probe: imprime cada frame recebido (padrão true). */
  verboseFrames?: boolean;
  autoSell?: boolean;
  autoRewards?: boolean;
  autoTreino?: boolean;
  autoArena?: boolean;
  autoCodex?: boolean;
  autoBoss?: boolean;
  /** Gasta os pontos da árvore de talentos (1 por level) no boot da sessão. */
  autoTree?: boolean;
  /** Equipa itens da mochila estritamente melhores (epico+ por padrao). */
  autoEquip?: boolean;
  /** Raridade minima para equipar: 3 = epico/lendario/mitico, igual ao jogo. */
  equipMinTier?: number;
  /** Manda "loop" para o servidor manter a rotacao de hunts. */
  autoLoop?: boolean;
  /** Porta do painel HTTP de controle (0 desliga). */
  controlPort?: number;
  priority?: 'balanced' | 'gold' | 'xp';
  log?: (msg: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const noop = () => {};

/**
 * A árvore de talentos é aplicada uma vez por PROCESSO: o save do servidor leva
 * ~1 min para aparecer no tRPC, então reaplicar a cada reconexão poderia gastar
 * pontos lendo um estado velho.
 */
let treeAppliedThisProcess = false;

/** Maior hunt da tabela PREFERRED cujo level mínimo cabe no personagem (fallback estático). */
export function pickHuntForLevel(level: number): string | null {
  if (!Number.isFinite(level) || level <= 0) return null;
  let best: string | null = null;
  let bestMin = -1;
  for (const [minStr, id] of Object.entries(PREFERRED)) {
    const min = Number(minStr);
    if (min <= level && min > bestMin && HUNTS_BY_ID[id]) {
      bestMin = min;
      best = id;
    }
  }
  return best;
}

/**
 * Seleciona a melhor hunt usando as fórmulas matemáticas reais do motor (hunt_sim / game_formula):
 * - Simula TTK, DPS, sustain e dano recebido (can_tank)
 * - Prioriza hunts que o personagem aguenta tancar sem wipe (evitando perda de gold)
 * - Maximiza balance_score entre XP/h e Gold/h
 */
export function pickBestHunt(
  level: number,
  magic?: Record<string, any> | null,
  priority: 'balanced' | 'gold' | 'xp' = 'balanced',
): string {
  if (!Number.isFinite(level) || level <= 0) return 'troll-cave';
  const available = HUNTS_TABLE.filter((h) => h.min <= level).map((h) => h.id);
  const ranked = rankHunts(available, level, magic);
  const tankable = ranked.filter((h) => h.can_tank);
  const pool = tankable.length > 0 ? tankable : ranked;

  if (priority === 'gold') {
    pool.sort((a, b) => (Number(b.gold_h) || 0) - (Number(a.gold_h) || 0));
    return pool[0]?.id || 'glooth-cave';
  }
  if (priority === 'xp') {
    pool.sort((a, b) => (Number(b.exp_h) || 0) - (Number(a.exp_h) || 0));
    return pool[0]?.id || 'troll-cave';
  }
  return pool[0]?.id || pickHuntForLevel(level) || 'troll-cave';
}

/**
 * Slots da party para cada personagem: usa o mapa fixo da conta quando existe
 * e cai na ordem de `characters.list` quando não (evita mandar equip para o
 * slot errado quando o nome muda).
 */
export function partySlotsFor(chars: CharacterInfo[], fallback: CharacterInfo): Array<CharacterInfo & { slot: number }> {
  const src = chars && chars.length > 0 ? chars : [fallback];
  const seen = new Map<string, number>();
  return src.map((c, idx) => {
    const key = String(c.name).trim();
    const known = PARTY_SLOTS[key] ?? PARTY_SLOTS[key.trim()];
    const slot = seen.has(key) ? idx : (known ?? idx);
    seen.set(key, idx);
    return { ...c, slot };
  });
}

export async function resolveCharacter(token: string, name?: string): Promise<CharacterInfo> {
  const trpc = createTrpcClient(token);
  let raw: any;
  try {
    raw = await trpc.query('characters.list');
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/\b401\b/.test(msg)) {
      throw new Error(
        'token inválido ou expirado (401 em characters.list). ' +
        'Pegue de novo: F12 > Application > Local Storage > https://baiakidle.com > baiak-idle-token ' +
        '(relogue no jogo antes, se necessário).',
      );
    }
    throw err;
  }
  const chars = normalizeChars(raw);
  if (chars.length === 0) throw new Error('characters.list vazio — token sem personagem?');
  const wanted = (name || '').trim().toLowerCase();
  let found: CharacterInfo | undefined;
  if (wanted) {
    found = chars.find((c) => c.name.toLowerCase() === wanted);
    if (!found) {
      throw new Error(`personagem "${name}" não encontrado em [${chars.map((c) => c.name).join(', ')}]`);
    }
  } else {
    // Sem nome explícito, o char principal é o líder da party ou o de maior
    // nível ATIVO. `chars[0]` é só o selecionado na conta e pode estar benched:
    // em acc2/acc3 ele era um banca com stamina 92% (lvl 111/119), enquanto a
    // party real estava com stamina 0 — o bot então escondia a stamina zerada,
    // nunca entrava no Treino Online e o servidor mandava para a cidade em loop.
    const pc: any = await trpc.query('characters.partyConfig').catch(() => null);
    const disabled = new Set((Array.isArray(pc?.disabled) ? pc.disabled : []).map(String));
    const pool = chars.filter((c) => !disabled.has(String(c.id)));
    const scope = pool.length > 0 ? pool : chars;
    const leader = pc?.leader !== undefined && pc?.leader !== null
      ? scope.find((c) => String(c.id) === String(pc.leader))
      : undefined;
    found = leader ?? [...scope].sort((a, b) => (b.level || 0) - (a.level || 0))[0] ?? chars[0];
  }
  if (!found) {
    throw new Error('não foi possível resolver o personagem principal da conta');
  }
  if (found.id === null || found.id === undefined) {
    throw new Error(`personagem ${found.name} sem id — não dá para entrar na hunt`);
  }
  return { id: found.id, name: found.name, vocation: found.vocation, level: found.level };
}

function makeJoinOptions(
  opts: HunterOptions,
  endpoint: Endpoint,
  deviceId: string,
  characterId: string | number,
  log: (m: string) => void,
): HuntJoinOptions {
  return {
    token: opts.token,
    characterId,
    fp: buildFingerprint(deviceId, defaultEnv()),
    ext: buildExt([]),
    disabled: false,
    endpoint,
    log,
  };
}

export interface SessionHandle {
  room: Room;
  telemetry: TelemetryStore;
  character: CharacterInfo;
  huntId: string;
}

/** Sincroniza e aplica automaticamente a melhor cura, rotação e poções para toda a party via tRPC e Colyseus. */
export async function syncPartyAutoConfig(trpc: any, room: Room, log: (m: string) => void): Promise<any[] | null> {
  try {
    const rawChars = await trpc.query('characters.list');
    const chars = normalizeChars(rawChars);

    const summary = await trpc.query('items.summary').catch(() => null);
    const supplyMap: Record<string, number> = {};
    if (summary?.items && Array.isArray(summary.items)) {
      for (const it of summary.items) {
        if (it?.name) {
          const k = String(it.name).trim().toLowerCase();
          supplyMap[k] = (supplyMap[k] ?? 0) + (Number(it.qty) || 1);
        }
      }
    }

    // Auto-refill e auto-compra de supplies preventivo no Colyseus (Melhor estoque / BiS)
    room.send('autorefill', {
      names: [
        'supreme health potion',
        'ultimate spirit potion',
        'distilled ultimate mana potion',
        'ultimate mana potion',
        'ultimate health potion',
        'great spirit potion',
        'great health potion',
        'great mana potion',
      ],
    });
    room.send('autobuysupply', {
      cfg: {
        'supreme health potion': { min: 25, qty: 150 },
        'ultimate health potion': { min: 25, qty: 150 },
        'great health potion': { min: 25, qty: 150 },
        'ultimate spirit potion': { min: 25, qty: 150 },
        'great spirit potion': { min: 25, qty: 150 },
        'distilled ultimate mana potion': { min: 25, qty: 150 },
        'ultimate mana potion': { min: 25, qty: 150 },
        'great mana potion': { min: 25, qty: 150 },
      },
    });

    for (const c of chars) {
      const slot = PARTY_SLOTS[c.name] ?? (PARTY_SLOTS[c.name.trim()] ?? -1);
      if (slot >= 0) {
        const plan = buildPlan(c, slot, supplyMap);
        applyPlan(room, plan, (c as any).state?.helper, log);
        (c as any).state = {
          rotation: plan.rotation,
          hpPotion: plan.hpPotion,
          manaPotion: plan.manaPotion,
          helper: { healSpell: plan.healSpell },
        };
      }
    }
    return chars;
  } catch (err: any) {
    log(`[term] aviso no auto-config de magias/poções: ${err?.message || err}`);
    return null;
  }
}

/**
 * Uma sessão completa: resolve o personagem, entra na hunt, envia
 * ready/mode/stage e só retorna quando a sala morre ou trava.
 */
export async function runSession(opts: HunterOptions): Promise<void> {
  const log = opts.log ?? noop;
  const endpoint = endpointFromOrigin(opts.origin || process.env.TERM_ORIGIN || 'https://baiakidle.com');
  const dataDir = opts.dataDir || process.env.USER_DATA_DIR || './data';
  const deviceId = opts.deviceId || loadOrCreateDeviceId(dataDir);
  const pollSec = opts.pollSec ?? 120;
  const logSec = opts.logSec ?? 60;
  const staleSec = opts.staleSec ?? 120;

  const telemetry = new TelemetryStore();
  const trpc = createTrpcClient(opts.token);

  // ── Party real da conta ───────────────────────────────────────────────────
  // O que importa para o jogo é a party ATIVA (`partyConfig.leader` e os chars
  // fora de `disabled`). `characters.list` pode devolver um benched primeiro:
  // em acc2/acc3 o chars[0] era um banca com stamina 92%, então o auto-treino
  // lia "38:30" e nunca disparava enquanto a party de caça estava com stamina 0
  // e o servidor ficava mandando para a cidade em loop (XP = 0).
  // A regra do servidor é "a party precisa de >= 1h de stamina em cada conta
  // para caçar" -> a stamina que decide é a PIOR da party ativa.
  const partyState = { leader: null as any, disabled: new Set<string>() };
  const refreshPartyConfig = async () => {
    const pc: any = await trpc.query('characters.partyConfig').catch(() => null);
    partyState.leader = pc?.leader ?? null;
    partyState.disabled = new Set((Array.isArray(pc?.disabled) ? pc.disabled : []).map(String));
    return pc;
  };
  const activePartyOf = (chars: any[]) => {
    const act = chars.filter((c: any) => c && !partyState.disabled.has(String(c.id)));
    return act.length > 0 ? act : chars;
  };
  const leaderLevelOf = (chars: any[]) => {
    const act = activePartyOf(chars);
    const leader = partyState.leader !== null && partyState.leader !== undefined
      ? act.find((c: any) => String(c.id) === String(partyState.leader))
      : undefined;
    if (leader && Number(leader.level) > 0) return Number(leader.level);
    return act.reduce((m: number, c: any) => Math.max(m, Number(c.level) || 0), 0);
  };
  const minStaminaOf = (chars: any[]) => activePartyOf(chars)
    .map((c: any) => Number(c.stamina))
    .filter((n: number) => Number.isFinite(n))
    .reduce((m: number, n: number) => Math.min(m, n), Infinity);
  const applyPartyTelemetry = (chars: any[], primary?: any) => {
    const lvl = leaderLevelOf(chars);
    if (lvl > 0) {
      telemetry.updateLevel(lvl, 'trpc');
      if (primary) primary.level = lvl;
    }
    const stam = minStaminaOf(chars);
    if (Number.isFinite(stam)) telemetry.updateStamina(stam, 'trpc');
    return { lvl, stam };
  };

  const character = await resolveCharacter(opts.token, opts.characterName);
  log(`[term] personagem ${character.name} (id=${character.id}, lvl=${character.level}, voc=${character.vocation})`);
  telemetry.updateLevel(character.level, 'trpc');

  let rawCharsList: any[] = [];
  await refreshPartyConfig().catch(() => {});
  try {
    rawCharsList = normalizeChars(await trpc.query('characters.list').catch(() => []));
    const seed = applyPartyTelemetry(rawCharsList, character);
    log(
      `[term] party ativa: leader=${partyState.leader ?? '-'} disabled=[${[...partyState.disabled].join(',')}] ` +
      `lvl=${seed.lvl} stam=${Number.isFinite(seed.stam) ? `${Math.round(seed.stam)}min` : 'n/a'}`,
    );
  } catch { /* sem characters.list o poll cuida disso */ }

  const activeCountAtBoot = activePartyOf(rawCharsList).length;
  // Estratégia de prioridade solicitada:
  // - Com 3 slots liberados: foco 100% em XP MÁXIMO (em todas as contas)!
  // - Com menos de 3 slots: foco em GOLD (acumular 100kk para liberar o 3º slot)!
  let currentStrategy: 'gold' | 'xp' = activeCountAtBoot >= 3 ? 'xp' : (opts.priority === 'xp' ? 'xp' : 'gold');
  log(`[term] 🎯 Estratégia inicial: ${currentStrategy === 'xp' ? '⚡ XP MÁXIMO (3 slots ativos)' : '💰 FARM DE OURO (acumular 100kk para 3 slots)'}`);

  const huntId = opts.huntId || pickBestHunt(character.level, null, currentStrategy) || 'troll-cave';
  const huntName = HUNTS_BY_ID[huntId]?.name || huntId;
  const sim = simulateHunt(huntId, character.level);
  log(
    `[term] 🎯 Hunt simulada (fórmulas do motor): ${huntName} (${huntId}) ` +
    `[tank: ${sim?.can_tank ?? true} | exp/h: ${Math.round(sim?.exp_h || 0)} | gold/h: ${Math.round(sim?.gold_h || 0)} | ttk: ${sim?.ttk || 0}s | score: ${sim?.balance_score || 0}]`,
  );

  const join: HuntJoinOptions = makeJoinOptions(opts, endpoint, deviceId, character.id, log);

  const { room, viaQueue } = await connectHunt(join);
  log(`[term] sala ${room.roomId} viva${viaQueue ? ' (via fila)' : ''}`);

  telemetry.setOnline(true);

  const autoSell = opts.autoSell ?? true;
  const autoRewards = opts.autoRewards ?? true;
  const autoTreino = opts.autoTreino ?? true;
  const autoArena = opts.autoArena ?? true;
  const autoCodex = opts.autoCodex ?? true;
  const autoEquip = opts.autoEquip ?? true;
  const equipMinTier = opts.equipMinTier ?? 3;
  const autoLoop = opts.autoLoop ?? true;
  const autoBoss = opts.autoBoss ?? false;
  const autoTree = opts.autoTree ?? true;
  const jev = getJevEngine();

  let staged = false;
  let inTreino = false;
  let inBossFight = false;
  let bossFightStartedAt = 0;
  let currentBossName = '';
  let recentDeathsCount = 0;
  let lastAutoConfigCheck = 0;
  const protectedItems = new Set<string>();

  // ── Guarda anti-wipe ──────────────────────────────────────────────────────
  // Sem isso, o loop "morre -> re-entra na hunt" queimou ~10% do gold por wipe
  // (medido ao vivo em 06/10/26: Choking Fear fez 3.77M -> 3.39M -> 3.02M).
  // Se a party cair WIPE_LIMIT vezes na janela, o driver desce para a hunt
  // mais forte abaixo da atual; no limite da tabela, para na cidade ate a
  // proxima sessao. Ajustavel via .env: WIPE_LIMIT, WIPE_WINDOW_SEC,
  // DOWNGRADE_CD_SEC.
  const wipeLimit = Math.max(1, Number(process.env.WIPE_LIMIT ?? 3));
  const wipeWindowMs = Math.max(60_000, Number(process.env.WIPE_WINDOW_SEC ?? 600) * 1000);
  const downgradeCooldownMs = Math.max(60_000, Number(process.env.DOWNGRADE_CD_SEC ?? 600) * 1000);
  const deathStamps: number[] = [];
  let lastDowngradeAt = 0;
  let gaveUp = false;

  let currentHuntId = huntId;
  let autoBossActive = autoBoss;
  let cachedChars: any[] = [];
  let cachedCharsAt = 0;
  trpc.query('characters.list').then((r: any) => { cachedChars = normalizeChars(r); cachedCharsAt = Date.now(); }).catch(() => {});

  let lastRateSample = Date.now();
  let rateBaseline = { gold: telemetry.gold, kills: telemetry.kills };
  let sessionRates = { killsPerHour: 0, goldPerHour: 0, xpPerHour: 0, sampledAt: 0 };

  const resetHuntRates = (reason: string) => {
    rateBaseline = { gold: telemetry.gold, kills: telemetry.kills };
    lastRateSample = Date.now();
    sessionRates = { killsPerHour: 0, goldPerHour: 0, xpPerHour: 0, sampledAt: 0 };
    log(`[term] 🔄 Métricas de rendimento zeradas (${reason}): XP/h e Kills/h reiniciados para nova amostragem`);
  };

  const stage = (why: string, targetId: string = currentHuntId) => {
    const isNewHunt = targetId !== currentHuntId;
    const wasTreinoOrCity = inTreino || !staged;
    currentHuntId = targetId;
    const name = HUNTS_BY_ID[currentHuntId]?.name || currentHuntId;
    room.send('ready', {});
    room.send('mode', { mode: 'hunt' });
    room.send('stage', { huntId: currentHuntId });
    staged = true;
    inTreino = false;
    log(`[term] stage enviado (${why}): ${name}`);
    if (isNewHunt || wasTreinoOrCity) {
      resetHuntRates(`troca para ${name} [${why}]`);
    }
  };

  // Histograma de tipos de frame: revela quais subsistemas o servidor alimenta
  // numa sessão SEM navegador. É a base para decidir o que dá para portar.
  const frameTypes = new Map<string, number>();
  room.on('__data', (frame: any) => {
    if (!frame || frame.type === undefined) return;
    const t = String(frame.type);
    const seen = frameTypes.get(t);
    if (seen === undefined) {
      log(`[term] novo tipo de frame: ${t} ${JSON.stringify(frame.payload ?? null).slice(0, 220)}`);
    }
    frameTypes.set(t, (seen ?? 0) + 1);
    telemetry.ingestWebSocketFrame(t, frame.payload);
  });

  room.on('__join', (p: any) => {
    log(`[term] joined: ${JSON.stringify(p).slice(0, 200)}`);
  });
  room.on('toHunt', (p: any) => {
    const wasTreino = inTreino;
    inTreino = false;
    const targetHunt = (typeof p === 'string' ? p : p?.huntId) || currentHuntId;
    if (targetHunt !== currentHuntId || wasTreino) {
      currentHuntId = targetHunt;
      resetHuntRates(`toHunt do servidor: ${targetHunt}`);
    }
    log(`[term] toHunt: ${JSON.stringify(p).slice(0, 160)}`);
  });
  room.on('toCity', () => {
    if (inBossFight) {
      inBossFight = false;
      log(`[term] 🏁 Boss fight contra ${currentBossName} finalizada -> retornando à hunt: ${huntName}`);
      restage('retorno de boss');
      return;
    }
    if (!inTreino) log('[term] servidor mandou para a cidade');
  });
  room.on('deaths', (p: any) => {
    recentDeathsCount++;
    const now = Date.now();
    deathStamps.push(now);
    while (deathStamps.length && now - deathStamps[0] > wipeWindowMs) deathStamps.shift();
    const wipesNow = deathStamps.length;
    log(`[term] mortes: ${JSON.stringify(p).slice(0, 200)} (wipes ${wipesNow}/${wipeLimit} na janela de ${Math.round(wipeWindowMs / 60000)}min)`);

    if (inTreino || inBossFight) return;          // treino/boss tem mecanica propria
    if (wipesNow < wipeLimit) return;             // wipe isolado: so re-entra
    if (now - lastDowngradeAt < downgradeCooldownMs) return; // anti-thrash
    lastDowngradeAt = now;

    const curMin = HUNTS_BY_ID[currentHuntId]?.min ?? Infinity;
    const weaker = [...HUNTS_TABLE]
      .filter((h) => h.min < curMin)
      .sort((a, b) => b.min - a.min)[0];
    deathStamps.length = 0;
    if (weaker) {
      log(`[term] 🛑 (${wipesNow} wipes) — hunt "${HUNTS_BY_ID[currentHuntId]?.name || currentHuntId}" e forte demais para a party; descendo para "${weaker.name}" (nv ${weaker.min})`);
      stage('downgrade anti-wipe', weaker.id);
    } else {
      gaveUp = true;
      room.send('mode', { mode: 'city' });
      room.send('tocity', {});
      log(`[term] 🛑 ${wipesNow} wipes e ja estamos na hunt mais fraca da tabela — parando na cidade ate a proxima sessao (evita torrar gold com penalidade de wipe)`);
    }
  });

  // Avaliador inteligente de Flash Offers via JEV
  room.on('flashoffer:shown', async (payload: any) => {
    const key = payload?.key;
    if (!key) return;
    try {
      const offer = await jev.decideFlashOffer({
        key,
        name: payload?.name,
        cost: payload?.cost,
        currency: payload?.currency,
        items: payload?.items,
        playerLevel: character.level,
        playerGold: telemetry.gold,
      });
      log(`[term] 🏷️ Flash Offer "${key}": ${offer.reason}`);
      if (offer.shouldBuy) {
        room.send('flashoffer:buy', { key });
        log(`[term] 🛒 Flash Offer "${key}" comprada via decisão JEV!`);
      } else {
        room.send('flashoffer:reject', { key, surface: 'popup' });
      }
    } catch (err: any) {
      log(`[term] aviso flash offer: ${err?.message || err}`);
    }
  });

  const restage = (why: string) => {
    if (!staged || inTreino) return;
    setTimeout(() => {
      if (!room.closed && !inTreino) stage(why);
    }, 5_000);
  };
  room.on('deaths', () => { if (!gaveUp) restage('após morte'); });
  room.on('toCity', () => {
    if (!inTreino && !inBossFight) restage('volta da cidade');
  });

  stage('entrada na sala');
  installCharmAssigner(room, () => currentHuntId, log);

  // Desfecho da luta de boss vinda dos frames: vitória ("derrotado!"), recusa
  // ("recarga"/"cargas de boss") e wipe ("deaths" com goldLost).
  const bossOutcomeNow = (txt: string) => {
    if (!inBossFight) return;
    if (/derrotado!/.test(txt)) {
      inBossFight = false;
      log(`[term] 👑 ${currentBossName} derrotado — o servidor já retomou a hunt`);
    } else if (/recarga|cargas de boss/i.test(txt)) {
      inBossFight = false;
      log(`[term] 👑 ${currentBossName} recusado: ${txt.slice(0, 80)}`);
    }
  };
  room.on('notify', (p: any) => bossOutcomeNow(String(p?.text ?? '')));
  room.on('log', (p: any) => {
    const txt = String(p?.text ?? '');
    bossOutcomeNow(txt);
    if (/stamina insuficiente|precisa de pelo menos 1h de stamina|sem stamina|ca[çc]a bloqueada/i.test(txt)) {
      inTreino = true;
      resetHuntRates('stamina insuficiente acusada pelo servidor');
      telemetry.updateStamina('0:00', 'websocket');
      room.send('mode', { mode: 'exercise' });
      room.send('tocity', {});
      log(`[term] 🧘 Stamina esgotada acusada pelo servidor: "${txt}" -> alternando para Treino Online (exercise)`);
    }
  });
  room.on('deaths', (p: any) => {
    if (!inBossFight) return;
    inBossFight = false;
    const perda = p?.rows?.[0]?.goldLost;
    log(`[term] 👑 wipe na luta de boss (${currentBossName})${perda ? ` — perda de ${perda} gold` : ''}; o handler de mortes já reestagia`);
  });

  // Auto-config de magias (exura ico no knight) e poções para toda a party no boot
  syncPartyAutoConfig(trpc, room, log).then((c) => { if (c) cachedChars = c; }).catch(() => {});

  // Árvore de talentos (build): gasta os pontos que faltam (1 ponto por level).
  // O envio tree{action:"spend"} não tem gate de presença no bundle, então passa
  // direto do terminal. Uma vez por processo — ver treeAppliedThisProcess.
  if (autoTree && !treeAppliedThisProcess) {
    treeAppliedThisProcess = true;
    activateTalentTrees(trpc, room, {
      log,
      paceMs: Number(process.env.TREE_PACE_MS ?? 30),
      adjacency: Number(process.env.TREE_ADJACENCY ?? 1.5),
      survivalWeight: Number(process.env.TREE_SURVIVAL ?? 0.35),
      settleMs: 15_000,
      verifyMs: 120_000,
    }).catch((err: any) => log(`[tree] falha ao aplicar a árvore: ${err?.message || err}`));
  }

  const controlPort = opts.controlPort ?? Number(process.env.CONTROL_PORT || process.env.PORT || 8080);
  const controlServer = controlPort > 0
    ? startControlServer(controlPort, {
      getRoom: () => room,
      getTelemetry: () => telemetry,
      getChars: () => cachedChars,
      getCurrentHunt: () => currentHuntId,
      getRates: () => sessionRates,
      setHunt: (newId: string) => stage('controle web', newId),
      setTreino: (enabled: boolean) => {
        if (enabled) {
          inTreino = true;
          resetHuntRates('entrada em treino via web');
          // "city" é o modo parado, sem regeneração de stamina. O modo que
          // de fato recupera stamina (e dobra com VIP) é o Treino Online.
          room.send('mode', { mode: 'exercise' });
          room.send('tocity', {});
        } else {
          inTreino = false;
          stage('retorno de treino via web');
        }
      },
      setAutoBoss: (enabled: boolean) => { autoBossActive = enabled; },
      getAutoBoss: () => autoBossActive,
      getInTreino: () => inTreino,
      reconfigParty: async () => {
        const c = await syncPartyAutoConfig(trpc, room, log);
        if (c) cachedChars = c;
      },
      log,
    })
    : null;
  if (!controlServer && controlPort > 0) log('[term] painel HTTP desligado (porta ocupada)');

  // Ativa loop contínuo e autosell inicial
  if (autoLoop) room.send('loop', true);
  // Caçada offline: se a sessão cair, o servidor farm a hunt atual com o banco de 12 h.
  // Confirmado empiricamente: offlineInfo respondeu mode -> "hunt", fill -> "hunt".
  room.send('offlinemode', { mode: 'hunt', huntId: currentHuntId });
  if (autoSell) {
    room.send('autosellfull', { on: true });
    room.send('autosellpct', { pct: 85 });
    const minTier = Number(opts.equipMinTier ?? 3);
    const protectedTiers = [3, 4, 5, 6, 7, 8, 9, 10].filter((t) => t >= minTier);
    room.send('protecttiers', { tiers: protectedTiers });
    log(`[term] 💰 Auto-Sell ativado (85% / bag cheia, protegendo tiers >= ${minTier})`);
  }
  if (autoCodex) {
    room.send('codexauto', { on: true });
    log('[term] 📖 Codex auto-delivery ativado');
  }

  const state: { ended?: Error } = {};
  const finish = (err: Error) => {
    if (!state.ended) state.ended = err;
  };
  room.on('__error', (err: any) => finish(new Error(err?.message || 'erro da sala')));
  room.on('__leave', (info: any) => finish(new Error(`sala fechou (code=${info?.code ?? '?'})`)));

  const statusTimer = setInterval(() => {
    const up = room.uptimeSec();
    log(
      `[term] ${telemetry.hunt} | lvl ${telemetry.level} | gold ${telemetry.gold} | stam ${telemetry.stamina} ` +
      `| kills ${telemetry.kills} | ondas ${telemetry.waves} | frames ${room.stats.framesIn} ` +
      `(dados ${room.stats.roomData} / estado ${room.stats.roomState}) | envios ${room.stats.out} | ${up}s` +
      `${inTreino ? ' [🧘 TREINO]' : ''}${inBossFight ? ` [👑 BOSS ${currentBossName}]` : ''}`,
    );
    // Atualização dinâmica de stamina (consumo na hunt vs regeneração no treino)
    const stepMin = Math.max(1, Math.round(logSec / 60));
    const curMins = staminaStringToMinutes(telemetry.stamina) ?? (inTreino ? 0 : 2520);
    if (inTreino) {
      // Regeneração no Treino Online (teto de 42h = 2520 min)
      const nextMins = Math.min(2520, curMins + stepMin);
      const h = Math.floor(nextMins / 60);
      const m = nextMins % 60;
      telemetry.updateStamina(`${h}:${String(m).padStart(2, '0')}`, 'websocket');
    } else {
      // Consumo de stamina caçando
      const nextMins = Math.max(0, curMins - stepMin);
      const h = Math.floor(nextMins / 60);
      const m = nextMins % 60;
      telemetry.updateStamina(`${h}:${String(m).padStart(2, '0')}`, 'websocket');
    }
  }, Math.max(5, logSec) * 1000);

  let lastRewardCheck = 0;
  let lastTreinoCheck = 0;
  let treinoEnteredAt = 0;
  let lastArenaCheck = 0;
  let lastBossCheck = 0;
  let lastTriageCheck = 0;
  let lastCodexCheck = 0;
  let lastEquipCheck = 0;

  const actionTimer = setInterval(() => {
    if (room.closed) return;
    const now = Date.now();

    // 1. Auto-Sell & Coleta de Recompensas (a cada 30 segundos)
    if (now - lastRewardCheck >= 30_000) {
      lastRewardCheck = now;
      if (autoRewards) {
        room.send('reward', { action: 'collectall' });
        room.send('sellreward', {});
      }
      if (autoSell) {
        // No protocolo oficial do jogo (index.js:4489294/4373275):
        // room.send('sellall', { protected: false }) vende todos os drops e materiais
        // desprotegidos da mochila, respeitando os tiers protegidos via protecttiers.
        room.send('sellall', { protected: false });
        log('[term] 💰 Auto-Sell executado (sellall mantendo itens protegidos)');
      }
    }

    // 2. Fila da Arena Diária (a cada 30 minutos)
    if (autoArena && now - lastArenaCheck >= 30 * 60_000) {
      lastArenaCheck = now;
      room.send('arenaQueue', {});
      log('[term] ⚔️ Fila de Arena diária disparada');
    }

    // 3. Gestão de Stamina e Treino (entra em <= 50% e volta em 100%)
    if (autoTreino && now - lastTreinoCheck >= 10_000) {
      lastTreinoCheck = now;
      const stam = telemetry.stamina;
      const isLow = staminaIsBelow50Pct(stam);
      const isRecovered = staminaIs100Pct(stam);
      if (inTreino && treinoEnteredAt === 0) treinoEnteredAt = now;
      if (!inTreino) treinoEnteredAt = 0;
      // Cinto e suspensório: se a leitura de 100% nunca chegar (teto do
      // servidor, stamina travada, tRPC fora), o bot NÃO pode ficar preso no
      // treino para sempre — é exatamente o sintoma original (XP = 0).
      const treinoMaxMs = Math.max(1, Number(process.env.TREINO_MAX_H ?? 14)) * 3_600_000;
      const overrun = inTreino && treinoEnteredAt > 0 && now - treinoEnteredAt > treinoMaxMs;

      if (!inTreino && isLow) {
        inTreino = true;
        treinoEnteredAt = now;
        resetHuntRates('entrada em Treino Online (stamina <= 50%)');
        // O bundle do jogo nao conhece o literal "training" (L2359:16663);
        // o modo de treino correto que recupera stamina e "exercise".
        room.send('mode', { mode: 'exercise' });
        room.send('tocity', {});
        log(`[term] 🧘 Stamina <= 50% (${stam}) -> teleportando para Treino Online (treinará até 100%)`);
      } else if (inTreino && isRecovered) {
        inTreino = false;
        treinoEnteredAt = 0;
        stage('stamina 100% recuperada');
        log(`[term] ⚔️ Stamina atingiu 100% (${stam}) -> retornando para hunt: ${huntName}`);
      } else if (inTreino && overrun) {
        inTreino = false;
        treinoEnteredAt = 0;
        stage(`limite de treino (${Math.round(treinoMaxMs / 3_600_000)}h) atingido`);
        log(`[term] ⚠️ Treino excedeu ${Math.round(treinoMaxMs / 3_600_000)}h sem atingir 100% (stam ${stam}) -> voltando para hunt mesmo assim`);
      }
    }

    // 4. Triagem Inteligente de Inventário (a cada 2 minutos)
    if (now - lastTriageCheck >= 120_000) {
      lastTriageCheck = now;
      trpc.query('items.summary').then(async (summary: any) => {
        const items: any[] = summary?.items || [];
        const bagItems = items.filter((it) => it.location === 'bag' || it.location === 'backpack');
        for (const item of bagItems) {
          const triage = await jev.triageInventoryItem(
            {
              name: item.name,
              tier: item.tier,
              ftier: item.ftier,
              upLevel: item.upLevel,
              attrs: item.attrs,
              hash: item.hash,
            },
            { vocation: character.vocation, level: character.level },
          );
          if (triage.action === 'stash_chest' && item.hash) {
            log(`[term] 📦 Jev guardando item no baú: ${item.name} (${triage.reason})`);
            room.send('bagmove', { hash: item.hash, to: 'chest' });
            protectedItems.add(item.hash);
          } else if (item.hash && (triage.action === 'salvage_forge' || triage.action === 'keep_upgrade')) {
            protectedItems.add(item.hash);
          }
        }
      }).catch(() => {});
    }

    // 5. Auto-Boss por EVIDÊNCIA DE KILL (a cada 10 minutos)
    // Medidas reais nesta conta (2026-10-06):
    //  - as lutas NÃO interrompem a hunt; o desfecho chega pelos frames
    //    ("derrotado!" • "deaths" com goldLost) — wipe medido: Ratmiral -379.000 gold;
    //  - a tentativa consome a carga diária no INÍCIO e liga a recarga do boss (~43 h);
    //  - kills sem wipe só quando o boss JÁ consta no bestiário da conta
    //    (darkfang/sharpclaw/black_vixen/ahau/shadowpelt/bloodback morrem em ~15 s);
    //  - Jev sozinho autorizava chefes não provados (Ratmiral 81% => wipe). Regra:
    //    só entra quem já foi morto antes (sem gold em risco); AUTO_BOSS_TODOS=1 desliga
    //    essa proteção.
    if (autoBoss && !inBossFight && !inTreino && now - lastBossCheck >= 10 * 60_000) {
      lastBossCheck = now;
      (async () => {
        let gateCds: Record<string, number> = {};
        let chargesUsed: number | null = null;
        let chargesDay = '';
        let bestiario: Record<string, number> = {};
        try {
          const rawRows: any = await trpc.query('characters.list');
          const rows: any[] = Array.isArray(rawRows) ? rawRows : [];
          const st = rows[0]?.state ?? {};
          for (const [k, v] of Object.entries(st.bossCooldowns ?? {})) {
            const nv = Number(v);
            if (Number.isFinite(nv)) gateCds[k] = nv;
          }
          chargesUsed = Number.isFinite(Number(st.bossChargesUsed)) ? Number(st.bossChargesUsed) : null;
          chargesDay = String(st.bossChargesDay ?? '');
          for (const [k, v] of Object.entries(st.progress ?? {})) {
            if (!k.startsWith('bst:')) continue;
            const kv = Number(v);
            if (Number.isFinite(kv) && kv > 0) bestiario[k.slice(4)] = kv;
          }
        } catch {}
        const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
        if (chargesDay === hoje && chargesUsed !== null && chargesUsed >= 20) {
          log(`[term] 👑 cargas de boss do dia esgotadas (${chargesUsed}/20) — pausa até amanhã`);
          return;
        }
        const soProvados = process.env.AUTO_BOSS_TODOS !== '1' && process.env.AUTO_BOSS_TODOS !== 'true';
        const aptos = KNOWN_BOSSES.filter((b) => {
          if (b.minLevel > 0 && character.level < b.minLevel) return false;
          const cd = gateCds[b.id];
          if (cd && cd > now) return false;
          if (soProvados && !bestiario[b.id]) return false;   // nunca matado = não vale o wipe
          return true;
        });
        const semHistorico = KNOWN_BOSSES
          .filter((b) => character.level >= b.minLevel && !gateCds[b.id] && !bestiario[b.id])
          .map((b) => b.name);
        if (soProvados && semHistorico.length) {
          log('[term] 👑 ignorados por falta de prova no bestiário (wipe = 10% do gold): ' + semHistorico.slice(0, 6).join(', ') + (semHistorico.length > 6 ? ' +' + (semHistorico.length - 6) : ''));
        }
        for (const b of aptos) {
          const safety = await jev.decideBossSafety({
            player: { level: character.level, vocation: character.vocation },
            boss: b,
            recentDeaths: recentDeathsCount,
          });
          if (safety.canKill) {
            log(`[term] 👑 Jev + bestiário autorizam: ${b.name} (${b.rarity}, ${bestiario[b.id]}x morto) [perigo ${safety.dangerScore}%]`);
            inBossFight = true;
            bossFightStartedAt = Date.now();
            currentBossName = b.name;
            room.send('boss', { bossId: b.id, fromCity: false });
            break;
          } else if (character.level >= b.minLevel) {
            log(`[term] 🛡️ Jev bloqueou ${b.name} (${safety.reason})`);
          }
        }
      })().catch((err: any) => log('[term] 👑 aviso no ciclo de boss: ' + (err?.message || err)));
    }

    // Teto de segurança da luta de boss: medimos archfoes morrendo em ~15 s e
    // Scarlett passando de 60 s sem desfecho — o ciclo fecha pelos frames
    // (bossOutcome acima) ou após 10 min sem fim (luta interminável -> reestagia).
    if (inBossFight && now - bossFightStartedAt > 10 * 60_000) {
      inBossFight = false;
      log(`[term] ⏱️ Luta de boss sem desfecho após 10 min -> retornando para hunt: ${huntName}`);
      stage('timeout de boss');
    }

    // 6. Sincronização de Tarefas de Guilda & Codex (a cada 5 minutos)
    if (autoCodex && now - lastCodexCheck >= 5 * 60_000) {
      lastCodexCheck = now;
      room.send('guildtaskflush', {});
      room.send('codexauto', { on: true });
    }

    // 7. Auto-config periódico de magias e poções da party (a cada 10 minutos)
    if (now - lastAutoConfigCheck >= 10 * 60_000) {
      lastAutoConfigCheck = now;
      syncPartyAutoConfig(trpc, room, log).then((c) => { if (c) cachedChars = c; }).catch(() => {});
    }

    // 8. Auto-equip de itens estritamente melhores na mochila (a cada 5 minutos)
    if (autoEquip && now - lastEquipCheck >= 5 * 60_000) {
      lastEquipCheck = now;
      const slots = partySlotsFor(cachedChars, character);
      (async () => {
        let trocados = 0;
        for (const c of slots) {
          const plan = await runAutoEquip(room, trpc, {
            charId: c.id,
            vocation: c.vocation,
            level: c.level,
            charSlot: c.slot,
            minTier: equipMinTier,
            maxPerRun: 4,
            log,
          }).catch(() => [] as any[]);
          trocados += plan.length;
        }
        if (trocados > 0) log(`[term] 🛡️ auto-equip: ${trocados} item(ns) melhoraram o equipamento (tier >= ${equipMinTier})`);
      })().catch(() => {});
    }

    // 9. Amostragem de taxa real (kills/h e gold/h do rolling window) p/ o painel
    if (inTreino) {
      sessionRates = { killsPerHour: 0, goldPerHour: 0, xpPerHour: 0, sampledAt: now };
      rateBaseline = { gold: telemetry.gold, kills: telemetry.kills };
      lastRateSample = now;
    } else if (now - lastRateSample >= 60_000) {
      const elapsedMin = (now - lastRateSample) / 60_000;
      const dGold = telemetry.gold - rateBaseline.gold;
      const dKills = telemetry.kills - rateBaseline.kills;
      const sim = simulateHunt(currentHuntId, character.level);
      const kph = elapsedMin > 0 ? Math.max(0, Math.round((dKills * 60) / elapsedMin)) : 0;
      const gph = elapsedMin > 0 ? Math.round((dGold * 60) / elapsedMin) : 0;
      const xph = kph > 0 ? Math.round(kph * (sim?.exp_kill || 1500)) : 0;
      sessionRates = {
        killsPerHour: kph,
        goldPerHour: gph,
        xpPerHour: xph,
        sampledAt: now,
      };
      lastRateSample = now;
      rateBaseline = { gold: telemetry.gold, kills: telemetry.kills };
    }
  }, 5_000);

  let pollTick = 0;
  const pollTimer = pollSec > 0
    ? setInterval(() => {
      if (pollTick++ % 5 === 0) refreshPartyConfig().catch(() => {});
      trpc.query('characters.list').then((raw: any) => {
        const chars = normalizeChars(raw);
        const c = chars.find((x) => String(x.id) === String(character.id)) ?? chars[0];
        if (!c) return;
        if (c.gold !== undefined) telemetry.updateGold(c.gold, 'trpc');
        applyPartyTelemetry(chars, character);

        // Transição automática: liberou o 3º slot da party? Chaveia para XP MÁXIMO imediatamente!
        const activeCount = activePartyOf(chars).length;
        if (activeCount >= 3 && currentStrategy === 'gold') {
          currentStrategy = 'xp';
          log(`[term] 🚀 3 slots de party liberados (${activeCount} personagens ativos)! Transição automática: foco alterado de GOLD para XP MÁXIMO!`);
          const xpBestHunt = pickBestHunt(leaderLevelOf(chars) || character.level, null, 'xp');
          if (xpBestHunt && xpBestHunt !== currentHuntId) {
            stage('transição para XP máximo (3 slots liberados)', xpBestHunt);
          }
        }
      }).catch((err: any) => log(`[term] poll tRPC falhou: ${err?.message || err}`));
    }, pollSec * 1000)
    : null;

  const recycleMs = (opts.recycleSec ?? 0) > 0 ? (opts.recycleSec as number) * 1000 : 0;

  try {
    for (;;) {
      await sleep(1_000);
      if (state.ended) throw state.ended;
      const lastActivity = room.lastFrameAt || room.joinedAt;
      if (!room.closed && lastActivity && Date.now() - lastActivity > staleSec * 1000) {
        throw new Error(`sessão parada: ${Math.floor((Date.now() - lastActivity) / 1000)}s sem frames`);
      }
      if (recycleMs && Date.now() - room.joinedAt > recycleMs) {
        throw new Error('reciclagem programada da sessão');
      }
    }
  } finally {
    clearInterval(statusTimer);
    clearInterval(actionTimer);
    if (pollTimer) clearInterval(pollTimer);
    try { (controlServer as any)?.stop(); } catch (_) {}
    telemetry.setOnline(false);
    room.close();
  }
}

/** Loop 24/7: reconecta com backoff até conseguir ficar na hunt. */
export async function runHunter(opts: HunterOptions): Promise<never> {
  const log = opts.log ?? noop;
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      log(`[term] iniciando sessão (tentativa ${attempt})`);
      await runSession(opts);
    } catch (err: any) {
      const wait = Math.min(5_000 * attempt, 60_000);
      log(`[term] sessão caiu: ${err?.message || err} — reconectando em ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}

/**
 * Diagnóstico: faz o matchmake + handshake e imprime os primeiros frames.
 * Use para validar token/IP/fp antes de deixar o bot rodando.
 */
export async function probeSession(opts: HunterOptions): Promise<void> {
  const log = opts.log ?? noop;
  const endpoint = endpointFromOrigin(opts.origin || 'https://baiakidle.com');
  const dataDir = opts.dataDir || process.env.USER_DATA_DIR || './data';
  const deviceId = opts.deviceId || loadOrCreateDeviceId(dataDir);

  const character = await resolveCharacter(opts.token, opts.characterName);
  log(`[term] personagem: ${character.name} (id=${character.id}, lvl=${character.level})`);
  log(`[term] endpoint: ${endpoint.ws}`);
  log(`[term] fp: ${buildFingerprint(deviceId, defaultEnv())}`);

  const join: HuntJoinOptions = makeJoinOptions(opts, endpoint, deviceId, character.id, log);
  // Mesmo seletor do runSession: sem isso o --probe valida uma hunt que o
  // driver em produção jamais escolheria.
  const huntId = opts.huntId || pickBestHunt(character.level) || 'troll-cave';

  const { room } = await connectHunt(join, 2);
  const verboseFrames = opts.verboseFrames !== false;
  const seen = new Map<string, number>();
  room.on('__data', (frame: any) => {
    if (!frame || frame.type === undefined) return;
    const t = String(frame.type);
    seen.set(t, (seen.get(t) ?? 0) + 1);
    if (verboseFrames) log(`[term] <- ${t} ${JSON.stringify(frame.payload ?? null).slice(0, 240)}`);
  });

  log(`[term] enviando ready/mode/stage -> ${HUNTS_BY_ID[huntId]?.name || huntId} (${huntId})`);
  room.send('ready', {});
  room.send('mode', { mode: 'hunt' });
  room.send('stage', { huntId });

  await sleep(Math.max(10, opts.logSec ?? 20) * 1000);

  log(`[term] frames: ${JSON.stringify(Object.fromEntries(seen))}`);
  log(`[term] stats: ${JSON.stringify(room.stats)}`);
  room.close();
}