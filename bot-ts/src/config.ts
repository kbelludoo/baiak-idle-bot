import type { BotConfig } from './types';

const TRUE = new Set(['1', 'true', 'yes', 'on', 'y', 'sim']);
const FALSE = new Set(['0', 'false', 'no', 'off', 'n', 'nao', 'não']);

function envBool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return fallback;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw || '', 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

export function parseConfig(): BotConfig {
  const env = process.env;
  const rawArgs = [...process.argv.slice(2)];
  if (env.BOT_ARGS) rawArgs.push(...env.BOT_ARGS.split(/\s+/).filter(Boolean));

  const has = (flag: string) => rawArgs.includes(flag);
  const getVal = (flag: string, fallback: string) => {
    const idx = rawArgs.indexOf(flag);
    return idx >= 0 && idx + 1 < rawArgs.length ? rawArgs[idx + 1] : fallback;
  };
  const argBool = (disableFlag: string, envName: string, fallback: boolean) =>
    has(disableFlag) ? false : envBool(env, envName, fallback);

  const streamEnv = env.LIVE_STREAM ?? env.STREAM;
  const headless = has('--no-headless') ? false : envBool(env, 'HEADLESS', true);
  const stream = has('--no-stream') ? false : (has('--stream') ? true : envBool({ LIVE_STREAM: streamEnv } as NodeJS.ProcessEnv, 'LIVE_STREAM', true));

  const sellThreshold = clampInt(getVal('--sell-pct', env.SELL_THRESHOLD_PCT || env.SELL_PCT || '70'), 70, 10, 100);
  const healThreshold = clampInt(getVal('--heal-pct', env.HEAL_BELOW_PCT || env.HEAL_PCT || '75'), 75, 10, 95);
  const hpThreshold = clampInt(getVal('--hp-pot-pct', env.HP_POTION_BELOW_PCT || env.HP_POT_PCT || '60'), 60, 10, 95);
  const manaThreshold = clampInt(getVal('--mana-pot-pct', env.MANA_POTION_BELOW_PCT || env.MANA_POT_PCT || '65'), 65, 10, 95);

  return {
    headless,
    port: clampInt(getVal('--port', env.PORT || '8080'), 8080, 1, 65535),
    host: getVal('--host', env.HOST || '0.0.0.0'),
    stream,
    streamFps: clampInt(getVal('--stream-fps', env.STREAM_FPS || '12'), 12, 4, 24),
    streamQuality: clampInt(getVal('--stream-quality', env.STREAM_QUALITY || '70'), 70, 40, 85),
    streamWidth: clampInt(getVal('--stream-width', env.STREAM_WIDTH || '854'), 854, 320, 1280),
    streamHeight: clampInt(getVal('--stream-height', env.STREAM_HEIGHT || '480'), 480, 240, 720),
    autoHunt: argBool('--no-hunt', 'AUTO_HUNT', true),
    forceHunt: has('--force-hunt') || envBool(env, 'FORCE_HUNT', false),
    huntId: getVal('--hunt-id', env.HUNT_ID || ''),
    autoHeal: argBool('--no-heal', 'AUTO_HEAL', true),
    healBelowPct: healThreshold,
    hpPotionBelowPct: hpThreshold,
    manaPotionBelowPct: manaThreshold,
    autoSell: argBool('--no-sell', 'AUTO_SELL', true),
    sellThresholdPct: sellThreshold,
    autoTreino: argBool('--no-treino', 'AUTO_TREINO', true),
    autoBoss: argBool('--no-boss', 'AUTO_BOSS', true),
    autoBags: argBool('--no-bags', 'AUTO_BAGS', true),
    autoEquip: argBool('--no-equip', 'AUTO_EQUIP', true),
    autoPrey: argBool('--no-prey', 'AUTO_PREY', true),
    autoExtras: argBool('--no-extras', 'AUTO_EXTRAS', true),
    userDataDir: getVal('--user-data-dir', env.USER_DATA_DIR || '/app/data/chrome_profile'),
    chromePath: getVal('--chrome-path', env.CHROME_PATH || '/usr/bin/chromium'),
    targetUrl: env.TARGET_URL || 'https://baiakidle.com/jogar/',
    token: getVal('--token', env.BAIAK_TOKEN || ''),
    reduceVfx: has('--reduce-vfx') || envBool(env, 'REDUCE_VFX', true),
  };
}
