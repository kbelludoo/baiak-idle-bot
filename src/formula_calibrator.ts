export interface DamageSample {
  level: number;
  avgHp: number;
  alive: number;
  spawnS: number;
  kills: number;
  uptimeSec: number;
  power?: number;
  aoe?: number;
  party?: boolean;
  huntId?: string;
}

export interface FormulaRow extends DamageSample {
  killsH: number;
  ttk: number;
  dps: number;
}

export interface FormulaCandidate {
  name: 'linear' | 'scaled' | 'interaction';
  coefficients: number[];
  trainError: number;
  validationError: number;
  features: string[];
}

const finite = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function prepareDamageRows(samples: DamageSample[]): FormulaRow[] {
  return (samples || []).map((sample) => {
    const killsH = sample.uptimeSec > 0 ? (sample.kills / sample.uptimeSec) * 3600 : 0;
    const ttk = sample.alive > 0 && killsH > 0 ? (sample.alive * 3600) / killsH - sample.spawnS : NaN;
    return { ...sample, killsH, ttk, dps: Number.isFinite(ttk) && ttk > 0.05 ? sample.avgHp / ttk : NaN };
  }).filter((row) => Number.isFinite(row.dps) && row.dps > 0
    && row.level > 0 && row.uptimeSec >= 120 && row.uptimeSec <= 20_000
    && row.kills >= 20 && row.spawnS / Math.max(row.ttk, 0.01) <= 0.6);
}

function features(name: FormulaCandidate['name'], row: FormulaRow): number[] {
  const level = finite(row.level, 1);
  const power = finite(row.power, 0);
  const aoe = Math.min(3, Math.max(0, finite(row.aoe, 0)));
  const party = row.party ? 1 : 0;
  if (name === 'scaled') return [1, Math.log(Math.max(1, level)), power, aoe, party];
  if (name === 'interaction') return [1, level, power, aoe, party, level * power, level * aoe];
  return [1, level, power, aoe, party];
}

function solve(matrix: number[][], target: number[]): number[] {
  const width = matrix[0]?.length || 0;
  const normal = Array.from({ length: width }, (_, i) => Array.from({ length: width }, (_, j) =>
    matrix.reduce((sum, row, r) => sum + row[i] * row[j], 0) + (i === j ? 1e-8 : 0)));
  const rhs = Array.from({ length: width }, (_, i) => matrix.reduce((sum, row, r) => sum + row[i] * target[r], 0));
  for (let col = 0; col < width; col++) {
    let pivot = col;
    for (let row = col + 1; row < width; row++) if (Math.abs(normal[row][col]) > Math.abs(normal[pivot][col])) pivot = row;
    if (Math.abs(normal[pivot][col]) < 1e-10) continue;
    [normal[col], normal[pivot]] = [normal[pivot], normal[col]];
    [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]];
    const scale = normal[col][col];
    for (let j = col; j < width; j++) normal[col][j] /= scale;
    rhs[col] /= scale;
    for (let row = 0; row < width; row++) {
      if (row === col) continue;
      const factor = normal[row][col];
      for (let j = col; j < width; j++) normal[row][j] -= factor * normal[col][j];
      rhs[row] -= factor * rhs[col];
    }
  }
  return rhs.map((value) => Number.isFinite(value) ? value : 0);
}

function error(candidate: FormulaCandidate, rows: FormulaRow[]): number {
  if (!rows.length) return Infinity;
  return rows.reduce((sum, row) => {
    const prediction = features(candidate.name, row).reduce((v, x, i) => v + x * candidate.coefficients[i], 0);
    return sum + Math.abs(prediction - row.dps) / Math.max(row.dps, 1);
  }, 0) / rows.length;
}

export function calibrateDamageFormula(samples: DamageSample[]): { rows: FormulaRow[]; candidates: FormulaCandidate[]; best: FormulaCandidate | null } {
  const rows = prepareDamageRows(samples);
  if (rows.length < 10) return { rows, candidates: [], best: null };
  const train = rows.filter((_, index) => index % 5 !== 0);
  const validation = rows.filter((_, index) => index % 5 === 0);
  const candidates = (['linear', 'scaled', 'interaction'] as const).map((name) => {
    const provisional: FormulaCandidate = { name, coefficients: solve(train.map((row) => features(name, row)), train.map((row) => row.dps)), trainError: 0, validationError: 0, features: [] };
    provisional.trainError = error(provisional, train);
    provisional.validationError = error(provisional, validation);
    provisional.features = name === 'interaction' ? ['bias', 'level', 'power', 'aoe', 'party', 'level*power', 'level*aoe'] : name === 'scaled' ? ['bias', 'log(level)', 'power', 'aoe', 'party'] : ['bias', 'level', 'power', 'aoe', 'party'];
    return provisional;
  });
  candidates.sort((a, b) => a.validationError - b.validationError);
  return { rows, candidates, best: candidates[0] || null };
}
