import type { Page } from 'puppeteer-core';

/**
 * Envio direto à sala Colyseus via `window.__baiak_send` (kernel hook).
 * Um `room.send("stage",{huntId})` vira 1 pacote ROOM_DATA — sem DOM, sem
 * 40x scroll+click. Retorna {sent} = nº de sockets que aceitaram o frame.
 * `sent===0` => hook ainda sem socket capturado (fallback para DOM).
 */

export interface RoomSendResult {
  sent: number;
  bytes?: number;
  error?: string;
}

async function evalSend(page: Page | null, type: string, payload: any): Promise<RoomSendResult | null> {
  if (!page) return null;
  try {
    return await page.evaluate(
      (t: string, p: any) => {
        const w = window as any;
        const fn = w.__baiak_send || (w.__room && w.__room.send);
        if (typeof fn !== 'function') return null;
        try {
          return fn(t, p) || { sent: 0 };
        } catch (err: any) {
          return { sent: 0, error: String(err?.message || err) };
        }
      },
      type,
      payload === undefined ? {} : payload,
    ).catch(() => null) as RoomSendResult | null;
  } catch {
    return null;
  }
}

/** Envia e retorna true quando ao menos 1 socket aceitou. */
export async function roomSend(page: Page | null, type: string, payload?: any): Promise<boolean> {
  const res = await evalSend(page, type, payload);
  return !!res && res.sent > 0;
}

/** Envia com detalhe (para log). */
export async function roomSendDetail(page: Page | null, type: string, payload?: any): Promise<RoomSendResult | null> {
  return evalSend(page, type, payload);
}

/** Snapshot do espelho de estado do kernel (`window.__baiak_state`). */
export async function roomState(page: Page | null): Promise<any | null> {
  if (!page) return null;
  try {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__baiak_state ? JSON.parse(JSON.stringify(w.__baiak_state)) : null;
    }).catch(() => null);
  } catch {
    return null;
  }
}

/** Drena eventos ROOM_DATA capturados no page (IN/OUT). Máx 300. */
export async function roomDrainEvents(page: Page | null): Promise<Array<{ t: number; dir: string; type: string; payload: any }>> {
  if (!page) return [];
  try {
    const out = await page.evaluate(() => {
      const w = window as any;
      if (typeof w.__baiak_drain === 'function') {
        try { return w.__baiak_drain() || []; } catch { return []; }
      }
      const ev = Array.isArray(w.__baiak_events) ? w.__baiak_events.splice(0, w.__baiak_events.length) : [];
      return ev.slice(-300);
    }).catch(() => []);
    return Array.isArray(out) ? out : [];
  } catch {
    return [];
  }
}

// --- Atalhos tipados para os sends críticos (nomes idênticos ao bundle) ---

export const sendStage = (page: Page | null, huntId: string) => roomSend(page, 'stage', { huntId });
export const sendHelper = (page: Page | null, slot: number, cfg: any) => roomSend(page, 'helper', { slot, cfg });
export const sendRotation = (page: Page | null, slot: number, spells: any) => roomSend(page, 'rotation', { slot, spells });
export const sendSpellMinMobs = (page: Page | null, slot: number, words: string, minMobs: number) =>
  roomSend(page, 'spellminmobs', { slot, words, minMobs });
export const sendPotion = (page: Page | null, slot: number, kind: string, name: string, below: number) =>
  roomSend(page, 'potion', { slot, kind, name, below });
export const sendEquip = (page: Page | null, uid: string, to: string, slot: number, hash?: string) =>
  roomSend(page, 'equip', { uid, to, slot, hash });
export const sendUnequip = (page: Page | null, from: string, slot: number) =>
  roomSend(page, 'unequip', { from, slot });
export const sendLoop = (page: Page | null, on: boolean) => roomSend(page, 'loop', on);
export const sendAutosellFull = (page: Page | null, on: boolean) => roomSend(page, 'autosellfull', { on });
export const sendAutosellPct = (page: Page | null, pct: number) => roomSend(page, 'autosellpct', { pct });
export const sendSellReward = (page: Page | null) => roomSend(page, 'sellreward', {});
export const sendRewardCollectAll = (page: Page | null) => roomSend(page, 'reward', { action: 'collectall' });
export const sendSellAll = (page: Page | null, prot: any) => roomSend(page, 'sellall', { protected: prot });
export const sendBoss = (page: Page | null, bossId: string, fromCity: boolean) =>
  roomSend(page, 'boss', { bossId, fromCity });
/** Inicia/interrompe a playlist Auto Boss oficial do jogo. */
export const sendAutoBoss = (page: Page | null, action: 'start' | 'stop' | 'sync') =>
  roomSendDetail(page, 'autoboss', { action });
/** Atualiza a playlist/preset do Auto Boss oficial. */
export const sendAutoBossList = (page: Page | null, ids: string[], preset = 0) =>
  roomSendDetail(page, 'autobosslist', { ids, preset });
export const sendArenaQueue = (page: Page | null) => roomSend(page, 'arenaQueue', {});
export const sendToCity = (page: Page | null) => roomSend(page, 'tocity', {});
export const sendReady = (page: Page | null) => roomSend(page, 'ready', {});
export const sendPrey = (page: Page | null, slot: number, action: string, monsterKey?: string) =>
  roomSend(page, 'prey', { slot, action, monsterKey });
export const sendTree = (page: Page | null, slot: number, action: string, nodeId?: string, code?: string) =>
  roomSend(page, 'tree', { slot, action, nodeId, code });
export const sendPromote = (page: Page | null, slot: number) => roomSend(page, 'promote', { slot });
export const sendUsePotion = (page: Page | null, name: string, from: string, count?: number) =>
  roomSend(page, 'usepotion', { name, from, count });
export const sendCodexDeliver = (page: Page | null, id: string) =>
  roomSend(page, 'codexdeliver', { id });
export const sendCodexAuto = (page: Page | null, cfg: any) =>
  roomSend(page, 'codexauto', cfg);
export const sendCodexUnlock = (page: Page | null, id: string) =>
  roomSend(page, 'codexunlock', { id });
