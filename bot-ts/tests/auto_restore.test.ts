import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoRestoreEngine, type AutoRestoreSnapshot } from '../src/auto_restore';

describe('AutoRestoreEngine', () => {
  let engine: AutoRestoreEngine;
  let mockSendStage: any;
  let mockCloseModals: any;
  let mockClearQueue: any;
  let mockReloadPage: any;

  beforeEach(() => {
    engine = new AutoRestoreEngine();
    mockSendStage = vi.fn().mockResolvedValue(true);
    mockCloseModals = vi.fn().mockResolvedValue(undefined);
    mockClearQueue = vi.fn();
    mockReloadPage = vi.fn().mockResolvedValue(undefined);
  });

  const baseSnapshot: AutoRestoreSnapshot = {
    online: true,
    isCity: false,
    inTreino: false,
    stamina: '38h 12m',
    wave: 'Glooth Bandit',
    kills: 100,
    waves: 10,
    gold: 50000,
    level: 250,
    bossActive: false,
    bossChargesLeft: 3,
  };

  it('permanece em FARMING quando há progresso normal de kills/waves/gold', async () => {
    const t0 = 1000000;
    // Tick 1
    await engine.evaluate(t0, baseSnapshot, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(engine.getStatus().mode).toBe('FARMING');
    expect(engine.getStatus().totalRecoveries).toBe(0);

    // Tick 2: progresso de kills após 30s
    const snap2 = { ...baseSnapshot, kills: 105 };
    await engine.evaluate(t0 + 30000, snap2, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(engine.getStatus().stuckLevel).toBe(0);
    expect(engine.getStatus().totalRecoveries).toBe(0);
  });

  it('aciona Nível 1 (fechar modais e locks) após 60s sem progresso', async () => {
    const t0 = 1000000;
    await engine.evaluate(t0, baseSnapshot, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);

    // 65 segundos depois sem nenhum kill novo
    const res = await engine.evaluate(t0 + 65000, baseSnapshot, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(res.needsHuntEntry).toBe(true);
    expect(res.reason).toBe('farm_idle_60s');
    expect(mockCloseModals).toHaveBeenCalled();
    expect(engine.getStatus().stuckLevel).toBe(1);
  });

  it('aciona Nível 2 (re-enviar stage) após 120s sem progresso', async () => {
    const t0 = 1000000;
    await engine.evaluate(t0, baseSnapshot, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);

    // 125 segundos depois
    const res = await engine.evaluate(t0 + 125000, baseSnapshot, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(res.needsHuntEntry).toBe(true);
    expect(res.reason).toBe('farm_stall_120s');
    expect(mockSendStage).toHaveBeenCalledWith('glooth-cave');
    expect(engine.getStatus().stuckLevel).toBe(2);
    expect(engine.getStatus().totalRecoveries).toBe(1);
  });

  it('aciona Nível 3 (limpar fila) após 200s sem progresso', async () => {
    const t0 = 1000000;
    await engine.evaluate(t0, baseSnapshot, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);

    // 205 segundos depois
    await engine.evaluate(t0 + 205000, baseSnapshot, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(mockClearQueue).toHaveBeenCalled();
    expect(engine.getStatus().stuckLevel).toBe(3);
  });

  it('aciona Nível 4 (reload da página) após 300s (5min) sem progresso', async () => {
    const t0 = 1000000;
    await engine.evaluate(t0, baseSnapshot, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);

    // 305 segundos depois
    await engine.evaluate(t0 + 305000, baseSnapshot, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(mockReloadPage).toHaveBeenCalledWith('farm_stall_5min');
    expect(engine.getStatus().stuckLevel).toBe(4);
  });

  it('Guardião de Cidade: tira o bot da cidade se ficar parado por mais de 45s', async () => {
    const t0 = 1000000;
    const citySnap: AutoRestoreSnapshot = {
      ...baseSnapshot,
      isCity: true,
      wave: 'Cidade de Thais',
    };

    // Entra na cidade
    await engine.evaluate(t0, citySnap, 'naga-lair', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(engine.getStatus().mode).toBe('CITY_TRANSITION');

    // 50s na cidade sem sair
    const res = await engine.evaluate(t0 + 50000, citySnap, 'naga-lair', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(res.needsHuntEntry).toBe(true);
    expect(res.reason).toBe('cidade_idle_timeout');
    expect(mockCloseModals).toHaveBeenCalled();
    expect(engine.getStatus().totalRecoveries).toBe(1);

    // 80s na cidade -> envia stage direto
    await engine.evaluate(t0 + 80000, citySnap, 'naga-lair', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(mockSendStage).toHaveBeenCalledWith('naga-lair');
  });

  it('Guardião de Treino: força saída de treino se stamina cheia por mais de 60s', async () => {
    const t0 = 1000000;
    const treinoFullSnap: AutoRestoreSnapshot = {
      ...baseSnapshot,
      inTreino: true,
      stamina: '42:00',
      wave: 'Treino Online',
    };

    // Entra no treino com stamina cheia
    await engine.evaluate(t0, treinoFullSnap, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(engine.getStatus().mode).toBe('TRAINING');

    // 70s depois ainda em treino com stamina cheia
    const res = await engine.evaluate(t0 + 70000, treinoFullSnap, 'glooth-cave', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(res.needsHuntEntry).toBe(true);
    expect(res.reason).toBe('stamina_cheia_treino');
    expect(mockSendStage).toHaveBeenCalledWith('glooth-cave');
    expect(engine.getStatus().totalRecoveries).toBe(1);
  });

  it('Guardião de Chefe: nunca interrompe o combate nem dispara recuperação de stall na sala do chefe', async () => {
    const t0 = 2000000;
    const bossSnap: AutoRestoreSnapshot = {
      ...baseSnapshot,
      bossActive: true,
      wave: 'Sala do Chefe',
    };

    // Entra na sala do chefe
    await engine.evaluate(t0, bossSnap, 'naga-lair', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(engine.getStatus().mode).toBe('BOSS');

    // 300s (5min) depois sem kills nem waves extras
    const res = await engine.evaluate(t0 + 300000, bossSnap, 'naga-lair', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(res.needsHuntEntry).toBe(false);
    expect(mockSendStage).not.toHaveBeenCalled();
    expect(mockReloadPage).not.toHaveBeenCalled();
    expect(engine.getStatus().mode).toBe('BOSS');
  });

  it('Guardião de Chefe: detecta sala do chefe mesmo se bossActive for inferido pelo nome da wave', async () => {
    const t0 = 3000000;
    const bossSnapByName: AutoRestoreSnapshot = {
      ...baseSnapshot,
      bossActive: false,
      wave: 'Sala do Chefe (Brokul)',
    };

    await engine.evaluate(t0, bossSnapByName, 'naga-lair', null, mockSendStage, mockCloseModals, mockClearQueue, mockReloadPage);
    expect(engine.getStatus().mode).toBe('BOSS');
  });
});
