import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const STONE_ID = 'refiner-cave';
export const STONE_PRIOR = 2.2;
export const PROFIT_MARGIN = 1.15;

/**
 * Score that keeps XP and net gold in the same decision instead of letting
 * their different units make the picker always choose one of them.  The
 * optional maxima are supplied by the ranking pool; outside a pool the
 * geometric mean is still useful as a deterministic fallback.
 */
export function balanceScore(expH: number, goldH: number, maxExpH = 1, maxGoldH = 1): number {
  const exp = Math.max(0, Number(expH) || 0);
  const gold = Math.max(0, Number(goldH) || 0);
  const expNorm = maxExpH > 0 ? Math.min(1, exp / maxExpH) : 0;
  const goldNorm = maxGoldH > 0 ? Math.min(1, gold / maxGoldH) : 0;
  return Math.round((0.55 * expNorm + 0.45 * goldNorm) * 10000) / 10000;
}

export interface ObservedHuntScore {
  xpPerHour?: number;
  lootGoldPerHour?: number;
  supplyGoldPerHour?: number;
  netGoldPerHour?: number;
  damagePerSecond?: number;
  healingPerSecond?: number;
  kills?: number;
  wipeMs?: number;
  resistances?: ResistanceMap;
  /** Indica que a taxa veio de uma janela/relatório utilizável. */
  sampleReady?: boolean;
}

export type Element = 'physical' | 'fire' | 'ice' | 'energy' | 'earth' | 'death' | 'holy';
export type ResistanceMap = Partial<Record<Element, number>>;

export interface DamageProfile {
  physical?: number;
  fire?: number;
  ice?: number;
  energy?: number;
  earth?: number;
  death?: number;
  holy?: number;
}

function clampResistance(value: number): number {
  const normalized = Math.abs(value) > 1 ? value / 100 : value;
  return Math.max(-1, Math.min(0.95, normalized));
}

export function effectiveDamage(profile: DamageProfile, resistances: ResistanceMap = {}): number {
  return Object.entries(profile).reduce((total, [element, raw]) => {
    const damage = Number(raw) || 0;
    const resistance = clampResistance(Number(resistances[element as Element] || 0));
    return total + damage * (1 - resistance);
  }, 0);
}

export function resistanceSource(facts: any): 'known' | 'assumed' {
  return facts?.resistances || facts?.defense || facts?.elements ? 'known' : 'assumed';
}

interface EngineData {
  hunts: any[];
  monsters: Record<string, any>;
  priors: Record<string, number>;
  _by_id?: Record<string, any>;
}

let _ENGINE: EngineData | null = null;

function engineCandidates(): string[] {
  const here = (() => {
    try {
      // @ts-ignore Bun import.meta.dir
      if (typeof import.meta.dir === 'string') return (import.meta as any).dir;
    } catch (_) {}
    try { return dirname(fileURLToPath(import.meta.url)); } catch (_) {}
    return process.cwd();
  })();
  return [
    join(here, 'engine_hunts.json'),
    join(here, '..', 'engine_hunts.json'),
    join(process.cwd(), 'engine_hunts.json'),
    join(process.cwd(), 'bot-ts', 'engine_hunts.json'),
    join(process.cwd(), 'src', 'engine_hunts.json'),
  ];
}

export function loadEngine(path?: string): EngineData {
  if (_ENGINE !== null && !path) return _ENGINE;
  const p = path || engineCandidates().find((c) => existsSync(c));
  if (!p) {
    const data: EngineData = { hunts: [], monsters: {}, priors: { [STONE_ID]: STONE_PRIOR } };
    if (!path) _ENGINE = data;
    return data;
  }
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as EngineData;
    const byId: Record<string, any> = {};
    for (const h of data.hunts || []) {
      if (h && typeof h === 'object' && h.id) byId[h.id] = h;
    }
    data._by_id = byId;
    if (!path) _ENGINE = data;
    return data;
  } catch (_) {
    const data: EngineData = { hunts: [], monsters: {}, priors: { [STONE_ID]: STONE_PRIOR } };
    if (!path) _ENGINE = data;
    return data;
  }
}

export function huntFacts(hid: string): any | null {
  const eng = loadEngine();
  const rec = (eng._by_id || {})[hid];
  return rec && typeof rec === 'object' ? rec : null;
}

export function goldFarmReady(magic?: Record<string, any> | null): boolean {
  const m = magic || {};
  if (m.slot1_present && !m.party_ready) return false;
  if (m.party_ready) return true;
  return (parseInt(String(m.power ?? 0), 10) || 0) >= 1;
}

