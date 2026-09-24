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
  onWsFrame: (meta?: { requestId: string; url: string; opcode: number }) => void,
  onWsClose: () => void,
  onWsPayload?: (payload: Uint8Array, meta?: { requestId: string; url: string; opcode: number }) => void
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
    // PixiJS 8 tenta WebGPU antes do WebGL no desktop. Em headless VPS o
    // WebGPU pode ficar pendurado no adapter; force o fallback WebGL/SwiftShader.
    '--disable-features=AudioServiceOutOfProcess,Translate,BackForwardCache,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion,WebGPU,site-per-process',
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
    '--js-flags=--max-old-space-size=256',
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
    // VPS com CPU compartilhada pode levar mais de 30s para expor o
    // endpoint CDP na primeira inicialização do Chromium.
    timeout: 120000,
    protocolTimeout: 300000,
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
    try {
      // O motor do jogo só precisa do WebGL; esconder WebGPU evita que o
      // renderer aguarde indefinidamente um adapter inexistente na VPS.
      Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true });
    } catch (e) {}
    try {
      // A economia de bateria é uma tela idle da própria UI, não apenas um
      // filtro visual: em algumas contas ela congela a wave em 1/10. O TS já
      // reduz áudio/efeitos separadamente, então começa com esse modo
      // desligado e deixa o combate autoritativo continuar.
      localStorage.setItem('bs-enabled', '0');
      const __baiakSettings = JSON.parse(localStorage.getItem('baiakidle.settings') || '{}');
      __baiakSettings.batterySave = false;
      localStorage.setItem('baiakidle.settings', JSON.stringify(__baiakSettings));
    } catch (e) {}

    ${config.token ? `
      try {
        // Add Bearer only to game-domain fetch/XHR calls. A page-wide extra
        // header also reaches Cloudflare's optional beacon and causes a CORS
        // preflight, delaying domcontentloaded on the VPS.
        const __baiakToken = ${JSON.stringify(config.token)};
        const __isBaiakUrl = (value) => {
          try {
            const host = new URL(String(value), location.href).hostname.toLowerCase();
            return host === 'baiakidle.com' || host.endsWith('.baiakidle.com');
          }
          catch (_) { return false; }
        };
        const __nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const rawUrl = typeof input === 'string' ? input : input?.url;
          if (!__isBaiakUrl(rawUrl)) return __nativeFetch(input, init);
          const headers = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined));
          headers.set('Authorization', 'Bearer ' + __baiakToken);
          return __nativeFetch(input, { ...(init || {}), headers });
        };
        const __nativeOpen = XMLHttpRequest.prototype.open;
        const __nativeSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this.__baiakUrl = String(url);
          return __nativeOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function(body) {
          if (__isBaiakUrl(this.__baiakUrl)) {
            try { this.setRequestHeader('Authorization', 'Bearer ' + __baiakToken); } catch (_) {}
          }
          return __nativeSend.call(this, body);
        };
      } catch (e) {}
    ` : ''}
    try {
      // PixiJS selects WebGPU on desktop before falling back to WebGL. The
      // game's own mobile branch explicitly requests WebGL, so advertise the
      // coarse-pointer capability only for that feature query. This keeps the
      // viewport/UA unchanged while making the renderer deterministic on a
      // headless VPS with SwiftShader.
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        if (query === '(pointer: coarse) and (hover: none)') {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return false; },
          };
        }
        return nativeMatchMedia(query);
      };
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
        // Reduzir efeitos não pode ativar a tela idle de economia: nessa
        // build ela congela a sala em 1/10 quando o navegador fica sem
        // interação. O script de VFX trata a redução visual separadamente.
        localStorage.setItem('bs-enabled', '0');
        localStorage.setItem('baiakidle.settings', JSON.stringify({
          fxOpacity: 0, music: 0, soundMaster: 0, batterySave: false
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

  // Monitoramento de WebSocket e Interceptação de Frames Colyseus.
  // A página abre hunt + partyhunt + chat + queue em paralelo. Eles NÃO podem
  // compartilhar um único booleano online: fechar o chat não é cair da hunt.
  // Por isso rastreamos cada socket por requestId e só consideramos offline
  // quando NENHUM socket de jogo resta aberto. O payload também carrega
  // requestId/url/opcode para o handler separar queue/hunt/chat.
  const gameSockets = new Map<string, { url: string; room: string }>();
  let wsCloseTimer: any = null;
  const guessRoom = (url: string): string => {
    const u = (url || '').toLowerCase();
    if (u.includes('partyhunt')) return 'partyhunt';
    if (u.includes('queue')) return 'queue';
    if (u.includes('chat')) return 'chat';
    if (u.includes('hunt')) return 'hunt';
    if (u.includes('/rt')) return 'rt';
    return 'unknown';
  };
  const isGameSocket = (url: string) => /baiakidle\.com/i.test(url || '');
  const anyGameSocketOpen = () => gameSockets.size > 0;
  await cdp.send('Network.enable').then(() => {
    console.log('[*] [WS-TS] Monitoramento CDP de WebSocket habilitado.');
  }).catch((err: any) => {
    console.warn(`[WS-TS] Falha ao habilitar Network CDP: ${err?.message || err}`);
  });
  cdp.on('Network.webSocketWillSendHandshakeRequest', (params: any) => {
    const url = String(params?.request?.url || '');
    if (url) console.log(`[*] [WS-TRACE] Handshake solicitado: ${url.slice(0, 180)}`);
  });
  cdp.on('Network.webSocketCreated', (params: any) => {
    const requestId = String(params?.requestId || '');
    const url = String(params?.url || '');
    if (url) console.log(`[*] [WS-TRACE] Socket criado: ${url.slice(0, 180)}`);
    if (requestId && isGameSocket(url)) {
      const wasEmpty = gameSockets.size === 0;
      gameSockets.set(requestId, { url, room: guessRoom(url) });
      console.log(`[*] [WS-TS] Socket do jogo criado: [${guessRoom(url)}] ${url.slice(0, 120)} (total=${gameSockets.size})`);
      if (wsCloseTimer) {
        clearTimeout(wsCloseTimer);
        wsCloseTimer = null;
      }
      if (wasEmpty) onWsOpen();
    }
  });
  cdp.on('Network.webSocketFrameReceived', (params: any) => {
    const requestId = String(params?.requestId || '');
    const sock = gameSockets.get(requestId);
    if (!sock) return;
    const opcode = Number(params?.response?.opcode ?? 2);
    const raw = params?.response?.payloadData;
    onWsFrame({ requestId, url: sock.url, opcode });
    if (onWsPayload && typeof raw === 'string' && raw.length > 0) {
      try {
        // CDP entrega binário como base64 (opcode 2) e texto como utf-8
        // (opcode 1: PING/PONG/handshake). Frames fragmentados do Colyseus
        // chegam como Blob no page mas como frames separados no CDP — cada
        // frame aqui já é um pacote completo, nunca fatiar no meio.
        const buf = opcode === 2 ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf-8');
        if (buf.length > 0) onWsPayload(buf, { requestId, url: sock.url, opcode });
      } catch (_) {}
    }
  });
  cdp.on('Network.webSocketFrameSent', (params: any) => {
    // Mantém o watchdog vivo em farm silencioso: o cliente envia PING/ready
    // mesmo quando o servidor não tem loot/combatlog para empurrar.
    const requestId = String(params?.requestId || '');
    if (!gameSockets.has(requestId)) return;
    const sock = gameSockets.get(requestId)!;
    onWsFrame({ requestId, url: sock.url, opcode: Number(params?.response?.opcode ?? 1) });
  });
  cdp.on('Network.webSocketClosed', (params: any) => {
    const requestId = String(params?.requestId || '');
    const sock = gameSockets.get(requestId);
    if (!sock) return;
    gameSockets.delete(requestId);
    console.log(`[*] [WS-TS] Socket fechado: [${sock.room}] restam=${gameSockets.size}`);
    // Só derruba online quando o ÚLTIMO socket de jogo fecha.
    // Usamos debounce de 4s para absorver reconexões rápidas do Colyseus sem
    // resetar uptime nem acionar o watchdog precocemente.
    if (!anyGameSocketOpen()) {
      if (wsCloseTimer) clearTimeout(wsCloseTimer);
      wsCloseTimer = setTimeout(() => {
        if (!anyGameSocketOpen()) {
          console.warn('[*] [WS-TS] Nenhum socket de jogo aberto após 4s de tolerância. Disparando onWsClose.');
          onWsClose();
        }
        wsCloseTimer = null;
      }, 4000);
    }
  });

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
  page.on('request', (req: any) => {
    try {
      const type = req.resourceType?.();
      const url = req.url();
      if (type === 'websocket') {
        console.log(`[*] [WS-REQUEST] ${url.slice(0, 180)}`);
      } else if (['document', 'xhr', 'fetch'].includes(type) && /baiakidle\.com/i.test(url)) {
        console.log(`[*] [NET-REQUEST] ${type} ${url.slice(0, 180)}`);
      }
    } catch (_) {}
  });
  page.on('framenavigated', (frame: any) => {
    try {
      if (frame === page.mainFrame()) console.log(`[*] [NAV] ${frame.url().slice(0, 180)}`);
    } catch (_) {}
  });
  page.on('response', (res: any) => {
    try {
      const url = res.url();
      // Asset loading can produce hundreds of successful image responses.
      // Logging every sprite blocks the Bun stdout pipe on a small VPS and
      // delays the renderer/WebSocket boot. Keep only API checkpoints and
      // failures; the request/WS hooks still provide full diagnostics.
      const important = /baiakidle\.com\/api\/trpc\/(auth\.me|characters\.|account\.)/i.test(url)
        || /baiakidle\.com\/api\/things\/manifest\.json/i.test(url)
        || res.status() >= 400;
      if (important) {
        console.log(`[*] [NET-RESPONSE] ${res.status()} ${url.slice(0, 180)}`);
      }
    } catch (_) {}
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
