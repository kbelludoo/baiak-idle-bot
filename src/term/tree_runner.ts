/**
 * Aplicação da árvore de talentos ("build") pelo driver headless.
 *
 * O envio \`tree{slot, action:"spend", nodeId}\` NÃO tem gate de presença humana
 * (o wiring do bundle é \`aTe((N,Q,B,Z)=>l.send("tree",...))\`, sem \`At()\`), então
 * dá para alocar direto do terminal — confirmado ao vivo em 2026-10-06:
 * \`tree{slot:1,action:"spend",nodeId:"k_fury"}\` subiu o rank do sencodtank.
 *
 * Dois detalhes medidos no servidor real:
 *  1. cada envio = +1 RANK (desconta o custo do rank), igual ao "Confirmar" do
 *     cliente (\`vi.push(te.id)\` por rank, L4076415);
 *  2. o \`characters.list\` do tRPC NÃO reflete a árvore na hora — o save do
 *     personagem leva de ~20 s a ~1 min. Por isso a rotina espera o estado
 *     estabilizar antes de planejar e confere depois com tolerância.
 *
 * O teto de pontos é o NÍVEL do personagem (\`spentPoints + custo <= level\`),
 * então o planejador converge: depois de gasto, o plano volta vazio e a rotina
 * vira no-op (idempotente entre reconexões).
 */

import type { Room } from './colyseus';
import type { TrpcClient } from '../trpc';
import { PARTY_SLOTS } from './autoconfig';
import {
  describeTree, parseTree, planAllocation, spentPoints,
  type PlanOptions, type TreeRanks,
} from './talents';
import { TALENT_TREES } from './talent_data';

export interface TreeTarget {
  slot: number;
  name: string;
  vocation: string;
  level: number;
  /** ranks atuais lidos do servidor */
  ranks: TreeRanks;
  /** uma entrada por rank a comprar (ordem de envio) */
  plan: string[];
  /** ranks esperados depois de aplicar o plano */
  expected: TreeRanks;
}

