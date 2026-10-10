/**
 * Atribuição automática de charms ("Charms" = bônus por monstro).
 *
 * Aprendizado empírico (2026-10-06, sessão headless na VPS):
 *  - o frame S->C \`charms\` chega sozinho no início da sessão e depois de cada
 *    \`charmassign\`/\`charmbuy\`: {slots:{<id>:{tier,monsterKey}}, spent, available, limit, used...};
 *  - o gate de presença humana do \`charmassign\` (At(), L46) é CLIENTE-side; o
 *    servidor aceita a mensagem direta do terminal — enviamos mesmo assim
 *    \`visibility{hidden:false}\` + \`cityPresence{away:false}\` antes, por higiene;
 *  - atribuir é GRÁTIS; REMOVER custa gold ("retarget não é grátis") — por isso
 *    o driver NÃO retargeta: só atribui quando \`monsterKey === null\`;
 *  - o monsterKey é a chave do bestiário sem o prefixo \`bst:\` (ex.: o catálogo
 *    d3e faz \`c.slice(4)\`), e charm major só vale em monstro com bestiário cheio.
 *
 * Catálogo em src/term/talent_data... não: angariado em _charms.json/index.js:
 *  id 0 Wound (major, físico, chance [5,10,11]%, points [240,360,1200]).
 */

import type { Room } from './colyseus';

export interface CharmState {
  slots: Record<string, { tier: number; monsterKey: string | null }>;
  available: number;
  used: number;
  limit: number;
}

/** Monstro principal (chave do bestiário) por hunt — amplie conforme for preciso. */
export const HUNT_MONSTER: Record<string, string> = {
  'glooth-cave': 'glooth_bandit',
  'troll-cave': 'troll',
  'amazon-camp': 'amazon',
  'corym-cave': 'corym_skirmisher',
  'cyclopolis': 'cyclops',
  'dragon-lair': 'dragon',
  'elf-lair': 'elf_scout',
  'minotaur': 'minotaur',
  'kongra': 'kongra',
  'refiner-cave': 'stonerefiner',
  'crawler-cave': 'crawler',
  'giant-spider': 'giant_spider',
};

const sent = new Map<string, number>(); // monsterKey:id -> at

/** Se o servidor nao confirmar a atribuicao, permite nova tentativa apos este TTL. */
export const CHARM_RETRY_MS = 10 * 60_000;

/** Analisa o frame charms e devolve o que falta atribuir para a hunt atual. */
export function charmActions(state: CharmState, huntId: string): Array<{ id: number; monsterKey: string }> {
  const monster = HUNT_MONSTER[huntId];
  if (!monster) return [];
  const out: Array<{ id: number; monsterKey: string }> = [];
  for (const [idStr, slot] of Object.entries(state.slots ?? {})) {
    const tier = Number(slot?.tier ?? 0);
    if (tier < 1) continue;                       // precisa Tier 1 comprado
    const alvo = slot?.monsterKey ?? null;
    if (alvo && alvo !== monster) continue;       // já atribuído a outro — retarget custa gold
    if (alvo === monster) continue;               // já certo
    out.push({ id: Number(idStr), monsterKey: monster });
  }
  return out;
}

/**
 * Instala o gancho no stream de frames da sala: quando o frame \`charms\` indica um
 * charm comprado e sem monstro, atribui ao monstro principal da hunt atual.
 * Idempotente dentro do processo (\`sent\`).
 */
export function installCharmAssigner(
  room: Room,
  getHunt: () => string,
  log: (msg: string) => void = () => {},
): void {
  room.on('__data', (frame: any) => {
    if (String(frame?.type ?? '') !== 'charms') return;
    const state = frame.payload as CharmState | undefined;
    if (!state?.slots) return;
    const huntId = getHunt();
    for (const acao of charmActions(state, huntId)) {
      const chave = acao.monsterKey + ':' + acao.id;
      const at = sent.get(chave);
      if (at !== undefined && Date.now() - at < CHARM_RETRY_MS) continue;
      sent.set(chave, Date.now());
      room.send('visibility', { hidden: false });
      room.send('cityPresence', { away: false });
      room.send('charmassign', { id: acao.id, monsterKey: acao.monsterKey });
      log(`[charm] atribuindo charm ${acao.id} -> ${acao.monsterKey} (hunt ${huntId})`);
    }
  });
}
