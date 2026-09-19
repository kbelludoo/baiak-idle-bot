import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProtocolMapper } from '../src/protocol_mapper';

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
});
