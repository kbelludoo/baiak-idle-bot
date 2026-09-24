import type { Page } from 'puppeteer-core';
import type { BotConfig, TelemetryState } from './types';
import { roomSend, sendBoss, sendSellReward } from './room_send';
import { checkAndBuyBossGear } from './boss_collector';

export interface BossPageSnapshot {
  bossChargesLeft: number | null;
  bossChargesMax: number;
  bossCooldowns: Record<string, number>;
  activeBossId: string;
  autoBossUntil: number;
  autoBossRunning: boolean;
  isCity: boolean;
  rewardCount: number;
}

export type BossRunnerState = 'IDLE' | 'FIGHTING' | 'COLLECTING' | 'COMPLETED_DAY';

export interface BossRunnerStatus {
  state: BossRunnerState;
  activeBossId: string | null;
  chargesLeft: number;
  chargesMax: number;
  killsToday: number;
  detail: string;
}

/**
 * Seleciona o próximo chefe da playlist elegível para combate:
 * - Requer ao menos 1 carga diária disponível (bossChargesLeft > 0)
 * - Pula chefes cujo cooldown de 24h ainda não expirou
 */
export function selectNextBoss(
  playlist: string[],
  bossCooldowns: Record<string, number>,
  bossChargesLeft: number,
  now: number = Date.now()
): string | null {
  if (bossChargesLeft <= 0) return null;
  if (!Array.isArray(playlist) || playlist.length === 0) return null;

  for (const bossId of playlist) {
    const cd = Number(bossCooldowns[bossId] || 0);
    if (cd <= now) {
      return bossId;
    }
  }
  return null;
}

export class SoftwareBossRunner {
  private runnerState: BossRunnerState = 'IDLE';
  private currentBossId: string | null = null;
  private fightStartedAt: number = 0;
  private lastAttemptAt: number = 0;
  private previousHuntId: string | null = null;
  private killsToday: number = 0;
  private lastRewardCollectAt: number = 0;
  private lastChargesLeft: number | null = null;
  private lastChargesMax: number = 20;

  public getStatus(): BossRunnerStatus {
    let detail = 'Aguardando requisitos';
    if (this.runnerState === 'FIGHTING' && this.currentBossId) {
      detail = `Em combate contra ${this.currentBossId} (${Math.round((Date.now() - this.fightStartedAt) / 1000)}s)`;
    } else if (this.runnerState === 'COLLECTING') {
      detail = 'Coletando espólios do Reward Chest';
    } else if (this.runnerState === 'COMPLETED_DAY') {
      detail = `Cargas de boss do dia concluídas (${this.killsToday} mortes)`;
    } else {
      detail = `Rotação pronta (${this.killsToday} mortes hoje)`;
    }

    return {
      state: this.runnerState,
      activeBossId: this.currentBossId,
      chargesLeft: this.lastChargesLeft !== null ? this.lastChargesLeft : 0,
      chargesMax: this.lastChargesMax,
      killsToday: this.killsToday,
      detail,
    };
  }

  /**
   * Extrai o estado dos chefes do contexto do jogo no navegador.
   */
  public async getSnapshot(page: Page | null, telemetry?: TelemetryState): Promise<BossPageSnapshot | null> {
    if (!page) return null;
    const pageSnap = await page.evaluate(() => {
      try {
        const w = window as any;
        const bs = w.__baiak_state || {};
        const cds: Record<string, number> = {};
        if (bs.bossCooldowns && typeof bs.bossCooldowns === 'object') {
          for (const [k, v] of Object.entries(bs.bossCooldowns)) {
            if (typeof v === 'number') cds[k] = v;
          }
        }
        const rawCharges = bs.bossChargesLeft !== undefined && bs.bossChargesLeft !== null
          ? Number(bs.bossChargesLeft)
          : null;

        return {
          bossChargesLeft: rawCharges,
          bossChargesMax: Number(bs.bossChargesMax ?? 20),
          bossCooldowns: cds,
          activeBossId: String(bs.activeBossId || ''),
          autoBossUntil: Number(bs.autoBossUntil ?? 0),
          autoBossRunning: Boolean(bs.autoBossRunning),
          isCity: Boolean(bs.inCity || bs.toCity || w.oi !== null),
          rewardCount: Array.isArray(bs.rewards) ? bs.rewards.length : 0,
        };
      } catch {
        return null;
      }
    }).catch(() => null);

    if (!pageSnap) return null;

    // Se o kernel do browser ainda não recebeu o frame 'mine', mescla com telemetria
    if (pageSnap.bossChargesLeft === null && telemetry) {
      const telemCharges = (telemetry as any).bossChargesLeft;
      if (telemCharges !== undefined && telemCharges !== null) {
        pageSnap.bossChargesLeft = Number(telemCharges);
      }
    }
    if (Object.keys(pageSnap.bossCooldowns).length === 0 && telemetry) {
      const telemCds = (telemetry as any).bossCooldowns;
      if (telemCds && typeof telemCds === 'object') {
        pageSnap.bossCooldowns = telemCds;
      }
    }
    if (!pageSnap.activeBossId && telemetry) {
      const telemBoss = (telemetry as any).activeBossId;
      if (typeof telemBoss === 'string' && telemBoss) {
        pageSnap.activeBossId = telemBoss;
      }
    }

    if (pageSnap.bossChargesLeft !== null) {
      this.lastChargesLeft = pageSnap.bossChargesLeft;
    }
    if (pageSnap.bossChargesMax > 0) {
      this.lastChargesMax = pageSnap.bossChargesMax;
    }

    return pageSnap;
  }

