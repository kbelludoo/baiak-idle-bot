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
  public lastAuctionStatus: any = {
    checkedAt: null,
    currentGold: 0,
    coinsAvailable: 0,
    reservedCoins: 0,
    activeBids: 0,
    hasOwnActiveGold: false,
    listings: 0,
  };
  // Cache do token Turnstile resolvido pelo widget persistente na página
  private cachedTurnstileToken = '';
  private cachedTurnstileTs = 0;
  private turnstileWidgetReady = false;
  private readonly TURNSTILE_TTL_MS = 4 * 60 * 1000; // tokens Cloudflare duram ~5min

  private unwrapTrpc(raw: any): any {
    const item = Array.isArray(raw) ? raw[0] : raw;
    let data = item?.result?.data ?? item?.data ?? item;
    // tRPC com transformer pode encapsular o payload mais uma vez em `json`.
    if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'json')) {
      data = data.json;
    }
    return data;
  }

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

    // Não inicialize um widget invisível em segundo plano: nesta conta o
    // servidor só aceita a prova emitida pelo widget visível do fluxo de
    // publicação. O page_extra renderiza esse widget sob demanda e aguarda o
    // token antes de repetir a mutação.

    // Leilão gerenciado via JEV (sem usar outra IA):\n    // 1. Escaneia dados do mercado via tRPC rápido (nativo Bun com fallback seguro)
    // 2. Consulta o motor JEV para venda (decideGoldSellListing) e/ou compra (decideGoldAuction)
    // 3. Executa a ação diretamente via fetch Node.js
    if (config.auctionEnabled && this.due('auction', now, 60)) {
      this.lastTimes['auction'] = now;
      try {
        let scanRes: any = null;
        try {
          const authHeaders: Record<string, string> = { "User-Agent": "Mozilla/5.0" };
            if (config.token) authHeaders["authorization"] = `Bearer ${config.token}`;

            const [browseRes, historyRes, mineRes, coinsRes, myBidsRes] = await Promise.all([
            fetch("https://baiakidle.com/api/trpc/auction.browse?batch=1&input=%7B%220%22%3A%7B%22page%22%3A1%2C%22perPage%22%3A50%2C%22type%22%3A%22gold%22%7D%7D", {
              headers: authHeaders,
              signal: AbortSignal.timeout(6000),
            }).then(r => r.json()).catch(() => null),
            fetch("https://baiakidle.com/api/trpc/auction.history?batch=1&input=%7B%220%22%3A%7B%22page%22%3A1%2C%22perPage%22%3A25%2C%22type%22%3A%22gold%22%7D%7D", {
              headers: authHeaders,
              signal: AbortSignal.timeout(6000),
            }).then(r => r.json()).catch(() => null),
            fetch("https://baiakidle.com/api/trpc/auction.mine?batch=1&input=%7B%7D", {
              headers: authHeaders,
              signal: AbortSignal.timeout(6000),
            }).then(r => r.json()).catch(() => null),
            fetch("https://baiakidle.com/api/trpc/coin.balances?batch=1&input=%7B%7D", {
              headers: authHeaders,
              signal: AbortSignal.timeout(6000),
            }).then(r => r.json()).catch(() => null),
            fetch("https://baiakidle.com/api/trpc/auction.myBids?batch=1&input=%7B%7D", {
              headers: authHeaders,
              // Essa consulta pode responder um pouco depois do browse; sem
              // a folga, o bot perde as reservas e repete o mesmo lance.
              signal: AbortSignal.timeout(12000),
            }).then(r => r.json()).catch(() => null),
          ]);

           const browseData = this.unwrapTrpc(browseRes);
           const browseRows = Array.isArray(browseData?.rows) ? browseData.rows : [];

           const mineData = this.unwrapTrpc(mineRes);
           const mineRows = Array.isArray(mineData?.rows) ? mineData.rows : (Array.isArray(mineData) ? mineData : (mineData?.items || []));

           const coinsData = this.unwrapTrpc(coinsRes);
            const marketCoins = Math.max(0, Number(coinsData?.marketCoins ?? coinsData?.market_coins) || 0);
            const walletCoins = Math.max(0, Number(coinsData?.coins ?? coinsData?.walletCoins) || 0);
            const hasApiBalance = Boolean(coinsData && typeof coinsData === 'object' &&
              ('coins' in coinsData || 'walletCoins' in coinsData || 'marketCoins' in coinsData || 'market_coins' in coinsData));
             // O lance aceita as duas carteiras. O saldo livre é o total menos
             // as reservas já feitas, mantendo a moeda da reserva separada.
             const arbitrageCoins = marketCoins + walletCoins;
           const bidsData = this.unwrapTrpc(myBidsRes);
            const bidRows = Array.isArray(bidsData) ? bidsData : (bidsData?.rows || bidsData?.items || []);
            const activeBidRows = bidRows.filter((r: any) =>
              (r.status === 'active' || r.status === 'open' || r.status === 'pending') &&
              (r.myBidStatus === undefined || r.myBidStatus === 'active' || r.myBidStatus === 'leading')
            );
            const activeBids = activeBidRows.length;
             const activeBidListingIds = new Set(activeBidRows.map((r: any) =>
               String(r.listingId ?? r.auctionId ?? r.id ?? '')
             ).filter(Boolean));
             const reservedByCurrency = activeBidRows.reduce((acc: { market: number; normal: number }, r: any) => {
               const currency = r.myCurrency === 'normal' ? 'normal' : 'market';
               const amount = Number(r.maxAmount ?? r.myMaxAmount ?? r.currentPrice ?? r.bidAmount ?? r.amount ?? r.priceCoins ?? 0);
               if (Number.isFinite(amount) && amount > 0) acc[currency] += amount;
               return acc;
             }, { market: 0, normal: 0 });
             const freeMarketCoins = Math.max(0, marketCoins - reservedByCurrency.market);
             const freeNormalCoins = Math.max(0, walletCoins - reservedByCurrency.normal);
             const freeCoins = freeMarketCoins + freeNormalCoins;
            const reservedCoins = activeBidRows.reduce((sum: number, r: any) => {
              const amount = Number(r.maxAmount ?? r.myMaxAmount ?? r.currentPrice ?? r.bidAmount ?? r.amount ?? r.priceCoins ?? 0);
              return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
            }, 0);

          if (browseRows.length > 0) {
            const nowTs = Date.now();
            const listings = browseRows
              .filter((r: any) => r.type === "gold" && Number(r.goldAmount) > 0 && Number(r.currentPrice) > 0 && !r.isOwn && !r.isLeading && !activeBidListingIds.has(String(r.id)))
              .map((r: any) => ({
                id: String(r.id),
                goldAmount: Number(r.goldAmount),
                priceCoins: Number(r.currentPrice),
                nextPriceCoins: Number(r.currentPrice) + (Number(r.bidCount) > 0 ? Math.max(1, Math.ceil(Number(r.currentPrice) * 0.10)) : 0),
                bids: Number(r.bidCount) || 0,
                minutesRemaining: Number.isFinite(Number(r.endsAt)) ? Math.max(0, Math.round((Number(r.endsAt) - nowTs) / 60000)) : null,
              }));

             const histData = this.unwrapTrpc(historyRes);
            const histRows = Array.isArray(histData?.rows) ? histData.rows : [];
            const historyRates = histRows
              .filter((r: any) => r.type === "gold" && Number(r.goldAmount) > 0 && Number(r.currentPrice) > 0)
              .map((r: any) => Number(r.goldAmount) / Number(r.currentPrice));

            const listingRates = listings.map((item: any) => item.goldAmount / item.priceCoins);
            const referenceRates = historyRates.length >= 2 ? historyRates : (listingRates.length >= 3 ? listingRates : []);
             const sortedRates = referenceRates.slice().sort((a: number, b: number) => a - b);
             const referenceRate = sortedRates.length
               ? sortedRates[Math.floor(sortedRates.length / 2)]
               : 5500000;
             const marketMinRate = sortedRates.length ? sortedRates[0] : referenceRate;
             const marketMaxRate = sortedRates.length ? sortedRates[sortedRates.length - 1] : referenceRate;

            const hasOwnActiveGold = (
              browseRows.some((r: any) =>
                (r.type === "gold" || /\bgold\b|ouro|kk\b/i.test(r.name || "")) &&
                (r.isOwn === true || r.isOwner === true) &&
                (r.status === "active" || Number(r.endsAt) > Date.now())
              ) ||
              mineRows.some((r: any) =>
                (r.type === "gold" || /\bgold\b|ouro|kk\b/i.test(r.name || "")) &&
                (r.status === "active" || Number(r.endsAt) > Date.now())
              )
            );

            const currentGold = Number(telemetryGold || 0);
            const feeGold = 5000000;
             const minGoldAmount = 100000000;
            const maxToSell = Math.max(0, Number(config.auctionSellGoldAmount) || 800000000);
            const goldToSell = Math.min(maxToSell, Math.max(0, Math.floor(currentGold - feeGold)));

            let historyMedianRate = referenceRate;
            const historyRatesSorted = historyRates.length
              ? historyRates.slice().filter((r: number) => r > 0).sort((a: number, b: number) => a - b) : [];
            if (historyRatesSorted.length >= 2) {
              // Mediana do histórico de vendas entregues (DADOS REAIS de negócio
              // fechado), não dos anúncios ativos que podem estar encalhados.
              historyMedianRate = historyRatesSorted[Math.floor(historyRatesSorted.length / 2)];
            }

           scanRes = {
              ok: true,
              listings,
              historyRates,
              listingRates,
               referenceRate,
               marketMinRate,
               marketMaxRate,
              historyMedianRate,
               coinsAvailable: hasApiBalance ? freeCoins : Math.max(0, Number(coinsAvailable) || 0),
               activeBids,
               reservedCoins,
               walletCoins,
               marketCoins,
               freeMarketCoins,
               freeNormalCoins,
               reservedByCurrency,
              hasOwnActiveGold,
              currentGold,
              feeGold,
              minGoldAmount,
               goldToSell,
             };
             this.lastAuctionStatus = {
               checkedAt: new Date().toISOString(),
               currentGold,
               coinsAvailable: freeCoins,
               reservedCoins,
               activeBids,
               walletCoins,
               marketCoins,
               hasOwnActiveGold,
               listings: listings.length,
               referenceRate,
               historyMedianRate,
               marketMinRate,
               marketMaxRate,
               goldToSell,
               sellStatus: hasOwnActiveGold
                 ? 'Anúncio de Gold ativo no mercado'
                 : (currentGold >= 105000000 ? 'Aguardando próxima janela de venda' : 'Acumulando saldo mín (105kk)'),
             };
           }
         } catch (_) {}

         // Um mercado sem anúncios também é uma resposta válida. Preserve o
         // saldo de coins e os lances consultados, em vez de deixar o painel
         // aparentar que o leilão nunca foi verificado.
         if (!scanRes) {
           this.lastAuctionStatus = {
             checkedAt: new Date().toISOString(),
             currentGold: Number(telemetryGold) || 0,
             coinsAvailable: Math.max(0, Number(coinsAvailable) || 0),
             reservedCoins: 0,
             activeBids: 0,
             hasOwnActiveGold: false,
             listings: 0,
           };
         }

        if (!scanRes || !scanRes.ok) {
          scanRes = await safeEval<any>(page, 'extra', {
            job: 'auction_scan',
            sellGoldAmount: config.auctionSellGoldAmount,
            currentGold: telemetryGold,
            coinsAvailable: coinsAvailable ?? 0,
          }, 15000);
        }

        if (!scanRes || !scanRes.ok) {
          this.lastTimes['auction'] = now - 45000; // Tenta novamente em 15s se o scan falhou
          logs.push(`[AUCTION] Scan de leilão falhou: ${scanRes?.error || (scanRes === null ? 'safeEval nulo/ocupado' : 'retornou falso')}`);
        } else {
          if (!this.lastAuctionStatus.checkedAt) {
            this.lastAuctionStatus = {
              checkedAt: new Date().toISOString(),
              currentGold: Number(scanRes.currentGold) || Number(telemetryGold) || 0,
              coinsAvailable: Number(scanRes.coinsAvailable) || Number(coinsAvailable) || 0,
              reservedCoins: Number(scanRes.reservedCoins) || 0,
              activeBids: Number(scanRes.activeBids) || 0,
              walletCoins: Number(scanRes.walletCoins) || 0,
              marketCoins: Number(scanRes.marketCoins) || 0,
              hasOwnActiveGold: Boolean(scanRes.hasOwnActiveGold),
              listings: Array.isArray(scanRes.listings) ? scanRes.listings.length : 0,
              referenceRate: Number(scanRes.referenceRate) || 0,
              historyMedianRate: Number(scanRes.historyMedianRate) || 0,
              marketMinRate: Number(scanRes.marketMinRate) || 0,
              marketMaxRate: Number(scanRes.marketMaxRate) || 0,
              goldToSell: Number(scanRes.goldToSell) || 0,
              sellStatus: scanRes.hasOwnActiveGold
                ? 'Anúncio de Gold ativo no mercado'
                : ((scanRes.currentGold || 0) >= 105000000 ? 'Aguardando próxima janela de venda' : 'Acumulando saldo mín (105kk)'),
            };
          }
           logs.push(`[AUCTION] Mercado: saldo=${Math.floor((scanRes.currentGold || 0) / 1e6)}kk | alvo=${Math.floor((scanRes.goldToSell || 0) / 1e6)}kk | faixa=${Math.round((scanRes.marketMinRate || 0) / 1e6)}-${Math.round((scanRes.marketMaxRate || 0) / 1e6)}kk/c | mediana=${Math.round((scanRes.referenceRate || 0) / 1e6)}kk/c | coins=${scanRes.coinsAvailable || 0}${scanRes.reservedCoins ? ` (reservados=${scanRes.reservedCoins})` : ''} | anuncio_ativo=${scanRes.hasOwnActiveGold}`);
          let sellDecision: any = null;
          let buyDecision: any = null;

          // Venda de Gold: JEV calcula preço ideal em coins para maximizar lucro
          const canSell = config.auctionSellEnabled && !scanRes.hasOwnActiveGold && scanRes.goldToSell >= scanRes.minGoldAmount;
          if (canSell) {
            if (jev && config.jevEnabled) {
              const rates = (scanRes.historyRates && scanRes.historyRates.length) ? scanRes.historyRates : (scanRes.listingRates || []);
              sellDecision = await jev.decideGoldSellListing({
                goldToSell: scanRes.goldToSell,
                currentMarketRates: rates,
                durationHours: 6,
              });
              logs.push(`[JEV-AUCTION] Decisão venda: shouldList=${sellDecision.shouldList}, ${Math.floor(scanRes.goldToSell / 1e6)}kk por ${sellDecision.targetPriceCoins} coins (${sellDecision.reason})`);
            } else {
              // Heurística de mercado real: mediana do histórico de vendas
              // entregues (gold/coin). Preço no meio-alto do que já foi pago:
              // acima dos lotes baratos encalhados, abaixo do teto lento.
              const ref = scanRes.historyMedianRate || scanRes.referenceRate || 5_500_000;
              const targetCoins = Math.max(25, Math.round(scanRes.goldToSell / ref));
              sellDecision = {
                shouldList: true,
                targetPriceCoins: targetCoins,
                reason: `Heurística mercado real: ${Math.floor(scanRes.goldToSell / 1e6)}kk por ${targetCoins} coins (mediana histórica ${Math.round(ref / 1e6)}kk/c)`,
                source: 'fallback',
              };
              logs.push(`[AUCTION] Venda heurística: targetPriceCoins=${targetCoins} (ref=${Math.round(ref / 1e6)}kk/c)`);
            }
          } else if (scanRes.hasOwnActiveGold) {
            logs.push('[AUCTION] Anúncio próprio de gold já ativo no leilão');
          } else if (scanRes.currentGold > 0 && scanRes.goldToSell < scanRes.minGoldAmount) {
            logs.push(`[AUCTION] Saldo insuficiente para venda (${Math.floor(scanRes.goldToSell / 1e6)}kk < mínimo ${Math.floor(scanRes.minGoldAmount / 1e6)}kk)`);
          }

          // Compra / Sniper de Gold: JEV avalia lotes encerrando
          // Um lance ativo reserva apenas a sua própria quantia. Continue
          // arbitrando com o saldo livre restante, sem bloquear o mercado
          // inteiro enquanto um lance aguarda liquidação.
          // Venda e compra usam saldos independentes: uma decisão de venda
          // não pode bloquear um lote de compra comprovadamente lucrativo.
          // Assim o gold pode ser anunciado enquanto coins livres aproveitam
          // arbitragem, sem deixar uma das duas reservas parada.
          if (config.auctionLive && scanRes.listings && scanRes.listings.length > 0 && scanRes.coinsAvailable > 0) {
            if (jev && config.jevEnabled) {
              buyDecision = await jev.decideGoldAuction({
                coinsAvailable: scanRes.coinsAvailable,
                budget: config.auctionBudget,
                minMarginPct: config.auctionMinMarginPct,
                maxMinutesRemaining: config.auctionSniperMaxMinutes,
                referenceRate: scanRes.historyMedianRate || scanRes.referenceRate,
                preferredCurrency: 'market',
                listings: scanRes.listings,
              });
              const bidAmount = Number(buyDecision?.targetMaxPrice || 0);
              if (bidAmount > 0) {
                if (bidAmount <= Number(scanRes.freeMarketCoins ?? scanRes.coinsAvailable ?? 0)) buyDecision.currency = 'market';
                else if (bidAmount <= Number(scanRes.freeNormalCoins ?? 0)) buyDecision.currency = 'normal';
                else buyDecision.selectedListingId = null;
              }
              if (buyDecision?.selectedListingId) {
                logs.push(`[JEV-AUCTION] Decisão sniper: arrematar lote #${buyDecision.selectedListingId} (${buyDecision.reason})`);
              }
              if (buyDecision?.source === 'fallback') {
                logs.push(`[JEV-AUCTION] JEV API indisponível (${buyDecision.apiError || 'sem resposta'}) — usando fallback local`);
              }
              if (buyDecision?.source === 'jev_api' && !buyDecision.isProfitable) {
                logs.push(`[JEV-AUCTION] JEV API avaliou o lote e não confirmou a compra (${buyDecision.reason})`);
              }
            } else if (scanRes.activeBids) {
              logs.push(`[AUCTION] ${scanRes.activeBids} lance(s) ativo(s); usando apenas ${scanRes.coinsAvailable} coins livres`);
            }
          }

          // Executa a ação diretamente via fetch Node.js — NÃO usa safeEval/browser.
          // O renderer do Chromium fica ocupado com HUD/potion e bloqueava o leilão.
          // A criação de anúncio e o lance usam a mesma API tRPC do scan acima.
          const execSellDecision = (sellDecision?.shouldList && sellDecision?.targetPriceCoins > 0) ? sellDecision : null;
          // O fallback local também é seguro quando o cálculo comprovou
          // spread positivo; bloquear esse caso deixa coins paradas quando a
          // API JEV está indisponível.
          const apiBuyDecision = Boolean(
            buyDecision?.selectedListingId &&
            (buyDecision?.source === 'jev_api' ||
              (buyDecision?.source === 'fallback' && buyDecision?.isProfitable === true))
          );
          const authHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
          };
          if (config.token) authHeaders['authorization'] = `Bearer ${config.token}`;

          let deferredBrowserSell: any = null;
          if (execSellDecision) {
            const sellMsg = `${Math.floor(scanRes.goldToSell / 1e6)}kk por ${execSellDecision.targetPriceCoins} coins`;
            logs.push(`[AUCTION] Iniciando publicação automática: ${sellMsg}`);
            if (!config.auctionLive) {
              logs.push(`[AUCTION] DRY-RUN VENDA: ${sellMsg}`);
            } else {
              try {
                const createBody = JSON.stringify({ '0': {
                  goldAmount: Math.floor(scanRes.goldToSell),
                  startPrice: Math.max(25, Math.floor(execSellDecision.targetPriceCoins)),
                  // O bundle nativo envia a senha da conta nesta mesma
                  // mutação. Sem ela o servidor responde com a mensagem
                  // genérica de robô antes de abrir a confirmação visual.
                  durationHours: 6,
                  password: config.auctionSellPassword || '',
                  twofaCode: '',
                  smsCode: '',
                  pushProof: '',
                  confirmText: 'CONFIRMAR',
                  captchaToken: this.cachedTurnstileToken || '',
                }});
                const tokenAge = Math.round((now - this.cachedTurnstileTs) / 1000);
                if (this.cachedTurnstileToken) {
                  logs.push(`[AUCTION] Usando token Turnstile (${tokenAge}s atrás)`);
                } else {
                  logs.push('[AUCTION] AVISO: sem token Turnstile cacheado — aguardando widget inicializar');
                }

                const createRes = await fetch('https://baiakidle.com/api/trpc/auction.createGold?batch=1', {
                  method: 'POST',
                  headers: authHeaders,
                  body: createBody,
                  signal: AbortSignal.timeout(30000),
                }).then(r => r.json()).catch(() => null);
                const item = Array.isArray(createRes) ? createRes[0] : createRes;
                const data = item?.result?.data?.json ?? item?.result?.data ?? item?.data ?? null;
                const errMsg = item?.error?.json?.message || item?.error?.json?.data?.message ||
                  item?.error?.message || item?.error?.data?.message || null;
                if (data && !errMsg) {
                  logs.push(`[AUCTION] ANÚNCIO DE VENDA CRIADO (JEV): ${sellMsg}`);
                } else {
                  logs.push(`[AUCTION] VENDA RECUSADA [${errMsg || 'falha'}]: ${sellMsg}`);
                  // A API direta não consegue concluir o desafio Turnstile
                  // quando o token não foi emitido ou já expirou. Nesse caso,
                  // reutiliza o fluxo nativo da página, que abre o widget,
                  // preenche a confirmação e tenta novamente com a sessão do
                  // navegador. Não repete o anúncio para erros de saldo,
                  // preço ou autenticação.
                  const needsBrowserChallenge = /rob[oô]|robot|captcha|turnstile|challenge|bot/i.test(String(errMsg || ''));
                  if (needsBrowserChallenge) {
                    logs.push('[AUCTION] Desafio anti-bot detectado — confirmação nativa ficará após o lance');
                    deferredBrowserSell = {
                      job: 'auction_execute',
                      sellDecision: execSellDecision,
                      buyDecision: null,
                      goldToSell: scanRes.goldToSell,
                      live: true,
                      token: config.token,
                      accountPassword: config.auctionSellPassword,
                    };
                  }
                }
              } catch (e: any) {
                logs.push(`[AUCTION] ERRO VENDA (${String(e?.message || e)})`);
              }
            }
          }

          if (apiBuyDecision && buyDecision) {
            const lid = Number(buyDecision.selectedListingId);
            const maxPrice = Number(buyDecision.targetMaxPrice || buyDecision.priceCoins || 100);
            const bidCurrency = buyDecision.currency || 'market';
            const buyMsg = `Lote #${lid} por até ${maxPrice} coins`;
            if (!config.auctionLive) {
              logs.push(`[AUCTION] DRY-RUN COMPRA: ${buyMsg}`);
            } else {
              try {
                const bidRes = await fetch('https://baiakidle.com/api/trpc/auction.bid?batch=1', {
                  method: 'POST',
                  headers: authHeaders,
                  body: JSON.stringify({ '0': { listingId: lid, maxAmount: maxPrice, currency: bidCurrency } }),
                  signal: AbortSignal.timeout(15000),
                }).then(r => r.json()).catch(() => null);
                const bidItem = Array.isArray(bidRes) ? bidRes[0] : bidRes;
                const bidData = bidItem?.result?.data?.json ?? bidItem?.result?.data ?? bidItem?.data ?? null;
                const bidErr = bidItem?.error?.json?.message || bidItem?.error?.message || null;
                if (bidData && !bidErr) {
                  logs.push(`[AUCTION] LANCE REGISTRADO (JEV): ${buyMsg}`);
                } else {
                  logs.push(`[AUCTION] LANCE RECUSADO [${bidErr || 'falha'}]: ${buyMsg}`);
                }
              } catch (e: any) {
                logs.push(`[AUCTION] ERRO LANCE (${String(e?.message || e)})`);
              }
            }
          } else if (buyDecision?.selectedListingId && !apiBuyDecision) {
            logs.push('[AUCTION] Ação bloqueada: JEV API não confirmou a compra; nenhum lance foi enviado.');
          }

          // Só tenta o formulário nativo depois do lance. Assim, um widget
          // anti-robô lento não faz uma oportunidade rentável expirar.
          if (deferredBrowserSell) {
            let browserRes: any = null;
            // O renderer também atende HUD, telemetria e efeitos. Se houver
            // uma avaliação concorrente, safeEval retorna nulo para não
            // formar uma fila de promises. Dê ao fluxo oficial algumas
            // janelas para pegar o navegador livre antes de desistir.
            for (let attempt = 1; attempt <= 2; attempt++) {
              // Espera até 30s por uma avaliação anterior e deixa o fluxo
              // oficial ter tempo para abrir modal, reautenticar e aguardar
              // a confirmação nativa do jogo.
              browserRes = await safeEval<any>(page, 'extra', deferredBrowserSell, 60000, 30000);
              if (browserRes?.events && Array.isArray(browserRes.events)) break;
              if (attempt < 2) {
                logs.push(`[AUCTION] Navegador ocupado; nova tentativa oficial em 10s (${attempt}/2)`);
                await new Promise((resolve) => setTimeout(resolve, 10000));
              }
            }
            if (browserRes?.events && Array.isArray(browserRes.events)) {
              logs.push(...browserRes.events.map((event: any) => `[AUCTION] ${String(event)}`));
            } else {
              logs.push(`[AUCTION] Fallback do navegador não concluiu a confirmação (${browserRes?.error || 'sem resposta do renderer'})`);
            }
          }
          busy = true;
        }
      } catch (err: any) {
        logs.push(`[AUCTION] Erro: ${err?.message || String(err)}`);
      }
    }

    // VFX
    if (!busy && config.reduceVfx) {
      const v = await this.run(page, 'vfx', now, 45, 'extra', { job: 'vfx' }, true);
      logs.push(...v.logs);
    }

    // Glooth Bags / Pouch (apenas se autoBags estiver ativo, intervalo 90s)
    if (config.autoBags) {
      const b = await this.run(page, 'bags', now, 90, 'bags', null, true);
      if (b.ran) {
        busy = true;
        logs.push(...b.logs);
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
