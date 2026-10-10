/**
 * Cliente Colyseus 0.16 headless (usado pelo driver terminal).
 *
 * Wire format conferido no bundle do jogo (colyseus.js 0.16.22):
 *  - matchmake: POST {origin}/rt/matchmake/{joinOrCreate|create|join|joinById|reconnect}/{sala}
 *    body JSON -> {room:{roomId,processId,name},sessionId,reconnectionToken}
 *  - socket:   wss://{host}/rt/{processId}/{roomId}?sessionId=...
 *  - handshake: o SERVIDOR manda primeiro ROOM/JOIN_ROOM (10) com
 *    [reconnectionToken, serializerId]; o cliente responde com o byte cru 0x0A.
 *  - dados:    ROOM_DATA (13) = [type, payload] em msgpack; 14/15 são estado
 *    binário de @colyseus/schema (contamos, não decodificamos — igual ao kernel).
 */

import { MsgpackReader, decodeFrame, encodeRoomData } from '../protocol';
import { TERM_UA } from './fingerprint';

export const OP_JOIN_ROOM = 10;
export const OP_ERROR = 11;
export const OP_LEAVE_ROOM = 12;
export const OP_ROOM_DATA = 13;
export const OP_ROOM_STATE = 14;
export const OP_ROOM_STATE_PATCH = 15;
export const OP_ROOM_DATA_SCHEMA = 16;

export type MatchmakeMethod = 'joinOrCreate' | 'create' | 'join' | 'joinById' | 'reconnect';

export interface Endpoint {
  http: string;
  ws: string;
  origin: string;
}

/** `https://baiakidle.com` -> http/wss em `/rt` (mesmo path do bundle). */
export function endpointFromOrigin(origin = 'https://baiakidle.com'): Endpoint {
  const u = new URL(origin);
  const secure = u.protocol === 'https:' || u.protocol === 'wss:';
  const host = `${u.protocol}//${u.host}`;
  const prefix = u.pathname.replace(/\/+$/, '');
  return {
    http: `${host}${prefix}/rt`,
    ws: `${secure ? 'wss' : 'ws'}://${u.host}${prefix}/rt`,
    origin: u.origin,
  };
}

export interface Seat {
  roomName: string;
  roomId: string;
  processId: string;
  sessionId?: string;
  reconnectionToken?: string;
  /** Host+path do processo que detém a reserva da sala (ex.: "rt3.baiakidle.com/rt3-59"). */
  publicAddress?: string;
}

export class MatchmakeError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'MatchmakeError';
    this.code = code;
  }
}

export class RoomError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

export interface MatchmakeOptions {
  endpoint: Endpoint;
  userAgent?: string;
  timeoutMs?: number;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; json: any; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function matchmake(
  method: MatchmakeMethod,
  roomName: string,
  body: Record<string, any>,
  opts: MatchmakeOptions,
): Promise<Seat> {
  const url = `${opts.endpoint.http}/matchmake/${method}/${encodeURIComponent(roomName)}`;
  const { status, json, text } = await fetchJson(
    url,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': opts.userAgent || TERM_UA,
        origin: opts.endpoint.origin,
      },
      body: JSON.stringify(body ?? {}),
    },
    opts.timeoutMs ?? 12_000,
  );

  if (json?.error) throw new MatchmakeError(String(json.error), Number(json.code ?? status));
  if (status < 200 || status >= 300) {
    throw new MatchmakeError(`matchmake ${method}/${roomName} HTTP ${status}: ${text.slice(0, 200)}`, status);
  }
  const room = json?.room;
  if (!room?.roomId) throw new MatchmakeError(`matchmake sem roomId: ${text.slice(0, 200)}`);
  return {
    roomName: String(room.name || roomName),
    roomId: String(room.roomId),
    processId: String(room.processId ?? ''),
    sessionId: json.sessionId ? String(json.sessionId) : undefined,
    reconnectionToken: json.reconnectionToken ? String(json.reconnectionToken) : undefined,
    publicAddress: room.publicAddress ? String(room.publicAddress) : undefined,
  };
}

export interface RoomStats {
  framesIn: number;
  roomData: number;
  roomState: number;
  out: number;
  errors: number;
}

export interface RoomOptions {
  seat: Seat;
  endpoint: Endpoint;
  userAgent?: string;
  log?: (msg: string) => void;
  connectTimeoutMs?: number;
}

type Handler = (payload: any) => void;

/**
 * JOIN_ROOM não usa msgpack: o SDK lê `utf8Read(p, state, p[state.offset++])`,
 * ou seja [len:u8][bytes] em UTF-8 cru (é o formato do @colyseus/binary).
 */
