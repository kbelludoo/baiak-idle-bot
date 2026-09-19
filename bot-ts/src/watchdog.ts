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
          const retryBtn = document.getElementById('conn-retry') as HTMLElement | null;
          if (retryBtn) {
            retryBtn.click();
            reconnected = true;
            reason = 'CLICOU_RECONECTAR';
          }
        }

        // Se houver algum botão solto de reconectar (ex: 'Reassumir aqui' ou 'Entrar de novo')
        const anyRetry = Array.from(document.querySelectorAll('button')).find(b => 
          /reassumir|entrar|reconectar|reconnect|retry|tentar/i.test(b.textContent || '')
        ) as HTMLElement | undefined;
        if (anyRetry && !reconnected) {
          anyRetry.click();
          reconnected = true;
          reason = 'CLICOU_BOTAO_RECONEXAO_SOLTO';
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

      // 3. Checa inatividade do WebSocket (> 75s sem pacotes).
      // Farm estável gera poucos ROOM_DATA em farm lento; 45s recarregava a
      // página no meio da hunt e matava o reconnectionToken (volta p/ Cidade,
      // que o profiler contava como morte). 75s + 2 checagens consecutivas +
      // cooldown 30s evita reload em falso sem perder queda real. Reload é o
      // ÚLTIMO recurso: primeiro tenta o botão nativo do jogo.
      const inactiveMs = now - this.lastWsFrameTime;
      if (!this.wsConnected || inactiveMs > 75000) {
        this.consecutiveInactive += 1;
        if (this.consecutiveInactive < 2) return result;
        const inactiveSec = Math.round(inactiveMs / 1000);
        if (now - this.lastRecoveryAt < 30000) return result;
        this.lastRecoveryAt = now;
        this.recoveryAttempts += 1;
        if (this.recoveryAttempts > 3) {
          console.error('[WATCHDOG] 🧯 Três tentativas sem WebSocket; reiniciando processo limpo.');
          process.exit(1);
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
          // Uma única recarga controlada é preferível a manter um renderer
          // travado. Se o driver não responder, o Docker deve recriar tudo.
          console.log(`[WATCHDOG] ⚠️ Sem botão nativo; recarregando a página...`);
          try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
            result.reconnected = true;
            result.reason = 'RELOAD_PAGINA_RECONNECT_NATIVO';
            this.lastWsFrameTime = Date.now();
            this.bootStartedAt = Date.now();
          } catch (reloadErr: any) {
            console.error(`[WATCHDOG] 🧯 Reload sem resposta: ${reloadErr?.message || reloadErr}`);
            process.exit(1);
          }
        }
      }

    } catch (err) {
      // Ignora pequenos erros transitórios durante navegação
    }

    return result;
  }
}
