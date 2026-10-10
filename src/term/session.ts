/**
 * Fluxo de entrada na hunt sem navegador.
 *
 * Ordem do bundle do jogo:
 *  1. joinOrCreate("hunt", {token, characterId, fp, ext, disabled})
 *  2. se o servidor exigir fila: joinOrCreate("queue", {token}) -> "pos"/"go"
 *     -> leave() -> joinOrCreate("hunt", {..., admitToken})
 *  3. depois de entrar: send("ready"), send("mode",{mode:"hunt"}), send("stage",{huntId})
 *
 * Códigos de erro do servidor tratados (bundle 0.16 / ErrorCode):
 *  4293 fila de party lotada | 4294 boss ativo | 4290/4291/4295 IP/maintenance/ext
 *  4210..4215 matchmake | 401 sessão inválida
 */

import { Endpoint, MatchmakeError, Room, RoomError, matchmake } from './colyseus';

export type JoinFailure = 'queue' | 'boss' | 'seat' | 'ip' | 'maintenance' | 'auth' | 'unknown';

export interface HuntJoinOptions {
  token: string;
  characterId: string | number;
  fp: string;
  ext?: string[];
  disabled?: boolean;
  endpoint: Endpoint;
  log: (msg: string) => void;
  joinTimeoutMs?: number;
  queueTimeoutMs?: number;
  admitToken?: string;
}

export function classifyJoinError(err: any): JoinFailure {
  const code = Number(err?.code ?? 0);
  const msg = String(err?.message ?? err ?? '').toLowerCase();

  if (code === 4294 || /boss_active|boss ativo/.test(msg)) return 'boss';
  // Erro interno do Colyseus quando o seat do matchmake não é consumido:
  // não é fila nem token ruim — refaz o join do zero, sem esperar fila.
  if (/reservation expir|seat reservation/.test(msg)) return 'seat';
  if (code === 4290 || /ip_limit/.test(msg)) return 'ip';
  if (code === 4295 || /maintenance|manutenção|ext_block/.test(msg)) return 'maintenance';
  // Cada sala tem o seu code de token inválido (30736 na queue, 37121 na hunt);
// a mensagem "sessão inválida" cobre os dois, mas os codes fixam o contrato.
const AUTH_CODES = new Set([401, 30736, 37121]);
  if (AUTH_CODES.has(code) || /sess[ãa]o inv[áa]lida|token ausente|n[ãa]o autenticado|unauthorized/.test(msg)) return 'auth';
  // Fila de *party* lotada (4293) não é a nossa fila: é transitório, só re-tenta.
  if (code === 4293 || /party_queue|fila do grupo/.test(msg)) return 'unknown';
  // O texto da fila varia por tradução ("Aguarde sua vez para entrar na hunt.").
  if (/fila|queue|tier|admit|sua vez|turno|aguardar|wait your turn|capacity|entrar na hunt/.test(msg)) return 'queue';
  return 'unknown';
}

function huntBody(opts: HuntJoinOptions, admitToken?: string): Record<string, any> {
  if (admitToken) {
    // Com admitToken o jogo envia só token/characterId/fp/disabled (sem ext).
    return {
      token: opts.token,
      characterId: opts.characterId,
      fp: opts.fp,
      disabled: opts.disabled ?? false,
      admitToken,
    };
  }
  return {
    token: opts.token,
    characterId: opts.characterId,
    fp: opts.fp,
    ext: opts.ext ?? [],
    disabled: opts.disabled ?? false,
  };
}

async function openRoom(opts: HuntJoinOptions, roomName: string, body: Record<string, any>): Promise<Room> {
  const seat = await matchmake('joinOrCreate', roomName, body, {
    endpoint: opts.endpoint,
    timeoutMs: opts.joinTimeoutMs ?? 12_000,
  });
  return Room.open({
    seat,
    endpoint: opts.endpoint,
    log: opts.log,
    connectTimeoutMs: opts.joinTimeoutMs ?? 12_000,
  });
}

/**
 * Entra na sala da fila e devolve o admitToken do pacote "go".
 * "pos" só muda a posição exibida (log); "go" libera a entrada na hunt.
 */
export async function waitAdmitToken(opts: HuntJoinOptions): Promise<string> {
  const room = await openRoom(opts, 'queue', { token: opts.token });
  try {
    room.on('pos', (p: any) => {
      const pos = p && typeof p === 'object' ? (p.position ?? p.pos) : p;
      if (pos !== undefined) opts.log(`[term] fila: posição ${pos}`);
    });
    const go = await room.waitFor<any>('go', opts.queueTimeoutMs ?? 180_000);
    const token = go && typeof go === 'object' ? (go.token ?? go.admitToken) : go;
    if (!token) throw new MatchmakeError('pacote "go" sem token de admissão');
    return String(token);
  } finally {
    room.close();
  }
}

/** Uma tentativa de join na hunt (sem retry, sem fila). */
export async function openHuntOnce(opts: HuntJoinOptions, admitToken?: string): Promise<Room> {
  return openRoom(opts, 'hunt', huntBody(opts, admitToken ?? opts.admitToken));
}

export interface ConnectResult {
  room: Room;
  viaQueue: boolean;
  attempts: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Conecta na hunt com o mesmo fallback do jogo: tenta direto, cai para a fila
 * quando o servidor exige, e re-tenta com backoff nos erros transitórios.
 * Erros de IP/manutenção/token inválido são propagados (não adianta insistir).
 */
export async function connectHunt(opts: HuntJoinOptions, maxAttempts = 6): Promise<ConnectResult> {
  let admitToken = opts.admitToken;
  let viaQueue = false;
  let unknownStreak = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const room = await openHuntOnce(opts, admitToken);
      if (viaQueue) opts.log(`[term] entrou na hunt com admitToken (tentativa ${attempt})`);
      return { room, viaQueue, attempts: attempt };
    } catch (err: any) {
      const failure = classifyJoinError(err);
      const detail = `${err?.message || err}${err?.code ? ` (code=${err.code})` : ''}`;
      opts.log(`[term] join da hunt falhou [${failure}] tentativa ${attempt}/${maxAttempts}: ${detail}`);

      if (failure === 'unknown') unknownStreak++;
      else unknownStreak = 0;

      if (failure === 'auth' || failure === 'ip' || failure === 'maintenance') throw err;

      if (failure === 'boss') {
        await sleep(10_000);
        continue;
      }

      if (failure === 'seat') {
        opts.log('[term] seat expirou no servidor — refazendo o join');
        await sleep(1_500);
        continue;
      }

      // 'queue' explícito, ou dois erros desconhecidos seguidos (texto do servidor
      // pode ter mudado): tenta o caminho da fila uma vez.
      if (failure === 'queue' || (failure === 'unknown' && unknownStreak === 2)) {
        opts.log(`[term] entrando na fila por admitToken (${failure})`);
        admitToken = undefined;
        try {
          admitToken = await waitAdmitToken(opts);
          viaQueue = true;
          unknownStreak = 0;
          continue;
        } catch (qerr: any) {
          opts.log(`[term] fila falhou: ${qerr?.message || qerr}`);
          await sleep(5_000);
          continue;
        }
      }

      if (err instanceof RoomError) throw err;
      await sleep(Math.min(2_500 * attempt, 15_000));
    }
  }

  throw new MatchmakeError(`não foi possível entrar na hunt após ${maxAttempts} tentativas`);
}