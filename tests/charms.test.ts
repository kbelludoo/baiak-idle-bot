import { describe, it, expect } from 'vitest';
import { charmActions, installCharmAssigner, HUNT_MONSTER } from '../src/term/charms';

const base = { available: 1280, used: 0, limit: 2 };

describe('Charms — atribuição', () => {
  it('atribui charm comprado sem monstro ao monstro da hunt', () => {
    const st = { ...base, slots: { '0': { tier: 1, monsterKey: null } } };
    expect(charmActions(st as any, 'glooth-cave')).toEqual([{ id: 0, monsterKey: 'glooth_bandit' }]);
  });
  it('não toca em charm já atribuído a outro monstro (retarget custa gold)', () => {
    const st = { ...base, slots: { '0': { tier: 2, monsterKey: 'troll' } } };
    expect(charmActions(st as any, 'glooth-cave')).toEqual([]);
  });
  it('não faz nada quando já está no monstro certo ou sem tier', () => {
    expect(charmActions({ ...base, slots: { '0': { tier: 2, monsterKey: 'glooth_bandit' } } } as any, 'glooth-cave')).toEqual([]);
    expect(charmActions({ ...base, slots: { '0': { tier: 0, monsterKey: null } } } as any, 'glooth-cave')).toEqual([]);
  });
  it('ignora hunts sem monstro mapeado', () => {
    expect(charmActions({ ...base, slots: { '0': { tier: 1, monsterKey: null } } } as any, 'hunt-desconhecida')).toEqual([]);
  });
  it('envia charmassign com sinais de presença uma única vez por processo', () => {
    const enviado: any[] = [];
    const sala: any = {
      handlers: {},
      on(t: string, h: any) { (this.handlers as any)[t] = h; },
      send(t: string, p: any) { enviado.push([t, p]); },
    };
    installCharmAssigner(sala, () => 'glooth-cave');
    sala.handlers.__data({ type: 'charms', payload: { ...base, slots: { '0': { tier: 2, monsterKey: null } } } });
    sala.handlers.__data({ type: 'charms', payload: { ...base, slots: { '0': { tier: 2, monsterKey: null } } } });
    const json = JSON.stringify(enviado);
    expect(enviado.filter(([t]) => t === 'charmassign')).toEqual([['charmassign', { id: 0, monsterKey: 'glooth_bandit' }]]);
    expect(json).toContain('visibility');
    expect(json).toContain('cityPresence');
  });
});
