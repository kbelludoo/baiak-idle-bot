import { describe, expect, it } from 'bun:test';
import { JevEngine } from '../src/jev';

describe('JEV (TypeSafe AI Decision Engine)', () => {
  it('instantiates with proper configuration and defaults', () => {
    const engine = new JevEngine({
      apiKey: 'test-key',
      endpoint: 'https://api.experientiallabs.ai/v1/systemone',
      timeoutMs: 1500,
    });
    expect(engine.apiKey).toBe('test-key');
    expect(engine.model).toBe('jev-latest');
    expect(engine.enabled).toBe(true);
  });

  it('decideBuildAndSpells returns valid elemental build and rotation (local fallback)', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const res = await offlineEngine.decideBuildAndSpells({
      vocation: 'Knight',
      level: 150,
      huntId: 'glooth-cave',
      huntName: 'Glooth Bandits',
      weaknesses: ['physical', 'energy'],
      resistances: ['earth'],
      availableElements: ['physical', 'fire', 'energy'],
      hpPct: 85,
      manaPct: 70,
    });

    expect(res.source).toBe('fallback');
    expect(res.primaryElement).toBe('physical');
    expect(res.rotationStyle).toBe('aoe_burst');
    expect(res.needDefensive).toBe(false);
  });

  it('decideBuildAndSpells triggers mana_saver rotation when mana is critically low', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const res = await offlineEngine.decideBuildAndSpells({
      vocation: 'Paladin',
      level: 120,
      huntId: 'asura-lair',
      weaknesses: ['holy'],
      resistances: ['death'],
      availableElements: ['holy', 'physical'],
      hpPct: 40,
      manaPct: 15,
    });

    expect(res.rotationStyle).toBe('mana_saver');
    expect(res.needDefensive).toBe(true);
  });

  it('decideEquipment correctly compares equipment upgrade score', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const upgrade = await offlineEngine.decideEquipment({
      vocation: 'Knight',
      level: 100,
      equippedScore: 2050,
      candidateName: 'Zaoan Helmet',
      candidateSlot: 'helmet',
      candidateRarity: 3,
      candidateTier: 1,
      candidateUp: 2,
    });
    expect(upgrade.shouldEquip).toBe(true);

    const downgrade = await offlineEngine.decideEquipment({
      vocation: 'Knight',
      level: 100,
      equippedScore: 2050,
      candidateName: 'Leather Helmet',
      candidateSlot: 'helmet',
      candidateRarity: 0,
      candidateTier: 0,
      candidateUp: 0,
    });
    expect(downgrade.shouldEquip).toBe(false);
  });

  it('decideSellAndPouch respects thresholdPct and cooldown', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const shouldSell = await offlineEngine.decideSellAndPouch({
      usedSlots: 30,
      maxSlots: 32,
      thresholdPct: 70,
      lastSellSecAgo: 120,
    });
    expect(shouldSell.shouldSell).toBe(true);
    expect(shouldSell.urgencyScore).toBeGreaterThanOrEqual(90);

    const keepBag = await offlineEngine.decideSellAndPouch({
      usedSlots: 10,
      maxSlots: 32,
      thresholdPct: 70,
      lastSellSecAgo: 120,
    });
    expect(keepBag.shouldSell).toBe(false);
  });

  it('decideGoldAuction selects best gold per coin listing within budget and prioritizes ending auctions', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const listings = [
      { id: 'deal-1', goldAmount: 1000000, priceCoins: 50, minutesRemaining: 15 },   // 20,000 g/c, 15m restantes (sniper!)
      { id: 'deal-2', goldAmount: 2000000, priceCoins: 100, minutesRemaining: 300 }, // 20,000 g/c, 5h restantes
      { id: 'deal-3', goldAmount: 8000000, priceCoins: 300, minutesRemaining: 10 },  // Fora do orçamento de 100 coins
    ];

    const res = await offlineEngine.decideGoldAuction({
      coinsAvailable: 200,
      budget: 100,
      minMarginPct: 10,
      maxMinutesRemaining: 45,
      listings,
    });

    expect(res.selectedListingId).toBe('deal-1');
    expect(res.isProfitable).toBe(true);
  });

  it('recusa comprar 100kk por 30 coins se a revenda calculada vale 25', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const res = await offlineEngine.decideGoldAuction({
      coinsAvailable: 39,
      budget: 100,
      minMarginPct: 25,
      referenceRate: 4_000_000,
      listings: [{ id: 'loss', goldAmount: 100_000_000, priceCoins: 30, minutesRemaining: 2 }],
    });

    expect(res.selectedListingId).toBeNull();
    expect(res.isProfitable).toBe(false);
    expect(res.expectedProfitCoins).toBe(-5);
  });

  it('decideGoldSellListing calculates optimal coin price to sell gold at premium', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const res = await offlineEngine.decideGoldSellListing({
      goldToSell: 800_000_000, // 800kk
      currentMarketRates: [4_000_000, 5_000_000, 6_000_000],
    });

    expect(res.shouldList).toBe(true);
    expect(res.targetPriceCoins).toBeGreaterThan(100);
    expect(res.source).toBe('fallback');
  });

  it('evaluateHuntRecommendation returns advisory recommendation without forcing switch', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const hunts = [
      { id: 'trolls', name: 'Troll Cave', minLevel: 1 },
      { id: 'dragon-lair', name: 'Dragon Lair', minLevel: 60 },
      { id: 'glooth-cave', name: 'Glooth Bandits', minLevel: 140 },
      { id: 'asura-lair', name: 'Asuras', minLevel: 250 },
    ];

    const rec = await offlineEngine.evaluateHuntRecommendation({
      level: 155,
      vocation: 'Paladin',
      currentHuntId: 'dragon-lair',
      unlockedHunts: hunts,
      recentDeaths: 0,
      candidates: [
        { id: 'trolls', name: 'Troll Cave', minLevel: 1, xpPerHour: 200_000, netGoldPerHour: 50_000, sampleReady: true, source: 'server-preview' },
        { id: 'dragon-lair', name: 'Dragon Lair', minLevel: 60, xpPerHour: 2_000_000, netGoldPerHour: 100_000, sampleReady: true, source: 'server-preview' },
        { id: 'glooth-cave', name: 'Glooth Bandits', minLevel: 140, xpPerHour: 5_000_000, netGoldPerHour: 2_000_000, sampleReady: true, source: 'server-preview' },
      ],
    });

    expect(rec.advisoryOnly).toBe(true);
    expect(rec.recommendedHuntId).toBe('glooth-cave');
    expect(rec.source).toBe('fallback');
    expect(rec.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it('garante confiança de 90%+ (0.90 a 0.95) quando alimentado com simulação determinística do motor', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const rec = await offlineEngine.evaluateHuntRecommendation({
      level: 150,
      vocation: 'Knight',
      currentHuntId: 'dragon-lair',
      unlockedHunts: [
        { id: 'dragon-lair', name: 'Dragon Lair', minLevel: 60 },
        { id: 'glooth-cave', name: 'Glooth Bandit', minLevel: 60 },
        { id: 'refiner-cave', name: 'Stone Refiner', minLevel: 30 },
      ],
      recentDeaths: 0,
      candidates: [
        { id: 'dragon-lair', name: 'Dragon Lair', minLevel: 60, xpPerHour: 591_325, netGoldPerHour: 127_891, sampleReady: true, source: 'engine-deterministic' },
        { id: 'glooth-cave', name: 'Glooth Bandit', minLevel: 60, xpPerHour: 700_620, netGoldPerHour: 353_748, sampleReady: true, source: 'engine-deterministic' },
        { id: 'refiner-cave', name: 'Stone Refiner', minLevel: 30, xpPerHour: 502_751, netGoldPerHour: 566_586, sampleReady: true, source: 'engine-deterministic' },
      ],
    });

    expect(rec.recommendedHuntId).toBe('refiner-cave');
    expect(rec.confidence).toBeGreaterThanOrEqual(0.90);
    expect(rec.confidence).toBeLessThanOrEqual(0.96);
    expect(rec.rationale).toContain('engine-deterministic');
  });

  it('prioriza XP máxima quando goal é level (Level Rush)', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const rec = await offlineEngine.evaluateHuntRecommendation({
      level: 150,
      vocation: 'Knight',
      currentHuntId: 'dragon-lair',
      unlockedHunts: [
        { id: 'dragon-lair', name: 'Dragon Lair', minLevel: 60 },
        { id: 'glooth-cave', name: 'Glooth Bandit', minLevel: 60 },
        { id: 'refiner-cave', name: 'Stone Refiner', minLevel: 30 },
      ],
      recentDeaths: 0,
      goal: 'level',
      candidates: [
        { id: 'dragon-lair', name: 'Dragon Lair', minLevel: 60, xpPerHour: 591_325, netGoldPerHour: 127_891, sampleReady: true, source: 'engine-deterministic' },
        { id: 'glooth-cave', name: 'Glooth Bandit', minLevel: 60, xpPerHour: 700_620, netGoldPerHour: 353_748, sampleReady: true, source: 'engine-deterministic' },
        { id: 'refiner-cave', name: 'Stone Refiner', minLevel: 30, xpPerHour: 502_751, netGoldPerHour: 566_586, sampleReady: true, source: 'engine-deterministic' },
      ],
    });

    expect(rec.recommendedHuntId).toBe('glooth-cave');
    expect(rec.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it('evaluateHuntRecommendation supports hunts table with min field', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const huntsWithMin = [
      { id: 'troll-cave', name: 'Troll Cave', min: 1 },
      { id: 'wyrm-cave', name: 'Wyrm', min: 130 },
      { id: 'naga-lair', name: 'Naga Lair', min: 300 },
    ];

    const rec = await offlineEngine.evaluateHuntRecommendation({
      level: 150,
      vocation: 'Knight',
      currentHuntId: 'troll-cave',
      unlockedHunts: huntsWithMin as any,
      recentDeaths: 0,
    });

    expect(rec.recommendedHuntId).toBe('troll-cave');
    expect(rec.recommendedHuntName).toBe('Troll Cave');
    expect(rec.rationale).toContain('Sem amostra válida');
    expect(rec.advisoryOnly).toBe(true);
  });

  it('prefere matriz histórica robusta de Asuras a uma amostra curta de Hero', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const rec = await offlineEngine.evaluateHuntRecommendation({
      level: 334,
      vocation: 'Knight',
      currentHuntId: 'vexclaw-lair',
      unlockedHunts: [
        { id: 'hero-cave', name: 'Hero', minLevel: 60 },
        { id: 'asura-lair', name: 'Asuras', minLevel: 150 },
      ],
      recentDeaths: 0,
      candidates: [
        { id: 'hero-cave', name: 'Hero', minLevel: 60, xpPerHour: 7_569_045, netGoldPerHour: 763_890, sampleReady: true, source: 'live-observed' },
        { id: 'asura-lair', name: 'Asuras', minLevel: 150, xpPerHour: 9_522_583, netGoldPerHour: 2_252_227, sampleReady: true, source: 'matrix-observed' },
      ],
    });
    expect(rec.recommendedHuntId).toBe('asura-lair');
    expect(rec.rationale).toContain('9.522.583');
  });

  it('discoverDamageFormula retorna coeficientes calibrados no soak (fallback offline)', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const res = await offlineEngine.discoverDamageFormula([
      { level: 150, avgHp: 1450, alive: 3, spawnS: 3.6, kills: 966, uptimeSec: 4149, huntId: 'dragon-lair' },
      { level: 150, avgHp: 2500, alive: 4, spawnS: 2.2, kills: 981, uptimeSec: 4250, huntId: 'glooth-cave' },
      { level: 311, avgHp: 8450, alive: 4, spawnS: 2.2, kills: 172, uptimeSec: 1276, huntId: 'vexclaw-lair' },
    ]);
    expect(res.source).toBe('fallback');
    expect(res.a).toBeCloseTo(0.24, 2);
    expect(res.b).toBeCloseTo(0.12, 2);
    expect(res.c).toBeCloseTo(0.08, 2);
    expect(res.partyMult).toBeCloseTo(1.25, 2);
    expect(res.medianK).toBeGreaterThan(0.5);
    expect(res.medianK).toBeLessThan(2.0);
  });

  it('reviewHuntSimulator mantém revisão advisory sem alterar fórmulas no fallback', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const review = await offlineEngine.reviewHuntSimulator({
      observedSamples: [{ level: 150, dps: 158, killsH: 838 }],
      currentHypotheses: [{ model: 'current', formula: 'dps=level*1.05' }],
    });
    expect(review.source).toBe('fallback');
    expect(review.priorities[0]).toBe('validation');
    expect(review.recommendedModel).toContain('Manter');
  });

  it('decideEquipmentBatch usa somente candidatos válidos no fallback', async () => {
    const offlineEngine = new JevEngine({ apiKey: '', enabled: false });
    const result = await offlineEngine.decideEquipmentBatch({
      vocation: 'knight', level: 200, huntId: 'wyrm-cave', preferredElement: 'ice',
      candidates: [
        { hash: 'a', name: 'Axe', slot: 'weapon', score: 1400, equippedScore: 1000 },
        { hash: 'b', name: 'Old', slot: 'helmet', score: 900, equippedScore: 1000 },
      ],
    });
    expect(result.selectedHashes).toEqual(['a']);
    expect(result.source).toBe('fallback');
  });
});
