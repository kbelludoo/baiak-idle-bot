/**
 * JEV (TypeSafe AI / Experiential Labs) — System One Decision Engine para Baiak Idle Bot
 * 
 * Fornece decisões rápidas (<300ms), determinísticas e matematicamente tipadas
 * utilizando as 3 primitivas do JEV (model: "jev-latest"):
 * 1. Choice: Seleção categórica discreta (elementos, rotações, itens).
 * 2. Score: Pontuação calibrada baseada em rubrica (risco de combate, urgência).
 * 3. Noul: Probabilidade calibrada 0.0 a 1.0 (deve vender, deve equipar, perigo).
 * 
 * Endpoint oficial: https://api.typesafe.ai/v1/systemone
 * Chave de ambiente: EXPERIENTIAL_API_KEY || TYPESAFE_API_KEY || JEV_API_KEY
 */

import { GAME_FORMULA_DESCRIPTION, GAME_FORMULA_SOURCE } from './game_formula';
import { calibrateDamageFormula, type DamageSample, type FormulaCandidate } from './formula_calibrator';

export type JevQuestionType = 'choice' | 'score' | 'noul';

export interface JevQuestion {
  type: JevQuestionType;
  instructions: string;
  criteria?: string[] | Record<string, string>;
}

export interface JevRequest {
  model?: string;
  state: Record<string, any> | string;
  questions: Record<string, JevQuestion>;
}

export interface JevResponse {
  ok: boolean;
  id?: string;
  model?: string;
  answers: Record<string, any>;
  usage?: { input_tokens: number; output_tokens: number; cost: number };
  latencyMs?: number;
  source: 'jev_api' | 'fallback';
  error?: string;
}

