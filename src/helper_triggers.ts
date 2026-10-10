export interface HelperTriggerInput {
  level: number;
  previousLevel: number;
  partySignature: string;
  previousPartySignature: string;
  magic: { filled?: number; party_ready?: boolean; slots?: Record<string, any> };
  magicSignature: string;
  previousMagicSignature: string;
  hpPct?: number;
  manaPct?: number;
  damageTakenPerSecond?: number;
  maxHp?: number;
  now: number;
  lastRun: number;
}

export function helperTrigger(input: HelperTriggerInput): { run: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const cooldown = input.now - input.lastRun < 600000;
  if (input.level > input.previousLevel) reasons.push('level-up: novas magias podem liberar');
  if (input.partySignature && input.partySignature !== input.previousPartySignature) reasons.push('party mudou');
  if (!input.magic.party_ready) reasons.push('party/helper incompleto');
  if ((input.magic.filled || 0) === 0) reasons.push('magias ainda não lidas');
  if (input.previousMagicSignature && input.magicSignature !== input.previousMagicSignature) reasons.push('magias mudaram');
  if (input.hpPct !== undefined && input.hpPct > 0 && input.hpPct < 45) reasons.push('HP crítico');
  if (input.manaPct !== undefined && input.manaPct > 0 && input.manaPct < 35) reasons.push('mana crítica');
  if (input.damageTakenPerSecond !== undefined && input.maxHp && input.damageTakenPerSecond > input.maxHp * 0.15) reasons.push('dano recebido alto');
  const stateChange = reasons.some((r) => r === 'level-up: novas magias podem liberar' || r === 'party mudou' || r === 'magias mudaram');
  const critical = reasons.some((r) => r === 'HP crítico' || r === 'mana crítica' || r === 'dano recebido alto');
  const firstAttempt = input.lastRun === 0;
  return { run: reasons.length > 0 && (!cooldown || stateChange || critical || firstAttempt), reasons };
}
