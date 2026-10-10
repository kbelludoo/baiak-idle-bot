/**
 * Fórmulas extraídas e registradas diretamente do bundle oficial do cliente Baiak Idle (index-D-KzJHgd.js).
 *
 * Contém o catálogo matemático completo do motor do jogo:
 * 1. Curva de Experiência e Nível (Sj)
 * 2. Custo de Bênção (Blessing Cost - Dye)
 * 3. Avaliação de Itens com Tier e Upgrade (KL)
 * 4. Atributos e Progressão de Vocações (F0)
 * 5. Bônus de Addons de Outfits (Lk / W$)
 * 6. Ciclo de Benefícios de Montarias (Ree / Dee / Af)
 * 7. Fórmulas Polinomiais Quadráticas da Forja de Tier (d4e / ql / vE)
 * 8. Custos de Fusão e Recursos da Forja (f4e / wa)
 * 9. Custos de Desbloqueio e Remoção de Charms / Bestiário (n6e / i6e / xae)
 * 10. Fórmulas Oficiais de Dano e Cura de Magias e Runas (eo / Mj / tf)
 * 11. Imbuements e Encantamentos (Pk / Ote)
 * 12. ECR de Monstros e Hunts (K4e / Z4e / X4e / J4e)
 */

export const GAME_FORMULA_SOURCE = 'Baiak Idle client bundle (assets/index-D-KzJHgd.js)';
export const GAME_FORMULA_REFERENCE = 'https://baiakidle.com/jogar/';

export const GAME_FORMULA_DESCRIPTION = [
  'Sj: expParaLevel = floor(50/3 * (level^3 - 6*level^2 + 17*level - 12))',
  'Dye: custoBless = 5000 * 2^max(0, level - 8)',
  'KL: valorItem = round(baseValue * (1 + tier * 0.5 + upLevel * 0.1))',
  'F0: EK(hp15,mp5) | RP(hp10,mp15) | MS/ED(hp5,mp30) | MK(hp13,mp8)',
  'Lk: addon EK(+50hp,+10mp,+1melee/5) | RP(+30hp,+30mp,+1dist/5) | Mage(+20hp,+40mp,+1ml/5) | MK(+30hp,+30mp,+1fist/5)',
  'Ree: montarias ciclam [stamina(+15m), pouch(+1), offlineHunt(+10m), exerciseRegen(+1%), offlineExercise(+10m)]',
  'd4e: forja quadratic: onslaught[0.05,0.4,0.05] | momentum[0.05,1.9,0.05] | ruse[0.0307576,0.440697,0.026] | trans[0.0127,0.107,0.0073] | amp[0.4,1.7,0.4]',
  'wa: forja baseSuccess=50%, coreSuccess=+15%, tierLossRed=50%, 60dust->3slivers, 50slivers->1core',
  'n6e: charmUnlockCost = 25*t^2 + 25*t + 50; vipDiscount = floor(cost * 0.75)',
  'i6e: charmRespecCost = vipDisc(1e6 + (level > 100 ? level * 110e3 : 0))',
  'eo: spells dano e cura exatos (Knight Mj=(lvl/3+(atk+skill)*3.5)*1.5, Paladin, Mage, Runas)',
  'Pk/Ote: imbuement gold=[7.5k,60k,250k]; vamp=[5,10,25]%; void=[3,5,8]%; strike=[5,15,40]%',
  'K4e: eHP=hp*(1+min(0.8,cura/dano)); ECR=eHP^0.4*dano^0.6; X4e: level=0.12296*ECR^1.1494; Z4e: hunt ECR=0.6*avg+0.4*max',
].join(' | ');

// ==========================================
// 1. Experiência e Nível (Sj / Dye)
// ==========================================

/**
 * Fórmula Sj do bundle do cliente:
 * Experiência necessária para atingir um determinado nível no motor do jogo.
 */
export function gameExpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  if (l <= 1) return 0;
  return Math.floor((50 / 3) * (l ** 3 - 6 * l ** 2 + 17 * l - 12));
}

/**
 * Fórmula Dye do bundle do cliente:
 * Custo em ouro de cada bênção (blessing) baseado no nível do personagem.
 */
