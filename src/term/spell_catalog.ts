/**
 * term/spell_catalog.ts — catálogo de magias e poções do Baiak Idle.
 *
 * ARQUIVO GERADO — extraído do bundle do jogo (index.js, minificado, ~4,5 MB).
 *
 * Como foi extraído (sem eval do bundle inteiro):
 *   1. fs.readFileSync("index.js");
 *   2. localização do primeiro 'words:"' e retrocesso até o '[' que abre o array do catálogo;
 *   3. varredura para frente com um scanner que respeita strings (' " crase), escapes,
 *      parênteses, chaves e colchetes, até o ']' correspondente;
 *   4. avaliação APENAS desse trecho com new Function("return (" + trecho + ")") — é dado puro
 *      mais arrow functions;
 *   5. mesmo processo para as poções: o array B6 (HP) e o array $6 (mana), que reaproveitam os
 *      objetos eY ("great spirit potion") e tY ("ultimate spirit potion");
 *   6. validação: 107 magias, 8 poções de HP e 9 de mana — conferindo exura ico (knight, 8),
 *      exura gran ico (knight, 80, cd 120000), exura med ico (knight, 300), exura gran tio
 *      (monk, 80), exura gran san (paladin, 60), exori gran e exevo gran mas flam.
 *
 * Detalhes que importam para quem for usar:
 *   - vocs foram normalizadas na ordem canônica knight, paladin, sorcerer, druid, monk;
 *   - healTarget só existe em magias de cura em aliado (healTarget: 'friend');
 *   - as runas (as 16 entradas com goldCost no bundle: adori* e adura*) são marcadas em
 *     RUNE_WORDS: continuam aparecendo em healsFor(), mas ficam fora de pickHealSpell(), porque
 *     são itens consumíveis e não a cura automática do personagem;
 *   - HEAL_COEFF guarda o ajuste linear exato (erro 0) das arrow functions heal(level, ml) do
 *     bundle na forma cura_max = lvl * level + ml * magicLevel + base.
 *
 * Sem imports externos: só dados e funções puras.
 */

export type Vocation = 'knight' | 'paladin' | 'sorcerer' | 'druid' | 'monk';

export interface SpellDef {
  words: string;
  name: string;
  vocs: Vocation[];
  level: number;
  mana: number;
  cd: number;
  type: 'heal' | 'strike' | 'area';
  healTarget?: string;
}

export interface PotionDef {
  name: string;
  minLevel: number;
  heal?: number;
  mana?: number;
  vocs?: Vocation[];
  cost?: number;
}

