/**
 * Config de helper/magias/pocoes do driver terminal (sem navegador).
 * Foco em MAIOR DANO POSSÍVEL (Max DPS) e MELHOR ESTOQUE (Best-in-Slot).
 *
 * Mapa de slots descoberto empiricamente (na party desta conta):
 *   slot 0 = Secondpally (115596, paladin)
 *   slot 1 = sencodtank  (114999, knight)
 *   slot 2 = Sofisico    (115396, monk)
 * Sends (payloads de room_send.ts:113-118):
 *   helper {slot,cfg} | potion {slot,kind,name,below} | rotation {slot,spells} | spellminmobs {slot,words,minMobs}
 */
import { attacksFor, pickHealSpell, type Vocation, HP_POTIONS, MANA_POTIONS } from './spell_catalog';
import type { Room } from './colyseus';

export const PARTY_SLOTS: Record<string, number> = { Secondpally: 0, sencodtank: 1, Sofisico: 2 };

export interface AutoConfigPlan {
  name: string;
  charSlot: number;
  vocation: string;
  healSpell: string | null;
  healBelow: number;
  rotation: string[];
  minMobs: Record<string, number>;
  hpPotion: string | null;
  hpBelow: number;
  manaPotion: string | null;
  manaBelow: number;
  notes: string[];
}

function normPotion(name: string): string { return String(name || '').trim().toLowerCase(); }

/**
 * Retorna a melhor poção absoluta permitida pelo nível e vocação (Best in Slot),
 * pois o ouro é farto nas hunts e o bot mantém auto-refill e auto-compra ativos.
 */
export function melhorPocaoBiS(
  catalogo: Array<{ name: string; minLevel: number; heal?: number; mana?: number; vocs?: Vocation[] }>,
  voc: Vocation,
  level: number,
  tipo: 'hp' | 'mana',
): string | null {
  const chave = tipo === 'hp' ? 'heal' : 'mana';
  const validos = catalogo
    .filter((p) => (!p.vocs || p.vocs.includes(voc)) && p.minLevel <= level)
    .filter((p) => Number((p as any)[chave] ?? 0) > 0)
    .sort((a, b) => Number((b as any)[chave] ?? 0) - Number((a as any)[chave] ?? 0));
  return validos.length > 0 ? validos[0].name : null;
}

/**
 * Rotação com foco em MAIOR DANO POSSÍVEL (Max AoE + Single Target Finisher)
 * balanceada com a economia de recursos de cada vocação.
 */
export function getRecommendedRotation(voc: Vocation, level: number): string[] {
  switch (voc) {
    case 'knight':
      // Knight: Com mana pot (distilled ultimate mana potion @ 750 mana), sustenta rotação de puro dano em área!
      if (level >= 90) return ['exori gran', 'exori', 'exori min', 'exori mas'];
      if (level >= 70) return ['exori', 'exori min', 'exori mas', 'exori scu'];
      if (level >= 35) return ['exori', 'exori mas', 'exori scu', 'exori ico'];
      return ['exori ico', 'exori ico scu', 'exori hur', 'exori'];

    case 'monk':
      // Monk: Com ultimate spirit pot / mana pot de topo, usa as melhores áreas do jogo (substitui magias infir).
      if (level >= 90) return ['exori gran mas pug', 'exori mas pug', 'exori mas nia', 'exori med pug'];
      if (level >= 60) return ['exori mas pug', 'exori mas nia', 'exori amp pug', 'exori pug'];
      if (level >= 35) return ['exori mas pug', 'exori amp pug', 'exori nia', 'exori pug'];
      return ['exori pug', 'exori nia', 'exori infir pug', 'exori infir nia'];

    case 'paladin':
      // Paladin: Alto pool de mana + ultimate spirit pot. Maximiza o dano de área sagrada/física.
      if (level >= 70) return ['exevo mas san', 'exori dir san', 'exori dir moe', 'exori gran con'];
      if (level >= 60) return ['exevo mas san', 'exori dir moe', 'exori san', 'exori con'];
      if (level >= 50) return ['exevo mas san', 'exori san', 'exori con', 'utori san'];
      return ['exori con', 'exori san', 'utori san', 'exori'];

    case 'sorcerer':
      if (level >= 90) return ['exevo gran mas flam', 'exori max flam', 'exori gran flam', 'exevo vis hur'];
      if (level >= 60) return ['exevo gran mas flam', 'exori gran flam', 'exevo vis hur', 'exori flam'];
      return ['exevo flam hur', 'exori flam', 'exori vis', 'exori mort'];

    case 'druid':
      if (level >= 90) return ['exevo gran mas frigo', 'exori max frigo', 'exori gran frigo', 'exevo frigo hur'];
      if (level >= 60) return ['exevo gran mas frigo', 'exori gran frigo', 'exevo frigo hur', 'exori frigo'];
      return ['exevo frigo hur', 'exori frigo', 'exori tera', 'exori infir tera'];

    default:
      return [];
  }
}

