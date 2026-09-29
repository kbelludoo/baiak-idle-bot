/**
 * Módulo de Melhores Itens (Best in Slot - BiS) e Roteiro de Farm do Baiak Idle.
 *
 * Mapeia os melhores equipamentos por vocação e slot, seus atributos exatos
 * e onde farmar (monstro, hunt ou chefe, chance de drop e nível mínimo).
 */

export interface DropSource {
  monster: string;
  sourceType: 'hunt' | 'boss';
  huntId?: string;
  huntName?: string;
  chancePct: number;
  minLevel?: number;
}

export interface EquipmentRecommendation {
  name: string;
  slot: 'weapon' | 'armor' | 'legs' | 'helmet' | 'boots' | 'shield' | 'quiver' | 'ring' | 'amulet';
  vocation: 'paladin' | 'knight' | 'sorcerer' | 'druid' | 'monk' | 'all';
  levelReq: number;
  tierRank: 'BiS' | 'Tier-1' | 'Tier-2' | 'Mid-Game';
  stats: {
    attack?: number;
    defense?: number;
    armor?: number;
    hitChance?: number;
    range?: number;
    skillBonus?: string;
    protection?: string;
    imbueSlots?: number;
  };
  farmLocations: DropSource[];
  summaryNotes: string;
}

export interface FarmingHuntTier {
  bracket: string;
  minLevel: number;
  recommendedHunts: Array<{
    huntId: string;
    name: string;
    focus: 'xp' | 'gold' | 'gear' | 'hybrid';
    keyDrops: string[];
    whyFarmHere: string;
  }>;
}

// ==========================================
// 1. Catálogo dos Melhores Equipamentos (BiS)
// ==========================================

