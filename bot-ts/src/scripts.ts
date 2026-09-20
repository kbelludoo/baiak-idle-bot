import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Page } from 'puppeteer-core';

const SCRIPTS: Record<string, string> = {};
// Um evaluate que expirou no limite externo ainda pode estar aguardando o
// renderer. Impedir outra avaliação concorrente evita uma fila de promises
// dentro do Chromium, que era a causa dos timeouts em cascata de HUD/spell.
const ACTIVE_EVAL_PAGES = new WeakSet<object>();

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
  const pageObject = page as unknown as object;
  if (ACTIVE_EVAL_PAGES.has(pageObject)) return null;
  ACTIVE_EVAL_PAGES.add(pageObject);
  const js = loadScript(name);
  if (!js) {
    ACTIVE_EVAL_PAGES.delete(pageObject);
    return null;
  }

  try {
    const cleanJs = js.trim().replace(/;+$/, '');
    const evaluatePromise = page.evaluate(
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
    ) as Promise<T>;
    // Puppeteer pode ficar aguardando a resposta CDP quando o renderer está
    // saturado; o timeout acima vive dentro da página e não cobre essa fila.
    // Este segundo limite garante que nenhuma ação prenda o loop/sonda para
    // sempre. O +1s deixa o timeout da página retornar a razão mais precisa
    // quando o renderer ainda está respondendo.
    const result = await Promise.race([
      evaluatePromise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`outer_timeout_${Math.ceil((timeoutMs + 1000) / 1000)}s`)), timeoutMs + 1000)),
    ]);
    return result;
  } catch (err: any) {
    if (!err?.message?.includes('Execution context was destroyed')) {
      console.warn(`[SAFE_EVAL AVISO] [${name}] ${err?.message || err}`);
    }
    return null;
  } finally {
    ACTIVE_EVAL_PAGES.delete(pageObject);
  }
}
