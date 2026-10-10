import { describe, expect, test } from 'bun:test';
import {
  gameExpForLevel,
  gameBlessingCost,
  gameItemValue,
  gameAddonBonus,
  gameMountPerks,
  gameForgePerkPercent,
  gameSlotToForgePerk,
  gameEffectiveForgePerks,
  gameCharmUnlockCost,
  gameVipDiscount,
  gameCharmRespecCost,
  gameMonsterFormula,
  gameEstimatedLevel,
  gameRoundEstimatedLevel,
  gameAggregateHunt,
  GAME_SPELL_FORMULAS,
  GAME_VOCATIONS,
  GAME_PLAYER_TIMINGS,
} from '../src/game_formula';

describe('Game Engine Formulas (Oficiais do Bundle)', () => {
  test('Curva de XP e Nível (Sj)', () => {
    expect(gameExpForLevel(1)).toBe(0);
    expect(gameExpForLevel(2)).toBe(100);
    expect(gameExpForLevel(8)).toBe(4200);
    expect(gameExpForLevel(100)).toBe(15694800);
    expect(gameExpForLevel(300)).toBe(441084800);
  });

  test('Custo de Bênção / Blessing (Dye)', () => {
    expect(gameBlessingCost(8)).toBe(5000);
    expect(gameBlessingCost(9)).toBe(10000);
    expect(gameBlessingCost(10)).toBe(20000);
    expect(gameBlessingCost(5)).toBe(5000); // Nível abaixo de 8 usa base
  });

  test('Valor de Item com Tier e Upgrade (KL)', () => {
    const base = 1000;
    expect(gameItemValue(base, 0, 0)).toBe(1000);
    expect(gameItemValue(base, 1, 0)).toBe(1500); // +50% tier 1
    expect(gameItemValue(base, 2, 0)).toBe(2000); // +100% tier 2
    expect(gameItemValue(base, 0, 3)).toBe(1300); // +30% upgrade +3
    expect(gameItemValue(base, 2, 5)).toBe(2500); // +100% + 50%
  });

  test('Vocações e Atributos Base (F0)', () => {
    expect(GAME_VOCATIONS.knight.hpPerLevel).toBe(15);
    expect(GAME_VOCATIONS.knight.manaPerLevel).toBe(5);
    expect(GAME_VOCATIONS.paladin.hpPerLevel).toBe(10);
    expect(GAME_VOCATIONS.paladin.manaPerLevel).toBe(15);
    expect(GAME_VOCATIONS.sorcerer.hpPerLevel).toBe(5);
    expect(GAME_VOCATIONS.sorcerer.manaPerLevel).toBe(30);
  });

  test('Bônus de Addons (Lk / W$)', () => {
    const ekAddon = gameAddonBonus('knight', 10);
    expect(ekAddon.hpFlat).toBe(500);
    expect(ekAddon.mpFlat).toBe(100);
    expect(ekAddon.skill).toBe(2); // 10 / 5 = +2 melee

    const rpAddon = gameAddonBonus('paladin', 12);
    expect(rpAddon.hpFlat).toBe(360);
    expect(rpAddon.mpFlat).toBe(360);
    expect(rpAddon.skill).toBe(2); // 12 / 5 = +2 distance
  });

  test('Benefícios de Montarias em Ciclo (Ree / Dee)', () => {
    const perks1 = gameMountPerks(1);
    expect(perks1.staminaMaxAddMin).toBe(15);

    const perks5 = gameMountPerks(5);
    expect(perks5.staminaMaxAddMin).toBe(15);
    expect(perks5.pouchSlots).toBe(1);
    expect(perks5.exerciseRegenMult).toBe(1.01);
  });

  test('Forja de Tier e Slots (d4e / ql / $2)', () => {
    expect(gameSlotToForgePerk('weapon')).toBe('onslaught');
    expect(gameSlotToForgePerk('helmet')).toBe('momentum');
    expect(gameSlotToForgePerk('armor')).toBe('ruse');
    expect(gameSlotToForgePerk('legs')).toBe('transcendence');
    expect(gameSlotToForgePerk('boots')).toBe('amplification');

    // Onslaught tier 1: 0.05 * 1^2 + 0.4 * 1 + 0.05 = 0.50%
    expect(gameForgePerkPercent('onslaught', 1)).toBeCloseTo(0.5, 4);
    // Onslaught tier 2: 0.05 * 4 + 0.4 * 2 + 0.05 = 1.05%
    expect(gameForgePerkPercent('onslaught', 2)).toBeCloseTo(1.05, 4);
    // Momentum tier 1: 0.05 * 1 + 1.9 * 1 + 0.05 = 2.00%
    expect(gameForgePerkPercent('momentum', 1)).toBeCloseTo(2.0, 4);
  });

  test('Efeito Amplificado da Forja (vE / m4e / u4e / p4e)', () => {
    const effective = gameEffectiveForgePerks({
      onslaught: 1.05,
      onslaughtTier: 2,
      momentum: 2.0,
      ruse: 0.5,
      transcendence: 0.12,
      amplification: 10, // +10% de boost das botas
    });

    expect(effective.momentumPct).toBeCloseTo(2.2, 4); // 2.0 * 1.10 = 2.2
    expect(effective.rusePct).toBeCloseTo(0.55, 4); // 0.5 * 1.10 = 0.55
  });

  test('Charms e Bestiário (n6e / i6e / xae)', () => {
    // n6e: 25*t^2 + 25*t + 50
    expect(gameCharmUnlockCost(0)).toBe(50);
    expect(gameCharmUnlockCost(1)).toBe(100);
    expect(gameCharmUnlockCost(2)).toBe(200);

    // VIP discount (25% off)
    expect(gameVipDiscount(100, true)).toBe(75);
    expect(gameVipDiscount(100, false)).toBe(100);

    // Respec cost
    expect(gameCharmRespecCost(100, false)).toBe(1000000);
    expect(gameCharmRespecCost(100, true)).toBe(750000);
  });

  test('Fórmulas Oficiais de Magias (eo)', () => {
    // exura cura: [lvl*0.2 + ml*1.4 + 8, lvl*0.2 + ml*1.795 + 11]
    const exura = GAME_SPELL_FORMULAS.exura(100, 20);
    expect(exura[0]).toBeCloseTo(100 * 0.2 + 20 * 1.4 + 8, 2);
    expect(exura[1]).toBeCloseTo(100 * 0.2 + 20 * 1.795 + 11, 2);

    // Knight exori
    const exori = GAME_SPELL_FORMULAS.exori(150, 0, 50, 90);
    const n = (150 / 3 + (50 + 90) * 3.5) * 1.5;
    expect(exori[0]).toBeCloseTo(n * 0.75, 2);
    expect(exori[1]).toBeCloseTo(n, 2);

    // Paladin exori con
    const exoriCon = GAME_SPELL_FORMULAS.exori_con(100, 50);
    expect(exoriCon[0]).toBeCloseTo(100 * 0.2 + 50 * 2.3 + 7, 2);
    expect(exoriCon[1]).toBeCloseTo(100 * 0.2 + 50 * 4.3 + 13, 2);

    // Sudden Death Rune
    const sd = GAME_SPELL_FORMULAS.sudden_death(100, 70);
    expect(sd[0]).toBeCloseTo(100 / 3.5 + 70 * 6, 2);
    expect(sd[1]).toBeCloseTo(100 / 3.5 + 70 * 9, 2);
  });

  test('Monstro ECR e Hunt Aggregation (K4e / Z4e / X4e / J4e)', () => {
    const facts = {
      hp: 1000,
      exp: 800,
      dmg: [50, 100] as [number, number],
      abilities: [{ min: 30, max: 70, chance: 20 }],
      loot: [{ chance: 50000, max: 2, value: 10 }],
    };

    const monsterCalc = gameMonsterFormula(facts);
    expect(monsterCalc.effectiveHp).toBeGreaterThan(0);
    expect(monsterCalc.dps).toBeGreaterThan(0);
    expect(monsterCalc.ecr).toBeGreaterThan(0);

    const estLvl = gameEstimatedLevel(monsterCalc.ecr);
    expect(estLvl).toBeGreaterThan(0);
    expect(gameRoundEstimatedLevel(estLvl)).toBeGreaterThan(0);

    const hunt = gameAggregateHunt([{ facts, weight: 1 }]);
    expect(hunt.ecr).toBeCloseTo(monsterCalc.ecr, 2);
    expect(hunt.expPerKill).toBe(800);
  });

  test('Cooldowns Globais e Crítico Base (Lr)', () => {
    expect(GAME_PLAYER_TIMINGS.spells.attackGroupMs).toBe(2000);
    expect(GAME_PLAYER_TIMINGS.spells.healGroupMs).toBe(1000);
    expect(GAME_PLAYER_TIMINGS.spells.supportGroupMs).toBe(2000);
    expect(GAME_PLAYER_TIMINGS.player.baseCritChance).toBe(5);
    expect(GAME_PLAYER_TIMINGS.player.baseCritDmg).toBe(10);
  });
});