/** Catálogo completo de magias (107 entradas, na ordem em que aparecem no bundle). */
export const SPELL_CATALOG: SpellDef[] = [
  { words: 'exura', name: 'Light Healing', vocs: ['paladin', 'sorcerer', 'druid', 'monk'], level: 8, mana: 20, cd: 1000, type: 'heal' },
  { words: 'exura ico', name: 'Wound Cleansing', vocs: ['knight'], level: 8, mana: 60, cd: 1000, type: 'heal' },
  { words: 'exura sio', name: 'Heal Friend', vocs: ['druid'], level: 18, mana: 120, cd: 1000, type: 'heal', healTarget: 'friend' },
  { words: 'exura gran', name: 'Intense Healing', vocs: ['paladin', 'sorcerer', 'druid', 'monk'], level: 20, mana: 70, cd: 1000, type: 'heal' },
  { words: 'exura vita', name: 'Ultimate Healing', vocs: ['sorcerer', 'druid'], level: 30, mana: 160, cd: 1000, type: 'heal' },
  { words: 'exura san', name: 'Divine Healing', vocs: ['paladin'], level: 35, mana: 160, cd: 1000, type: 'heal' },
  { words: 'exori vis', name: 'Energy Strike', vocs: ['sorcerer', 'druid'], level: 12, mana: 20, cd: 2000, type: 'strike' },
  { words: 'exori tera', name: 'Terra Strike', vocs: ['sorcerer', 'druid'], level: 13, mana: 20, cd: 2000, type: 'strike' },
  { words: 'exori flam', name: 'Flame Strike', vocs: ['sorcerer', 'druid'], level: 14, mana: 20, cd: 2000, type: 'strike' },
  { words: 'exori frigo', name: 'Ice Strike', vocs: ['sorcerer', 'druid'], level: 15, mana: 20, cd: 2000, type: 'strike' },
  { words: 'exori mort', name: 'Death Strike', vocs: ['sorcerer'], level: 16, mana: 20, cd: 2000, type: 'strike' },
  { words: 'exori con', name: 'Ethereal Spear', vocs: ['paladin'], level: 23, mana: 25, cd: 2000, type: 'strike' },
  { words: 'exori san', name: 'Divine Missile', vocs: ['paladin'], level: 40, mana: 20, cd: 2000, type: 'strike' },
  { words: 'exori ico', name: 'Brutal Strike', vocs: ['knight'], level: 16, mana: 30, cd: 2000, type: 'strike' },
  { words: 'exori', name: 'Berserk', vocs: ['knight'], level: 35, mana: 115, cd: 2000, type: 'area' },
  { words: 'exori gran', name: 'Fierce Berserk', vocs: ['knight'], level: 90, mana: 340, cd: 4000, type: 'area' },
  { words: 'exevo mas san', name: 'Divine Caldera', vocs: ['paladin'], level: 50, mana: 160, cd: 4000, type: 'area' },
  { words: 'exevo gran mas vis', name: 'Rage of the Skies', vocs: ['sorcerer'], level: 55, mana: 600, cd: 10000, type: 'area' },
  { words: 'exori infir tera', name: 'Mud Attack', vocs: ['druid'], level: 1, mana: 6, cd: 2000, type: 'strike' },
  { words: 'exevo infir frigo hur', name: 'Chill Out', vocs: ['druid'], level: 1, mana: 8, cd: 4000, type: 'area' },
  { words: 'exori infir pug', name: 'Swift Jab', vocs: ['monk'], level: 1, mana: 3, cd: 2000, type: 'strike' },
  { words: 'exori infir nia', name: 'Tiger Clash', vocs: ['monk'], level: 1, mana: 18, cd: 8000, type: 'strike' },
  { words: 'exori infir vis', name: 'Buzz', vocs: ['sorcerer'], level: 1, mana: 6, cd: 2000, type: 'strike' },
  { words: 'exevo infir flam hur', name: 'Scorch', vocs: ['sorcerer'], level: 1, mana: 8, cd: 2000, type: 'area' },
  { words: 'exori min flam', name: 'Apprentice\'s Strike', vocs: ['sorcerer', 'druid'], level: 8, mana: 6, cd: 2000, type: 'strike' },
  { words: 'exori pug', name: 'Double Jab', vocs: ['monk'], level: 14, mana: 30, cd: 3000, type: 'strike' },
  { words: 'exori moe ico', name: 'Physical Strike', vocs: ['druid'], level: 16, mana: 20, cd: 2000, type: 'strike' },
  { words: 'exevo frigo hur', name: 'Ice Wave', vocs: ['druid'], level: 18, mana: 25, cd: 4000, type: 'area' },
  { words: 'exori ico scu', name: 'Shield Bash', vocs: ['knight'], level: 18, mana: 30, cd: 4000, type: 'strike' },
  { words: 'exori nia', name: 'Greater Tiger Clash', vocs: ['monk'], level: 18, mana: 50, cd: 8000, type: 'strike' },
  { words: 'exevo flam hur', name: 'Fire Wave', vocs: ['sorcerer'], level: 18, mana: 25, cd: 4000, type: 'area' },
  { words: 'exevo vis lux', name: 'Energy Beam', vocs: ['sorcerer'], level: 23, mana: 40, cd: 4000, type: 'area' },
  { words: 'utori flam', name: 'Ignite', vocs: ['sorcerer'], level: 26, mana: 30, cd: 6000, type: 'strike' },
  { words: 'exori hur', name: 'Whirlwind Throw', vocs: ['knight'], level: 28, mana: 40, cd: 6000, type: 'strike' },
  { words: 'exevo gran vis lux', name: 'Great Energy Beam', vocs: ['sorcerer'], level: 29, mana: 110, cd: 4000, type: 'area' },
  { words: 'exori scu', name: 'Shield Slam', vocs: ['knight'], level: 30, mana: 90, cd: 6000, type: 'area' },
  { words: 'exori amp pug', name: 'Mystic Repulse', vocs: ['monk'], level: 30, mana: 150, cd: 14000, type: 'strike' },
  { words: 'exori mas', name: 'Groundshaker', vocs: ['knight'], level: 33, mana: 160, cd: 4000, type: 'area' },
  { words: 'utori vis', name: 'Electrify', vocs: ['sorcerer'], level: 34, mana: 30, cd: 10000, type: 'strike' },
  { words: 'exori mas pug', name: 'Flurry of Blows', vocs: ['monk'], level: 35, mana: 110, cd: 4000, type: 'area' },
  { words: 'exevo tera hur', name: 'Terra Wave', vocs: ['druid'], level: 38, mana: 170, cd: 4000, type: 'area' },
  { words: 'exevo vis hur', name: 'Energy Wave', vocs: ['sorcerer'], level: 38, mana: 170, cd: 4000, type: 'area' },
  { words: 'exevo gran flam hur', name: 'Great Fire Wave', vocs: ['sorcerer'], level: 38, mana: 120, cd: 4000, type: 'area' },
  { words: 'exevo gran frigo hur', name: 'Strong Ice Wave', vocs: ['druid'], level: 40, mana: 170, cd: 4000, type: 'area' },
  { words: 'utori kor', name: 'Inflict Wound', vocs: ['knight'], level: 40, mana: 30, cd: 10000, type: 'strike' },
  { words: 'utori pox', name: 'Envenom', vocs: ['druid'], level: 50, mana: 30, cd: 10000, type: 'strike' },
  { words: 'exevo gran mas tera', name: 'Wrath of Nature', vocs: ['druid'], level: 55, mana: 700, cd: 10000, type: 'area' },
  { words: 'exori amp vis', name: 'Lightning', vocs: ['sorcerer'], level: 55, mana: 60, cd: 4000, type: 'strike' },
  { words: 'exori mas nia', name: 'Sweeping Takedown', vocs: ['monk'], level: 60, mana: 195, cd: 8000, type: 'area' },
  { words: 'exevo gran mas flam', name: 'Hell\'s Core', vocs: ['sorcerer'], level: 60, mana: 1100, cd: 10000, type: 'area' },
  { words: 'exori dir moe', name: 'Ethereal Barrage', vocs: ['paladin'], level: 60, mana: 135, cd: 4000, type: 'area' },
  { words: 'exevo max mort', name: 'Great Death Beam', vocs: ['sorcerer'], level: 66, mana: 140, cd: 10000, type: 'area' },
  { words: 'exori gran tera', name: 'Strong Terra Strike', vocs: ['druid'], level: 70, mana: 60, cd: 4000, type: 'strike' },
  { words: 'exori min', name: 'Front Sweep', vocs: ['knight'], level: 70, mana: 200, cd: 3000, type: 'area' },
  { words: 'exori med pug', name: 'Chained Penance', vocs: ['monk'], level: 70, mana: 180, cd: 4000, type: 'strike' },
  { words: 'exori gran flam', name: 'Strong Flame Strike', vocs: ['sorcerer'], level: 70, mana: 60, cd: 4000, type: 'strike' },
  { words: 'exori dir san', name: 'Divine Barrage', vocs: ['paladin'], level: 70, mana: 175, cd: 4000, type: 'area' },
  { words: 'utori san', name: 'Holy Flash', vocs: ['paladin'], level: 70, mana: 30, cd: 10000, type: 'strike' },
  { words: 'utori mort', name: 'Curse', vocs: ['sorcerer'], level: 75, mana: 30, cd: 10000, type: 'strike' },
  { words: 'exevo fur tera', name: 'Forked Thorns', vocs: ['druid'], level: 80, mana: 180, cd: 6000, type: 'strike' },
  { words: 'exori gran frigo', name: 'Strong Ice Strike', vocs: ['druid'], level: 80, mana: 60, cd: 4000, type: 'strike' },
  { words: 'exori gran vis', name: 'Strong Energy Strike', vocs: ['sorcerer'], level: 80, mana: 60, cd: 4000, type: 'strike' },
  { words: 'exevo fur frigo', name: 'Forked Glacier', vocs: ['druid'], level: 90, mana: 180, cd: 6000, type: 'strike' },
  { words: 'exori max tera', name: 'Ultimate Terra Strike', vocs: ['druid'], level: 90, mana: 100, cd: 8000, type: 'strike' },
  { words: 'exori gran mas pug', name: 'Greater Flurry of Blows', vocs: ['monk'], level: 90, mana: 300, cd: 4000, type: 'area' },
  { words: 'exori max flam', name: 'Ultimate Flame Strike', vocs: ['sorcerer'], level: 90, mana: 100, cd: 8000, type: 'strike' },
  { words: 'exori gran con', name: 'Strong Ethereal Spear', vocs: ['paladin'], level: 90, mana: 55, cd: 8000, type: 'strike' },
  { words: 'exori max frigo', name: 'Ultimate Ice Strike', vocs: ['druid'], level: 100, mana: 100, cd: 8000, type: 'strike' },
  { words: 'exori max vis', name: 'Ultimate Energy Strike', vocs: ['sorcerer'], level: 100, mana: 100, cd: 8000, type: 'strike' },
  { words: 'exori gran ico', name: 'Annihilation', vocs: ['knight'], level: 110, mana: 300, cd: 9000, type: 'strike' },
  { words: 'exori gran pug', name: 'Forceful Uppercut', vocs: ['monk'], level: 110, mana: 325, cd: 15000, type: 'strike' },
  { words: 'exori mas amp pug', name: 'Thousand Fist Blows', vocs: ['monk'], level: 120, mana: 145, cd: 12000, type: 'area' },
  { words: 'exevo mort ora', name: 'Death Echo', vocs: ['sorcerer'], level: 120, mana: 155, cd: 6000, type: 'area' },
  { words: 'exori gran nia', name: 'Devastating Knockout', vocs: ['monk'], level: 125, mana: 210, cd: 18000, type: 'strike' },
  { words: 'exevo ulus frigo', name: 'Ice Burst', vocs: ['druid'], level: 300, mana: 230, cd: 22000, type: 'area' },
  { words: 'exevo ulus tera', name: 'Terra Burst', vocs: ['druid'], level: 300, mana: 230, cd: 22000, type: 'area' },
  { words: 'exori amp kor', name: 'Executioner\'s Throw', vocs: ['knight'], level: 300, mana: 225, cd: 18000, type: 'strike' },
  { words: 'exori gran mas nia', name: 'Spiritual Outburst', vocs: ['monk'], level: 300, mana: 425, cd: 16000, type: 'area' },
  { words: 'exevo tempo mas san', name: 'Divine Grenade', vocs: ['paladin'], level: 300, mana: 160, cd: 10000, type: 'area' },
  { words: 'exura infir', name: 'Magic Patch', vocs: ['paladin', 'sorcerer', 'druid', 'monk'], level: 1, mana: 6, cd: 1000, type: 'heal' },
  { words: 'exura infir ico', name: 'Bruise Bane', vocs: ['knight'], level: 1, mana: 10, cd: 1000, type: 'heal' },
  { words: 'exura tio sio', name: 'Restore Balance', vocs: ['monk'], level: 18, mana: 120, cd: 2000, type: 'heal', healTarget: 'friend' },
  { words: 'exura gran mas res', name: 'Mass Healing', vocs: ['druid'], level: 36, mana: 150, cd: 2000, type: 'heal', healTarget: 'friend' },
  { words: 'exura gran san', name: 'Salvation', vocs: ['paladin'], level: 60, mana: 210, cd: 1000, type: 'heal' },
  { words: 'exura gran ico', name: 'Intense Wound Cleansing', vocs: ['knight'], level: 80, mana: 300, cd: 120000, type: 'heal' },
  { words: 'exura gran tio', name: 'Spirit Mend', vocs: ['monk'], level: 80, mana: 210, cd: 1000, type: 'heal' },
  { words: 'exura mas nia', name: 'Mass Spirit Mend', vocs: ['monk'], level: 150, mana: 250, cd: 8000, type: 'heal', healTarget: 'friend' },
  { words: 'exura max vita', name: 'Restoration', vocs: ['sorcerer', 'druid'], level: 300, mana: 260, cd: 6000, type: 'heal' },
  { words: 'exura med ico', name: 'Fair Wound Cleansing', vocs: ['knight'], level: 300, mana: 135, cd: 1000, type: 'heal' },
  { words: 'exura gran sio', name: 'Nature\'s Embrace', vocs: ['druid'], level: 300, mana: 400, cd: 20000, type: 'heal', healTarget: 'friend' },
  { words: 'adori gran mort', name: 'Sudden Death', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 45, mana: 5, cd: 2000, type: 'strike' },
  { words: 'adori mas frigo', name: 'Avalanche', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 30, mana: 5, cd: 2000, type: 'area' },
  { words: 'adori mas flam', name: 'Great Fireball', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 30, mana: 5, cd: 2000, type: 'area' },
  { words: 'adori mas hur', name: 'Explosion', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 31, mana: 5, cd: 2000, type: 'area' },
  { words: 'adori mas tera', name: 'Stone Shower', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 28, mana: 5, cd: 2000, type: 'area' },
  { words: 'adori mas vis', name: 'Thunderstorm', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 28, mana: 5, cd: 2000, type: 'area' },
  { words: 'adori infir vis', name: 'Lightest Missile', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 1, mana: 5, cd: 2000, type: 'strike' },
  { words: 'adori infir mas tera', name: 'Light Stone Shower', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 1, mana: 5, cd: 2000, type: 'area' },
  { words: 'adori min vis', name: 'Light Magic Missile', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 15, mana: 5, cd: 2000, type: 'strike' },
  { words: 'adura gran', name: 'Intense Healing Rune', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 15, mana: 5, cd: 1000, type: 'heal' },
  { words: 'adori tera', name: 'Stalagmite', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 24, mana: 5, cd: 2000, type: 'strike' },
  { words: 'adura vita', name: 'Ultimate Healing Rune', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 24, mana: 5, cd: 1000, type: 'heal' },
  { words: 'adori vis', name: 'Heavy Magic Missile', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 25, mana: 5, cd: 2000, type: 'strike' },
  { words: 'adori flam', name: 'Fireball', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 27, mana: 5, cd: 2000, type: 'strike' },
  { words: 'adori san', name: 'Holy Missile', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 27, mana: 5, cd: 2000, type: 'strike' },
  { words: 'adori frigo', name: 'Icicle', vocs: ['knight', 'paladin', 'sorcerer', 'druid', 'monk'], level: 28, mana: 5, cd: 2000, type: 'strike' },
  { words: 'exevo gran mas frigo', name: 'Eternal Winter', vocs: ['druid'], level: 60, mana: 1050, cd: 10000, type: 'area' },
];

