import { parseConfig } from './config';
import { launchBrowser } from './browser';
import { Watchdog } from './watchdog';
import { Profiler } from './profiler';
import { startServer } from './server';
import type { TelemetryState, SubsystemInfo } from './types';

async function main() {
  console.log('====================================================================');
  console.log(' ⚔️  BAIAK IDLE BOT v2 — 100% TYPESCRIPT COM BUN');
  console.log(' [*] Execução direta em memória (Zero arquivos .js em disco)');
  console.log(' [*] Servidor nativo Bun.serve() de ultra-baixa latência');
  console.log('====================================================================');

  const config = parseConfig();
  console.log(`[*] Configurações: Headless=${config.headless} | Porta=${config.port} | Stream=${config.stream}`);
  console.log(`[*] Automações: Hunt=${config.autoHunt} | Heal=${config.autoHeal} | Sell=${config.autoSell} | Treino=${config.autoTreino}`);

  const watchdog = new Watchdog();
  const profiler = new Profiler();

  const subsystems: Record<string, SubsystemInfo> = {
    anti_bot: { status: 'FUNCIONAL', detail: 'Presença humana nativa CDP (isTrusted: true) ativa' },
    auto_sell: { status: config.autoSell ? 'FUNCIONAL' : 'AGUARDANDO', detail: config.autoSell ? 'Nativo do servidor 75%' : 'Desativado' },
    auto_heal: { status: config.autoHeal ? 'FUNCIONAL' : 'AGUARDANDO', detail: config.autoHeal ? 'Cura (<75%), HP (<60%), MP (<65%)' : 'Desativado' },
    watchdog: { status: 'FUNCIONAL', detail: 'Auto-Reconnect ativo (0ms latência)' },
    hunt_analyzer: { status: 'FUNCIONAL', detail: 'Coleta de telemetria contínua ativa' }
  };

  let currentState: TelemetryState = {
    online: false,
    hunt: 'Conectando...',
    kills: 0,
    waves: 0,
    loop_mode: false,
    stamina: '—',
    bag_slots: '—',
    party_slots: 3,
    level: 0,
    gold: 0,
    shooters: [],
    analyzer: { deaths: 0 },
    subsystems,
    last_update: new Date().toLocaleTimeString('pt-BR')
  };

  let pageRef: any = null;
  let cdpRef: any = null;
  let getFrameRef: (() => Buffer | null) = () => null;

  // Inicia Servidor Web Bun
  startServer(config.port, config.host, {
    getState: () => currentState,
    getPage: () => pageRef,
    getCdp: () => cdpRef,
    getLatestFrame: () => getFrameRef(),
  });

  // Inicia o Navegador
  const browserCtx = await launchBrowser(
    config,
    () => watchdog.onWsOpen(),
    () => watchdog.onWsFrame(),
    () => watchdog.onWsClose()
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
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let lastPrint = Date.now();

  // Loop Principal de Operação
  while (running) {
    try {
      // 1. Checagem do Watchdog (Auto-Reconnect)
      const wResult = await watchdog.checkAndRecover(pageRef, cdpRef);
      if (wResult.reconnected) {
        console.log(`[WATCHDOG] 🔄 Sessão restaurada com sucesso! (${wResult.reason})`);
      }

      // 2. Extração de Telemetria e Leitura do DOM
      const domState = await pageRef.evaluate(() => {
        const wave = (document.getElementById('wave-title')?.textContent || '').trim();
        const stam = (document.getElementById('stamina-time')?.textContent || '').trim();
        const inv = (document.getElementById('inv-count')?.textContent || '').trim();
        const loopBtn = document.getElementById('hunt-loop-btn');
        const loopOn = loopBtn ? loopBtn.classList.contains('active') : false;

        let gold = 0;
        const goldEl = document.getElementById('gold-count') || document.querySelector('.mk-goldamt, .ac-wallet-val, .wallet, .bp-wallet b');
        if (goldEl) {
          const m = (goldEl.textContent || '').replace(/[^0-9]/g, '');
          if (m) gold = parseInt(m, 10);
        }

        let level = 0;
        const lvlEl = document.querySelector('.hd-lvl, .player-level, #player-level, .pm-lvl');
        if (lvlEl) {
          const m = (lvlEl.textContent || '').match(/\\d+/);
          if (m) level = parseInt(m[0], 10);
        }

        // Estado da Party via Kernel
        const party = (window as any).__baiak_party ? (window as any).__baiak_party.getState() : { shooters: [] };

        // Garante loop mode ativo
        if (loopBtn && !loopOn) {
          loopBtn.click();
        }

        return { wave, stam, inv, loopOn, gold, level, shooters: party.shooters || [] };
      }).catch(() => null);

      if (domState) {
        currentState = {
          online: true,
          hunt: domState.wave || currentState.hunt,
          kills: currentState.kills,
          waves: currentState.waves,
          loop_mode: domState.loopOn,
          stamina: domState.stam || currentState.stamina,
          bag_slots: domState.inv || currentState.bag_slots,
          party_slots: domState.shooters.length || currentState.party_slots,
          level: domState.level || currentState.level,
          gold: domState.gold || currentState.gold,
          shooters: domState.shooters,
          analyzer: {
            ...profiler.getRates(),
            deaths: profiler.sessionDeaths,
          },
          subsystems,
          last_update: new Date().toLocaleTimeString('pt-BR')
        };
      }

      // 3. Relatório Periódico no Console
      if (Date.now() - lastPrint > 30000) {
        lastPrint = Date.now();
        console.log(`[${new Date().toLocaleTimeString()}] 📊 [TELEMETRIA] Hunt: ${currentState.hunt} | Lvl: ${currentState.level} | Gold: ${currentState.gold.toLocaleString()} | Loop: ${currentState.loop_mode ? 'ON' : 'OFF'} | Party: ${currentState.party_slots}`);
      }

    } catch (err: any) {
      // Ignora falhas isoladas de frame ou navegação
    }

    await new Promise(r => setTimeout(r, 1500));
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
