import { describe, expect, it } from 'bun:test';
import { getOptimalSpellRotation, HUNT_ELEMENT_PROFILES } from '../src/hunts';

describe('Spell Rotation & Elemental Weakness Targeting', () => {
  it('Wyrm: prioriza Terra (Earth) e Gelo (Ice), e descarta Fogo (Fire) e Energia (Energy)', () => {
    const rot = getOptimalSpellRotation('wyrm-cave');
    expect(rot.preferredElement).toBe('earth');
    expect(rot.weaknesses).toContain('earth');
    expect(rot.weaknesses).toContain('ice');
    expect(rot.resistances).toContain('fire');
    expect(rot.resistances).toContain('energy');

    // AoE deve conter magias de terra e gelo
    expect(rot.metaAoe.some((s) => s.includes('tera') || s.includes('stone shower'))).toBe(true);
    expect(rot.metaAoe.some((s) => s.includes('frigo') || s.includes('avalanche'))).toBe(true);

    // NÃO deve conter magias de fogo ou energia
    expect(rot.metaAoe.some((s) => s.includes('flam') || s.includes("hell's core"))).toBe(false);
    expect(rot.metaAoe.some((s) => s.includes('vis') || s.includes('rage of the skies'))).toBe(false);
    expect(rot.metaStrike.some((s) => s.includes('exori flam'))).toBe(false);
    expect(rot.metaStrike.some((s) => s.includes('exori vis'))).toBe(false);
  });

  it('Glooth Bandit: prioriza Físico, Energia e Fogo, evitando Terra', () => {
    const rot = getOptimalSpellRotation('glooth-cave');
    expect(rot.preferredElement).toBe('physical');
    expect(rot.weaknesses).toContain('physical');
    expect(rot.weaknesses).toContain('energy');
    expect(rot.weaknesses).toContain('fire');
    expect(rot.resistances).toContain('earth');

    expect(rot.metaAoe.some((s) => s.includes('flam') || s.includes('vis') || s.includes('exori gran'))).toBe(true);
    expect(rot.metaAoe.some((s) => s.includes('tera'))).toBe(false);
  });

  it('Dragon Lair: prioriza Gelo (Ice) e Terra (Earth), evitando Fogo (Fire)', () => {
    const rot = getOptimalSpellRotation('dragon-lair');
    expect(rot.preferredElement).toBe('ice');
    expect(rot.weaknesses).toContain('ice');
    expect(rot.resistances).toContain('fire');

    expect(rot.metaAoe.some((s) => s.includes('frigo') || s.includes('winter'))).toBe(true);
    expect(rot.metaAoe.some((s) => s.includes('flam') || s.includes("hell's core"))).toBe(false);
  });
});