/** Poções de vida (array B6 do bundle; inclui as spirit potions, que também dão mana). */
export const HP_POTIONS: PotionDef[] = [
  { name: 'small health potion', minLevel: 1, heal: 75, cost: 20 },
  { name: 'health potion', minLevel: 1, heal: 150, cost: 50 },
  { name: 'strong health potion', minLevel: 50, heal: 300, vocs: ['knight', 'paladin', 'monk'], cost: 115 },
  { name: 'great health potion', minLevel: 80, heal: 500, vocs: ['knight'], cost: 225 },
  { name: 'great spirit potion', minLevel: 80, heal: 350, mana: 300, vocs: ['paladin', 'monk'], cost: 254 },
  { name: 'ultimate health potion', minLevel: 130, heal: 750, vocs: ['knight'], cost: 379 },
  { name: 'ultimate spirit potion', minLevel: 130, heal: 550, mana: 600, vocs: ['paladin', 'monk'], cost: 488 },
  { name: 'supreme health potion', minLevel: 200, heal: 1000, vocs: ['knight'], cost: 650 },
];

/** Poções de mana (array $6 do bundle; inclui as spirit potions, que também curam). */
export const MANA_POTIONS: PotionDef[] = [
  { name: 'mana potion', minLevel: 1, mana: 120, cost: 56 },
  { name: 'strong mana potion', minLevel: 50, mana: 240, cost: 108 },
  { name: 'great mana potion', minLevel: 80, mana: 400, cost: 158 },
  { name: 'great spirit potion', minLevel: 80, heal: 350, mana: 300, vocs: ['paladin', 'monk'], cost: 254 },
  { name: 'superior mana potion', minLevel: 100, mana: 600, vocs: ['sorcerer', 'druid'], cost: 254 },
  { name: 'distilled superior mana potion', minLevel: 100, mana: 550, cost: 381 },
  { name: 'ultimate spirit potion', minLevel: 130, heal: 550, mana: 600, vocs: ['paladin', 'monk'], cost: 488 },
  { name: 'ultimate mana potion', minLevel: 130, mana: 800, vocs: ['sorcerer', 'druid'], cost: 488 },
  { name: 'distilled ultimate mana potion', minLevel: 130, mana: 750, cost: 732 },
];

