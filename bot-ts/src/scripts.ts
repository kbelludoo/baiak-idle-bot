import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Page } from 'puppeteer-core';

const SCRIPTS: Record<string, string> = {};

export function loadScript(name: string): string {
  if (SCRIPTS[name]) return SCRIPTS[name];

  const possiblePaths = [
    join(import.meta.dir, 'scripts', `page_${name}.js`),
    join(import.meta.dir, '..', 'src', 'scripts', `page_${name}.js`),
    join(process.cwd(), 'src', 'scripts', `page_${name}.js`),
    join(process.cwd(), 'bot-ts', 'src', 'scripts', `page_${name}.js`),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8').trim();
      SCRIPTS[name] = content;
      return content;
    }
  }

  console.warn(`[SCRIPTS] Script page_${name}.js não encontrado nos caminhos conhecidos.`);
  return '';
}

/**
 * Executa um script injetado de forma segura com timeout de proteção (padrão 12s).
 */
export async function safeEval<T = any>(
  page: Page | null,
  name: string,
  arg: any = null,
  timeoutMs: number = 12000
): Promise<T | null> {
  if (!page) return null;
  const js = loadScript(name);
  if (!js) return null;

  try {
    const cleanJs = js.trim().replace(/;+$/, '');
    const result = await page.evaluate(
      async (scriptName: string, code: string, argData: any, timeout: number) => {
        const w = window as any;
        if (!w.__bot_scripts) w.__bot_scripts = {};
        if (!w.__bot_scripts[scriptName]) {
          w.__bot_scripts[scriptName] = eval('(' + code + ')');
        }
        const fn = w.__bot_scripts[scriptName];
        return await Promise.race([
          Promise.resolve().then(() => fn(argData)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout_' + Math.round(timeout / 1000) + 's')), timeout)
          ),
        ]);
      },
      name,
      cleanJs,
      arg,
      timeoutMs
    ) as T;
    return result;
  } catch (err: any) {
    if (!err?.message?.includes('Execution context was destroyed')) {
      console.warn(`[SAFE_EVAL AVISO] [${name}] ${err?.message || err}`);
    }
    return null;
  }
}
