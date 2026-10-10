/**
 * Auto-Restore Engine (Modo Sempre Ativo)
 *
 * Garante que o bot esteja SEMPRE ativo:
 * - Farmando (caçando monstros, ganhando XP e gold)
 * - Treinando (regenerando stamina em Treino Online)
 * - Matando chefe (rotação diária de Boss)
 *
 * Se detectar qualquer parada, congelamento de navegador, modal bloqueante,
 * sala fantasma ou stall sem ganho de XP/kills, aplica recuperação progressiva:
 * - Nível 1 (45s): Fecha modais presos e limpa locks de avaliação DOM.
 * - Nível 2 (90s): Força teleporte direto via pacote 'stage' no WebSocket.
 * - Nível 3 (180s): Limpa a fila de ações presas e força re-conexão da sala.
 * - Nível 4 (300s): Dispara reload completo e limpo da página do jogo.
 */

import type { Page } from 'puppeteer-core';
import { forceResetEvalLocks } from './scripts';

export type ActivityMode = 'FARMING' | 'TRAINING' | 'BOSS' | 'CITY_TRANSITION' | 'IDLE';

export interface AutoRestoreSnapshot {
  online: boolean;
  isCity: boolean;
  inTreino: boolean;
  stamina: string;
  wave: string;
  kills: number;
  waves: number;
  gold: number;
  level: number;
  bossActive: boolean;
  bossChargesLeft: number;
}

export interface AutoRestoreStatus {
  mode: ActivityMode;
  currentActivity: string;
  lastProgressSecAgo: number;
  stuckLevel: number;
  totalRecoveries: number;
  lastRecoveryReason: string | null;
  lastRecoveryAt: string | null;
  detail: string;
}

export class AutoRestoreEngine {
  private lastProgressKills: number = -1;
  private lastProgressWaves: number = -1;
  private lastProgressGold: number = -1;
  private lastProgressLevel: number = -1;
  private lastProgressStamina: string = '';
  private lastProgressTime: number = Date.now();

  private cityStartedAt: number = 0;
  private fullStaminaInTreinoAt: number = 0;
  private lastRecoveryAt: number = 0;
  private lastRecoveryReason: string | null = null;
  private totalRecoveries: number = 0;
  private currentMode: ActivityMode = 'IDLE';
  private currentActivity: string = 'Iniciando';
  private stuckLevel: number = 0;

  /**
   * Registra progresso real do jogo (mudança em kills, waves, gold, level ou stamina).
   */
  public reportProgress(source: string): void {
    this.lastProgressTime = Date.now();
    this.stuckLevel = 0;
  }

