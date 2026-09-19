import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { STONE_ID, calibrateScale, goldFarmReady, recommendSwitch } from './hunt_sim';

const _HUNTS: Array<[string, string, number]> = [
  ['troll-cave', 'Troll Cave', 1],
  ['elf-lair', 'Elf', 8],
  ['amazon-camp', 'Amazon', 9],
  ['minotaur', 'Minotaur', 10],
  ['kongra', 'Kongra', 10],
  ['cyclopolis', 'Cyclopolis', 15],
  ['corym-cave', 'Corym Skirmisher', 30],
  ['refiner-cave', 'Stone Refiner', 30],
  ['giant-spider', 'Giant Spider', 50],
  ['crawler-cave', 'Crawler', 50],
  ['glooth-cave', 'Glooth Bandit', 60],
  ['hero-cave', 'Hero', 60],
  ['cult-cave', 'Cult', 80],
  ['dragon-lair', 'Dragon Lair', 80],
  ['werebadge-cave', 'Werebadge', 90],
  ['hydra-cave', 'Hydra', 100],
  ['behemoth-cave', 'Behemoth', 100],
  ['orclops-cave', 'Orclops', 100],
  ['grimreaper-cave', 'Grim Reaper', 130],
  ['wyrm-cave', 'Wyrm', 130],
  ['werehyaena-cave', 'Werehyaena', 140],
  ['asura-lair', 'Asuras', 150],
  ['darktorturer-cave', 'Dark Torturer', 150],
  ['wereliones-cave', 'Wereliones', 170],
  ['draken-lair', 'Draken', 180],
  ['mitmah-cave', 'Mitmah Seer', 180],
  ['cobra-cave', 'Cobras', 190],
  ['undeadragon-lair', 'Undead Dragon', 200],
  ['cliffstrider-cave', 'Cliff Strider', 200],
  ['hideous-fungus', 'Hideous Fungus', 200],
  ['magmacrawler-cave', 'Magma Crawler', 200],
  ['dreadintruder-cave', 'Dread Intruder', 200],
  ['falcon', 'Falcon', 210],
  ['vexclaw-lair', 'Vexclaw', 210],
  ['grimeleech-cave', 'Grimeleech', 220],
  ['choking-cave', 'Choking Fear', 240],
  ['crazed-cave', "Crazed Elf's", 240],
  ['guzzlemaw-cave', 'Guzzlemaw', 250],
  ['raubritter-lair', 'Raubritter', 250],
  ['catacomb-cave', 'Catacomb', 250],
  ['prison-cave', 'Prison', 250],
  ['lionknight-cave', 'Lion Knight', 270],
  ['megadragon-cave', 'Mega Dragon', 290],
  ['naga-lair', 'Naga Lair', 300],
  ['trueazura-cave', 'True Azura', 300],
  ['freakishlostsoul-cave', 'Freakish Lost Soul', 300],
  ['bulltaur-cave', 'Bulltaur', 350],
  ['gazer-lair', 'Gazer', 350],
  ['bashmu-cave', 'Bashmu', 350],
  ['inferniarch-lair', 'Inferniarch', 450],
  ['girtablilu-cave', 'girtablilu warrior', 460],
  ['livrariaice-cave', 'Livraria ICE', 500],
  ['livrariafire-cave', 'Livraria FIRE', 500],
  ['livrariaearth-cave', 'Livraria EARTH', 500],
  ['livraria-cave', 'Livraria ENERGY', 500],
  ['quararaider-lair', 'Quara Raider', 600],
  ['norcferatu-cave', 'Norcferatu Nightweaver', 600],
  ['lavafungos-cave', 'Lavafungos', 610],
  ['afflictedstrider-cave', 'Afflicted Strider', 610],
  ['varnisheddiremaw-cave', 'Varnished Diremaw', 610],
  ['crypt-cave', 'Crypt Construct', 700],
  ['gnomprona2-cave', 'Crystal Enigma', 800],
  ['rottengolem-cave', 'Rotten Golem', 800],
  ['cloakofterror-lair', 'Cloak Of Terror', 800],
  ['gnomprona1-cave', 'Monster Graveyard', 800],
  ['gnomprona3-cave', 'Sparkling Pools', 800],
  ['infernalmdemon-cave', 'Infernal Demon', 800],
  ['bonyseadevil-cave', 'Bony Sea Devil', 800],
  ['darkthais-cave', 'Dark Thais', 800],
];

export const HUNTS_TABLE = _HUNTS.map(([id, name, min]) => ({ id, name, min }));
export const HUNTS_BY_ID: Record<string, { id: string; name: string; min: number }> = Object.fromEntries(
  HUNTS_TABLE.map((h) => [h.id, h]),
);

export const PREFERRED: Record<number, string> = {
  1: 'troll-cave', 8: 'elf-lair', 9: 'amazon-camp', 10: 'minotaur', 15: 'cyclopolis',
  30: 'refiner-cave', 50: 'giant-spider', 60: 'glooth-cave', 80: 'dragon-lair',
  90: 'werebadge-cave', 100: 'hydra-cave', 130: 'wyrm-cave', 140: 'werehyaena-cave',
  150: 'asura-lair', 170: 'wereliones-cave', 180: 'draken-lair', 190: 'cobra-cave',
  200: 'undeadragon-lair', 210: 'falcon', 220: 'grimeleech-cave', 240: 'choking-cave',
  250: 'guzzlemaw-cave', 270: 'lionknight-cave', 290: 'megadragon-cave', 300: 'naga-lair',
  350: 'gazer-lair', 450: 'inferniarch-lair', 500: 'livraria-cave', 610: 'lavafungos-cave',
};