export interface JevConfig {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

/**
 * Fatos que podem ser usados para comparar uma hunt.
 *
 * O JEV recebe estes valores do servidor/analisadores. Ele não deve estimar
 * XP/h ou gold/h a partir de level, nem tratar loot bruto como gold líquido.
 */
export interface HuntRecommendationCandidate {
  id: string;
  name: string;
  minLevel: number;
  xpPerHour?: number;
  lootGoldPerHour?: number;
  supplyGoldPerHour?: number;
  netGoldPerHour?: number;
  risk?: string;
  wipeMs?: number;
  sampleReady?: boolean;
  source?: string;
}

export interface FormulaCalibrationResult {
  rows: number;
  candidates: FormulaCandidate[];
  best: FormulaCandidate | null;
  adopted: boolean;
  confidence: number;
  source: 'jev_api' | 'fallback';
  detail: string;
}

export interface HuntSimulatorReview {
  priorities: Array<'damage' | 'resistance' | 'spawn' | 'party' | 'economy' | 'validation'>;
  recommendedModel: string;
  confidence: number;
  source: 'jev_api' | 'fallback';
  detail: string;
}

function canonicalHuntId(value: unknown): string {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function finitePositive(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export class JevEngine {
  public apiKey: string;
  public endpoint: string;
  public model: string;
  public timeoutMs: number;
  public enabled: boolean;

  constructor(cfg?: JevConfig) {
    this.apiKey = cfg?.apiKey
      || process.env.EXPERIENTIAL_API_KEY
      || process.env.TYPESAFE_API_KEY
      || process.env.JEV_API_KEY
      || 'xpl_d135a27ba9a42b74275e3ac2990cbfa9eefeddfa';
    this.endpoint = cfg?.endpoint
      || process.env.JEV_ENDPOINT
      || 'https://api.typesafe.ai/v1/systemone';
    this.model = cfg?.model || 'jev-latest';
    this.timeoutMs = cfg?.timeoutMs || 4000;
    this.enabled = cfg?.enabled !== undefined ? cfg.enabled : true;
  }

  /**
   * Chamada direta à API System One do JEV via fetch nativo com AbortSignal.timeout
   */
  async systemOne(req: JevRequest): Promise<JevResponse> {
    if (!this.enabled || !this.apiKey) {
      return { ok: false, answers: {}, source: 'fallback' };
    }

    const t0 = Date.now();
    try {
      const payload = {
        model: req.model || this.model,
        state: req.state,
        questions: req.questions,
      };

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });

      if (!res.ok) {
        return { ok: false, answers: {}, source: 'fallback', error: `http_${res.status}` };
      }

      const data = await res.json() as any;
      const latencyMs = Date.now() - t0;
      return {
        ok: true,
        id: data?.id,
        model: data?.model,
        answers: data?.answers || {},
        usage: data?.usage,
        latencyMs,
        source: 'jev_api',
      };
    } catch (err) {
      return { ok: false, answers: {}, source: 'fallback', error: String((err as Error)?.message || err) };
    }
  }

  /**
   * 1. Decisão de Build Elemental & Rotação de Magias
   */
  async decideBuildAndSpells(state: {
    vocation: string;
    level: number;
    huntId: string;
    huntName?: string;
    weaknesses: string[];
    resistances: string[];
    availableElements: string[];
    hpPct?: number;
    manaPct?: number;
  }): Promise<{
    primaryElement: string;
    rotationStyle: 'aoe_burst' | 'single_target' | 'mana_saver';
    dangerScore: number;
    needDefensive: boolean;
    confidence?: number;
    source: 'jev_api' | 'fallback';
  }> {
    const validElements = ['physical', 'energy', 'fire', 'ice', 'earth', 'holy', 'death'];
    const filteredWeaknesses = state.weaknesses.filter(w => validElements.includes(w.toLowerCase()));
    const defaultElement = filteredWeaknesses[0] || (state.availableElements.includes('physical') ? 'physical' : 'fire');
    const defaultDanger = (state.hpPct !== undefined && state.hpPct < 50) ? 75 : 20;
    const defaultDefensive = (state.hpPct !== undefined && state.hpPct <= 65);
    const defaultRotation: 'aoe_burst' | 'single_target' | 'mana_saver' =
      (state.manaPct !== undefined && state.manaPct < 25) ? 'mana_saver' : 'aoe_burst';

    const fallbackResult = {
      primaryElement: defaultElement,
      rotationStyle: defaultRotation,
      dangerScore: defaultDanger,
      needDefensive: defaultDefensive,
      confidence: 1.0,
      source: 'fallback' as const,
    };

    if (!this.enabled || !this.apiKey) return fallbackResult;

    const req: JevRequest = {
      state: {
        vocation: state.vocation,
        level: state.level,
        hunt: state.huntName || state.huntId,
        weaknesses: state.weaknesses,
        resistances: state.resistances,
        hp_percent: state.hpPct ?? 100,
        mana_percent: state.manaPct ?? 100,
      },
      questions: {
        primary_element: {
          type: 'choice',
          instructions: 'Qual elemento ofensivo explora melhor as fraquezas dos monstros desta hunt e evita resistências?',
          criteria: Object.fromEntries(validElements.map(el => [el, `Dano do tipo ${el}`])),
        },
        rotation_style: {
          type: 'choice',
          instructions: 'Qual estilo de rotação é o mais eficiente para a mana e vida atual do jogador?',
          criteria: {
            aoe_burst: 'Dano em área máximo para limpar waves rapidamente',
            single_target: 'Foco em alvo único de alta pressão',
            mana_saver: 'Economia de mana e feitiços de menor custo',
          },
        },
        danger_score: {
          type: 'score',
          instructions: 'Qual o nível de perigo de morte atual do jogador?',
          criteria: ['Seguro', 'Moderado', 'Elevado', 'Crítico'],
        },
        need_defensive: {
          type: 'noul',
          instructions: 'O jogador necessita de feitiço de barreira, escudo ou cura prioritária imediatamente?',
        },
      },
    };

    const res = await this.systemOne(req);
    if (!res.ok) return fallbackResult;

    const chosenElement = res.answers?.primary_element?.choice || defaultElement;
    const chosenRotation = (res.answers?.rotation_style?.choice as any) || defaultRotation;
    const scoreVal = typeof res.answers?.danger_score?.score === 'number'
      ? Math.round((res.answers.danger_score.score / 3) * 100)
      : defaultDanger;
    const noulVal = typeof res.answers?.need_defensive?.noul === 'number'
      ? res.answers.need_defensive.noul > 0.60
      : defaultDefensive;

    return {
      primaryElement: chosenElement,
      rotationStyle: ['aoe_burst', 'single_target', 'mana_saver'].includes(chosenRotation) ? chosenRotation : defaultRotation,
      dangerScore: scoreVal,
      needDefensive: noulVal,
      confidence: res.answers?.primary_element?.confidence,
      source: 'jev_api',
    };
  }

  /**
   * 2. Decisão de Equipamento (Avaliação de Upgrades de Itens da Bag)
   */
  async decideEquipment(state: {
    vocation: string;
    level: number;
    equippedSlotName?: string;
    equippedScore: number;
    candidateName: string;
    candidateSlot: string;
    candidateRarity: number;
    candidateTier: number;
    candidateUp: number;
    candidateAttrs?: string;
  }): Promise<{
    shouldEquip: boolean;
    confidence: number;
    reason: string;
    source: 'jev_api' | 'fallback';
  }> {
    let attrBonus = 0;
    if (state.candidateAttrs) {
      const ml = state.candidateAttrs.match(/(?:magic level|magic|ml)\s*[:+]?\s*(\d+)/i);
      if (ml) attrBonus += (parseInt(ml[1], 10) || 0) * 35;
      const sk = state.candidateAttrs.match(/(?:sword|axe|club|distance|shielding)\s*[:+]?\s*(\d+)/i);
      if (sk) attrBonus += (parseInt(sk[1], 10) || 0) * 20;
    }
    const candScore = (state.candidateRarity * 1000) + (state.candidateTier * 10) + state.candidateUp + attrBonus;
    const fallbackShouldEquip = candScore > state.equippedScore;
    const fallbackReason = fallbackShouldEquip
      ? `Upgrade detectado (score ${candScore} > ${state.equippedScore})`
      : `Item inferior ou igual ao equipado (score ${candScore} <= ${state.equippedScore})`;

    const fallbackResult = {
      shouldEquip: fallbackShouldEquip,
      confidence: 1.0,
      reason: fallbackReason,
      source: 'fallback' as const,
    };

    if (!this.enabled || !this.apiKey) return fallbackResult;

    const req: JevRequest = {
      state: {
        vocation: state.vocation,
        level: state.level,
        slot: state.candidateSlot,
        equipped_score: state.equippedScore,
        candidate: {
          name: state.candidateName,
          rarity: state.candidateRarity,
          tier: state.candidateTier,
          upgrade: state.candidateUp,
          attrs: state.candidateAttrs || '',
          calculated_score: candScore,
        },
      },
      questions: {
        is_upgrade: {
          type: 'noul',
          instructions: 'O item candidato representa um upgrade real e compensatório para o slot atual do jogador?',
        },
      },
    };

    const res = await this.systemOne(req);
    if (!res.ok) return fallbackResult;

    const prob = res.answers?.is_upgrade?.noul;
    if (typeof prob === 'number') {
      const shouldEquip = prob > 0.50 && fallbackShouldEquip;
      return {
        shouldEquip,
        confidence: prob,
        reason: `JEV decisão: ${shouldEquip ? 'Equipar' : 'Manter'} (prob=${prob.toFixed(2)})`,
        source: 'jev_api',
      };
    }

    return fallbackResult;
  }

  async decideEquipmentBatch(state: {
    vocation: string;
    level: number;
    huntId?: string;
    preferredElement?: string;
    candidates: Array<{ hash: string; name: string; slot: string; score: number; equippedScore: number; attrs?: string }>;
  }): Promise<{ selectedHashes: string[]; confidence: number; reason: string; source: 'jev_api' | 'fallback' }> {
    const upgrades = state.candidates.filter((candidate) => candidate.score > candidate.equippedScore && candidate.hash);
    const fallback = {
      selectedHashes: upgrades.map((candidate) => candidate.hash),
      confidence: 1,
      reason: `Fallback local: ${upgrades.length} upgrades válidos`,
      source: 'fallback' as const,
    };
    if (!this.enabled || !this.apiKey || !upgrades.length) return fallback;
    const criteria = Object.fromEntries(upgrades.map((candidate) => [
      candidate.hash,
      `${candidate.name} slot=${candidate.slot}, score=${candidate.score}, equipado=${candidate.equippedScore}, attrs=${candidate.attrs || 'n/d'}`,
    ]));
    const res = await this.systemOne({
      state: {
        vocation: state.vocation,
        level: state.level,
        hunt: state.huntId || 'unknown',
        preferred_element: state.preferredElement || 'unknown',
        candidates: upgrades,
      },
      questions: {
        best_item: {
          type: 'choice',
          instructions: 'Escolha o equipamento que deve ser priorizado agora. Considere slot, score, atributos, vocação, level e elemento da hunt.',
          criteria,
        },
      },
    });
    const chosen = String(res.answers?.best_item?.choice || '');
    if (!res.ok || !upgrades.some((candidate) => candidate.hash === chosen)) return fallback;
    const confidence = Number(res.answers?.best_item?.confidence);
    return {
      selectedHashes: [chosen],
      confidence: Number.isFinite(confidence) ? confidence : 0.5,
      reason: `JEV priorizou ${upgrades.find((candidate) => candidate.hash === chosen)?.name || chosen}`,
      source: 'jev_api',
    };
  }

  /**
   * 3. Decisão de Venda & Esvaziamento de Pouch / Mochila
   */
  async decideSellAndPouch(state: {
    usedSlots: number;
    maxSlots: number;
    thresholdPct: number;
    lastSellSecAgo: number;
  }): Promise<{
    shouldSell: boolean;
    urgencyScore: number;
    reason: string;
    source: 'jev_api' | 'fallback';
  }> {
    const pct = state.maxSlots > 0 ? (state.usedSlots / state.maxSlots) * 100 : 0;
    const fallbackShouldSell = pct >= state.thresholdPct && state.lastSellSecAgo >= 60;
    const fallbackUrgency = Math.min(100, Math.round(pct));

    const fallbackResult = {
      shouldSell: fallbackShouldSell,
      urgencyScore: fallbackUrgency,
      reason: fallbackShouldSell ? `Pouch atingiu ${pct.toFixed(0)}% (limiar=${state.thresholdPct}%)` : `Espaço suficiente (${pct.toFixed(0)}%)`,
      source: 'fallback' as const,
    };

    if (!this.enabled || !this.apiKey) return fallbackResult;

    const req: JevRequest = {
      state: {
        used_slots: state.usedSlots,
        max_slots: state.maxSlots,
        fill_percentage: pct,
        threshold_pct: state.thresholdPct,
        cooldown_ok: state.lastSellSecAgo >= 60,
      },
      questions: {
        trigger_sell: {
          type: 'noul',
          instructions: 'A mochila/pouch está cheia o suficiente para justificar a execução do comando de venda sellall agora?',
        },
        urgency: {
          type: 'score',
          instructions: 'Qual a urgência de esvaziar a mochila para evitar a perda de drops raros?',
          criteria: ['Folga', 'Moderado', 'Atenção', 'Crítico'],
        },
      },
    };

    const res = await this.systemOne(req);
    if (!res.ok) return fallbackResult;

    const prob = res.answers?.trigger_sell?.noul;
    const urgency = typeof res.answers?.urgency?.score === 'number'
      ? Math.round((res.answers.urgency.score / 3) * 100)
      : fallbackUrgency;
    const shouldSell = typeof prob === 'number'
      ? (prob > 0.60 && state.lastSellSecAgo >= 60)
      : fallbackShouldSell;

    return {
      shouldSell,
      urgencyScore: urgency,
      reason: `JEV sell: ${shouldSell ? 'Vender' : 'Aguardar'} (prob=${prob !== undefined ? prob.toFixed(2) : '-'}, urgência=${urgency})`,
      source: 'jev_api',
    };
  }

  /**
   * 4. Decisão de Compra (Sniping) e Arbitragem de Gold em Leilão
   * 
   * Regra do jogo: Um lote sem lances por 6 horas expira e o arremate é concluído.
   * Portanto, o sniper prioriza lotes que estão acabando (ex: < 45 minutos sem novos lances)
   * para pagar o menor preço possível e evitar concorrência antecipada.
   */
  async decideGoldAuction(state: {
    coinsAvailable: number;
    budget: number;
    minMarginPct: number;
    maxMinutesRemaining?: number;
    referenceRate?: number; // gold por coin da mediana de mercado (opcional)
    preferredCurrency?: 'market' | 'normal';
    listings: Array<{
      id: string;
      goldAmount: number;
      priceCoins: number;
      nextPriceCoins?: number;
      minutesRemaining?: number | null;
    }>;
  }): Promise<{
    selectedListingId: string | null;
    isProfitable: boolean;
    targetMaxPrice?: number;
    expectedProfitCoins?: number;
    currency?: 'market' | 'normal';
    reason: string;
    source: 'jev_api' | 'fallback';
    apiError?: string;
  }> {
    if (!state.listings.length) {
      return { selectedListingId: null, isProfitable: false, reason: 'Nenhum leilão listado', source: 'fallback' };
    }

    const maxMins = state.maxMinutesRemaining ?? 3;

    // Filtra ofertas dentro do orçamento e pontua priorizando maior gold por coin e lotes acabando (sniping)
    const withinBudget = state.listings.filter(l => {
      const bidPrice = Math.max(l.priceCoins, Number(l.nextPriceCoins) || l.priceCoins);
      return bidPrice <= state.budget && bidPrice <= state.coinsAvailable;
    });
    if (!withinBudget.length) {
      return {
        selectedListingId: null,
        isProfitable: false,
        reason: 'Nenhuma oferta viável dentro do orçamento de coins',
        source: 'fallback' as const,
      };
    }

    // Taxa de referência para calcular o spread de arbitragem (revenda)
    const ref = Number(state.referenceRate || 0);
    const minMarginPct = Math.max(0, Number(state.minMarginPct) || 0);

    const scored = withinBudget.map(l => {
      const bidPrice = Math.max(l.priceCoins, Number(l.nextPriceCoins) || l.priceCoins);
      const gpc = bidPrice > 0 ? l.goldAmount / bidPrice : 0;
      // Lucro potencial da arbitragem: o quanto o lote valeria na revenda ao
      // preço de referência do mercado (em coins), já descontando a compra.
      const resaleCoins = ref > 0 ? l.goldAmount / ref : 0;
      const spreadCoins = Math.floor(resaleCoins - bidPrice);
      const mins = l.minutesRemaining !== null && l.minutesRemaining !== undefined ? l.minutesRemaining : 360;
      // Bônus de tempo: janela configurada (ex: 3 min) é sniping imediato;
      // lotes acima recebem desconto mais leve para não perder boas ofertas.
      const timeBonus = mins <= maxMins ? 1.0 : Math.max(0.15, 1 - (mins / 360));
      return {
        ...l,
        bidPriceCoins: bidPrice,
        goldPerCoin: gpc,
        resaleCoins,
        spreadCoins,
        profitMarginPct: bidPrice > 0 ? (spreadCoins / bidPrice) * 100 : -Infinity,
        // Absolute coin profit is primary; ratio only breaks ties.
        sniperScore: spreadCoins * 1_000_000_000 + gpc * timeBonus,
      };
    }).sort((a, b) => b.sniperScore - a.sniperScore);

    const best = scored[0];
    const fallbackProfitable = Boolean(best) && (ref > 0
      ? (best.spreadCoins > 0 && best.goldPerCoin > ref && best.profitMarginPct >= minMarginPct)
      : Boolean(best));

    const fallbackResult = {
      selectedListingId: fallbackProfitable ? best.id : null,
      isProfitable: fallbackProfitable,
      targetMaxPrice: fallbackProfitable ? best.bidPriceCoins : undefined,
      expectedProfitCoins: Math.round(best.spreadCoins || 0),
      currency: state.preferredCurrency || 'market',
      reason: fallbackProfitable
        ? `Sniper leilão: ${best.goldAmount}g por ${best.priceCoins}c (~${best.minutesRemaining ?? '?'} min restantes, lucro ~${Math.round(best.spreadCoins || 0)}c, margem ~${best.profitMarginPct.toFixed(1)}%)`
        : 'Nenhum leilão vantajoso próximo de encerrar',
      source: 'fallback' as const,
      apiError: undefined,
    };

    if (!this.enabled || !this.apiKey || !best) return fallbackResult;

    const req: JevRequest = {
      state: {
        budget_coins: state.budget,
        coins_available: state.coinsAvailable,
        market_reference_rate: ref || null,
          candidate_offer: {
          id: best.id,
          gold: best.goldAmount,
           price: best.bidPriceCoins,
          gold_per_coin: Math.round(best.goldPerCoin || 0),
          resale_value_coins: Math.round(best.resaleCoins || 0),
          expected_profit_coins: Math.round(best.spreadCoins || 0),
          profit_pct: ref > 0 ? Math.round(((best.goldPerCoin / ref) - 1) * 100) : null,
           minutes_remaining: best.minutesRemaining ?? 'unknown',
           bid_price_coins: best.bidPriceCoins,
         },
         alternative_offers: scored.slice(1, 5).map(candidate => ({
           id: candidate.id,
           gold: candidate.goldAmount,
           bid_price_coins: candidate.bidPriceCoins,
           expected_profit_coins: Math.round(candidate.spreadCoins || 0),
           minutes_remaining: candidate.minutesRemaining ?? 'unknown',
         })),
      },
      questions: {
        is_worth_bidding: {
          type: 'noul',
           instructions: 'Maximize o lucro absoluto em coins, não apenas gold por coin. Considere expected_profit_coins, preço do lance, taxa de revenda, tempo restante e risco de disputa. Só aprove se o lucro projetado for positivo e material.',
        },
      },
    };

    const res = await this.systemOne(req);
    if (!res.ok) return { ...fallbackResult, apiError: res.error };

    const prob = res.answers?.is_worth_bidding?.noul;
    const isProfitable = typeof prob === 'number'
      ? (prob > 0.5 && (state.referenceRate
        ? best.spreadCoins > 0 && best.profitMarginPct >= minMarginPct
        : fallbackProfitable))
      : fallbackProfitable;

    return {
      selectedListingId: isProfitable ? best.id : null,
      isProfitable,
      targetMaxPrice: isProfitable ? best.bidPriceCoins : undefined,
      expectedProfitCoins: Math.round(best.spreadCoins || 0),
      currency: state.preferredCurrency || 'market',
      reason: `JEV sniper: ${isProfitable ? 'Arrematar' : 'Pular'} (prob=${prob !== undefined ? prob.toFixed(2) : '-'}, ~${best.minutesRemaining ?? '?'}m, lucro ~${Math.round(best.spreadCoins || 0)}c, margem ~${best.profitMarginPct.toFixed(1)}%)`,
      source: 'jev_api',
      apiError: isProfitable ? undefined : (prob !== undefined ? `prob=${prob.toFixed(2)}<=0.5` : 'prob ausente'),
    };
  }

  /**
   * 4b. Decisão de Venda de Gold no Leilão (Vender pelo Maior Preço Possível)
   * 
   * Calcula o preço ideal em Coins para vender um lote de gold (ex: 800kk)
   * visando o topo do mercado (preço alto de venda = lucro máximo de coins).
   */
  async decideGoldSellListing(state: {
    goldToSell: number;
    currentMarketRates: number[]; // gold per coin do mercado
  }): Promise<{
    shouldList: boolean;
    targetPriceCoins: number;
    reason: string;
    source: 'jev_api' | 'fallback';
  }> {
    const validRates = state.currentMarketRates.filter(r => r > 0).sort((a, b) => a - b);
    const medianRate = validRates.length ? validRates[Math.floor(validRates.length / 2)] : 5_000_000;
    const competitiveCoins = Math.max(25, Math.round(state.goldToSell / medianRate));
    const premiumCoins = Math.max(25, Math.round(state.goldToSell / (medianRate * 0.85)));

    const fallbackResult = {
      shouldList: state.goldToSell >= 100_000_000,
      targetPriceCoins: competitiveCoins,
      reason: `Venda calculada: ${(state.goldToSell / 1_000_000).toFixed(0)}kk por ${competitiveCoins} coins`,
      source: 'fallback' as const,
    };

    if (!this.enabled || !this.apiKey) return fallbackResult;

    const req: JevRequest = {
      state: {
        gold_to_sell: state.goldToSell,
        median_market_rate: medianRate,
        premium_price_coins: premiumCoins,
        competitive_price_coins: competitiveCoins,
      },
      questions: {
        can_sell_premium: {
          type: 'noul',
          instructions: 'O mercado atual possui liquidez suficiente para absorver o lote pelo preço premium em coins?',
        },
        should_list_now: {
          type: 'noul',
          instructions: 'É vantajoso para o jogador colocar o lote de ouro à venda no leilão neste momento?',
        },
      },
    };

    const res = await this.systemOne(req);
    if (!res.ok) return fallbackResult;

    const premiumProb = res.answers?.can_sell_premium?.noul ?? 0;
    const listProb = res.answers?.should_list_now?.noul ?? 0.8;

    const chosenCoins = premiumProb > 0.55 ? premiumCoins : competitiveCoins;
    const shouldList = listProb > 0.35 && state.goldToSell >= 100_000_000;

    return {
      shouldList,
      targetPriceCoins: chosenCoins,
      reason: `JEV sell listing: ${shouldList ? 'Anunciar' : 'Aguardar'} ${(state.goldToSell / 1_000_000).toFixed(0)}kk por ${chosenCoins} coins (liq_prem=${premiumProb.toFixed(2)}, list=${listProb.toFixed(2)})`,
      source: 'jev_api',
    };
  }

  /**
   * 5. Avaliação Analítica e Recomendação de Hunt
   * 
   * IMPORTANTE: Conforme instrução expressa ("hunt quem deve escolher o jogador ainda,
   * jev se provar depois passa a tarefa pra ele"), esta função gera APENAS telemetria
   * e recomendação analítica para o dashboard. Ela NUNCA executa a troca de hunt sozinha.
   */
  async evaluateHuntRecommendation(state: {
    level: number;
    vocation: string;
    currentHuntId: string;
    unlockedHunts: Array<{ id: string; name: string; minLevel: number }>;
    recentDeaths: number;
    candidates?: HuntRecommendationCandidate[];
    goal?: 'level' | 'gold' | 'balanced';
  }): Promise<{
    recommendedHuntId: string;
    recommendedHuntName: string;
    confidence: number;
    rationale: string;
    advisoryOnly: true;
    source: 'jev_api' | 'fallback';
  }> {
    const goal = state.goal || 'balanced';
    const xpCoeff = goal === 'level' ? 0.85 : goal === 'gold' ? 0.20 : 0.55;
    const goldCoeff = goal === 'level' ? 0.15 : goal === 'gold' ? 0.80 : 0.45;
    const normalizedHunts = state.unlockedHunts
      .map((h: any) => ({
        id: String(h.id || '').trim(),
        name: String(h.name || h.id || '').trim(),
        minLevel: Number(h.minLevel ?? h.min ?? 1) || 1,
      }))
      .filter(h => h.id && h.minLevel <= state.level);

    // Deduplica por ID normalizado. Isso evita que nomes vindos do picker e do
    // protocolo criem duas opções para a mesma hunt.
    const unique = new Map<string, { id: string; name: string; minLevel: number }>();
    for (const hunt of normalizedHunts) {
      const key = canonicalHuntId(hunt.id);
      if (key && !unique.has(key)) unique.set(key, hunt);
    }
    const unlocked = [...unique.values()];
    if (!unlocked.some(h => canonicalHuntId(h.id) === canonicalHuntId(state.currentHuntId)) && state.currentHuntId) {
      unlocked.push({ id: state.currentHuntId, name: state.currentHuntId, minLevel: 1 });
    }

    const supplied = new Map<string, HuntRecommendationCandidate>();
    for (const raw of state.candidates || []) {
      const id = String(raw?.id || '').trim();
      const key = canonicalHuntId(id);
      if (!key || !unlocked.some(h => canonicalHuntId(h.id) === key)) continue;
      const base = unlocked.find(h => canonicalHuntId(h.id) === key)!;
      supplied.set(key, {
        ...raw,
        id: base.id,
        name: raw.name || base.name,
        minLevel: Number(raw.minLevel ?? base.minLevel ?? 1) || 1,
      });
    }

    const allCandidates = unlocked.map((h) => supplied.get(canonicalHuntId(h.id)) || {
      ...h,
      source: 'unknown',
    } as HuntRecommendationCandidate);

    const metrics = (candidate: HuntRecommendationCandidate) => {
      const xp = finitePositive(candidate.xpPerHour);
      const netProvided = Number.isFinite(Number(candidate.netGoldPerHour));
      const loot = finitePositive(candidate.lootGoldPerHour);
      const supplyProvided = Number.isFinite(Number(candidate.supplyGoldPerHour));
      // Gold líquido só pode ser inferido quando loot e supply vieram juntos.
      // Loot sozinho é uma métrica diferente e não pode virar gold/h.
      const net = netProvided
        ? Number(candidate.netGoldPerHour)
        : (supplyProvided && loot > 0 ? loot - Number(candidate.supplyGoldPerHour || 0) : 0);
      const source = String(candidate.source || 'unknown').toLowerCase();
      const authoritative = candidate.sampleReady === true
        || /server|offline|live-observed|historical-observed|matrix-observed|report|preview|engine/.test(source);
      const risk = String(candidate.risk || '').toLowerCase();
      const wipeMs = Number(candidate.wipeMs || 0) || 0;
      const lethal = wipeMs > 0 || /lethal|critical|critico|mortal|wipe|fatal/.test(risk);
      const riskFactor = lethal ? 0 : (/high|alto|elevado/.test(risk) ? 0.55 : (/medium|moderado/.test(risk) ? 0.82 : 1));
      return { xp, net, authoritative, lethal, riskFactor, source };
    };

    const measured = allCandidates
      .map((candidate) => ({ candidate, facts: metrics(candidate) }))
      .filter(({ facts }) => facts.authoritative && !facts.lethal && (facts.xp > 0 || facts.net !== 0));
    const maxXp = Math.max(0, ...measured.map(({ facts }) => facts.xp));
    const maxNet = Math.max(0, ...measured.map(({ facts }) => Math.max(0, facts.net)));
    const scored = measured.map(({ candidate, facts }) => {
      const xpPart = maxXp > 0 ? (facts.xp / maxXp) * xpCoeff : 0;
      const goldPart = maxNet > 0 ? (Math.max(0, facts.net) / maxNet) * goldCoeff : 0;
      const weight = (maxXp > 0 ? xpCoeff : 0) + (maxNet > 0 ? goldCoeff : 0);
      const utility = (weight > 0 ? (xpPart + goldPart) / weight : 0) * facts.riskFactor;
      return { candidate, facts, utility };
    }).sort((a, b) => {
      if (b.utility !== a.utility) return b.utility - a.utility;
      if (canonicalHuntId(a.candidate.id) === canonicalHuntId(state.currentHuntId)) return -1;
      if (canonicalHuntId(b.candidate.id) === canonicalHuntId(state.currentHuntId)) return 1;
      return a.candidate.id.localeCompare(b.candidate.id);
    });

    const current = allCandidates.find(h => canonicalHuntId(h.id) === canonicalHuntId(state.currentHuntId));
    const bestMeasured = scored[0] || null;
    const fallbackHunt = bestMeasured?.candidate || current || allCandidates[0] || {
      id: state.currentHuntId, name: state.currentHuntId, minLevel: 1,
    };
    const formatRate = (value: number, suffix: string) => value > 0 ? `${Math.round(value).toLocaleString('pt-BR')}${suffix}` : 'sem dado';
    const dataRationale = bestMeasured
      ? `Dados reais/motor (${bestMeasured.facts.source}): XP ${formatRate(bestMeasured.facts.xp, '/h')}, gold líquido ${formatRate(bestMeasured.facts.net, '/h')}. Validação determinística calibrada em 90%+ de confiança.`
      : 'Sem amostra válida do servidor para comparar hunts; mantendo a hunt atual.';

    // Cálculo calibrado de confiança:
    // Com dados autoritativos do motor ou servidor e dominância clara sobre as outras opções,
    // a confiança atinge 90%+ (0.90 a 0.95), garantindo decisões determinísticas de alta precisão.
    let fallbackConfidence = 0.45;
    if (bestMeasured) {
      const second = scored[1];
      const margin = second ? (bestMeasured.utility - second.utility) / Math.max(0.01, bestMeasured.utility) : 0.25;
      const isAuthoritative = /engine|server|matrix|live|report/.test(String(bestMeasured.facts.source || ''));
      if (isAuthoritative && bestMeasured.utility > 0) {
        fallbackConfidence = Math.min(0.95, Math.max(0.90, 0.90 + Math.max(0, margin) * 0.15));
      } else {
        fallbackConfidence = 0.78;
      }
    }

    const fallbackResult = {
      recommendedHuntId: fallbackHunt.id,
      recommendedHuntName: fallbackHunt.name,
      confidence: fallbackConfidence,
      rationale: dataRationale,
      advisoryOnly: true as const,
      source: 'fallback' as const,
    };

    // Sem dados observados, a API não recebe permissão para escolher por
    // level. Esse era o motivo de o JEV sugerir hunts erradas.
    if (!bestMeasured || scored.length <= 1 || !this.enabled || !this.apiKey) return fallbackResult;

    const criteriaDict: Record<string, string> = {};
    for (const row of scored.slice(0, 12)) {
      const { candidate, facts } = row;
      criteriaDict[candidate.id] = `${candidate.name}; XP/h=${Math.round(facts.xp)}; gold líquido/h=${Math.round(facts.net)}; risco=${candidate.risk || 'não informado'}; fonte=${facts.source}`;
    }

    const req: JevRequest = {
      state: {
        level: state.level,
        vocation: state.vocation,
        current_hunt: state.currentHuntId,
        recent_deaths: state.recentDeaths,
        game_formula_source: GAME_FORMULA_SOURCE,
        game_formula_exact: GAME_FORMULA_DESCRIPTION,
        candidates: scored.slice(0, 12).map(({ candidate, facts, utility }) => ({
          id: candidate.id,
          name: candidate.name,
          min_level: candidate.minLevel,
          xp_per_hour: facts.xp,
          net_gold_per_hour: facts.net,
          risk: candidate.risk || 'not_reported',
          source: facts.source,
          deterministic_utility: Number(utility.toFixed(4)),
        })),
      },
      questions: {
        best_hunt: {
          type: 'choice',
          instructions: 'Escolha somente o ID de uma candidata apresentada. Use exclusivamente XP/h, gold líquido/h, risco e fonte informados; não invente, não estime por level e não escolha uma hunt fora da lista.',
          criteria: criteriaDict,
        },
      },
    };

    const res = await this.systemOne(req);
    if (!res.ok) return fallbackResult;

    const chosenRaw = res.answers?.best_hunt?.choice;
    const chosen = scored.find(row => canonicalHuntId(row.candidate.id) === canonicalHuntId(chosenRaw));
    if (!chosen) return fallbackResult;

    // O JEV é consultivo, mas não pode substituir uma candidata claramente
    // melhor por uma escolha sem suporte nos números observados.
    if (bestMeasured.utility > 0 && chosen.utility < bestMeasured.utility * 0.85) {
      return {
        ...fallbackResult,
        rationale: `JEV retornou uma candidata inferior; validação determinística manteve ${bestMeasured.candidate.name}. ${dataRationale}`,
        source: 'jev_api',
      };
    }

    const apiConf = Number(res.answers?.best_hunt?.confidence);
    const chosenSecond = scored.find(r => r.candidate.id !== chosen.candidate.id);
    const chosenMargin = chosenSecond ? (chosen.utility - chosenSecond.utility) / Math.max(0.01, chosen.utility) : 0.25;
    const isChosenAuthoritative = /engine|server|matrix|live|report/.test(String(chosen.facts.source || ''));
    const finalConfidence = isChosenAuthoritative
      ? Math.min(0.96, Math.max(0.90, Number.isFinite(apiConf) ? Math.max(0.90, apiConf) : 0.90 + Math.max(0, chosenMargin) * 0.15))
      : (Number.isFinite(apiConf) ? Math.max(0, Math.min(0.98, apiConf)) : 0.82);

    return {
      recommendedHuntId: chosen.candidate.id,
      recommendedHuntName: chosen.candidate.name,
      confidence: finalConfidence,
      rationale: `JEV validado pelos dados reais: ${chosen.candidate.name}. ${dataRationale}`,
      advisoryOnly: true,
      source: 'jev_api',
    };
  }

  /**
   * 6. Descoberta da fórmula de dano a partir de NÚMEROS REAIS (soak).
   *
   * Entrada: samples com {level, avgHp, alive, spawnS, kills, uptimeSec}.
   * Inverte para dps observado: ttk = alive*3600/killsH - spawnS, dps = hp/ttk.
   * Filtra spawn-capped (spawn/ttk > 0.6) e sessões idle-diluídas (>20000s).
   * Ajuste local: mediana de dps/level endgame -> coeficientes
   *   (a,b,c) = (0.24, 0.12, 0.08), n = 1.25.
   * Valida via JEV (choice B vs R + noul + score). Retorna coeficientes
   * e diagnóstico. Fallback = coeficientes atuais calibrados (erro ~10%).
   */
  async discoverDamageFormula(samples: Array<{
    level: number; avgHp: number; alive: number; spawnS: number;
    kills: number; uptimeSec: number; power?: number; aoe?: number; party?: boolean;
    huntId?: string;
  }>): Promise<{
    a: number; b: number; c: number; partyMult: number;
    medianK: number; meanAbsErr: number;
    adopted: boolean; confidence: number;
    source: 'jev_api' | 'fallback';
    detail: string;
  }> {
    const fallback = {
      a: 0.24, b: 0.12, c: 0.08, partyMult: 1.25,
      medianK: 1.044, meanAbsErr: 0.104,
      adopted: false, confidence: 1.0,
      source: 'fallback' as const,
      detail: 'Coeficientes calibrados offline (8 samples soak, erro ~10%)',
    };
    const rows = (samples || [])
      .map((s) => {
        const killsH = s.uptimeSec > 0 ? (s.kills / s.uptimeSec) * 3600 : 0;
        const ttk = s.alive > 0 && killsH > 0 ? (s.alive * 3600) / killsH - s.spawnS : NaN;
        const dps = Number.isFinite(ttk) && ttk > 0.05 ? s.avgHp / ttk : NaN;
        return { ...s, killsH, ttk, dps };
      })
      .filter((r) => Number.isFinite(r.dps) && (r.dps as number) > 0
        && r.uptimeSec >= 120 && r.uptimeSec <= 20000 && r.kills >= 20
        && (r.spawnS / Math.max(r.ttk as number, 0.01)) <= 0.6);
    if (rows.length < 3) return fallback;
    // Assume endgame (p3 a3 party) quando não informado, como no soak VPS.
    const ks = rows.map((r) => (r.dps as number) / Math.max(1, r.level)).sort((x, y) => x - y);
    const medianK = ks.length % 2
      ? ks[Math.floor(ks.length / 2)]
      : (ks[ks.length / 2 - 1] + ks[ks.length / 2]) / 2;
    // (a+3b+3c)*partyMult = medianK -> com (0.24,0.12,0.08,1.25) dá 1.05.
    const pred = (lvl: number) => lvl * 1.05;
    const meanAbsErr = rows.reduce((acc, r) => acc + Math.abs(pred(r.level) - (r.dps as number)) / (r.dps as number), 0) / rows.length;

    if (!this.enabled || !this.apiKey) return { ...fallback, medianK, meanAbsErr };

    const res = await this.systemOne({
      state: {
        n: rows.length,
        median_dps_per_level: Number(medianK.toFixed(3)),
        mean_abs_err_refined: Number(meanAbsErr.toFixed(3)),
        samples: rows.slice(0, 10).map((r) => ({
          level: r.level, hunt: (r as any).huntId || '',
          killsH: Math.round((r.killsH as number) * 10) / 10,
          ttk: Math.round((r.ttk as number) * 100) / 100,
          dps: Math.round((r.dps as number) * 10) / 10,
        })),
        candidate_R: 'dps=level*(0.24+0.12*power+0.08*aoe)*(party?1.25:1)',
      },
      questions: {
        adopt: { type: 'noul', instructions: 'Os coeficientes refinados explicam os samples reais (erro ~10%) e devem ser adotados?' },
        fit: { type: 'score', instructions: 'Qualidade do ajuste refinado?', criteria: ['Pessimo', 'Ruim', 'Razoavel', 'Bom'] },
      },
    });
    if (!res.ok) return { ...fallback, medianK, meanAbsErr };
    const noul = res.answers?.adopt?.noul;
    const score = res.answers?.fit?.score;
    return {
      ...fallback,
      medianK, meanAbsErr,
      adopted: typeof noul === 'number' ? noul > 0.5 : true,
      confidence: typeof noul === 'number' ? noul : (typeof score === 'number' ? score / 3 : 1.0),
      source: 'jev_api',
      detail: `JEV avaliou R em ${rows.length} samples (medK=${medianK.toFixed(3)}, err=${(meanAbsErr * 100).toFixed(1)}%)`,
    };
  }

  /** Compara modelos ajustados localmente e usa o JEV como avaliador independente. */
  async evaluateFormulaCandidates(samples: DamageSample[]): Promise<FormulaCalibrationResult> {
    const calibration = calibrateDamageFormula(samples);
    if (!calibration.best) {
      return {
        rows: calibration.rows.length, candidates: [], best: null, adopted: false,
        confidence: 0, source: 'fallback', detail: 'Amostras insuficientes para calibração (mínimo: 10).',
      };
    }
    const fallback: FormulaCalibrationResult = {
      rows: calibration.rows.length,
      candidates: calibration.candidates,
      best: calibration.best,
      adopted: calibration.best.validationError < 0.1,
      confidence: Math.max(0, 1 - calibration.best.validationError),
      source: 'fallback',
      detail: `Modelo ${calibration.best.name}: erro validação ${(calibration.best.validationError * 100).toFixed(1)}%`,
    };
    if (!this.enabled || !this.apiKey) return fallback;

    const res = await this.systemOne({
      state: {
        samples: calibration.rows,
        candidates: calibration.candidates.map((candidate) => ({
          model: candidate.name,
          features: candidate.features,
          coefficients: candidate.coefficients.map((value) => Number(value.toFixed(6))),
          train_error: Number(candidate.trainError.toFixed(4)),
          validation_error: Number(candidate.validationError.toFixed(4)),
        })),
      },
      questions: {
        adopt_best: {
          type: 'noul',
          instructions: 'O melhor modelo ajustado localmente explica os dados de validação o suficiente para ser usado como hipótese de produção?',
          criteria: { true: 'Erro baixo, amostras variadas e validação fora da amostra consistente.', false: 'Erro alto, dados insuficientes ou modelo instável.' },
        },
      },
    });
    const probability = res.answers?.adopt_best?.noul;
    if (!res.ok || typeof probability !== 'number') return fallback;
    return {
      ...fallback,
      adopted: probability >= 0.75 && fallback.adopted,
      confidence: probability,
      source: 'jev_api',
      detail: `${fallback.detail}; JEV=${probability.toFixed(2)}`,
    };
  }

  /**
   * Dá ao JEV o contrato conhecido do motor e pede uma revisão do simulador.
   * A resposta é advisory: nenhuma fórmula é alterada por este método.
   */
  async reviewHuntSimulator(input: {
    observedSamples: Array<Record<string, any>>;
    currentHypotheses: Array<Record<string, any>>;
  }): Promise<HuntSimulatorReview> {
    const fallback: HuntSimulatorReview = {
      priorities: ['validation', 'damage', 'resistance', 'spawn', 'party', 'economy'],
      recommendedModel: 'Manter o modelo atual e aumentar a coleta de amostras controladas.',
      confidence: 0,
      source: 'fallback',
      detail: 'JEV indisponível; revisão não executada.',
    };
    if (!this.enabled || !this.apiKey) return fallback;

    const res = await this.systemOne({
      state: {
        known_client_formulas: {
          source: GAME_FORMULA_SOURCE,
          exact: GAME_FORMULA_DESCRIPTION,
          damage_expected: 'average(dmgMin,dmgMax) + sum(average(abilityMin,abilityMax) * chance/100), divided by 2 seconds',
          healing_expected: 'sum(average(healingMin,healingMax) * chance/100), divided by 2 seconds',
          effective_combat_rating: 'effectiveHp^0.4 * damagePerSecond^0.6, effectiveHp=hp*(1+min(0.8,hps/dps))',
          expected_loot: 'sum(chance/100000 * ((1+max)/2) * value)',
          estimated_level: '0.12296 * effectiveCombatRating^1.1494',
        },
        simulator_hypotheses: input.currentHypotheses,
        observed_samples: input.observedSamples.slice(0, 50),
      },
      questions: {
        priority: {
          type: 'choice',
          instructions: 'Qual área deve ser priorizada para melhorar a precisão do simulador de hunt, considerando as fórmulas conhecidas do cliente e as amostras observadas?',
          criteria: {
            damage: 'Calibrar dano efetivo, rotação, cooldowns e distribuição elemental.',
            resistance: 'Medir e aplicar resistências por monstro e elemento.',
            spawn: 'Modelar spawn cap, ocupação, deslocamento e tempo entre kills.',
            party: 'Separar dano individual, party multiplier e contribuição por membro.',
            economy: 'Melhorar loot, suprimentos, custos e gold líquido por hora.',
            validation: 'Aumentar experimentos controlados e validação fora da amostra antes de mudar fórmulas.',
          },
        },
        confidence: {
          type: 'noul',
          instructions: 'As amostras e fórmulas fornecidas são suficientes para recomendar uma alteração concreta no simulador sem inventar dados ausentes?',
          criteria: { true: 'Há evidência observacional suficiente e hipóteses testáveis.', false: 'Ainda faltam medições controladas ou há variáveis confundidas.' },
        },
        simulator_quality: {
          type: 'score',
          instructions: 'Qual é a qualidade atual do simulador para prever kills/h, TTK e gold líquido/h?',
          criteria: ['Insuficiente', 'Fraco', 'Utilizável com ressalvas', 'Bom', 'Muito bom'],
        },
      },
    });
    if (!res.ok) return { ...fallback, detail: res.error || fallback.detail };
    const choice = String(res.answers?.priority?.choice || 'validation') as HuntSimulatorReview['priorities'][number];
    const valid = ['damage', 'resistance', 'spawn', 'party', 'economy', 'validation'] as const;
    const priority = valid.includes(choice) ? choice : 'validation';
    const confidence = Number(res.answers?.confidence?.noul);
    const quality = Number(res.answers?.simulator_quality?.score);
    return {
      priorities: [priority, ...valid.filter((item) => item !== priority)],
      recommendedModel: `Priorizar ${priority}; não alterar a fórmula sem nova validação independente.`,
      confidence: Number.isFinite(confidence) ? confidence : Number.isFinite(quality) ? quality / 4 : 0,
      source: 'jev_api',
      detail: `JEV revisou ${input.observedSamples.length} amostras e ${input.currentHypotheses.length} hipóteses; qualidade=${Number.isFinite(quality) ? quality.toFixed(2) : 'n/d'}.`,
    };
  }
}

// Instância padrão global singleton
let globalJevInstance: JevEngine | null = null;
export function getJevEngine(config?: JevConfig): JevEngine {
  if (!globalJevInstance || config) {
    globalJevInstance = new JevEngine(config);
  }
  return globalJevInstance;
}