  /**
   * Avalia o estado atual do bot e executa ações de restauração se necessário.
   */
  public async evaluate(
    now: number,
    snap: AutoRestoreSnapshot,
    targetHuntId: string,
    page: Page | null,
    sendStageFn: (targetId: string) => Promise<boolean>,
    closeModalsFn: () => Promise<void>,
    clearQueueFn: () => void,
    reloadPageFn: (reason: string) => Promise<void>
  ): Promise<{ needsHuntEntry: boolean; reason?: string }> {
    let result = { needsHuntEntry: false, reason: '' };

    if (!snap.online) {
      this.currentMode = 'IDLE';
      this.currentActivity = 'Aguardando conexão WebSocket';
      return result;
    }

    // 1. Determina modo atual
    const isBossFight = Boolean(snap.bossActive || (snap.wave && /boss|chefe|sala do chefe/i.test(snap.wave)));
    if (isBossFight) {
      this.currentMode = 'BOSS';
      this.currentActivity = `Chefe ativo (${snap.wave || 'Boss'})`;
      this.cityStartedAt = 0;
      this.fullStaminaInTreinoAt = 0;
      this.lastProgressTime = now;
    } else if (snap.inTreino || /treino|training/i.test(snap.wave)) {
      this.currentMode = 'TRAINING';
      this.currentActivity = `Treino Online (stamina ${snap.stamina})`;
      this.cityStartedAt = 0;
    } else if (snap.isCity || /cidade|city|templo|temple/i.test(snap.wave)) {
      this.currentMode = 'CITY_TRANSITION';
      this.currentActivity = 'Cidade/Templo (transição)';
      if (!this.cityStartedAt) this.cityStartedAt = now;
      this.fullStaminaInTreinoAt = 0;
    } else {
      this.currentMode = 'FARMING';
      this.currentActivity = `Caçando em ${snap.wave || targetHuntId || 'hunt'}`;
      this.cityStartedAt = 0;
      this.fullStaminaInTreinoAt = 0;
    }

    // 2. Rastreamento de progresso real
    const hasProgressed =
      (snap.kills > 0 && snap.kills !== this.lastProgressKills) ||
      (snap.waves > 0 && snap.waves !== this.lastProgressWaves) ||
      (snap.gold > 0 && snap.gold !== this.lastProgressGold) ||
      (snap.level > 0 && snap.level !== this.lastProgressLevel);

    if (hasProgressed) {
      this.lastProgressKills = snap.kills;
      this.lastProgressWaves = snap.waves;
      this.lastProgressGold = snap.gold;
      this.lastProgressLevel = snap.level;
      this.lastProgressTime = now;
      this.stuckLevel = 0;
    }

    // 3. Guardião de Treino: Se stamina está cheia (>=85% ou 42:00) enquanto em treino
    const staminaFull = /^(?:42:00|100%|42h)/i.test(snap.stamina) || snap.stamina.includes('42:00');
    if (this.currentMode === 'TRAINING') {
      if (staminaFull) {
        if (!this.fullStaminaInTreinoAt) this.fullStaminaInTreinoAt = now;
        const timeAtFull = now - this.fullStaminaInTreinoAt;
        if (timeAtFull >= 60_000 && now - this.lastRecoveryAt >= 30_000) {
          console.warn(`[AUTO-RESTORE] 🧘 Stamina cheia no treino há ${Math.round(timeAtFull / 1000)}s — forçando saída para hunt`);
          this.triggerRecovery('TREINO_STAMINA_CHEIA', now);
          result.needsHuntEntry = true;
          result.reason = 'stamina_cheia_treino';
          await closeModalsFn().catch(() => null);
          if (targetHuntId) await sendStageFn(targetHuntId).catch(() => null);
          return result;
        }
      } else {
        this.fullStaminaInTreinoAt = 0;
        // No treino, o progresso é a recuperação da stamina
        if (snap.stamina !== this.lastProgressStamina) {
          this.lastProgressStamina = snap.stamina;
          this.lastProgressTime = now;
          this.stuckLevel = 0;
        }
      }
    }

    // 4. Guardião de Cidade / Templo (Máximo 45s parado na cidade)
    if (this.currentMode === 'CITY_TRANSITION') {
      const cityIdleMs = now - this.cityStartedAt;
      if (cityIdleMs >= 45_000 && now - this.lastRecoveryAt >= 20_000) {
        console.warn(`[AUTO-RESTORE] 🏙️ Parado na cidade/templo há ${Math.round(cityIdleMs / 1000)}s — ativando caça imediatamente`);
        this.triggerRecovery(`CIDADE_IDLE_${Math.round(cityIdleMs / 1000)}S`, now);
        result.needsHuntEntry = true;
        result.reason = 'cidade_idle_timeout';

        // Nível 1: fecha modais e limpa locks
        await closeModalsFn().catch(() => null);
        if (page) forceResetEvalLocks(page);

        // Nível 2 (>= 75s na cidade): envia stage direto
        if (cityIdleMs >= 75_000 && targetHuntId) {
          console.log(`[AUTO-RESTORE] 🏹 Enviando stage direto para ${targetHuntId}`);
          await sendStageFn(targetHuntId).catch(() => null);
        }

        // Nível 4 (>= 150s na cidade sem conseguir sair): reload da página
        if (cityIdleMs >= 150_000) {
          console.warn(`[AUTO-RESTORE] 🔴 Preso na cidade por ${Math.round(cityIdleMs / 1000)}s — forçando reload`);
          this.cityStartedAt = now;
          await reloadPageFn('preso_na_cidade');
        }
        return result;
      }
    }

    // 5. Guardião de Farm (Caçada ativa sem progresso real)
    if (this.currentMode === 'FARMING') {
      const idleMs = now - this.lastProgressTime;

      // Nível 4: 300s (5 minutos) sem progresso — browser ou sala congelada
      if (idleMs >= 300_000 && now - this.lastRecoveryAt >= 60_000) {
        this.stuckLevel = 4;
        this.triggerRecovery('FARM_STALL_300S_RELOAD', now);
        console.warn(`[AUTO-RESTORE] 🔴 Nível 4: 5 minutos sem progresso em ${snap.wave} — forçando recarga da página`);
        this.lastProgressTime = now;
        await reloadPageFn('farm_stall_5min');
      }
      // Nível 3: 200s sem progresso
      else if (idleMs >= 200_000 && this.stuckLevel < 3 && now - this.lastRecoveryAt >= 40_000) {
        this.stuckLevel = 3;
        this.triggerRecovery('FARM_STALL_200S', now);
        console.warn(`[AUTO-RESTORE] ⚠️ Nível 3: 200s sem progresso em ${snap.wave} — limpando fila de ações presas`);
        clearQueueFn();
        await closeModalsFn().catch(() => null);
        if (page) forceResetEvalLocks(page);
        if (targetHuntId) {
          await sendStageFn(targetHuntId).catch(() => null);
        }
      }
      // Nível 2: 120s sem progresso
      else if (idleMs >= 120_000 && this.stuckLevel < 2 && now - this.lastRecoveryAt >= 30_000) {
        this.stuckLevel = 2;
        this.triggerRecovery('FARM_STALL_120S', now);
        console.warn(`[AUTO-RESTORE] ⚠️ Nível 2: 120s sem progresso em ${snap.wave} — reenviando pacote de hunt`);
        result.needsHuntEntry = true;
        result.reason = 'farm_stall_120s';
        if (targetHuntId) {
          await sendStageFn(targetHuntId).catch(() => null);
        }
      }
      // Nível 1: 60s sem nenhum kill/wave/gold
      else if (idleMs >= 60_000 && this.stuckLevel < 1 && now - this.lastRecoveryAt >= 25_000) {
        this.stuckLevel = 1;
        console.warn(`[AUTO-RESTORE] ⚠️ Nível 1: 60s sem progresso em ${snap.wave} — limpando modais e locks`);
        await closeModalsFn().catch(() => null);
        if (page) forceResetEvalLocks(page);
        result.needsHuntEntry = true;
        result.reason = 'farm_idle_60s';
      }
    }

    return result;
  }

  private triggerRecovery(reason: string, now: number): void {
    this.lastRecoveryAt = now;
    this.lastRecoveryReason = reason;
    this.totalRecoveries += 1;
  }

  public getStatus(): AutoRestoreStatus {
    const idleSec = Math.max(0, Math.round((Date.now() - this.lastProgressTime) / 1000));
    let detail = `Modo: ${this.currentMode} (${this.currentActivity}) | Último progresso: ${idleSec}s atrás`;
    if (this.totalRecoveries > 0) {
      detail += ` | ${this.totalRecoveries} recuperações automáticas (última: ${this.lastRecoveryReason || '—'})`;
    }

    return {
      mode: this.currentMode,
      currentActivity: this.currentActivity,
      lastProgressSecAgo: idleSec,
      stuckLevel: this.stuckLevel,
      totalRecoveries: this.totalRecoveries,
      lastRecoveryReason: this.lastRecoveryReason,
      lastRecoveryAt: this.lastRecoveryAt ? new Date(this.lastRecoveryAt).toLocaleTimeString() : null,
      detail,
    };
  }
}
