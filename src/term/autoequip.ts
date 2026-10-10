/**
 * Auto-equip do driver terminal (sem navegador).
 *
 * Fontes (100% tRPC, sem DOM e sem decoder de schema):
 *  - itens e catalogo : trpc.query('items.summary') -> { items[], catalog{} }
 *  - equipado atual   : trpc.query('characters.list') -> state.equipment
 * Pontuacao: formula de valor do jogo (gameItemValue: base * (1 + tier*0.5 + up*0.1)),
 * a mesma que o modo navegador aproxima em page_equip.js (scoreOf).
 * Envio: room.send('equip', { uid, to, slot, hash })  (payload de room_send.ts:119).
 */
import { gameItemValue } from '../game_formula';
import type { Room } from './colyseus';
import type { TrpcClient } from '../trpc';

export interface InventoryItem {
  name: string;
  tier?: number;
  ftier?: number;
  upLevel?: number;
  attrs?: any[];
  uid?: number;
  hash?: string;
  location?: string;
  charId?: number | null;
  qty?: number;
}

export interface CatalogEntry {
  id?: number; slot?: string; atk?: number; def?: number; arm?: number;
  range?: number; level?: number; vocs?: string[]; wt?: string;
  ammoType?: string; quiver?: boolean;
}

/** Itens que o modo navegador nunca equipa sozinho (page_equip.js:274). */
const NEVER_EQUIP = /spear|throwing|arrow|bolt|quiver|rune|potion|food|backpack|loot ?bag|^bag\b/i;

export function itemBase(cat: CatalogEntry | undefined): number {
  return Number(cat?.atk ?? cat?.def ?? cat?.arm ?? 0);
}

/** Valor do item pelas formulas do jogo + desempate por forja. */
export function itemScore(it: InventoryItem, cat: CatalogEntry | undefined): number {
  const base = itemBase(cat);
  const tier = Number(it.tier ?? 0);
  const up = Number(it.upLevel ?? 0);
  const ft = Number(it.ftier ?? 0);
  return gameItemValue(base, tier, up) + ft * 5;
}

export function allowed(cat: CatalogEntry | undefined, name: string, vocation: string, level: number): boolean {
  if (!cat?.slot) return false;
  if (NEVER_EQUIP.test(name)) return false;
  const vocs = Array.isArray(cat.vocs) ? cat.vocs.map((v) => String(v).toLowerCase()) : [];
  if (vocs.length > 0 && !vocs.includes(vocation.toLowerCase())) return false;
  if (Number(cat.level ?? 0) > level) return false;
  return true;
}

export interface EquipDecision {
  slot: string;
  from: string;
  to: string;
  fromScore: number;
  toScore: number;
  gain: number;
  name: string;
  hash?: string;
  uid?: number;
}

export interface PlanOptions {
  charId: number | string;
  vocation: string;
  level: number;
  /** ignora candidatos de raridade menor que isto (page_equip.js:323 usa 3) */
  minTier?: number;
  log?: (m: string) => void;
}

/** Decide (sem enviar nada) quais itens da mochila valem equipar. */
export function planEquips(
  inv: InventoryItem[],
  catalog: Record<string, CatalogEntry>,
  opts: PlanOptions,
): EquipDecision[] {
  const log = opts.log ?? (() => {});
  const charId = Number(opts.charId);
  const equipped = new Map<string, InventoryItem>();
  for (const it of inv) {
    if (String(it.location) !== 'equipped') continue;
    if (it.charId !== null && it.charId !== undefined && Number(it.charId) !== charId) continue;
    const slot = catalog[it.name]?.slot;
    if (slot) equipped.set(slot, it);
  }

  const best = new Map<string, { item: InventoryItem; cat: CatalogEntry; score: number }>();
  for (const it of inv) {
    if (String(it.location) === 'equipped') continue;
    const cat = catalog[it.name];
    if (!cat) { continue; }
    if (!allowed(cat, it.name, opts.vocation, opts.level)) {
      if (Number(it.tier ?? 0) > 0) log(`[equip] ignorado (regra/vocacao): ${it.name} t${it.tier} slot=${cat.slot}`);
      continue;
    }
    if (Number(it.tier ?? 0) < (opts.minTier ?? 0)) continue;
    const score = itemScore(it, cat);
    const cur = best.get(cat.slot!);
    if (!cur || score > cur.score) best.set(cat.slot!, { item: it, cat, score });
  }

  const out: EquipDecision[] = [];
  for (const [slot, cand] of best) {
    const eq = equipped.get(slot);
    const eqCat = eq ? catalog[eq.name] : undefined;
    const eqScore = eq ? itemScore(eq, eqCat) : -1;
    if (cand.score <= eqScore) continue;
    out.push({
      slot,
      from: eq ? `${eq.name} (tier ${eq.tier ?? 0}, valor ${eqScore.toFixed(0)})` : '(vazio)',
      to: `${cand.item.name} (tier ${cand.item.tier ?? 0}, valor ${cand.score.toFixed(0)})`,
      fromScore: eqScore,
      toScore: cand.score,
      gain: cand.score - eqScore,
      name: cand.item.name,
      hash: cand.item.hash,
      uid: cand.item.uid,
    });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/** Payload exato do protocolo (room_send.ts:119 / index.js @4491257). */
export function sendEquip(room: Room, d: EquipDecision, charSlot: number): boolean {
  return room.send('equip', { uid: d.uid ?? 0, to: d.slot, slot: charSlot, hash: d.hash });
}

export function sendUnequip(room: Room, fromSlot: string, charSlot: number): boolean {
  return room.send('unequip', { from: fromSlot, slot: charSlot });
}

export interface AutoEquipOptions extends PlanOptions {
  /** slot do personagem no jogo (0 = primeiro) */
  charSlot: number;
  /** true = so registra no log, nao envia */
  dryRun?: boolean;
  /** maximo de equips por passada */
  maxPerRun?: number;
  log?: (m: string) => void;
}

/** Le itens/catalogo por tRPC e devolve o plano. */
export async function planFromTrpc(trpc: TrpcClient, opts: AutoEquipOptions): Promise<EquipDecision[]> {
  const summary: any = await trpc.query('items.summary');
  const inv: InventoryItem[] = Array.isArray(summary?.items) ? summary.items : [];
  const catalog: Record<string, CatalogEntry> = summary?.catalog ?? {};
  return planEquips(inv, catalog, opts);
}

/** Executa o plano (ou so loga, com dryRun). */
export async function runAutoEquip(room: Room, trpc: TrpcClient, opts: AutoEquipOptions): Promise<EquipDecision[]> {
  const log = opts.log ?? (() => {});
  const plan = (await planFromTrpc(trpc, opts)).slice(0, opts.maxPerRun ?? 4);
  for (const d of plan) {
    if (opts.dryRun) {
      log(`[equip] DRY-RUN ${d.slot}: ${d.from} -> ${d.to}`);
      continue;
    }
    const ok = sendEquip(room, d, opts.charSlot);
    log(`[equip] ${ok ? 'enviado' : 'FALHOU'} ${d.slot}: ${d.from} -> ${d.to} (hash ${String(d.hash).slice(0, 10)}.., slot ${opts.charSlot})`);
  }
  if (plan.length === 0) log('[equip] nada a equipar');
  return plan;
}
