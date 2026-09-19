import { describe, expect, it } from 'bun:test';
import { damageTakenPct, shouldAbortSample, sampleReady, chooseExplorationTarget } from '../src/exploration';
import { effectiveDamage, simulateHunt } from '../src/hunt_sim';

describe('Controlled hunt exploration', () => {
  const policy = { sampleSec: 120, maxDeaths: 0, maxDamageTakenPct: 35, cooldownSec: 1200 };

  it('converts observed incoming damage into HP/min risk', () => {
    expect(damageTakenPct({ huntId: 'x', elapsedSec: 60, damageTaken: 350, maxHp: 1000, deaths: 0, kills: 2, gold: 0 })).toBe(35);
  });

  it('aborts a sample on death or excessive incoming damage', () => {
    expect(shouldAbortSample({ huntId: 'x', elapsedSec: 60, damageTaken: 400, maxHp: 1000, deaths: 0, kills: 2, gold: 0 }, policy).abort).toBe(true);
    expect(shouldAbortSample({ huntId: 'x', elapsedSec: 60, damageTaken: 0, maxHp: 1000, deaths: 1, kills: 2, gold: 0 }, policy).abort).toBe(true);
  });

  it('requires a complete sample before using it', () => {
    expect(sampleReady({ huntId: 'x', elapsedSec: 119, damageTaken: 0, maxHp: 1000, deaths: 0, kills: 2, gold: 0 }, policy)).toBe(false);
    expect(sampleReady({ huntId: 'x', elapsedSec: 120, damageTaken: 0, maxHp: 1000, deaths: 0, kills: 2, gold: 0 }, policy)).toBe(true);
  });

  it('chooses the best survivable candidate without forcing a hop when already there', () => {
    expect(chooseExplorationTarget([{ id: 'safe', can_tank: true, exp_h: 100 }, { id: 'deadly', can_tank: false, exp_h: 1000 }], null, policy)?.id).toBe('safe');
    expect(chooseExplorationTarget([{ id: 'safe', can_tank: true, exp_h: 100 }], 'safe', policy)).toBeNull();
  });

  it('prefers observed XP and net gold over stale simulation values', () => {
    const sim = simulateHunt('grimreaper-cave', 306, { power: 2, aoe: 2, heal: 1 }, 1, {
      xpPerHour: 1234567,
      netGoldPerHour: 234567,
      damagePerSecond: 1200,
      wipeMs: 0,
    });
    expect(sim?.exp_h).toBe(1234567);
    expect(sim?.gold_h).toBe(234567);
    expect(sim?.observed_damage_s).toBe(1200);
  });

  it('applies enemy elemental resistance to effective DPS', () => {
    expect(effectiveDamage({ fire: 100, ice: 100 }, { fire: 0.5, ice: -0.2 })).toBe(170);
  });

  it('marks hunts without resistance data as assumed instead of pretending it is known', () => {
    const sim = simulateHunt('grimreaper-cave', 306, { power: 2, aoe: 2, heal: 1 });
    expect(sim?.resistance_source).toBe('assumed');
  });
});
