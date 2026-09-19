import puppeteer, { type Browser, type Page, type CDPSession } from 'puppeteer-core';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
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
  onWsClose: () => void,
  onWsPayload?: (payload: Uint8Array) => void
): Promise<BrowserContext> {
  let latestFrame: Buffer | null = null;

  // Remove locks residuais do Chromium (incluindo dangling symlinks)
  if (config.userDataDir) {
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try {
        const lp = join(config.userDataDir, f);
        unlinkSync(lp);
        console.log(`[*] [BROWSER] Removido lock residual do perfil: ${f}`);
      } catch (_) {}
    }
  }

  const baseArgs = [
    // Segurança / sandbox
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    // Audio
    '--disable-audio-output',
    '--mute-audio',
    // Anti-detecção
    '--disable-blink-features=AutomationControlled',
    // Reduz processos / memória (VPS 1-core)
    '--disable-extensions',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-breakpad',
    '--disable-domain-reliability',
    '--disable-features=AudioServiceOutOfProcess,Translate,BackForwardCache,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion,site-per-process',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--metrics-recording-only',
    '--no-first-run',
    '--password-store=basic',
    '--use-mock-keychain',
    '--renderer-process-limit=1',
    '--js-flags=--max-old-space-size=96',
    '--remote-debugging-port=9222',
    '--remote-debugging-address=0.0.0.0',
    '--lang=pt-BR',
  ];

  // O viewport do jogo é independente da resolução opcional do stream.
  // O Python usa 800x540 por padrão; o stream pode continuar em 854x480.
  const browserWidth = Math.max(320, Number(process.env.CHROME_WIDTH || 800));
  const browserHeight = Math.max(240, Number(process.env.CHROME_HEIGHT || 540));
  baseArgs.push(`--window-size=${browserWidth},${browserHeight}`);

  const useSwiftShader = config.chromeGl !== 'off' && config.chromeGl !== 'none' && config.chromeGl !== '0';
  const glArgs = useSwiftShader
    ? [
        // SwiftShader (WebGL via CPU por software) — idêntico ao Python chrome.py
        // Essencial para renderizar o canvas/PixiJS sem travar em "Montando o mapa..."
        '--enable-unsafe-swiftshader',
        '--use-gl=swiftshader',
        '--use-angle=swiftshader-webgl',
        '--disable-gpu-compositing',
        '--disable-partial-raster',
        '--disable-gpu-memory-buffer-video-frames',
      ]
    : [
        '--disable-gpu',
        '--disable-gpu-compositing',
        '--disable-gpu-sandbox',
        '--disable-software-rasterizer',
        '--disable-webgl',
        '--disable-webgl2',
        '--disable-3d-apis',
        '--use-gl=egl',
        '--gpu-no-context-lost',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-jpeg-decoding',
        '--disable-accelerated-mjpeg-decode',
        '--disable-accelerated-video-decode',
        '--disable-accelerated-video-encode',
        '--disable-gpu-memory-buffer-video-frames',
        '--disable-partial-raster',
      ];

  const browser = await puppeteer.launch({
    executablePath: config.chromePath,
    headless: config.headless,
    userDataDir: config.userDataDir,
    protocolTimeout: 120000,
    // Mesmo UA do bot Python para evitar uma segunda combinação de cliente na VPS.
    env: process.env,
    defaultViewport: {
      width: browserWidth,
      height: browserHeight,
      deviceScaleFactor: 1,
    },
    args: [...baseArgs, ...glArgs],
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.setViewport({ width: browserWidth, height: browserHeight });
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  );

  // Injeta autenticação se fornecido token
  if (config.token) {
    try {
      await page.setCookie(
        { name: 'baiak-idle-token', value: config.token, domain: 'baiakidle.com', path: '/' },
        { name: 'idle.auth.token', value: config.token, domain: 'baiakidle.com', path: '/' },
        { name: 'token', value: config.token, domain: 'baiakidle.com', path: '/' }
      );
      console.log('[*] [AUTH] Token de sessão injetado com sucesso nos cookies!');
    } catch (err) {
      console.warn('[COOKIE AVISO]', err);
    }
  }

  // Scripts de inicialização, anti-detecção e token em localStorage
  // NOTA: nunca sobrescrever window.chrome com shim (assinatura clássica de bot)
  // e nunca mexer em Event.prototype.isTrusted. Paridade com bot.py.
  await page.evaluateOnNewDocument(`
    try {
      delete Object.getPrototypeOf(navigator).webdriver;
    } catch (e) {}
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    } catch (e) {}
    try {
      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
    } catch (e) {}

    // Modo leve experimental: o servidor continua recebendo WebSocket e o DOM
    // continua funcional, mas o ticker visual não precisa rodar a 60 FPS.
    // Não altera getContext nem o tamanho do canvas: isso pode invalidar Pixi.
    ${process.env.GRAPHICS_THROTTLE === 'true' ? `
      try {
        const frameDelay = Math.max(250, Number(${Number(process.env.GRAPHICS_THROTTLE_MS || 1000)}) || 1000);
        const nativeRaf = window.requestAnimationFrame.bind(window);
        const nativeCancel = window.cancelAnimationFrame.bind(window);
        let nextId = 1;
        const timers = new Map();
        window.requestAnimationFrame = (callback) => {
          const id = nextId++;
          const timer = setTimeout(() => {
            timers.delete(id);
            callback(performance.now());
          }, frameDelay);
          timers.set(id, timer);
          return id;
        };
        window.cancelAnimationFrame = (id) => {
          const timer = timers.get(id);
          if (timer !== undefined) {
            clearTimeout(timer);
            timers.delete(id);
          } else {
            nativeCancel(id);
          }
        };
        const style = document.createElement('style');
        style.textContent = '*,:before,:after{animation:none!important;transition:none!important}';
        (document.head || document.documentElement).appendChild(style);
      } catch (e) {}
    ` : ''}

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
        localStorage.setItem('baiakidle.settings', JSON.stringify({
          fxOpacity: 0, music: 0, soundMaster: 0, batterySave: true
        }));
      } catch (e) {}
    ` : ''}
  `);

  try {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  } catch (_) {}

  // O hook profundo do motor fica opt-in enquanto o schema da build é mapeado.
  // O bot continua funcional via CDP + scripts DOM quando desativado.
  if (process.env.ENABLE_KERNEL !== 'false') {
    await page.evaluateOnNewDocument(KERNEL_SOURCE);
  }

  // Inicia sessão CDP nativa
  const cdp = await page.createCDPSession();

  // Monitoramento de WebSocket e Interceptação de Frames Colyseus
  await cdp.send('Network.enable').catch(() => {});
  cdp.on('Network.webSocketCreated', () => onWsOpen());
  cdp.on('Network.webSocketFrameReceived', (params: any) => {
    onWsFrame();
    if (onWsPayload && params?.response?.payloadData) {
      try {
        const opcode = params.response.opcode;
        const raw = params.response.payloadData;
        const buf = opcode === 2 ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf-8');
        onWsPayload(buf);
      } catch (_) {}
    }
  });
  cdp.on('Network.webSocketClosed', () => onWsClose());

  // Captura de Screencast contínua em sessão CDP isolada (para não afogar chamadas de evaluate)
  if (config.stream) {
    try {
      const streamCdp = await page.createCDPSession();
      await streamCdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: config.streamQuality || 50,
        maxWidth: config.streamWidth || 800,
        maxHeight: config.streamHeight || 540,
        everyNthFrame: 25,
      });

      streamCdp.on('Page.screencastFrame', async (params: any) => {
        try {
          latestFrame = Buffer.from(params.data, 'base64');
          await streamCdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
        } catch (_) {}
      });
    } catch (_) {}
  }

  // Logs de console e erros da página para diagnóstico
  page.on('console', msg => {
    const t = msg.text();
    if (/colyseus|error|ws|token|auth|warn|fail|sala|room|mapa|sprite|textur|conect/i.test(t)) console.log(`[PAGE LOG] ${t}`);
  });
  page.on('pageerror', (err: any) => {
    console.log(`[PAGE ERROR] ${err?.message || err}`);
  });
  page.on('requestfailed', (req: any) => {
    const failure = req.failure?.()?.errorText || 'unknown';
    console.log(`[REQUEST FAILED] ${req.url()} ${failure}`);
  });

  // Tratamento de diálogos do navegador (auto-aceitar)
  page.on('dialog', async (d) => {
    try {
      console.log(`[DIALOG] ${d.type()}: ${d.message()}. Auto-aceitando...`);
      await d.accept();
    } catch (_) {}
  });

  console.log(`[*] [BROWSER-TS] Navegando para ${config.targetUrl} ...`);
  try { await page.setBypassServiceWorker(true); } catch (_) {}
  try {
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log(`[*] [BROWSER-TS] Página carregada com sucesso.`);
  } catch (err: any) {
    // O jogo mantém requests longos de assets/WebSocket. Igual ao Playwright
    // do bot Python, timeout de navegação não encerra a sessão: o loop de boot
    // verifica o DOM e continua quando a página finalmente fica utilizável.
    console.warn(`[*] [BROWSER-TS] Navegação continuou após aviso: ${err?.message || err}`);
  }

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
