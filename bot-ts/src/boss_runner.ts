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
  /** Detectado via autobossstate.until > now — true = conta tem algum benefício VIP */
  isVipAccount: boolean;
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
 * Retorna o timestamp de início do dia de hoje (00:00 hora local) em ms.
 * Usamos isso para reset de killsToday e dos cooldowns de 24h.
 */
function todayStartMs(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Seleciona o próximo chefe da playlist elegível para combate:
 * - Requer ao menos 1 carga diária disponível (chargesLeft > 0)
 * - Pula chefes cujo cooldown de 24h ainda não expirou
 */
export function selectNextBoss(
  playlist: string[],
  bossCooldowns: Record<string, number>,
  chargesLeft: number,
  now: number = Date.now()
): string | null {
  if (chargesLeft <= 0) return null;
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
  private lastChargesLeft: number = -1;   // -1 = ainda nao lemos do servidor
  private lastChargesMax: number = 3;
  private dayStartMs: number = 0;         // inicio do dia atual para reset de killsToday
  /** Cooldowns internos (boss -> timestamp de liberacao) quando o servidor nao fornece */
  private internalCooldowns: Record<string, number> = {};

  public getStatus(): BossRunnerStatus {
    let detail = 'Aguardando requisitos';
    if (this.runnerState === 'FIGHTING' && this.currentBossId) {
      detail = `Em combate contra ${this.currentBossId} (${Math.round((Date.now() - this.fightStartedAt) / 1000)}s)`;
    } else if (this.runnerState === 'COLLECTING') {
      detail = 'Coletando espolios do Reward Chest';
    } else if (this.runnerState === 'COMPLETED_DAY') {
      detail = `Cargas de boss do dia concluidas (${this.killsToday} mortes)`;
    } else {
      const left = this.lastChargesLeft >= 0
        ? this.lastChargesLeft
        : Math.max(0, this.lastChargesMax - this.killsToday);
      detail = `Rotacao pronta (${this.killsToday} mortes hoje, ${left} cargas restantes)`;
    }

    return {
      state: this.runnerState,
      activeBossId: this.currentBossId,
      chargesLeft: Math.max(0, this.lastChargesLeft >= 0 ? this.lastChargesLeft : this.lastChargesMax - this.killsToday),
      chargesMax: this.lastChargesMax,
      killsToday: this.killsToday,
      detail,
    };
  }

  /**
   * Reseta o contador de kills e cargas ao virar o dia (00:00 local).
   */
  private checkDayReset(now: number): void {
    const newDayStart = todayStartMs(now);
    if (this.dayStartMs === 0) {
      this.dayStartMs = newDayStart;
    } else if (newDayStart > this.dayStartMs) {
      this.dayStartMs = newDayStart;
      this.killsToday = 0;
      this.lastChargesLeft = -1;
      this.internalCooldowns = {};
      if (this.runnerState === 'COMPLETED_DAY') {
        this.runnerState = 'IDLE';
      }
      console.log(`[${new Date().toLocaleTimeString()}] [BOSS-RUNNER] Novo dia - kills e cargas resetados`);
    }
  }

  /**
   * Detecta se a conta e VIP pelo pacote autobossstate.until > now.
   * Conta VIP sem Auto Boss Store: 5 cargas/dia.
   * Conta Free: 3 cargas/dia.
   * Se o servidor enviar bossgate.chargesMax, usa esse valor diretamente.
   */
  private resolveChargesMax(snapshot: BossPageSnapshot): number {
    // Se o servidor forneceu o maximo explicitamente via bossgate (valor diferente do padrao legacy 20)
    if (snapshot.bossChargesMax > 0 && snapshot.bossChargesMax !== 20) {
      return snapshot.bossChargesMax;
    }
    // Inferido: conta VIP tem 5 tentativas/dia; Free tem 3
    return snapshot.isVipAccount ? 5 : 3;
  }

  /**
   * Extrai o estado dos chefes do contexto do jogo no navegador.
   * Le: __baiak_state (kernel hook) que ja captura bossgate e autobossstate.
   */
  public async getSnapshot(page: Page | null, telemetry?: TelemetryState): Promise<BossPageSnapshot | null> {
    if (!page) return null;
    const pageSnap = await page.evaluate(() => {
      try {
        const w = window as any;
        const bs = w.__baiak_state || {};
        const cds: Record<string, number> = {};

        // Cooldowns vindos do bossgate (via kernel hook) ou do mine (fallback legado)
        const rawCds = bs.bossCooldowns;
        if (rawCds && typeof rawCds === 'object') {
          for (const [k, v] of Object.entries(rawCds)) {
            if (typeof v === 'number') cds[k] = v;
          }
        }

        // Cargas vindas do bossgate (pacote real do servidor, capturado pelo kernel)
        const bossgate = bs.bossgate || {};
        const rawCharges = (bs.bossChargesLeft !== null && bs.bossChargesLeft !== undefined)
          ? Number(bs.bossChargesLeft)
          : (bossgate.chargesLeft !== undefined ? Number(bossgate.chargesLeft) : null);
        const rawChargesMax = (bs.bossChargesMax !== null && bs.bossChargesMax !== undefined)
          ? Number(bs.bossChargesMax)
          : (bossgate.chargesMax !== undefined ? Number(bossgate.chargesMax) : 0);

        // autobossstate: until > now = conta tem passe VIP Auto Boss da Store
        const abs = bs.autobossstate || {};
        const autoBossUntil = Number(abs.until ?? 0);
        const autoBossRunning = Boolean(abs.running);
        const isVipAccount = autoBossUntil > Date.now();

        return {
          bossChargesLeft: rawCharges,
          bossChargesMax: rawChargesMax,
          bossCooldowns: cds,
          activeBossId: String(bs.activeBossId || bossgate.activeBossId || ''),
          autoBossUntil,
          autoBossRunning,
          isCity: Boolean(bs.inCity || bs.toCity || (w.oi !== null && w.oi !== undefined)),
          rewardCount: Array.isArray(bs.rewards) ? bs.rewards.length : 0,
          isVipAccount,
        };
      } catch {
        return null;
      }
    }).catch(() => null);

    if (!pageSnap) return null;

    // Mescla com telemetria quando o kernel ainda nao recebeu os pacotes de boss
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

    // Atualiza cache interno de cargas do servidor (quando disponivel)
    if (pageSnap.bossChargesLeft !== null) {
      this.lastChargesLeft = pageSnap.bossChargesLeft;
    }
    if (pageSnap.bossChargesMax > 0) {
      this.lastChargesMax = pageSnap.bossChargesMax;
    }

    return pageSnap;
  }

  /**
   * Ciclo autonomo da rotacao de chefes.
   *
   * Funciona mesmo SEM o pacote 'mine' (que nao existe no Baiak Idle):
   *   - Usa contagem interna de kills para estimar cargas restantes
   *   - Reseta ao virar o dia (00:00 local)
   *   - Detecta VIP via autobossstate.until para ajustar o maximo de cargas
   *   - Se o servidor enviou bossgate.chargesLeft, usa esse valor direto (autoritativo)
   *
   * Se o passe oficial de Auto Boss VIP estiver ativo (until > now E running=true),
   * o loop do index.ts ja gerencia; este metodo retorna handled:false.
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

    this.checkDayReset(now);

    const snapshot = await this.getSnapshot(page, telemetry);
    if (!snapshot) {
      return { handled: false };
    }

    // Se o passe oficial de Auto Boss estiver ativo E rodando, deixe o servidor nativo gerenciar
    if (snapshot.autoBossUntil > now && snapshot.autoBossRunning) {
      return { handled: false, detail: 'auto_boss_nativo_ativo' };
    }

    // 1. Verifica se estamos dentro da sala de combate de um chefe
    if (snapshot.activeBossId) {
      this.runnerState = 'FIGHTING';
      this.currentBossId = snapshot.activeBossId;
      if (!this.fightStartedAt) this.fightStartedAt = now;

      // Timeout de seguranca: se o combate durar mais de 4 minutos, avisa
      if (now - this.fightStartedAt > 240_000) {
        console.warn(`[${new Date().toLocaleTimeString()}] [BOSS-RUNNER] Combate contra ${this.currentBossId} excedeu 4min - possivel travamento`);
      }
      return { handled: true, action: 'fighting_boss', detail: this.currentBossId };
    }

    // 2. Se estavamos lutando e o chefe sumiu (vitoria ou derrota)
    if (this.runnerState === 'FIGHTING') {
      const prevBoss = this.currentBossId;
      console.log(`[${new Date().toLocaleTimeString()}] [BOSS-RUNNER] Chefe ${prevBoss || 'desconhecido'} derrotado!`);
      this.runnerState = 'COLLECTING';
      this.currentBossId = null;
      this.fightStartedAt = 0;
      this.killsToday++;

      // Marca cooldown interno de 20h para nao repetir o boss ate o proximo dia
      if (prevBoss) {
        this.internalCooldowns[prevBoss] = now + 20 * 60 * 60 * 1000;
      }

      // Desconta 1 carga do servidor (quando disponivel)
      if (this.lastChargesLeft > 0) {
        this.lastChargesLeft--;
      }

      // Coleta recompensas da Reward Chest
      await roomSend(page, 'reward', { action: 'collectall' }).catch(() => null);
      await sendSellReward(page).catch(() => null);
      this.lastRewardCollectAt = now;

      // Verifica e compra equipamentos com Boss Tokens acumulados
      await checkAndBuyBossGear(page, config, now).catch(() => null);

      return { handled: true, action: 'boss_victory', detail: prevBoss || 'ok' };
    }

    // 3. Fase de coleta pos-batalha
    if (this.runnerState === 'COLLECTING') {
      if (now - this.lastRewardCollectAt >= 2000) {
        this.runnerState = 'IDLE';
      }
      return { handled: true, action: 'collecting_rewards' };
    }

    // 4. Resolve quantas cargas restam hoje
    const chargesMax = this.resolveChargesMax(snapshot);
    if (chargesMax > this.lastChargesMax || this.lastChargesMax === 3) {
      this.lastChargesMax = chargesMax;
    }

    // Se o servidor enviou chargesLeft via bossgate, use-o; senao, inferimos pela contagem interna
    let chargesLeft: number;
    if (this.lastChargesLeft >= 0) {
      // Dado autoritativo do servidor
      chargesLeft = this.lastChargesLeft;
    } else {
      // Estimativa interna: maximo - kills de hoje
      chargesLeft = Math.max(0, this.lastChargesMax - this.killsToday);
    }

    // Sem cargas: finaliza rotacao do dia
    if (chargesLeft <= 0) {
      this.runnerState = 'COMPLETED_DAY';
      if (this.previousHuntId && snapshot.isCity) {
        const hId = this.previousHuntId;
        this.previousHuntId = null;
        console.log(`[${new Date().toLocaleTimeString()}] [BOSS-RUNNER] Cargas diarias esgotadas (${this.killsToday}/${this.lastChargesMax}). Retomando hunt: ${hId}`);
        await roomSend(page, 'stage', { huntId: hId }).catch(() => null);
        return { handled: true, action: 'resume_hunt', detail: hId };
      }
      return { handled: false, detail: `sem_cargas_hoje (${this.killsToday}/${this.lastChargesMax})` };
    }

    // Intervalo de seguranca entre verificacoes de desafio (minimo 5s)
    if (now - this.lastAttemptAt < 5000) {
      return { handled: false };
    }

    // 5. Mescla cooldowns do servidor com os internos
    const mergedCooldowns: Record<string, number> = {
      ...this.internalCooldowns,
      ...snapshot.bossCooldowns,
    };

    // 6. Seleciona o proximo chefe da playlist configurada
    const playlist = config.autoBossPlaylist || [];
    const nextBoss = selectNextBoss(playlist, mergedCooldowns, chargesLeft, now);

    if (!nextBoss) {
      // Todos os chefes da playlist estao em cooldown
      if (this.previousHuntId && snapshot.isCity) {
        const hId = this.previousHuntId;
        this.previousHuntId = null;
        console.log(`[${new Date().toLocaleTimeString()}] [BOSS-RUNNER] Todos os chefes em recarga. Retomando hunt: ${hId}`);
        await roomSend(page, 'stage', { huntId: hId }).catch(() => null);
        return { handled: true, action: 'resume_hunt', detail: hId };
      }
      return { handled: false, detail: 'todos_em_recarga' };
    }

    // 7. So desafia se estiver em zona segura (cidade/templo) ou entre waves da hunt
    if (!snapshot.isCity && !isSafeTransition) {
      return { handled: false, detail: 'aguardando_transicao_segura' };
    }

    this.lastAttemptAt = now;
    if (currentHuntId && currentHuntId !== 'city' && currentHuntId !== 'templo') {
      this.previousHuntId = currentHuntId;
    }

    const accountType = snapshot.isVipAccount ? 'VIP' : 'Free';
    console.log(`[${new Date().toLocaleTimeString()}] [BOSS-RUNNER] [${accountType}] Desafiando: ${nextBoss} (${chargesLeft}/${this.lastChargesMax} cargas, ${this.killsToday} mortes hoje)...`);
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
