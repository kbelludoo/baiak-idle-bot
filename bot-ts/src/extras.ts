import type { Page } from 'puppeteer-core';
import type { BotConfig } from './types';
import { safeEval } from './scripts';
import { getJevEngine } from './jev';

const STAM_CLOCK = /(\d{1,2})\s*:\s*(\d{2})/;
const STAM_PCT = /(\d+)\s*%/;

/** Raridade mínima mantida na mochila: 3 = Epic, 4 = Legendary, 5 = Mythical. */
export const KEEP_TIER_MIN = 3;

export function parseStaminaMinutes(text: string | number | null | undefined): number | null {
  if (text === undefined || text === null) return null;
  if (typeof text === 'number') {
    if (!Number.isFinite(text)) return null;
    if (text <= 1.05 && text > 0) return Math.floor(text * 2520);
    if (text > 1 && text <= 2520) return text === 2520 ? null : Math.floor(text);
    return null;
  }
  const raw = String(text).trim();
  if (!raw) return null;
  if (['—', '–', '-', 'desconhecido', 'undefined'].includes(raw.toLowerCase())) return null;
  const pct = STAM_PCT.exec(raw);
  if (pct) return Math.floor((parseInt(pct[1], 10) / 100) * 2520);
  const clock = STAM_CLOCK.exec(raw);
  if (clock) {
    const h = parseInt(clock[1], 10), mi = parseInt(clock[2], 10);
    if (h <= 42 && mi <= 59 && !(h === 42 && mi === 0)) return h * 60 + mi;
  }
  const mH = raw.match(/(\d{1,2})\s*h/i);
  const mM = raw.match(/(\d{1,3})\s*m/i);
  if (mH || mM) {
    const h = mH ? parseInt(mH[1], 10) : 0;
    const mi = mM ? parseInt(mM[1], 10) : 0;
    if (h === 42 && mi === 0) return null;
    if (h <= 42 && mi <= 59) return h * 60 + mi;
  }
  if (['0', '0:00', '00:00', 'empty', 'vazia'].includes(raw.toLowerCase())) return 0;
  const mMin = raw.match(/^(\d{2,4})\s*(?:min)?$/i);
  if (mMin) {
    const mins = parseInt(mMin[1], 10);
    if (mins === 2520) return null;
    if (mins >= 0 && mins <= 2520) return mins;
  }
  return null;
}

export function staminaIsEmpty(text: string | null | undefined, thresholdPct: number = 15): boolean {
  if (!text) return false;
  const raw = String(text).trim().toLowerCase();
  if (['—', '–', '-', 'desconhecido', 'undefined'].includes(raw)) return false;
  if (['0:00', '00:00', '0%', '0', 'vazia', 'empty'].includes(raw)) {
    return true;
  }
  const mPct = STAM_PCT.exec(raw);
  if (mPct) {
    return parseInt(mPct[1], 10) <= thresholdPct;
  }
  const mins = parseStaminaMinutes(text);
  if (mins === null) return false;
  // Max stamina: 42h = 2520 min. 15% = 378 min (~06:18)
  const threshMins = Math.floor(2520 * (thresholdPct / 100.0));
  return mins <= threshMins;
}

export function staminaHasRecovered(text: string | null | undefined, recoveryPct: number = 85): boolean {
  if (!text) return false;
  const mPct = STAM_PCT.exec(String(text));
  if (mPct) {
    return parseInt(mPct[1], 10) >= recoveryPct;
  }
  const mins = parseStaminaMinutes(text);
  if (mins === null) return false;
  const threshMins = Math.floor(2520 * (recoveryPct / 100.0));
  return mins >= threshMins;
}

export function looksLikeTreino(wave: string | null | undefined): boolean {
  return /treino\s*online|online\s*training/i.test(wave || '');
}

const UNSAFE_CONFIRM = /comprar|buy\b|lance|bid\b|leil[aã]o|auction|loja\b|store\b|\bpix\b|\bvip\b|assinar|premium|doar|donate|transferir coins/i;
const SAFE_CONFIRM = /vender|sell|entregar|equipar|coletar|claim|abrir|promover|recrutar/i;
const JUNK_EQUIP = /potion|rune|gold coin|platinum|crystal coin|bag|backpack|ammo|bolt|arrow|spear|throwing/i;

export function shouldEnterTreino(autoTreino: boolean, empty: boolean): boolean {
  return !!(autoTreino && empty);
}

