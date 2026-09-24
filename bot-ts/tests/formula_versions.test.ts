import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FormulaVersionStore } from '../src/formula_versions';

const result = (confidence = 0.9) => ({
  rows: 20,
  candidates: [],
  best: { name: 'linear' as const, coefficients: [1, 2], trainError: 0.02, validationError: 0.05, features: ['bias', 'level'] },
  adopted: true,
  confidence,
  source: 'jev_api' as const,
  detail: 'ok',
});

describe('Formula version store', () => {
  it('requires two independent accepted calibrations before activation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'formula-store-'));
    const store = new FormulaVersionStore(dir);
    const first = store.record(result());
    expect(first?.independentRuns).toBe(1);
    expect(store.active).toBeNull();
    const second = store.record(result(0.95));
    expect(second?.independentRuns).toBe(2);
    expect(store.active?.id).toBe(second?.id);
    expect(JSON.parse(readFileSync(join(dir, 'formula_versions.json'), 'utf8')).active.id).toBe(second?.id);
  });

  it('does not persist a rejected or undersampled candidate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'formula-store-'));
    const store = new FormulaVersionStore(dir);
    expect(store.record({ ...result(), adopted: false })).toBeNull();
    expect(store.record({ ...result(), rows: 9 })).toBeNull();
    expect(store.pending).toHaveLength(0);
  });
});
