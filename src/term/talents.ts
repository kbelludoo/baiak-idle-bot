/**
 * Árvore de talentos ("build") — regras do bundle + planejador de alocação.
 *
 * Regras extraídas do cliente (index.js), todas verificadas no bundle:
 *  - custo do PRÓXIMO rank:  small -> cost * (rank + 1);  notable -> cost
 *    (\`Ik\` L1966829 e \`z3e\` — o gasto acumulado de um small em rank r é
 *    cost * r * (r + 1) / 2);
 *  - desbloqueio: \`tier === 0\` ou PELO MENOS UM nó de \`requires\` com rank >= 1
 *    (\`yD\` L1967410);
 *  - orçamento: \`spentPoints + custoDoProximoRank <= level\` — ou seja, o teto de
 *    pontos é o NÍVEL do personagem ("Pontos disponíveis (1 por level)", L4070434);
 *  - envio: \`tree{slot, action:"spend", nodeId}\` (wiring L4471033). O cliente manda
 *    UM envio por ponto (\`for(const De of uf) w2?.(a.slot,"spend",De)\`, L4072768) e
 *    NÃO passa \`code\` (o \`code\` só é usado em \`action:"import"\`);
 *  - \`tree\` NÃO está na lista de ações com gate de presença (At) do antibot.
 *
 * O planejador é uma heurística gulosa: a cada ponto escolhe o nó desbloqueado com
 * maior ganho marginal por ponto, onde o ganho vem de um modelo multiplicativo
 * (dano) + sobrevivência ponderada. Não é um solver ótimo — é auditável e barato.
 */

import { TALENT_TREES, type TalentNode } from './talent_data';

export type TreeRanks = Record<string, number>;

/** Bloco de bônus no mesmo formato de \`vf()\` do bundle (L1862923). */
export interface BonusBlock {
  atkPct: number;
  defFlat: number;
  armorFlat: number;
  critChance: number;
  critDmg: number;
  lifeLeech: number;
  manaLeech: number;
  hpPct: number;
  manaPct: number;
  expPct: number;
  lootPct: number;
  spellDmgPct: number;
  attackSpeedPct: number;
  spellHealPct: number;
  hpRegenPct: number;
  mpRegenPct: number;
  execute: number;
  absorbPct: Record<string, number>;
  elementDmgPct: Record<string, number>;
  /** Valores dos nós \`special\` somados por rank (\`d_\` no bundle). */
  specials: Record<string, number>;
}

export function emptyBonus(): BonusBlock {
  return {
    atkPct: 0, defFlat: 0, armorFlat: 0, critChance: 0, critDmg: 0, lifeLeech: 0, manaLeech: 0,
    hpPct: 0, manaPct: 0, expPct: 0, lootPct: 0, spellDmgPct: 0, attackSpeedPct: 0,
    spellHealPct: 0, hpRegenPct: 0, mpRegenPct: 0, execute: 0,
    absorbPct: {}, elementDmgPct: {}, specials: {},
  };
}

export function treeNodes(vocation: string): TalentNode[] {
  return TALENT_TREES[String(vocation || '').trim().toLowerCase()] ?? [];
}

export function findNode(vocation: string, nodeId: string): TalentNode | undefined {
  return treeNodes(vocation).find((n) => n.id === nodeId);
}

/** Custo em pontos do próximo rank (equivalente a \`Ik\` do bundle). */
export function rankCost(node: TalentNode, rank: number): number {
  if (node.kind === 'small') return node.cost * (Math.max(0, rank) + 1);
  return node.cost;
}

/** Pontos já investidos (equivalente a \`Up\` do bundle). */
export function spentPoints(vocation: string, ranks: TreeRanks): number {
  let total = 0;
  for (const node of treeNodes(vocation)) {
    const rank = Math.min(Math.max(0, Math.floor(ranks[node.id] ?? 0)), node.maxRank);
    if (rank <= 0) continue;
    total += node.kind === 'small' ? (node.cost * rank * (rank + 1)) / 2 : node.cost;
  }
  return total;
}

/** \`tier === 0\` ou algum pré-requisito com rank >= 1. */
export function isUnlocked(vocation: string, ranks: TreeRanks, node: TalentNode): boolean {
  if (node.tier <= 0) return true;
  const reqs = node.requires ?? [];
  if (reqs.length === 0) return true;
  return reqs.some((r) => (ranks[r] ?? 0) >= 1);
}