export function gameBlessingCost(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return 5000 * 2 ** Math.max(0, l - 8);
}

// ==========================================
// 2. Avaliação de Itens e Forja (KL)
// ==========================================

/**
 * Fórmula KL do bundle:
 * Calcula o valor de mercado/venda de um item com base no seu tier e nível de upgrade.
 */
export function gameItemValue(baseValue: number, tier = 0, upLevel = 0): number {
  const t = Math.max(0, Math.floor(tier));
  const u = Math.max(0, Math.floor(upLevel));
  return Math.round(Number(baseValue || 0) * (1 + t * 0.5 + u * 0.1));
}

// ==========================================
// 3. Vocações e Atributos Base (F0)
// ==========================================

export interface GameVocationStats {
  name: string;
  hpPerLevel: number;
  manaPerLevel: number;
  mlFactor: number;
  skillFactor: number;
  starterWeapon: string;
  usesManaPotions: boolean;
}

export const GAME_VOCATIONS: Record<string, GameVocationStats> = {
  knight: {
    name: 'Knight',
    hpPerLevel: 15,
    manaPerLevel: 5,
    mlFactor: 0.05,
    skillFactor: 0.6,
    starterWeapon: 'hand axe',
    usesManaPotions: false,
  },
  paladin: {
    name: 'Paladin',
    hpPerLevel: 10,
    manaPerLevel: 15,
    mlFactor: 0.15,
    skillFactor: 0.5,
    starterWeapon: 'bow',
    usesManaPotions: true,
  },
  sorcerer: {
    name: 'Sorcerer',
    hpPerLevel: 5,
    manaPerLevel: 30,
    mlFactor: 0.6,
    skillFactor: 0.2,
    starterWeapon: 'wand of vortex',
    usesManaPotions: true,
  },
  druid: {
    name: 'Druid',
    hpPerLevel: 5,
    manaPerLevel: 30,
    mlFactor: 0.6,
    skillFactor: 0.2,
    starterWeapon: 'snakebite rod',
    usesManaPotions: true,
  },
  monk: {
    name: 'Monk',
    hpPerLevel: 13,
    manaPerLevel: 8,
    mlFactor: 0.1,
    skillFactor: 0.55,
    starterWeapon: 'light jo staff',
    usesManaPotions: false,
  },
};

// ==========================================
// 4. Bônus de Addons de Outfits (Lk / W$)
// ==========================================

export interface GameAddonBonus {
  lifePerAddon: number;
  manaPerAddon: number;
  skill: number;
  addonsToSkill: number;
  skillKey: 'melee' | 'distance' | 'magic' | 'fist';
}

export const GAME_ADDON_CONFIG: Record<string, GameAddonBonus> = {
  knight: { lifePerAddon: 50, manaPerAddon: 10, skill: 1, addonsToSkill: 5, skillKey: 'melee' },
  paladin: { lifePerAddon: 30, manaPerAddon: 30, skill: 1, addonsToSkill: 5, skillKey: 'distance' },
  sorcerer: { lifePerAddon: 20, manaPerAddon: 40, skill: 1, addonsToSkill: 5, skillKey: 'magic' },
  druid: { lifePerAddon: 20, manaPerAddon: 40, skill: 1, addonsToSkill: 5, skillKey: 'magic' },
  monk: { lifePerAddon: 30, manaPerAddon: 30, skill: 1, addonsToSkill: 5, skillKey: 'fist' },
};

/**
 * Calcula o bônus de vida, mana e skill proporcionado pelos addons de outfit (W$ no bundle).
 */
export function gameAddonBonus(vocation: string, totalAddons: number) {
  const normVoc = (vocation || '').toLowerCase();
  const cfg = GAME_ADDON_CONFIG[normVoc] || GAME_ADDON_CONFIG.sorcerer;
  const count = Math.max(0, Math.floor(totalAddons));
  if (count <= 0) return { hpFlat: 0, mpFlat: 0, skill: 0, skillKey: cfg.skillKey };

  const skillBonus = cfg.addonsToSkill > 0 ? Math.floor(count / cfg.addonsToSkill) * cfg.skill : 0;
  return {
    hpFlat: count * cfg.lifePerAddon,
    mpFlat: count * cfg.manaPerAddon,
    skill: skillBonus,
    skillKey: cfg.skillKey,
  };
}