export const BEST_EQUIPMENT_CATALOG: EquipmentRecommendation[] = [
  // ----------------------------------------------------
  // PALADIN (RP)
  // ----------------------------------------------------
  {
    name: 'falcon bow',
    slot: 'weapon',
    vocation: 'paladin',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { attack: 7, range: 6, hitChance: 5, skillBonus: '+2 Distance', protection: '5% Fire', imbueSlots: 3 },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.7 }],
    summaryNotes: 'Melhor arco para hunts de alvo único e rotação elemental rápida.',
  },
  {
    name: 'naga crossbow',
    slot: 'weapon',
    vocation: 'paladin',
    levelReq: 250,
    tierRank: 'BiS',
    stats: { attack: 9, range: 5, hitChance: 4, skillBonus: '+2 Distance', imbueSlots: 3 },
    farmLocations: [{ monster: 'Timira the Many-Headed', sourceType: 'boss', chancePct: 0.8 }],
    summaryNotes: 'Besta de dano bruto supremo com bolts elementais/crítico.',
  },
  {
    name: 'rift crossbow',
    slot: 'weapon',
    vocation: 'paladin',
    levelReq: 120,
    tierRank: 'Tier-1',
    stats: { attack: 5, range: 5, hitChance: 3, imbueSlots: 3 },
    farmLocations: [{ monster: 'Vexclaw', sourceType: 'hunt', huntId: 'vexclaw-lair', huntName: 'Vexclaw Lair', chancePct: 0.37, minLevel: 210 }],
    summaryNotes: 'Excelente besta intermediária acessível direto em hunt normal.',
  },
  {
    name: 'falcon coif',
    slot: 'helmet',
    vocation: 'paladin',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { armor: 10, skillBonus: '+2 Distance, +1 Magic Level', protection: '10% Fire', imbueSlots: 2 },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.7 }],
    summaryNotes: 'Capacete supremo para Paladinos, bônus duplo de dano físico e mágico.',
  },
  {
    name: 'falcon greaves',
    slot: 'legs',
    vocation: 'paladin',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { armor: 10, skillBonus: '+3 Shielding', protection: '7% Physical, 7% Ice' },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.2 }],
    summaryNotes: 'Calça mais defensiva do jogo, mitigação de dano físico pesada.',
  },
  {
    name: 'naga quiver',
    slot: 'quiver',
    vocation: 'paladin',
    levelReq: 250,
    tierRank: 'BiS',
    stats: { armor: 2, skillBonus: '+2 Distance, +1% Physical' },
    farmLocations: [{ monster: 'Timira the Many-Headed', sourceType: 'boss', chancePct: 0.8 }],
    summaryNotes: 'Melhor aljava do jogo, aumenta dano de flechas e bolts.',
  },
  {
    name: 'collar of blue plasma',
    slot: 'amulet',
    vocation: 'paladin',
    levelReq: 150,
    tierRank: 'BiS',
    stats: { armor: 3, skillBonus: '+4 Distance, +2% Crit Damage' },
    farmLocations: [{ monster: "Paladin's Apparition", sourceType: 'hunt', huntId: 'darkthais-cave', huntName: 'Dark Thais', chancePct: 1.56, minLevel: 800 }],
    summaryNotes: 'Colar de plasma que concede grande aumento de DPS para Paladinos.',
  },
  {
    name: 'ring of blue plasma',
    slot: 'ring',
    vocation: 'paladin',
    levelReq: 100,
    tierRank: 'BiS',
    stats: { skillBonus: '+3 Distance, +1% Crit Chance' },
    farmLocations: [
      { monster: 'Raubritter Marksman', sourceType: 'hunt', huntId: 'raubritter-lair', huntName: 'Raubritter Lair', chancePct: 0.52, minLevel: 250 },
      { monster: "Sorcerer's Apparition", sourceType: 'hunt', huntId: 'darkthais-cave', huntName: 'Dark Thais', chancePct: 3.83, minLevel: 800 },
    ],
    summaryNotes: 'Anel de plasma azul, farmável em Raubritter e Dark Thais.',
  },

  // ----------------------------------------------------
  // KNIGHT (EK)
  // ----------------------------------------------------
  {
    name: 'falcon longsword',
    slot: 'weapon',
    vocation: 'knight',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { attack: 56, defense: 34, skillBonus: '+2 Sword', protection: '7% Earth', imbueSlots: 3 },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.5 }],
    summaryNotes: 'Espada de duas mãos com maior ataque do jogo.',
  },
  {
    name: 'falcon battleaxe',
    slot: 'weapon',
    vocation: 'knight',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { attack: 56, defense: 33, skillBonus: '+2 Axe', protection: '7% Fire', imbueSlots: 3 },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.5 }],
    summaryNotes: 'Machado lendário de duas mãos com dano devastador em área.',
  },
  {
    name: 'falcon mace',
    slot: 'weapon',
    vocation: 'knight',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { attack: 56, defense: 34, skillBonus: '+2 Club', protection: '7% Energy', imbueSlots: 3 },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.5 }],
    summaryNotes: 'Clava lendária com maior dano contundente e absorção de energia.',
  },
  {
    name: 'falcon plate',
    slot: 'armor',
    vocation: 'knight',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { armor: 18, skillBonus: '+4 Shielding', protection: '12% Physical', imbueSlots: 2 },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.4 }],
    summaryNotes: 'Armadura suprema de Knight, 12% de proteção física reduz dano das maiores waves.',
  },
  {
    name: 'cobra sword',
    slot: 'weapon',
    vocation: 'knight',
    levelReq: 220,
    tierRank: 'Tier-1',
    stats: { attack: 52, defense: 33, skillBonus: '+2 Sword, +3% Life Leech', imbueSlots: 2 },
    farmLocations: [{ monster: 'Scarlett Etzel', sourceType: 'boss', chancePct: 1.3 }],
    summaryNotes: 'Espada de 1 mão com life leech nativo embutido.',
  },
  {
    name: 'falcon shield',
    slot: 'shield',
    vocation: 'knight',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { defense: 39, protection: '7% Fire, 3% Physical' },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.4 }],
    summaryNotes: 'Escudo supremo com defesa 39 e proteção mista.',
  },
  {
    name: 'collar of red plasma',
    slot: 'amulet',
    vocation: 'knight',
    levelReq: 150,
    tierRank: 'BiS',
    stats: { armor: 4, skillBonus: '+4 Melee, +2% Physical' },
    farmLocations: [{ monster: "Druid's Apparition", sourceType: 'hunt', huntId: 'darkthais-cave', huntName: 'Dark Thais', chancePct: 0.55, minLevel: 800 }],
    summaryNotes: 'Colar de plasma vermelho focado em dano melee e defesa bruta.',
  },
  {
    name: 'ring of red plasma',
    slot: 'ring',
    vocation: 'knight',
    levelReq: 100,
    tierRank: 'BiS',
    stats: { skillBonus: '+3 Melee, +1% Physical' },
    farmLocations: [
      { monster: 'Raubritter Skirmisher', sourceType: 'hunt', huntId: 'raubritter-lair', huntName: 'Raubritter Lair', chancePct: 0.12, minLevel: 250 },
      { monster: "Sorcerer's Apparition", sourceType: 'hunt', huntId: 'darkthais-cave', huntName: 'Dark Thais', chancePct: 5.46, minLevel: 800 },
    ],
    summaryNotes: 'Anel de plasma vermelho, farmável em Raubritter e Dark Thais.',
  },

  // ----------------------------------------------------
  // MAGES (Sorcerer & Druid)
  // ----------------------------------------------------
  {
    name: 'falcon wand',
    slot: 'weapon',
    vocation: 'sorcerer',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { skillBonus: '+5 Magic Level, +4% Spell Dmg', protection: '5% Energy', imbueSlots: 2 },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.7 }],
    summaryNotes: 'Varinha lendária para Sorcerer com bônus de +5 ML.',
  },
  {
    name: 'falcon rod',
    slot: 'weapon',
    vocation: 'druid',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { skillBonus: '+5 Magic Level, +4% Healing', protection: '5% Ice', imbueSlots: 2 },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.7 }],
    summaryNotes: 'Vara lendária para Druid, potencializa cura e dano de gelo/terra.',
  },
  {
    name: 'falcon circlet',
    slot: 'helmet',
    vocation: 'sorcerer',
    levelReq: 300,
    tierRank: 'BiS',
    stats: { armor: 7, skillBonus: '+4 Magic Level', protection: '5% Fire', imbueSlots: 2 },
    farmLocations: [{ monster: 'Grand Master Oberon', sourceType: 'boss', chancePct: 0.7 }],
    summaryNotes: 'Diadema que eleva drasticamente o poder de fogo mágico.',
  },
  {
    name: 'collar of green plasma',
    slot: 'amulet',
    vocation: 'sorcerer',
    levelReq: 150,
    tierRank: 'BiS',
    stats: { armor: 2, skillBonus: '+4 Magic Level, +3% Mana' },
    farmLocations: [{ monster: "Sorcerer's Apparition", sourceType: 'hunt', huntId: 'darkthais-cave', huntName: 'Dark Thais', chancePct: 2.19, minLevel: 800 }],
    summaryNotes: 'Colar de plasma verde, acelera o escalonamento de spells de área.',
  },
  {
    name: 'ring of green plasma',
    slot: 'ring',
    vocation: 'sorcerer',
    levelReq: 100,
    tierRank: 'BiS',
    stats: { skillBonus: '+3 Magic Level' },
    farmLocations: [
      { monster: 'Raubritter Chastener', sourceType: 'hunt', huntId: 'raubritter-lair', huntName: 'Raubritter Lair', chancePct: 0.58, minLevel: 250 },
      { monster: "Sorcerer's Apparition", sourceType: 'hunt', huntId: 'darkthais-cave', huntName: 'Dark Thais', chancePct: 4.36, minLevel: 800 },
    ],
    summaryNotes: 'Anel farmável de fácil renovação que concede +3 ML direto.',
  },

  // ----------------------------------------------------
  // ITENS GERAIS ACESSÍVEIS EM HUNTS NORMAIS (MID-GAME)
  // ----------------------------------------------------
  {
    name: 'magic plate armor',
    slot: 'armor',
    vocation: 'all',
    levelReq: 100,
    tierRank: 'Mid-Game',
    stats: { armor: 17 },
    farmLocations: [
      { monster: 'Vexclaw', sourceType: 'hunt', huntId: 'vexclaw-lair', huntName: 'Vexclaw Lair', chancePct: 0.07, minLevel: 210 },
      { monster: 'Rage Squid', sourceType: 'hunt', huntId: 'livrariafire-cave', huntName: 'Livraria Fire', chancePct: 0.15, minLevel: 500 },
    ],
    summaryNotes: 'Armadura clássica intermediária com alta defesa bruta.',
  },
  {
    name: 'skullcracker armor',
    slot: 'armor',
    vocation: 'all',
    levelReq: 85,
    tierRank: 'Mid-Game',
    stats: { armor: 14, protection: '5% Physical' },
    farmLocations: [
      { monster: 'Midnight Asura', sourceType: 'hunt', huntId: 'asura-lair', huntName: 'Asuras', chancePct: 0.18, minLevel: 150 },
      { monster: 'Grim Reaper', sourceType: 'hunt', huntId: 'grimreaper-cave', huntName: 'Grim Reaper', chancePct: 0.27, minLevel: 130 },
      { monster: 'Undead Dragon', sourceType: 'hunt', huntId: 'undeadragon-lair', huntName: 'Undead Dragon', chancePct: 0.29, minLevel: 200 },
    ],
    summaryNotes: 'Armadura excelente para mid-game com redução física de 5%.',
  },
  {
    name: 'assassin star',
    slot: 'weapon',
    vocation: 'paladin',
    levelReq: 80,
    tierRank: 'Mid-Game',
    stats: { attack: 65, range: 4, hitChance: 0 },
    farmLocations: [
      { monster: 'Undead Dragon', sourceType: 'hunt', huntId: 'undeadragon-lair', huntName: 'Undead Dragon', chancePct: 26.65, minLevel: 200 },
      { monster: 'Hellspawn', sourceType: 'hunt', huntId: 'asura-lair', huntName: 'Asuras', chancePct: 9.09, minLevel: 150 },
    ],
    summaryNotes: 'Munição de arremesso com ataque 65, dropa em grande volume em Undead Dragon e Asuras.',
  },
  {
    name: 'terra mantle',
    slot: 'armor',
    vocation: 'all',
    levelReq: 50,
    tierRank: 'Mid-Game',
    stats: { armor: 11, protection: '8% Earth, -8% Fire' },
    farmLocations: [{ monster: 'Glooth Brigand', sourceType: 'hunt', huntId: 'glooth-cave', huntName: 'Glooth Bandit', chancePct: 1.0, minLevel: 90 }],
    summaryNotes: 'Equipamento essencial de terra para hunts intermediárias.',
  },
  {
    name: 'terra legs',
    slot: 'legs',
    vocation: 'all',
    levelReq: 40,
    tierRank: 'Mid-Game',
    stats: { armor: 8, protection: '7% Earth, -7% Fire' },
    farmLocations: [{ monster: 'Glooth Bandit', sourceType: 'hunt', huntId: 'glooth-cave', huntName: 'Glooth Bandit', chancePct: 0.5, minLevel: 90 }],
    summaryNotes: 'Calça de terra de fácil obtenção em Glooth Bandit.',
  },
];