/** Mesma regra de \`yD(voc, ranks, nodeId, level)\` do bundle. */
export function canAllocate(vocation: string, ranks: TreeRanks, nodeId: string, level: number): boolean {
  const node = findNode(vocation, nodeId);
  if (!node) return false;
  const rank = Math.floor(ranks[nodeId] ?? 0);
  if (rank >= node.maxRank) return false;
  if (!isUnlocked(vocation, ranks, node)) return false;
  return spentPoints(vocation, ranks) + rankCost(node, rank) <= Math.max(0, Math.floor(level));
}

/** Normaliza o \`tree\` que vem do servidor (objeto ou string JSON). */
export function parseTree(raw: unknown): TreeRanks {
  let obj: any = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw || '{}'); } catch { obj = {}; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: TreeRanks = {};
  for (const [k, v] of Object.entries(obj)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
  }
  return out;
}

/** Agrega \`per\`/\`special\` de todos os nós com rank > 0 (\`fq\` + \`d_\` do bundle). */
export function aggregate(vocation: string, ranks: TreeRanks): BonusBlock {
  const b = emptyBonus();
  for (const node of treeNodes(vocation)) {
    const rank = Math.min(Math.max(0, Math.floor(ranks[node.id] ?? 0)), node.maxRank);
    if (rank <= 0) continue;
    for (const [key, value] of Object.entries(node.per ?? {})) {
      if (typeof value === 'number') {
        (b as any)[key] = ((b as any)[key] ?? 0) + value * rank;
        continue;
      }
      const target = key === 'absorbPct' ? b.absorbPct : key === 'elementDmgPct' ? b.elementDmgPct : null;
      if (!target) continue;
      for (const [el, amount] of Object.entries(value)) {
        if (typeof amount !== 'number') continue;
        target[el] = (target[el] ?? 0) + amount * rank;
      }
    }
    if (node.special) b.specials[node.special.key] = (b.specials[node.special.key] ?? 0) + node.special.value * rank;
  }
  return b;
}

export interface PlanOptions {
  /** Peso da sobrevivência no score (0 = só dano). */
  survivalWeight?: number;
  /** Peso de XP/loot no score. */
  utilityWeight?: number;
  /** Quantos monstros adjacentes o cleave (slash) costuma acertar. */
  adjacency?: number;
  /** Multiplicador base do crítico (0.5 = +50% de dano no crítico). */
  baseCritBonus?: number;
}

const DEFAULT_OPTIONS: Required<PlanOptions> = {
  survivalWeight: 0.35,
  utilityWeight: 0.02,
  adjacency: 2,
  baseCritBonus: 0.5,
};

/** Valor (em % de DPS) dos nós \`special\` de dano. */
function specialDps(specials: Record<string, number>, opts: Required<PlanOptions>): number {
  let pct = 0;
  pct += (specials.slash ?? 0) * opts.adjacency;       // corta os adjacentes por X% do golpe
  pct += (specials.chain ?? 0) * 0.6;                  // salta pra +1 monstro com 60% do dano
  pct += specials.precision ?? 0;                      // X% de chance de um 2º ataque completo
  pct += (specials.tactics ?? 0) * 0.8;                // IA de combate (mira/posição/kite)
  pct += (specials.avatar ?? 0) * 6;                   // ~60% de uptime * crítico garantido
  return pct;
}

/** Valor (em % de EHP) dos nós \`special\` defensivos. */
function specialEhp(specials: Record<string, number>): number {
  let pct = 0;
  pct += specials.gift_of_life ?? 0;                   // sobrevive a golpe letal
  pct += specials.battle_instinct ?? 0;                // def por monstro em melee
  pct += specials.dodge ?? 0;                          // chance de desviar
  pct += (specials.momentum ?? 0) * 0.2;               // corta cooldown (indireto)
  return pct;
}

/** Multiplicador de dano do bloco de bônus (modelo multiplicativo documentado). */
export function dpsMultiplier(b: BonusBlock, opts: PlanOptions = {}): number {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const crit = 1 + (b.critChance / 100) * (o.baseCritBonus + b.critDmg / 100);
  const atk = 1 + (b.atkPct + b.spellDmgPct) / 100;
  const spd = 1 + b.attackSpeedPct / 100;
  const element = Object.values(b.elementDmgPct).reduce((a, v) => a + v, 0);
  const el = 1 + (element * 0.8) / 100;
  const exec = 1 + (b.execute * 0.15) / 100;
  const special = 1 + specialDps(b.specials, o) / 100;
  return atk * spd * crit * el * exec * special;
}