export const AOE_WORDS = [
  'exori gran', 'exori', 'exevo mas san', 'exevo gran mas vis',
  'exevo gran mas flam', 'exevo gran mas tera', 'exevo gran mas frigo',
  'exevo gran mas pox', 'berserk', 'fierce', 'caldera', 'rage of the skies',
  'eternal winter', 'wrath of nature', "hell's core",
];
export const STRIKE_WORDS = [
  'exori ico', 'exori hur', 'exori san', 'exori vis', 'exori flam',
  'exori tera', 'exori frigo', 'exori mort', 'exori con', 'brutal strike',
];
export const HEAL_WORDS = ['exura', 'heal', 'cura', 'cura automática', 'light healing', 'wound cleansing'];
export const MANA_WORDS = [
  'mana potion', 'great mana', 'strong mana', 'ultimate mana', 'mana fluid',
  'poção mp', 'pocao mp', 'potion de mana', 'mp pot',
];

export const SAMPLE_SEC = 120;
export const STALL_SEC = 60;
export const DEATH_BAN = 600;
export const PROBE_COOLDOWN = 1200;
export const PROFIT_MARGIN = 1.15;
export const SWITCH_GRACE = 45;

// Ordenado por comprimento de nome decrescente para que nomes específicos
// (ex: 'Undead Dragon', 'Mega Dragon', 'True Azura') casem antes de substrings genéricas ('Dragon Lair', 'Asuras')
const _HUNTS_MATCH_ORDER = [...HUNTS_TABLE].sort((a, b) => b.name.length - a.name.length);

export function matchHunt(wave?: string | null): { id: string; name: string; min: number } | null {
  if (!wave) return null;
  const low = wave.toLowerCase().trim();
  // 1. Tenta correspondência exata ou por nome completo mais longo
  for (const h of _HUNTS_MATCH_ORDER) {
    if (low.includes(h.name.toLowerCase()) || low.includes(h.id.toLowerCase())) {
      return h;
    }
  }
  // 2. Fallback por cleanId sem sufixos
  for (const h of _HUNTS_MATCH_ORDER) {
    const cleanId = h.id.replace(/-lair|-cave|-dungeon|-camp|-ground|-mountain|-ruins/g, '').toLowerCase();
    if (cleanId.length >= 5 && low.includes(cleanId)) {
      return h;
    }
  }
  return null;
}

export function idsFromPickerRows(rows?: Array<Record<string, any>> | null): string[] {
  const out: string[] = [];
  for (const row of rows || []) {
    if (row.locked) continue;
    if (row.goDisabled && !row.current) continue;
    const hid = String(row.id || '').trim();
    if (hid && HUNTS_BY_ID[hid]) { out.push(hid); continue; }
    const blob = `${row.name || ''} ${row.text || ''}`.trim().toLowerCase();
    if (!blob) continue;
    let hit: string | null = null;
    for (const h of HUNTS_TABLE) {
      const n = h.name.toLowerCase();
      if (blob === n || blob.startsWith(n + ' ') || ` ${blob} `.includes(` ${n} `)) { hit = h.id; break; }
    }
    if (!hit) {
      for (const h of HUNTS_TABLE) {
        if (blob.includes(h.name.toLowerCase())) { hit = h.id; break; }
      }
    }
    if (hit) out.push(hit);
  }
  return [...new Set(out)];
}

export function inferLevel(playerLevel?: number | null, unlockedIds?: string[] | null): number | null {
  let floor: number | null = null;
  if (unlockedIds && unlockedIds.length > 0) {
    const mins = unlockedIds.filter((i) => HUNTS_BY_ID[i]).map((i) => HUNTS_BY_ID[i].min);
    floor = mins.length > 0 ? Math.max(...mins) : null;
  }
  if (floor !== null) {
    if (playerLevel && Math.abs(Math.floor(playerLevel) - floor) <= 80) {
      return Math.max(Math.floor(playerLevel), floor);
    }
    return floor;
  }
  if (playerLevel && playerLevel >= 1 && playerLevel <= 100) return Math.floor(playerLevel);
  return null;
}

function blobHas(blob: string, words: readonly string[]): number {
  let n = 0;
  for (const w of words) if (blob.includes(w)) n++;
  return n;
}

