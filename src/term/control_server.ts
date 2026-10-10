/**
 * Mini-servidor HTTP de controle e telemetria para o bot terminal.
 * Ultraleve (~2MB de RAM, nativo do Bun sem dependências externas).
 *
 * Permite que um painel web (docs/index.html) monitore o bot e envie comandos
 * de troca de hunt, treino, rotação e boss.
 *
 * Segurança:
 *  - sobe em 127.0.0.1 por padrão (bastante para cloudflared/ngrok, que apontam
 *    para localhost). CONTROL_HOST=0.0.0.0 abre para a rede.
 *  - rotas de ESCRITA (POST) exigem loopback ou token (CONTROL_TOKEN/ADMIN_TOKEN
 *    via header x-api-key/Authorization ou query ?token=).
 *  - rotas de LEITURA (GET) continuam abertas: são só telemetria.
 */
import type { Room } from './colyseus';
import type { TelemetryStore } from '../telemetry';
import { HUNTS_TABLE, HUNTS_BY_ID } from '../hunts';
import { simulateHunt } from '../hunt_sim';

export interface SessionRates {
  killsPerHour: number;
  goldPerHour: number;
  xpPerHour?: number;
  sampledAt: number;
}

export interface ControlContext {
  getRoom: () => Room | null;
  getTelemetry: () => TelemetryStore;
  getChars: () => any[];
  getCurrentHunt: () => string;
  setHunt: (huntId: string) => void;
  setTreino: (enabled: boolean) => void;
  setAutoBoss: (enabled: boolean) => void;
  getAutoBoss: () => boolean;
  getInTreino: () => boolean;
  reconfigParty: () => Promise<void>;
  /** Taxa real da sessão (kills/h e gold/h medidos, não estimativa). */
  getRates?: () => SessionRates;
  log: (msg: string) => void;
}

export function controlToken(): string {
  return (process.env.CONTROL_TOKEN || process.env.ADMIN_TOKEN || '').trim();
}

function isLoopback(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '');
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

/** Token aceito por header (x-api-key / Authorization) ou por query ?token=. */
export function tokenFromRequest(req: Request): string {
  const authHeader = req.headers.get('x-api-key') || req.headers.get('Authorization') || '';
  const headerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (headerToken) return headerToken;
  try {
    return new URL(req.url).searchParams.get('token') || '';
  } catch (_) {
    return '';
  }
}

export function canWrite(req: Request, clientAddr?: string | null, expected = controlToken()): boolean {
  if (isLoopback(clientAddr)) return true;
  const token = tokenFromRequest(req);
  if (expected && token && token === expected) return true;
  return false;
}

/** Explica o 403: diz exatamente o que falta configurar. */
function forbiddenReason(expected: string): string {
  if (!expected) {
    return 'sem token configurado: defina CONTROL_TOKEN no .env e envie via header x-api-key ou ?token='
      + ' (ou acesse pelo loopback)';
  }
  return 'token inválido: envie x-api-key: <CONTROL_TOKEN> (ou ?token=)';
}

export interface ControlServerOptions {
  hostname?: string;
  port: number;
}