export function estimateDps(level: number, magic?: Record<string, any> | null): number {
  // Fórmula empírica descoberta via JEV (jev-latest) a partir de números REAIS
  // de soak (logs/soak_tracker.json + engine_hunts.json), não chute teórico.
  //
  // Amostras confiáveis (ttk >> spawn, up 120s-5000s, sem idle-diluição):
  //  lvl150 dragon 838 kills/h -> ttk 9.29s -> 156 dps
  //  lvl150 glooth 831 kills/h -> ttk 15.13s -> 165 dps
  //  lvl311 vexclaw 485 kills/h -> ttk 27.47s -> 308 dps
  //  lvl312 undead 519 kills/h -> ttk 25.52s -> 327 dps
  //  lvl160 glooth 885 kills/h -> ttk 14.07s -> 178 dps
  //  lvl320 asura 1462 kills/h -> ttk 7.65s -> 414 dps
  //  lvl320 wyrm 1294 kills/h -> ttk 8.93s -> 253 dps
  //  Inversão: ttk = alive*3600/killsH - spawnS, dps = avgHp/ttk.
  //  Elf-lair excluída (spawn-capped: ttk 3.01s, 73% spawn) e sessões
  //  >20000s excluídas (idle dilui kills/h).
  //
  //  Mediana endgame (power3 aoe3 party): 1.044 dps/level.
  //  Antiga: level*(5+7*power+9*aoe)*n => 106*level endgame (15900 @150).
  //    Erro 90-100x. JEV: reject nour 0.84-0.94, fit score 0.04 (Péssimo).
  //  JEV choice B_linear_calibrated (0.84) > A/C, depois refinada R
  //    (decision_2980018ff3385094085f1c2ed2917be4): noul 0.89, score 2.85
  //    (Bom), choice R 1.00. Erro médio 10.4% vs 29% de B.
  //
  //  dps = level * (0.24 + 0.12*power + 0.08*min(aoe,3)) * (party?1.25:1)
  //  Endgame p3a3 party: 1.05*level (lvl150=>158, lvl311=>327).
  //  Base p0a0 solo: 0.24*level (scaling magia 4.4x, não 21x como antes).
  const m = magic || {};
  const rawPower = parseInt(String(m.power ?? 0), 10) || 0;
  const rawAoe = parseInt(String(m.aoe ?? 0), 10) || 0;
  const power = Math.max(0, Math.min(3, rawPower));
  const aoe = Math.max(0, Math.min(3, rawAoe));
  const party = !!(m.slot1_present || m.party_ready);
  const n = party ? 1.25 : 1;
  const lvl = Math.max(1, level);
  return Math.max(0.5, lvl * (0.24 + 0.12 * power + 0.08 * aoe) * n);
}