function slotKit(namesBlob: string, helper?: Record<string, any> | null): Record<string, any> {
  const h = helper || {};
  const healTxt = `${namesBlob} ${h.heal || h.healSpell || ''}`.toLowerCase();
  const manaTxt = `${namesBlob} ${h.mana || h.manaPotion || ''}`.toLowerCase();
  const hpTxt = `${healTxt} ${h.hp || h.hpPotion || ''}`.toLowerCase();
  const none = ['', 'nenhuma', 'none', 'n/a'];
  const aoe = blobHas(namesBlob, AOE_WORDS);
  const strike = blobHas(namesBlob, STRIKE_WORDS);
  let heal = blobHas(healTxt, HEAL_WORDS);
  if (h.healEnabled !== false && !none.includes(h.heal ?? h.healSpell)) {
    if (String(h.heal || h.healSpell || '').trim() || h.autoHeal) heal = Math.max(heal, 1);
  }
  let mana = blobHas(manaTxt, MANA_WORDS);
  const manaName = String(h.mana || h.manaPotion || '').trim().toLowerCase();
  if (manaName && !none.includes(manaName)) mana = Math.max(mana, 1);
  if (['health potion', 'poção hp', 'pocao hp', 'hp pot'].some((x) => hpTxt.includes(x))) heal = Math.max(heal, 1);
  const attack = aoe > 0 || strike > 0;
  return { aoe, strike, heal, mana, attack, ready: attack && heal > 0 && mana > 0 };
}

export function classifyMagic(spells?: Array<Record<string, any>> | null, helpers?: Array<Record<string, any>> | null): Record<string, any> {
  const list = spells || [];
  const helpBy: Record<number, Record<string, any>> = {};
  for (const h of helpers || []) {
    if (h && typeof h === 'object' && h.slot !== undefined && h.slot !== null) helpBy[Number(h.slot)] = h;
  }
  const names = list.filter((s) => !s.empty).map((s) => String(s.name || s.title || '').toLowerCase()).join(' ');
  const filled = list.filter((s) => !s.empty && (s.name || s.title));
  let aoe = blobHas(names, AOE_WORDS);
  const strike = blobHas(names, STRIKE_WORDS);
  let heal = blobHas(names, HEAL_WORDS);
  let mana = blobHas(names, MANA_WORDS);
  let power: number;
  if (aoe) power = heal ? 3 : 2;
  else if (strike || filled.length > 0) power = 1;
  else power = 0;
  const bySlot: Record<number, string[]> = {};
  const present = new Set<number>();
  for (const s of list) {
    if (s.slot === undefined || s.slot === null) continue;
    const sid = Number(s.slot);
    present.add(sid);
    if (!s.empty) {
      if (!bySlot[sid]) bySlot[sid] = [];
      bySlot[sid].push(String(s.name || s.title || '').toLowerCase());
    }
  }
  for (const sid of Object.keys(helpBy).map(Number)) present.add(sid);
  const slots: Record<string, any> = {};
  for (const sid of [...present].sort((a, b) => a - b)) {
    const blob = (bySlot[sid] || []).join(' ');
    const kit = slotKit(blob, helpBy[sid]);
    slots[String(sid)] = kit;
    heal = Math.max(heal, kit.heal);
    mana = Math.max(mana, kit.mana);
  }
  const slot1 = present.has(1);
  const need = slot1 ? [0, 1] : (present.has(0) ? [0] : []);
  let partyReady: boolean;
  if (need.length > 0) partyReady = need.every((s) => !!(slots[String(s)] || {}).ready);
  else partyReady = power >= 1 && heal > 0 && mana > 0;
  if (partyReady && power < 2 && aoe) power = heal ? 3 : 2;
  return {
    power, aoe, strike, heal, mana,
    filled: filled.length, empty: list.filter((s) => s.empty).length,
    names: filled.map((s) => s.name || s.title || ''),
    slots, slot1_present: slot1, party_ready: !!partyReady,
  };
}

export function effectiveLevel(level: number, magic: Record<string, any>): number {
  const power = parseInt(String(magic.power ?? 0), 10) || 0;
  if (power >= 2) return level;
  if (power === 1) return Math.min(level, Math.max(50, level - 20));
  return Math.min(level, 15);
}

export function metaHuntFor(level: number, magic?: Record<string, any> | null): { id: string; name: string; min: number } {
  const m = magic || classifyMagic([]);
  const lvl = effectiveLevel(Math.max(1, level), m);
  const eligible = HUNTS_TABLE.filter((h) => h.min <= lvl);
  if (!eligible.length) return HUNTS_TABLE[0];
  const topMin = Math.max(...eligible.map((h) => h.min));
  const band = eligible.filter((h) => h.min === topMin);
  const pref = PREFERRED[topMin];
  if (pref) {
    const hit = band.find((h) => h.id === pref);
    if (hit) return hit;
  }
  return band[0];
}

function blank(name: string): Record<string, any> {
  return {
    name, total_seconds: 0.0, gold_gained: 0, kills: 0, deaths: 0,
    gold_per_hour: 0.0, kills_per_hour: 0.0, last_death_ts: 0, samples_count: 0,
  };
}

function orderKey(h: { id: string; name: string; min: number }): [number, number, string] {
  return [h.min, PREFERRED[h.min] === h.id ? 0 : 1, h.name];
}

function sortOrdered(list: Array<{ id: string; name: string; min: number }>): Array<{ id: string; name: string; min: number }> {
  return [...list].sort((a, b) => {
    const ka = orderKey(a), kb = orderKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2].localeCompare(kb[2]);
  });
}