export function startControlServer(port: number, ctx: ControlContext) {
  const log = (msg: string) => {
    try {
      if (typeof ctx?.log === 'function') ctx.log(msg);
      else console.log(msg);
    } catch (_) {
      console.log(msg);
    }
  };

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, ngrok-skip-browser-warning',
  };
  const hostname = process.env.CONTROL_HOST || '127.0.0.1';
  const expected = controlToken();

  try {
    let server: ReturnType<typeof Bun.serve> | null = null;
    server = Bun.serve({
      port,
      hostname,
      error(err: any) {
        log(`[web] SERVER ERROR: ${err?.stack || err}`);
        return new Response(JSON.stringify({ error: String(err?.message || err), stack: err?.stack }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      },
      async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;
        const cors = (extra: Record<string, string> = {}) => ({ ...corsHeaders, ...extra });

        if (req.method === 'OPTIONS') {
          return new Response(null, { headers: corsHeaders });
        }

        const writeGuard = () => {
          const addr = server?.requestIP(req)?.address;
          if (canWrite(req, addr, expected)) return null;
          const reason = forbiddenReason(expected);
          log(`[web] ❌ ${req.method} ${path} bloqueado (${addr || 'ip?'}): ${reason}`);
          return Response.json({ ok: false, error: `Forbidden: ${reason}` }, { status: 403, headers: cors() });
        };

        // 1. Compatibilidade com o dashboard de Fleet / Overview (docs/index.html)
        if (path === '/api/overview' || path === '/api/public/overview') {
          const room = ctx.getRoom();
          const telem = ctx.getTelemetry();
          const currentHuntId = ctx.getCurrentHunt();
          const huntInfo = HUNTS_BY_ID[currentHuntId];
          const isOnline = !!(room && !room.closed);
          const chars = ctx.getChars();
          const maxLevel = Math.max(...chars.map((c) => c.level || 0), telem.level || 0, 1);
          const totalGold = chars.reduce((sum, c) => sum + (c.gold || 0), 0) || telem.gold || 0;
          const rates = ctx.getRates ? ctx.getRates() : { killsPerHour: 0, goldPerHour: 0, sampledAt: 0 };
          const hasSample = rates.sampledAt > 0 && (rates.killsPerHour > 0 || rates.goldPerHour > 0);

          const sim = simulateHunt(currentHuntId, maxLevel);
          const inTreino = typeof ctx.getInTreino === 'function' ? ctx.getInTreino() : false;
          const xpHour = inTreino ? 0 : (rates.xpPerHour || 0);

          const botData = {
            online: isOnline,
            connected: isOnline,
            hunt: huntInfo?.name || currentHuntId,
            selected_hunt_id: currentHuntId,
            last_hunt_id: currentHuntId,
            force_hunt_id: currentHuntId,
            selected_hunt_name: huntInfo?.name || currentHuntId,
            level: maxLevel,
            gold: totalGold,
            stamina: telem.stamina || '-',
            kills: telem.kills || 0,
            waves: telem.waves || 0,
            online_uptime_seconds: room ? room.uptimeSec() : 0,
            elapsed_seconds: telem.onlineUptimeSeconds(),
            treino: inTreino,
            force_treino: inTreino,
            auto_boss: typeof ctx.getAutoBoss === 'function' ? ctx.getAutoBoss() : false,
            boss: false,
            party_members: chars,
            characters: chars,
            coins: telem.coins || 0,
            session_xp: Math.round(xpHour * Math.max(0.1, (room ? room.uptimeSec() : 0) / 3600)),
            selected_hunt_metrics: {
              sample_ready: hasSample,
              kills_per_hour: rates.killsPerHour,
              gold_per_hour: rates.goldPerHour,
              xp_per_hour: xpHour,
              loot_per_hour: (rates as any).lootPerHour || 0,
              gold_sample_ready: hasSample,
            },
            analyzers: {
              xp_per_hour: xpHour,
              loot_per_hour: (rates as any).lootPerHour || 0,
              kills_per_hour: rates.killsPerHour,
              gold_per_hour: rates.goldPerHour,
              raw_xp: xpHour,
              session_xp: Math.round(xpHour * Math.max(0.1, (room ? room.uptimeSec() : 0) / 3600)),
              damage: {},
              taken: {},
            },
            hunt_matrix: {},
          };

          return Response.json({
            fleet: {
              botsOnline: isOnline ? 1 : 0,
              totalXpPerHour: xpHour,
              totalLootPerHour: Math.max(0, rates.goldPerHour),
              totalKillsPerHour: rates.killsPerHour,
              totalDeaths: 0,
            },
            bots: {
              'vps-oracle': {
                ...botData,
                status: botData,
                health: {
                  state: isOnline ? 'online' : 'offline',
                  detail: 'VPS Terminal Bun (1 CPU / 1 GB RAM)',
                  received_at: new Date().toISOString(),
                },
                benchmarks: {},
                matrix: {},
              },
            },
            timestamp: new Date().toISOString(),
          }, { headers: corsHeaders });
        }

        // Servir o dashboard web HTML diretamente em / ou /index.html quando acessado via navegador
        if ((path === '/' && req.headers.get('accept')?.includes('text/html')) || path === '/index.html' || path === '/panel') {
          const htmlFile = Bun.file('docs/index.html');
          if (await htmlFile.exists()) {
            return new Response(htmlFile, {
              headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
        }

        // 2. Status / Telemetria para o novo Dashboard (leitura)
        if (path === '/api/status' || path === '/status' || path === '/') {
          try {
            const room = ctx.getRoom();
            const telem = ctx.getTelemetry();
            const currentHuntId = ctx.getCurrentHunt();
            const huntInfo = HUNTS_BY_ID[currentHuntId];
            const rates = ctx.getRates ? ctx.getRates() : { killsPerHour: 0, goldPerHour: 0, sampledAt: 0 };
            const chars = Array.isArray(ctx.getChars()) ? ctx.getChars() : [];
            const inTreino = typeof ctx.getInTreino === 'function' ? ctx.getInTreino() : false;
            const maxLevel = Math.max(...chars.map((c) => c?.level || 0), telem?.level || 0, 1);
            const sim = simulateHunt(currentHuntId, maxLevel);
            const xpHour = inTreino
              ? 0
              : (rates.xpPerHour || (rates.killsPerHour > 0
                ? Math.round(rates.killsPerHour * (sim?.exp_kill || 1500))
                : 0));

            const payload = {
              online: !!(room && !room.closed),
              uptimeSec: telem ? telem.onlineUptimeSeconds() : 0,
              hunt: {
                id: currentHuntId,
                name: inTreino ? '🧘 Treino Online' : (huntInfo?.name || currentHuntId),
                minLevel: huntInfo?.min || 0,
              },
              rates: {
                killsPerHour: inTreino ? 0 : (rates.killsPerHour || 0),
                goldPerHour: inTreino ? 0 : (rates.goldPerHour || 0),
                xpPerHour: xpHour,
                sampledAt: rates.sampledAt ? new Date(rates.sampledAt).toISOString() : null,
              },
              telemetry: {
                level: telem?.level || 0,
                gold: telem?.gold || 0,
                stamina: telem?.stamina || '',
                kills: telem?.kills || 0,
                waves: telem?.waves || 0,
                hunt: telem?.hunt || '',
                onlineSince: telem?.onlineSince ? new Date(telem.onlineSince).toISOString() : null,
              },
              characters: chars.map((c) => ({
                id: c?.id,
                name: c?.name || '',
                vocation: c?.vocation || '',
                level: c?.level || 1,
                gold: c?.gold || 0,
                stamina: c?.stamina || 0,
                rotation: c?.state?.rotation || [],
                healSpell: c?.state?.helper?.healSpell || '',
                hpPotion: c?.state?.hpPotion || '',
                manaPotion: c?.state?.manaPotion || '',
              })),
              state: {
                inTreino: typeof ctx.getInTreino === 'function' ? ctx.getInTreino() : false,
                autoBoss: typeof ctx.getAutoBoss === 'function' ? ctx.getAutoBoss() : false,
              },
              auth: {
                writing: expected ? 'token' : 'loopback-only',
              },
              availableHunts: HUNTS_TABLE.map((h) => ({
                id: h.id,
                name: h.name,
                minLevel: h.min,
              })),
              updatedAt: new Date().toISOString(),
            };

            return Response.json(payload, { headers: corsHeaders });
          } catch (err: any) {
            log(`[web] erro ao gerar status: ${err?.stack || err?.message || err}`);
            return Response.json({ error: String(err?.message || err) }, { status: 500, headers: corsHeaders });
          }
        }

        if (req.method !== 'POST') {
          return new Response('Not Found', { status: 404, headers: corsHeaders });
        }

        // ---- daqui em diante é ESCRITA: exige loopback ou token ----
        const denied = writeGuard();
        if (denied) return denied;

        // 3. Rota legada /api/hunt (compatibilidade direta com botões antigos)
        if (path === '/api/hunt') {
          try {
            const body = await req.json() as any;
            const huntId = String(body.hunt_id || body.huntId || '').trim();
            if (huntId) {
              ctx.setHunt(huntId);
              log(`[web] 🎯 Troca de hunt via /api/hunt: ${huntId}`);
              return Response.json({ ok: true, message: `Hunt alterada para ${huntId}` }, { headers: corsHeaders });
            }
            return Response.json({ ok: false, error: 'hunt_id não informado' }, { status: 400, headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ ok: false, error: e?.message }, { status: 400, headers: corsHeaders });
          }
        }

        // 4. Rota legada /api/treino (compatibilidade direta)
        if (path === '/api/treino') {
          try {
            const body = await req.json() as any;
            const enabled = body.enabled !== false;
            ctx.setTreino(enabled);
            log(`[web] 🧘 Treino alterado via /api/treino: ${enabled}`);
            return Response.json({ ok: true, inTreino: enabled }, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ ok: false, error: e?.message }, { status: 400, headers: corsHeaders });
          }
        }

        // 5. Ações de controle remoto completas (/api/action)
        if (path === '/api/action') {
          try {
            const body = await req.json() as any;
            const action = String(body?.action || '').toLowerCase();

            if (action === 'set_hunt') {
              const huntId = String(body.huntId || body.hunt_id || '').trim();
              if (huntId) {
                ctx.setHunt(huntId);
                log(`[web] 🎯 Troca de hunt solicitada via painel web: ${huntId}`);
                return Response.json({ ok: true, message: `Hunt alterada para ${huntId}` }, { headers: corsHeaders });
              }
            }

            if (action === 'toggle_treino') {
              const enabled = Boolean(body.enabled);
              ctx.setTreino(enabled);
              log(`[web] 🧘 Treino online alterado via painel: ${enabled ? 'ATIVADO' : 'DESATIVADO'}`);
              return Response.json({ ok: true, inTreino: enabled }, { headers: corsHeaders });
            }

            if (action === 'toggle_boss') {
              const enabled = Boolean(body.enabled);
              ctx.setAutoBoss(enabled);
              log(`[web] 👑 Auto-Boss alterado via painel: ${enabled ? 'ATIVADO' : 'DESATIVADO'}`);
              return Response.json({ ok: true, autoBoss: enabled }, { headers: corsHeaders });
            }

            if (action === 'reconfig') {
              await ctx.reconfigParty();
              log('[web] 🧙 Reconfiguração de magias/poções executada via painel web');
              return Response.json({ ok: true, message: 'Rotações e poções reaplicadas!' }, { headers: corsHeaders });
            }

            if (action === 'refill') {
              const room = ctx.getRoom();
              if (room && !room.closed) {
                room.send('autorefill', {
                  names: [
                    'supreme health potion',
                    'ultimate spirit potion',
                    'distilled ultimate mana potion',
                    'ultimate mana potion',
                    'ultimate health potion',
                    'great spirit potion',
                  ],
                });
                room.send('autobuysupply', { cfg: { enabled: true, minCount: 100, buyCount: 300 } });
                log('[web] 🧪 Compra de suprimentos acionada via painel web');
                return Response.json({ ok: true, message: 'Auto-refill disparado!' }, { headers: corsHeaders });
              }
              return Response.json({ ok: false, error: 'sala fechada' }, { status: 503, headers: corsHeaders });
            }

            return Response.json({ ok: false, error: `Ação desconhecida: ${action}` }, { status: 400, headers: corsHeaders });
          } catch (err: any) {
            return Response.json({ ok: false, error: err?.message || String(err) }, { status: 500, headers: corsHeaders });
          }
        }

        return new Response('Not Found', { status: 404, headers: corsHeaders });
      },
    });

    const tokenNote = expected ? 'token exigido p/ escrita' : 'escrita soh no loopback';
    log(`[web] 🌐 painel HTTP em http://${hostname}:${port} (${tokenNote})`);
    return server;
  } catch (err: any) {
    log(`[web] aviso: não foi possível iniciar o servidor de controle na porta ${port}: ${err?.message || err}`);
    return null;
  }
}
