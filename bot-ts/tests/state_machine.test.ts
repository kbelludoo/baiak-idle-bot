import { describe, expect, it } from 'bun:test';
import {
  ActionQueue,
  evaluateStaminaTransition,
  staminaIsAbove85Pct,
  staminaIsBelow15Pct,
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

  it('detecta corretamente stamina <= 15%', () => {
    expect(staminaIsBelow15Pct('06:18')).toBe(true); // 378 min = 15%
    expect(staminaIsBelow15Pct('05:00')).toBe(true);
    expect(staminaIsBelow15Pct('15%')).toBe(true);
    expect(staminaIsBelow15Pct('10%')).toBe(true);
    expect(staminaIsBelow15Pct('07:00')).toBe(false); // 420 min > 15%
    expect(staminaIsBelow15Pct('20%')).toBe(false);
  });

  it('detecta corretamente stamina >= 85%', () => {
    expect(staminaIsAbove85Pct('35:42')).toBe(true); // 2142 min = 85%
    expect(staminaIsAbove85Pct('40:00')).toBe(true);
    expect(staminaIsAbove85Pct('85%')).toBe(true);
    expect(staminaIsAbove85Pct('90%')).toBe(true);
    expect(staminaIsAbove85Pct('30:00')).toBe(false);
    expect(staminaIsAbove85Pct('80%')).toBe(false);
  });

  it('transição: stamina > 15% continua caçando', () => {
    const res = evaluateStaminaTransition('30:00', false, true);
    expect(res.action).toBe('continue_hunt');
  });

  it('transição: stamina <= 15% vai para Treino Online', () => {
    const res = evaluateStaminaTransition('05:30', false, true);
    expect(res.action).toBe('enter_treino');
  });

  it('transição: recuperando stamina no treino (entre 15% e 85%) permanece no treino', () => {
    const res = evaluateStaminaTransition('20:00', true, true);
    expect(res.action).toBe('stay_in_treino');
  });

  it('transição: stamina >= 85% sai do treino e retoma hunts', () => {
    const res = evaluateStaminaTransition('36:00', true, true);
    expect(res.action).toBe('resume_hunt');
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
