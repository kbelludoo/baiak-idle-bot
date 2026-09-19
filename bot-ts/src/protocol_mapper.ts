import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type NumericPath = { path: string; min: number; max: number; last: number; count: number };

export interface MapperSnapshot {
  startedAt: string;
  frames: number;
  byType: Record<string, number>;
  bytesByType: Record<string, number>;
  numericPaths: NumericPath[];
  samples: Record<string, any[]>;
  combat: {
    damage: number;
    taken: number;
    healing: number;
    kills: number;
    loot: number;
    events: number;
    byVocation: Record<string, { damage: number; taken: number; healing: number; hits: number }>;
    byElement: Record<string, { damage: number; hits: number }>;
    byTarget: Record<string, { damage: number; hits: number; kills: number }>;
  };
  resistances: Record<string, Record<string, number>>;
  hunts: Record<string, { startedAt: string; frames: number; damage: number; taken: number; healing: number; kills: number; loot: number; waves: number; lastWave: number; }>; 
  scores: Record<string, { xpPerHour: number; lootGoldPerHour: number; supplyGoldPerHour: number; netGoldPerHour: number; damagePerSecond: number; healingPerSecond: number; kills: number; wipeMs: number; updatedAt: string }>;
}

const MAX_SAMPLES_PER_TYPE = 3;
const MAX_NUMERIC_PATHS = 300;

function safeScalar(value: any): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function walk(value: any, path: string, output: Array<[string, number]>, depth = 0, seen = new Set<any>()): void {
  if (depth > 5 || output.length >= MAX_NUMERIC_PATHS || value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 30); i++) walk(value[i], `${path}[${i}]`, output, depth + 1, seen);
    return;
  }
  for (const [key, child] of Object.entries(value).slice(0, 80)) {
    const childPath = path ? `${path}.${key}` : key;
    if (typeof child === 'number' && Number.isFinite(child)) output.push([childPath, child]);
    else if (!safeScalar(child)) walk(child, childPath, output, depth + 1, seen);
  }
}

function numberFrom(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.replace(/\./g, '').match(/-?\d+(?:,\d+)?/);
    if (match) return Number(match[0].replace(',', '.')) || 0;
  }
  return 0;
}

