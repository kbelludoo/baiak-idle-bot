import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type JsonRecord = Record<string, any>;

type FetchResult = {
  data: JsonRecord | null;
  error?: string;
  receivedAt: string;
};

type HistoryPoint = {
  at: string;
  state: 'online' | 'stale' | 'offline' | 'api_error';
  level: number;
  xpPerHour: number;
  lootPerHour: number;
  deaths: number;
  uptimeSeconds: number;
};

const port = Number(process.env.PORT || 8081);
const snapshotIntervalMs = Math.max(5_000, Number(process.env.SNAPSHOT_INTERVAL_MS || 10_000));
const historyIntervalMs = 60_000;
const historyWindowMs = 24 * 60 * 60 * 1000;
const historyFile = process.env.HISTORY_FILE || './data/fleet-history.json';
const publicOrigin = process.env.PUBLIC_ORIGIN || 'https://kbelludoo.github.io';
const operatorToken = (process.env.OPERATOR_TOKEN || '').trim();
const botAdminToken = (process.env.BOT_ADMIN_TOKEN || '').trim();
const alertWebhookUrl = (process.env.ALERT_WEBHOOK_URL || '').trim();
const alertCooldownMs = Math.max(60_000, Number(process.env.ALERT_COOLDOWN_MS || 15 * 60_000));

const bots = {
  vps1: process.env.VPS1_URL || 'http://host.docker.internal:8080',
  vps2: process.env.VPS2_URL || 'http://137.131.226.117:8080',
};

const html = await Bun.file('./index.html').text();
mkdirSync(dirname(historyFile), { recursive: true });

let history: Record<string, HistoryPoint[]> = { vps1: [], vps2: [] };
try {
  const stored = await Bun.file(historyFile).json();
  if (stored && typeof stored === 'object') {
    for (const id of Object.keys(history)) {
      if (Array.isArray(stored[id])) history[id] = stored[id].filter((point: unknown) => point && typeof point === 'object');
    }
  }
} catch {
  // First start or an interrupted write: begin with an empty history.
}

let snapshot: JsonRecord | null = null;
let snapshotPromise: Promise<JsonRecord> | null = null;
let lastHistoryWrite = 0;
const alertState: Record<string, { state: string; sentAt: number }> = {};

function publicCors(req?: Request) {
  const origin = req?.headers.get('Origin') || publicOrigin;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, ngrok-skip-browser-warning',
    Vary: 'Origin',
  };
}

function json(payload: unknown, init: ResponseInit = {}, headers: HeadersInit = {}) {
  return Response.json(payload, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...headers, ...(init.headers || {}) },
  });
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const compact = value.trim().replace(/[^0-9,.-]/g, '');
  if (!compact) return 0;
  const dotCount = (compact.match(/\./g) || []).length;
  const normalized = compact.includes(',') && compact.includes('.')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact.includes(',')
      ? compact.replace(',', '.')
      : dotCount > 1
        ? compact.replace(/\./g, '')
        : compact;
  return Number(normalized) || 0;
}

function activeDeaths(status: JsonRecord): number {
  const id = status.last_hunt_id || status.force_hunt_id;
  const benchmark = id ? status.benchmarks?.[id] : null;
  const matrix = id ? status.hunt_matrix?.[id] : null;
  return Number(benchmark?.deaths ?? matrix?.deaths ?? 0) || 0;
}

