/**
 * Fórmulas copiadas do bundle oficial do cliente Baiak Idle (index.js).
 *
 * O bundle chama a função de monstro de K0e e a agregação de hunt de Z0e.
 * Estas funções descrevem ECR/loot do jogo. A taxa final por hora continua
 * sendo server-authoritative: o cliente não conhece a rotação real do player,
 * dano aplicado pelo servidor nem perdas de uma sessão.
 */

export const GAME_FORMULA_SOURCE = 'Baiak Idle client bundle: K0e/Z0e/X0e (ECR, loot esperado e nível estimado)';
export const GAME_FORMULA_REFERENCE = 'https://baiakidle.com/jogar/';

export interface GameAbility {
  min?: number;
  max?: number;
  chance?: number;
  healing?: boolean;
}

export interface GameLootEntry {
  chance?: number;
  max?: number;
  value?: number;
}

export interface GameMonsterFacts {
  hp: number;
  exp: number;
  dmg: [number, number];
  abilities?: GameAbility[];
  loot?: GameLootEntry[];
}

const average = (min: number, max: number): number => (min + max) / 2;

/** Resultado da fórmula K0e usada no cliente para um monstro. */
export function gameMonsterFormula(monster: GameMonsterFacts) {
  const baseDamage = average(Number(monster.dmg?.[0] || 0), Number(monster.dmg?.[1] || 0));
  let damagePerSecond = baseDamage;
  let healingPerSecond = 0;
  for (const ability of monster.abilities || []) {
    const expected = average(Number(ability.min || 0), Number(ability.max || 0))
      * (Number(ability.chance || 0) / 100);
    if (ability.healing) healingPerSecond += expected;
    else damagePerSecond += expected;
  }
  // Q0 = 2000 ms: o dano do cliente é convertido para dano por segundo.
  const dps = damagePerSecond / 2;
  const hps = healingPerSecond / 2;
  const healingRatio = Math.min(0.8, hps / Math.max(dps, 1));
  const effectiveHp = Number(monster.hp || 0) * (1 + healingRatio);
  const ecr = Math.pow(Math.max(effectiveHp, 0), 0.4) * Math.pow(Math.max(dps, 0), 0.6);
  const gold = (monster.loot || []).reduce((total, item) => {
    const chance = Number(item.chance || 0) / 100000;
    const quantity = (1 + Number(item.max ?? 1)) / 2;
    return total + chance * quantity * Number(item.value || 0);
  }, 0);
  return { effectiveHp, dps, hps, ecr, exp: Number(monster.exp || 0), gold };
}

/** X0e(ecr), usada pelo cliente para estimar o level recomendado da hunt. */
export function gameEstimatedLevel(ecr: number): number {
  return 0.12296 * Math.pow(Math.max(0, Number(ecr) || 0), 1.1494);
}