/* ------------------------------------------------------------------------------------------- */
/* Interno: estimativa de cura e ranking                                                       */
/* ------------------------------------------------------------------------------------------- */

/** Coeficientes do roll MÁXIMO de cura: cura = lvl * level + ml * magicLevel + base. */
const HEAL_COEFF: Record<string, { lvl: number; ml: number; base: number }> = {
  'exura': { lvl: 0.2, ml: 1.795, base: 11 },
  'exura ico': { lvl: 0.252, ml: 10.017, base: 64.26 },
  'exura sio': { lvl: 0.2, ml: 12.79, base: 79 },
  'exura gran': { lvl: 0.2, ml: 5.59, base: 35 },
  'exura vita': { lvl: 0.24, ml: 15.48, base: 108 },
  'exura san': { lvl: 0.2, ml: 12.79, base: 79 },
  'exura infir': { lvl: 0.2, ml: 2.795, base: 17.5 },
  'exura infir ico': { lvl: 0.2, ml: 2.795, base: 17.5 },
  'exura tio sio': { lvl: 0.2, ml: 5.59, base: 35 },
  'exura gran mas res': { lvl: 0.2, ml: 8.944, base: 56 },
  'exura gran san': { lvl: 0.23, ml: 14.1427, base: 88.55 },
  'exura gran ico': { lvl: 0.2, ml: 8.944, base: 56 },
  'exura gran tio': { lvl: 0.2, ml: 8.944, base: 56 },
  'exura mas nia': { lvl: 0.2, ml: 8.944, base: 56 },
  'exura max vita': { lvl: 0.2, ml: 12.298, base: 77 },
  'exura med ico': { lvl: 0.2, ml: 5.59, base: 35 },
  'exura gran sio': { lvl: 0.2, ml: 8.944, base: 56 },
  'adura gran': { lvl: 0.2, ml: 5.4, base: 40 },
  'adura vita': { lvl: 0.2, ml: 12.4, base: 90 },
};

