import { describe, expect, it } from 'bun:test';
import {
  calculateAverageWeaponHit,
  calculateAverageSpellHit,
  estimateTotalCombatDps,
  evaluateItemUpgrade,
  parseItemAttributes,
  scoreBuildTreeNode,
  type CharacterProfile,
  type ItemAttributes,
  type HuntProfile,
} from '../src/build_optimizer';

describe('Build & DPS Optimizer', () => {
  const pally: CharacterProfile = {
    vocation: 'paladin',
    level: 240,
    magicLevel: 37,
    distanceSkill: 109,
    meleeSkill: 14,
    shieldingSkill: 87,
  };

  const knight: CharacterProfile = {
    vocation: 'knight',
    level: 374,
    magicLevel: 13,
    distanceSkill: 14,
    meleeSkill: 105,
    shieldingSkill: 90,
  };

  const asurasHunt: HuntProfile = {
    huntId: 'asura-lair',
    preferredElement: 'ice',
    weaknesses: ['ice', 'holy', 'physical'],
    resistances: ['earth'],
  };

  it('calcula dano de arma para Paladino com arco e bônus de upgrade', () => {
    const bow: ItemAttributes = {
      name: 'Warsinger Bow',
      slot: 'weapon',
      rarity: 3,
      ftier: 2,
      upLevel: 7,
      attack: 46,
      range: 6,
      hitChance: 5,
    };

    const avgHit = calculateAverageWeaponHit(pally, bow, asurasHunt);
    expect(avgHit).toBeGreaterThan(250);
    expect(Number.isFinite(avgHit)).toBe(true);
  });

  it('calcula dano de arma para Knight com arma corpo a corpo', () => {
    const sword: ItemAttributes = {
      name: 'Blade of Corruption',
      slot: 'weapon',
      rarity: 4,
      ftier: 1,
      upLevel: 5,
      attack: 52,
    };

    const avgHit = calculateAverageWeaponHit(knight, sword, asurasHunt);
    expect(avgHit).toBeGreaterThan(200);
  });

  it('calcula dano e DPS de magia considerando fraqueza elemental (ex: Holy/Mas San em Asuras)', () => {
    const holyRes = calculateAverageSpellHit(pally, 'exevo mas san', asurasHunt);
    expect(holyRes.avgHit).toBeGreaterThan(150);
    expect(holyRes.dps).toBeGreaterThan(30);
  });

  it('avalia upgrade de arma comparando delta DPS', () => {
    const currentBow: ItemAttributes = {
      name: 'Elvish Bow',
      slot: 'weapon',
      rarity: 2,
      ftier: 0,
      upLevel: 2,
      attack: 38,
      range: 5,
    };

    const betterBow: ItemAttributes = {
      name: 'Mythic Bow of Destruction',
      slot: 'weapon',
      rarity: 4,
      ftier: 2,
      upLevel: 8,
      attack: 55,
      range: 6,
      bonusDistance: 4,
    };

    const evalResult = evaluateItemUpgrade(currentBow, betterBow, pally, asurasHunt);
    expect(evalResult.isUpgrade).toBe(true);
    expect(evalResult.deltaDps).toBeGreaterThan(0);
    expect(evalResult.reason).toContain('Upgrade de Dano');
  });

  it('rejeita item de dano inferior', () => {
    const currentSword: ItemAttributes = {
      name: 'Slayer of Destruction +10',
      slot: 'weapon',
      rarity: 4,
      ftier: 3,
      upLevel: 10,
      attack: 56,
      bonusMelee: 5,
    };

    const weakSword: ItemAttributes = {
      name: 'Broadsword +0',
      slot: 'weapon',
      rarity: 1,
      ftier: 0,
      upLevel: 0,
      attack: 26,
    };

    const evalResult = evaluateItemUpgrade(currentSword, weakSword, knight, asurasHunt);
    expect(evalResult.isUpgrade).toBe(false);
    expect(evalResult.deltaDps).toBeLessThanOrEqual(0);
  });

  it('extrai atributos numéricos de texto de tooltip', () => {
    const tipText = 'Warsinger Bow +8 (Tier 3). Atk: 46, Def: 25, Range: 6, Hit% +5, Distance: +3, Magic Level: +1';
    const parsed = parseItemAttributes(tipText);

    expect(parsed.attack).toBe(46);
    expect(parsed.defense).toBe(25);
    expect(parsed.range).toBe(6);
    expect(parsed.hitChance).toBe(5);
    expect(parsed.bonusDistance).toBe(3);
    expect(parsed.bonusMagicLevel).toBe(1);
  });

  it('pontua nós da árvore de Build priorizando dano ofensivo para Paladino e Knight', () => {
    const pallyCritNode = scoreBuildTreeNode('+5% Dano Crítico e +3 Distância com Arco', 'paladin');
    const pallyDefNode = scoreBuildTreeNode('+200 Vida Máxima e +10 Armadura', 'paladin');
    expect(pallyCritNode).toBeGreaterThan(pallyDefNode);

    const knightMeleeNode = scoreBuildTreeNode('+8% Dano Corpo a Corpo e Redução de Recarga do Berserk', 'knight');
    const knightManaNode = scoreBuildTreeNode('+50 Mana Máxima', 'knight');
    expect(knightMeleeNode).toBeGreaterThan(knightManaNode);
  });
});
