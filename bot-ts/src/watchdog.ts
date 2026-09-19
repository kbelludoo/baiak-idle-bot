import type { Page, CDPSession } from 'puppeteer-core';

export interface WatchdogResult {
  reconnected: boolean;
  reason?: string;
  clearedModals: number;
}

export class Watchdog {
  private lastWsFrameTime = Date.now();
  private wsConnected = false;

  public onWsOpen() {
    this.wsConnected = true;
    this.lastWsFrameTime = Date.now();
  }

  public onWsFrame() {
    this.lastWsFrameTime = Date.now();
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
      // Não injeta input sintético. O modo idle do bot Python deliberadamente
      // não movimenta mouse/teclado, e o watchdog não deve criar esse sinal.
      // Executa apenas checagem de tela de desconexão e modais no DOM.
      const domCheck = await page.evaluate(() => {
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
          if (retryBtn && retryBtn.offsetParent !== null) {
            retryBtn.click();
            reconnected = true;
            reason = 'CLICOU_RECONECTAR';
          }
        }

        // Se houver algum botão solto de reconectar
        const anyRetry = Array.from(document.querySelectorAll('button')).find(b => 
          (b as HTMLElement).offsetParent !== null && /reconectar|reconnect|retry/i.test(b.textContent || '')
        ) as HTMLElement | undefined;
        if (anyRetry && !reconnected) {
          anyRetry.click();
          reconnected = true;
          reason = 'CLICOU_BOTAO_RECONEXAO_SOLTO';
        }

        return { reconnected, reason, cleared };
      });

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

      // 3. Checa watchdog de inatividade do WebSocket (> 120s sem pacotes — paridade com bot.py)
      if (now - this.lastWsFrameTime > 120000) {
        console.log(`[WATCHDOG] ⚠️ WebSocket inativo há ${Math.round((now - this.lastWsFrameTime) / 1000)}s. Tentando reconectar...`);

        // Primeiro tenta clicar no botão de reconectar
        const clicked = await page.evaluate(() => {
          const retryBtn = document.getElementById('conn-retry');
          if (retryBtn && retryBtn.offsetParent !== null) {
            retryBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        // Se não tem botão, recarrega a página após 180s
        if (!clicked && now - this.lastWsFrameTime > 180000) {
          console.log(`[WATCHDOG] ⚠️ Sem botão de reconexão. Recarregando página...`);
          await page.goto('https://baiakidle.com/jogar/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          result.reconnected = true;
          result.reason = 'RELOAD_WS_INATIVO_180S';
          this.lastWsFrameTime = now;
        }
      }

    } catch (err) {
      // Ignora pequenos erros transitórios durante navegação
    }

    return result;
  }
}