export function shouldResumeHunts(autoTreino: boolean, recovered: boolean, inTreino: boolean): boolean {
  if (!inTreino) return true;
  if (!autoTreino) return true;
  return !!recovered;
}

export function shouldAutoSell(cur: number, cap: number, thresholdPct: number, autoSell: boolean): boolean {
  if (!autoSell || cap <= 0) return false;
  return (cur / cap) * 100 >= thresholdPct;
}

export function confirmIsUnsafe(body?: string | null): boolean {
  return UNSAFE_CONFIRM.test(body || '');
}

export function confirmIsSafeAction(body?: string | null): boolean {
  const text = body || '';
  if (confirmIsUnsafe(text)) return false;
  return !!(SAFE_CONFIRM.test(text) || !text.trim());
}

export function shouldTransferLoot(tier?: number | null, name?: string | null): boolean {
  const label = name || '';
  if (/gold coin|platinum|crystal coin/i.test(label)) return false;
  if (tier === undefined || tier === null) return /epic|legendary|mythical|mythic|épico|epico|lend[aá]rio/i.test(label);
  return Number(tier) >= KEEP_TIER_MIN;
}

export function shouldKeepLoot(tier?: number | null, name?: string | null): boolean {
  return shouldTransferLoot(tier, name);
}

export function isTrashLoot(tier?: number | null, name?: string | null): boolean {
  const label = String(name || '');
  if (/gold coin|platinum|crystal coin/i.test(label)) return false;
  if (tier !== undefined && tier !== null && Number.isFinite(Number(tier))) {
    return Number(tier) < KEEP_TIER_MIN;
  }
  // Sem tier legível: só é lixo se claramente comum/incomum/raro sem sinal de épico
  if (/epic|legendary|mythical|mythic|épico|epico|lend[aá]rio|m[ií]tico/i.test(label)) return false;
  return true;
}

/** Pressão da mochila: true quando deve varrer lixo antes de encher (default 50%). */
export function shouldSweepBag(cur: number, cap: number, thresholdPct = 50): boolean {
  if (cap <= 0) return false;
  return (cur / cap) * 100 >= thresholdPct;
}

export function shouldSkipEquipItem(name?: string | null, equipEnabled = true): boolean {
  if (!equipEnabled) return true;
  return JUNK_EQUIP.test(name || '');
}

export function skipMarketBuy(): boolean {
  return true;
}

function tagLog(key: string, res: any): string[] {
  const labels: Record<string, string> = {
    bags: 'GLOOTH',
    boss: 'BOSS',
    equip: 'EQUIP',
    prey: 'PREY',
    treino: 'TREINO',
    vfx: 'VFX',
    chest: 'CHEST',
    codex: 'CODEX',
    tree: 'TREE',
    charms: 'CHARMS',
    bp: 'PASSE',
    guild: 'GUILD',
    merchant: 'MERCADOR',
    boosts: 'BOOSTS',
  market: 'MARKET',
    arena: 'ARENA',
    event: 'EVENTO',
    cyclopedia: 'BESTIARIO',
    house: 'HOUSE',
    auction: 'AUCTION',
    forge: 'FORJA',
    imbue: 'IMBUE',
    supply: 'SUPPLY',
    loopcfg: 'LOOPCFG',
    manageloot: 'LOOT',
    lootfilter: 'LOOTFILTER',
    modals: 'MODAL',
  };
  const label = labels[key] || key.toUpperCase();
  const out: string[] = [];
  if (!res) return out;
  if (typeof res === 'object') {
    if (Array.isArray(res.events) && res.events.length > 0) {
      for (const ev of res.events) out.push(`[${label}] ${ev}`);
    } else if (res.ok || res.action) {
      out.push(`[${label}] ${res.action || res.detail || JSON.stringify(res)}`);
    } else if (res.skip) {
      out.push(`[${label}] skip: ${res.skip}`);
    }
  } else {
    out.push(`[${label}] ${res}`);
  }
  return out;
}

export interface ExtrasScheduler {
  tick(page: Page, config: BotConfig, now: number, inTreino: boolean, jev?: any, telemetryGold?: number, coinsAvailable?: number): Promise<string[]>;
}

export class DefaultExtrasScheduler implements ExtrasScheduler {
  private lastTimes: Record<string, number> = {};

  private due(key: string, now: number, cdSeconds: number): boolean {
    const last = this.lastTimes[key] || 0;
    return (now - last) >= cdSeconds * 1000;
  }

