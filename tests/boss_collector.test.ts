import { describe, expect, it } from 'bun:test';
import { BOSS_TOKEN_PRICES, checkAndBuyBossGear } from '../src/boss_collector';
import type { BotConfig } from '../src/types';

describe('Boss Collector & Auto Boss Management', () => {
  it('contém catálogo com preços de itens cruciais para todas as vocações', () => {
    expect(BOSS_TOKEN_PRICES['fabulous legs']).toBe(16);
    expect(BOSS_TOKEN_PRICES['eldritch quiver']).toBe(16);
    expect(BOSS_TOKEN_PRICES['death oyoroi']).toBe(8);
    expect(BOSS_TOKEN_PRICES['ghost chestplate']).toBe(12);
    expect(BOSS_TOKEN_PRICES['zaoan helmet']).toBe(4);
    expect(BOSS_TOKEN_PRICES['toga mortis']).toBe(16);
  });

  it('não tenta comprar se autoBoss estiver desligado ou tokens forem insuficientes', async () => {
    const dummyConfig = {
      autoBoss: false,
      autoBuyBossItems: ['fabulous legs'],
    } as unknown as BotConfig;

    const res = await checkAndBuyBossGear(null, dummyConfig, Date.now());
    expect(res).toBeNull();
  });
});
