import { describe, expect, it } from 'bun:test';
import { calibrateDamageFormula, prepareDamageRows, type DamageSample } from '../src/formula_calibrator';
import { JevEngine } from '../src/jev';

function samples(): DamageSample[] {
  return Array.from({ length: 20 }, (_, i) => {
    const level = 100 + i * 10;
    const power = i % 4;
    const aoe = 1 + (i % 3);
    const party = i % 2 === 0;
    const dps = 10 + level * 0.8 + power * 12 + aoe * 7 + (party ? 25 : 0);
    const alive = 4;
    const spawnS = 0.1;
    const ttk = 1000 / dps;
    const uptimeSec = 3600;
    const kills = Math.round((alive * 3600 * uptimeSec) / ((ttk + spawnS) * uptimeSec));
    return { level, power, aoe, party, avgHp: 1000, alive, spawnS, kills, uptimeSec, huntId: `hunt-${i % 3}` };
  });
}

describe('Formula calibration', () => {
  it('filters invalid/spawn-capped rows and keeps valid observations', () => {
    const rows = prepareDamageRows([...samples(), {
      level: 100, avgHp: 1000, alive: 4, spawnS: 20, kills: 20, uptimeSec: 120,
    }]);
    expect(rows.length).toBe(20);
    expect(rows.every((row) => row.dps > 0 && row.ttk > 0)).toBe(true);
  });

  it('selects a model using held-out validation error', () => {
    const result = calibrateDamageFormula(samples());
    expect(result.rows.length).toBe(20);
    expect(result.best).not.toBeNull();
    expect(result.candidates.length).toBe(3);
    expect(result.best!.validationError).toBeLessThan(0.1);
  });

  it('does not adopt a formula when there are too few observations', async () => {
    const engine = new JevEngine({ enabled: false, apiKey: '' });
    const result = await engine.evaluateFormulaCandidates(samples().slice(0, 5));
    expect(result.adopted).toBe(false);
    expect(result.source).toBe('fallback');
    expect(result.best).toBeNull();
  });
});
