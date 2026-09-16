import puppeteer, { type Browser, type Page, type CDPSession } from 'puppeteer-core';
import type { BotConfig } from './types';
import { KERNEL_SOURCE } from './kernel';

export interface BrowserContext {
  browser: Browser;
  page: Page;
  cdp: CDPSession;
  getLatestFrame: () => Buffer | null;
  close: () => Promise<void>;
}

export async function launchBrowser(
  config: BotConfig,
  onWsOpen: () => void,
  onWsFrame: () => void,
  onWsClose: () => void
): Promise<BrowserContext> {
  let latestFrame: Buffer | null = null;

  const browser = await puppeteer.launch({
    executablePath: config.chromePath,
    headless: config.headless ? 'shell' : false,
    userDataDir: config.userDataDir,
    defaultViewport: {
      width: config.streamWidth,
      height: config.streamHeight,
      deviceScaleFactor: 1,
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--disable-software-rasterizer',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--mute-audio',
      `--window-size=${config.streamWidth},${config.streamHeight}`,
    ],
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.setViewport({ width: config.streamWidth, height: config.streamHeight });

  // Injeta o Kernel nativo em memória antes de qualquer documento carregar
  await page.evaluateOnNewDocument(KERNEL_SOURCE);

  // Inicia sessão CDP nativa
  const cdp = await page.createCDPSession();

  // Monitoramento de WebSocket
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketCreated', () => onWsOpen());
  cdp.on('Network.webSocketFrameReceived', () => onWsFrame());
  cdp.on('Network.webSocketClosed', () => onWsClose());

  // Captura de Screencast contínua via CDP para o Stream de Vídeo
  if (config.stream) {
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: config.streamQuality,
      maxWidth: config.streamWidth,
      maxHeight: config.streamHeight,
      everyNthFrame: 1,
    });

    cdp.on('Page.screencastFrame', async (params) => {
      try {
        latestFrame = Buffer.from(params.data, 'base64');
        await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
      } catch (_) {}
    });
  }

  // Tratamento de diálogos do navegador (auto-aceitar)
  page.on('dialog', async (d) => {
    try {
      console.log(`[DIALOG] ${d.type()}: ${d.message()}. Auto-aceitando...`);
      await d.accept();
    } catch (_) {}
  });

  console.log(`[*] [BROWSER-TS] Navegando para ${config.targetUrl} ...`);
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log(`[*] [BROWSER-TS] Página carregada com sucesso.`);

  return {
    browser,
    page,
    cdp,
    getLatestFrame: () => latestFrame,
    close: async () => {
      try {
        await browser.close();
      } catch (_) {}
    },
  };
}
