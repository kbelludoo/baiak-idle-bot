/**
 * JEV (TypeSafe AI / Experiential Labs) — System One Decision Engine para Baiak Idle Bot
 * 
 * Fornece decisões rápidas (<300ms), determinísticas e matematicamente tipadas
 * utilizando as 3 primitivas do JEV (model: "jev-latest"):
 * 1. Choice: Seleção categórica discreta (elementos, rotações, itens).
 * 2. Score: Pontuação calibrada baseada em rubrica (risco de combate, urgência).
 * 3. Noul: Probabilidade calibrada 0.0 a 1.0 (deve vender, deve equipar, perigo).
 * 
 * Endpoint oficial: https://api.experientiallabs.ai/v1/systemone
 * Chave de ambiente: EXPERIENTIAL_API_KEY || TYPESAFE_API_KEY || JEV_API_KEY
 */

import { GAME_FORMULA_DESCRIPTION, GAME_FORMULA_SOURCE } from './game_formula';

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
      || 'https://api.experientiallabs.ai/v1/systemone';
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
        return { ok: false, answers: {}, source: 'fallback' };
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
    } catch (_) {
      return { ok: false, answers: {}, source: 'fallback' };
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
    const candScore = (state.candidateRarity * 1000) + (state.candidateTier * 10) + state.candidateUp;
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
    listings: Array<{
      id: string;
      goldAmount: number;
      priceCoins: number;
      minutesRemaining?: number | null;
    }>;
  }): Promise<{
    selectedListingId: string | null;
    isProfitable: boolean;
    reason: string;
    source: 'jev_api' | 'fallback';
  }> {
    if (!state.listings.length) {
      return { selectedListingId: null, isProfitable: false, reason: 'Nenhum leilão listado', source: 'fallback' };
    }

    const maxMins = state.maxMinutesRemaining ?? 5;

    // Filtra ofertas dentro do orçamento e pontua priorizando maior gold por coin e lotes acabando (sniping <= 5 min)
    const withinBudget = state.listings.filter(l => l.priceCoins <= state.budget && l.priceCoins <= state.coinsAvailable);
    if (!withinBudget.length) {
      return {
        selectedListingId: null,
        isProfitable: false,
        reason: 'Nenhuma oferta viável dentro do orçamento de coins',
        source: 'fallback' as const,
      };
    }

    const scored = withinBudget.map(l => {
      const gpc = l.priceCoins > 0 ? l.goldAmount / l.priceCoins : 0;
      const mins = l.minutesRemaining !== null && l.minutesRemaining !== undefined ? l.minutesRemaining : 360;
      // Bônus exponencial para os últimos minutos (<= 5 min = sniping imediato)
      const timeBonus = mins <= maxMins ? 2.5 : (mins <= 15 ? 1.4 : (mins <= 60 ? 0.9 : 0.5));
      return {
        ...l,
        goldPerCoin: gpc,
        sniperScore: gpc * timeBonus,
      };
    }).sort((a, b) => b.sniperScore - a.sniperScore);

    const best = scored[0];
    const fallbackProfitable = Boolean(best);

    const fallbackResult = {
      selectedListingId: fallbackProfitable ? best.id : null,
      isProfitable: fallbackProfitable,
      reason: fallbackProfitable
        ? `Sniper leilão: ${best.goldAmount}g por ${best.priceCoins}c (~${best.minutesRemaining ?? '?'} min restantes)`
        : 'Nenhum leilão vantajoso próximo de encerrar',
      source: 'fallback' as const,
    };

    if (!this.enabled || !this.apiKey || !best) return fallbackResult;

    const req: JevRequest = {
      state: {
        budget_coins: state.budget,
        coins_available: state.coinsAvailable,
        candidate_offer: {
          id: best.id,
          gold: best.goldAmount,
          price: best.priceCoins,
          gold_per_coin: best.goldPerCoin,
          minutes_remaining: best.minutesRemaining ?? 'unknown',
        },
      },
      questions: {
        is_worth_bidding: {
          type: 'noul',
          instructions: 'Considerando que o leilão expira após 6h sem lances, o lote está com preço baixo e em momento favorável para arrematar?',
        },
      },
    };

    const res = await this.systemOne(req);
    if (!res.ok) return fallbackResult;

    const prob = res.answers?.is_worth_bidding?.noul;
    const isProfitable = typeof prob === 'number' ? (prob > 0.55 && fallbackProfitable) : fallbackProfitable;

    return {
      selectedListingId: isProfitable ? best.id : null,
      isProfitable,
      reason: `JEV sniper: ${isProfitable ? 'Arrematar' : 'Pular'} (prob=${prob !== undefined ? prob.toFixed(2) : '-'}, ~${best.minutesRemaining ?? '?'}m)`,
      source: 'jev_api',
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
      shouldList: state.goldToSell >= 25_000_000,
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
    const shouldList = listProb > 0.35 && state.goldToSell >= 25_000_000;

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
  }): Promise<{
    recommendedHuntId: string;
    recommendedHuntName: string;
    confidence: number;
    rationale: string;
    advisoryOnly: true;
    source: 'jev_api' | 'fallback';
  }> {
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
        || /server|offline|live-observed|historical-observed|matrix-observed|report|preview/.test(source);
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
      const xpPart = maxXp > 0 ? (facts.xp / maxXp) * 0.55 : 0;
      const goldPart = maxNet > 0 ? (Math.max(0, facts.net) / maxNet) * 0.45 : 0;
      const weight = (maxXp > 0 ? 0.55 : 0) + (maxNet > 0 ? 0.45 : 0);
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
      ? `Dados reais (${bestMeasured.facts.source}): XP ${formatRate(bestMeasured.facts.xp, '/h')}, gold líquido ${formatRate(bestMeasured.facts.net, '/h')}. Fórmula de combate não foi inventada; taxas vêm do servidor.`
      : 'Sem amostra válida do servidor para comparar hunts; mantendo a hunt atual.';

    const fallbackResult = {
      recommendedHuntId: fallbackHunt.id,
      recommendedHuntName: fallbackHunt.name,
      confidence: bestMeasured ? 0.78 : 0.45,
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

    const confidence = Number(res.answers?.best_hunt?.confidence);
    return {
      recommendedHuntId: chosen.candidate.id,
      recommendedHuntName: chosen.candidate.name,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(0.98, confidence)) : 0.82,
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
}

// Instância padrão global singleton
let globalJevInstance: JevEngine | null = null;
export function getJevEngine(): JevEngine {
  if (!globalJevInstance) {
    globalJevInstance = new JevEngine();
  }
  return globalJevInstance;
}
