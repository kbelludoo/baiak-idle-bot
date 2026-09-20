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
  hunts: Record<string, { startedAt: string; frames: number; damage: number; taken: number; healing: number; kills: number; loot: number; xp: number; waves: number; lastWave: number; }>;
  scores: Record<string, { xpPerHour: number; lootGoldPerHour: number; supplyGoldPerHour: number; netGoldPerHour: number; damagePerSecond: number; healingPerSecond: number; kills: number; wipeMs: number; updatedAt: string; sampleSeconds?: number; sampleReady?: boolean; source?: string }>;
  unlockedHunts: string[];
  lastOfflineInfo?: any;
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
  // Janela de medição do processo atual. O arquivo histórico pode ter meses
  // de frames; nunca usamos esse tempo acumulado para calcular XP/h ou gold/h.
  private liveWindows = new Map<string, { startedAt: number; xp: number; loot: number; kills: number }>();

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
        for (const row of Object.values(value.hunts) as any[]) {
          if (row && typeof row === 'object') {
            row.frames ||= 0; row.damage ||= 0; row.taken ||= 0; row.healing ||= 0;
            row.kills ||= 0; row.loot ||= 0; row.xp = Number(row.xp || 0) || 0;
            row.waves ||= 0; row.lastWave ||= 0;
          }
        }
        value.resistances ||= {};
        value.scores ||= {};
        value.unlockedHunts ||= [];
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
      unlockedHunts: [],
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
          healing: 0, kills: 0, loot: 0, xp: 0, waves: 0, lastWave: Number(payload.wave || 0),
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

  /** Histórico persistido não conta como medição desta execução. */
  sampleReadyFor(huntId: string, sampleSec = 120): boolean {
    const hid = String(huntId || '').trim();
    const win = this.liveWindows.get(hid);
    const row = this.snapshotData.hunts[hid];
    if (!win || !row) return false;
    const elapsedSec = Math.max(0, (Date.now() - win.startedAt) / 1000);
    const xp = Math.max(0, Number(row.xp || 0) - win.xp);
    const loot = Math.max(0, Number(row.loot || 0) - win.loot);
    const kills = Math.max(0, Number(row.kills || 0) - win.kills);
    return elapsedSec >= Math.max(1, sampleSec) && (xp > 0 || loot > 0 || kills > 0);
  }

  sampleSecondsFor(huntId: string): number {
    const win = this.liveWindows.get(String(huntId || '').trim());
    return win ? Math.max(0, (Date.now() - win.startedAt) / 1000) : 0;
  }

  /** XP ganho desde o início deste processo, independente do HUD/analyzer. */
  sessionXp(): number {
    let total = 0;
    for (const [hid, win] of this.liveWindows.entries()) {
      const row = this.snapshotData.hunts[hid];
      if (!row) continue;
      total += Math.max(0, Number(row.xp || 0) - Number(win.xp || 0));
    }
    return Math.floor(total);
  }

  private activeHunt: string | null = null;

  private collectHunt(type: unknown, payload: any): void {
    const payloadHunt = this.currentHuntId(payload);
    if (payloadHunt) this.activeHunt = payloadHunt;
    const key = payloadHunt || this.activeHunt || 'unknown';
    const record = this.snapshotData.hunts[key] || (this.snapshotData.hunts[key] = {
      startedAt: new Date().toISOString(), frames: 0, damage: 0, taken: 0,
      healing: 0, kills: 0, loot: 0, xp: 0, waves: 0, lastWave: 0,
    });
    if (!this.liveWindows.has(key)) {
      this.liveWindows.set(key, {
        startedAt: Date.now(), xp: Number(record.xp || 0), loot: Number(record.loot || 0),
        kills: Number(record.kills || 0),
      });
    }
    record.frames++;
    const lower = String(type).toLowerCase();
    // offlineInfo is the authoritative game preview: it already contains the
    // hunts cleared by the character and the server's measured XP/gold rates.
    // Keep it instead of relying only on the DOM analyzer, which is absent in
    // battery-save/headless sessions.
    if (lower === 'offlineinfo' && payload && typeof payload === 'object') {
      const cleared = Array.isArray(payload.cleared) ? payload.cleared : [];
      this.snapshotData.unlockedHunts = cleared
        .map((h: any) => typeof h === 'string' ? h : h?.id)
        .filter((h: any): h is string => typeof h === 'string' && h.length > 0);
      this.snapshotData.lastOfflineInfo = payload;
      for (const preview of Array.isArray(payload.previews) ? payload.previews : []) {
        const hid = typeof preview?.huntId === 'string' ? preview.huntId : null;
        if (hid) this.recordServerScore(hid, preview);
      }
    }
    if (lower === 'offlinereport' && payload && typeof payload === 'object') {
      const report = payload.hunt && typeof payload.hunt === 'object' ? payload.hunt : null;
      const hid = report?.huntId;
      const elapsedMs = Number(payload.elapsedMs || payload.awayMs || 0);
      if (typeof hid === 'string' && report && elapsedMs > 0) {
        this.recordServerScore(hid, {
          xpPerHour: Number(report.xp || 0) * 3600000 / elapsedMs,
          lootGoldPerHour: Number(report.lootGold || 0) * 3600000 / elapsedMs,
          supplyGoldPerHour: Number(report.supplyGold || 0) * 3600000 / elapsedMs,
          netGoldPerHour: Number(report.netGold || 0) * 3600000 / elapsedMs,
          msToWipe: Number(report.wipePenalty || 0),
        });
        const row = this.snapshotData.hunts[hid] || (this.snapshotData.hunts[hid] = {
          startedAt: new Date().toISOString(), frames: 0, damage: 0, taken: 0,
          healing: 0, kills: 0, loot: 0, xp: 0, waves: 0, lastWave: 0,
        });
        row.xp += Number(report.xp || 0) || 0;
        row.loot += Number(report.lootGold || 0) || 0;
        row.kills += Number(report.kills || 0) || 0;
      }
      this.updateLiveScore(hid, this.snapshotData.hunts[hid]);
      return;
    }
    if (lower === 'log' || lower === 'notify') record.waves++;
    if (payload && typeof payload === 'object') {
      // Combate/logs podem vir como uma lista de eventos. A versão anterior
      // só lia o objeto raiz e perdia XP/loot emitidos por item.
      this.collectEconomy(payload, record);
      const wave = numberFrom(payload.wave ?? payload.w);
      if (wave > 0) record.lastWave = wave;
      const xpPerHour = findMetric(payload, ['xpPerHour', 'xp_h']);
      const lootGoldPerHour = findMetric(payload, ['lootGoldPerHour']);
      const supplyGoldPerHour = findMetric(payload, ['supplyGoldPerHour']);
      const netGoldPerHour = findMetric(payload, ['netGoldPerHour']);
      const wipeMs = findMetric(payload, ['msToWipe', 'wipeMs']);
      // `findMetric` retorna 0 tanto para campo ausente quanto para um zero
      // explícito. Só substitua pelo histórico quando a chave não existir;
      // uma taxa zero do servidor é um dado válido, não um motivo para
      // ressuscitar o gold/h de uma amostra antiga.
      const hasMetric = (keys: string[]): boolean => {
        const visit = (value: any, depth = 0, seen = new Set<any>()): boolean => {
          if (depth > 5 || value === null || typeof value !== 'object' || seen.has(value)) return false;
          seen.add(value);
          if (Array.isArray(value)) return value.some((child) => visit(child, depth + 1, seen));
          for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(value, key)) return true;
          }
          return Object.values(value).slice(0, 80).some((child) => visit(child, depth + 1, seen));
        };
        return visit(payload);
      };
      if (hasMetric(['xpPerHour', 'xp_h', 'lootGoldPerHour', 'supplyGoldPerHour', 'netGoldPerHour', 'msToWipe', 'wipeMs'])) {
        const old = this.snapshotData.scores[key];
        const keepOrUse = (value: number, keys: string[], previous: number): number =>
          hasMetric(keys) ? value : previous;
      this.snapshotData.scores[key] = {
          xpPerHour: keepOrUse(xpPerHour, ['xpPerHour', 'xp_h'], old?.xpPerHour || 0),
          lootGoldPerHour: keepOrUse(lootGoldPerHour, ['lootGoldPerHour'], old?.lootGoldPerHour || 0),
          supplyGoldPerHour: keepOrUse(supplyGoldPerHour, ['supplyGoldPerHour'], old?.supplyGoldPerHour || 0),
          netGoldPerHour: keepOrUse(netGoldPerHour, ['netGoldPerHour'], old?.netGoldPerHour || 0),
          damagePerSecond: old?.damagePerSecond || 0,
          healingPerSecond: old?.healingPerSecond || 0,
          kills: record.kills,
          wipeMs,
          updatedAt: new Date().toISOString(),
          sampleSeconds: this.sampleSecondsFor(key),
          sampleReady: this.sampleReadyFor(key),
          source: 'frame',
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
      score.sampleSeconds = this.sampleSecondsFor(key);
      score.sampleReady = this.sampleReadyFor(key);
      score.updatedAt = new Date().toISOString();
    }
    this.updateLiveScore(key, record);
  }

  private collectEconomy(value: any, record: MapperSnapshot['hunts'][string], depth = 0, seen = new Set<any>()): void {
    if (depth > 5 || value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 80)) this.collectEconomy(item, record, depth + 1, seen);
      return;
    }
    const obj = value as Record<string, any>;
    // Somente campos de ganho explícitos. `amount` isolado é dano/cura e não
    // pode ser confundido com gold.
    const loot = numberFrom(
      obj.lootGold ?? obj.goldLoot ?? obj.lootValue ?? obj.goldAmount ??
      obj.coinsGained ?? obj.rewardGold ?? obj.params?.lootGold ?? obj.params?.gold,
    );
    if (loot > 0) { record.loot += loot; this.snapshotData.combat.loot += loot; }
    const xp = numberFrom(
      obj.xp ?? obj.experience ?? obj.exp ?? obj.xpGain ?? obj.experienceGained ?? obj.params?.xp ?? obj.params?.experience,
    );
    if (xp > 0) record.xp += xp;
    for (const [name, child] of Object.entries(obj)) {
      if (name === 'params' && child === obj) continue;
      if (child && typeof child === 'object') this.collectEconomy(child, record, depth + 1, seen);
    }
  }

  private updateLiveScore(hid: string, record?: MapperSnapshot['hunts'][string]): void {
    if (!hid || !record) return;
    const base = this.liveWindows.get(hid);
    if (!base) return;
    const elapsedMs = Date.now() - base.startedAt;
    if (elapsedMs < 15_000) return;
    const xp = Math.max(0, Number(record.xp || 0) - base.xp);
    const loot = Math.max(0, Number(record.loot || 0) - base.loot);
    const kills = Math.max(0, Number(record.kills || 0) - base.kills);
    if (xp <= 0 && loot <= 0 && kills <= 0) return;
    const factor = 3_600_000 / elapsedMs;
    const old = this.snapshotData.scores[hid];
    const liveLootH = loot * factor;
    const liveSupplyH = Number(old?.supplyGoldPerHour || 0);
    const liveNetH = liveSupplyH > 0 ? liveLootH - liveSupplyH : liveLootH;
    this.snapshotData.scores[hid] = {
      xpPerHour: xp > 0 ? xp * factor : old?.xpPerHour || 0,
      lootGoldPerHour: liveLootH > 0 ? liveLootH : old?.lootGoldPerHour || 0,
      supplyGoldPerHour: liveSupplyH,
      netGoldPerHour: (liveLootH > 0 || liveSupplyH > 0) ? liveNetH : old?.netGoldPerHour || 0,
      damagePerSecond: old?.damagePerSecond || 0,
      healingPerSecond: old?.healingPerSecond || 0,
      kills,
      wipeMs: old?.wipeMs || 0,
      updatedAt: new Date().toISOString(),
      sampleSeconds: this.sampleSecondsFor(hid),
      sampleReady: this.sampleReadyFor(hid),
      source: 'live-window',
    };
  }

  /** Registra os números do Hunt Analyzer, mesmo quando o WS não os envia. */
  recordAnalyzer(hid: string, analyzer: any): void {
    if (!hid || !analyzer || typeof analyzer !== 'object') return;
    const parse = (v: any): number => numberFrom(v);
    const xp = parse(analyzer.xp_per_hour ?? analyzer.xpPerHour);
    const loot = parse(analyzer.loot_per_hour ?? analyzer.lootGoldPerHour ?? analyzer.loot?.perHour);
    const supply = parse(analyzer.supply_per_hour ?? analyzer.supplyGoldPerHour ?? analyzer.supply?.perHour);
    const balanceKeys = ['net_gold_per_hour', 'netGoldPerHour', 'balance_per_hour'];
    const balanceKey = balanceKeys.find((key) => Object.prototype.hasOwnProperty.call(analyzer, key));
    const balance = balanceKey ? parse(analyzer[balanceKey]) : 0;
    if (xp <= 0 && loot <= 0 && supply <= 0 && balance <= 0) return;
    const old = this.snapshotData.scores[hid];
    this.snapshotData.scores[hid] = {
      xpPerHour: xp || old?.xpPerHour || 0,
      lootGoldPerHour: loot || old?.lootGoldPerHour || 0,
      supplyGoldPerHour: supply || old?.supplyGoldPerHour || 0,
      netGoldPerHour: balanceKey
        ? balance
        : (loot || old?.lootGoldPerHour || 0) - (supply || old?.supplyGoldPerHour || 0),
      damagePerSecond: old?.damagePerSecond || 0,
      healingPerSecond: old?.healingPerSecond || 0,
      kills: parse(analyzer.hunt_kills ?? analyzer.kills) || old?.kills || 0,
      wipeMs: old?.wipeMs || 0,
      updatedAt: new Date().toISOString(),
      sampleSeconds: this.sampleSecondsFor(hid),
      sampleReady: this.sampleReadyFor(hid),
      source: 'analyzer',
    };
    this.save();
  }

  private recordServerScore(hid: string, raw: any): void {
    if (!hid || !raw || typeof raw !== 'object') return;
    const old = this.snapshotData.scores[hid];
    const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(raw, key);
    const num = (key: string): number => Number(raw[key] ?? 0) || 0;
    const valueOrOld = (key: string, previous: number): number => has(key) ? num(key) : previous;
    const loot = valueOrOld('lootGoldPerHour', old?.lootGoldPerHour || 0);
    const supply = valueOrOld('supplyGoldPerHour', old?.supplyGoldPerHour || 0);
    const net = has('netGoldPerHour') ? num('netGoldPerHour') : loot - supply;
    this.snapshotData.scores[hid] = {
      xpPerHour: valueOrOld('xpPerHour', old?.xpPerHour || 0),
      lootGoldPerHour: loot,
      supplyGoldPerHour: supply,
      netGoldPerHour: net,
      damagePerSecond: old?.damagePerSecond || 0,
      healingPerSecond: old?.healingPerSecond || 0,
      kills: old?.kills || 0,
      wipeMs: num('msToWipe') || num('wipeMs') || old?.wipeMs || 0,
      updatedAt: new Date().toISOString(),
      sampleSeconds: this.sampleSecondsFor(hid),
      sampleReady: this.sampleReadyFor(hid),
      source: 'server-preview',
    };
  }

  private currentHuntId(payload: any): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const value = payload.huntId ?? payload.hunt?.id ?? payload.hunt?.huntId ?? payload.currentHuntId;
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
      // Captura defesa/armor do player quando disponível
      if (value.defense !== undefined || value.armor !== undefined || value.playerDefense !== undefined) {
        const playerKey = 'player';
        const row: Record<string, number> = this.snapshotData.resistances[playerKey] || {};
        if (value.defense !== undefined) row.defense = Number(value.defense);
        if (value.armor !== undefined) row.armor = Number(value.armor);
        if (value.playerDefense !== undefined) row.defense = Number(value.playerDefense);
        if (Object.keys(row).length) this.snapshotData.resistances[playerKey] = row;
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