function findMetric(value: any, keys: string[], depth = 0, seen = new Set<any>()): number {
  if (depth > 5 || value === null || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  if (!Array.isArray(value)) {
    for (const key of keys) {
      if (value[key] !== undefined) {
        const result = numberFrom(value[key]);
        if (result > 0) return result;
      }
    }
    for (const child of Object.values(value).slice(0, 80)) {
      const result = findMetric(child, keys, depth + 1, seen);
      if (result > 0) return result;
    }
  } else {
    for (const child of value.slice(0, 50)) {
      const result = findMetric(child, keys, depth + 1, seen);
      if (result > 0) return result;
    }
  }
  return 0;
}

export class ProtocolMapper {
  private readonly filePath: string;
  private readonly samplePath: string;
  private snapshotData: MapperSnapshot;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, 'protocol-map.json');
    this.samplePath = join(dataDir, 'protocol-samples.ndjson');
    this.snapshotData = this.load();
  }

  private load(): MapperSnapshot {
    try {
      const value = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (value && typeof value === 'object') {
        value.combat ||= {};
        value.combat.damage ||= 0;
        value.combat.taken ||= 0;
        value.combat.healing ||= 0;
        value.combat.kills ||= 0;
        value.combat.loot ||= 0;
        value.combat.events ||= 0;
        value.combat.byVocation ||= {};
        value.combat.byElement ||= {};
        value.combat.byTarget ||= {};
        value.hunts ||= {};
        value.resistances ||= {};
        value.scores ||= {};
        value.samples ||= {};
        value.byType ||= {};
        value.bytesByType ||= {};
        value.numericPaths ||= [];
        return value;
      }
    } catch (_) {}
    return {
      startedAt: new Date().toISOString(),
      frames: 0,
      byType: {},
      bytesByType: {},
      numericPaths: [],
      samples: {},
      combat: {
        damage: 0, taken: 0, healing: 0, kills: 0, loot: 0, events: 0,
        byVocation: {}, byElement: {}, byTarget: {},
      },
      hunts: {},
      resistances: {},
      scores: {},
    };
  }

  ingest(type: unknown, payload: any, bytes: number): void {
    const key = String(type ?? 'unknown');
    this.snapshotData.frames++;
    this.snapshotData.byType[key] = (this.snapshotData.byType[key] || 0) + 1;
    this.snapshotData.bytesByType[key] = (this.snapshotData.bytesByType[key] || 0) + bytes;

    const samples = this.snapshotData.samples[key] || (this.snapshotData.samples[key] = []);
    if (samples.length < MAX_SAMPLES_PER_TYPE && payload !== undefined) {
      try { samples.push(JSON.parse(JSON.stringify(payload))); } catch (_) {}
    }

    const numeric: Array<[string, number]> = [];
    walk(payload, '', numeric);
    for (const [path, value] of numeric) {
      let item = this.snapshotData.numericPaths.find((entry) => entry.path === path);
      if (!item) {
        if (this.snapshotData.numericPaths.length >= MAX_NUMERIC_PATHS) continue;
        item = { path, min: value, max: value, last: value, count: 0 };
        this.snapshotData.numericPaths.push(item);
      }
      item.min = Math.min(item.min, value);
      item.max = Math.max(item.max, value);
      item.last = value;
      item.count++;
    }

    if (key === 'joined' && payload && typeof payload === 'object' && typeof payload.huntId === 'string') {
      this.activeHunt = payload.huntId;
      if (!this.snapshotData.hunts[payload.huntId]) {
        this.snapshotData.hunts[payload.huntId] = {
          startedAt: new Date().toISOString(), frames: 0, damage: 0, taken: 0,
          healing: 0, kills: 0, loot: 0, waves: 0, lastWave: Number(payload.wave || 0),
        };
      }
    }
    this.collectCombat(payload);
    this.collectHunt(type, payload);
    this.collectResistances(payload);
    if (this.snapshotData.frames % 20 === 0) this.save();
  }

  setActiveHunt(huntId: string | null): void {
    if (huntId) this.activeHunt = huntId;
  }

  private activeHunt: string | null = null;

  private collectHunt(type: unknown, payload: any): void {
    const payloadHunt = this.currentHuntId(payload);
    if (payloadHunt) this.activeHunt = payloadHunt;
    const key = payloadHunt || this.activeHunt || 'unknown';
    const record = this.snapshotData.hunts[key] || (this.snapshotData.hunts[key] = {
      startedAt: new Date().toISOString(), frames: 0, damage: 0, taken: 0,
      healing: 0, kills: 0, loot: 0, waves: 0, lastWave: 0,
    });
    record.frames++;
    const lower = String(type).toLowerCase();
    if (lower === 'log' || lower === 'notify') record.waves++;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const loot = numberFrom(payload.lootGold ?? payload.netGold ?? payload.gold);
      if (loot > 0) { record.loot += loot; this.snapshotData.combat.loot += loot; }
      const wave = numberFrom(payload.wave ?? payload.w);
      if (wave > 0) record.lastWave = wave;
      const xpPerHour = findMetric(payload, ['xpPerHour', 'xp_h']);
      const lootGoldPerHour = findMetric(payload, ['lootGoldPerHour']);
      const supplyGoldPerHour = findMetric(payload, ['supplyGoldPerHour']);
      const netGoldPerHour = findMetric(payload, ['netGoldPerHour']);
      const wipeMs = findMetric(payload, ['msToWipe', 'wipeMs']);
      if (xpPerHour || netGoldPerHour || wipeMs) {
        const old = this.snapshotData.scores[key];
        this.snapshotData.scores[key] = {
          xpPerHour: xpPerHour || old?.xpPerHour || 0,
          lootGoldPerHour: lootGoldPerHour || old?.lootGoldPerHour || 0,
          supplyGoldPerHour: supplyGoldPerHour || old?.supplyGoldPerHour || 0,
          netGoldPerHour: netGoldPerHour || old?.netGoldPerHour || 0,
          damagePerSecond: old?.damagePerSecond || 0,
          healingPerSecond: old?.healingPerSecond || 0,
          kills: record.kills,
          wipeMs,
          updatedAt: new Date().toISOString(),
        };
      }
    }
    if (lower === 'combatlog') {
      const list = Array.isArray(payload) ? payload : [payload];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const amount = numberFrom(item.amount ?? item.damage ?? item.dmg ?? item.dealt);
        const kind = String(item.k ?? item.kind ?? '').toLowerCase();
        if (kind === 'dealt' || item.dealt !== undefined) record.damage += amount;
        if (kind === 'taken' || kind === 'received' || item.takenDamage !== undefined) record.taken += amount;
        if (kind === 'heal' || kind === 'healing' || item.heal !== undefined) record.healing += amount;
        if (item.killed === true) record.kills++;
      }
    }
    const score = this.snapshotData.scores[key];
    if (score) {
      const elapsed = Math.max(1, (Date.now() - Date.parse(record.startedAt)) / 1000);
      score.damagePerSecond = Math.round(record.damage / elapsed * 10) / 10;
      score.healingPerSecond = Math.round(record.healing / elapsed * 10) / 10;
      score.kills = record.kills;
      score.updatedAt = new Date().toISOString();
    }
  }

  private currentHuntId(payload: any): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const value = payload.huntId ?? payload.hunt?.id ?? payload.currentHuntId;
    return typeof value === 'string' && value ? value : null;
  }

  private collectResistances(payload: any): void {
    const visit = (value: any, depth = 0): void => {
      if (depth > 4 || !value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const item of value.slice(0, 40)) visit(item, depth + 1); return; }
      const name = value.name || value.monster || value.foe?.name;
      const source = value.resistances || value.resists || value.elements;
      if (typeof name === 'string' && source && typeof source === 'object' && !Array.isArray(source)) {
        const row: Record<string, number> = this.snapshotData.resistances[name] || {};
        for (const [key, raw] of Object.entries(source)) {
          const n = Number(raw);
          if (Number.isFinite(n)) row[key.toLowerCase()] = n;
        }
        if (Object.keys(row).length) this.snapshotData.resistances[name] = row;
      }
      for (const child of Object.values(value).slice(0, 40)) visit(child, depth + 1);
    };
    visit(payload);
  }

  private collectCombat(payload: any): void {
    const visit = (value: any, depth = 0): void => {
      if (depth > 4 || value === null || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 50)) visit(item, depth + 1);
        return;
      }
      const keys = Object.keys(value).map((key) => key.toLowerCase());
      const eventKind = String(value.k ?? value.kind ?? '').toLowerCase();
      const isPotionOrHeal = eventKind === 'potion' || eventKind === 'heal' || eventKind === 'healing';
      const isCombatEvent = Boolean(value.k || value.kind || value.foe || value.voc || value.vocation);
      const damage = isCombatEvent && !isPotionOrHeal && ['damage', 'dmg', 'dealt', 'amount'].some((key) => keys.includes(key));
      const taken = isCombatEvent && ['taken', 'received', 'incoming', 'takendamage', 'damagetaken'].some((key) => keys.includes(key));
      const amount = Math.max(0, numberFrom(value.damage ?? value.dmg ?? value.dealt ?? value.amount ?? value.heal));
      const vocation = String(value.voc ?? value.vocation ?? 'unknown').toLowerCase();
      const element = String(value.el ?? value.element ?? 'unknown').toLowerCase();
      const target = String(value.foe?.name ?? value.target ?? value.monster ?? 'unknown');
      if (damage) {
        this.snapshotData.combat.damage += amount;
        const row = this.snapshotData.combat.byVocation[vocation] || (this.snapshotData.combat.byVocation[vocation] = { damage: 0, taken: 0, healing: 0, hits: 0 });
        row.damage += amount; row.hits++;
        const el = this.snapshotData.combat.byElement[element] || (this.snapshotData.combat.byElement[element] = { damage: 0, hits: 0 });
        el.damage += amount; el.hits++;
        const foe = this.snapshotData.combat.byTarget[target] || (this.snapshotData.combat.byTarget[target] = { damage: 0, hits: 0, kills: 0 });
        foe.damage += amount; foe.hits++;
      }
      if (taken) {
        const row = this.snapshotData.combat.byVocation[vocation] || (this.snapshotData.combat.byVocation[vocation] = { damage: 0, taken: 0, healing: 0, hits: 0 });
        this.snapshotData.combat.taken += amount; row.taken += amount;
      }
      if (keys.some((key) => key === 'heal' || key === 'healing') || value.k === 'potion') {
        const row = this.snapshotData.combat.byVocation[vocation] || (this.snapshotData.combat.byVocation[vocation] = { damage: 0, taken: 0, healing: 0, hits: 0 });
        this.snapshotData.combat.healing += amount; row.healing += amount;
      }
      if (value.killed === true || value.dead === true) {
        this.snapshotData.combat.kills++;
        const foe = this.snapshotData.combat.byTarget[target] || (this.snapshotData.combat.byTarget[target] = { damage: 0, hits: 0, kills: 0 });
        foe.kills++;
      }
      if (keys.some((key) => key.includes('loot') || key.includes('drop'))) this.snapshotData.combat.loot++;
      this.snapshotData.combat.events++;
      for (const child of Object.values(value).slice(0, 50)) visit(child, depth + 1);
    };
    visit(payload);
  }

  save(): void {
    try { writeFileSync(this.filePath, JSON.stringify(this.snapshotData, null, 2)); } catch (_) {}
  }

  saveSample(type: unknown, payload: any): void {
    try {
      appendFileSync(this.samplePath, JSON.stringify({ at: new Date().toISOString(), type, payload }) + '\n');
    } catch (_) {}
  }

  snapshot(): MapperSnapshot {
    return JSON.parse(JSON.stringify(this.snapshotData));
  }
}
