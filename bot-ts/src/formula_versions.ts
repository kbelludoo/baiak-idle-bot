import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { FormulaCalibrationResult } from './jev';

export interface FormulaVersion {
  id: string;
  createdAt: string;
  model: string;
  coefficients: number[];
  validationError: number;
  rows: number;
  confidence: number;
  source: string;
  independentRuns: number;
  active: boolean;
}

interface VersionFile {
  active: FormulaVersion | null;
  pending: FormulaVersion[];
}

export class FormulaVersionStore {
  private readonly path: string;
  private state: VersionFile;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.path = join(dataDir, 'formula_versions.json');
    this.state = this.load();
  }

  private load(): VersionFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as VersionFile;
      if (parsed && Array.isArray(parsed.pending)) return { active: parsed.active || null, pending: parsed.pending };
    } catch (_) {}
    return { active: null, pending: [] };
  }

  record(result: FormulaCalibrationResult): FormulaVersion | null {
    if (!result.best || !result.adopted || result.rows < 10) return null;
    const best = result.best;
    const same = this.state.pending.find((item) => item.model === best.name
      && item.coefficients.length === best.coefficients.length
      && item.coefficients.every((value, index) => Math.abs(value - best.coefficients[index]) < 0.05));
    if (same) {
      same.independentRuns++;
      same.validationError = Math.min(same.validationError, best.validationError);
      same.confidence = Math.max(same.confidence, result.confidence);
      if (same.independentRuns >= 2 && !this.state.active) {
        same.active = true;
        this.state.active = same;
        this.state.pending = this.state.pending.filter((item) => item.id !== same.id);
      }
      this.save();
      return same;
    }
    const version: FormulaVersion = {
      id: `${best.name}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      model: best.name,
      coefficients: best.coefficients,
      validationError: best.validationError,
      rows: result.rows,
      confidence: result.confidence,
      source: result.source,
      independentRuns: 1,
      active: false,
    };
    this.state.pending.push(version);
    this.save();
    return version;
  }

  get active(): FormulaVersion | null { return this.state.active; }
  get pending(): FormulaVersion[] { return [...this.state.pending]; }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2), 'utf8');
  }
}
