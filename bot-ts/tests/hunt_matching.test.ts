import { describe, expect, it } from 'bun:test';
import { matchHunt } from '../src/hunts';

export function normalizeHuntToken(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[-_'\s]+/g, '')
    .replace(/([a-z])\1+/g, '$1') // colapsa letras repetidas (ex: dd -> d para undead-dragon vs undeadragon)
    .replace(/(s|es)$/, ''); // singulariza
}

export function findHuntRow(rows: Array<{ id: string; name: string }>, target: { id?: string; name?: string }): { id: string; name: string } | null {
  const rawId = (target.id || '').toLowerCase();
  const rawName = (target.name || '').toLowerCase();

  // 1. Exato por ID
  if (rawId) {
    const exact = rows.find(r => r.id.toLowerCase() === rawId);
    if (exact) return exact;
  }

  // 2. Normalizado EXATO (sem includes): "dragon" ⊂ "undeadragon"/"megadragon",
  // então includes() clicava na hunt errada. Comparação sempre exata.
  const wantId = target.id ? normalizeHuntToken(target.id) : '';
  const wantName = target.name ? normalizeHuntToken(target.name) : '';

  const exactHit = rows.find(r => {
    if (wantId && normalizeHuntToken(r.id) === wantId) return true;
    if (wantName && normalizeHuntToken(r.name) === wantName) return true;
    return false;
  });
  if (exactHit) return exactHit;

  // 3. Base sem sufixo, ainda exata (tolerando "cobra" -> cobra-cave,
  // "undead-dragon" -> undeadragon-lair via normalizeToken).
  if (wantId) {
    const wantBase = normalizeHuntToken(target.id!.replace(/-lair|-cave|-dungeon|-camp|-ground/g, ''));
    const baseHit = rows.find(r =>
      normalizeHuntToken(r.id.replace(/-lair|-cave|-dungeon|-camp|-ground/g, '')) === wantBase);
    if (baseHit) return baseHit;
  }
  return null;
}

describe('Hunt Matching & Normalization', () => {
  const sampleRows = [
    { id: 'asura-lair', name: 'Asuras' },
    { id: 'dragon-lair', name: 'Dragon Lair' },
    { id: 'undeadragon-lair', name: 'Undead Dragon' },
    { id: 'megadragon-cave', name: 'Mega Dragon' },
    { id: 'cobra-cave', name: 'Cobras' },
    { id: 'glooth-cave', name: 'Glooth Bandit' },
  ];

  it('encontra Asuras por ID e por nome', () => {
    expect(findHuntRow(sampleRows, { id: 'asura-lair' })?.id).toBe('asura-lair');
    expect(findHuntRow(sampleRows, { name: 'Asuras' })?.id).toBe('asura-lair');
    expect(findHuntRow(sampleRows, { name: 'Asura' })?.id).toBe('asura-lair');
  });

  it('encontra Undead Dragon por variantes (undead-dragon, undead-dragons, undeadragon-lair)', () => {
    expect(findHuntRow(sampleRows, { id: 'undeadragon-lair' })?.id).toBe('undeadragon-lair');
    expect(findHuntRow(sampleRows, { id: 'undead-dragon' })?.id).toBe('undeadragon-lair');
    expect(findHuntRow(sampleRows, { id: 'undead-dragons' })?.id).toBe('undeadragon-lair');
    expect(findHuntRow(sampleRows, { name: 'Undead Dragon' })?.id).toBe('undeadragon-lair');
    expect(findHuntRow(sampleRows, { name: 'Undead Dragons' })?.id).toBe('undeadragon-lair');
  });

  it('encontra Cobras por variantes (cobra-cave, cobra, cobras)', () => {
    expect(findHuntRow(sampleRows, { id: 'cobra-cave' })?.id).toBe('cobra-cave');
    expect(findHuntRow(sampleRows, { id: 'cobra' })?.id).toBe('cobra-cave');
    expect(findHuntRow(sampleRows, { name: 'Cobras' })?.id).toBe('cobra-cave');
    expect(findHuntRow(sampleRows, { name: 'Cobra' })?.id).toBe('cobra-cave');
  });

  it('matchHunt do módulo hunts reconhece nomes de sala em tempo real', () => {
    expect(matchHunt('Asuras 3/10')?.id).toBe('asura-lair');
    expect(matchHunt('Undead Dragon 5/10')?.id).toBe('undeadragon-lair');
    expect(matchHunt('Cobras 1/10')?.id).toBe('cobra-cave');
    expect(matchHunt('Glooth Bandit 8/10')?.id).toBe('glooth-cave');
  });

  it('REGRESSÃO VPS1: dragon-lair nunca casa com undead/mega dragon', () => {
    // Seleção exata por ID
    expect(findHuntRow(sampleRows, { id: 'dragon-lair' })?.id).toBe('dragon-lair');
    expect(findHuntRow(sampleRows, { id: 'undeadragon-lair' })?.id).toBe('undeadragon-lair');
    expect(findHuntRow(sampleRows, { id: 'megadragon-cave' })?.id).toBe('megadragon-cave');
    // Seleção por nome
    expect(findHuntRow(sampleRows, { name: 'Dragon Lair' })?.id).toBe('dragon-lair');
    expect(findHuntRow(sampleRows, { name: 'Undead Dragon' })?.id).toBe('undeadragon-lair');
    // matchHunt: variante com hífen não pode cair no Dragon Lair
    expect(matchHunt('undead-dragon')?.id).toBe('undeadragon-lair');
    expect(matchHunt('undead-dragons')?.id).toBe('undeadragon-lair');
    expect(matchHunt('Dragon Lair 3/10')?.id).toBe('dragon-lair');
    expect(matchHunt('Undead Dragon')?.id).toBe('undeadragon-lair');
    expect(matchHunt('Mega Dragon')?.id).toBe('megadragon-cave');
  });
});