export class HuntProfiler {
  filePath: string;
  benchmarks: Record<string, any> = {};
  homeId: string | null = null;
  probeId: string | null = null;
  failedUntil: Record<string, number> = {};
  lastProbeTs = 0;
  switchGraceUntil = 0;
  lastPlayedId: string | null = null;
  lastPlayedName: string | null = null;
  activeHuntId: string | null = null;
  activeHuntName: string | null = null;
  huntStartTime: number | null = null;
  huntStartGold: number | null = null;
  huntStartKills: number | null = null;
  lastGold: number | null = null;
  lastKills: number | null = null;
  measureT0: number | null = null;
  measureGold0: number | null = null;
  measureKills0: number | null = null;
  sessGoldH = 0;
  sessKillsH = 0;
  unlockedIds: string[] = [];
  lastDecision: Record<string, any> = {};
  simScale = 1.0;
  // compat with old Profiler usage in index.ts
  sessionDeaths = 0;
  sessionKills = 0;
  sessionWaves = 0;
  startTime = Date.now();
  currentGold = 0;
  startGold = 0;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'benchmarks.json');
    this.load();
  }

  load(): void {
    if (existsSync(this.filePath)) {
      try { this.benchmarks = JSON.parse(readFileSync(this.filePath, 'utf-8')); }
      catch (_) { this.benchmarks = {}; }
    }
    const st = (this.benchmarks._decision as Record<string, any>) || {};
    delete this.benchmarks._decision;
    this.homeId = st.home_id ?? null;
    this.probeId = st.probe_id ?? null;
    this.failedUntil = Object.fromEntries(Object.entries(st.failed_until || {}).map(([k, v]) => [k, Number(v)]));
    this.lastProbeTs = Number(st.last_probe_ts || 0);
    this.simScale = Number(st.sim_scale || 1.0);
    const lp = String(st.last_played_id || '').trim();
    const ln = String(st.last_played_name || '').trim();
    this.lastPlayedId = lp || null;
    this.lastPlayedName = ln || null;
  }

  save(): void {
    try {
      const payload: Record<string, any> = { ...this.benchmarks };
      payload._decision = {
        home_id: this.homeId, probe_id: this.probeId,
        failed_until: this.failedUntil, last_probe_ts: this.lastProbeTs,
        sim_scale: this.simScale,
        last_played_id: this.lastPlayedId, last_played_name: this.lastPlayedName,
      };
      writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (_) {}
  }

  elapsed(): number {
    return this.huntStartTime ? Math.max(0, Date.now() / 1000 - this.huntStartTime) : 0;
  }

  measureElapsed(): number {
    const t0 = this.measureT0 ?? this.huntStartTime;
    return t0 ? Math.max(0, Date.now() / 1000 - t0) : 0;
  }

  measureGoldDelta(): number {
    if (this.lastGold === null || this.measureGold0 === null) return 0;
    return Math.max(0, Math.floor(this.lastGold) - Math.floor(this.measureGold0));
  }

  measureKillDelta(): number {
    if (this.lastKills === null || this.measureKills0 === null) return 0;
    return Math.max(0, Math.floor(this.lastKills) - Math.floor(this.measureKills0));
  }

  numbersMoved(): boolean {
    if (this.lastGold === null && this.lastKills === null) return true;
    return this.measureGoldDelta() > 0 || this.measureKillDelta() > 0;
  }

  visitReady(): boolean {
    return this.measureElapsed() >= SAMPLE_SEC && this.numbersMoved();
  }

  rollSample(): void {
    this.measureT0 = Date.now() / 1000;
    this.measureGold0 = this.lastGold;
    this.measureKills0 = this.lastKills;
  }

  commitSession(curGold?: number | null, curKills?: number | null, died = false): void {
    if (!this.activeHuntId || !this.huntStartTime) return;
    const b = this.benchmarks[this.activeHuntId];
    if (!b) return;
    const now = Date.now() / 1000;
    const dur = Math.max(0, now - this.huntStartTime);
    if (dur >= 5) {
      b.total_seconds = Number(b.total_seconds || 0) + dur;
      if (curGold != null && this.huntStartGold != null) {
        b.gold_gained = Number(b.gold_gained || 0) + Math.max(0, curGold - this.huntStartGold);
      }
      if (curKills != null && this.huntStartKills != null) {
        b.kills = Number(b.kills || 0) + Math.max(0, curKills - this.huntStartKills);
      }
      if (dur >= 30) b.samples_count = Number(b.samples_count || 0) + 1;
      const sec = Number(b.total_seconds);
      if (sec >= 30) {
        b.gold_per_hour = Math.round((Number(b.gold_gained || 0) / sec) * 3600 * 10) / 10;
        b.kills_per_hour = Math.round((Number(b.kills || 0) / sec) * 3600 * 10) / 10;
      }
    }
    if (died) {
      b.deaths = Number(b.deaths || 0) + 1;
      b.last_death_ts = now;
      this.sessionDeaths++;
    }
    this.save();
  }

  startSession(huntId: string, huntName: string, curGold?: number | null, curKills?: number | null): void {
    if (this.activeHuntId && this.activeHuntId !== huntId) this.commitSession(curGold, curKills, false);
    this.activeHuntId = huntId;
    this.activeHuntName = huntName;
    this.huntStartTime = Date.now() / 1000;
    this.huntStartGold = curGold ?? null;
    this.huntStartKills = curKills ?? null;
    this.lastGold = curGold ?? null;
    this.lastKills = curKills ?? null;
    this.measureT0 = this.huntStartTime;
    this.measureGold0 = curGold ?? null;
    this.measureKills0 = curKills ?? null;
    this.sessGoldH = 0;
    this.sessKillsH = 0;
    if (!this.benchmarks[huntId]) this.benchmarks[huntId] = blank(huntName);
    else this.benchmarks[huntId].name = huntName;
    this.rememberPlayed(huntId, huntName);
  }

  rememberPlayed(huntId?: string | null, huntName?: string | null): void {
    let hid = String(huntId || '').trim();
    const name = String(huntName || '').trim();
    if (['', 'current_hunt', '—', '-', '–'].includes(hid)) hid = '';
    if (['', '—', '-', '–', 'cidade', 'city', 'conectando'].includes(name.toLowerCase())) {
      if (!hid) return;
    }
    let changed = false;
    if (hid && hid !== this.lastPlayedId) { this.lastPlayedId = hid; changed = true; }
    if (name && name !== this.lastPlayedName) { this.lastPlayedName = name; changed = true; }
    if (changed) this.save();
  }

  resumeTarget(forceId = ''): { id: string; name: string; resumeLast: boolean; mode?: string } {
    const fid = String(forceId || '').trim();
    if (fid) {
      const known = HUNTS_BY_ID[fid] || ({} as any);
      return { id: fid, name: String(known.name || fid), resumeLast: false };
    }
    return { id: this.lastPlayedId || '', name: this.lastPlayedName || '', resumeLast: true, mode: 'last' };
  }

  shouldResumeLast(autoHunt: boolean, isCity: boolean, currentId?: string | null, forceId = ''): [boolean, string] {
    const fid = String(forceId || '').trim();
    if (!autoHunt) {
      this.lastDecision = { mode: 'off', reason: 'AUTO_HUNT off', home: this.lastPlayedId };
      return [false, ''];
    }
    if (fid) {
      if (currentId === fid && !isCity) {
        const why = `FORCE_HUNT já em ${fid}`;
        this.lastDecision = { mode: 'stay', reason: why, home: fid };
        return [false, why];
      }
      const why = `FORCE_HUNT=${fid}`;
      this.lastDecision = { mode: 'force', reason: why, home: fid };
      return [true, why];
    }
    if (!isCity && currentId) {
      const label = this.lastPlayedName || currentId;
      const why = `ficar na última hunt (${label})`;
      this.lastDecision = { mode: 'stay', reason: why, home: this.lastPlayedId };
      return [false, why];
    }
    const label = this.lastPlayedName || this.lastPlayedId || 'pick-current do jogo';
    const why = `cidade/templo → última hunt: ${label}`;
    this.lastDecision = { mode: 'resume', reason: why, home: this.lastPlayedId };
    return [true, why];
  }

  markSwitch(): void {
    this.switchGraceUntil = Date.now() / 1000 + SWITCH_GRACE;
  }

  recordDeath(curGold?: number | null, curKills?: number | null): void {
    if (!this.activeHuntId) return;
    const died = Date.now() / 1000 >= this.switchGraceUntil;
    this.commitSession(curGold, curKills, died);
    this.activeHuntId = null;
    this.huntStartTime = null;
    this.measureT0 = null;
    this.sessGoldH = 0;
    this.sessKillsH = 0;
  }

  updateTick(curGold?: number | null, curKills?: number | null): void {
    if (!this.activeHuntId || !this.huntStartTime) return;
    if (curGold != null) { this.lastGold = curGold; this.currentGold = curGold; }
    if (curKills != null) { this.lastKills = curKills; this.sessionKills = curKills; }
    const elapsed = Date.now() / 1000 - this.huntStartTime;
    const gDelta = curGold != null && this.huntStartGold != null ? Math.max(0, curGold - this.huntStartGold) : 0;
    const kDelta = curKills != null && this.huntStartKills != null ? Math.max(0, curKills - this.huntStartKills) : 0;
    if (elapsed > 0) {
      this.sessGoldH = (gDelta / elapsed) * 3600;
      this.sessKillsH = (kDelta / elapsed) * 3600;
    }
    if (elapsed < 30) return;
    const b = this.benchmarks[this.activeHuntId];
    if (!b) return;
    const effSec = Number(b.total_seconds || 0) + elapsed;
    if (effSec) {
      b.gold_per_hour = Math.round(((Number(b.gold_gained || 0) + gDelta) / effSec) * 3600 * 10) / 10;
      b.kills_per_hour = Math.round(((Number(b.kills || 0) + kDelta) / effSec) * 3600 * 10) / 10;
    }
    this.save();
  }

  clearDeathPenalties(): void {
    for (const [k, b] of Object.entries(this.benchmarks)) {
      if (k.startsWith('_') || typeof b !== 'object' || !b) continue;
      (b as any).last_death_ts = 0;
      (b as any).deaths = 0;
    }
    this.failedUntil = {};
    this.sessionDeaths = 0;
    this.save();
  }

  banned(hid: string, now: number): boolean {
    const b = this.benchmarks[hid] || {};
    const ts = Number(b.last_death_ts || 0);
    if (ts && now - ts < DEATH_BAN) return true;
    if (Number(b.deaths || 0) >= 2 && ts && now - ts < 1800) return true;
    return false;
  }

  stalling(): boolean {
    if (this.measureElapsed() < STALL_SEC) return false;
    return this.measureKillDelta() <= 0;
  }

  profit(hid: string, live = false): number {
    if (live && hid === this.activeHuntId && this.measureElapsed() >= 30) {
      return this.sessGoldH + this.sessKillsH * 8;
    }
    const b = this.benchmarks[hid] || {};
    return Number(b.gold_per_hour || 0) + Number(b.kills_per_hour || 0) * 8;
  }

  sampled(hid: string): boolean {
    let sec = Number((this.benchmarks[hid] || {}).total_seconds || 0);
    if (hid === this.activeHuntId) sec += this.elapsed();
    return sec >= SAMPLE_SEC;
  }

  justifies(cand: string, home: string): boolean {
    const cp = this.profit(cand, true), hp = this.profit(home, false);
    if (hp <= 0) return cp > 0;
    return cp >= hp * PROFIT_MARGIN;
  }

  // compat helpers used by index.ts
  recordKill(kills = 1): void {
    this.sessionKills += kills;
  }

  recordTick(_hunt: string, kills: number, waves: number, gold: number, _deaths: number): void {
    this.sessionKills = kills;
    this.sessionWaves = waves;
    this.currentGold = gold;
  }

  getRates(): { killsPerHour: number; wavesPerHour: number; goldPerHour: number; elapsedMinutes: number } {
    const elapsedHours = Math.max(0.001, (Date.now() - this.startTime) / 3600000);
    const goldDiff = Math.max(0, this.currentGold - this.startGold);
    return {
      killsPerHour: Math.round(this.sessionKills / elapsedHours),
      wavesPerHour: Math.round(this.sessionWaves / elapsedHours),
      goldPerHour: Math.round(goldDiff / elapsedHours),
      elapsedMinutes: Math.round(elapsedHours * 60),
    };
  }

  nextProbe(ordered: Array<{ id: string; name: string; min: number }>, home: { id: string }, cap: number, now: number): { id: string; name: string; min: number } | null {
    const idx = ordered.findIndex((h) => h.id === home.id);
    for (const h of ordered.slice(idx + 1)) {
      if (h.min > cap || this.banned(h.id, now)) continue;
      if (now < Number(this.failedUntil[h.id] || 0)) continue;
      return h;
    }
    return null;
  }

  dropEasier(ordered: Array<{ id: string; name: string; min: number }>, live: { id: string; min: number }, now: number): { id: string; name: string; min: number } {
    const easier = ordered.filter((h) => h.min < live.min && !this.banned(h.id, now));
    if (easier.length > 0) return easier[easier.length - 1];
    return ordered.find((h) => !this.banned(h.id, now)) || ordered[0];
  }

  getBestHuntToFarm(playerLevel?: number | null, magic?: Record<string, any> | null, unlockedIds?: string[] | null): { id: string; name: string; min: number } | null {
    const m = magic || classifyMagic([]);
    if (unlockedIds) this.unlockedIds = unlockedIds;
    const level = inferLevel(playerLevel, this.unlockedIds);
    if (!level) {
      this.lastDecision = { reason: 'nível desconhecido — scan', mode: 'scan' };
      this.save();
      return null;
    }
    let enterable = HUNTS_TABLE.filter((h) => h.min <= level);
    if (this.unlockedIds.length > 0) {
      const unlocked = enterable.filter((h) => this.unlockedIds.includes(h.id));
      if (unlocked.length > 0) enterable = unlocked;
    }
    if (!enterable.length) enterable = [HUNTS_TABLE[0]];
    const ordered = sortOrdered(enterable);
    const cap = effectiveLevel(level, m);
    const now = Date.now() / 1000;
    const live = ordered.find((h) => h.id === this.activeHuntId) || null;
    const [pick, reason, mode, urgent] = this.decide(ordered, live, cap, now, level, m);
    if (mode === 'probe' && pick) this.probeId = pick.id;
    else if (mode === 'revert') {
      if (live) this.failedUntil[live.id] = now + PROBE_COOLDOWN;
      this.probeId = null;
      this.lastProbeTs = now;
    } else if (['farm', 'fallback', 'sim'].includes(mode) && pick) {
      if (['farm', 'sim'].includes(mode)) this.homeId = pick.id;
      this.probeId = null;
      if (live && pick.id === live.id && this.visitReady()) {
        const scaled = calibrateScale(live.id, this.sessGoldH, level, m);
        if (scaled) this.simScale = scaled;
        this.rollSample();
      }
    }
    this.lastDecision = {
      level, probe_cap: cap, reason, mode, urgent, best: pick, home: this.homeId, probe: this.probeId,
      magic: Object.fromEntries(['power', 'aoe', 'strike', 'heal', 'mana', 'filled', 'party_ready'].filter((k) => k in m).map((k) => [k, m[k]])),
      sim_scale: this.simScale,
      top3: ordered.slice(0, 3).map((h) => ({ id: h.id, name: h.name, profit: Math.round(this.profit(h.id) * 10) / 10 })),
    };
    this.save();
    return pick;
  }

  huntById(ordered: Array<{ id: string; name: string; min: number }>, hid?: string | null): { id: string; name: string; min: number } | null {
    return ordered.find((h) => h.id === hid) || null;
  }

  decide(
    ordered: Array<{ id: string; name: string; min: number }>,
    live: { id: string; name: string; min: number } | null,
    cap: number, now: number, level = 1, magic?: Record<string, any> | null,
  ): [{ id: string; name: string; min: number }, string, string, boolean] {
    const m = magic || classifyMagic([]);
    if (live && (this.banned(live.id, now) || this.stalling())) {
      const drop = this.dropEasier(ordered, live, now);
      return [drop, 'sobreviveu mal (morte/stall) — cair para hunt mais fácil', 'revert', true];
    }
    if (this.homeId && live && live.id !== this.homeId && this.visitReady()) {
      const home = this.huntById(ordered, this.homeId);
      if (home && !this.banned(home.id, now)) {
        if (!this.justifies(live.id, home.id)) {
          const gL = Math.round(this.profit(live.id, true) * 10) / 10;
          const gH = Math.round(this.profit(home.id) * 10) / 10;
          return [home, `probe falhou: lucro ${gL} não supera ${home.name} ${gH} — reverter`, 'revert', false];
        }
        this.homeId = live.id;
        return [live, 'probe ok: gold/h justifica o tempo; ficar e medir', 'farm', false];
      }
    }
    const ids = ordered.filter((h) => h.min <= cap).map((h) => h.id);
    const bannedSet = new Set(ordered.filter((h) => this.banned(h.id, now)).map((h) => h.id));
    const rec = recommendSwitch(ids, live ? live.id : null, level, m, this.simScale, bannedSet);
    const simH = rec ? this.huntById(ordered, rec.id) : null;
    const ready = goldFarmReady(m);
    if (rec && simH && rec.can_tank && ready) {
      if (live && live.id !== simH.id && this.visitReady()) {
        const liveP = this.profit(live.id, true);
        const sampledP = this.profit(simH.id);
        const bar = this.sampled(simH.id) && sampledP > 0 ? sampledP : Math.max(sampledP, Number(rec.gold_h || 0));
        if (bar > 0 && liveP >= bar * PROFIT_MARGIN) {
          this.homeId = live.id;
          return [live, 'amostra 15% melhor que a sim — ficar e medir', 'farm', false];
        }
      }
      if (live && live.id === simH.id) {
        if (!this.visitReady()) {
          const el = Math.floor(this.measureElapsed());
          const g = this.measureGoldDelta(), k = this.measureKillDelta();
          return [live, `sim ok; calibrar amostra (${el}s/${SAMPLE_SEC}s, +${g}g/${k}k)`, 'sample', false];
        }
      }
      if (rec.clearly_better) {
        const expS = Math.round(Number(rec.exp_h || 0));
        return [simH, `rush XP: ${simH.name} ~${expS} xp/h (maior level no menor tempo)`, 'sim', true];
      }
      if (!live) {
        const expS = Math.round(Number(rec.exp_h || 0));
        return [simH, `rush XP: ir para ${simH.name} (~${expS} xp/h)`, 'sim', false];
      }
    }
    if (live && !this.visitReady()) {
      const el = Math.floor(this.measureElapsed());
      const g = this.measureGoldDelta(), k = this.measureKillDelta();
      return [live, `amostra até números (${el}s/${SAMPLE_SEC}s, +${g}g/${k}k)`, 'sample', false];
    }
    const sampled = ordered.filter((h) => this.sampled(h.id) && !this.banned(h.id, now));
    const pool = sampled.filter((h) => !live || h.id !== live.id);
    let home = pool.length > 0 ? pool.reduce((a, b) => (this.profit(b.id) > this.profit(a.id) ? b : a)) : null;
    if (this.homeId) {
      const hid = ordered.find((h) => h.id === this.homeId && !this.banned(h.id, now)) || null;
      if (hid && (home === null || this.profit(hid.id) >= this.profit(home.id) * 0.9)) home = hid;
    }
    if (home) this.homeId = home.id;
    if (home && live && live.id !== home.id && live.min >= home.min) {
      if (!this.justifies(live.id, home.id)) {
        const gL = Math.round(this.profit(live.id, true) * 10) / 10;
        const gH = Math.round(this.profit(home.id) * 10) / 10;
        return [home, `probe falhou: lucro ${gL} não supera ${home.name} ${gH} — reverter`, 'revert', false];
      }
      this.homeId = live.id;
      return [live, 'probe ok: gold/h justifica o tempo; ficar e medir', 'farm', false];
    }
    const farm = home || (ready ? simH : null) || live || ordered[0];
    if (goldFarmReady(m) && this.huntById(ordered, STONE_ID) && ids.includes(STONE_ID)) {
      const stone = this.huntById(ordered, STONE_ID)!;
      if (!this.banned(STONE_ID, now)) {
        if (!live || live.id !== STONE_ID) return [stone, 'gold farm: Stone Refiner (magia pronta)', 'sim', true];
      }
    }
    const nxt = this.nextProbe(ordered, farm, cap, now);
    if (nxt && live && live.id === farm.id && nxt.id !== STONE_ID) {
      if (!(goldFarmReady(m) && farm.id === STONE_ID)) {
        return [nxt, `probe ${nxt.name}: testar lucro vs tempo em ${farm.name}`, 'probe', false];
      }
    }
    const tag = home ? 'lucro medido + sobrevive' : 'sem amostra — começar fácil e medir';
    if (home && live && live.id === home.id) return [farm, 'probe ok: gold/h justifica o tempo; ficar e medir', 'farm', false];
    return [farm, `ficar em ${farm.name} (${tag})`, home ? 'farm' : 'fallback', false];
  }

  shouldEnter(currentId?: string | null, best?: { id: string; name: string } | null, isCity = false, now = Date.now() / 1000, lastSwitch = 0): [boolean, string] {
    const reason = String((this.lastDecision || {}).reason || '');
    const mode = String((this.lastDecision || {}).mode || '');
    if (!best) {
      if (currentId && !isCity) return [false, ''];
      return [true, reason || 'nível desconhecido — abrir lista de hunts para analisar'];
    }
    if (isCity) return [true, reason || `cidade/templo → ${best.name} (sobrevive+lucro)`];
    if (!currentId || currentId === best.id) return [false, ''];
    if (mode === 'sample') return [false, ''];
    if (mode === 'sim') return [true, reason || `sim → ${best.name}`];
    const urgent = !!((this.lastDecision || {}).urgent);
    if (!urgent && now - lastSwitch < 90) return [false, ''];
    return [true, reason || `trocar para ${best.name} (sobrevive+lucro, não meta)`];
  }
}

