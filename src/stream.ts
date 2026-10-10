import type { Page, CDPSession } from 'puppeteer-core';

export const STREAM_W = 854;
export const STREAM_H = 480;
export const STREAM_FPS = 12;
export const STREAM_Q = 70;

export class LatestFrame {
  jpeg: Buffer = Buffer.alloc(0);
  seq = 0;
  width = STREAM_W;
  height = STREAM_H;
  fps = 0;
  lastTs = 0;
  private t0 = performance.now() / 1000;
  private n = 0;
  private waiters: Array<() => void> = [];

  push(jpeg: Buffer | Uint8Array | null | undefined, width = 0, height = 0): void {
    if (!jpeg || jpeg.length === 0) return;
    this.jpeg = Buffer.from(jpeg);
    this.seq++;
    this.lastTs = performance.now() / 1000;
    if (width) this.width = width;
    if (height) this.height = height;
    this.n++;
    const dt = this.lastTs - this.t0;
    if (dt >= 1.0) {
      const inst = this.n / dt;
      this.fps = this.fps <= 0 ? inst : this.fps * 0.55 + inst * 0.45;
      this.t0 = this.lastTs;
      this.n = 0;
    }
    const ws = this.waiters.splice(0);
    for (const w of ws) { try { w(); } catch (_) {} }
  }

  snapshot(): [Buffer, number] {
    return [this.jpeg, this.seq];
  }

  async waitNext(lastSeq: number, timeoutMs = 1000): Promise<[Buffer, number]> {
    if (this.seq !== lastSeq && this.jpeg.length > 0) return [this.jpeg, this.seq];
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve([this.jpeg, this.seq]);
      };
      const timer = setTimeout(finish, timeoutMs);
      this.waiters.push(() => { clearTimeout(timer); finish(); });
    });
  }

  stats(): Record<string, any> {
    const age = this.lastTs ? (performance.now() / 1000 - this.lastTs) : null;
    return {
      fps: Math.round(this.fps * 10) / 10,
      width: this.width,
      height: this.height,
      seq: this.seq,
      bytes: this.jpeg.length,
      ready: this.jpeg.length > 0,
      age_s: age !== null ? Math.round(age * 100) / 100 : null,
    };
  }
}

export class StreamPump {
  frames: LatestFrame;
  width: number;
  height: number;
  quality: number;
  fps: number;
  interval: number;
  mode: 'off' | 'cdp' | 'shot' = 'off';
  error = 'aguardando captura';
  private session: CDPSession | null = null;

  constructor(
    frames: LatestFrame,
    opts: { width?: number; height?: number; quality?: number; fps?: number } = {},
  ) {
    this.frames = frames;
    this.width = Math.max(320, Math.min(1280, Math.floor(opts.width ?? STREAM_W)));
    this.height = Math.max(240, Math.min(720, Math.floor(opts.height ?? STREAM_H)));
    this.quality = Math.max(40, Math.min(85, Math.floor(opts.quality ?? STREAM_Q)));
    this.fps = Math.max(4, Math.min(24, Math.floor(opts.fps ?? STREAM_FPS)));
    this.interval = 1.0 / this.fps;
  }

  stats(): Record<string, any> {
    const out = this.frames.stats();
    (out as any).mode = this.mode;
    (out as any).error = out.ready ? '' : this.error;
    return out;
  }

  async attachCdp(page: Page): Promise<void> {
    await this.stopCdp();
    try {
      const session = await page.createCDPSession();
      try { await session.send('Page.enable'); } catch (_) {}
      session.on('Page.screencastFrame', (params: any) => this.onCdpFrame(params));
      await session.send('Page.startScreencast', {
        format: 'jpeg',
        quality: this.quality,
        maxWidth: this.width,
        maxHeight: this.height,
        everyNthFrame: 1,
      });
      this.session = session;
      this.mode = 'cdp';
      this.error = '';
    } catch (e: any) {
      this.session = null;
      this.mode = 'shot';
      this.error = String(`cdp: ${e?.message || e}`).slice(0, 160);
    }
  }

