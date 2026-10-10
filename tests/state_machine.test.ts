import { describe, expect, it } from 'bun:test';
import {
  ActionQueue,
  evaluateStaminaTransition,
  staminaIs100Pct,
  staminaIsBelow50Pct,
  staminaToMinutes
} from '../src/state_machine';

describe('State Machine & Stamina Transitions', () => {
  it('converte stamina em formato relógio e percentual com precisão', () => {
    // 42:00 é placeholder pré-sync do HUD — desconhecido, nunca força treino/hunt
    expect(staminaToMinutes('42:00')).toBeNull();
    expect(staminaToMinutes('06:00')).toBe(360);
    expect(staminaToMinutes('100%')).toBe(2520);
    expect(staminaToMinutes('50%')).toBe(1260);
    expect(staminaToMinutes('15%')).toBe(378);
    expect(staminaToMinutes('—')).toBeNull();
  });

  it('converte formatos estendidos do jogo (Xh Ym, HH:MM:SS, minutos)', () => {
    expect(staminaToMinutes('38h 15m')).toBe(2295);
    expect(staminaToMinutes('41:15:00')).toBe(2475);
    expect(staminaToMinutes('12h')).toBe(720);
    expect(staminaToMinutes('Stamina 06:18 restante')).toBe(378);
    expect(staminaToMinutes('2520')).toBeNull(); // == 42:00 placeholder
    expect(staminaToMinutes('0:00')).toBe(0);
  });

  it('placeholder desconhecido nunca força treino', () => {
    expect(evaluateStaminaTransition('42:00', false, true).action).toBe('continue_hunt');
    expect(evaluateStaminaTransition('—', false, true).action).toBe('continue_hunt');
  });

  it('detecta corretamente stamina <= 50%', () => {
    expect(staminaIsBelow50Pct('06:18')).toBe(true); // 378 min = 15%
    expect(staminaIsBelow50Pct('15%')).toBe(true);
    expect(staminaIsBelow50Pct('21:00')).toBe(true); // 1260 min = 50%
    expect(staminaIsBelow50Pct('50%')).toBe(true);
    expect(staminaIsBelow50Pct('21:01')).toBe(false); // 1261 min > 50%
    expect(staminaIsBelow50Pct('60%')).toBe(false);
    expect(staminaIsBelow50Pct('0:00')).toBe(true);
  });

  it('detecta corretamente stamina == 100%', () => {
    expect(staminaIs100Pct('42:00')).toBe(true); // stamina cheia do HUD
    expect(staminaIs100Pct('100%')).toBe(true);
    expect(staminaIs100Pct('41:59')).toBe(false);
    expect(staminaIs100Pct('90%')).toBe(false);
    expect(staminaIs100Pct('0:00')).toBe(false);
  });

  it('transição: stamina > 50% continua caçando', () => {
    const res = evaluateStaminaTransition('30:00', false, true);
    expect(res.action).toBe('continue_hunt');
  });

  it('transição: stamina <= 50% vai para Treino Online', () => {
    expect(evaluateStaminaTransition('20:00', false, true).action).toBe('enter_treino');
    expect(evaluateStaminaTransition('05:30', false, true).action).toBe('enter_treino');
    expect(evaluateStaminaTransition('0:00', false, true).action).toBe('enter_treino');
  });

  it('transição: recuperando stamina no treino (abaixo de 100%) permanece no treino', () => {
    expect(evaluateStaminaTransition('20:00', true, true).action).toBe('stay_in_treino');
    expect(evaluateStaminaTransition('36:00', true, true).action).toBe('stay_in_treino');
    expect(evaluateStaminaTransition('90%', true, true).action).toBe('stay_in_treino');
  });

  it('transição: stamina 100% sai do treino e retoma hunts', () => {
    expect(evaluateStaminaTransition('100%', true, true).action).toBe('resume_hunt');
    expect(evaluateStaminaTransition('42:00', true, true).action).toBe('resume_hunt');
  });

  it('ActionQueue executa tarefas por prioridade e não trava com timeout', async () => {
    const queue = new ActionQueue();
    const executed: string[] = [];

    queue.enqueue({
      id: '1',
      name: 'equip',
      priority: 1,
      timeoutMs: 100,
      run: async () => {
        executed.push('equip');
      },
    });

    queue.enqueue({
      id: '2',
      name: 'hunt',
      priority: 10, // Maior prioridade deve rodar primeiro
      timeoutMs: 100,
      run: async () => {
        executed.push('hunt');
      },
    });

    // Tarefa com timeout simulado
    queue.enqueue({
      id: '3',
      name: 'timeout_action',
      priority: 5,
      timeoutMs: 50,
      run: () => new Promise(r => setTimeout(r, 200)),
    });

    await new Promise(r => setTimeout(r, 150));
    expect(executed).toEqual(['hunt', 'equip']);
    expect(queue.pendingCount).toBe(0);
  });
});
