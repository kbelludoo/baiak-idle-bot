import type { Page, CDPSession } from 'puppeteer-core';

export interface WatchdogResult {
  reconnected: boolean;
  reason?: string;
  clearedModals: number;
}

export class Watchdog {
  private lastWsFrameTime = Date.now();
  private wsConnected = false;
  private everConnected = false;
  private bootStartedAt = Date.now();
  private lastRecoveryAt = 0;
  private recoveryAttempts = 0;
  private consecutiveInactive = 0;

  public onWsOpen() {
    this.wsConnected = true;
    this.everConnected = true;
    this.recoveryAttempts = 0;
    this.consecutiveInactive = 0;
    this.lastWsFrameTime = Date.now();
  }

  public onWsFrame() {
    this.lastWsFrameTime = Date.now();
    this.consecutiveInactive = 0;
  }

  public onWsClose() {
    this.wsConnected = false;
  }

  public keepAlive() {
    this.lastWsFrameTime = Date.now();
  }

  public isConnected(): boolean {
    return this.wsConnected;
  }

  public getInactiveSecs(): number {
    return Math.round((Date.now() - this.lastWsFrameTime) / 1000);
  }

  public async checkAndRecover(page: Page, cdp: CDPSession): Promise<WatchdogResult> {
    const result: WatchdogResult = { reconnected: false, clearedModals: 0 };
    const now = Date.now();

    try {
      // A entrada inicial monta centenas de sprites antes de criar a sala
      // Colyseus. Durante esse período até um page.evaluate simples pode
      // ficar enfileirado no renderer; não toque no DOM nem recarregue a
      // página enquanto o boot ainda está dentro da janela de 5 minutos.
      if (!this.everConnected && now - this.bootStartedAt < 300000) {
        return result;
      }

      // Não injeta input sintético. O modo idle do bot Python deliberadamente
      // não movimenta mouse/teclado, e o watchdog não deve criar esse sinal.
      // Executa apenas checagem de tela de desconexão e modais no DOM.
      const domCheck = await Promise.race([
        page.evaluate(() => {
        let reconnected = false;
        let reason = '';
        let cleared = 0;

        // Fecha modal offline ("Bem-vindo de volta" / Coletar)
        for (const b of Array.from(document.querySelectorAll('button, .btn, [role="button"]'))) {
          const txt = (b.textContent || '').trim().toLowerCase();
          if ((txt === 'coletar' || txt.includes('coletar')) && (!b.id || !b.id.includes('daily'))) {
            (b as HTMLElement).click();
            cleared++;
          }
        }

        const oflModal = document.getElementById('offline-modal');
        if (oflModal && !oflModal.classList.contains('hidden')) {
          const oflClose = document.getElementById('offline-modal-close') || oflModal.querySelector('button');
          if (oflClose) (oflClose as HTMLElement).click();
          oflModal.classList.add('hidden');
          cleared++;
        }

        // Checa tela de desconexão (#conn-overlay / #conn-retry)
        const connOverlay = document.getElementById('conn-overlay');
        if (connOverlay && !connOverlay.classList.contains('hidden')) {
          const retryBtn = (document.getElementById('conn-retry') || connOverlay.querySelector('button')) as HTMLElement | null;
          if (retryBtn) {
            retryBtn.click();
            reconnected = true;
            reason = 'CLICOU_RECONECTAR';
          }
        }

          return { reconnected, reason, cleared };
        }),
        new Promise<{ reconnected: boolean; reason: string; cleared: number }>((resolve) =>
          setTimeout(() => resolve({ reconnected: false, reason: 'DOM_TIMEOUT', cleared: 0 }), 5000)
        ),
      ]);

      if (domCheck.reconnected) {
        result.reconnected = true;
        result.reason = domCheck.reason;
      }
      result.clearedModals = domCheck.cleared;

      // 2. Checa se a URL saiu de /jogar/
      const currentUrl = page.url();
      if (!currentUrl.includes('/jogar')) {
        console.log(`[WATCHDOG] ⚠️ URL fora de /jogar/ (${currentUrl}). Recarregando...`);
        await page.goto('https://baiakidle.com/jogar/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        result.reconnected = true;
        result.reason = 'URL_FORA_DE_JOGAR';
      }

      // 3. Checa inatividade do WebSocket.
      // O Colyseus client nativo do jogo tenta reconectar automaticamente com
      // reconnectionToken (backoff 0s..16s). Recarregar antes disso invalida o
      // token e causa "seat reservation expired". Damos tolerância de 35s
      // quando desconectado e 90s em silêncio de frames.
      const inactiveMs = now - this.lastWsFrameTime;
      const inactiveThreshold = !this.wsConnected ? 35000 : 90000;
      if (inactiveMs > inactiveThreshold) {
        this.consecutiveInactive += 1;
        if (this.consecutiveInactive < 3) return result;
        const inactiveSec = Math.round(inactiveMs / 1000);
        if (now - this.lastRecoveryAt < 30000) return result;
        this.lastRecoveryAt = now;
        this.recoveryAttempts += 1;
        if (this.recoveryAttempts > 5) {
          console.warn('[WATCHDOG] ⚠️ Múltiplas tentativas sem WebSocket; reabrindo URL /jogar/ de forma limpa...');
          this.recoveryAttempts = 0;
          this.lastWsFrameTime = Date.now();
          this.bootStartedAt = Date.now();
          try {
            await page.goto('https://baiakidle.com/jogar/', { waitUntil: 'domcontentloaded', timeout: 30000 });
            result.reconnected = true;
            result.reason = 'GOTO_JOGAR_WATCHDOG';
          } catch (_) {}
          return result;
        }
        console.log(`[WATCHDOG] ⚠️ Conexão inativa há ${inactiveSec}s. Tentativa ${this.recoveryAttempts}...`);

        // Primeiro tenta clicar no botão de reconectar nativo do jogo
        const clicked = await Promise.race([
          page.evaluate(() => {
            const retryBtn = document.getElementById('conn-retry');
            if (retryBtn) {
              retryBtn.click();
              return true;
            }
            return false;
          }).catch(() => false),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
        ]);

        if (clicked) {
          result.reconnected = true;
          result.reason = 'CLICOU_CONN_RETRY_WATCHDOG';
        } else {
          // Uma única recarga controlada quando não há botão nativo
          console.log(`[WATCHDOG] ⚠️ Sem botão nativo; recarregando a página...`);
          try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
            result.reconnected = true;
            result.reason = 'RELOAD_PAGINA_RECONNECT_NATIVO';
            this.lastWsFrameTime = Date.now();
            this.bootStartedAt = Date.now();
          } catch (reloadErr: any) {
            console.warn(`[WATCHDOG] Reload timeout/aviso: ${reloadErr?.message || reloadErr}`);
          }
        }
      }

    } catch (err) {
      // Ignora pequenos erros transitórios durante navegação
    }

    return result;
  }
}
