/**
 * Máquina de Estados e Fila Serializada de Ações do Bot.
 * 
 * Desacopla a telemetria (sempre em tempo real) das ações no DOM
 * (que rodam em fila serializada com timeouts estritos).
 */

export type ActionLane = 'hunt' | 'gear' | 'extras';

export interface ActionTask<T = any> {
  id: string;
  name: string;
  priority: number; // Maior = mais prioritário (ex: 10 para reconexão, 5 para hunt, 1 para equip)
  timeoutMs: number;
  run: () => Promise<T>;
  /**
   * Faixa da ação. Só observabilidade + regra de substituição: duas ações na
   * mesma lane com o mesmo `id` se substituem; lanes diferentes nunca se
   * canibalizam (antes o dedup era por `name`: `spell`, `extras`, `equip`,
   * `hunt` se matavam — `extras` 1 job/20s travava boss/prey por minutos).
   */
  lane?: ActionLane;
}

function laneOf(task: ActionTask): ActionLane {
  if (task.lane) return task.lane;
  if (task.name === 'hunt' || task.name === 'force-hunt' || task.name === 'treino' || task.name === 'boss') return 'hunt';
  if (task.name === 'spell' || task.name === 'potion' || task.name === 'equip' || task.name === 'lootfilter' || task.name === 'autosell') return 'gear';
  return 'extras';
}

export class ActionQueue {
  private queue: ActionTask[] = [];
  private inFlight: ActionTask | null = null;
  private scheduled: boolean = false;
  private isProcessing: boolean = false;

