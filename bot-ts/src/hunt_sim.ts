import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const STONE_ID = 'refiner-cave';
export const STONE_PRIOR = 2.2;
export const PROFIT_MARGIN = 1.15;

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
  return Math.max(-1, Math.min(0.95, value));
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
  const m = magic || {};
  const power = parseInt(String(m.power ?? 0), 10) || 0;
  const aoe = parseInt(String(m.aoe ?? 0), 10) || 0;
  const n = m.slot1_present || m.party_ready ? 2 : 1;
  return Math.max(8.0, Math.max(1, level) * (5 + 7 * power + 9 * Math.min(aoe, 3)) * n);
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
  const observedGoldH = Number(observed?.netGoldPerHour || observed?.lootGoldPerHour || 0);
  const observedExpH = Number(observed?.xpPerHour || 0);
  const observedDamage = Number(observed?.damagePerSecond || 0);
  const observedWipeMs = Number(observed?.wipeMs || 0);
  const goldH = observedGoldH > 0 ? observedGoldH : simulatedGoldH;
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
  };
}

export function observedScoreFromMapper(map: any, hid: string): ObservedHuntScore | null {
  const score = map?.scores?.[hid];
  if (score && typeof score === 'object') return score;
  const hunt = map?.hunts?.[hid];
  if (!hunt || typeof hunt !== 'object') return null;
  return {
    damagePerSecond: Number(hunt.damage || 0) / Math.max(1, Number(hunt.frames || 1)),
    healingPerSecond: Number(hunt.healing || 0) / Math.max(1, Number(hunt.frames || 1)),
    kills: Number(hunt.kills || 0),
  };
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
  out.sort((a, b) => {
    if (!!b.can_tank !== !!a.can_tank) return (b.can_tank ? 1 : 0) - (a.can_tank ? 1 : 0);
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
  out.sort((a, b) => {
    if (!!b.can_tank !== !!a.can_tank) return (b.can_tank ? 1 : 0) - (a.can_tank ? 1 : 0);
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
  let clearly = liveId == null || liveId !== best.id;
  if (live && liveId !== best.id && live.can_tank) {
    clearly = bestExp >= liveExp * 1.08 && !!best.can_tank;
  }
  return {
    id: best.id,
    name: best.name,
    gold_h: parseFloat(String(best.gold_h)) || 0,
    exp_h: bestExp,
    live_exp_h: liveExp,
    clearly_better: !!(clearly && best.can_tank),
    can_tank: !!best.can_tank,
    sim: best,
    ready: true,
  };
}