export function simulateHunt(hid: string, level: number, magic?: Record<string, any> | null, _scale = 1.0, observed?: ObservedHuntScore | null): any | null {
  const facts = huntFacts(hid);
  if (!facts) return null;
  const m = magic || {};
  const hp = parseFloat(String(facts.avgHp ?? 0)) || 0;
  if (hp <= 0) return null;
  const rawDps = estimateDps(level, m);
  const profile = (m.damageProfile || { physical: rawDps * 0.35, magic: rawDps * 0.65 }) as DamageProfile;
  const resistances = (observed?.resistances || facts.resistances || facts.defense || facts.elements || {}) as ResistanceMap;
  const profileWithMagic = { ...profile } as any;
  if (profileWithMagic.magic !== undefined) {
    delete profileWithMagic.magic;
    profileWithMagic.energy = (profileWithMagic.energy || 0) + Number((profile as any).magic || 0) * 0.5;
    profileWithMagic.ice = (profileWithMagic.ice || 0) + Number((profile as any).magic || 0) * 0.25;
    profileWithMagic.fire = (profileWithMagic.fire || 0) + Number((profile as any).magic || 0) * 0.25;
  }
  const dps = Math.max(1, effectiveDamage(profileWithMagic, resistances));
  const ttk = hp / Math.max(dps, 1.0);
  const spawnS = Math.max(0.2, (parseFloat(String(facts.spawnMs ?? 2200)) || 2200) / 1000.0);
  const alive = Math.max(1, parseInt(String(facts.maxAlive ?? 1), 10) || 1);
  let killsH: number;
  if ((parseInt(String(m.aoe ?? 0), 10) || 0) > 0) {
    killsH = (alive / Math.max(ttk + spawnS, spawnS)) * 3600.0;
  } else {
    killsH = Math.min(3600.0 / Math.max(ttk, 0.05), 3600.0 / spawnS);
  }
  const priors = loadEngine().priors || {};
  let prior = parseFloat(String(priors[hid] ?? 1.0)) || 1.0;
  if (hid === STONE_ID) prior = Math.max(prior, STONE_PRIOR);
  const goldKill = (parseFloat(String(facts.goldKill ?? 0)) || 0) * prior;
  const simulatedGoldH = killsH * goldKill * _scale;
  const expKill = parseFloat(String(facts.avgExp ?? 0)) || 0;
  const simulatedExpH = killsH * expKill * _scale;
  const incoming = (parseFloat(String(facts.avgDmg ?? 0)) || 0) * alive / Math.max(ttk, 0.25);
  const sustain = Math.max(1, level) * ((parseInt(String(m.heal ?? 0), 10) || 0) ? 18 : 8);
  let canTank: boolean;
  if ((parseInt(String(m.power ?? 0), 10) || 0) <= 0) {
    canTank = hp <= Math.max(80, level * 20);
  } else {
    canTank = incoming < sustain * 5 || hp <= Math.max(1, level) * 40;
  }
  // Não use `||` aqui: netGold pode ser zero/negativo quando o custo de
  // suprimentos supera o loot. Cair silenciosamente para lootGold faria uma
  // hunt deficitária parecer lucrativa e quebraria o equilíbrio XP/ouro.
  const netRaw = observed?.netGoldPerHour;
  const lootRaw = observed?.lootGoldPerHour;
  const supplyRaw = observed?.supplyGoldPerHour;
  const hasObservedGold = !!observed && [netRaw, lootRaw, supplyRaw].some((v) => Number.isFinite(Number(v)) && Number(v) !== 0);
  const observedGoldH = Number.isFinite(Number(netRaw)) && (hasObservedGold || Number(netRaw) !== 0)
    ? Number(netRaw)
    : Number(lootRaw || 0);
  const observedExpH = Number(observed?.xpPerHour || 0);
  const observedDamage = Number(observed?.damagePerSecond || 0);
  const observedWipeMs = Number(observed?.wipeMs || 0);
  const goldH = hasObservedGold ? observedGoldH : simulatedGoldH;
  const expH = observedExpH > 0 ? observedExpH : simulatedExpH;
  if (observedDamage > 0) canTank = observedWipeMs <= 0 || observedWipeMs > 30000;
  return {
    id: hid,
    name: facts.name || hid,
    ttk: Math.round(ttk * 1000) / 1000,
    kills_h: Math.round(killsH * 10) / 10,
    gold_h: Math.round(goldH * 10) / 10,
    gold_kill: Math.round(goldKill * 100) / 100,
    exp_h: Math.round(expH * 10) / 10,
    exp_kill: Math.round(expKill * 10) / 10,
    can_tank: !!canTank,
    avg_hp: hp,
    spawn_ms: facts.spawnMs,
    max_alive: alive,
    observed: observed ? { ...observed } : null,
    simulated_gold_h: Math.round(simulatedGoldH * 10) / 10,
    simulated_exp_h: Math.round(simulatedExpH * 10) / 10,
    observed_damage_s: observedDamage,
    observed_wipe_ms: observedWipeMs,
    damage_profile: profileWithMagic,
    resistances,
    resistance_source: resistanceSource(facts),
    raw_dps: rawDps,
    balance_score: 0,
  };
}

export function observedScoreFromMapper(map: any, hid: string): ObservedHuntScore | null {
  const score = map?.scores?.[hid];
  if (score && typeof score === 'object') return score;
  const hunt = map?.hunts?.[hid];
  if (!hunt || typeof hunt !== 'object') return null;
  const facts = huntFacts(hid);
  const resistanceSums: Record<string, number> = {};
  const resistanceCounts: Record<string, number> = {};
  const rows = map?.resistances && typeof map.resistances === 'object' ? map.resistances : {};
  for (const monster of facts?.monsters || []) {
    const exact = rows[monster] || rows[String(monster).toLowerCase()];
    const row = exact || Object.entries(rows).find(([name]) => String(name).toLowerCase() === String(monster).toLowerCase())?.[1];
    if (!row || typeof row !== 'object') continue;
    for (const [element, value] of Object.entries(row as Record<string, any>)) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      resistanceSums[element.toLowerCase()] = (resistanceSums[element.toLowerCase()] || 0) + n;
      resistanceCounts[element.toLowerCase()] = (resistanceCounts[element.toLowerCase()] || 0) + 1;
    }
  }
  const resistances: ResistanceMap = {};
  for (const [element, sum] of Object.entries(resistanceSums)) {
    resistances[element as Element] = sum / Math.max(1, resistanceCounts[element]);
  }
  return {
    damagePerSecond: Number(hunt.damage || 0) / Math.max(1, Number(hunt.frames || 1)),
    healingPerSecond: Number(hunt.healing || 0) / Math.max(1, Number(hunt.frames || 1)),
    kills: Number(hunt.kills || 0),
    ...(Object.keys(resistances).length > 0 ? { resistances } : {}),
  };
}

