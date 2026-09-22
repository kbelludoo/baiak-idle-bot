import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Page } from 'puppeteer-core';

const SCRIPTS: Record<string, string> = {};
// Um evaluate que expirou no limite externo ainda pode estar aguardando o
// renderer. Impedir outra avaliação concorrente evita uma fila de promises
// dentro do Chromium, que era a causa dos timeouts em cascata de HUD/spell.
// Um timeout externo não cancela o Runtime.evaluate do Chromium.  Se o lock
// for liberado no finally, a próxima ação inicia outro evaluate enquanto o
// anterior ainda está pendente e o renderer entra numa cascata de timeouts.
// Mantemos o promise vivo no lock até ele realmente terminar.
const ACTIVE_EVAL_PAGES = new WeakMap<object, Promise<unknown>>();

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
  timeoutMs: number = 20000
): Promise<T | null> {
  if (!page) return null;
  const pageObject = page as unknown as object;

  // Se já houver um evaluate em andamento na página, aguarde até 6s para ele liberar
  if (ACTIVE_EVAL_PAGES.has(pageObject)) {
    const existing = ACTIVE_EVAL_PAGES.get(pageObject);
    if (existing) {
      try {
        await Promise.race([
          existing,
          new Promise((r) => setTimeout(r, 6000))
        ]);
      } catch (_) {}
    }
  }

  const js = loadScript(name);
  if (!js) return null;

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

    let trackedEvaluate: Promise<T>;
    trackedEvaluate = evaluatePromise.finally(() => {
      if (ACTIVE_EVAL_PAGES.get(pageObject) === trackedEvaluate) {
        ACTIVE_EVAL_PAGES.delete(pageObject);
      }
    });
    ACTIVE_EVAL_PAGES.set(pageObject, trackedEvaluate);

    const result = await Promise.race([
      trackedEvaluate,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`outer_timeout_${Math.ceil((timeoutMs + 2000) / 1000)}s`)), timeoutMs + 2000)
      ),
    ]);
    return result;
  } catch (err: any) {
    ACTIVE_EVAL_PAGES.delete(pageObject);
    if (!err?.message?.includes('Execution context was destroyed')) {
      console.warn(`[SAFE_EVAL AVISO] [${name}] ${err?.message || err}`);
    }
    return null;
  }
}