async function fetchBot(base: string): Promise<FetchResult> {
  const receivedAt = new Date().toISOString();
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/status`, {
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) return { data: null, error: `HTTP ${response.status}`, receivedAt };
    return { data: await response.json() as JsonRecord, receivedAt };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : String(error), receivedAt };
  }
}

function healthOf(result: FetchResult) {
  const status = result.data;
  if (!status) return { state: 'api_error' as const, detail: result.error || 'Sem resposta da API', received_at: result.receivedAt };
  const updatedAt = asNumber(status.last_update_ts) * 1_000;
  const ageSeconds = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1_000)) : null;
  if (ageSeconds !== null && ageSeconds > 45) {
    return { state: 'stale' as const, detail: `Sem atualização há ${ageSeconds}s`, received_at: result.receivedAt, age_seconds: ageSeconds };
  }
  if (!status.online || !status.connected) {
    return { state: 'offline' as const, detail: 'Bot desconectado do jogo', received_at: result.receivedAt, age_seconds: ageSeconds };
  }
  return { state: 'online' as const, detail: 'Conexão e telemetria atualizadas', received_at: result.receivedAt, age_seconds: ageSeconds };
}

function bundle(result: FetchResult) {
  const status = result.data || {};
  return {
    status,
    benchmarks: status.benchmarks || {},
    matrix: status.hunt_matrix || {},
    health: healthOf(result),
  };
}

function appendHistory(botsSnapshot: Record<string, JsonRecord>) {
  const now = Date.now();
  if (now - lastHistoryWrite < historyIntervalMs) return;
  lastHistoryWrite = now;

  for (const [id, bot] of Object.entries(botsSnapshot)) {
    const status = bot.status || {};
    const analyzers = status.analyzers || {};
    const point: HistoryPoint = {
      at: new Date(now).toISOString(),
      state: bot.health?.state || 'api_error',
      level: asNumber(status.level),
      xpPerHour: asNumber(analyzers.xp_per_hour),
      lootPerHour: asNumber(analyzers.loot_per_hour),
      deaths: activeDeaths(status),
      uptimeSeconds: asNumber(status.online_uptime_seconds),
    };
    const existing = history[id] || [];
    history[id] = [...existing, point].filter((entry) => Date.parse(entry.at) >= now - historyWindowMs);
  }
  void Bun.write(historyFile, JSON.stringify(history));
}

async function alertOnDegradedBots(botsSnapshot: Record<string, JsonRecord>) {
  if (!alertWebhookUrl) return;
  const now = Date.now();
  for (const [id, bot] of Object.entries(botsSnapshot)) {
    const state = String(bot.health?.state || 'api_error');
    const previous = alertState[id];
    const shouldNotify = state !== 'online' && (!previous || previous.state !== state || now - previous.sentAt >= alertCooldownMs);
    if (shouldNotify) {
      const message = `Baiak Fleet: ${id.toUpperCase()} está ${state}. ${bot.health?.detail || ''}`;
      try {
        await fetch(alertWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message, content: message }),
          signal: AbortSignal.timeout(7_000),
        });
      } catch (error) {
        console.warn(`[monitor] alerta não enviado para ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      alertState[id] = { state, sentAt: now };
    } else if (state === 'online') {
      alertState[id] = { state, sentAt: now };
    }
  }
}

async function refreshSnapshot(): Promise<JsonRecord> {
  const now = Date.now();
  if (snapshot && now - Date.parse(snapshot.generatedAt) < snapshotIntervalMs) return snapshot;
  if (snapshotPromise) return snapshotPromise;

  snapshotPromise = (async () => {
    const [vps1, vps2] = await Promise.all([fetchBot(bots.vps1), fetchBot(bots.vps2)]);
    const botsSnapshot = { vps1: bundle(vps1), vps2: bundle(vps2) };
    appendHistory(botsSnapshot);
    void alertOnDegradedBots(botsSnapshot);
    snapshot = { generatedAt: new Date().toISOString(), bots: botsSnapshot, history };
    return snapshot;
  })();

  try {
    return await snapshotPromise;
  } finally {
    snapshotPromise = null;
  }
}

function formatUptimeStr(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s <= 0) return '0s';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatXpStr(xp: number): string {
  const n = Math.floor(Number(xp) || 0);
  if (n <= 0) return '0 XP';
  if (n >= 1_000_000_000) return `+${(n / 1_000_000_000).toFixed(2)}B XP`;
  if (n >= 1_000_000) return `+${(n / 1_000_000).toFixed(2)}kk XP`;
  if (n >= 1_000) return `+${(n / 1_000).toFixed(1)}k XP`;
  return `+${n} XP`;
}