// ==========================================
// 2. Roteiro e Fases de Farm por Nível
// ==========================================

export const RECOMMENDED_FARMING_ROADMAP: FarmingHuntTier[] = [
  {
    bracket: 'Nível 1 a 50 (Início e Estabilização)',
    minLevel: 1,
    recommendedHunts: [
      {
        huntId: 'troll-cave',
        name: 'Troll Cave',
        focus: 'gold',
        keyDrops: ['spear', 'wooden shield', 'gold coin'],
        whyFarmHere: 'Garante o primeiro estoque de spears e ouro sem risco de morte.',
      },
      {
        huntId: 'corym-cave',
        name: 'Corym Skirmisher',
        focus: 'hybrid',
        keyDrops: ['spiked squelcher', 'leather armor', 'corym eyes'],
        whyFarmHere: 'Subida rápida de nível inicial com excelente taxa de gold/kill.',
      },
    ],
  },
  {
    bracket: 'Nível 50 a 130 (Farm de Ouro e Sustentação)',
    minLevel: 50,
    recommendedHunts: [
      {
        huntId: 'glooth-cave',
        name: 'Glooth Bandit',
        focus: 'gold',
        keyDrops: ['terra mantle', 'terra legs', 'terra boots', 'glooth cape', 'butcher axe'],
        whyFarmHere: 'Melhor hunt do jogo para fazer ouro consistente (~1.2kk a 1.8kk gold/h).',
      },
      {
        huntId: 'dragon-lair',
        name: 'Dragon Lair',
        focus: 'xp',
        keyDrops: ['dragon slayer', 'dragon shield', 'wand of cosmic energy', 'royal helmet'],
        whyFarmHere: 'Excelente ganho de experiência e equips intermediários.',
      },
    ],
  },
  {
    bracket: 'Nível 130 a 250 (Transição para Endgame)',
    minLevel: 130,
    recommendedHunts: [
      {
        huntId: 'asura-lair',
        name: 'Asuras',
        focus: 'xp',
        keyDrops: ['assassin star', 'skullcracker armor', 'oriental shoes', 'spellbook of mind control'],
        whyFarmHere: 'Maior taxa de XP/h nesta faixa de nível (2.5kk+ XP/h) com drop massivo de assassin stars.',
      },
      {
        huntId: 'grimreaper-cave',
        name: 'Grim Reaper',
        focus: 'xp',
        keyDrops: ['nightmare blade', 'skullcracker armor', 'glacier kilt', 'demonbone amulet'],
        whyFarmHere: 'Dano físico e de morte elevado com grandes pacotes de experiência.',
      },
      {
        huntId: 'undeadragon-lair',
        name: 'Undead Dragon',
        focus: 'gear',
        keyDrops: ['assassin star (26%)', 'divine plate', 'royal helmet', 'war axe', 'golden armor'],
        whyFarmHere: 'Melhor local para farmar assassin stars em grande escala para Paladinos.',
      },
    ],
  },
  {
    bracket: 'Nível 210 a 350 (Acessórios de Plasma e Armas Tier-1)',
    minLevel: 210,
    recommendedHunts: [
      {
        huntId: 'vexclaw-lair',
        name: 'Vexclaw Lair',
        focus: 'gear',
        keyDrops: ['rift crossbow', 'rift bow', 'magic plate armor', 'golden legs', 'rift shield'],
        whyFarmHere: 'Hunt com armas Rift e armaduras pesadas dropáveis em monstros comuns.',
      },
      {
        huntId: 'raubritter-lair',
        name: 'Raubritter Lair',
        focus: 'gear',
        keyDrops: ['ring of blue plasma', 'ring of green plasma', 'ring of red plasma', 'shockwave amulet'],
        whyFarmHere: 'Fonte contínua de anéis de plasma para todas as vocações (Paladin, Knight, Mage).',
      },
      {
        huntId: 'cobra-cave',
        name: 'Cobra Bastion',
        focus: 'hybrid',
        keyDrops: ['cobra crest', 'cobra boots', 'cobra sword', 'cobra crossbow'],
        whyFarmHere: 'Desbloqueia os itens de Cobra e materiais para forja avançada.',
      },
    ],
  },
  {
    bracket: 'Nível 350+ (Endgame, Biblioteca e Dark Thais)',
    minLevel: 350,
    recommendedHunts: [
      {
        huntId: 'livrariaice-cave',
        name: 'Secret Library (Ice / Fire)',
        focus: 'xp',
        keyDrops: ['crystalline armor', 'glacier robe', 'sacred tree amulet', 'magic plate armor'],
        whyFarmHere: 'XP extrema e drops raros de alto valor de mercado.',
      },
      {
        huntId: 'darkthais-cave',
        name: 'Dark Thais',
        focus: 'gear',
        keyDrops: ['collar of blue plasma', 'collar of red plasma', 'collar of green plasma', 'rings de plasma'],
        whyFarmHere: 'Melhor hunt para farmar os colares de plasma BiS de todas as vocações.',
      },
    ],
  },
];

