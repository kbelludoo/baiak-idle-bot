import { describe, expect, test } from 'bun:test';
import {
  BEST_EQUIPMENT_CATALOG,
  RECOMMENDED_FARMING_ROADMAP,
  getRecommendedGear,
  getBestInSlotBySlot,
  getFarmingRecommendationForLevel,
} from '../src/best_in_slot';

describe('Best in Slot & Farming Roadmap', () => {
  test('Catálogo contém equipamentos BiS cadastrados para Paladin e Knight', () => {
    expect(BEST_EQUIPMENT_CATALOG.length).toBeGreaterThan(10);

    const falconBow = BEST_EQUIPMENT_CATALOG.find((i) => i.name === 'falcon bow');
    expect(falconBow).toBeDefined();
    expect(falconBow?.vocation).toBe('paladin');
    expect(falconBow?.tierRank).toBe('BiS');
    expect(falconBow?.farmLocations[0].monster).toBe('Grand Master Oberon');

    const falconPlate = BEST_EQUIPMENT_CATALOG.find((i) => i.name === 'falcon plate');
    expect(falconPlate).toBeDefined();
    expect(falconPlate?.vocation).toBe('knight');
    expect(falconPlate?.stats.protection).toContain('12% Physical');
  });

  test('getRecommendedGear filtra por vocação e limite de nível', () => {
    const paladinGear150 = getRecommendedGear('paladin', 150);
    expect(paladinGear150.every((i) => i.levelReq <= 150)).toBe(true);
    expect(paladinGear150.some((i) => i.name === 'falcon bow')).toBe(false); // Lvl 300
    expect(paladinGear150.some((i) => i.name === 'rift crossbow')).toBe(true); // Lvl 120

    const knightGear300 = getRecommendedGear('knight', 300);
    expect(knightGear300.some((i) => i.name === 'falcon longsword')).toBe(true);
  });

  test('getBestInSlotBySlot agrupa o item de maior nível por slot', () => {
    const bisPaladin = getBestInSlotBySlot('paladin', 300);
    expect(bisPaladin.weapon?.name).toBe('falcon bow');
    expect(bisPaladin.helmet?.name).toBe('falcon coif');
    expect(bisPaladin.legs?.name).toBe('falcon greaves');
    expect(bisPaladin.quiver?.name).toBe('naga quiver');

    const bisKnight = getBestInSlotBySlot('knight', 300);
    expect(bisKnight.armor?.name).toBe('falcon plate');
    expect(bisKnight.shield?.name).toBe('falcon shield');
  });

  test('getFarmingRecommendationForLevel indica a hunt e foco corretos', () => {
    const lvl10 = getFarmingRecommendationForLevel(10);
    expect(lvl10.bracket).toContain('1 a 50');
    expect(lvl10.recommendedHunts.some((h) => h.huntId === 'troll-cave')).toBe(true);

    const lvl90 = getFarmingRecommendationForLevel(90);
    expect(lvl90.bracket).toContain('50 a 130');
    expect(lvl90.recommendedHunts.some((h) => h.huntId === 'glooth-cave')).toBe(true);

    const lvl250 = getFarmingRecommendationForLevel(250);
    expect(lvl250.bracket).toContain('210 a 350');
    expect(lvl250.recommendedHunts.some((h) => h.huntId === 'raubritter-lair')).toBe(true);

    const lvl400 = getFarmingRecommendationForLevel(400);
    expect(lvl400.bracket).toContain('350+');
    expect(lvl400.recommendedHunts.some((h) => h.huntId === 'darkthais-cave')).toBe(true);
  });
});
