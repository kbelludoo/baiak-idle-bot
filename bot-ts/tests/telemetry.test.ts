import { describe, expect, it } from 'bun:test';
import { TelemetryStore } from '../src/telemetry';

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
