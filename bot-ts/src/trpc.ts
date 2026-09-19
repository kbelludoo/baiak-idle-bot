/**
 * Cliente tRPC real do Baiak Idle (paridade com o bundle index.js).
 * - Base: https://baiakidle.com/api/trpc
 * - Header: `authorization: Bearer <token>` (minúsculo, como o jogo envia)
 * - Queries: GET `<base>/<path>?batch=1&input=<json>` (batch tRPC v10)
 * - Mutations: POST `<base>/<path>?batch=1` com body JSON
 * - Resposta pode vir embrulhada em superjson (`{json, meta}`) ou plain.
 * O bot antigo fazia `GET .../characters.list` com `Bearer` puro — 400/401
 * garantido. Este cliente tenta os formatos reais em ordem e desembrulha.
 */

const TRPC_BASE = 'https://baiakidle.com/api/trpc';

function unwrapResult(item: any): any {
  if (item == null) return item;
  // batch v10: [{result:{data:{json:...}}}] ou [{result:{data:...}}]
  // tRPC v11: [{result:{data:{json:..., meta:...}}}]
  const data = item?.result?.data ?? item?.data ?? item;
  if (data && typeof data === 'object' && 'json' in data && Object.keys(data).length <= 2) {
    return (data as any).json;
  }
  return data;
}

function parseBatch(text: string): any[] {
  const json = JSON.parse(text);
  if (Array.isArray(json)) return json.map(unwrapResult);
  return [unwrapResult(json)];
}

function inputParam(input: any): string {
  // batch=1 exige `input={"0":{"json":<input>}}`; sem input usa {"0":{"json":null}}
  const wrapped = { '0': { json: input === undefined ? null : input } };
  return encodeURIComponent(JSON.stringify(wrapped));
}

async function doFetch(url: string, init: RequestInit, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface TrpcClient {
  query<T = any>(path: string, input?: any): Promise<T>;
  mutate<T = any>(path: string, input?: any): Promise<T>;
}

export function createTrpcClient(token: string, base: string = TRPC_BASE): TrpcClient {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  };
  if (token) {
    // O jogo envia minúsculo; alguns edges aceitam os dois — manda os dois.
    headers['authorization'] = `Bearer ${token}`;
    headers['Authorization'] = `Bearer ${token}`;
  }

  return {
    async query<T = any>(path: string, input?: any): Promise<T> {
      const errors: string[] = [];
      // 1) Formato real do bundle: batch=1 + input embrulhado em {json}
      const urls = [
        `${base}/${path}?batch=1&input=${inputParam(input)}`,
        `${base}/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': input ?? null }))}`,
        `${base}/${path}`,
      ];
      for (const url of urls) {
        try {
          const res = await doFetch(url, { headers });
          if (res.status === 401) { errors.push('401'); continue; }
          if (!res.ok) { errors.push(String(res.status)); continue; }
          const rows = parseBatch(await res.text());
          return rows[0] as T;
        } catch (err: any) {
          errors.push(err?.message || String(err));
        }
      }
      throw new Error(`tRPC query ${path} falhou (${errors.join('/')})`);
    },

    async mutate<T = any>(path: string, input?: any): Promise<T> {
      const errors: string[] = [];
      const bodies = [
        JSON.stringify({ '0': { json: input === undefined ? null : input } }),
        JSON.stringify({ '0': input ?? null }),
        JSON.stringify(input ?? {}),
      ];
      for (const body of bodies) {
        try {
          const res = await doFetch(`${base}/${path}?batch=1`, { method: 'POST', headers, body });
          if (res.status === 401) { errors.push('401'); continue; }
          if (!res.ok) { errors.push(String(res.status)); continue; }
          const rows = parseBatch(await res.text());
          return rows[0] as T;
        } catch (err: any) {
          errors.push(err?.message || String(err));
        }
      }
      throw new Error(`tRPC mutate ${path} falhou (${errors.join('/')})`);
    },
  };
}

/** Normaliza `characters.list` (array ou mapa) para [{id,name,vocation,level}]. */
export function normalizeChars(raw: any): Array<{ id: any; name: string; vocation: string; level: number }> {
  const list = Array.isArray(raw) ? raw : raw?.chars || raw?.characters || raw?.list || [];
  if (!Array.isArray(list)) return [];
  return list
    .map((c: any) => ({
      id: c?.id ?? c?.characterId ?? null,
      name: String(c?.name || c?.nick || ''),
      vocation: String(c?.vocation || c?.voc || '').toLowerCase(),
      level: parseInt(String(c?.level ?? c?.lvl ?? 1), 10) || 1,
    }))
    .filter((c) => c.name);
}
