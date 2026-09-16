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

  public async checkAndRecover(page: Page, cdp: CDPSession): Promise<WatchdogResult> {
    const result: WatchdogResult = { reconnected: false, clearedModals: 0 };
    const now = Date.now();

    try {
      // 1. Emite presença humana real via CDP (isTrusted: true)
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 2 + Math.floor(Math.random() * 4),
        y: 2 + Math.floor(Math.random() * 4),
      }).catch(() => {});

      // 2. Executa checagem de tela de desconexão e modais no DOM
      const domCheck = await page.evaluate(() => {
        let reconnected = false;
        let reason = '';
        let cleared = 0;

        // Fecha modal offline ("Bem-vindo de volta" / Coletar)
        const coletarBtn = Array.from(document.querySelectorAll('button, .btn, [role="button"]')).find(b =>
          (b as HTMLElement).offsetParent !== null && (b.textContent || '').trim().toLowerCase().includes('coletar') && !b.id.includes('daily')
        ) as HTMLElement | undefined;
        if (coletarBtn) {
          coletarBtn.click();
          cleared++;
        }

        const oflModal = document.getElementById('offline-modal');
        if (oflModal && !oflModal.classList.contains('hidden')) {
          const oflClose = document.getElementById('offline-modal-close') || oflModal.querySelector('button');
          if (oflClose && (oflClose as HTMLElement).offsetParent !== null) (oflClose as HTMLElement).click();
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

      // 3. Checa se a URL saiu de /jogar/
      const currentUrl = page.url();
      if (!currentUrl.includes('/jogar')) {
        console.log(`[WATCHDOG] ⚠️ URL fora de /jogar/ (${currentUrl}). Recarregando...`);
        await page.goto('https://baiakidle.com/jogar/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        result.reconnected = true;
        result.reason = 'URL_FORA_DE_JOGAR';
      }

      // 4. Checa watchdog de inatividade do WebSocket (> 45s sem pacotes)
      if (now - this.lastWsFrameTime > 45000) {
        console.log(`[WATCHDOG] ⚠️ WebSocket inativo há ${Math.round((now - this.lastWsFrameTime) / 1000)}s. Tentando reconectar...`);
        await page.evaluate(() => {
          const retryBtn = document.getElementById('conn-retry');
          if (retryBtn) retryBtn.click();
        }).catch(() => {});
        this.lastWsFrameTime = now;
      }

    } catch (err) {
      // Ignora pequenos erros transitórios durante navegação
    }

    return result;
  }
}