// ==========================================
// 5. Ciclo de Benefícios de Montarias (Ree / Dee / Af)
// ==========================================

export const GAME_MOUNT_CYCLE = ['stamina', 'pouch', 'offlineHunt', 'exerciseRegen', 'offlineExercise'] as const;

export const GAME_MOUNT_RULES = {
  staminaMaxPerMountMin: 15,
  staminaMaxCapMin: 360,
  exerciseRegenPctPerMount: 1,
  exerciseRegenPctCap: 20,
  offlineHuntPerMountMin: 10,
  offlineHuntCapMin: 180,
  offlineExercisePerMountMin: 10,
  offlineExerciseCapMin: 180,
  pouchSlotsEvery: 1,
  pouchSlotsCap: 64,
};

function mountCyclePoints(mountCount: number, perkKey: typeof GAME_MOUNT_CYCLE[number]): number {
  const cycleLen = GAME_MOUNT_CYCLE.length;
  const perkIdx = GAME_MOUNT_CYCLE.indexOf(perkKey);
  const total = Math.max(0, Math.floor(mountCount || 0));
  return Math.max(0, Math.floor((total + cycleLen - 1 - perkIdx) / cycleLen));
}

/**
 * Calcula os benefícios acumulados pelo número de montarias desbloqueadas (Dee no bundle).
 */
export function gameMountPerks(mountCount: number) {
  const count = Math.max(0, Math.floor(mountCount || 0));
  if (count <= 0) {
    return {
      staminaMaxAddMin: 0,
      exerciseRegenMult: 1.0,
      offlineHuntAddMs: 0,
      offlineExerciseAddMs: 0,
      pouchSlots: 0,
    };
  }

  const r = GAME_MOUNT_RULES;
  const regenPct = Math.min(r.exerciseRegenPctCap, mountCyclePoints(count, 'exerciseRegen') * r.exerciseRegenPctPerMount);
  const pouch = mountCyclePoints(count, 'pouch');

  return {
    staminaMaxAddMin: Math.min(r.staminaMaxCapMin, mountCyclePoints(count, 'stamina') * r.staminaMaxPerMountMin),
    exerciseRegenMult: 1 + regenPct / 100,
    offlineHuntAddMs: Math.min(r.offlineHuntCapMin, mountCyclePoints(count, 'offlineHunt') * r.offlineHuntPerMountMin) * 60_000,
    offlineExerciseAddMs: Math.min(r.offlineExerciseCapMin, mountCyclePoints(count, 'offlineExercise') * r.offlineExercisePerMountMin) * 60_000,
    pouchSlots: r.pouchSlotsEvery > 0 ? Math.min(r.pouchSlotsCap, Math.floor(pouch / r.pouchSlotsEvery)) : 0,
  };
}

// ==========================================
// 6. Forja de Tier e Efeitos Quadráticos (d4e / ql / vE)
// ==========================================

export type ForgePerkKey = 'onslaught' | 'momentum' | 'ruse' | 'transcendence' | 'amplification';

/**
 * Coeficientes polinomiais quadráticos do cliente para cada perk da forja:
 * f(tier) = a * tier^2 + b * tier + c (em porcentagem)
 */
export const GAME_FORGE_TIER_COEFFS: Record<ForgePerkKey, [number, number, number]> = {
  onslaught: [0.05, 0.4, 0.05],
  momentum: [0.05, 1.9, 0.05],
  ruse: [0.0307576, 0.440697, 0.026],
  transcendence: [0.0127, 0.107, 0.0073],
  amplification: [0.4, 1.7, 0.4],
};

/**
 * Retorna a porcentagem base concedida por um perk no determinado tier (ql no bundle).
 */
export function gameForgePerkPercent(perk: ForgePerkKey, tier: number): number {
  const t = Math.max(0, Math.trunc(tier));
  if (t <= 0) return 0;
  const coeffs = GAME_FORGE_TIER_COEFFS[perk];
  if (!coeffs) return 0;
  const [a, b, c] = coeffs;
  return a * t * t + b * t + c;
}

/**
 * Mapeamento oficial de slots para perks da forja ($2 no bundle).
 */