// ==========================================
// 3. Funções Auxiliares de Consulta
// ==========================================

/**
 * Retorna os melhores itens recomendados para uma vocação específica,
 * opcionalmente filtrados pelo nível máximo do personagem.
 */
export function getRecommendedGear(vocation: 'paladin' | 'knight' | 'sorcerer' | 'druid' | 'monk', maxLevel = 3000) {
  const v = vocation.toLowerCase();
  return BEST_EQUIPMENT_CATALOG.filter(
    (item) => (item.vocation === v || item.vocation === 'all') && item.levelReq <= maxLevel,
  ).sort((a, b) => b.levelReq - a.levelReq);
}

/**
 * Retorna o melhor item por slot para a vocação e nível especificados.
 */
export function getBestInSlotBySlot(vocation: 'paladin' | 'knight' | 'sorcerer' | 'druid' | 'monk', maxLevel = 3000) {
  const items = getRecommendedGear(vocation, maxLevel);
  const bySlot: Record<string, EquipmentRecommendation> = {};
  for (const it of items) {
    if (!bySlot[it.slot] || it.levelReq > bySlot[it.slot].levelReq) {
      bySlot[it.slot] = it;
    }
  }
  return bySlot;
}

/**
 * Retorna a fase de farm recomendada para o nível atual do jogador.
 */
export function getFarmingRecommendationForLevel(level: number): FarmingHuntTier {
  const l = Math.max(1, Math.floor(level));
  for (let i = RECOMMENDED_FARMING_ROADMAP.length - 1; i >= 0; i--) {
    if (l >= RECOMMENDED_FARMING_ROADMAP[i].minLevel) {
      return RECOMMENDED_FARMING_ROADMAP[i];
    }
  }
  return RECOMMENDED_FARMING_ROADMAP[0];
}
