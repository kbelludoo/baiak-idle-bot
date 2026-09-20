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
    // Para vender pelo maior preço possível em coins, o rate (gold por coin) deve ser menor ou igual à mediana inferior
    // Exemplo: se o mercado vende 5kk por coin (mediana), vender a 4kk por coin rende mais coins por gold!
    const medianRate = validRates.length ? validRates[Math.floor(validRates.length / 2)] : 5_000_000;
    const premiumRate = medianRate * 0.85; // vende gold mais caro em coins
    const calculatedCoins = Math.max(1, Math.round(state.goldToSell / premiumRate));

    const fallbackResult = {
      shouldList: state.goldToSell >= 100_000_000,
      targetPriceCoins: calculatedCoins,
      reason: `Venda calculada: ${(state.goldToSell / 1_000_000).toFixed(0)}kk por ${calculatedCoins} coins`,
      source: 'fallback' as const,
    };

    if (!this.enabled || !this.apiKey) return fallbackResult;

    const req: JevRequest = {
      state: {
        gold_to_sell: state.goldToSell,
        median_market_rate: medianRate,
        calculated_price_coins: calculatedCoins,
      },
      questions: {
        is_optimal_sell: {
          type: 'noul',
          instructions: 'O preço sugerido em coins maximiza o retorno de coins sem ficar fora da liquidez do mercado?',
        },
      },
    };

    const res = await this.systemOne(req);
    if (!res.ok) return fallbackResult;

    const prob = res.answers?.is_optimal_sell?.noul;
    const shouldList = typeof prob === 'number' ? (prob > 0.50 && fallbackResult.shouldList) : fallbackResult.shouldList;

    return {
      shouldList,
      targetPriceCoins: calculatedCoins,
      reason: `JEV sell listing: ${shouldList ? 'Anunciar' : 'Aguardar'} ${(state.goldToSell / 1_000_000).toFixed(0)}kk por ${calculatedCoins} coins`,
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
  }): Promise<{
    recommendedHuntId: string;
    recommendedHuntName: string;
    confidence: number;
    rationale: string;
    advisoryOnly: true;
    source: 'jev_api' | 'fallback';
  }> {
    const candidates = state.unlockedHunts.filter(h => h.minLevel <= state.level);
    const sorted = [...candidates].sort((a, b) => b.minLevel - a.minLevel);
    const fallbackHunt = sorted[0] || { id: state.currentHuntId, name: state.currentHuntId, minLevel: 1 };

    const fallbackResult = {
      recommendedHuntId: fallbackHunt.id,
      recommendedHuntName: fallbackHunt.name,
      confidence: 0.85,
      rationale: `Recomendação analítica por progressão de nível (Lvl req: ${fallbackHunt.minLevel})`,
      advisoryOnly: true as const,
      source: 'fallback' as const,
    };

    if (!this.enabled || !this.apiKey || candidates.length <= 1) return fallbackResult;

    const criteriaDict: Record<string, string> = {};
    for (const h of candidates.slice(0, 10)) {
      criteriaDict[h.id] = `${h.name} (Lvl ${h.minLevel}+)`;
    }

    const req: JevRequest = {
      state: {
        level: state.level,
        vocation: state.vocation,
        current_hunt: state.currentHuntId,
        recent_deaths: state.recentDeaths,
      },
      questions: {
        best_hunt: {
          type: 'choice',
          instructions: 'Qual hunt oferece o melhor equilíbrio de rentabilidade e sobrevivência para o nível atual?',
          criteria: criteriaDict,
        },
      },
    };

    const res = await this.systemOne(req);
    if (!res.ok) return fallbackResult;

    const chosen = res.answers?.best_hunt?.choice;
    const match = candidates.find(c => c.id === chosen);
    if (match) {
      return {
        recommendedHuntId: match.id,
        recommendedHuntName: match.name,
        confidence: res.answers?.best_hunt?.confidence ?? 0.90,
        rationale: `JEV recomendação preditiva: ${match.name}`,
        advisoryOnly: true,
        source: 'jev_api',
      };
    }

    return fallbackResult;
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