export function gameSlotToForgePerk(slot: string): ForgePerkKey | null {
  switch (slot?.toLowerCase()) {
    case 'weapon':
    case 'weapon2':
      return 'onslaught';
    case 'helmet':
      return 'momentum';
    case 'armor':
      return 'ruse';
    case 'legs':
      return 'transcendence';
    case 'boots':
      return 'amplification';
    default:
      return null;
  }
}

/**
 * Calcula os efeitos finais da forja aplicando o multiplicador de amplificação das botas (m4e, u4e, h4e, p4e).
 */
export function gameEffectiveForgePerks(perks: {
  onslaught: number;
  onslaughtTier: number;
  momentum: number;
  ruse: number;
  transcendence: number;
  amplification: number;
}) {
  const ampMult = 1 + Math.max(0, perks.amplification) / 100;
  return {
    onslaughtPct: perks.onslaught + (perks.onslaughtTier > 0 ? perks.onslaughtTier * (ampMult - 1) : 0),
    momentumPct: perks.momentum > 0 ? perks.momentum * ampMult : 0,
    rusePct: perks.ruse > 0 ? perks.ruse * ampMult : 0,
    transcendencePct: perks.transcendence > 0 ? perks.transcendence * ampMult : 0,
    amplificationPct: perks.amplification,
  };
}

export const GAME_FORGE_RULES = {
  dustPerSliverBatch: 60,
  sliversPerBatch: 3,
  sliversPerCore: 50,
  baseDustCap: 75,
  maxDustCap: 225,
  profMaxDustCap: 4500,
  baseSuccessRate: 50,
  coreSuccessBonus: 15,
  tierLossReductionWithCore: 50,
};

// ==========================================
// 7. Charms, Bestiário e Descontos VIP (n6e / i6e / xae)
// ==========================================

/**
 * Fórmula n6e: Custo em Charm Points para desbloquear o próximo slot de charm.
 */
export function gameCharmUnlockCost(unlockedCount: number): number {
  const t = Math.max(0, Math.floor(unlockedCount));
  return 25 * t * t + 25 * t + 50;
}

/**
 * Fórmula xae: Aplica 25% de desconto se o jogador for VIP.
 */
export function gameVipDiscount(cost: number, isVip: boolean): number {
  return isVip ? Math.floor((cost * 75) / 100) : cost;
}

/**
 * Fórmula i6e: Custo em ouro para trocar/remover charms do bestiário.
 */
export function gameCharmRespecCost(playerLevel: number, isVip = false): number {
  const lvl = Math.max(1, Math.floor(playerLevel));
  const baseCost = 1_000_000 + (lvl > 100 ? lvl * 110_000 : 0);
  return gameVipDiscount(baseCost, isVip);
}

// ==========================================
// 8. Imbuements (Pk / Ote)
// ==========================================

export const GAME_IMBUEMENT_GOLD_COSTS = [7_500, 60_000, 250_000] as const;

export const GAME_IMBUEMENT_CATALOG = {
  vampirism: { name: 'Vampirism', kind: 'life-leech', values: [5, 10, 25] },
  void: { name: 'Void', kind: 'mana-leech', values: [3, 5, 8] },
  strike: { name: 'Strike', kind: 'crit', values: [5, 15, 40] },
} as const;

// ==========================================
// 9. Cooldowns Globais e Crítico Base (Lr)
// ==========================================

export const GAME_PLAYER_TIMINGS = {
  spells: {
    attackGroupMs: 2000,
    healGroupMs: 1000,
    supportGroupMs: 2000,
  },
  player: {
    stepMs: 240,
    mountSpeed: 20,
    baseCritChance: 5,
    baseCritDmg: 10,
  },
};

// ==========================================
// 10. Fórmulas de Magias e Runas (eo / Mj / tf)
// ==========================================

const tf = (a: [number, number], b: [number, number]): [number, number] => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
];

/** Fórmula Mj usada para magias físicas do Knight (ex: exori) */
export const gameKnightMeleeDmg = (level: number, weaponAtk: number, skill: number): [number, number] => {
  const n = (level / 3 + (weaponAtk + skill) * 3.5) * 1.5;
  return [n * 0.75, n];
};