  /**
   * Ciclo autônomo da rotação de chefes.
   * Se o jogador não tiver o passe VIP da loja (autoBossUntil <= now),
   * o bot executa a sequência chefe por chefe via software.
   */
  public async step(
    page: Page | null,
    config: BotConfig,
    telemetry: TelemetryState,
    currentHuntId: string | null,
    isSafeTransition: boolean,
    now: number = Date.now()
  ): Promise<{ handled: boolean; action?: string; detail?: string }> {
    if (!config.autoBoss || !page) {
      return { handled: false };
    }

    const snapshot = await this.getSnapshot(page, telemetry);
    if (!snapshot) {
      return { handled: false };
    }

    // Se o passe oficial de Auto Boss estiver ativo na Store, deixe o servidor nativo gerenciar
    if (snapshot.autoBossUntil > now) {
      return { handled: false, detail: 'auto_boss_nativo_ativo' };
    }

    // 1. Verifica se estamos dentro da sala de combate de um chefe
    if (snapshot.activeBossId) {
      this.runnerState = 'FIGHTING';
      this.currentBossId = snapshot.activeBossId;
      if (!this.fightStartedAt) this.fightStartedAt = now;

      // Timeout de segurança: se o combate durar mais de 3 minutos, evita travar
      if (now - this.fightStartedAt > 180000) {
        console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ [BOSS-RUNNER] Combate contra ${this.currentBossId} excedeu 3min`);
      }
      return { handled: true, action: 'fighting_boss', detail: this.currentBossId };
    }

    // 2. Se estávamos lutando e o chefe sumiu (vitória ou derrota)
    if (this.runnerState === 'FIGHTING') {
      const prevBoss = this.currentBossId;
      console.log(`[${new Date().toLocaleTimeString()}] 🏆 [BOSS-RUNNER] Chefe ${prevBoss || 'desconhecido'} derrotado com sucesso!`);
      this.runnerState = 'COLLECTING';
      this.currentBossId = null;
      this.fightStartedAt = 0;
      this.killsToday++;

      // Coleta recompensas da Reward Chest
      await roomSend(page, 'reward', { action: 'collectall' }).catch(() => null);
      await sendSellReward(page).catch(() => null);
      this.lastRewardCollectAt = now;

      // Verifica e compra equipamentos com Boss Tokens acumulados
      await checkAndBuyBossGear(page, config, now).catch(() => null);

      return { handled: true, action: 'boss_victory', detail: prevBoss || 'ok' };
    }

    // 3. Fase de coleta pós-batalha
    if (this.runnerState === 'COLLECTING') {
      if (now - this.lastRewardCollectAt >= 2000) {
        this.runnerState = 'IDLE';
      }
      return { handled: true, action: 'collecting_rewards' };
    }

    // 4. Se ainda não há telemetria de cargas do servidor, aguarda o handshake inicial
    if (snapshot.bossChargesLeft === null) {
      return { handled: false, detail: 'aguardando_dados_cargas' };
    }

    // Se confirmadamente não há cargas diárias restantes, finaliza rotação
    if (snapshot.bossChargesLeft <= 0) {
      this.runnerState = 'COMPLETED_DAY';
      // Se estava em rotação e guardou a hunt anterior, retoma a hunt
      if (this.previousHuntId && snapshot.isCity) {
        const hId = this.previousHuntId;
        this.previousHuntId = null;
        console.log(`[${new Date().toLocaleTimeString()}] 🏹 [BOSS-RUNNER] Cargas diárias esgotadas. Retomando hunt principal: ${hId}`);
        await roomSend(page, 'stage', { huntId: hId }).catch(() => null);
        return { handled: true, action: 'resume_hunt', detail: hId };
      }
      return { handled: false, detail: 'sem_cargas_hoje' };
    }

    // Intervalo de segurança entre verificações de desafio (mínimo 5s)
    if (now - this.lastAttemptAt < 5000) {
      return { handled: false };
    }

    // 5. Seleciona o próximo chefe da playlist configurada
    const playlist = config.autoBossPlaylist || [];
    const nextBoss = selectNextBoss(playlist, snapshot.bossCooldowns, snapshot.bossChargesLeft, now);

    if (!nextBoss) {
      // Todos os chefes da playlist estão em cooldown
      if (this.previousHuntId && snapshot.isCity) {
        const hId = this.previousHuntId;
        this.previousHuntId = null;
        console.log(`[${new Date().toLocaleTimeString()}] 🏹 [BOSS-RUNNER] Todos os chefes em recarga. Retomando hunt: ${hId}`);
        await roomSend(page, 'stage', { huntId: hId }).catch(() => null);
        return { handled: true, action: 'resume_hunt', detail: hId };
      }
      return { handled: false, detail: 'todos_em_recarga' };
    }

    // 6. Só desafia se estiver em zona segura (cidade/templo) ou entre waves da hunt
    if (!snapshot.isCity && !isSafeTransition) {
      return { handled: false, detail: 'aguardando_transicao_segura' };
    }

    this.lastAttemptAt = now;
    if (currentHuntId && currentHuntId !== 'city' && currentHuntId !== 'templo') {
      this.previousHuntId = currentHuntId;
    }

    console.log(`[${new Date().toLocaleTimeString()}] 👑 [BOSS-RUNNER] Desafiando chefe da rotação: ${nextBoss} (${snapshot.bossChargesLeft} cargas restantes)...`);
    const sent = await sendBoss(page, nextBoss, true).catch(() => false);
    if (sent) {
      this.runnerState = 'FIGHTING';
      this.currentBossId = nextBoss;
      this.fightStartedAt = now;
      return { handled: true, action: 'boss_started', detail: nextBoss };
    }

    return { handled: false, detail: 'send_boss_failed' };
  }
}
