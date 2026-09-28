/**
 * Simulador Matemático de Dano e Otimizador de Build (DPS & Build Optimizer)
 *
 * Suporta Paladin (Distance + Holy/Physical + Spells), Knight (Melee + Physical/Elemental + AoE Spells),
 * e Mage (ML + Spells/Runes elementais).
 */

export interface CharacterProfile {
  vocation: 'paladin' | 'knight' | 'sorcerer' | 'druid' | 'unknown';
  level: number;
  magicLevel: number;
  distanceSkill: number;
  meleeSkill: number;
  shieldingSkill: number;
}

export interface ItemAttributes {
  name: string;
  slot: string;
  rarity: number; // 0 a 5
  ftier: number; // 0 a 10 (forja)
  upLevel: number; // 0 a 12 (upgrade)
  attack?: number;
  defense?: number;
  range?: number;
  hitChance?: number;
  critChance?: number;
  element?: string;
  bonusMagicLevel?: number;
  bonusDistance?: number;
  bonusMelee?: number;
  bonusShielding?: number;
  rawAttrs?: string;
}

export interface HuntProfile {
  huntId: string;
  preferredElement?: string;
  weaknesses: string[];
  resistances: string[];
}

export interface BuildTreeNode {
  id: string;
  title: string;
  description: string;
  available: boolean;
  score: number;
}

/**
 * Normaliza string para busca tolerante a acentuação e caixa.
 */
