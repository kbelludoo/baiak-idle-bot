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

function publicCors() {
  return {
    'Access-Control-Allow-Origin': publicOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

function publicStatus(status: JsonRecord): JsonRecord {
  const members = Array.isArray(status.party_members) ? status.party_members : [];
  const readyMembers = members.filter((member: JsonRecord) => member?.ready).length;
  return {
    online: Boolean(status.online),
    connected: Boolean(status.connected),
    online_uptime_seconds: asNumber(status.online_uptime_seconds),
    online_uptime_str: status.online_uptime_str || null,
    ws_disconnect_count: asNumber(status.ws_disconnect_count),
    last_ws_disconnect_at: status.last_ws_disconnect_at || null,
    session_xp: asNumber(status.session_xp),
    session_xp_str: status.session_xp_str || null,
    level: asNumber(status.level),
    gold: asNumber(status.gold),
    stamina: status.stamina || null,
    hunt: status.hunt || status.last_hunt || null,
    last_hunt: status.last_hunt || null,
    last_hunt_id: status.last_hunt_id || null,
    loop_mode: Boolean(status.loop_mode),
    treino: Boolean(status.treino),
    party_slots: asNumber(status.party_slots),
    party_ready: readyMembers,
    kills: asNumber(status.kills),
    waves: asNumber(status.waves),
    elapsed_minutes: asNumber(status.elapsed_minutes),
    hunt_decision: status.hunt_decision || {},
    subsystems: status.subsystems || {},
    analyzers: status.analyzers || {},
    benchmarks: status.benchmarks || {},
    hunt_matrix: status.hunt_matrix || {},
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

void refreshSnapshot();
setInterval(() => { void refreshSnapshot(); }, snapshotIntervalMs);

Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/public/')) {
      return new Response(null, { headers: publicCors() });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/healthz') {
      const current = await refreshSnapshot();
      const states = Object.values(current.bots as Record<string, JsonRecord>).map((bot) => bot.health?.state);
      const ok = states.some((state) => state === 'online');
      return json({ ok, generatedAt: current.generatedAt, states }, { status: ok ? 200 : 503 });
    }
    if (url.pathname === '/api/public/overview' && request.method === 'GET') {
      return json(publicSnapshot(await refreshSnapshot()), {}, publicCors());
    }
    if (url.pathname === '/api/overview' && request.method === 'GET') {
      return json(await refreshSnapshot());
    }
    if (url.pathname === '/api/hunt' && request.method === 'POST') {
      if (!operatorToken || !botAdminToken) {
        return json({ ok: false, error: 'Controle remoto não configurado' }, { status: 503 });
      }
      if (!isOperator(request)) {
        return json({ ok: false, error: 'Não autorizado' }, { status: 401 });
      }
      try {
        const body = await request.json() as JsonRecord;
        const targetBot = String(body?.bot || 'vps1').toLowerCase() === 'vps2' ? 'vps2' : 'vps1';
        const response = await fetch(`${bots[targetBot].replace(/\/$/, '')}/api/hunt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botAdminToken}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        return json(await response.json(), { status: response.status });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
      }
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[monitor] http://0.0.0.0:${port}`);