export class HuntMatrix {
  filePath: string;
  matrix: Record<string, Record<string, any>> = {};

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'hunt_matrix.json');
    this.load();
  }

  load(): void {
    if (existsSync(this.filePath)) {
      try { this.matrix = JSON.parse(readFileSync(this.filePath, 'utf-8')); }
      catch (_) { this.matrix = {}; }
    }
  }

  save(): void {
    try { writeFileSync(this.filePath, JSON.stringify(this.matrix, null, 2), 'utf-8'); }
    catch (_) {}
  }

  recordTick(
    huntId: string, huntName: string, _level: number | null,
    goldPerHour: number, killsPerHour: number, wavesPerHour: number, deaths: number,
    xpPerHour?: number | string | null, lootPerHour?: number | string | null,
  ): Record<string, any> {
    if (!huntId) return {};
    const match = matchHunt(huntName);
    const minLvl = (match as any)?.min_lvl ?? (match as any)?.min ?? 1;
    let rec = this.matrix[huntId];
    if (!rec) {
      rec = {
        id: huntId, name: huntName, min_level: minLvl, samples: 0, deaths: 0,
        avg_gold_h: 0.0, max_gold_h: 0.0, avg_kills_h: 0.0, avg_waves_h: 0.0,
        xp_h_display: '—', loot_h_display: '—', safety_rating: 'SEGURO',
        category: 'EQUILIBRADO', efficiency_score: 50, last_seen_ts: Date.now() / 1000,
      };
      this.matrix[huntId] = rec;
    }
    rec.samples += 1;
    rec.deaths = Math.max(rec.deaths || 0, deaths);
    rec.last_seen_ts = Date.now() / 1000;
    if (goldPerHour > 0) {
      rec.avg_gold_h = Math.round(((rec.avg_gold_h || 0) * 0.7 + goldPerHour * 0.3) * 10) / 10;
      rec.max_gold_h = Math.max(rec.max_gold_h || 0, Math.round(goldPerHour * 10) / 10);
    }
    if (killsPerHour > 0) rec.avg_kills_h = Math.round(((rec.avg_kills_h || 0) * 0.7 + killsPerHour * 0.3) * 10) / 10;
    if (wavesPerHour > 0) rec.avg_waves_h = Math.round(((rec.avg_waves_h || 0) * 0.7 + wavesPerHour * 0.3) * 10) / 10;
    if (xpPerHour && String(xpPerHour) !== '—') rec.xp_h_display = String(xpPerHour);
    if (lootPerHour && String(lootPerHour) !== '—') rec.loot_h_display = String(lootPerHour);
    if (rec.deaths === 0) rec.safety_rating = 'SEGURO';
    else if (rec.deaths <= 2) rec.safety_rating = 'MODERADO';
    else rec.safety_rating = 'PERIGOSO';
    if (rec.deaths > 2) { rec.category = 'EVITAR (ALTA MORTALIDADE)'; rec.efficiency_score = 20; }
    else if (rec.avg_gold_h >= 100000) { rec.category = 'TOP_LUCRO (OURO ALTO)'; rec.efficiency_score = 95; }
    else if (rec.avg_kills_h >= 1000) { rec.category = 'TOP_XP (FAST CLEAR)'; rec.efficiency_score = 90; }
    else if (rec.avg_gold_h >= 10000) { rec.category = 'FARM ESTÁVEL'; rec.efficiency_score = 80; }
    else { rec.category = 'EQUILIBRADO'; rec.efficiency_score = 65; }
    this.save();
    return rec;
  }

  getRankings(): { by_profit: any[]; by_kills: any[]; all: any[] } {
    const valid = Object.values(this.matrix);
    return {
      by_profit: [...valid].sort((a, b) => (b.avg_gold_h || 0) - (a.avg_gold_h || 0)).slice(0, 5),
      by_kills: [...valid].sort((a, b) => (b.avg_kills_h || 0) - (a.avg_kills_h || 0)).slice(0, 5),
      all: valid,
    };
  }
}
