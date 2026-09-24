import { describe, expect, it } from 'bun:test';
import { selectNextBoss, SoftwareBossRunner } from '../src/boss_runner';

describe('SoftwareBossRunner', () => {
  it('selects the first available boss when no cooldowns exist', () => {
    const playlist = ['black_vixen', 'sharpclaw', 'darkfang'];
    const cooldowns = {};
    const charges = 20;
    const now = 1000000;

    const next = selectNextBoss(playlist, cooldowns, charges, now);
    expect(next).toBe('black_vixen');
  });

  it('skips bosses currently on cooldown', () => {
    const playlist = ['black_vixen', 'sharpclaw', 'darkfang'];
    const now = 1000000;
    const cooldowns = {
      black_vixen: now + 50000, // On cooldown for another 50s
    };
    const charges = 19;

    const next = selectNextBoss(playlist, cooldowns, charges, now);
    expect(next).toBe('sharpclaw');
  });

  it('returns null when boss charges are 0', () => {
    const playlist = ['black_vixen', 'sharpclaw'];
    const cooldowns = {};
    const charges = 0;

    const next = selectNextBoss(playlist, cooldowns, charges);
    expect(next).toBeNull();
  });

  it('returns null when all playlist bosses are in cooldown', () => {
    const playlist = ['black_vixen', 'sharpclaw'];
    const now = 2000000;
    const cooldowns = {
      black_vixen: now + 3600000,
      sharpclaw: now + 7200000,
    };
    const charges = 5;

    const next = selectNextBoss(playlist, cooldowns, charges, now);
    expect(next).toBeNull();
  });

  it('initializes in IDLE state with 0 kills', () => {
    const runner = new SoftwareBossRunner();
    const status = runner.getStatus();
    expect(status.state).toBe('IDLE');
    expect(status.activeBossId).toBeNull();
    expect(status.killsToday).toBe(0);
  });
});
