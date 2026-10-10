export interface HuntRiskSample {
  huntId: string;
  elapsedSec: number;
  damageTaken: number;
  maxHp: number;
  deaths: number;
  kills: number;
  gold: number;
  xpPerHour?: number;
  netGoldPerHour?: number;
}

export interface ExplorePolicy {
  sampleSec: number;
  maxDeaths: number;
  maxDamageTakenPct: number;
  cooldownSec: number;
}

export function damageTakenPct(sample: HuntRiskSample): number {
  if (sample.maxHp <= 0 || sample.elapsedSec <= 0) return 0;
  return (sample.damageTaken / sample.elapsedSec) * 60 / sample.maxHp * 100;
}

export function shouldAbortSample(sample: HuntRiskSample, policy: ExplorePolicy): { abort: boolean; reason: string } {
  if (sample.deaths > policy.maxDeaths) return { abort: true, reason: `mortes=${sample.deaths}` };
  const taken = damageTakenPct(sample);
  if (taken >= policy.maxDamageTakenPct) return { abort: true, reason: `dano recebido estimado=${taken.toFixed(1)}% HP/min` };
  return { abort: false, reason: '' };
}

export function sampleReady(sample: HuntRiskSample, policy: ExplorePolicy): boolean {
  return sample.elapsedSec >= policy.sampleSec && sample.kills > 0;
}

export function chooseExplorationTarget(
  candidates: Array<{ id: string; can_tank?: boolean; exp_h?: number; gold_h?: number; balance_score?: number }>,
  currentId: string | null,
  policy: ExplorePolicy,
): { id: string; reason: string } | null {
  const viable = candidates.filter((c) => c.can_tank !== false);
  if (!viable.length) return null;
  const best = [...viable].sort((a, b) =>
    Number(b.balance_score || 0) - Number(a.balance_score || 0)
      || Number(b.exp_h || 0) - Number(a.exp_h || 0)
      || Number(b.gold_h || 0) - Number(a.gold_h || 0),
  )[0];
  if (!currentId) return { id: best.id, reason: 'sem hunt atual: iniciar candidato sobrevivível' };
  if (best.id === currentId) return null;
  return { id: best.id, reason: `candidato equilibrado (XP + ouro) e sobrevivível: ${best.id}` };
}