export interface TreeRunOptions extends PlanOptions {
  /** Intervalo entre envios (ms). Padrão 25ms = 40/s. */
  paceMs?: number;
  /** Sobrescreve o mapa nome->slot (padrão: PARTY_SLOTS / TREE_SLOTS). */
  slots?: Record<string, number>;
  /** Só calcula, não envia. */
  dryRun?: boolean;
  /** Intervalo entre leituras do tRPC ao esperar o estado estabilizar. */
  settleMs?: number;
  /** Teto de espera pela estabilização do tRPC. */
  settleMaxMs?: number;
  /** Teto de espera pela confirmação pós-envio. */
  verifyMs?: number;
  log?: (msg: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function slotMap(override?: Record<string, number>): Record<string, number> {
  if (override) return override;
  const env = process.env.TREE_SLOTS;
  if (env && env.includes(':')) {
    const out: Record<string, number> = {};
    for (const par of env.split(',')) {
      const [nome, s] = par.split(':');
      const n = Number(s);
      if (nome && Number.isFinite(n)) out[nome.trim()] = n;
    }
    if (Object.keys(out).length) return out;
  }
  return PARTY_SLOTS;
}

/** Aceita o retorno cru de characters.list (array ou embrulhado). */
export function characterRows(raw: any): any[] {
  const list = Array.isArray(raw) ? raw : raw?.chars || raw?.characters || raw?.list || [];
  return Array.isArray(list) ? list.filter((c) => c && typeof c === 'object') : [];
}

/** Assinatura estável do estado das árvores (para detectar quando o tRPC assentou). */
export function treeSignature(rows: any[]): string {
  return rows
    .map((c) => String(c?.name || '') + ':' + String(c?.level ?? '') + ':' + JSON.stringify(parseTree(c?.state?.tree)))
    .sort()
    .join('|');
}

/**
 * Espera o tRPC parar de mudar (o save do personagem chega com atraso).
 * Duas leituras iguais com \`settleMs\` de intervalo = estado assentado.
 */
export async function waitForStableState(
  trpc: TrpcClient,
  opts: { settleMs?: number; settleMaxMs?: number; log?: (m: string) => void } = {},
): Promise<any[]> {
  const gap = Math.max(1000, opts.settleMs ?? 15_000);
  const maxMs = Math.max(gap, opts.settleMaxMs ?? 75_000);
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  let anterior = treeSignature(characterRows(await trpc.query('characters.list')));
  while (Date.now() - t0 < maxMs) {
    await sleep(gap);
    const agora = treeSignature(characterRows(await trpc.query('characters.list')));
    if (agora === anterior) {
      log(`[tree] estado do tRPC assentado após ${Math.round((Date.now() - t0) / 1000)}s`);
      break;
    }
    anterior = agora;
  }
  return characterRows(await trpc.query('characters.list'));
}

/**
 * Monta o alvo de cada personagem: lê level + state.tree, planeja os pontos
 * que faltam e devolve o que seria enviado.
 */
export function buildTreeTargets(raw: any, opts: TreeRunOptions = {}): TreeTarget[] {
  const slots = slotMap(opts.slots);
  const out: TreeTarget[] = [];
  for (const c of characterRows(raw)) {
    const name = String(c?.name || '').trim();
    const vocation = String(c?.vocation || '').trim().toLowerCase();
    const level = Math.max(1, Math.floor(Number(c?.level) || 1));
    const slot = slots[name];
    if (!name || slot === undefined) continue;
    if (!TALENT_TREES[vocation]) continue;
    const ranks = parseTree(c?.state?.tree);
    const plan = planAllocation(vocation, ranks, level, opts);
    const expected = { ...ranks };
    for (const id of plan) expected[id] = (expected[id] ?? 0) + 1;
    out.push({ slot, name, vocation, level, ranks, plan, expected });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

/** Espera o servidor confirmar (o save do personagem demora). */
async function confirmTargets(
  trpc: TrpcClient,
  targets: TreeTarget[],
  opts: TreeRunOptions,
): Promise<void> {
  const log = opts.log ?? (() => {});
  const maxMs = Math.max(5000, opts.verifyMs ?? 90_000);
  const t0 = Date.now();
  const ler = async (): Promise<any[]> => {
    try { return characterRows(await trpc.query('characters.list')); } catch { return []; }
  };
  let pendentes = targets.filter((t) => t.plan.length > 0);
  while (pendentes.length > 0 && Date.now() - t0 < maxMs) {
    await sleep(15_000);
    const lista = await ler();
    pendentes = pendentes.filter((t) => {
      const c = lista.find((x: any) => String(x?.name || '') === t.name);
      if (!c) return true;
      const agora = parseTree(c?.state?.tree);
      const faltam = Object.entries(t.expected).filter(([k, v]) => (agora[k] ?? 0) < v);
      if (faltam.length === 0) {
        log(`[tree] ${t.name}: servidor confirmou ${spentPoints(t.vocation, agora)}/${t.level} pts ✅ | ${describeTree(t.vocation, agora, t.level)}`);
        return false;
      }
      return true;
    });
  }
  for (const t of pendentes) {
    const rows = await ler();
    const c = rows.find((x: any) => String(x?.name || '') === t.name);
    const agora = parseTree(c?.state?.tree);
    log(
      `[tree] ${t.name}: ⚠️ não confirmei tudo em ${Math.round(maxMs / 1000)}s — ` +
      `servidor em ${spentPoints(t.vocation, agora)}/${t.level} pts (o save pode estar atrasado; o próximo boot completa)`,
    );
  }
}

/**
 * Lê o estado (esperando o tRPC assentar), envia os \`spend\` que faltam e tenta
 * confirmar. Devolve o alvo por personagem.
 */
export async function activateTalentTrees(
  trpc: TrpcClient,
  room: Room | null,
  opts: TreeRunOptions = {},
): Promise<TreeTarget[]> {
  const log = opts.log ?? (() => {});
  const paceMs = Math.max(0, opts.paceMs ?? 25);

  const raw = opts.dryRun ? await trpc.query('characters.list') : await waitForStableState(trpc, opts);
  const targets = buildTreeTargets(raw, opts);

  if (targets.length === 0) {
    log('[tree] nenhum personagem com slot conhecido/vocação mapeada — nada a fazer');
    return targets;
  }

  const total = targets.reduce((a, t) => a + t.plan.length, 0);
  for (const t of targets) {
    log(
      `[tree] ${t.name} (slot ${t.slot}, ${t.vocation} lvl ${t.level}): ` +
      `${spentPoints(t.vocation, t.ranks)} pts gastos | plano ${t.plan.length} ranks | ${describeTree(t.vocation, t.ranks, t.level)}`,
    );
  }

  if (opts.dryRun) {
    for (const t of targets) {
      const contagem = new Map<string, number>();
      for (const id of t.plan) contagem.set(id, (contagem.get(id) ?? 0) + 1);
      log(`[tree] DRY-RUN ${t.name}: ${[...contagem].map(([k, v]) => `${k} x${v}`).join(', ') || '(nada)'}`);
    }
    return targets;
  }

  if (total === 0) {
    log('[tree] árvore já está cheia para o nível em todos os personagens — nada a enviar');
    return targets;
  }

  if (!room || room.closed) {
    log('[tree] sem sala aberta — plano calculado, nada enviado');
    return targets;
  }

  let enviados = 0;
  for (const t of targets) {
    for (const nodeId of t.plan) {
      room.send('tree', { slot: t.slot, action: 'spend', nodeId });
      enviados++;
      if (paceMs > 0) await sleep(paceMs);
    }
    if (t.plan.length) {
      log(`[tree] ${t.name}: ${t.plan.length} envios (spend) — esperado ${Object.entries(t.expected).map(([k, v]) => `${k}:${v}`).join(' ') || '{}'}`);
    }
  }

  log(`[tree] total enviado: ${enviados} ranks — aguardando o save do servidor para conferir`);
  await confirmTargets(trpc, targets, opts);
  return targets;
}
