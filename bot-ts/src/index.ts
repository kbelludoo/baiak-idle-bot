import { parseConfig } from './config';
import { launchBrowser } from './browser';
import { Watchdog } from './watchdog';
import { Profiler } from './profiler';
import { startServer } from './server';
import { AutomationController } from './automation';
import { decodeBaiakFrame, digLevel, type WsFrameInfo } from './protocol';
import type { TelemetryState, SubsystemInfo } from './types';

function staminaFromPayload(value: unknown): string | null {
  if (typeof value === 'string' && value.includes(':')) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const mins = Math.trunc(value <= 1 ? value * 2520 : value);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

async function main() {
  console.log('====================================================================');
  console.log(' ⚔️  BAIAK IDLE BOT v2 — TYPESCRIPT/BUN PARITY PORT');
  console.log(' [*] Orquestrador TS + scripts DOM já validados pela versão Python');
  console.log(' [*] Decoder MessagePack nativo em TypeScript para WebSocket');
  console.log('====================================================================');

  const config = parseConfig();
  if (!config.token) console.warn('[AVISO] BAIAK_TOKEN vazio. O bot tentará usar USER_DATA_DIR persistido.');
  console.log(`[*] Headless=${config.headless} | Stream=${config.stream} ${config.streamWidth}x${config.streamHeight}@${config.streamFps}`);
  console.log(`[*] Hunt=${config.autoHunt} | Heal=${config.autoHeal} | Sell=${config.autoSell}@${config.sellThresholdPct}% | Treino=${config.autoTreino}`);

  const watchdog = new Watchdog();
  const profiler = new Profiler();
  const automation = new AutomationController();

  const subsystems: Record<string, SubsystemInfo> = {
    anti_bot: { status: 'FUNCIONAL', detail: 'Presença humana via CDP ativa' },
    auto_sell: { status: config.autoSell ? 'VERIFICANDO' : 'AGUARDANDO', detail: config.autoSell ? `Auto-sell nativo alvo ${config.sellThresholdPct}%` : 'Desativado' },
    auto_heal: { status: config.autoHeal ? 'FUNCIONAL' : 'AGUARDANDO', detail: config.autoHeal ? `Cura <${config.healBelowPct}%, HP <${config.hpPotionBelowPct}%, MP <${config.manaPotionBelowPct}%` : 'Desativado' },
    treino: { status: 'AGUARDANDO', detail: 'Stamina baixa → treino; recuperada → hunt' },
    boss: { status: config.autoBoss ? 'AGUARDANDO' : 'AGUARDANDO', detail: config.autoBoss ? 'Auto Boss habilitado' : 'Desativado' },
    auto_equip: { status: config.autoEquip ? 'AGUARDANDO' : 'AGUARDANDO', detail: config.autoEquip ? 'Monitorando upgrades' : 'Desativado' },
    watchdog: { status: 'FUNCIONAL', detail: 'Reconexão por DOM + WebSocket' },
    hunt_analyzer: { status: 'FUNCIONAL', detail: 'Telemetria WebSocket + HUD ativa' },
  };

  let wsConnected = false;
  let lastWsFrame = 0;
  let currentState: TelemetryState = {
    online: false,
    connected: false,
    character: null,
    hunt: 'Conectando...',
    kills: 0,
    waves: 0,
    loop_mode: false,
    treino: false,
    stamina: '—',
    bag_slots: '—',
    party_slots: 1,
    level: 0,
    gold: 0,
    shooters: [],
    analyzer: { deaths: 0 },
    subsystems,
    last_events: [],
    last_update: new Date().toLocaleTimeString('pt-BR'),
  };

  let pageRef: any = null;
  let cdpRef: any = null;
  let getFrameRef: (() => Buffer | null) = () => null;

  startServer(config.port, config.host, {
    getState: () => currentState,
    getPage: () => pageRef,
    getCdp: () => cdpRef,
    getLatestFrame: () => getFrameRef(),
  });

  const onWsFrame = (raw: WsFrameInfo) => {
    watchdog.onWsFrame();
    wsConnected = true;
    lastWsFrame = Date.now();
    const frame = decodeBaiakFrame(raw);
    if (!frame?.type) return;

    const typ = String(frame.type);
    const pay: any = frame.payload;
    if (typ === 'combatlog') {
      if (Array.isArray(pay)) currentState.kills += pay.filter((e) => e && typeof e === 'object' && e.killed).length;
      else if (pay && typeof pay === 'object' && pay.killed) currentState.kills += 1;
    } else if (typ === 'log' || typ === 'notify') {
      currentState.waves += 1;
    } else if (['state', 'init', 'sync', 'player', 'snapshot'].includes(typ) && pay && typeof pay === 'object') {
      const level = digLevel(pay);
      if (level) currentState.level = level;
      const player = pay.player && typeof pay.player === 'object' ? pay.player : {};
      const stamina = staminaFromPayload(pay.stamina ?? pay.staminaMinutes ?? player.stamina ?? player.staminaMinutes);
      if (stamina) currentState.stamina = stamina;
      if (pay.hunt) currentState.hunt = String(pay.hunt);
      const gold = pay.gold ?? player.gold;
      if (typeof gold === 'number' && Number.isFinite(gold)) currentState.gold = gold;
      if (pay.name) currentState.character = String(pay.name);
    }
  };

  const browserCtx = await launchBrowser(
    config,
    () => { wsConnected = true; lastWsFrame = Date.now(); watchdog.onWsOpen(); },
    onWsFrame,
    () => { wsConnected = false; watchdog.onWsClose(); },
  );

  pageRef = browserCtx.page;
  cdpRef = browserCtx.cdp;
  getFrameRef = browserCtx.getLatestFrame;

  let running = true;
  const shutdown = async () => {
    if (!running) return;
    running = false;
    console.log('\n[*] Encerrando bot com segurança...');
    await browserCtx.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let lastPrint = 0;
  while (running) {
    const started = Date.now();
    try {
      const w = await watchdog.checkAndRecover(pageRef, cdpRef);
      if (w.reconnected) console.log(`[WATCHDOG] sessão restaurada (${w.reason || 'DOM'})`);

      const result = await automation.tick(pageRef, config, currentState);
      currentState = { ...currentState, ...result.patch, subsystems };
      currentState.connected = wsConnected;
      currentState.online = wsConnected && (Date.now() - lastWsFrame < 35_000);

      for (const line of result.logs) {
        console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${line}`);
        if (line.includes('CONFIGUROU_AUTOSELL')) subsystems.auto_sell = { status: 'FUNCIONAL', detail: `Nativo do servidor sincronizado em ${config.sellThresholdPct}%` };
        if (line.includes('TREINO]') && result.inTreino) subsystems.treino = { status: 'TREINANDO', detail: 'Stamina baixa — treino online ativo' };
        if (line.includes('AUTO-EQUIP]') && !line.includes('erro')) subsystems.auto_equip = { status: 'FUNCIONAL', detail: 'Verificação automática ativa' };
        if (line.includes('[BOSS]') && !line.includes('erro')) subsystems.boss = { status: 'FUNCIONAL', detail: 'Rotação automática de bosses ativa' };
      }
      if (!result.inTreino && subsystems.treino.status === 'TREINANDO') subsystems.treino = { status: 'FUNCIONAL', detail: 'Stamina recuperada — hunts retomadas' };

      profiler.recordTick(currentState.hunt, currentState.kills, currentState.waves, currentState.gold, profiler.sessionDeaths);
      const rates = profiler.getRates();
      const hudAnalyzer = currentState.analyzers || {};
      currentState.analyzer = {
        kills_hour: rates.killsPerHour,
        gold_hour: rates.goldPerHour,
        exp_hour: Number(hudAnalyzer.xp_per_hour || hudAnalyzer.exp_hour || 0) || undefined,
        loot_hour: Number(hudAnalyzer.loot_per_hour || hudAnalyzer.loot_hour || 0) || undefined,
        deaths: profiler.sessionDeaths,
      };
      currentState.last_update = new Date().toLocaleTimeString('pt-BR');

      if (Date.now() - lastPrint >= 30_000) {
        lastPrint = Date.now();
        console.log(`[TELEMETRIA] Hunt=${currentState.hunt} | Lvl=${currentState.level} | Gold=${currentState.gold.toLocaleString()} | Kills=${currentState.kills} | Loop=${currentState.loop_mode ? 'ON' : 'OFF'} | Party=${currentState.party_slots} | Treino=${currentState.treino ? 'ON' : 'OFF'}`);
      }
    } catch (err) {
      console.warn('[LOOP ERRO]', err);
    }

    const elapsed = Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, Math.max(250, 1500 - elapsed)));
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exitCode = 1;
});
