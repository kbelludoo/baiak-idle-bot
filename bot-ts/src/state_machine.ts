/**
 * Máquina de Estados e Fila Serializada de Ações do Bot.
 * 
 * Desacopla a telemetria (sempre em tempo real) das ações no DOM
 * (que rodam em fila serializada com timeouts estritos).
 */

export interface ActionTask<T = any> {
  id: string;
  name: string;
  priority: number; // Maior = mais prioritário (ex: 10 para reconexão, 5 para hunt, 1 para equip)
  timeoutMs: number;
  run: () => Promise<T>;
}

export class ActionQueue {
  private queue: ActionTask[] = [];
  private inFlight: ActionTask | null = null;
  private scheduled: boolean = false;
  private isProcessing: boolean = false;

  enqueue<T>(task: ActionTask<T>): boolean {
    // Evita tarefas duplicadas com o mesmo nome em espera ou em execução
    if (this.queue.some((t) => t.name === task.name) || (this.inFlight && this.inFlight.name === task.name)) {
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
 */
export function staminaToMinutes(staminaStr: string): number | null {
  if (!staminaStr || staminaStr === '—' || staminaStr === '-') return null;
  const mClock = staminaStr.match(/^(\d{1,2}):(\d{2})$/);
  if (mClock) {
    const hours = parseInt(mClock[1], 10);
    const mins = parseInt(mClock[2], 10);
    return hours * 60 + mins;
  }
  const mPct = staminaStr.match(/^(\d{1,3})\s*%$/);
  if (mPct) {
    const pct = parseInt(mPct[1], 10);
    // 100% de stamina = 42h = 2520 min
    return Math.floor((pct / 100) * 2520);
  }
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