export function ehpMultiplier(b: BonusBlock, opts: PlanOptions = {}): number {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const hp = 1 + b.hpPct / 100;
  const absorb = Object.values(b.absorbPct).reduce((a, v) => a + v, 0);
  const abs = 1 + (absorb * 0.5) / 100;
  const arm = 1 + (b.armorFlat * 0.6 + b.defFlat * 0.6) / 100;
  const leech = 1 + Math.min(b.lifeLeech, 25) / 100;
  const regen = 1 + (b.hpRegenPct * 0.1) / 100;
  const special = 1 + specialEhp(b.specials) / 100;
  return hp * abs * arm * leech * regen * special;
}

export function utilityValue(b: BonusBlock): number {
  return b.expPct + b.lootPct + b.manaPct * 0.2 + b.spellHealPct * 0.3;
}

export function scoreBonus(b: BonusBlock, opts: PlanOptions = {}): number {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  return dpsMultiplier(b, o) + o.survivalWeight * ehpMultiplier(b, o) + o.utilityWeight * (utilityValue(b) / 100);
}

/**
 * Planeja a alocação ponto a ponto (uma entrada por ponto — é o que o cliente envia).
 * Retorna a lista de nodeIds na ordem de envio.
 */
export function planAllocation(
  vocation: string,
  ranks: TreeRanks,
  level: number,
  opts: PlanOptions = {},
): string[] {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const nodes = treeNodes(vocation);
  if (nodes.length === 0) return [];
  const budget = Math.max(0, Math.floor(level));

  const cur: TreeRanks = {};
  for (const n of nodes) {
    const r = Math.min(Math.max(0, Math.floor(ranks[n.id] ?? 0)), n.maxRank);
    if (r > 0) cur[n.id] = r;
  }

  const plan: string[] = [];
  // Teto de iterações = soma dos ranks máximos da árvore (nenhum nó passa disso).
  const maxRanks = nodes.reduce((a, n) => a + n.maxRank, 0);
  for (let step = 0; step < maxRanks; step++) {
    const spent = spentPoints(vocation, cur);
    const baseScore = scoreBonus(aggregate(vocation, cur), o);
    let bestId: string | null = null;
    let bestEff = -Infinity;
    for (const node of nodes) {
      const rank = cur[node.id] ?? 0;
      if (rank >= node.maxRank) continue;
      if (!isUnlocked(vocation, cur, node)) continue;
      const cost = rankCost(node, rank);
      if (spent + cost > budget) continue;
      const gain = scoreBonus(aggregate(vocation, { ...cur, [node.id]: rank + 1 }), o) - baseScore;
      const eff = gain / cost;
      if (eff > bestEff + 1e-12) { bestId = node.id; bestEff = eff; }
    }
    if (!bestId) break;
    // UMA entrada por RANK — é exatamente o que o cliente envia no "Confirmar"
    // (\`vi.push(te.id)\` dentro do laço de ranks, L4076415), e cada envio
    // \`tree{action:"spend"}\` sobe 1 rank descontando o custo do rank.
    cur[bestId] = (cur[bestId] ?? 0) + 1;
    plan.push(bestId);
  }
  return plan;
}

/** Ranks finais que o plano produz (para comparar com o servidor). */
export function ranksAfter(vocation: string, ranks: TreeRanks, plan: string[]): TreeRanks {
  const out: TreeRanks = { ...ranks };
  for (const id of plan) {
    const node = findNode(vocation, id);
    if (!node) continue;
    const r = (out[id] ?? 0) + 1;
    if (r <= node.maxRank) out[id] = r;
  }
  return out;
}

/** Envios prontos para o Colyseus (um por ponto, como o cliente faz). */
export function treeSpendMessages(slot: number, plan: string[]): Array<{ slot: number; action: 'spend'; nodeId: string }> {
  return plan.map((nodeId) => ({ slot, action: 'spend' as const, nodeId }));
}

/** Resumo legível do plano para o log. */
export function describeTree(vocation: string, ranks: TreeRanks, level: number): string {
  const spent = spentPoints(vocation, ranks);
  const b = aggregate(vocation, ranks);
  const parts = [
    `${spent}/${Math.floor(level)} pts`,
    `atk ${b.atkPct.toFixed(1)}%`,
    `crit ${b.critChance.toFixed(1)}%/+ ${b.critDmg.toFixed(1)}%`,
    `aspd ${b.attackSpeedPct.toFixed(1)}%`,
    `hp ${b.hpPct.toFixed(1)}%`,
  ];
  const sp = Object.entries(b.specials).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`);
  if (sp.length) parts.push(sp.join(','));
  return parts.join(' | ');
}