function readRawString(bytes: Uint8Array, offset: number): { value: string; offset: number } {
  const len = bytes[offset] ?? 0;
  const start = offset + 1;
  const value = new TextDecoder().decode(bytes.subarray(start, start + len));
  return { value, offset: start + len };
}

export class Room {
  readonly roomId: string;
  readonly roomName: string;
  readonly seat: Seat;
  readonly stats: RoomStats = { framesIn: 0, roomData: 0, roomState: 0, out: 0, errors: 0 };

  reconnectionToken?: string;
  serializerId?: string;
  joined = false;
  closed = false;
  joinedAt = 0;
  lastFrameAt = 0;

  private ws: WebSocket | null = null;
  private readonly endpoint: Endpoint;
  private readonly userAgent: string;
  private readonly log: (msg: string) => void;
  private readonly handlers = new Map<string, Handler[]>();
  private joinWaiters: Array<{ resolve: () => void; reject: (err: any) => void }> = [];

  constructor(seat: Seat, endpoint: Endpoint, userAgent = TERM_UA, log: (m: string) => void = () => {}) {
    this.seat = seat;
    this.roomId = seat.roomId;
    this.roomName = seat.roomName;
    this.endpoint = endpoint;
    this.userAgent = userAgent;
    this.log = log;
    this.reconnectionToken = seat.reconnectionToken;
  }

  static async open(opts: RoomOptions): Promise<Room> {
    const room = new Room(opts.seat, opts.endpoint, opts.userAgent, opts.log);
    await room.connect(opts.connectTimeoutMs ?? 12_000);
    return room;
  }

  /** Reabre o MESMO roomId usando o reconnectionToken (evita fila nova). */
  static async reconnect(room: Room, opts: { timeoutMs?: number } = {}): Promise<Room> {
    const full = room.reconnectionToken;
    if (!full) throw new MatchmakeError('sem reconnectionToken para reconectar');
    // O SDK faz `const [roomId, token] = reconnectionToken.split(':')` e envia
    // POST /matchmake/reconnect/{roomId} com { reconnectionToken: token }.
    const sep = full.indexOf(':');
    const roomId = sep > 0 ? full.slice(0, sep) : room.roomId;
    const token = sep > 0 ? full.slice(sep + 1) : full;
    const seat = await matchmake('reconnect', roomId, { reconnectionToken: token }, {
      endpoint: room.endpoint,
      userAgent: room.userAgent,
      timeoutMs: opts.timeoutMs ?? 12_000,
    });
    return Room.open({ seat, endpoint: room.endpoint, userAgent: room.userAgent, log: room.log });
  }

/**
 * URL do socket. O SDK prefere `room.publicAddress` quando o matchmake devolve
 * (`wss://rt3.baiakidle.com/rt3-59/{processId}/{roomId}?sessionId=...`): a
 * reserva da sala vive naquele processo. Conectar pelo host do matchmake até
 * funciona no TCP, mas o servidor responde "seat reservation expired".
 */
private wsUrl(): string {
  const base = this.seat.publicAddress
    ? `wss://${this.seat.publicAddress}`
    : `${this.endpoint.ws}`;
  const params = this.seat.sessionId ? `?sessionId=${encodeURIComponent(this.seat.sessionId)}` : '';
  return `${base}/${this.seat.processId}/${this.seat.roomId}${params}`;
}