function publicStatus(status: JsonRecord): JsonRecord {
  const members = Array.isArray(status.party_members) ? status.party_members : [];
  const readyMembers = members.filter((member: JsonRecord) => member?.ready).length;
  const connectedMembers = status.party_connected !== undefined
    ? asNumber(status.party_connected)
    : members.length;
  const analyzers = status.analyzers || {};
  // Fallbacks quando o bot ainda roda build antiga sem os campos novos:
  // deriva uptime_str de uptime_seconds, elapsed de uptime, session_xp de analyzers.
  const uptimeSec = asNumber(status.online_uptime_seconds);
  const analyzersXp = asNumber(analyzers.session_xp ?? analyzers.raw_xp ?? analyzers.sessionXp);
  // Zero é um valor válido no início da execução: não ressuscite o XP antigo
  // do Hunt Analyzer como se fosse o total do processo atual.
  const sessionXp = status.session_xp !== undefined ? asNumber(status.session_xp) : analyzersXp;
  let elapsed = asNumber(status.elapsed_minutes);
  if (!elapsed && uptimeSec > 0) elapsed = Math.floor(uptimeSec / 60);
  let elapsedSec = asNumber(status.elapsed_seconds);
  if (!elapsedSec) {
    if (uptimeSec > 0) elapsedSec = uptimeSec;
    else if (elapsed > 0) elapsedSec = elapsed * 60;
  }
  const uptimeStr = status.online_uptime_str
    || (status.online ? formatUptimeStr(uptimeSec) : null);
  const sessionXpStr = status.session_xp_str
    || (sessionXp ? formatXpStr(sessionXp) : '0 XP');
  const huntControl = status.hunt_control || 'manual';
  const forceHuntId = status.force_hunt_id || null;
  // Durante uma reconexão o servidor pode reportar por alguns segundos a sala
  // antiga (ex.: Wyrm), mesmo com a hunt manual fixada em outra sala. O painel
  // deve refletir o alvo do operador, preservando o valor observado separadamente.
  const observedHunt = status.hunt || status.last_hunt || null;
  const displayedHunt = Boolean(status.treino)
    ? "Treino Online"
    : (huntControl === 'manual' && forceHuntId
      ? (status.selected_hunt_name || status.last_hunt || observedHunt)
      : observedHunt);
  return {
    online: Boolean(status.online),
    connected: Boolean(status.connected ?? status.online),
    online_uptime_seconds: uptimeSec,
    online_uptime_str: uptimeStr,
    ws_disconnect_count: asNumber(status.ws_disconnect_count),
    last_ws_disconnect_at: status.last_ws_disconnect_at || null,
    session_xp: sessionXp,
    session_xp_str: sessionXpStr,
    level: asNumber(status.level),
    level_per_hour: asNumber(status.level_per_hour),
    gold: asNumber(status.gold),
    coins: asNumber(status.coins),
    market_coins: asNumber(status.market_coins),
    auction_status: status.auction_status || null,
    skills: status.skills || {},
    magic_level: asNumber(status.magic_level),
    skills_summary: status.skills_summary || '',
    stamina: status.stamina || null,
    hunt: displayedHunt,
    observed_hunt: observedHunt,
    hunt_stage: status.hunt_stage ?? null,
    hunt_stage_total: status.hunt_stage_total ?? null,
    hunt_stage_label: status.hunt_stage_label || null,
    hunt_stage_complete: Boolean(status.hunt_stage_complete),
    last_hunt: status.last_hunt || null,
    last_hunt_id: status.last_hunt_id || null,
    force_hunt: Boolean(status.force_hunt),
    force_hunt_id: forceHuntId,
    force_treino: Boolean(status.force_treino),
    hunt_control: huntControl,
    pending_hunt_id: status.pending_hunt_id || null,
    pending_hunt_name: status.pending_hunt_name || null,
    pending_hunt_requested_at: status.pending_hunt_requested_at || null,
    loop_mode: Boolean(status.loop_mode),
    treino: Boolean(status.treino),
    party_slots: asNumber(status.party_slots) || (members.length || 3),
    party_connected: connectedMembers,
    party_config_ready: status.party_config_ready !== undefined ? asNumber(status.party_config_ready) : readyMembers,
    // Compatibilidade com o painel antigo: party_ready agora é presença.
    party_ready: connectedMembers,
    party_members: members,
    kills: asNumber(status.kills),
    waves: asNumber(status.waves),
    elapsed_minutes: elapsed,
    elapsed_seconds: elapsedSec,
    hunt_decision: status.hunt_decision || {},
    subsystems: status.subsystems || {},
    analyzers,
    selected_hunt_id: status.selected_hunt_id || null,
    selected_hunt_name: status.selected_hunt_name || null,
    selected_hunt_metrics: status.selected_hunt_metrics || {},
    session_metrics: status.session_metrics || {},
    benchmarks: status.benchmarks || {},
    hunt_matrix: status.hunt_matrix || {},
    hunt_metrics: status.hunt_metrics || {},
    magic: status.magic || {},
    bag_slots: status.bag_slots || '',
    character: status.character || null,
    jev_recommendation: status.jev_recommendation || null,
    sources: status.sources || {},
    last_update: status.last_update || null,
    last_update_ts: asNumber(status.last_update_ts) || null,
  };
}