/** Catálogo exato de fórmulas de magias extraídas de eo no bundle */
export const GAME_SPELL_FORMULAS = {
  // --- Cura ---
  exura: (lvl: number, ml: number): [number, number] => [lvl * 0.2 + ml * 1.4 + 8, lvl * 0.2 + ml * 1.795 + 11],
  exura_ico: (lvl: number, ml: number): [number, number] => [
    (lvl * 0.2 + ml * 4 + 25) * 1.05,
    (lvl * 0.2 + ml * 7.95 + 51) * 1.26,
  ],
  exura_sio: (lvl: number, ml: number): [number, number] => [lvl * 0.2 + ml * 7.22 + 44, lvl * 0.2 + ml * 12.79 + 79],
  exura_gran: (lvl: number, ml: number): [number, number] => [lvl * 0.2 + ml * 3.184 + 20, lvl * 0.2 + ml * 5.59 + 35],
  exura_vita: (lvl: number, ml: number): [number, number] => [
    (lvl / 5 + ml * 6.8 + 42) * 1.2,
    (lvl / 5 + ml * 12.9 + 90) * 1.2,
  ],
  exura_san: (lvl: number, ml: number): [number, number] => [lvl * 0.2 + ml * 7.22 + 44, lvl * 0.2 + ml * 12.79 + 79],
  exura_gran_san: (lvl: number, ml: number): [number, number] => [
    (lvl * 0.2 + ml * 7.005 + 44) * 1.15,
    (lvl * 0.2 + ml * 12.298 + 77) * 1.15,
  ],
  exura_gran_ico: (lvl: number, ml: number): [number, number] => [
    lvl * 0.6 + ml * 9.552 + 60,
    lvl * 0.6 + ml * 16.77 + 105,
  ],

  // --- Knight Ataque ---
  exori: (lvl: number, _ml: number, atk: number, skill: number): [number, number] => gameKnightMeleeDmg(lvl, atk, skill),
  exori_gran: (lvl: number, _ml: number, atk: number, skill: number): [number, number] => {
    const o = (lvl / 3 + (atk + 2 * skill) * 5) * 1.5;
    return [o * 0.75, o];
  },
  exori_ico: (lvl: number, _ml: number, atk: number, skill: number): [number, number] =>
    tf(
      [(atk * skill * 0.02 + 4 + lvl / 5) * 1.28, (atk * skill * 0.04 + 9 + lvl / 5) * 1.28],
      [lvl / 5 + (atk + skill) * 0.9, lvl / 5 + (atk + skill) * 1.8],
    ),
  exori_gran_ico: (lvl: number, _ml: number, atk: number, skill: number): [number, number] => [
    (lvl / 3.5 + (atk + skill) * 7) * 1.2,
    (lvl / 3.5 + (atk + skill) * 10) * 1.2,
  ],

  // --- Paladin Ataque ---
  exori_con: (lvl: number, atk: number): [number, number] => [lvl * 0.2 + atk * 2.3 + 7, lvl * 0.2 + atk * 4.3 + 13],
  exori_gran_con: (lvl: number, atk: number): [number, number] => [
    (lvl * 0.2 + atk * 2.3 + 7) * 1.75,
    (lvl * 0.2 + atk * 4.3 + 13) * 1.75,
  ],
  exori_san: (lvl: number, ml: number): [number, number] => [lvl / 5 + ml * 1.79 + 11, lvl / 5 + ml * 3 + 18],
  exevo_mas_san: (lvl: number, ml: number): [number, number] => [
    (lvl / 2 + ml * 10) * 1.275,
    (lvl / 2 + ml * 12) * 1.275,
  ],

  // --- Mage Strikes ---
  strike_base: (lvl: number, ml: number): [number, number] => [lvl / 5 + ml * 1.403 + 8, lvl / 5 + ml * 2.203 + 13],
  strike_strong: (lvl: number, ml: number): [number, number] => [lvl / 5 + ml * 2.24 + 12.8, lvl / 5 + ml * 3.52 + 20.8],
  strike_ultimate: (lvl: number, ml: number): [number, number] => [
    lvl / 5 + ml * 3.36 + 19.2,
    lvl / 5 + ml * 5.28 + 31.2,
  ],

  // --- Runas ---
  sudden_death: (lvl: number, ml: number): [number, number] => [lvl / 3.5 + ml * 6, lvl / 3.5 + ml * 9],
  area_rune: (lvl: number, ml: number): [number, number] => [lvl / 3 + ml * 2 + 7, lvl / 3 + ml * 4 + 17],
};

