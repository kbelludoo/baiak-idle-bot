import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { BotConfig } from './types';

export function loadDotenv(path?: string): void {
  const candidates = [
    path,
    join(process.cwd(), '.env'),
    join(process.cwd(), 'bot-ts', '.env'),
    join(import.meta.dir, '..', '.env'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf-8');
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#') || !t.includes('=')) continue;
          const idx = t.indexOf('=');
          const key = t.slice(0, idx).trim();
          const val = t.slice(idx + 1).trim();
          if (key && !(key in process.env)) process.env[key] = val;
        }
        break;
      } catch (_) {}
    }
  }
}

export function findDefaultChromePath(): string {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Detecta Chromium instalado no cache do Playwright se disponível
  try {
    const pwDir = join(process.env.HOME || '', '.cache/ms-playwright');
    if (existsSync(pwDir)) {
      const dirs = readdirSync(pwDir).filter(d => d.startsWith('chromium-'));
      for (const d of dirs.sort().reverse()) {
        const p = join(pwDir, d, 'chrome-linux64', 'chrome');
        if (existsSync(p)) return p;
      }
    }
  } catch (_) {}
  return '/usr/bin/chromium';
}

function envFlag(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return def;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || !String(raw).trim()) return def;
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : def;
}

function envStr(name: string, def = ''): string {
  const raw = process.env[name];
  return raw === undefined || raw === null ? def : String(raw).trim();
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function parseConfig(): BotConfig {
  loadDotenv();
  const env = process.env;
  const rawArgs = [...process.argv.slice(2)];

  if (env.BOT_ARGS) {
    rawArgs.push(...env.BOT_ARGS.split(/\s+/).filter(Boolean));
  }

  const has = (flag: string) => rawArgs.includes(flag);
  const getVal = (flag: string, fallback: string) => {
    const idx = rawArgs.indexOf(flag);
    if (idx !== -1 && idx + 1 < rawArgs.length) return rawArgs[idx + 1];
    return fallback;
  };

  const headless = has('--no-headless') ? false : (env.HEADLESS === '0' || env.HEADLESS === 'false' ? false : true);
  // STREAM explícito vence; senão cai p/ LIVE_STREAM (default true p/ paridade com bot.py).
  // Sem isso, STREAM=false na VPS era ignorado e o screencast comia a CPU.
  const stream = has('--stream') ? true
    : has('--no-stream') ? false
    : env.STREAM !== undefined ? envFlag('STREAM', false)
    : envFlag('LIVE_STREAM', true);
  const autoHunt = has('--no-hunt') ? false : !envFlag('AUTO_HUNT_OFF', false) && envFlag('AUTO_HUNT', true);
  const autoHeal = has('--no-heal') ? false : envFlag('AUTO_HEAL', true);
  const autoSell = has('--no-sell') ? false : envFlag('AUTO_SELL', true);
  const autoTreino = has('--no-treino') ? false : envFlag('AUTO_TREINO', true);
  const autoBoss = has('--no-boss') ? false : envFlag('AUTO_BOSS', true);
  const autoEquip = has('--no-equip') ? false : envFlag('AUTO_EQUIP', true);
  const autoBags = has('--no-bags') ? false : envFlag('AUTO_BAGS', true);
  const autoPrey = has('--no-prey') ? false : envFlag('AUTO_PREY', true);
  const autoExtras = has('--no-extras') ? false : envFlag('AUTO_EXTRAS', true);
  const forceHunt = has('--force-hunt') || envFlag('FORCE_HUNT', false) || (env.HUNT_MODE || '').toLowerCase() === 'force';
  const huntId = getVal('--hunt-id', env.HUNT_ID || '');
  const huntModeRaw = getVal('--hunt-mode', env.HUNT_MODE || (forceHunt ? 'force' : 'last')).toLowerCase();
  const huntMode = forceHunt ? 'force' : ((['last', 'force', 'engine', 'hybrid'].includes(huntModeRaw) ? huntModeRaw : 'last') as BotConfig['huntMode']);

  const sellThresholdPct = clamp(parseInt(getVal('--sell-pct', String(envInt('SELL_THRESHOLD_PCT', 70))), 10) || 70, 10, 100);
  const healBelowPct = clamp(parseInt(getVal('--heal-pct', String(envInt('HEAL_BELOW_PCT', 75))), 10) || 75, 10, 95);
  const hpPotionBelowPct = clamp(parseInt(getVal('--hp-pot-pct', String(envInt('HP_POTION_BELOW_PCT', 60))), 10) || 60, 10, 95);
  const manaPotionBelowPct = clamp(parseInt(getVal('--mana-pot-pct', String(envInt('MANA_POTION_BELOW_PCT', 65))), 10) || 65, 10, 95);

  return {
    headless,
    port: parseInt(getVal('--port', env.PORT || '8080'), 10),
    host: getVal('--host', env.HOST || '0.0.0.0'),
    stream,
    streamFps: clamp(parseInt(getVal('--stream-fps', String(envInt('STREAM_FPS', 12))), 10) || 12, 4, 24),
    streamQuality: clamp(parseInt(getVal('--stream-quality', String(envInt('STREAM_QUALITY', 70))), 10) || 70, 40, 85),
    streamWidth: clamp(parseInt(getVal('--stream-width', String(envInt('STREAM_WIDTH', 854))), 10) || 854, 320, 1280),
    streamHeight: clamp(parseInt(getVal('--stream-height', String(envInt('STREAM_HEIGHT', 480))), 10) || 480, 240, 720),
    autoHunt,
    forceHunt,
    huntId,
    huntMode,
    exploreSampleSec: Math.max(30, envInt('EXPLORE_SAMPLE_SEC', 120)),
    exploreMaxDeaths: Math.max(0, envInt('EXPLORE_MAX_DEATHS', 0)),
    exploreMaxDamageTakenPct: Math.max(1, Math.min(100, envInt('EXPLORE_MAX_DAMAGE_TAKEN_PCT', 35))),
    exploreCooldownSec: Math.max(60, envInt('EXPLORE_COOLDOWN_SEC', 1200)),
    autoHeal,
    healBelowPct,
    hpPotionBelowPct,
    manaPotionBelowPct,
    autoSell,
    sellThresholdPct,
    autoTreino,
    autoBoss,
    autoEquip,
    autoBags,
    autoPrey,
    autoExtras,
    screenshot: envInt('SCREENSHOT_INTERVAL', 0) > 0,
    userDataDir: getVal('--user-data-dir', env.USER_DATA_DIR || (existsSync('/app') ? '/app/data/chrome_profile' : join(process.cwd(), 'data', 'chrome_profile'))),
    chromePath: getVal('--chrome-path', env.CHROME_PATH || findDefaultChromePath()),
    targetUrl: env.TARGET_URL || 'https://baiakidle.com/jogar/',
    token: getVal('--token', env.BAIAK_TOKEN || ''),
    reduceVfx: has('--no-reduce-vfx') ? false : envFlag('REDUCE_VFX', true),
    chromeGl: getVal('--chrome-gl', env.CHROME_GL || 'swiftshader').toLowerCase(),
    auctionEnabled: has('--no-auction') ? false : envFlag('AUCTION_ENABLED', true),
    auctionLive: has('--auction-live') || envFlag('AUCTION_LIVE', false),
    auctionBudget: parseInt(getVal('--auction-budget', env.AUCTION_BUDGET || '100'), 10),
    auctionMinMarginPct: parseInt(getVal('--auction-margin', env.AUCTION_MARGIN || '25'), 10),
    auctionMaxItems: parseInt(getVal('--auction-max-items', env.AUCTION_MAX_ITEMS || '2'), 10),
  };
}

export function describeFlags(c: BotConfig): string {
  const bits = [
    `hunt=${c.autoHunt ? 'ON' : 'OFF'}`,
    `treino=${c.autoTreino ? 'ON' : 'OFF'}`,
    `sell=${c.autoSell ? 'ON' : 'OFF'}@${c.sellThresholdPct}%`,
    `boss=${c.autoBoss ? 'ON' : 'OFF'}`,
    `heal=${c.autoHeal ? 'ON' : 'OFF'}@${c.healBelowPct}%`,
    `pot_hp=${c.hpPotionBelowPct}%`,
    `pot_mp=${c.manaPotionBelowPct}%`,
    `vfx=${c.reduceVfx ? 'low' : 'full'}`,
    `headless=${c.headless ? 'ON' : 'OFF'}`,
    `screenshot=${c.screenshot ? 'ON' : 'OFF'}`,
    c.stream ? `stream=${c.streamWidth}x${c.streamHeight}@${c.streamFps}q${c.streamQuality}` : 'stream=OFF',
  ];
  if (c.forceHunt && c.huntId) bits.push(`force_hunt=${c.huntId}`);
  else if (c.huntId) bits.push('hunt_id=ignorado (última hunt)');
  return bits.join(' | ');
}