  private async run(
    page: Page,
    key: string,
    now: number,
    cdSeconds: number,
    scriptName: string,
    arg: any,
    enabled: boolean
  ): Promise<{ ran: boolean; logs: string[] }> {
    if (!enabled || !this.due(key, now, cdSeconds)) {
      return { ran: false, logs: [] };
    }
    this.lastTimes[key] = now;
    const res = await safeEval(page, scriptName, arg, 12000);
    return { ran: true, logs: tagLog(key, res) };
  }

  public async tick(
    page: Page,
    config: BotConfig,
    now: number,
    inTreino: boolean,
    jev?: any,
    telemetryGold?: number,
    coinsAvailable?: number
  ): Promise<string[]> {
    const logs: string[] = [];
    let busy = false;

    // VFX
    if (config.reduceVfx) {
      const v = await this.run(page, 'vfx', now, 45, 'extra', { job: 'vfx' }, true);
      logs.push(...v.logs);
    }

    // Glooth Bags / Pouch
    if (config.autoBags) {
      const b = await this.run(page, 'bags', now, 18, 'bags', null, true);
      if (b.ran) {
        busy = true;
        logs.push(...b.logs);
      }
    }

    // Auto Equip (a cada 90s no ciclo de extras; no loop rápido é checado a cada 30s)
    if (!busy && config.autoEquip) {
      const eq = await this.run(page, 'equip', now, 90, 'equip', null, true);
      if (eq.ran) {
        busy = true;
        logs.push(...eq.logs);
      }
    }

    // Lootfilter anti-encher: vende lixo < épico a cada 75s (guarda só épico/lendário/mítico)
    if (!busy && config.autoSell && !inTreino) {
      const lf = await this.run(page, 'lootfilter', now, 75, 'extra', { job: 'lootfilter' }, true);
      if (lf.ran) {
        busy = true;
        logs.push(...lf.logs);
      }
    }

    // Boss diário
    if (!busy && config.autoBoss && !inTreino) {
      const bo = await this.run(page, 'boss', now, 90, 'boss', null, true);
      if (bo.ran) {
        busy = true;
        logs.push(...bo.logs);
      }
    }

    // Preys
    if (!busy && config.autoPrey) {
      const pr = await this.run(page, 'prey', now, 180, 'prey', null, true);
      if (pr.ran) {
        busy = true;
        logs.push(...pr.logs);
      }
    }

    // Subtarefas extras (executa no máximo uma por ciclo para não sobrecarregar)
    const extraJobs: Array<[string, number, any]> = [
      ['chest', 15, { job: 'chest' }],
      ['codex', 55, { job: 'codex' }],
      ['event', 120, { job: 'event' }],
      ['arena', 150, { job: 'arena' }],
      ['tree', 180, { job: 'tree' }],
      ['charms', 240, { job: 'charms' }],
      ['cyclopedia', 240, { job: 'cyclopedia' }],
      ['bp', 180, { job: 'battlepass' }],
      ['guild', 180, { job: 'guild' }],
      ['merchant', 240, { job: 'merchant' }],
      ['boosts', 180, { job: 'boosts' }],
      ['market', 200, { job: 'market' }],
      ['auction', 60, {
        job: 'auction',
        enabled: config.auctionEnabled,
        live: config.auctionLive,
        budget: config.auctionBudget,
        minMarginPct: config.auctionMinMarginPct,
        maxItems: config.auctionMaxItems,
        maxMinutesRemaining: config.auctionSniperMaxMinutes,
        sellGoldAmount: config.auctionSellGoldAmount,
        sellEnabled: config.auctionSellEnabled,
        currentGold: telemetryGold ?? 0,
        coinsAvailable: coinsAvailable ?? config.auctionBudget,
        useJev: config.jevEnabled,
      }],
      ['supply', 300, { job: 'supply' }],
      ['loopcfg', 600, { job: 'loopcfg' }],
      ['manageloot', 600, { job: 'manageloot' }],
      ['forge', 300, { job: 'forge' }],
      ['imbue', 300, { job: 'imbue' }],
      ['house', 600, { job: 'house' }],
      ['modals', 40, { job: 'close_modals' }],
    ];

    if (!busy) {
      for (const [key, cd, arg] of extraJobs) {
        const res = await this.run(page, key, now, cd, 'extra', arg, config.autoExtras);
        if (res.ran) {
          logs.push(...res.logs);
          break;
        }
      }
    }

    if (this.due('offline', now, 600)) this.lastTimes['offline'] = now;

    return logs;
  }
}
