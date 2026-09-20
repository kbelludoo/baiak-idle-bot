import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProtocolMapper } from '../src/protocol_mapper';
import { HuntMatrix } from '../src/hunts';

describe('ProtocolMapper', () => {
  it('catalogs combatlog damage, healing, kills and target breakdown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baiak-mapper-'));
    const mapper = new ProtocolMapper(dir);
    mapper.ingest('joined', { huntId: 'grimreaper-cave', wave: 1 }, 40);
    mapper.ingest('combatlog', [
      { k: 'dealt', voc: 'sorcerer', foe: { name: 'Grim Reaper' }, amount: 521, el: 'energy' },
      { k: 'potion', voc: 'sorcerer', amount: 600, mana: true },
      { k: 'dealt', voc: 'druid', foe: { name: 'Banshee' }, amount: 713, el: 'ice', crit: true, killed: true },
    ], 200);
    mapper.save();
    const snapshot = mapper.snapshot();
    expect(snapshot.frames).toBe(2);
    expect(snapshot.combat.damage).toBeGreaterThanOrEqual(1234);
    expect(snapshot.combat.healing).toBeGreaterThanOrEqual(600);
    expect(snapshot.combat.kills).toBeGreaterThanOrEqual(1);
    expect(snapshot.combat.byVocation.sorcerer.damage).toBe(521);
    expect(snapshot.combat.byElement.energy.damage).toBe(521);
    expect(snapshot.combat.byTarget.Banshee.kills).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, 'protocol-map.json'), 'utf8')).byType.combatlog).toBe(1);
  });

  it('uses server offline previews as unlocked hunts and measured rates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baiak-mapper-offline-'));
    const mapper = new ProtocolMapper(dir);
    mapper.ingest('offlineInfo', {
      cleared: [{ id: 'troll-cave', name: 'Troll Cave' }],
      previews: [{ huntId: 'troll-cave', xpPerHour: 1200, lootGoldPerHour: 800, netGoldPerHour: 500, msToWipe: 0 }],
    }, 100);
    const snapshot = mapper.snapshot();
    expect(snapshot.unlockedHunts).toEqual(['troll-cave']);
    expect(snapshot.scores['troll-cave']?.xpPerHour).toBe(1200);
    expect(snapshot.scores['troll-cave']?.netGoldPerHour).toBe(500);
  });

  it('keeps XP/loot emitted inside combat arrays and accepts the live analyzer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baiak-mapper-live-'));
    const mapper = new ProtocolMapper(dir);
    mapper.ingest('joined', { huntId: 'glooth-cave', wave: 1 }, 20);
    mapper.ingest('combatlog', [
      { k: 'loot', lootGold: 250, xp: 900 },
      { k: 'dealt', amount: 100, el: 'physical' },
    ], 100);
    mapper.recordAnalyzer('glooth-cave', {
      xp_per_hour: '2.382.438', loot_per_hour: '243.087',
      hunt_kills: 8,
    });
    const snapshot = mapper.snapshot();
    expect(snapshot.hunts['glooth-cave']?.xp).toBeGreaterThanOrEqual(900);
    expect(snapshot.hunts['glooth-cave']?.loot).toBeGreaterThanOrEqual(250);
    expect(snapshot.scores['glooth-cave']?.xpPerHour).toBe(2382438);
    expect(snapshot.scores['glooth-cave']?.lootGoldPerHour).toBe(243087);
    expect(snapshot.scores['glooth-cave']?.kills).toBe(8);
  });

  it('preserva taxas pt-BR com separador de milhar na matriz de hunts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baiak-matrix-rate-'));
    const matrix = new HuntMatrix(dir);
    const row = matrix.recordTick('glooth-cave', 'Glooth Bandit', 132,
      1110934, 1200, 900, 0, '3.242.959', '1.110.934');
    expect(row.avg_xp_h).toBe(3242959);
    expect(row.avg_loot_h).toBe(1110934);
  });

  it('calcula o saldo líquido quando o analyzer informa suprimentos sem balance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baiak-mapper-net-'));
    const mapper = new ProtocolMapper(dir);
    mapper.recordAnalyzer('wyrm-cave', {
      xp_per_hour: 5000000,
      loot_per_hour: 400000,
      supply_per_hour: 150000,
    });
    expect(mapper.snapshot().scores['wyrm-cave']?.netGoldPerHour).toBe(250000);
  });

  it('preserva balance zero/negativo explícito em vez de voltar ao loot bruto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baiak-mapper-negative-'));
    const mapper = new ProtocolMapper(dir);
    mapper.recordAnalyzer('wyrm-cave', {
      xp_per_hour: 5000000,
      loot_per_hour: 400000,
      supply_per_hour: 500000,
      net_gold_per_hour: -100000,
    });
    expect(mapper.snapshot().scores['wyrm-cave']?.netGoldPerHour).toBe(-100000);
  });

  it('não ressuscita gold/h antigo quando o preview do servidor informa zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baiak-mapper-preview-zero-'));
    const mapper = new ProtocolMapper(dir);
    mapper.ingest('offlineInfo', {
      previews: [{ huntId: 'troll-cave', xpPerHour: 1200, lootGoldPerHour: 800, supplyGoldPerHour: 300, netGoldPerHour: 500 }],
    }, 100);
    mapper.ingest('offlineInfo', {
      previews: [{ huntId: 'troll-cave', xpPerHour: 0, lootGoldPerHour: 0, supplyGoldPerHour: 0, netGoldPerHour: 0 }],
    }, 100);
    const score = mapper.snapshot().scores['troll-cave'];
    expect(score?.xpPerHour).toBe(0);
    expect(score?.lootGoldPerHour).toBe(0);
    expect(score?.supplyGoldPerHour).toBe(0);
    expect(score?.netGoldPerHour).toBe(0);
  });

  it('preserva zero explícito também em frames de estado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baiak-mapper-frame-zero-'));
    const mapper = new ProtocolMapper(dir);
    mapper.ingest('joined', { huntId: 'troll-cave', wave: 1 }, 20);
    mapper.ingest('state', { huntId: 'troll-cave', xpPerHour: 1200, lootGoldPerHour: 800, netGoldPerHour: 500 }, 40);
    mapper.ingest('state', { huntId: 'troll-cave', xpPerHour: 0, lootGoldPerHour: 0, supplyGoldPerHour: 0, netGoldPerHour: 0 }, 40);
    const score = mapper.snapshot().scores['troll-cave'];
    expect(score?.xpPerHour).toBe(0);
    expect(score?.lootGoldPerHour).toBe(0);
    expect(score?.netGoldPerHour).toBe(0);
  });
});