/** Runas (têm goldCost no bundle): curam, mas são itens consumíveis — fora do auto-heal. */
const RUNE_WORDS: ReadonlySet<string> = new Set([
  'adori gran mort',
  'adori mas frigo',
  'adori mas flam',
  'adori mas hur',
  'adori mas tera',
  'adori mas vis',
  'adori infir vis',
  'adori infir mas tera',
  'adori min vis',
  'adura gran',
  'adori tera',
  'adura vita',
  'adori vis',
  'adori flam',
  'adori san',
  'adori frigo',
]);

/**
 * Magic level estimado do personagem (o bundle não traz a ficha dele).
 * Cresce com o level e muda de vocação para vocação; serve só para ordenar as curas.
 */
function assumedMagicLevel(voc: Vocation, level: number): number {
  const base: Record<Vocation, number> = { knight: 2, paladin: 8, monk: 8, sorcerer: 15, druid: 15 };
  const perLevel: Record<Vocation, number> = { knight: 1 / 24, paladin: 1 / 12, monk: 1 / 12, sorcerer: 1 / 8, druid: 1 / 8 };
  return Math.max(0, Math.round(base[voc] + perLevel[voc] * Math.max(0, level)));
}

/** Cura estimada (roll máximo) da magia para a vocação/level informados. */
function estimatedHeal(spell: SpellDef, voc: Vocation, level: number): number {
  const c = HEAL_COEFF[spell.words];
  if (!c) return 0;
  return c.lvl * level + c.ml * assumedMagicLevel(voc, level) + c.base;
}