  private connect(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve();
      };
      const timer = setTimeout(() => {
        this.log(`[term] handshake não chegou em ${timeoutMs}ms (room ${this.roomId})`);
        try { this.ws?.close(); } catch (_) {}
        done(new MatchmakeError(`handshake timeout após ${timeoutMs}ms`, 4000));
      }, timeoutMs);

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.wsUrl());
      } catch (err: any) {
        done(new MatchmakeError(`WebSocket falhou: ${err?.message || err}`));
        return;
      }
      this.ws = ws;
      try { ws.binaryType = 'arraybuffer'; } catch (_) {}

      ws.addEventListener('open', () => this.log(`[term] socket aberto -> ${this.wsUrl()}`));
      ws.addEventListener('message', (ev: any) => this.onMessage(ev));
      ws.addEventListener('error', () => {
        if (!this.joined) {
          this.log('[term] socket recusado antes do handshake — pode ser Cloudflare/anti-bot, IP bloqueado ou token inválido');
        } else {
          this.log('[term] erro de socket');
        }
        done(new MatchmakeError('websocket error'));
        this.emit('__error', new RoomError('websocket error'));
      });
      ws.addEventListener('close', (ev: any) => {
        this.closed = true;
        const err = new RoomError(`socket fechado (code=${ev?.code})`);
        this.emit('__leave', { code: ev?.code });
        done(err);
      });

      this.joinWaiters.push({ resolve: () => done(), reject: (err) => done(err) });
    });
  }

  private onMessage(ev: any): void {
    const data = ev?.data;
    if (typeof data === 'string') return;
    if (data instanceof ArrayBuffer) {
      this.handleBytes(new Uint8Array(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      this.handleBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return;
    }
    if (data && typeof data.arrayBuffer === 'function') {
      data.arrayBuffer().then((b: ArrayBuffer) => this.handleBytes(new Uint8Array(b))).catch(() => {});
    }
  }

  private handleBytes(bytes: Uint8Array): void {
    if (!bytes.length) return;
    this.stats.framesIn++;
    this.lastFrameAt = Date.now();
    const opcode = bytes[0];

    if (opcode === OP_JOIN_ROOM) {
      const token = readRawString(bytes, 1);
      const serializer = readRawString(bytes, token.offset);
      this.reconnectionToken = `${this.roomId}:${token.value}`;
      this.serializerId = serializer.value;
      this.joined = true;
      this.joinedAt = Date.now();
      this.log(`[term] handshake ok (serializer=${this.serializerId || '?'}, room=${this.roomId})`);
      try { this.ws?.send(Uint8Array.of(OP_JOIN_ROOM)); } catch (_) {}
      const waiters = this.joinWaiters.splice(0, this.joinWaiters.length);
      for (const w of waiters) w.resolve();
      this.emit('__join', { reconnectionToken: this.reconnectionToken, serializerId: this.serializerId });
      return;
    }

    if (opcode === OP_ERROR) {
      const reader = new MsgpackReader(bytes.subarray(1));
      const code = Number(reader.read() ?? 0);
      const message = String(reader.read() ?? 'erro da sala');
      this.stats.errors++;
      const err = new RoomError(message, code);
      this.log(`[term] erro da sala: ${message} (code=${code})`);
      this.emit('__error', err);
      return;
    }

    if (opcode === OP_LEAVE_ROOM) {
      this.emit('__leave', { code: 12 });
      this.close();
      return;
    }

    if (opcode === OP_ROOM_DATA) {
      this.stats.roomData++;
      const frame = decodeFrame(bytes);
      if (frame && frame.type !== undefined) this.emit(String(frame.type), frame.payload);
      this.emit('__data', frame);
      return;
    }

    if (opcode === OP_ROOM_STATE || opcode === OP_ROOM_STATE_PATCH || opcode === OP_ROOM_DATA_SCHEMA) {
      this.stats.roomState++;
      this.emit('__state', { opcode, bytes: bytes.length });
      // Bytes crus do schema: permite inspecionar o estado do jogador (itens,
      // party, bag) sem depender do decodificador do @colyseus/schema.
      this.emit('__stateRaw', { opcode, bytes });
      return;
    }
  }

  on(type: string, handler: Handler): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return () => {
      const cur = this.handlers.get(type) ?? [];
      const idx = cur.indexOf(handler);
      if (idx >= 0) cur.splice(idx, 1);
    };
  }

  once(type: string, handler: Handler): () => void {
    const off = this.on(type, (payload: any) => {
      off();
      handler(payload);
    });
    return off;
  }

  private emit(type: string, payload: any): void {
    const list = this.handlers.get(type);
    if (!list || list.length === 0) return;
    for (const handler of list.slice()) {
      try { handler(payload); } catch (err: any) {
        this.log(`[term] handler ${type} falhou: ${err?.message || err}`);
      }
    }
  }

  /** Espera o primeiro payload do tipo. Lança em timeout/erro/leave. */
  waitFor<T = any>(type: string, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new MatchmakeError(`timeout esperando "${type}" (${timeoutMs}ms)`, 4001));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        offError();
        offLeave();
        off();
      };

      const off = this.once(type, (payload: any) => {
        cleanup();
        resolve(payload as T);
      });
      const offError = this.once('__error', (err: any) => {
        cleanup();
        reject(err);
      });
      const offLeave = this.once('__leave', () => {
        cleanup();
        reject(new MatchmakeError(`sala fechou antes de "${type}"`, 4002));
      });
      if (this.closed) {
        cleanup();
        reject(new MatchmakeError(`sala já fechada antes de "${type}"`, 4002));
      }
    });
  }

  send(type: string, payload?: any): boolean {
    if (!this.ws || this.closed) return false;
    try {
      this.ws.send(encodeRoomData(type, payload === undefined ? {} : payload));
      this.stats.out++;
      return true;
    } catch (err: any) {
      this.log(`[term] send ${type} falhou: ${err?.message || err}`);
      return false;
    }
  }

  close(): void {
    this.closed = true;
    try { this.ws?.close(); } catch (_) {}
    this.ws = null;
  }

  uptimeSec(): number {
    return this.joinedAt ? Math.floor((Date.now() - this.joinedAt) / 1000) : 0;
  }
}