  enqueue<T>(task: ActionTask<T>): boolean {
    const lane = laneOf(task);
    task.lane = lane;
    // Dedup por (lane,id): a mesma ação não entra 2x, mas ações de lanes
    // diferentes ou ids diferentes nunca se canibalizam. Ex: `spell_picker`
    // (gear) não mata `spell_party` (gear, id diferente) nem `extras`.
    if (this.queue.some((t) => t.lane === lane && t.id === task.id) ||
        (this.inFlight && this.inFlight.lane === lane && this.inFlight.id === task.id)) {
      return false;
    }
    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority); // Alta prioridade primeiro
    this.scheduleProcess();
    return true;
  }

  private scheduleProcess(): void {
    if (this.isProcessing || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.processNext();
    });
  }

  get pendingCount(): number {
    return this.queue.length + (this.inFlight ? 1 : 0);
  }

  get pendingByLane(): Record<ActionLane, number> {
    const out: Record<ActionLane, number> = { hunt: 0, gear: 0, extras: 0 };
    for (const t of this.queue) out[laneOf(t)] += 1;
    if (this.inFlight) out[laneOf(this.inFlight)] += 1;
    return out;
  }

  get currentAction(): string | null {
    return this.inFlight ? this.inFlight.name : null;
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.inFlight = task;

      try {
        await Promise.race([
          task.run(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Action '${task.name}' timed out after ${task.timeoutMs}ms`)), task.timeoutMs)
          ),
        ]);
      } catch (err: any) {
        console.warn(`[ACTION_QUEUE] ⚠️ Tarefa '${task.name}' falhou ou expirou: ${err?.message || err}`);
      } finally {
        this.inFlight = null;
      }
    }

    this.isProcessing = false;
  }

  clear(): void {
    this.queue = [];
    this.inFlight = null;
  }
}

/**
 * Lógica pura de transição de stamina e treino.
 * Aceita todos os formatos do jogo (H:MM, HH:MM:SS, Xh Ym, NN%, minutos).
 * Placeholder 42:00/2520 retorna null (desconhecido, nunca força treino).
 */
export function staminaToMinutes(staminaStr: string | number | null | undefined): number | null {
  if (staminaStr === undefined || staminaStr === null) return null;
  if (typeof staminaStr === 'number') {
    if (!Number.isFinite(staminaStr)) return null;
    if (staminaStr <= 1.05 && staminaStr > 0) return Math.floor(staminaStr * 2520);
    if (staminaStr > 1 && staminaStr <= 2520) {
      if (staminaStr === 2520) return null;
      return Math.floor(staminaStr);
    }
    return null;
  }
  const raw = String(staminaStr).trim();
  if (!raw || raw === '—' || raw === '–' || raw === '-') return null;
  // canônico H:MM
  let m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h === 42 && mi === 0) return null;
    return h * 60 + mi;
  }
  // HH:MM:SS
  m = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h === 42 && mi === 0) return null;
    return h * 60 + mi;
  }
  // percentual
  m = raw.match(/^(\d{1,3})\s*%$/);
  if (m) return Math.floor((parseInt(m[1], 10) / 100) * 2520);
  // embutido: extrai primeiro token válido de strings longas ("Stamina 38h 15m", "41:15 restante")
  const pct = raw.match(/(\d{1,3})\s*%/);
  if (pct) return Math.floor((parseInt(pct[1], 10) / 100) * 2520);
  const clock = raw.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (clock) {
    const h = parseInt(clock[1], 10), mi = parseInt(clock[2], 10);
    if (h <= 42 && mi <= 59 && !(h === 42 && mi === 0)) return h * 60 + mi;
  }
  const mH = raw.match(/(\d{1,2})\s*h/i);
  const mM = raw.match(/(\d{1,3})\s*m/i);
  if (mH || mM) {
    const h = mH ? parseInt(mH[1], 10) : 0;
    const mi = mM ? parseInt(mM[1], 10) : 0;
    if (h === 42 && mi === 0) return null;
    if (h <= 42 && mi <= 59) return h * 60 + mi;
  }
  const mMin = raw.match(/^(\d{2,4})\s*(?:min)?$/i);
  if (mMin) {
    const mins = parseInt(mMin[1], 10);
    if (mins === 2520) return null;
    if (mins >= 0 && mins <= 2520) return mins;
  }
  if (/^(0|empty|vazia)$/i.test(raw)) return 0;
  return null;
}

export function staminaIsBelow15Pct(staminaStr: string): boolean {
  const mins = staminaToMinutes(staminaStr);
  if (mins === null) return false;
  // 15% de 2520 min = 378 min (6h18m)
  return mins <= 378;
}

export function staminaIsAbove85Pct(staminaStr: string): boolean {
  const mins = staminaToMinutes(staminaStr);
  if (mins === null) return false;
  // 85% de 2520 min = 2142 min (35h42m)
  return mins >= 2142;
}

export type StaminaDecision =
  | { action: 'enter_treino'; reason: string }
  | { action: 'resume_hunt'; reason: string }
  | { action: 'stay_in_treino'; reason: string }
  | { action: 'continue_hunt'; reason: string };

export function evaluateStaminaTransition(
  staminaStr: string,
  inTreino: boolean,
  autoTreinoEnabled: boolean
): StaminaDecision {
  if (!autoTreinoEnabled) {
    return inTreino
      ? { action: 'resume_hunt', reason: 'Auto-treino desativado; retornando à caça' }
      : { action: 'continue_hunt', reason: 'Auto-treino desativado' };
  }

  const isLow = staminaIsBelow15Pct(staminaStr);
  const isRecovered = staminaIsAbove85Pct(staminaStr);

  if (!inTreino) {
    if (isLow) {
      return { action: 'enter_treino', reason: `Stamina <= 15% (${staminaStr}); teleportando para Treino Online` };
    }
    return { action: 'continue_hunt', reason: `Stamina saudável (${staminaStr}); caçando normalmente` };
  } else {
    if (isRecovered) {
      return { action: 'resume_hunt', reason: `Stamina >= 85% (${staminaStr}); retornando às hunts` };
    }
    return { action: 'stay_in_treino', reason: `Stamina recuperando (${staminaStr}); mantendo Treino Online` };
  }
}
