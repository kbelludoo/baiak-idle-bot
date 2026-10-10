import { describe, expect, it } from 'bun:test';
import {
  SPELL_CATALOG,
  attacksFor,
  healsFor,
  pickHealSpell,
  pickPotions,
} from '../src/term/spell_catalog';
import { buildPlan, applyPlan, getRecommendedRotation, melhorPocaoBiS } from '../src/term/autoconfig';
import { HP_POTIONS, MANA_POTIONS } from '../src/term/spell_catalog';
import { partySlotsFor } from '../src/term/hunter';

describe('catálogo de magias e poções', () => {
  it('knight lvl 1 cura com a spell de nível 1; lvl 8 sobe para exura ico', () => {
    expect(pickHealSpell('knight', 1)?.words).toBe('exura infir ico');
    expect(pickHealSpell('knight', 8)?.words).toBe('exura ico');
  });

  it('pickHealSpell nunca devolve runa (o catálogo tem adura gran/vita como heal)', () => {
    const candidates = healsFor('sorcerer', 30);
    expect(candidates.some((s) => s.words === 'adura gran' || s.words === 'adura vita')).toBe(true);
    const picked = pickHealSpell('sorcerer', 30);
    expect(picked).not.toBeNull();
    expect(picked!.words.startsWith('adura')).toBe(false);
    expect(picked!.words.startsWith('adori')).toBe(false);
  });

  it('runas não são magia de ataque: attacksFor só devolve strike/area', () => {
    const attacks = attacksFor('druid', 100);
    expect(attacks.length).toBeGreaterThan(4);
    expect(attacks.every((s) => s.type === 'strike' || s.type === 'area')).toBe(true);
    expect(attacks.some((s) => s.words.startsWith('adori') || s.words.startsWith('adura'))).toBe(false);
    expect(attacks.every((s) => s.level <= 100 && s.vocs.includes('druid'))).toBe(true);
  });

  it('poção BiS respeita nível e vocação', () => {
    expect(melhorPocaoBiS(HP_POTIONS, 'knight', 200, 'hp')).toBe('supreme health potion');
    expect(melhorPocaoBiS(HP_POTIONS, 'paladin', 10, 'hp')).toBe('health potion');
    expect(melhorPocaoBiS(HP_POTIONS, 'druid', 200, 'hp')).toBe('health potion'); // sem poção de druid acima
    expect(melhorPocaoBiS(MANA_POTIONS, 'knight', 1, 'mana')).toBeTruthy();
  });

  it('pickPotions devolve hp e mana usáveis no nível', () => {
    const low = pickPotions('paladin', 1);
    expect(low.hp?.name).toBe('health potion');
    expect(low.mana?.name).toBe('mana potion');
    const high = pickPotions('paladin', 200);
    expect(high.hp!.minLevel).toBeLessThanOrEqual(200);
    expect(high.hp!.vocs ?? ['paladin']).toContain('paladin');
  });
});

