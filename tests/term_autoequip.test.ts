import { describe, expect, it } from 'bun:test';
import {
  allowed,
  itemBase,
  itemScore,
  planEquips,
  sendEquip,
  sendUnequip,
  type CatalogEntry,
  type InventoryItem,
} from '../src/term/autoequip';

const SWORD: CatalogEntry = { id: 1, slot: 'weapon', atk: 50, level: 10, vocs: ['knight', 'paladin'] };
const SHIELD: CatalogEntry = { id: 2, slot: 'shield', def: 30, level: 5 };
const RUNE: CatalogEntry = { id: 3, slot: 'rune', atk: 10 };
const NONE: CatalogEntry = { id: 4 };

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return { name: 'iron sword', tier: 0, upLevel: 0, ftier: 0, uid: 1, hash: 'h1', location: 'bag', ...over };
}

describe('auto-equip do driver terminal', () => {
  it('itemBase usa atk, depois def, depois arm', () => {
    expect(itemBase(SWORD)).toBe(50);
    expect(itemBase({ slot: 'shield', def: 30 })).toBe(30);
    expect(itemBase({ slot: 'armor', arm: 12 })).toBe(12);
    expect(itemBase(undefined)).toBe(0);
    expect(itemBase(NONE)).toBe(0);
  });

  it('itemScore soma a fórmula do jogo com o bônus de forja', () => {
    const base = itemScore(item({ tier: 0 }), SWORD);
    const upado = itemScore(item({ tier: 0, upLevel: 3 }), SWORD);
    const raridade = itemScore(item({ tier: 4 }), SWORD);
    const forjado = itemScore(item({ ftier: 7 }), SWORD);
    expect(upado).toBeGreaterThan(base);
    expect(raridade).toBeGreaterThan(base);
    expect(forjado).toBeGreaterThan(base);
    expect(forjado - base).toBe(35);
  });

  it('allowed regras do navegador: slot, vocação, nível e itens nunca-equipados', () => {
    expect(allowed(SWORD, 'iron sword', 'knight', 20)).toBe(true);
    expect(allowed(NONE, 'iron sword', 'knight', 20)).toBe(false); // sem slot
    expect(allowed(SWORD, 'iron sword', 'druid', 20)).toBe(false); // vocação
    expect(allowed(SWORD, 'iron sword', 'knight', 4)).toBe(false); // nível
    expect(allowed(RUNE, 'sudden death rune', 'knight', 99)).toBe(false);
    expect(allowed(SHIELD, 'great health potion', 'knight', 99)).toBe(false);
    expect(allowed(SHIELD, 'arrow', 'knight', 99)).toBe(false);
  });

  it('plano equipa só quando o item é estritamente melhor que o equipado', () => {
    const inv = [
      item({ name: 'weak sword', location: 'equipped', tier: 0, hash: 'eq1', charId: 7 }),
      item({ name: 'strong sword', tier: 3, hash: 'cand', charId: null }),
      item({ name: 'junk sword', tier: 0, hash: 'junk' }),
    ];
    const catalog: Record<string, CatalogEntry> = {
      'weak sword': { ...SWORD, atk: 10 },
      'strong sword': { ...SWORD, atk: 90 },
      'junk sword': { ...SWORD, atk: 5 },
    };
    const plan = planEquips(inv, catalog, { charId: 7, vocation: 'knight', level: 100, minTier: 0 });
    expect(plan).toHaveLength(1);
    expect(plan[0].slot).toBe('weapon');
    expect(plan[0].name).toBe('strong sword');
    expect(plan[0].from).toContain('weak sword');
    expect(plan[0].gain).toBeGreaterThan(0);
  });

  it('não toca quando o equipado já é o melhor', () => {
    const inv = [
      item({ name: 'strong sword', location: 'equipped', tier: 5, hash: 'eq', charId: 7 }),
      item({ name: 'weak sword', tier: 0, hash: 'cand' }),
    ];
    const catalog: Record<string, CatalogEntry> = {
      'strong sword': { ...SWORD, atk: 90 },
      'weak sword': { ...SWORD, atk: 10 },
    };
    expect(planEquips(inv, catalog, { charId: 7, vocation: 'knight', level: 100, minTier: 0 })).toHaveLength(0);
  });

  it('minTier segura itens abaixo da raridade mínima (padrão do jogo é épico=3)', () => {
    const inv = [item({ name: 'common sword', tier: 2, hash: 'c2' })];
    const catalog: Record<string, CatalogEntry> = { 'common sword': SWORD };
    expect(planEquips(inv, catalog, { charId: 1, vocation: 'knight', level: 100, minTier: 3 })).toHaveLength(0);
    expect(planEquips(inv, catalog, { charId: 1, vocation: 'knight', level: 100, minTier: 2 })).toHaveLength(1);
  });

  it('ignora item equipado em outro personagem e item fora do catálogo', () => {
    const inv = [
      item({ name: 'equipped elsewhere', location: 'equipped', tier: 5, hash: 'x', charId: 99 }),
      item({ name: 'sem catalogo', tier: 5, hash: 'y' }),
    ];
    const catalog: Record<string, CatalogEntry> = { 'equipped elsewhere': SWORD };
    // equipado em outro char não pode servir de referência para este slot
    const plan = planEquips(inv, catalog, { charId: 1, vocation: 'knight', level: 100, minTier: 0 });
    expect(plan).toHaveLength(0);
  });

  it('plano sai ordenado pelo maior ganho', () => {
    const inv = [
      item({ name: 'w1', location: 'equipped', tier: 0, hash: 'e1', charId: 1 }),
      item({ name: 'a1', location: 'equipped', tier: 0, hash: 'e2', charId: 1 }),
      item({ name: 'best weapon', tier: 4, hash: 'bw' }),
      item({ name: 'best armor', tier: 4, hash: 'ba' }),
    ];
    const catalog: Record<string, CatalogEntry> = {
      w1: { ...SWORD, atk: 1 },
      'best weapon': { ...SWORD, atk: 100 },
      a1: { slot: 'armor', arm: 50 },
      'best armor': { slot: 'armor', arm: 90 },
    };
    const plan = planEquips(inv, catalog, { charId: 1, vocation: 'knight', level: 100, minTier: 0 });
    expect(plan.length).toBe(2);
    expect(plan[0].gain).toBeGreaterThanOrEqual(plan[1].gain);
    expect(plan[0].slot).toBe('weapon');
    expect(plan.map((d) => d.slot).sort()).toEqual(['armor', 'weapon']);
  });

  it('sendEquip manda o payload exato do protocolo (uid/to/slot/hash)', () => {
    const sent: Array<{ type: string; payload: any }> = [];
    const room: any = { send: (type: string, payload: any) => { sent.push({ type, payload }); return true; } };
    sendEquip(room, { slot: 'weapon', hash: 'abc123', uid: 42 } as any, 2);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('equip');
    expect(sent[0].payload).toEqual({ uid: 42, to: 'weapon', slot: 2, hash: 'abc123' });

    sendUnequip(room, 'shield', 1);
    expect(sent[1].type).toBe('unequip');
    expect(sent[1].payload).toEqual({ from: 'shield', slot: 1 });
  });
});
