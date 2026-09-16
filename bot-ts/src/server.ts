import type { TelemetryState } from './types';
import type { Page, CDPSession } from 'puppeteer-core';

export interface ServerContext {
  getState: () => TelemetryState;
  getPage: () => Page | null;
  getCdp: () => CDPSession | null;
  getLatestFrame: () => Buffer | null;
}

export function startServer(port: number, host: string, ctx: ServerContext) {
  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // API: Status
      if (path === '/api/status' || path === '/api/status/') {
        const state = ctx.getState();
        return Response.json(state, { headers: corsHeaders });
      }

      // API: Eval
      if (path === '/api/eval' || path === '/api/eval/') {
        if (req.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
        }
        try {
          const body = await req.json() as { js?: string; expression?: string };
          const script = body.js || body.expression || 'document.title';
          const page = ctx.getPage();
          if (!page) {
            return Response.json({ ok: false, error: 'page_not_ready' }, { status: 503, headers: corsHeaders });
          }
          const result = await page.evaluate(script);
          return Response.json({ ok: true, result }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json({ ok: false, error: err?.message || String(err) }, { status: 500, headers: corsHeaders });
        }
      }

      // API: Click
      if (path === '/api/click' || path === '/api/click/') {
        if (req.method !== 'POST') {
          return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
        }
        try {
          const body = await req.json() as { x: number; y: number; button?: 'left' | 'right' | 'middle' };
          const cdp = ctx.getCdp();
          if (!cdp) {
            return Response.json({ ok: false, error: 'cdp_not_ready' }, { status: 503, headers: corsHeaders });
          }
          const x = Number(body.x) || 0;
          const y = Number(body.y) || 0;
          const btn = body.button || 'left';

          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: btn, clickCount: 1 });
          await new Promise(r => setTimeout(r, 20));
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: btn, clickCount: 1 });

          return Response.json({ ok: true, x, y, button: btn }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json({ ok: false, error: err?.message || String(err) }, { status: 500, headers: corsHeaders });
        }
      }

      // API: Live MJPEG Video Stream
      if (path === '/stream' || path === '/stream/') {
        let isClosed = false;
        const stream = new ReadableStream({
          async start(controller) {
            while (!isClosed) {
              const frame = ctx.getLatestFrame();
              if (frame) {
                const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
                controller.enqueue(Buffer.from(header));
                controller.enqueue(frame);
                controller.enqueue(Buffer.from('\r\n'));
              }
              await new Promise(r => setTimeout(r, 125)); // ~8 FPS
            }
          },
          cancel() {
            isClosed = true;
          }
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'close',
            'Pragma': 'no-cache',
            ...corsHeaders
          }
        });
      }

      // Dashboard Web HTML
      if (path === '/' || path === '/dashboard' || path === '/index.html') {
        return new Response(DASHBOARD_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders }
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
  });

  console.log(`[*] 🌐 [BUN HTTP] Servidor ativo em http://${host}:${port}/ (Dashboard & API em tempo real)`);
  return server;
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Baiak Idle Bot v2 (TypeScript / Bun)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
    .card { background: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid #334155; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .val { font-size: 20px; font-weight: bold; color: #38bdf8; }
    .lbl { font-size: 12px; color: #94a3b8; text-transform: uppercase; }
    #screen-wrap { position: relative; display: inline-block; border-radius: 8px; overflow: hidden; border: 2px solid #38bdf8; }
    #stream-img { display: block; max-width: 100%; height: auto; cursor: crosshair; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .badge-on { background: #059669; color: white; }
    .badge-off { background: #dc2626; color: white; }
  </style>
</head>
<body>
  <h2>⚔️ Baiak Idle Bot v2 <span style="font-size:14px;color:#38bdf8;">[100% TypeScript + Bun]</span></h2>
  <div class="card">
    <div class="grid">
      <div><div class="lbl">Status</div><div class="val" id="st-online">Conectando...</div></div>
      <div><div class="lbl">Hunt Atual</div><div class="val" id="st-hunt">—</div></div>
      <div><div class="lbl">Kills / Waves</div><div class="val"><span id="st-kills">0</span> / <span id="st-waves">0</span></div></div>
      <div><div class="lbl">Stamina / Pouch</div><div class="val"><span id="st-stam">—</span> | <span id="st-pouch">—</span></div></div>
      <div><div class="lbl">Campeões</div><div class="val" id="st-party">3</div></div>
    </div>
  </div>

  <div class="card">
    <div class="lbl" style="margin-bottom:8px;">Transmissão ao Vivo (Toque ou Clique para Interagir)</div>
    <div id="screen-wrap">
      <img id="stream-img" src="/stream" alt="Live Stream" onclick="sendClick(event)">
    </div>
  </div>

  <script>
    async function updateStatus() {
      try {
        const res = await fetch('/api/status');
        const d = await res.json();
        document.getElementById('st-online').innerHTML = d.online ? '<span class="badge badge-on">ONLINE</span>' : '<span class="badge badge-off">OFFLINE</span>';
        document.getElementById('st-hunt').textContent = d.hunt || '—';
        document.getElementById('st-kills').textContent = d.kills || 0;
        document.getElementById('st-waves').textContent = d.waves || 0;
        document.getElementById('st-stam').textContent = d.stamina || '—';
        document.getElementById('st-pouch').textContent = d.bag_slots || '—';
        document.getElementById('st-party').textContent = (d.shooters || []).length || 3;
      } catch(e) {}
    }
    setInterval(updateStatus, 1500);
    updateStatus();

    async function sendClick(e) {
      const img = e.target;
      const rect = img.getBoundingClientRect();
      const scaleX = 800 / rect.width;
      const scaleY = 540 / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      await fetch('/api/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y })
      });
    }
  </script>
</body>
</html>`;
