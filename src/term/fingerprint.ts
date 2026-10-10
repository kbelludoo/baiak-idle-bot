/**
 * Identidade de cliente para o driver terminal (sem navegador).
 *
 * O bundle do jogo monta o `fp` do join como
 *   `${deviceId32}-${hash(ua|screenW|screenH|colorDepth|tzOffset|lang)}`
 * com hash djb2 (YT) e deviceId persistido em localStorage ("baiak_device").
 * O `ext` é a lista de tokens anti-monkey-patch ("p:*") detectados no cliente;
 * um cliente terminal não patcha nada, então a lista é legitimamente vazia.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export const TERM_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export const DEVICE_FILE = 'baiak_device';

/** djb2 do bundle (YT): t = ((t << 5) + t + charCode) >>> 0, hex de 8 chars. */
export function yt(input: string): string {
  let t = 5381;
  for (let i = 0; i < input.length; i++) t = ((t << 5) + t + input.charCodeAt(i)) >>> 0;
  return t.toString(16).padStart(8, '0');
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Equivalente a crypto.randomUUID() sem hifens (dj do bundle). */
export function newDeviceId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
  return randomHex(16);
}

export interface FingerprintEnv {
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  colorDepth: number;
  timezoneOffsetMin: number;
  language: string;
}

export function defaultEnv(overrides: Partial<FingerprintEnv> = {}): FingerprintEnv {
  return {
    userAgent: process.env.TERM_UA || TERM_UA,
    screenWidth: Number(process.env.TERM_SCREEN_W || 1280),
    screenHeight: Number(process.env.TERM_SCREEN_H || 720),
    colorDepth: Number(process.env.TERM_COLOR_DEPTH || 24),
    timezoneOffsetMin: Number(process.env.TERM_TZ_OFFSET ?? -180),
    language: process.env.TERM_LANG || 'pt-BR',
    ...overrides,
  };
}

export function buildFingerprint(deviceId: string, env: FingerprintEnv = defaultEnv()): string {
  const raw = [
    env.userAgent,
    env.screenWidth,
    env.screenHeight,
    env.colorDepth,
    env.timezoneOffsetMin,
    env.language,
  ].join('|');
  return `${deviceId.slice(0, 32)}-${yt(raw)}`;
}

/**
 * Lista `ext`: o jogo envia os tokens anti-patch que detectou, no formato
 * "p:nome" (ex.: "p:ws.ctor"). Sem DOM e sem monkey-patch o conjunto é vazio,
 * que é o valor honesto — não forjamos tokens.
 */
export function buildExt(tokens: string[] = []): string[] {
  const out = new Set<string>();
  for (const raw of tokens) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().toLowerCase();
    if (/^[a-z0-9._:-]{1,40}$/.test(t)) out.add(t);
  }
  return [...out].sort().slice(0, 32);
}

/** Lê (ou cria) o device id estável em `dir`, para o fp não mudar a cada boot. */
export function loadOrCreateDeviceId(dir: string, file: string = DEVICE_FILE): string {
  const path = join(dir, file);
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8').trim();
      if (/^[0-9a-f]{16,64}$/i.test(raw)) return raw;
    }
  } catch (_) {}
  const id = newDeviceId();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, id, 'utf-8');
  } catch (_) {}
  return id;
}