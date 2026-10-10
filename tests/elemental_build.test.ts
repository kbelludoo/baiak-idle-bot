import { describe, expect, it } from 'bun:test';
import { getOptimalSpellRotation, HUNT_ELEMENT_PROFILES } from '../src/hunts';

describe('Elemental Hunt & Spell Rotation Optimization', () => {
  it('Dragon Lair: prioriza Gelo (Ice) e Terra (Earth), evitando Fogo (Fire)', () => {
    const rot = getOptimalSpellRotation('dragon-lair');
    expect(rot.preferredElement).toBe('ice');
    expect(rot.weaknesses).toContain('ice');
    expect(rot.resistances).toContain('fire');

    // As magias de gelo devem vir no topo de AoE
    const topAoe = rot.metaAoe.slice(0, 6);
    expect(topAoe.some((s) => s.includes('frigo') || s.includes('winter'))).toBe(true);

    // Magias de fogo NÃO devem aparecer na lista de recomendação
    expect(rot.metaAoe.some((s) => s.includes('flam') || s.includes("hell's core"))).toBe(false);
    expect(rot.metaStrike.some((s) => s.includes('exori flam'))).toBe(false);
  });

  it('Stone Refiner: prioriza Energia (Energy) e Terra (Earth), evitando Físico e Fogo', () => {
    const rot = getOptimalSpellRotation('refiner-cave');
    expect(rot.preferredElement).toBe('energy');
    expect(rot.weaknesses).toContain('energy');
    expect(rot.resistances).toContain('physical');
    expect(rot.resistances).toContain('fire');

    const topAoe = rot.metaAoe.slice(0, 6);
    expect(topAoe.some((s) => s.includes('vis') || s.includes('skies'))).toBe(true);
    expect(rot.metaAoe.some((s) => s.includes('exori gran'))).toBe(false);
  });

  it('Undead Dragon: prioriza Sagrado (Holy) e Fogo (Fire), evitando Gelo, Terra e Morte', () => {
    const rot = getOptimalSpellRotation('undeadragon-lair');
    expect(rot.preferredElement).toBe('holy');
    expect(rot.weaknesses).toContain('holy');
    expect(rot.weaknesses).toContain('fire');
    expect(rot.resistances).toContain('death');

    expect(rot.metaAoe.some((s) => s.includes('mas san') || s.includes('caldera'))).toBe(true);
    expect(rot.metaStrike.some((s) => s.includes('exori mort'))).toBe(false);
  });

  it('Asuras: prioriza Gelo e Fogo/Sagrado, evitando Terra', () => {
    const rot = getOptimalSpellRotation('asura-lair');
    expect(rot.preferredElement).toBe('ice');
    expect(rot.weaknesses).toContain('ice');
    expect(rot.resistances).toContain('earth');

    expect(rot.metaAoe.some((s) => s.includes('frigo') || s.includes('flam'))).toBe(true);
    expect(rot.metaAoe.some((s) => s.includes('tera'))).toBe(false);
  });

  it('Hydra: prioriza Energia e Fogo, evitando Terra e Gelo', () => {
    const rot = getOptimalSpellRotation('hydra-cave');
    expect(rot.preferredElement).toBe('energy');
    expect(rot.weaknesses).toContain('energy');
    expect(rot.resistances).toContain('earth');
    expect(rot.resistances).toContain('ice');

    expect(rot.metaAoe.some((s) => s.includes('vis') || s.includes('flam'))).toBe(true);
    expect(rot.metaAoe.some((s) => s.includes('frigo') || s.includes('tera'))).toBe(false);
  });
});
