import { describe, expect, it } from 'bun:test';
import { helperTrigger } from '../src/helper_triggers';

const base = { level: 100, previousLevel: 100, partySignature: 'a', previousPartySignature: 'a', magic: { filled: 4, party_ready: true }, magicSignature: 'a', previousMagicSignature: 'a', now: 100000, lastRun: 0 };

describe('Helper trigger policy', () => {
  it('runs on level unlock and party changes', () => {
    expect(helperTrigger({ ...base, level: 101 }).run).toBe(true);
    expect(helperTrigger({ ...base, partySignature: 'b' }).run).toBe(true);
  });
  it('runs when magic/helper is incomplete', () => {
    const result = helperTrigger({ ...base, magic: { filled: 2, party_ready: false } });
    expect(result.run).toBe(true);
    expect(result.reasons).toContain('party/helper incompleto');
  });
  it('runs immediately for critical HP or mana despite cooldown', () => {
    expect(helperTrigger({ ...base, hpPct: 30, lastRun: 99000 }).run).toBe(true);
    expect(helperTrigger({ ...base, manaPct: 20, lastRun: 99000 }).run).toBe(true);
  });
  it('does not repeat a stable configuration during cooldown', () => {
    expect(helperTrigger({ ...base, lastRun: 99000 }).run).toBe(false);
  });
});