function norm(str: string): string {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Extrai atributos numéricos de texto de tooltip ou dataset.
 */
export function parseItemAttributes(blob: string, defaultSlot = 'weapon'): Partial<ItemAttributes> {
  const n = norm(blob);
  const attrs: Partial<ItemAttributes> = {};

  // Attack: ex: "Atk: 52", "Attack 48", "Atk: 45 + 5"
  const atkMatch = n.match(/(?:atk|ataque|attack)\s*[:=]?\s*\+?\s*(\d+)/i);
  if (atkMatch) attrs.attack = parseInt(atkMatch[1], 10);

  // Defense: ex: "Def: 35", "Defense: 28"
  const defMatch = n.match(/(?:def|defesa|defense)\s*[:=]?\s*\+?\s*(\d+)/i);
  if (defMatch) attrs.defense = parseInt(defMatch[1], 10);

  // Range: ex: "Range: 5", "Alcance: 6"
  const rangeMatch = n.match(/(?:range|alcance)\s*[:=]?\s*\+?\s*(\d+)/i);
  if (rangeMatch) attrs.range = parseInt(rangeMatch[1], 10);

  // Hit chance: ex: "Hit% +3", "Chance de acerto: +4%"
  const hitMatch = n.match(/(?:hit|acerto)\s*[%]?\s*[:=]?\s*\+?\s*(\d+)/i);
  if (hitMatch) attrs.hitChance = parseInt(hitMatch[1], 10);

  // Crit chance / Crit damage
  const critMatch = n.match(/(?:crit|critico|critical)\s*[:=]?\s*\+?\s*(\d+)/i);
  if (critMatch) attrs.critChance = parseInt(critMatch[1], 10);

  // Bônus de ML
  const mlMatch = n.match(/(?:magic level|magic|ml)\s*[:=]?\s*\+?\s*(\d+)/i);
  if (mlMatch) attrs.bonusMagicLevel = parseInt(mlMatch[1], 10);

  // Bônus de Distance
  const distMatch = n.match(/(?:distance|dist|distancia)\s*[:=]?\s*\+?\s*(\d+)/i);
  if (distMatch) attrs.bonusDistance = parseInt(distMatch[1], 10);

  // Bônus de Melee (Sword/Axe/Club)
  const meleeMatch = n.match(/(?:sword|axe|club|melee|espada|machado|clava)\s*[:=]?\s*\+?\s*(\d+)/i);
  if (meleeMatch) attrs.bonusMelee = parseInt(meleeMatch[1], 10);

  // Elemento do ataque ou do item
  if (/fogo|fire|flam/.test(n)) attrs.element = 'fire';
  else if (/gelo|ice|frigo/.test(n)) attrs.element = 'ice';
  else if (/energia|energy|vis/.test(n)) attrs.element = 'energy';
  else if (/terra|earth|tera/.test(n)) attrs.element = 'earth';
  else if (/sagrado|holy|san/.test(n)) attrs.element = 'holy';
  else if (/morte|death|mort/.test(n)) attrs.element = 'death';
  else if (/fisico|physical/.test(n)) attrs.element = 'physical';

  return attrs;
}

/**
 * Calcula o multiplicador elemental baseado nas fraquezas e resistências da hunt.
 */
export function getElementMultiplier(element: string | undefined, hunt?: HuntProfile): number {
  if (!element || !hunt) return 1.0;
  const el = norm(element);
  const weakList = (hunt.weaknesses || []).map(norm);
  const resistList = (hunt.resistances || []).map(norm);

  if (weakList.includes(el)) return 1.25; // +25% de bônus em fraqueza
  if (resistList.includes(el)) return 0.65; // -35% de penalidade em resistência
  return 1.0;
}

/**
 * Calcula o dano médio esperado por ataque de arma.
 * Fórmula clássica refinada: MaxHit = 0.085 * Skill * Atk + Level / 5.
 * Dano Médio = (MaxHit / 2) * (1 + bônus de upgrade) * (1 + bônus de forja) * elemMult.
 */
export function calculateAverageWeaponHit(
  char: CharacterProfile,
  weapon: ItemAttributes,
  hunt?: HuntProfile,
  ammo?: ItemAttributes,
): number {
  let skill = 10;
  let baseAtk = weapon.attack || 0;

  if (char.vocation === 'paladin') {
    skill = (char.distanceSkill || 10) + (weapon.bonusDistance || 0) + (ammo?.bonusDistance || 0);
    // Para armas de alcance (arco/besta), soma ataque da arma + munição se houver
    baseAtk += (ammo?.attack || (weapon.range ? 30 : 0));
  } else if (char.vocation === 'knight') {
    skill = (char.meleeSkill || 10) + (weapon.bonusMelee || 0);
  } else {
    // Mago atacando com rod/wand
    skill = (char.magicLevel || 1) + (weapon.bonusMagicLevel || 0);
    baseAtk = Math.max(baseAtk, 35);
  }

  if (baseAtk <= 0) {
    // Fallback razoável baseado na raridade se o atk explícito não estiver no tooltip
    baseAtk = 25 + weapon.rarity * 12 + weapon.upLevel * 3;
  }

  const maxHit = 0.085 * skill * baseAtk + char.level / 5;
  const avgHit = maxHit * 0.52; // Dano médio efetivo (~52% do max hit)

  // Multiplicadores de Forja (ftier) e Upgrade (+N)
  const upMult = 1 + (weapon.upLevel || 0) * 0.04; // +4% por nível de upgrade
  const ftierMult = 1 + (weapon.ftier || 0) * 0.025; // +2.5% por tier de forja
  const elemMult = getElementMultiplier(weapon.element, hunt);

  // Bônus de crítico (chance * multiplicador 1.5)
  const critChance = (weapon.critChance || 0) / 100;
  const critMult = 1 + critChance * 0.5;

  return avgHit * upMult * ftierMult * elemMult * critMult;
}

/**
 * Calcula o dano médio esperado de uma magia por ciclo.
 */
export function calculateAverageSpellHit(
  char: CharacterProfile,
  spellName: string,
  hunt?: HuntProfile,
  extraMl = 0,
): { avgHit: number; dps: number; cooldownS: number } {
  const s = norm(spellName);
  const totalMl = (char.magicLevel || 1) + extraMl;
  let baseDmg = 50;
  let mlFactor = 2.5;
  let cooldownS = 2.0;
  let spellElement = 'physical';

  if (/mas san|divine caldera/.test(s)) {
    // Paladin Holy AoE
    baseDmg = 120;
    mlFactor = 4.2;
    cooldownS = 4.0;
    spellElement = 'holy';
  } else if (/exori gran|fierce berserk/.test(s)) {
    // Knight Big AoE
    baseDmg = 160;
    mlFactor = 3.5;
    cooldownS = 6.0;
    spellElement = 'physical';
  } else if (/exori mas|groundshaker/.test(s)) {
    baseDmg = 80;
    mlFactor = 2.2;
    cooldownS = 8.0;
    spellElement = 'physical';
  } else if (/exori\b|berserk/.test(s)) {
    baseDmg = 90;
    mlFactor = 2.8;
    cooldownS = 4.0;
    spellElement = 'physical';
  } else if (/frigo|gelo|ice/.test(s)) {
    baseDmg = 100;
    mlFactor = 3.8;
    spellElement = 'ice';
  } else if (/flam|fogo|fire/.test(s)) {
    baseDmg = 110;
    mlFactor = 4.0;
    spellElement = 'fire';
  } else if (/vis|energia|energy/.test(s)) {
    baseDmg = 105;
    mlFactor = 3.9;
    spellElement = 'energy';
  } else if (/tera|terra|earth/.test(s)) {
    baseDmg = 95;
    mlFactor = 3.6;
    spellElement = 'earth';
  }

  const maxHit = baseDmg + totalMl * mlFactor + char.level * 0.2;
  const avgHit = maxHit * 0.55 * getElementMultiplier(spellElement, hunt);
  const dps = avgHit / Math.max(cooldownS, 1);

  return { avgHit, dps, cooldownS };
}

/**
 * Estima o DPS total de combate (Ataque Básico + Rotação de Magias)
 */
export function estimateTotalCombatDps(
  char: CharacterProfile,
  weapon: ItemAttributes,
  rotationSpells: string[],
  hunt?: HuntProfile,
  ammo?: ItemAttributes,
  extraStats: { ml?: number; dist?: number; melee?: number } = {},
): number {
  const profileWithStats: CharacterProfile = {
    ...char,
    magicLevel: char.magicLevel + (extraStats.ml || 0),
    distanceSkill: char.distanceSkill + (extraStats.dist || 0),
    meleeSkill: char.meleeSkill + (extraStats.melee || 0),
  };

  // 1. DPS da Arma (1 ataque a cada 2.0s = 0.5 ataques/s)
  const avgWeaponHit = calculateAverageWeaponHit(profileWithStats, weapon, hunt, ammo);
  const weaponDps = avgWeaponHit / 2.0;

  // 2. DPS das Magias equipadas na rotação
  let spellsDps = 0;
  for (const spell of rotationSpells.slice(0, 4)) {
    if (!spell || /nenhuma|none|escolher/i.test(spell)) continue;
    const { dps } = calculateAverageSpellHit(profileWithStats, spell, hunt);
    spellsDps += dps * 0.85; // fator de sobreposição de cooldown global
  }

  return Math.round(weaponDps + spellsDps);
}

/**
 * Avalia se um item candidato é um upgrade comparado ao item atualmente equipado
 * calculando o delta de DPS real projetado.
 */
export function evaluateItemUpgrade(
  currentEquipped: ItemAttributes | null,
  candidate: ItemAttributes,
  char: CharacterProfile,
  hunt?: HuntProfile,
  rotationSpells: string[] = ['exevo mas san', 'exori gran', 'exori'],
): {
  isUpgrade: boolean;
  deltaDps: number;
  pctImprovement: number;
  score: number;
  reason: string;
} {
  // Atributos base do atual ou sentinela
  const curr = currentEquipped || {
    name: 'Vazio',
    slot: candidate.slot,
    rarity: 0,
    ftier: 0,
    upLevel: 0,
  };

  // Cálculo de DPS com o item atual vs com o candidato
  let dpsCurrent = 0;
  let dpsCandidate = 0;

  if (candidate.slot === 'weapon') {
    dpsCurrent = estimateTotalCombatDps(char, curr, rotationSpells, hunt);
    dpsCandidate = estimateTotalCombatDps(char, candidate, rotationSpells, hunt);
  } else {
    // Para outros slots (armadura, amuleto, anel, pernas, etc.), avalia o impacto em stats
    const currentExtra = {
      ml: curr.bonusMagicLevel || 0,
      dist: curr.bonusDistance || 0,
      melee: curr.bonusMelee || 0,
    };
    const candExtra = {
      ml: candidate.bonusMagicLevel || 0,
      dist: candidate.bonusDistance || 0,
      melee: candidate.bonusMelee || 0,
    };

    const dummyWeapon: ItemAttributes = {
      name: 'Arma Base',
      slot: 'weapon',
      rarity: 3,
      ftier: 0,
      upLevel: 0,
      attack: 50,
    };

    dpsCurrent = estimateTotalCombatDps(char, dummyWeapon, rotationSpells, hunt, undefined, currentExtra);
    dpsCandidate = estimateTotalCombatDps(char, dummyWeapon, rotationSpells, hunt, undefined, candExtra);

    // Soma bônus defensivo/tier marginal para desempate
    const defenseDelta = (candidate.defense || 0) - (curr.defense || 0);
    const tierDelta = (candidate.rarity * 10 + candidate.ftier * 2 + candidate.upLevel) -
      (curr.rarity * 10 + curr.ftier * 2 + curr.upLevel);

    dpsCandidate += Math.max(0, defenseDelta * 0.2 + tierDelta * 0.5);
  }

  const deltaDps = Math.round((dpsCandidate - dpsCurrent) * 10) / 10;
  const pctImprovement = dpsCurrent > 0 ? Math.round((deltaDps / dpsCurrent) * 1000) / 10 : (deltaDps > 0 ? 100 : 0);
  const isUpgrade = deltaDps > 0 || (deltaDps === 0 && (candidate.upLevel > curr.upLevel || candidate.rarity > curr.rarity));

  // Score composto para ordenação no batch
  const score = (candidate.rarity * 1000) + (candidate.ftier * 20) + (candidate.upLevel * 5) + Math.round(dpsCandidate);

  const reason = isUpgrade
    ? `Upgrade de Dano: +${deltaDps} DPS (+${pctImprovement}%) [${candidate.name} vs ${curr.name}]`
    : `Inferior: ${deltaDps <= 0 ? `${deltaDps} DPS` : 'sem ganho'} [${candidate.name}]`;

  return { isUpgrade, deltaDps, pctImprovement, score, reason };
}

/**
 * Pontua nós da Árvore de Talentos (aba Build / tab-tree) priorizando bônus ofensivos e de dano.
 */
export function scoreBuildTreeNode(nodeText: string, vocation: CharacterProfile['vocation']): number {
  const n = norm(nodeText);
  let score = 10; // base para qualquer nó acessível

  // 1. Prioridades Ofensivas Gerais Máximas (+100 a +300)
  if (/dano|damage|ataque|attack|critico|critical|crit/.test(n)) score += 200;
  if (/penetracao|penetration|ignorar armadura|ignore defense/.test(n)) score += 150;
  if (/velocidade de ataque|attack speed|cooldown reduction|reduc.*recarga/.test(n)) score += 120;

  // 2. Especialização por Vocação
  if (vocation === 'paladin') {
    if (/distancia|distance|flecha|arrow|bolt|besta|bow|arco|sagrado|holy/.test(n)) score += 250;
    if (/magic level|poder magico/.test(n)) score += 100;
  } else if (vocation === 'knight') {
    if (/corpo a corpo|melee|sword|axe|club|espada|machado|clava|area/.test(n)) score += 250;
    if (/furia|berserk|adrenalina/.test(n)) score += 150;
  } else {
    if (/poder magico|magic level|amplificacao elemental|spell damage/.test(n)) score += 250;
  }

  // 3. Nós de Vida / Defesa (Prioridade Secundária: +30 a +50)
  if (/vida|health|hp|armadura|armor|defesa|defense|bloqueio|shield/.test(n)) score += 40;
  if (/regeneracao|regen|mana regen|leech/.test(n)) score += 50;

  return score;
}