/**
 * Nota da magia de cura: cura estimada dividida por mana e por cooldown, com penalidades
 * suavizadas (1 + mana / 300) e (1 + cd / 1000) — assim uma magia de level 1 barata e fraca
 * não vence a cura de verdade do personagem, mas cooldowns longos (exura gran ico, 120 s) somem.
 */
function healScore(spell: SpellDef, voc: Vocation, level: number): number {
  const heal = estimatedHeal(spell, voc, level);
  const manaPenalty = 1 + spell.mana / 300;
  const cdPenalty = 1 + spell.cd / 1000;
  return heal / manaPenalty / cdPenalty;
}

/* ------------------------------------------------------------------------------------------- */
/* API pública                                                                                 */
/* ------------------------------------------------------------------------------------------- */

/**
 * Magias de cura própria disponíveis para a vocação no level informado.
 * Espelha o filtro do próprio jogo (vOe): type "heal", healTarget diferente de "friend",
 * vocação na lista e level já alcançado.
 */
export function healsFor(voc: Vocation, level: number): SpellDef[] {
  return SPELL_CATALOG.filter(
    (s) => s.type === 'heal' && s.healTarget !== 'friend' && s.vocs.includes(voc) && s.level <= level,
  );
}

/**
 * Magias de ataque (strike ou area) disponíveis para a vocação no level informado.
 *
 * Runas ficam de fora: no bundle elas têm `goldCost` — são item comprado, não
 * magia livre. Sem este filtro o preenchimento da rotação (buildPlan) podia
 * colocar "adori mas flam" num slot e o bot tentaria lançar um item que talvez
 * nem esteja no estoque.
 */
