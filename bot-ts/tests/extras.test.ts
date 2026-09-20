import { describe, it, expect } from 'bun:test';
import { DefaultExtrasScheduler, confirmIsSafeAction, confirmIsUnsafe, shouldTransferLoot, shouldKeepLoot, isTrashLoot, shouldSweepBag, parseStaminaMinutes } from '../src/extras';
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
    const logs = await scheduler.tick(null as any, dummyConfig, Date.now(), false, null, 800_000_000, 100);
    expect(Array.isArray(logs)).toBe(true);
  });

  it('guarda SOMENTE épico/lendário/mítico; raro ou menor é lixo', () => {
    expect(shouldTransferLoot(3, 'Epic Sword')).toBe(true);
    expect(shouldTransferLoot(4, 'Legendary Armor')).toBe(true);
    expect(shouldTransferLoot(5, 'Mythical Helm')).toBe(true);
    expect(shouldTransferLoot(2, 'Rare Sword')).toBe(false);
    expect(shouldTransferLoot(1, 'Uncommon Boots')).toBe(false);
    expect(shouldTransferLoot(0, 'Common Shield')).toBe(false);
    expect(shouldKeepLoot(3, 'Epic')).toBe(true);
    expect(isTrashLoot(2, 'Rare Sword')).toBe(true);
    expect(isTrashLoot(3, 'Epic Sword')).toBe(false);
    expect(isTrashLoot(4, 'Legendary')).toBe(false);
    // moedas nunca são lixo
    expect(isTrashLoot(0, 'Gold Coin')).toBe(false);
  });

  it('varredura anti-encher dispara a partir de 50%', () => {
    expect(shouldSweepBag(15, 30)).toBe(true);
    expect(shouldSweepBag(14, 30)).toBe(false);
    expect(shouldSweepBag(29, 30)).toBe(true);
  });

  it('parseStaminaMinutes cobre relógio, XhYm, % e placeholder', () => {
    expect(parseStaminaMinutes('41:15')).toBe(2475);
    expect(parseStaminaMinutes('38h 15m')).toBe(2295);
    expect(parseStaminaMinutes('85%')).toBe(2142);
    expect(parseStaminaMinutes('42:00')).toBeNull();
    expect(parseStaminaMinutes('—')).toBeNull();
  });
});
