import type { BotConfig } from './types';

export function parseConfig(): BotConfig {
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
  const stream = has('--stream') || env.STREAM === '1' || env.STREAM === 'true';
  const autoHunt = has('--no-hunt') ? false : (env.AUTO_HUNT === '0' ? false : true);
  const autoHeal = has('--no-heal') ? false : (env.AUTO_HEAL === '0' ? false : true);
  const autoSell = has('--no-sell') ? false : (env.AUTO_SELL === '0' ? false : true);
  const autoTreino = has('--no-treino') ? false : (env.AUTO_TREINO === '0' ? false : true);
  const autoBoss = has('--no-boss') ? false : (env.AUTO_BOSS === '0' ? false : true);
  const autoEquip = has('--no-equip') ? false : (env.AUTO_EQUIP === '0' ? false : true);
  const forceHunt = has('--force-hunt');
  const huntId = getVal('--hunt-id', env.HUNT_ID || '');

  return {
    headless,
    port: parseInt(getVal('--port', env.PORT || '8080'), 10),
    host: getVal('--host', env.HOST || '0.0.0.0'),
    stream,
    streamFps: parseInt(getVal('--stream-fps', env.STREAM_FPS || '8'), 10),
    streamQuality: parseInt(getVal('--stream-quality', env.STREAM_QUALITY || '50'), 10),
    streamWidth: parseInt(getVal('--stream-width', env.STREAM_WIDTH || '800'), 10),
    streamHeight: parseInt(getVal('--stream-height', env.STREAM_HEIGHT || '540'), 10),
    autoHunt,
    forceHunt,
    huntId,
    autoHeal,
    healBelowPct: parseInt(getVal('--heal-pct', env.HEAL_PCT || '75'), 10),
    hpPotionBelowPct: parseInt(getVal('--hp-pot-pct', env.HP_POT_PCT || '60'), 10),
    manaPotionBelowPct: parseInt(getVal('--mana-pot-pct', env.MANA_POT_PCT || '65'), 10),
    autoSell,
    sellThresholdPct: parseInt(getVal('--sell-pct', env.SELL_PCT || '75'), 10),
    autoTreino,
    autoBoss,
    autoEquip,
    userDataDir: getVal('--user-data-dir', env.USER_DATA_DIR || '/app/data/chrome_profile'),
    chromePath: getVal('--chrome-path', env.CHROME_PATH || '/usr/bin/chromium'),
    targetUrl: env.TARGET_URL || 'https://baiakidle.com/jogar/',
    token: getVal('--token', env.BAIAK_TOKEN || ''),
    reduceVfx: has('--reduce-vfx') || env.REDUCE_VFX === '1' || env.REDUCE_VFX === 'true',
  };
}