/** Elemento de menor resistência conhecido; retorna null quando a fonte é
 * apenas observação de dano e não há resistência explícita do servidor. */
export function bestElementForResistances(resistances?: ResistanceMap | null): Element | null {
  if (!resistances || Object.keys(resistances).length === 0) return null;
  const entries = Object.entries(resistances)
    .filter(([element, value]) => ['physical', 'fire', 'ice', 'energy', 'earth', 'death', 'holy'].includes(element) && Number.isFinite(Number(value)))
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  return entries.length > 0 ? entries[0][0] as Element : null;
}

export function calibrateScale(hid: string, observedGoldH: number, level: number, magic?: Record<string, any> | null): number | null {
  const sim = simulateHunt(hid, level, magic, 1.0);
  if (!sim || !(sim.gold_h > 0) || !(observedGoldH > 0)) return null;
  return Math.max(0.3, Math.min(3.0, observedGoldH / sim.gold_h));
}

export function rankHunts(ids: string[], level: number, magic?: Record<string, any> | null, scale = 1.0): any[] {
  const out: any[] = [];
  for (const hid of ids) {
    const sim = simulateHunt(hid, level, magic, scale);
    if (sim) out.push(sim);
  }
  const maxExp = Math.max(1, ...out.map((s) => Number(s.exp_h) || 0));
  const maxGold = Math.max(1, ...out.map((s) => Number(s.gold_h) || 0));
  for (const sim of out) sim.balance_score = balanceScore(sim.exp_h, sim.gold_h, maxExp, maxGold);
  out.sort((a, b) => {
    if (!!b.can_tank !== !!a.can_tank) return (b.can_tank ? 1 : 0) - (a.can_tank ? 1 : 0);
    if (b.balance_score !== a.balance_score) return b.balance_score - a.balance_score;
    if (b.exp_h !== a.exp_h) return b.exp_h - a.exp_h;
    return b.gold_h - a.gold_h;
  });
  return out;
}

export function rankHuntsObserved(
  ids: string[],
  level: number,
  magic?: Record<string, any> | null,
  scale = 1.0,
  mapper?: any,
): any[] {
  const out: any[] = [];
  for (const hid of ids) {
    const sim = simulateHunt(hid, level, magic, scale, observedScoreFromMapper(mapper, hid));
    if (sim) out.push(sim);
  }
  const maxExp = Math.max(1, ...out.map((s) => Number(s.exp_h) || 0));
  const maxGold = Math.max(1, ...out.map((s) => Number(s.gold_h) || 0));
  for (const sim of out) sim.balance_score = balanceScore(sim.exp_h, sim.gold_h, maxExp, maxGold);
  out.sort((a, b) => {
    if (!!b.can_tank !== !!a.can_tank) return (b.can_tank ? 1 : 0) - (a.can_tank ? 1 : 0);
    if (b.balance_score !== a.balance_score) return b.balance_score - a.balance_score;
    if (b.exp_h !== a.exp_h) return b.exp_h - a.exp_h;
    return b.gold_h - a.gold_h;
  });
  return out;
}

export function recommendSwitch(
  ids: string[],
  liveId: string | null,
  level: number,
  magic?: Record<string, any> | null,
  scale = 1.0,
  banned?: Set<string> | null,
): any | null {
  const ban = banned || new Set<string>();
  const ranked = rankHunts(ids, level, magic, scale).filter((s) => !ban.has(s.id));
  if (!ranked.length) return null;
  const tankable = ranked.filter((s) => s.can_tank);
  const best = tankable.length > 0 ? tankable[0] : ranked[0];
  const live = ranked.find((s) => s.id === liveId) || null;
  const liveExp = live ? parseFloat(String(live.exp_h)) || 0 : 0;
  const bestExp = parseFloat(String(best.exp_h)) || 0;
  const liveGold = live ? parseFloat(String(live.gold_h)) || 0 : 0;
  const bestGold = parseFloat(String(best.gold_h)) || 0;
  const liveBalance = live ? Number(live.balance_score) || 0 : 0;
  const bestBalance = Number(best.balance_score) || 0;
  let clearly = liveId == null || liveId !== best.id;
  if (live && liveId !== best.id && live.can_tank) {
    clearly = bestBalance >= liveBalance * 1.08 && !!best.can_tank;
  }
  return {
    id: best.id,
    name: best.name,
    exp_h: bestExp,
    gold_h: bestGold,
    live_exp_h: liveExp,
    live_gold_h: liveGold,
    balance_score: bestBalance,
    live_balance_score: liveBalance,
    clearly_better: !!(clearly && best.can_tank),
    can_tank: !!best.can_tank,
    sim: best,
    ready: true,
  };
}
