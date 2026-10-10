import { describe, it, expect } from 'vitest';
import {
  aggregate, canAllocate, describeTree, findNode, parseTree, planAllocation,
  rankCost, ranksAfter, spentPoints, treeSpendMessages, treeNodes,
} from '../src/term/talents';
import { TALENT_TREES } from '../src/term/talent_data';

describe('Árvore de talentos — regras do bundle', () => {
  it('tem as 5 vocações com os nós esperados', () => {
    expect(Object.keys(TALENT_TREES).sort()).toEqual(['druid', 'knight', 'monk', 'paladin', 'sorcerer']);
    expect(treeNodes('knight').length).toBeGreaterThan(40);
    expect(findNode('knight', 'k_fury')?.per).toEqual({ atkPct: 1.5 });
    expect(findNode('monk', 'm_fists')).toBeTruthy();
    expect(findNode('paladin', 'p_aim')).toBeTruthy();
    expect(findNode('knight', 'p_aim')).toBeUndefined();
  });

  it('custo do próximo rank segue Ik: small = cost*(rank+1), notable = cost', () => {
    const fury = findNode('knight', 'k_fury')!;
    expect(rankCost(fury, 0)).toBe(1);
    expect(rankCost(fury, 1)).toBe(2);
    expect(rankCost(fury, 9)).toBe(10);
    const mastery = findNode('knight', 'k_combat_mastery')!;
    expect(mastery.kind).toBe('notable');
    expect(rankCost(mastery, 0)).toBe(50);
    expect(rankCost(mastery, 0)).toBe(mastery.cost);
  });

  it('gasto acumulado de um small em rank 10 é cost*55 (z3e)', () => {
    expect(spentPoints('knight', { k_fury: 10 })).toBe(55);
    expect(spentPoints('knight', { k_fury: 3 })).toBe(6);
    expect(spentPoints('knight', { k_combat_mastery: 1 })).toBe(50);
    expect(spentPoints('knight', {})).toBe(0);
  });

  it('respeita maxRank no gasto', () => {
    expect(spentPoints('knight', { k_fury: 999 })).toBe(55);
  });

  it('desbloqueio exige ao menos UM pré-requisito com rank >= 1', () => {
    expect(canAllocate('knight', {}, 'k_fury', 240)).toBe(true);
    expect(canAllocate('knight', {}, 'k_haste', 240)).toBe(false);      // requires k_fury
    expect(canAllocate('knight', {}, 'k_sharp', 240)).toBe(false);      // requires k_fury + k_vigor
    expect(canAllocate('knight', { k_fury: 1 }, 'k_haste', 240)).toBe(true);
    expect(canAllocate('knight', { k_vigor: 1 }, 'k_sharp', 240)).toBe(true); // UM basta
    expect(canAllocate('knight', { k_fury: 1 }, 'k_sharp', 240)).toBe(true);  // k_fury sozinho já libera
  });

  it('orçamento é o nível do personagem (yD: spent + custo <= level)', () => {
    expect(canAllocate('knight', {}, 'k_vigor', 0)).toBe(false);
    expect(canAllocate('knight', {}, 'k_vigor', 1)).toBe(true);
    expect(canAllocate('knight', { k_fury: 1 }, 'k_vigor', 2)).toBe(true);  // 1 gasto + 1 custo = 2 <= 2
    expect(canAllocate('knight', { k_fury: 1, k_vigor: 1 }, 'k_plating', 1)).toBe(false); // 2 gastos + 1 > 1
  });

  it('normaliza tree vindo como objeto ou string e descarta lixo', () => {
    expect(parseTree('{"k_fury":3}')).toEqual({ k_fury: 3 });
    expect(parseTree({ k_fury: 3, lixo: 'x', negativo: -2 })).toEqual({ k_fury: 3 });
    expect(parseTree('{quebrado')).toEqual({});
    expect(parseTree(null)).toEqual({});
  });
});