  async tick(page: Page): Promise<void> {
    const age = this.frames.lastTs ? performance.now() / 1000 - this.frames.lastTs : 99;
    if (this.frames.jpeg.length > 0 && age < this.interval * 0.85) return;
    try {
      const raw = await page.screenshot({ type: 'jpeg', quality: this.quality } as any).catch(() => null) as Buffer | null;
      if (raw) {
        this.frames.push(raw, this.width, this.height);
        if (this.mode === 'cdp' && age > 1.2) this.mode = 'shot';
        else if (this.mode === 'off') this.mode = 'shot';
        this.error = '';
      }
    } catch (e: any) {
      this.error = String(`screenshot: ${e?.message || e}`).slice(0, 160);
    }
  }

  private async onCdpFrame(params: any): Promise<void> {
    const sid = params?.sessionId;
    if (sid !== undefined && this.session) {
      try { await this.session.send('Page.screencastFrameAck', { sessionId: sid }); } catch (_) {}
    }
    try {
      const raw = Buffer.from(params?.data || '', 'base64');
      if (raw.length > 0) {
        const md = params?.metadata || {};
        this.frames.push(raw, Number(md.deviceWidth || this.width), Number(md.deviceHeight || this.height));
        this.mode = 'cdp';
        this.error = '';
      }
    } catch (_) {}
  }

  async stopCdp(): Promise<void> {
    const sess = this.session;
    this.session = null;
    if (!sess) return;
    try { await sess.send('Page.stopScreencast'); } catch (_) {}
  }
}

// --- Filas de click/eval (paridade com stream.py) ---
interface ClickReq { x: number; y: number; button: string; resolve: (v: any) => void; }
interface EvalReq { js: string; resolve: (v: any) => void; }

const clickQueue: ClickReq[] = [];
const evalQueue: EvalReq[] = [];

export function enqueueClick(x: number, y: number, button = 'left', timeoutMs = 5000): Promise<any> {
  return new Promise((resolve) => {
    const req: ClickReq = { x, y, button, resolve };
    clickQueue.push(req);
    setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
  });
}

export function enqueueEval(js: string, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve) => {
    const req: EvalReq = { js, resolve };
    evalQueue.push(req);
    setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeoutMs);
  });
}

export async function processPendingEvals(page: Page): Promise<number> {
  let count = 0;
  while (evalQueue.length > 0) {
    const req = evalQueue.shift()!;
    try {
      const val = await page.evaluate(req.js);
      req.resolve({ ok: true, result: val });
      count++;
    } catch (e: any) {
      req.resolve({ ok: false, error: String(e?.message || e) });
    }
  }
  return count;
}

export async function processPendingClicks(page: Page, pump?: StreamPump | null, cdp?: CDPSession | null): Promise<number> {
  let count = 0;
  while (clickQueue.length > 0) {
    const req = clickQueue.shift()!;
    try {
      if (cdp) {
        const btn = req.button === 'right' ? 'right' : 'left';
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: req.x, y: req.y, button: btn, clickCount: 1 });
        await new Promise((r) => setTimeout(r, 60));
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: req.x, y: req.y, button: btn, clickCount: 1 });
      } else {
        await (page as any).mouse?.click?.(req.x, req.y, { button: req.button });
        await new Promise((r) => setTimeout(r, 60));
      }
      if (pump) {
        try {
          const raw = await page.screenshot({ type: 'jpeg', quality: pump.quality } as any).catch(() => null) as Buffer | null;
          if (raw) pump.frames.push(raw, pump.width, pump.height);
        } catch (_) {}
      }
      req.resolve({ ok: true, x: req.x, y: req.y, button: req.button });
      count++;
    } catch (e: any) {
      req.resolve({ ok: false, reason: String(e?.message || e) });
    }
  }
  return count;
}

export async function idleCapture(page: Page, pump: StreamPump | null, seconds: number, shouldContinue: () => boolean): Promise<void> {
  const end = Date.now() + Math.max(0, seconds) * 1000;
  const interval = pump ? pump.interval * 1000 : 100;
  while (shouldContinue() && Date.now() < end) {
    await processPendingClicks(page, pump);
    await processPendingEvals(page);
    const t0 = Date.now();
    if (pump) { try { await pump.tick(page); } catch (_) {} }
    const left = end - Date.now();
    if (left <= 0) break;
    const pause = interval - (Date.now() - t0);
    await new Promise((r) => setTimeout(r, Math.min(Math.max(0, pause), left)));
  }
}