describe('rotação recomendada por vocação', () => {
  it('todas as vocações fecham 4 slots de rotação', () => {
    for (const voc of ['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as const) {
      for (const level of [10, 40, 70, 100]) {
        const rot = getRecommendedRotation(voc, level);
        expect(rot.length).toBeGreaterThan(0);
        expect(rot.every(Boolean)).toBe(true);
      }
    }
  });

  it('nível alto não cai em magia fraca (infir); nível baixo pode (é o que existe)', () => {
    for (const voc of ['knight', 'paladin', 'sorcerer', 'druid', 'monk'] as const) {
      expect(getRecommendedRotation(voc, 100).some((w) => w.includes('infir'))).toBe(false);
    }
    // monk/druid de nível baixo só têm as infir no catálogo
    expect(getRecommendedRotation('monk', 10).some((w) => w.includes('infir'))).toBe(true);
  });

  it('knight de alto nível prioriza as áreas (exori gran/ exori/ exori min)', () => {
    const rot = getRecommendedRotation('knight', 95);
    expect(rot.slice(0, 3)).toEqual(['exori gran', 'exori', 'exori min']);
  });

  it('paladin alto nível abre com exevo mas san', () => {
    expect(getRecommendedRotation('paladin', 75)[0]).toBe('exevo mas san');
  });
});

describe('buildPlan (config de rotação/cura/poções)', () => {
  const char = (over: any = {}) => ({
    name: 'Sofisico',
    vocation: 'monk',
    level: 100,
    state: {},
    ...over,
  });

  it('fecha 4 magias, escolhe cura e poções e marca o slot', () => {
    const plan = buildPlan(char(), 2);
    expect(plan.charSlot).toBe(2);
    expect(plan.vocation).toBe('monk');
    expect(plan.rotation).toHaveLength(4);
    expect(plan.rotation.every(Boolean)).toBe(true);
    expect(plan.healSpell).toBeTruthy();
    expect(plan.hpPotion).toBeTruthy();
    expect(plan.manaPotion).toBeTruthy();
    expect(Array.isArray(plan.notes)).toBe(true);
    expect(Object.keys(plan.minMobs).every((w) => plan.rotation.includes(w))).toBe(true);
  });

  it('knight usa poção de mana (o array do jogo não restringe a vocação) e respeita o nível', () => {
    // bundle: {name:"distilled superior mana potion",minLevel:100,mana:550} sem `vocs`
    // e Ege=(e,t)=>!e.vocs||e.vocs.includes(t) -> knight pode usar.
    const plan = buildPlan(char({ vocation: 'knight', name: 'sencodtank', level: 120 }), 1);
    expect(plan.manaPotion).toBe('distilled superior mana potion');
    expect(plan.manaBelow).toBe(42);
    expect(plan.hpPotion).toBeTruthy();
    // poções com `vocs` explícito continuam fora do knight...
    expect(buildPlan(char({ vocation: 'knight', level: 90 }), 1).manaPotion).toBe('great mana potion');
    // ...e o de topo do knight é o distilled ultimate (o ultimate puro é só de mage).
    expect(buildPlan(char({ vocation: 'knight', level: 200 }), 1).manaPotion).toBe('distilled ultimate mana potion');
    expect(buildPlan(char({ vocation: 'sorcerer', level: 200 }), 1).manaPotion).toBe('ultimate mana potion');
  });

  it('preserva a rotação personalizada válida do jogador (sem magia fraca)', () => {
    const custom = ['exori mas pug', 'exori mas nia', 'exori amp pug', 'exori pug'];
    const plan = buildPlan(char({ state: { rotation: custom } }), 2);
    expect(plan.rotation).toEqual(custom);
    expect(plan.notes.some((n) => n.includes('rota'))).toBe(false);
  });

  it('troca a rotação quando ela tem magia fraca (infir)', () => {
    const fraca = ['exori infir pug', 'exori infir nia', 'exori mas pug', 'exori mas nia'];
    const plan = buildPlan(char({ state: { rotation: fraca } }), 2);
    expect(plan.rotation.some((w) => w.includes('infir'))).toBe(false);
    expect(plan.rotation).toHaveLength(4);
  });

  it('nota na troca de cura quando o jogador está com cura errada', () => {
    const plan = buildPlan(char({ state: { helper: { healSpell: 'exura' } } }), 0);
    expect(plan.notes.some((n) => n.includes('healSpell'))).toBe(true);
  });
});

describe('applyPlan envia os payloads na ordem do jogo', () => {
  it('helper + rotation + minmobs + potions com o slot certo', () => {
    const sent: Array<{ type: string; payload: any }> = [];
    const room: any = { send: (type: string, payload: any) => { sent.push({ type, payload }); return true; } };
    const plan = buildPlan({ name: 'Secondpally', vocation: 'paladin', level: 120, state: {} }, 0);
    applyPlan(room, plan, { healEnabled: false }, () => {});

    const byType = (t: string) => sent.filter((s) => s.type === t);
    expect(byType('helper')).toHaveLength(1);
    expect(byType('helper')[0].payload.slot).toBe(0);
    expect(byType('helper')[0].payload.cfg.healEnabled).toBe(true);
    expect(byType('helper')[0].payload.cfg.healSpell).toBe(plan.healSpell);

    expect(byType('rotation')).toHaveLength(1);
    expect(byType('rotation')[0].payload).toEqual({ slot: 0, spells: plan.rotation });

    const pots = byType('potion');
    expect(pots).toHaveLength(2);
    expect(pots.map((p) => p.payload.kind).sort()).toEqual(['hp', 'mana']);
    expect(pots.every((p) => p.payload.slot === 0)).toBe(true);

    for (const m of byType('spellminmobs')) {
      expect(m.payload.slot).toBe(0);
      expect(plan.rotation).toContain(m.payload.words);
      expect(m.payload.minMobs).toBeGreaterThanOrEqual(2);
    }
    expect(sent.every((s) => s.payload.slot === 0)).toBe(true);
  });
});

describe('slots da party para equip/config', () => {
  const chars = [
    { id: 1, name: 'Secondpally', vocation: 'paladin', level: 120 },
    { id: 2, name: 'sencodtank', vocation: 'knight', level: 120 },
    { id: 3, name: 'Sofisico', vocation: 'monk', level: 120 },
  ];
  const meu = { id: 9, name: 'Qualquer', vocation: 'druid', level: 10 };

  it('usa o mapa fixo da conta quando o nome casa', () => {
    const out = partySlotsFor(chars as any, meu as any);
    expect(out.map((c) => c.slot)).toEqual([0, 1, 2]);
  });

  it('sem personagens cacheados usa o próprio personagem', () => {
    const out = partySlotsFor([] as any, meu as any);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Qualquer');
    expect(typeof out[0].slot).toBe('number');
  });

  it('nomes fora do mapa caem na posição da lista (não somem)', () => {
    const desconhecidos = [
      { id: 5, name: 'Alice', vocation: 'druid', level: 10 },
      { id: 6, name: 'Bob', vocation: 'knight', level: 10 },
    ] as any;
    const out = partySlotsFor(desconhecidos, meu as any);
    expect(out.map((c) => c.slot)).toEqual([0, 1]);
  });

  it('personagem duplicado não reusa o mesmo slot', () => {
    const dup = [
      { id: 5, name: 'Alice', vocation: 'druid', level: 10 },
      { id: 6, name: 'Alice', vocation: 'druid', level: 10 },
    ] as any;
    const out = partySlotsFor(dup, meu as any);
    expect(new Set(out.map((c) => c.slot)).size).toBe(2);
  });
});

describe('contrato do catálogo', () => {
  it('toda magia de heal tem cura ou é runa conhecida', () => {
    const heals = SPELL_CATALOG.filter((s) => s.type === 'heal' && s.healTarget !== 'friend');
    expect(heals.length).toBeGreaterThan(10);
    expect(heals.every((s) => s.words && s.vocs.length > 0 && s.level > 0)).toBe(true);
  });
});