describe('Planejador de alocação', () => {
  const simular = (voc: string, ranks: Record<string, number>, level: number) => {
    const plan = planAllocation(voc, ranks, level);
    const cur = { ...ranks };
    for (const id of plan) {
      expect(canAllocate(voc, cur, id, level)).toBe(true);
      cur[id] = (cur[id] ?? 0) + 1;
    }
    return { plan, cur };
  };

  it('nunca estoura o orçamento do nível', () => {
    for (const [voc, level] of [['knight', 240], ['monk', 247], ['paladin', 269], ['sorcerer', 8]] as const) {
      const { cur } = simular(voc, {}, level);
      expect(spentPoints(voc, cur)).toBeLessThanOrEqual(level);
    }
  });

  it('é idempotente: replanejar depois de aplicar tende a zero', () => {
    const { cur } = simular('knight', {}, 240);
    const resto = planAllocation('knight', cur, 240);
    expect(resto.length).toBe(0);
  });

  it('não regasta ranks já existentes além do maxRank', () => {
    const { cur } = simular('knight', { k_fury: 10 }, 240);
    expect(cur.k_fury).toBe(10);
    expect(spentPoints('knight', cur)).toBeLessThanOrEqual(240);
  });

  it('continua a build do paladin de onde ela está (20 ranks já gastos)', () => {
    const atual = {
      p_aim: 1, p_pace: 1, p_ward: 1, p_aegis: 1, p_faith: 1, p_leech: 1, p_might: 1, p_power: 1,
      p_rapid: 1, p_swift: 1, p_spirit: 1, p_blessed: 1, p_caldera: 1, p_marksman: 1, p_piercing: 1,
      p_sanctify: 1, p_vitality: 1, p_precision: 1, p_scavenger: 1, p_positional: 1,
    };
    const { cur, plan } = simular('paladin', atual, 269);
    expect(plan.length).toBeGreaterThan(0);
    expect(spentPoints('paladin', cur)).toBeLessThanOrEqual(269);
    for (const [id, r] of Object.entries(atual)) expect(cur[id]).toBeGreaterThanOrEqual(r);
  });

  it('prioriza ataque no início do knight (k_fury entra primeiro)', () => {
    const plan = planAllocation('knight', {}, 20);
    expect(plan[0]).toBe('k_fury');
    expect(plan.length).toBeGreaterThan(0);
    const gasto = spentPoints('knight', ranksAfter('knight', {}, plan));
    expect(gasto).toBeGreaterThan(15); // aproveita quase todo o orçamento de 20
    expect(gasto).toBeLessThanOrEqual(20);
  });

  it('agrega bônus multiplicando pelo rank (fq/d_)', () => {
    const b = aggregate('knight', { k_fury: 4, k_vigor: 2, k_slash1: 1 });
    expect(b.atkPct).toBe(6);
    expect(b.hpPct).toBe(2);
    expect(b.specials.slash).toBe(40);
  });

  it('agrega absorbPct/elementDmgPct por elemento', () => {
    const b = aggregate('knight', { k_fire_ward: 3, k_smash: 2 });
    expect(b.absorbPct.fire).toBeCloseTo(1.5, 6);
    expect(b.elementDmgPct.physical).toBe(2);
  });

  it('gera um envio spend por rank, no formato do cliente', () => {
    const msgs = treeSpendMessages(1, ['k_fury', 'k_fury', 'k_vigor']);
    expect(msgs).toEqual([
      { slot: 1, action: 'spend', nodeId: 'k_fury' },
      { slot: 1, action: 'spend', nodeId: 'k_fury' },
      { slot: 1, action: 'spend', nodeId: 'k_vigor' },
    ]);
  });

  it('descreve o estado para o log', () => {
    const txt = describeTree('knight', { k_fury: 4 }, 240);
    expect(txt).toContain('10/240 pts'); // rank 4 de um small cost 1 = 1+2+3+4
    expect(txt).toContain('atk 6.0%');
  });
});
