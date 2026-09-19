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

  // 2. Normalizado com colapso de duplicatas e sufixos
  const wantId = target.id ? normalizeHuntToken(target.id.replace(/-lair|-cave|-dungeon|-camp|-ground/g, '')) : '';
  const wantName = target.name ? normalizeHuntToken(target.name) : '';

  return rows.find(r => {
    const rowIdNorm = normalizeHuntToken(r.id.replace(/-lair|-cave|-dungeon|-camp|-ground/g, ''));
    const rowNameNorm = normalizeHuntToken(r.name);

    if (wantId && (rowIdNorm === wantId || rowIdNorm.includes(wantId) || wantId.includes(rowIdNorm))) return true;
    if (wantName && (rowNameNorm === wantName || rowNameNorm.includes(wantName) || wantName.includes(rowNameNorm))) return true;
    return false;
  }) || null;
}

describe('Hunt Matching & Normalization', () => {
  const sampleRows = [
    { id: 'asura-lair', name: 'Asuras' },
    { id: 'undeadragon-lair', name: 'Undead Dragon' },
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
});
