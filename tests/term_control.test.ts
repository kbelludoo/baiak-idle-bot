import { afterEach, describe, expect, it } from 'bun:test';
import {
  canWrite,
  controlToken,
  startControlServer,
  tokenFromRequest,
  type ControlContext,
} from '../src/term/control_server';
import { TelemetryStore } from '../src/telemetry';

const savedEnv: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined) {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

function makeCtx(over: Partial<ControlContext> = {}) {
  const calls: Array<[string, any]> = [];
  const logs: string[] = [];
  const ctx: ControlContext = {
    getRoom: () => null,
    getTelemetry: () => new TelemetryStore(),
    getChars: () => [{ id: 1, name: 'Secondpally', vocation: 'paladin', level: 120, gold: 5000 }],
    getCurrentHunt: () => 'glooth-cave',
    setHunt: (h) => calls.push(['hunt', h]),
    setTreino: (e) => calls.push(['treino', e]),
    setAutoBoss: (e) => calls.push(['boss', e]),
    getAutoBoss: () => false,
    getInTreino: () => false,
    reconfigParty: async () => { calls.push(['reconfig', null]); },
    getRates: () => ({ killsPerHour: 342, goldPerHour: 9150, sampledAt: 1_700_000_000_000 }),
    log: (m) => logs.push(m),
    ...over,
  };
  return { ctx, calls, logs };
}

const req = (url: string, init: RequestInit = {}) => new Request(url, init);
const post = (url: string, body: any, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('guarda de escrita do painel HTTP', () => {
  it('token vem do CONTROL_TOKEN (e não do token do jogo)', () => {
    setEnv('CONTROL_TOKEN', '  segredo123 ');
    setEnv('ADMIN_TOKEN', 'admin-antigo');
    expect(controlToken()).toBe('segredo123');
  });

  it('sem token definido, volta para o ADMIN_TOKEN', () => {
    setEnv('CONTROL_TOKEN', undefined);
    setEnv('ADMIN_TOKEN', 'admin-antigo');
    expect(controlToken()).toBe('admin-antigo');
  });

  it('loopback escreve sem token', () => {
    setEnv('CONTROL_TOKEN', undefined);
    expect(canWrite(req('http://x/api/action'), '127.0.0.1')).toBe(true);
    expect(canWrite(req('http://x/api/action'), '::1')).toBe(true);
    expect(canWrite(req('http://x/api/action'), '::ffff:127.0.0.1')).toBe(true);
  });

  it('remoto sem token configurado é bloqueado', () => {
    setEnv('CONTROL_TOKEN', undefined);
    setEnv('ADMIN_TOKEN', undefined);
    expect(canWrite(req('http://x/api/action'), '203.0.113.9')).toBe(false);
    expect(canWrite(req('http://x/api/action'), null)).toBe(false);
  });

  it('remoto com o token certo passa, com o errado não', () => {
    setEnv('CONTROL_TOKEN', 'segredo123');
    const ok = post('http://x/api/action', { action: 'set_hunt' }, { 'x-api-key': 'segredo123' });
    const bad = post('http://x/api/action', { action: 'set_hunt' }, { 'x-api-key': 'errado' });
    expect(canWrite(ok, '203.0.113.9')).toBe(true);
    expect(canWrite(bad, '203.0.113.9')).toBe(false);
    expect(canWrite(req('http://x/api/action'), '203.0.113.9')).toBe(false);
  });

  it('token aceita Authorization Bearer e query ?token=', () => {
    setEnv('CONTROL_TOKEN', 'abc');
    expect(tokenFromRequest(req('http://x/', { headers: { Authorization: 'Bearer abc' } }))).toBe('abc');
    expect(tokenFromRequest(req('http://x/api/status?token=abc'))).toBe('abc');
    expect(tokenFromRequest(req('http://x/'))).toBe('');
    // header tem prioridade sobre a query
    expect(tokenFromRequest(req('http://x/?token=daquery', { headers: { 'x-api-key': 'doheader' } }))).toBe('doheader');
  });
});

describe('painel HTTP do terminal', () => {
  const stops: Array<() => void> = [];
  const base = (port: number) => `http://127.0.0.1:${port}`;

  afterEach(() => {
    while (stops.length) {
      try { stops.pop()!(); } catch (_) {}
    }
  });

  function boot(over: Partial<ControlContext> = {}) {
    const { ctx, calls, logs } = makeCtx(over);
    const srv = startControlServer(0, ctx);
    if (!srv) throw new Error('servidor de controle não subiu');
    stops.push(() => srv.stop());
    const port = srv.port;
    if (typeof port !== 'number' || port <= 0) throw new Error(`porta atribuída inválida: ${String(port)}`);
    return { port, calls, logs };
  }

  it('sobe em loopback por padrão (CONTROL_HOST indefinido)', () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', undefined);
    const { port } = boot();
    expect(port).toBeGreaterThan(0);
  });

  it('/api/status devolve minLevel real (antes o painel via minLevel errado e saía undefined)', async () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', undefined);
    const { port } = boot();
    const res = await fetch(`${base(port)}/api/status`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.availableHunts.length).toBeGreaterThan(0);
    expect(typeof body.availableHunts[0].minLevel).toBe('number');
    expect(body.hunt.id).toBe('glooth-cave');
    expect(body.hunt.name).toBeTruthy();
    expect(body.characters[0].name).toBe('Secondpally');
  });

  it('/api/status expõe a taxa medida da sessão (kills/h e gold/h)', async () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', undefined);
    const { port } = boot();
    const body: any = await (await fetch(`${base(port)}/api/status`)).json();
    expect(body.rates.killsPerHour).toBe(342);
    expect(body.rates.goldPerHour).toBe(9150);
    expect(body.rates.sampledAt).toBe('2023-11-14T22:13:20.000Z');
    expect(body.auth.writing).toBe('loopback-only');
  });

  it('/api/overview não inventa xp/h: reporta 0 com amostra só quando há taxa', async () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', undefined);
    const { port } = boot();
    const body: any = await (await fetch(`${base(port)}/api/overview`)).json();
    const metrics = body.bots['vps-oracle'].selected_hunt_metrics;
    expect(metrics.sample_ready).toBe(true);
    expect(metrics.kills_per_hour).toBe(342);
    expect(metrics.loot_per_hour).toBe(0);
    expect(body.bots['vps-oracle'].analyzers.xp_per_hour).toBe(0);
    expect(body.fleet.totalXpPerHour).toBe(0);
    expect(body.fleet.totalLootPerHour).toBe(9150);
    expect(body.fleet.totalKillsPerHour).toBe(342);
  });

  it('/api/overview com sample_ready=false quando não há taxa medida', async () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', undefined);
    const { port } = boot({ getRates: () => ({ killsPerHour: 0, goldPerHour: 0, sampledAt: 0 }) });
    const body: any = await (await fetch(`${base(port)}/api/overview`)).json();
    expect(body.bots['vps-oracle'].selected_hunt_metrics.sample_ready).toBe(false);
  });

  it('POST /api/action set_hunt passa pelo guard (loopback) e chama o ctx', async () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', undefined);
    const { port, calls } = boot();
    const res = await fetch(`${base(port)}/api/action`, post(`${base(port)}/api/action`, { action: 'set_hunt', huntId: 'hydra-cave' }));
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    expect(calls).toContainEqual(['hunt', 'hydra-cave']);
  });

  it('POST /api/action responde 400 para ação desconhecida (e não executa nada)', async () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', undefined);
    const { port, calls } = boot();
    const res = await fetch(`${base(port)}/api/action`, post(`${base(port)}/api/action`, { action: 'x' }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('POST /api/hunt e /api/treino seguem funcionando (rotas legadas)', async () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', undefined);
    const { port, calls } = boot();
    const a = await (await fetch(`${base(port)}/api/hunt`, post(`${base(port)}/api/hunt`, { hunt_id: 'dragon-lair' }))).json();
    const b = await (await fetch(`${base(port)}/api/treino`, post(`${base(port)}/api/treino`, { enabled: false }))).json();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(calls).toEqual([['hunt', 'dragon-lair'], ['treino', false]]);
  });

  it('GET desconhecido responde 404', async () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', undefined);
    const { port } = boot();
    const res = await fetch(`${base(port)}/api/naoexiste`);
    expect(res.status).toBe(404);
  });

  it('com CONTROL_TOKEN o loopback continua funcionando (o painel não quebra)', async () => {
    setEnv('CONTROL_HOST', undefined);
    setEnv('CONTROL_TOKEN', 'tok-boleto');
    const { port, calls } = boot();
    const res = await fetch(`${base(port)}/api/action`, post(`${base(port)}/api/action`, { action: 'toggle_boss', enabled: true }));
    expect(res.status).toBe(200);
    expect(calls).toContainEqual(['boss', true]);
  });
});