export function buildPlan(
  char: any,
  charSlot: number,
  _supply: Record<string, number> = {},
): AutoConfigPlan {
  const st = char.state || {};
  const voc = String(char.vocation || '').toLowerCase() as Vocation;
  const level = Number(char.level || 1);
  const notas: string[] = [];

  const heal = pickHealSpell(voc, level);
  const healAtual = String(st.helper?.healSpell ?? '');
  const healSpell = heal ? heal.words : (healAtual || null);
  if (heal && heal.words !== healAtual) {
    notas.push(`healSpell: ${healAtual || '-'} -> ${heal.words}`);
  }

  // Rotação: Prioriza MAX DPS (fórmulas e sinergia de combate)
  const disponiveis = new Set(attacksFor(voc, level).map((s) => s.words));
  const recomendada = getRecommendedRotation(voc, level).filter((w) => disponiveis.has(w));

  // Substitui qualquer rotação que contenha magias fracas ("infir") ou desatualizadas
  const atual: string[] = Array.isArray(st.rotation) ? st.rotation.map((s: any) => String(s ?? '')) : [];
  const temInfir = atual.some((s) => s.includes('infir'));
  const incompleta = atual.filter(Boolean).length < 4;

  let rotation = [...recomendada];
  if (!temInfir && !incompleta && atual.length === 4) {
    // Se o usuário já tiver uma rotação personalizada válida sem magias de level 1, mantém
    const ehPadraoFraco = atual.some((s) => s === 'exori infir pug' || s === 'exori infir nia');
    if (!ehPadraoFraco) {
      rotation = [...atual];
    }
  }

  // Garante 4 slots preenchidos
  while (rotation.length < 4) {
    const sobra = [...disponiveis].find((w) => !rotation.includes(w) && !w.includes('infir'));
    if (sobra) rotation.push(sobra); else break;
  }
  rotation = rotation.slice(0, 4);

  const minMobs: Record<string, number> = {};
  for (const w of rotation) {
    if (!w) continue;
    const def = attacksFor(voc, level).find((s) => s.words === w);
    if (def && def.type === 'area') minMobs[w] = 2;
  }

  // Poções: Seleciona as melhores poções absolutas (Best in Slot)
  // Gastar ouro não é problema: auto-buy e auto-refill compram o melhor estoque
  const hpPotion = melhorPocaoBiS(HP_POTIONS, voc, level, 'hp');
  const manaPotion = melhorPocaoBiS(MANA_POTIONS, voc, level, 'mana');

  if (hpPotion && normPotion(hpPotion) !== normPotion(st.hpPotion)) {
    notas.push(`hpPotion: ${st.hpPotion || '-'} -> ${hpPotion}`);
  }
  if (manaPotion && normPotion(manaPotion) !== normPotion(st.manaPotion)) {
    notas.push(`manaPotion: ${st.manaPotion || '-'} -> ${manaPotion}`);
  }

  // Gatilho de mana calibrado pelo tamanho do pool de mana vs os 750 da poção:
  // - Knight (~1.275 mana): 750 de mana representa ~59% da barra!
  //   Gatilho a 42% aproveita 100% da poção (+750 sem desperdício) e mantém 500+ de mana de reserva
  //   para soltar exori gran (340) + exura ico (60) tranquilamente.
  // - Monk (~2.200 mana): 65% (gasto de 35% = ~770 mana -> aproveita os 750).
  // - Paladin (~4.150 mana): 70% (gasto de 30% = ~1.245 mana -> aproveita os 750 com folga).
  const manaBelow = voc === 'knight' ? 42 : (voc === 'monk' ? 65 : 70);

  return {
    name: String(char.name),
    charSlot,
    vocation: voc,
    healSpell: healSpell || null,
    healBelow: 70,
    rotation,
    minMobs,
    hpPotion,
    hpBelow: 70,
    manaPotion,
    manaBelow,
    notes: notas,
  };
}

/** Aplica o plano no slot indicado. Read-modify-write no helper para nao zerar campos. */
export function applyPlan(room: Room, plan: AutoConfigPlan, helperAtual: any, log: (m: string) => void): void {
  const cfg = { ...(helperAtual || {}), healEnabled: true, healSpell: plan.healSpell ?? '', healBelow: plan.healBelow };
  room.send('helper', { slot: plan.charSlot, cfg });
  room.send('rotation', { slot: plan.charSlot, spells: plan.rotation });
  for (const [words, minMobs] of Object.entries(plan.minMobs)) room.send('spellminmobs', { slot: plan.charSlot, words, minMobs });
  if (plan.hpPotion) room.send('potion', { slot: plan.charSlot, kind: 'hp', name: plan.hpPotion, below: plan.hpBelow });
  if (plan.manaPotion) room.send('potion', { slot: plan.charSlot, kind: 'mana', name: plan.manaPotion, below: plan.manaBelow });
  log(`[config] slot ${plan.charSlot} ${plan.name}: heal=${plan.healSpell}@${plan.healBelow}% rot=[${plan.rotation.filter(Boolean).join(', ')}] hp=${plan.hpPotion}@${plan.hpBelow}% mana=${plan.manaPotion || '-'}@${plan.manaBelow}%` + (plan.notes.length ? ` (${plan.notes.join('; ')})` : ''));
}