// ==========================================
// 11. ECR de Monstros e Agregação de Hunt (K4e / Z4e / X4e / J4e)
// ==========================================

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

/**
 * Fórmula K4e do bundle:
 * Calcula o dano por segundo, effective HP, ECR, exp e valor de loot esperado de um monstro.
 */
export function gameMonsterFormula(monster: GameMonsterFacts) {
  const baseDamage = average(Number(monster.dmg?.[0] || 0), Number(monster.dmg?.[1] || 0));
  let damagePerSecond = baseDamage;
  let healingPerSecond = 0;
  for (const ability of monster.abilities || []) {
    const expected = average(Number(ability.min || 0), Number(ability.max || 0)) * (Number(ability.chance || 0) / 100);
    if (ability.healing) healingPerSecond += expected;
    else damagePerSecond += expected;
  }
  // Q0 = 2000 ms: taxa normalizada para segundos
  const dps = damagePerSecond / 2;
  const hps = healingPerSecond / 2;
  const healingRatio = Math.min(0.8, hps / Math.max(dps, 1));
  const effectiveHp = Number(monster.hp || 0) * (1 + healingRatio);
  const ecr = Math.pow(Math.max(effectiveHp, 0), 0.4) * Math.pow(Math.max(dps, 0), 0.6);
  const gold = (monster.loot || []).reduce((total, item) => {
    const chance = Number(item.chance || 0) / 100_000;
    const quantity = (1 + Number(item.max ?? 1)) / 2;
    return total + chance * quantity * Number(item.value || 0);
  }, 0);
  return { effectiveHp, dps, hps, ecr, exp: Number(monster.exp || 0), gold };
}

/**
 * Fórmula X4e do bundle: Estima o nível de hunt com base no ECR.
 */
export function gameEstimatedLevel(ecr: number): number {
  return 0.12296 * Math.pow(Math.max(0, Number(ecr) || 0), 1.1494);
}

/**
 * Fórmula J4e do bundle: Arredonda o nível estimado para a interface do jogo.
 */
export function gameRoundEstimatedLevel(level: number, isFirstHunt = false): number {
  if (isFirstHunt) return 1;
  const e = Number(level) || 0;
  if (e < 10) return Math.max(1, Math.round(e));
  if (e < 50) return Math.round(e / 5) * 5;
  return Math.round(e / 10) * 10;
}

/**
 * Fórmula Z4e do bundle: Agregação estatística de monstros em uma hunt.
 */
export function gameAggregateHunt(monsters: Array<{ facts: GameMonsterFacts; weight?: number }>) {
  const items = monsters.map((m) => ({
    calc: gameMonsterFormula(m.facts),
    w: Math.max(0, m.weight ?? 1),
  }));

  const totalWeight = items.reduce((acc, curr) => acc + curr.w, 0) || 1;
  const weightedSum = (fn: (c: ReturnType<typeof gameMonsterFormula>) => number) =>
    items.reduce((acc, curr) => acc + curr.w * fn(curr.calc), 0);

  const avgEcr = weightedSum((c) => c.ecr) / totalWeight;
  const maxEcr = Math.max(...items.map((i) => i.calc.ecr), 0);
  const huntEcr = 0.6 * avgEcr + 0.4 * maxEcr;

  const totalEffHp = weightedSum((c) => c.effectiveHp);
  const expRate = totalEffHp > 0 ? weightedSum((c) => c.exp) / totalEffHp : 0;
  const goldRate = totalEffHp > 0 ? weightedSum((c) => c.gold) / totalEffHp : 0;

  return {
    ecr: huntEcr,
    expPerKill: weightedSum((c) => c.exp) / totalWeight,
    goldPerKill: weightedSum((c) => c.gold) / totalWeight,
    expRate,
    goldRate,
    estLevel: gameRoundEstimatedLevel(gameEstimatedLevel(huntEcr)),
  };
}
