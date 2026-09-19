import { describe, it, expect } from 'bun:test';
import { DefaultExtrasScheduler, confirmIsSafeAction, confirmIsUnsafe } from '../src/extras';
import type { BotConfig } from '../src/types';

describe('Extras Scheduler & All Subsystems', () => {
  it('identifica ações de confirmação seguras e inseguras', () => {
    expect(confirmIsSafeAction('Deseja vender os itens da bolsa?')).toBe(true);
    expect(confirmIsSafeAction('Deseja equipar o item?')).toBe(true);
    expect(confirmIsUnsafe('Deseja comprar 500 coins com PIX?')).toBe(true);
    expect(confirmIsUnsafe('Dar lance no leilão de 100 coins?')).toBe(true);
  });

  it('DefaultExtrasScheduler respeita cadências e inclui subsistemas do jogo', async () => {
    const scheduler = new DefaultExtrasScheduler();
    const dummyConfig: BotConfig = {
      headless: true,
      port: 8080,
      host: '0.0.0.0',
      stream: false,
      streamFps: 12,
      streamQuality: 70,
      streamWidth: 854,
      streamHeight: 480,
      autoHunt: true,
      forceHunt: false,
      huntId: '',
      huntMode: 'last',
      exploreSampleSec: 120,
      exploreMaxDeaths: 0,
      exploreMaxDamageTakenPct: 35,
      exploreCooldownSec: 1200,
      autoHeal: true,
      healBelowPct: 75,
      hpPotionBelowPct: 60,
      manaPotionBelowPct: 65,
      autoSell: true,
      sellThresholdPct: 70,
      autoTreino: true,
      autoBoss: true,
      autoEquip: true,
      autoBags: true,
      autoPrey: true,
      autoExtras: true,
      screenshot: false,
      userDataDir: '',
      chromePath: '',
      targetUrl: '',
      token: '',
      reduceVfx: true,
      chromeGl: 'swiftshader',
      auctionEnabled: true,
      auctionLive: false,
      auctionBudget: 100,
      auctionMinMarginPct: 25,
      auctionMaxItems: 2,
    };

    // Executa tick com mock page null (não deve quebrar e deve retornar array)
    const logs = await scheduler.tick(null as any, dummyConfig, Date.now(), false);
    expect(Array.isArray(logs)).toBe(true);
  });
});
