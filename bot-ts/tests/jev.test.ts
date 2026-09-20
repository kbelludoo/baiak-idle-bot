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
    });

    expect(rec.advisoryOnly).toBe(true);
    expect(rec.recommendedHuntId).toBe('glooth-cave');
    expect(rec.source).toBe('fallback');
  });
});
