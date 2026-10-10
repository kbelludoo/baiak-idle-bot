/**
 * CLI do driver terminal.
 *
 *   bun run src/term/main.ts --probe                 # diagnóstico (join + frames)
 *   bun run src/term/main.ts --hunt-id=glooth-cave    # fica na hunt
 *   bun run src/term/main.ts --log-sec=30 --poll-sec=60
 *
 * Reusa o .env do bot (BAIAK_TOKEN, HUNT_ID) e roda sem Chromium/Xvfb.
 */

import { loadDotenv } from '../config';
import { HUNTS_BY_ID } from '../hunts';
import { setupOutboundBind } from './bind_proxy';
import { probeSession, runHunter } from './hunter';

const USAGE = `
Baiak Idle - driver terminal (sem navegador, sem Chromium)

  --probe               faz matchmake + handshake e imprime os frames (diagnóstico)
  --once                entra na hunt, espera --session-sec e sai
  --hunt-id=<id>        hunt alvo (padrão: melhor hunt da tabela para o nível)
  --character=<nome>    personagem (padrão: o primeiro de characters.list)
  --log-sec=<n>         log de status a cada N s (padrão 60)
  --poll-sec=<n>        poll tRPC de level/gold/stamina (padrão 120, 0 desliga)
  --stale-sec=<n>       reconecta se ficar N s sem frames (padrão 120)
  --recycle-sec=<n>     recicla a sessão a cada N s (padrão 0 = nunca)
  --session-sec=<n>     duração do --probe/--once (padrão 20)
  --origin=<url>        origem do jogo (padrão https://baiakidle.com)
  --token=<token>       BAIAK_TOKEN do Local Storage
  --no-sell             desativa auto-sell de loot
  --no-rewards          desativa coleta periódica de recompensas
  --no-treino           desativa teleporte para Treino Online em stamina baixa
  --no-arena            desativa fila automática de Arena diária
  --no-codex            desativa entrega automática de itens do Codex
  --no-equip            desativa auto-equip de itens da mochila
  --no-tree             não gasta pontos da árvore de talentos (build) no boot
  --equip-min-tier=<n>  raridade mínima para equipar (padrão 3 = épico, igual ao jogo)
  --no-loop             não envia loop de hunts (mantém a stage escolhida)
  --control-port=<n>    porta do painel HTTP (padrão 8080, 0 desliga)
  --auto-boss           ativa auto-boss inteligente com avaliação de segurança JEV
  --bind-ip=<ip>        IP local de saída (multi-conta / multi-IP da VPS)
`;

function argVal(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = argv.indexOf(flag);
  if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
  return undefined;
}

function argInt(flag: string, fallback: number): number {
  const raw = argVal(flag);
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function has(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function main(): Promise<void> {
  loadDotenv();

  if (has('--help') || has('-h')) {
    console.log(USAGE.trim());
    return;
  }

  const token = argVal('--token') || process.env.BAIAK_TOKEN || '';
  if (!token) {
    console.error('[term] BAIAK_TOKEN vazio.');
    console.error('       F12 > Application > Local Storage > https://baiakidle.com > baiak-idle-token');
    process.exit(1);
  }

  const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

  const bindIp = argVal('--bind-ip') || process.env.BIND_IP;
  if (bindIp) {
    try {
      const p = await setupOutboundBind(bindIp);
      log(`[network] tráfego roteado via IP local ${bindIp} (proxy interno :${p})`);
    } catch (err: any) {
      log(`[network] erro ao vincular IP local ${bindIp}: ${err?.message || err}`);
    }
  }

  const huntId = argVal('--hunt-id') || process.env.HUNT_ID || '';
  if (huntId && !HUNTS_BY_ID[huntId]) {
    log(`[term] aviso: hunt "${huntId}" não está na tabela local; o servidor decide se aceita`);
  }

  const opts = {
    token,
    origin: argVal('--origin') || process.env.TERM_ORIGIN || process.env.TARGET_URL?.replace(/\/jogar\/?$/, '') || 'https://baiakidle.com',
    huntId: huntId || undefined,
    characterName: argVal('--character') || process.env.CHARACTER_NAME || undefined,
    pollSec: argInt('--poll-sec', 120),
    logSec: argInt('--log-sec', 60),
    staleSec: argInt('--stale-sec', 120),
    recycleSec: argInt('--recycle-sec', 0),
    dataDir: process.env.USER_DATA_DIR || './data',
    autoSell: !has('--no-sell') && process.env.AUTO_SELL !== 'false',
    autoRewards: !has('--no-rewards') && process.env.AUTO_REWARDS !== 'false',
    autoTreino: !has('--no-treino') && process.env.AUTO_TREINO !== 'false',
    autoArena: !has('--no-arena') && process.env.AUTO_ARENA !== 'false',
    autoCodex: !has('--no-codex') && process.env.AUTO_CODEX !== 'false',
    autoEquip: !has('--no-equip') && process.env.AUTO_EQUIP !== 'false',
    autoTree: !has('--no-tree') && process.env.AUTO_TREE !== 'false',
    equipMinTier: argInt('--equip-min-tier', Number(process.env.EQUIP_MIN_TIER ?? 3)),
    autoLoop: !has('--no-loop') && process.env.AUTO_LOOP !== 'false',
    controlPort: argInt('--control-port', Number(process.env.CONTROL_PORT ?? 8080)),
    autoBoss: has('--auto-boss') || process.env.AUTO_BOSS === 'true',
    log,
  };

  if (has('--probe') || has('--once')) {
    await probeSession({ ...opts, logSec: argInt('--session-sec', 20), verboseFrames: !has('--once') });
    return;
  }

  log('[term] driver terminal iniciado (sem browser). Ctrl+C para sair.');
  await runHunter(opts);
}

main().catch((err: any) => {
  console.error(`[term] fatal: ${err?.stack || err?.message || err}`);
  process.exit(1);
});