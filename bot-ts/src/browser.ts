import puppeteer, { type Browser, type Page, type CDPSession } from 'puppeteer-core';
import type { BotConfig } from './types';
import type { WsFrameInfo } from './protocol';
import { KERNEL_SOURCE } from './kernel';
import { loadLegacyScript } from './legacyScripts';

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
  onWsFrame: (frame: WsFrameInfo) => void,
  onWsClose: () => void,
): Promise<BrowserContext> {
  let latestFrame: Buffer | null = null;

  const browser = await puppeteer.launch({
    executablePath: config.chromePath,
    headless: config.headless ? 'shell' : false,
    userDataDir: config.userDataDir,
    defaultViewport: { width: config.streamWidth, height: config.streamHeight, deviceScaleFactor: 1 },
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote',
      '--disable-software-rasterizer', '--disable-background-networking', '--disable-default-apps', '--disable-sync',
      '--mute-audio', `--window-size=${config.streamWidth},${config.streamHeight}`,
    ],
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.setViewport({ width: config.streamWidth, height: config.streamHeight });
  page.setDefaultTimeout(15_000);

  if (config.token) {
    try {
      await page.setCookie(
        { name: 'baiak-idle-token', value: config.token, domain: 'baiakidle.com', path: '/' },
        { name: 'idle.auth.token', value: config.token, domain: 'baiakidle.com', path: '/' },
        { name: 'token', value: config.token, domain: 'baiakidle.com', path: '/' },
      );
      console.log('[*] [AUTH] Token de sessão injetado nos cookies.');
    } catch (err) { console.warn('[COOKIE AVISO]', err); }
  }

  await page.evaluateOnNewDocument(`
    try { delete Object.getPrototypeOf(navigator).webdriver; } catch (e) {}
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {}
    try { window.chrome = { runtime: {}, app: {}, loadTimes: () => {}, csi: () => {} }; } catch (e) {}
    try { Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] }); } catch (e) {}
    try { Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] }); } catch (e) {}
    ${config.token ? `
      try {
        localStorage.setItem('baiak-idle-token', ${JSON.stringify(config.token)});
        localStorage.setItem('idle.auth.token', ${JSON.stringify(config.token)});
        localStorage.setItem('token', ${JSON.stringify(config.token)});
      } catch (e) {}
    ` : ''}
    ${config.reduceVfx ? `
      try {
        localStorage.setItem('bs-enabled', '1');
        localStorage.setItem('baiakidle.settings', JSON.stringify({ fxOpacity: 0, music: 0, soundMaster: 0, batterySave: true }));
      } catch (e) {}
    ` : ''}
  `);

  const kernelSource = await loadLegacyScript('kernel_bot.js').catch(() => KERNEL_SOURCE);
  await page.evaluateOnNewDocument(kernelSource);

  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Page.enable').catch(() => {});
  cdp.on('Network.webSocketCreated', () => onWsOpen());
  cdp.on('Network.webSocketFrameReceived', (params: any) => {
    const response = params?.response || {};
    onWsFrame({ opcode: Number(response.opcode || 0), payloadData: String(response.payloadData || '') });
  });
  cdp.on('Network.webSocketClosed', () => onWsClose());

  if (config.stream) {
    await cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: config.streamQuality, maxWidth: config.streamWidth,
      maxHeight: config.streamHeight, everyNthFrame: 1,
    });
    cdp.on('Page.screencastFrame', async (params: any) => {
      try {
        latestFrame = Buffer.from(params.data, 'base64');
        await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
      } catch (_) {}
    });
  }

  page.on('dialog', async (d: any) => {
    try { console.log(`[DIALOG] ${d.type()}: ${d.message()}. Auto-aceitando...`); await d.accept(); } catch (_) {}
  });
  page.on('pageerror', (err: any) => console.warn('[PAGE ERROR]', err.message));

  console.log(`[*] [BROWSER-TS] Navegando para ${config.targetUrl} ...`);
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  console.log('[*] [BROWSER-TS] Página carregada.');

  return {
    browser, page, cdp, getLatestFrame: () => latestFrame,
    close: async () => { try { await browser.close(); } catch (_) {} },
  };
}
