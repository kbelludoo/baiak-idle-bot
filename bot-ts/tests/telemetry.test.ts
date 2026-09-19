import { describe, expect, it } from 'bun:test';
import { TelemetryStore, parseGoldAmount, normalizeStamina } from '../src/telemetry';

describe('TelemetryStore (Proteção contra Regressão e Rastreamento de Origem)', () => {
  it('não declara online antes da abertura do WebSocket', () => {
    const telemetry = new TelemetryStore();
    expect(telemetry.snapshot().online).toBe(false);
    telemetry.setOnline(true);
    expect(telemetry.snapshot().online).toBe(true);
  });
  it('inicializa com valores fallback e origem fallback', () => {
    const store = new TelemetryStore();
    expect(store.level).toBe(0);
    expect(store.stamina).toBe('—');
    expect(store.hunt).toBe('Conectando...');
    expect(store.getSources().level).toBe('fallback');
    expect(store.getSources().stamina).toBe('fallback');
    expect(store.getSources().hunt).toBe('fallback');
  });

  it('protege nível contra regressão para 0 ou nível padrão 50', () => {
    const store = new TelemetryStore();
    store.updateLevel(305, 'dom');
    expect(store.level).toBe(305);
    expect(store.getSources().level).toBe('dom');

    // Tentativas inválidas de regressão
    store.updateLevel(0, 'dom');
    expect(store.level).toBe(305);

    store.updateLevel(50, 'dom');
    expect(store.level).toBe(305);

    store.updateLevel(null, 'dom');
    expect(store.level).toBe(305);

    // Subida legítima de nível
    store.updateLevel(306, 'websocket');
    expect(store.level).toBe(306);
    expect(store.getSources().level).toBe('websocket');
  });

  it('protege stamina contra regressão para "—" ou sentinelas vazios', () => {
    const store = new TelemetryStore();
    store.updateStamina('12:39', 'battery-save');
    expect(store.stamina).toBe('12:39');
    expect(store.getSources().stamina).toBe('battery-save');

    // Tentativas de sobrescrever com vazio ou sentinela
    store.updateStamina('—', 'dom');
    expect(store.stamina).toBe('12:39');

    store.updateStamina('', 'dom');
    expect(store.stamina).toBe('12:39');

    store.updateStamina(null, 'dom');
    expect(store.stamina).toBe('12:39');

    // Atualização com percentual
    store.updateStamina('30%', 'dom');
    expect(store.stamina).toBe('30%');
    expect(store.getSources().stamina).toBe('dom');
  });

  it('protege hunt válida de ser sobrescrita por "Conectando..." ou "—"', () => {
    const store = new TelemetryStore();
    store.updateHunt('Asuras', 'battery-save');
    expect(store.hunt).toBe('Asuras');

    store.updateHunt('Conectando...', 'dom');
    expect(store.hunt).toBe('Asuras');

    store.updateHunt('—', 'dom');
    expect(store.hunt).toBe('Asuras');

    // Troca legítima de hunt
    store.updateHunt('Undead Dragon', 'dom');
    expect(store.hunt).toBe('Undead Dragon');
  });

  it('ingere frames de WebSocket sem quebrar o estado', () => {
    const store = new TelemetryStore();
    store.ingestWebSocketFrame('combatlog', [{ killed: true }, { killed: true }]);
    expect(store.kills).toBe(2);

    store.ingestWebSocketFrame('log', { text: 'Nova wave iniciada' });
    expect(store.waves).toBe(1);

    store.ingestWebSocketFrame('state', {
      player: { gold: 500000, stamina: '41:15', level: 250 },
      hunt: 'asura-lair',
    });

    expect(store.gold).toBe(500000);
    expect(store.stamina).toBe('41:15');
    expect(store.level).toBe(250);
    expect(store.hunt).toBe('asura-lair');
    expect(store.getSources().gold).toBe('websocket');
    expect(store.getSources().stamina).toBe('websocket');
  });

  it('parseGoldAmount lê k/kk/m, pt-BR e data-gold sem zerar', () => {
    expect(parseGoldAmount('1.5k')).toBe(1500);
    expect(parseGoldAmount('2,5kk')).toBe(2500000);
    expect(parseGoldAmount('1.234')).toBe(1234);
    expect(parseGoldAmount('1.234.567')).toBe(1234567);
    expect(parseGoldAmount('850k')).toBe(850000);
    expect(parseGoldAmount('12kk')).toBe(12000000);
    expect(parseGoldAmount('')).toBeNull();
    expect(parseGoldAmount(null)).toBeNull();
    const s = new TelemetryStore();
    s.updateGold(5000, 'dom');
    expect(s.gold).toBe(5000);
    // leitura em branco nunca zera saldo conhecido
    s.updateGold('', 'dom');
    expect(s.gold).toBe(5000);
    s.updateGold(0, 'dom');
    expect(s.gold).toBe(5000);
    // sufixo via string funciona
    s.updateGold('2.5k', 'dom');
    expect(s.gold).toBe(2500);
  });

  it('normalizeStamina cobre relógio, XhYm, % e ignora 42:00', () => {
    expect(normalizeStamina('41:15')).toBe('41:15');
    expect(normalizeStamina('38h 15m')).toBe('38:15');
    expect(normalizeStamina('85%')).toBe('85%');
    expect(normalizeStamina('42:00')).toBeNull();
    expect(normalizeStamina('—')).toBeNull();
    expect(normalizeStamina(0.5)).toBe('21:00');
    const s = new TelemetryStore();
    s.updateStamina('38h 15m', 'dom');
    expect(s.stamina).toBe('38:15');
    s.updateStamina('42:00', 'dom');
    expect(s.stamina).toBe('38:15');
  });

  it('ingere hunt/gold de qualquer tipo de frame WS (joined/room/update)', () => {
    const s = new TelemetryStore();
    s.ingestWebSocketFrame('joined', { huntId: 'refiner-cave', gold: 123456 });
    expect(s.hunt).toBe('refiner-cave');
    expect(s.gold).toBe(123456);
    s.ingestWebSocketFrame('update', { player: { stamina: '30:00', level: 120 } });
    expect(s.stamina).toBe('30:00');
    expect(s.level).toBe(120);
  });

  it('gera snapshot com campo sources detalhado', () => {
    const store = new TelemetryStore();
    store.updateHunt('Glooth Bandit', 'dom');
    store.updateLevel(120, 'websocket');

    const snap = store.snapshot({ character: 'sencodtank' });
    expect(snap.character).toBe('sencodtank');
    expect(snap.hunt).toBe('Glooth Bandit');
    expect(snap.level).toBe(120);
    expect(snap.sources.hunt).toBe('dom');
    expect(snap.sources.level).toBe('websocket');
  });
});
