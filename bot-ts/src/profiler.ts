export { HuntProfiler, HuntMatrix } from './hunts';
import { HuntProfiler } from './hunts';

// Compat: index.ts importa { Profiler }. Mantém nome antigo apontando p/ HuntProfiler real.
export class Profiler extends HuntProfiler {
  constructor(dataDir?: string) {
    super(dataDir || process.cwd());
  }
}

export interface HuntBenchmark {
  huntId: string;
  huntName: string;
  durationSeconds: number;
  kills: number;
  goldEarned: number;
  killsPerHour: number;
  goldPerHour: number;
  deaths: number;
}