export function attacksFor(voc: Vocation, level: number): SpellDef[] {
  return SPELL_CATALOG.filter(
    (s) =>
      (s.type === 'strike' || s.type === 'area') &&
      s.vocs.includes(voc) &&
      s.level <= level &&
      !RUNE_WORDS.has(s.words),
  );
}

/**
 * Melhor magia de cura própria para a vocação/level, ranqueada por cura estimada / mana /
 * cooldown. Runas ficam de fora. Devolve null se não houver nenhuma cura disponível.
 */
export function pickHealSpell(voc: Vocation, level: number): SpellDef | null {
  let best: SpellDef | null = null;
  let bestScore = 0;
  for (const spell of healsFor(voc, level)) {
    if (RUNE_WORDS.has(spell.words)) continue;
    const score = healScore(spell, voc, level);
    if (score > bestScore) {
      bestScore = score;
      best = spell;
    }
  }
  return best;
}

/** Poção utilizável pela vocação no level (sem vocs = todas as vocações). */
function potionUsable(p: PotionDef, voc: Vocation, level: number): boolean {
  return (!p.vocs || p.vocs.includes(voc)) && p.minLevel <= level;
}

/** Melhor poção da lista: maior valor restaurado; empate vai para a mais barata. */
function pickPotion(list: PotionDef[], voc: Vocation, level: number, field: 'heal' | 'mana'): PotionDef | null {
  let best: PotionDef | null = null;
  for (const p of list) {
    if (!potionUsable(p, voc, level)) continue;
    const value = p[field] ?? 0;
    if (value <= 0) continue;
    if (!best) { best = p; continue; }
    const bestValue = best[field] ?? 0;
    if (value > bestValue || (value === bestValue && (p.cost ?? 0) < (best.cost ?? 0))) best = p;
  }
  return best;
}

/** Melhores poções de vida e de mana para a vocação/level. */
export function pickPotions(voc: Vocation, level: number): { hp: PotionDef | null; mana: PotionDef | null } {
  return { hp: pickPotion(HP_POTIONS, voc, level, 'heal'), mana: pickPotion(MANA_POTIONS, voc, level, 'mana') };
}
