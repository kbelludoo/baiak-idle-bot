/**
 * Agregador de frota: junta os 3 painéis HTTP dos bots (8080/8082/8083) num
 * único endpoint para o dashboard do GitHub Pages.
 *
 *   bun run src/term/fleet_server.ts
 *
 * Endpoints:
 *   GET  /api/fleet          -> { fleet: {...}, bots: { acc1, acc2, acc3 } }
 *   GET  /api/status         -> status cru da acc1 (compat com dashboard antigo)
 *   POST /api/action         -> { bot: 'acc1'|'acc2'|'acc3', ...resto }
 *   GET  /                   -> docs/index.html
 *
 * Escreve direto no loopback, então os painéis aceitam sem CONTROL_TOKEN.
 */
import { HUNTS_TABLE } from '../hunts';

const PORT = Number(process.env.FLEET_PORT ?? 8090);
const TIMEOUT_MS = Number(process.env.FLEET_TIMEOUT_MS ?? 2500);

export const FLEET_BOTS: Array<{ key: string; label: string; port: number }> = [
  { key: 'acc1', label: 'Conta 1', port: 8080 },
  { key: 'acc2', label: 'Conta 2', port: 8082 },
  { key: 'acc3', label: 'Conta 3', port: 8083 },
];

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-api-key',
};

async function fetchJson(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function botName(status: any): string {
  const chars: any[] = Array.isArray(status?.characters) ? status.characters : [];
  const highest = chars.slice().sort((a, b) => (b.level || 0) - (a.level || 0))[0];
  return highest?.name || '';
}

async function fleetSnapshot() {
  const results = await Promise.all(
    FLEET_BOTS.map(async (b) => {
      const status = await fetchJson(`http://127.0.0.1:${b.port}/api/status`);
      return { ...b, status };
    }),
  );

  const bots: Record<string, any> = {};
  let botsOnline = 0;
  let totalXpPerHour = 0;
  let totalLootPerHour = 0;
  let totalKillsPerHour = 0;
  let totalGold = 0;

  for (const r of results) {
    const s = r.status;
    const online = !!s?.online;
    if (online) botsOnline++;
    const xp = Number(s?.rates?.xpPerHour) || 0;
    const goldRate = Number(s?.rates?.goldPerHour) || 0;
    const kills = Number(s?.rates?.killsPerHour) || 0;
    const gold = Number(s?.telemetry?.gold) || 0;
    totalXpPerHour += xp;
    totalLootPerHour += Math.max(0, goldRate);
    totalKillsPerHour += kills;
    totalGold += gold;

    bots[r.key] = {
      label: r.label,
      name: botName(s),
      online,
      reachable: !!s,
      port: r.port,
      status: s,
      error: s ? null : `painel :${r.port} não respondeu`,
    };
  }

  return {
    fleet: {
      botsOnline,
      botsTotal: FLEET_BOTS.length,
      totalXpPerHour,
      totalLootPerHour,
      totalKillsPerHour,
      totalGold,
    },
    bots,
    hunts: HUNTS_TABLE.map((h) => ({ id: h.id, name: h.name, minLevel: h.min })),
    timestamp: new Date().toISOString(),
  };
}

function botPort(key: string): number | null {
  const found = FLEET_BOTS.find((b) => b.key === key);
  return found ? found.port : null;
}

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (path === '/' || path === '/index.html') {
      const html = Bun.file('docs/index.html');
      if (await html.exists()) {
        return new Response(html, { headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return new Response('docs/index.html não encontrado', { status: 404, headers: corsHeaders });
    }

    if (path === '/api/fleet') {
      const snap = await fleetSnapshot();
      return Response.json(snap, { headers: corsHeaders });
    }

    if (path === '/api/status' || path === '/api/overview') {
      const status = await fetchJson('http://127.0.0.1:8080/api/status');
      if (!status) return Response.json({ online: false, error: 'acc1 offline' }, { headers: corsHeaders });
      return Response.json(status, { headers: corsHeaders });
    }

    if (path === '/api/action' && req.method === 'POST') {
      let body: any = {};
      try { body = await req.json(); } catch { /* corpo inválido */ }
      const key = String(body?.bot || 'acc1');
      const port = botPort(key);
      if (!port) {
        return Response.json({ ok: false, error: `bot "${key}" desconhecido` }, { status: 400, headers: corsHeaders });
      }
      const { bot: _bot, ...rest } = body;
      const res = await fetch(`http://127.0.0.1:${port}/api/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rest),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => null);
      if (!res) return Response.json({ ok: false, error: `${key} (:${port}) não respondeu` }, { status: 502, headers: corsHeaders });
      const data = await res.json().catch(() => ({ ok: false, error: 'resposta inválida' }));
      return Response.json(data, { status: res.status, headers: corsHeaders });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
});

console.log(`[fleet] agregador de frota em http://127.0.0.1:${PORT} (${FLEET_BOTS.map((b) => `${b.key}:${b.port}`).join(', ')})`);