function publicSnapshot(current: JsonRecord) {
  const botsSnapshot = Object.fromEntries(Object.entries(current.bots).map(([id, bot]: [string, any]) => [id, {
    status: publicStatus(bot.status || {}),
    benchmarks: bot.benchmarks || {},
    matrix: bot.matrix || {},
    health: bot.health,
  }]));
  return { generatedAt: current.generatedAt, bots: botsSnapshot, history: current.history };
}

function isOperator(request: Request) {
  if (!operatorToken) return false;
  const raw = request.headers.get('authorization') || request.headers.get('x-api-key') || '';
  return raw.replace(/^Bearer\s+/i, '').trim() === operatorToken;
}

function botProxyAuthorized(request: Request): boolean {
  if (!operatorToken) return true; // sem OPERATOR_TOKEN, libera com os tokens das VPS
  if (isOperator(request)) return true;
  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return !auth || auth === operatorToken;
}

async function forwardBotCommand(endpointPath: string, request: Request) {
  const body = await request.json() as JsonRecord;
  const targetBot = String(body?.bot || 'vps1').toLowerCase() === 'vps2' ? 'vps2' : 'vps1';
  const targetAdminToken = (targetBot === 'vps2' ? vps2Token : vps1Token) || botAdminToken;
  const response = await fetch(`${bots[targetBot].replace(/\/$/, '')}${endpointPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${targetAdminToken}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return json(await response.json(), { status: response.status }, publicCors(request));
}

const vps1Token = '3199b54fe5b0f553a427cadbf3b2fdd6846fe6ae46a748f6f96808b574f60a09';
const vps2Token = '0289bffd31edb12580bbcb6a0b09e17f2c38410faa5d02111c005679bd67d1de';

void refreshSnapshot();
setInterval(() => { void refreshSnapshot(); }, snapshotIntervalMs);

Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: publicCors(request) });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/healthz') {
      const current = await refreshSnapshot();
      const states = Object.values(current.bots as Record<string, JsonRecord>).map((bot) => bot.health?.state);
      const ok = states.some((state) => state === 'online');
      return json({ ok, generatedAt: current.generatedAt, states }, { status: ok ? 200 : 503 }, publicCors(request));
    }
    if (url.pathname === '/api/public/overview' && (request.method === 'GET' || request.method === 'HEAD')) {
      return json(publicSnapshot(await refreshSnapshot()), {}, publicCors(request));
    }
    if (url.pathname === '/api/overview' && (request.method === 'GET' || request.method === 'HEAD')) {
      return json(await refreshSnapshot(), {}, publicCors(request));
    }
    if (url.pathname === '/api/hunt' && request.method === 'POST') {
      if (!botProxyAuthorized(request)) {
        return json({ ok: false, error: 'Não autorizado' }, { status: 401 }, publicCors(request));
      }
      try {
        return await forwardBotCommand('/api/hunt', request);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 }, publicCors(request));
      }
    }
    if (url.pathname === '/api/treino' && request.method === 'POST') {
      if (!botProxyAuthorized(request)) {
        return json({ ok: false, error: 'Não autorizado' }, { status: 401 }, publicCors(request));
      }
      try {
        return await forwardBotCommand('/api/treino', request);
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 }, publicCors(request));
      }
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[monitor] http://0.0.0.0:${port}`);
