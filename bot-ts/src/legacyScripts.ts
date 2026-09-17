import type { Page } from 'puppeteer-core';

export type LegacyScriptName =
  | 'kernel_bot.js'
  | 'page_hud.js'
  | 'page_hunt.js'
  | 'page_treino.js'
  | 'page_potion.js'
  | 'page_bags.js'
  | 'page_boss.js'
  | 'page_equip.js'
  | 'page_prey.js'
  | 'page_extra.js'
  | 'page_spell.js';

const SCRIPT_NAMES: LegacyScriptName[] = [
  'kernel_bot.js', 'page_hud.js', 'page_hunt.js', 'page_treino.js', 'page_potion.js',
  'page_bags.js', 'page_boss.js', 'page_equip.js', 'page_prey.js', 'page_extra.js', 'page_spell.js',
];

function candidateDirs(): string[] {
  return [process.env.BAIAK_RUNTIME_DIR || '', `${import.meta.dir}/../../bot`, '/app/runtime'].filter(Boolean);
}

export async function loadLegacyScript(name: LegacyScriptName): Promise<string> {
  for (const dir of candidateDirs()) {
    const f = Bun.file(`${dir}/${name}`);
    if (await f.exists()) return await f.text();
  }
  throw new Error(`runtime_script_not_found:${name}`);
}

export async function loadLegacyScripts(): Promise<Record<LegacyScriptName, string>> {
  const entries = await Promise.all(SCRIPT_NAMES.map(async (name) => [name, await loadLegacyScript(name)] as const));
  return Object.fromEntries(entries) as Record<LegacyScriptName, string>;
}

export async function evalLegacy<T = any>(page: Page, source: string, arg: unknown = null, timeoutMs = 12000): Promise<T> {
  return await page.evaluate(async (src: string, fnArg: unknown, ms: number) => {
    const fn = (0, eval)(`(${src})`) as (arg: unknown) => unknown;
    return await Promise.race([
      Promise.resolve().then(() => fn(fnArg)),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`legacy_timeout_${ms}ms`)), ms)),
    ]);
  }, source, arg, timeoutMs) as T;
}
