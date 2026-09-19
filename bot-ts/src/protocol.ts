/**
 * Decodificador de frames Colyseus / MessagePack para o protocolo de WebSocket do Baiak Idle.
 * Suporta opcode 0x0D (ROOM_DATA) e desempacota [type, payload] em estruturas nativas JS.
 */

export interface DecodedFrame {
  opcode: number;
  /** Nome do frame Colyseus: ROOM_DATA / ROOM_STATE / ROOM_STATE_PATCH / ... */
  frame?: string;
  type?: string;
  payload?: any;
}

/** Opcodes Colyseus usados pelo jogo (paridade com baiak-mitm.user.js). */
export const COLYSEUS_OPCODE: Record<number, string> = {
  9: 'HANDSHAKE',
  10: 'JOIN_ROOM',
  11: 'ERROR',
  12: 'LEAVE_ROOM',
  13: 'ROOM_DATA',
  14: 'ROOM_STATE',
  15: 'ROOM_STATE_PATCH',
  16: 'ROOM_DATA_SCHEMA',
  17: 'ROOM_DATA_BYTES',
  18: 'PING',
  19: 'PONG',
};

/** Nível máximo real do jogo (tabela vai a 800). */
export const MAX_GAME_LEVEL = 800;

class MsgpackReader {
  private view: DataView;
  private bytes: Uint8Array;
  private offset: number = 0;
  private textDecoder = new TextDecoder('utf-8');

  constructor(buffer: Uint8Array) {
    this.bytes = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  public get hasMore(): boolean {
    return this.offset < this.bytes.length;
  }

  public read(): any {
    if (this.offset >= this.bytes.length) return undefined;
    const byte = this.bytes[this.offset++];

    // Positive fixint (0x00 - 0x7f)
    if (byte <= 0x7f) return byte;

    // Fixmap (0x80 - 0x8f)
    if (byte >= 0x80 && byte <= 0x8f) {
      const size = byte & 0x0f;
      const map: Record<string, any> = {};
      for (let i = 0; i < size; i++) {
        const key = String(this.read());
        const val = this.read();
        map[key] = val;
      }
      return map;
    }

    // Fixarray (0x90 - 0x9f)
    if (byte >= 0x90 && byte <= 0x9f) {
      const size = byte & 0x0f;
      const arr = new Array(size);
      for (let i = 0; i < size; i++) {
        arr[i] = this.read();
      }
      return arr;
    }

    // Fixstr (0xa0 - 0xbf)
    if (byte >= 0xa0 && byte <= 0xbf) {
      const len = byte & 0x1f;
      return this.readString(len);
    }

    // Nil (0xc0)
    if (byte === 0xc0) return null;

    // Booleans
    if (byte === 0xc2) return false;
    if (byte === 0xc3) return true;

    // Bin 8, 16, 32
    if (byte === 0xc4) {
      const len = this.readUint8();
      return this.readBytes(len);
    }
    if (byte === 0xc5) {
      const len = this.readUint16();
      return this.readBytes(len);
    }
    if (byte === 0xc6) {
      const len = this.readUint32();
      return this.readBytes(len);
    }

    // Ext 8, 16, 32
    if (byte === 0xc7) {
      const len = this.readUint8();
      this.offset += len + 1;
      return { __ext: len };
    }
    if (byte === 0xc8) {
      const len = this.readUint16();
      this.offset += len + 1;
      return { __ext: len };
    }
    if (byte === 0xc9) {
      const len = this.readUint32();
      this.offset += len + 1;
      return { __ext: len };
    }

    // Floats
    if (byte === 0xca) {
      const v = this.view.getFloat32(this.offset, false);
      this.offset += 4;
      return v;
    }
    if (byte === 0xcb) {
      const v = this.view.getFloat64(this.offset, false);
      this.offset += 8;
      return v;
    }

    // Unsigned ints
    if (byte === 0xcc) return this.readUint8();
    if (byte === 0xcd) return this.readUint16();
    if (byte === 0xce) return this.readUint32();
    if (byte === 0xcf) {
      const v = this.view.getBigUint64(this.offset, false);
      this.offset += 8;
      return Number(v);
    }

    // Signed ints
    if (byte === 0xd0) {
      const v = this.view.getInt8(this.offset);
      this.offset += 1;
      return v;
    }
    if (byte === 0xd1) {
      const v = this.view.getInt16(this.offset, false);
      this.offset += 2;
      return v;
    }
    if (byte === 0xd2) {
      const v = this.view.getInt32(this.offset, false);
      this.offset += 4;
      return v;
    }
    if (byte === 0xd3) {
      const v = this.view.getBigInt64(this.offset, false);
      this.offset += 8;
      return Number(v);
    }

    // Fixext 1, 2, 4, 8, 16
    if (byte >= 0xd4 && byte <= 0xd8) {
      const len = 1 << (byte - 0xd4);
      this.offset += len + 1;
      return { __ext: len };
    }

    // Str 8, 16, 32
    if (byte === 0xd9) {
      const len = this.readUint8();
      return this.readString(len);
    }
    if (byte === 0xda) {
      const len = this.readUint16();
      return this.readString(len);
    }
    if (byte === 0xdb) {
      const len = this.readUint32();
      return this.readString(len);
    }

    // Array 16, 32
    if (byte === 0xdc) {
      const size = this.readUint16();
      const arr = new Array(size);
      for (let i = 0; i < size; i++) arr[i] = this.read();
      return arr;
    }
    if (byte === 0xdd) {
      const size = this.readUint32();
      const arr = new Array(size);
      for (let i = 0; i < size; i++) arr[i] = this.read();
      return arr;
    }

    // Map 16, 32
    if (byte === 0xde) {
      const size = this.readUint16();
      const map: Record<string, any> = {};
      for (let i = 0; i < size; i++) {
        const k = String(this.read());
        const v = this.read();
        map[k] = v;
      }
      return map;
    }
    if (byte === 0xdf) {
      const size = this.readUint32();
      const map: Record<string, any> = {};
      for (let i = 0; i < size; i++) {
        const k = String(this.read());
        const v = this.read();
        map[k] = v;
      }
      return map;
    }

    // Negative fixint (0xe0 - 0xff)
    if (byte >= 0xe0) {
      return byte - 256;
    }

    return null;
  }

  private readUint8(): number {
    return this.bytes[this.offset++];
  }

  private readUint16(): number {
    const v = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return v;
  }

  private readUint32(): number {
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }

  private readString(len: number): string {
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return this.textDecoder.decode(slice);
  }

  private readBytes(len: number): Uint8Array {
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }
}

/**
 * Decodifica frame bruto recebido pelo WebSocket.
 * - 0x0D (13) ROOM_DATA -> [type, payload] msgpack (eventos).
 * - 0x0E (14) ROOM_STATE / 0x0F (15) PATCH -> estado autoritativo binário
 *   (@colyseus/schema). Sem o .schema da build não dá para decodificar os
 *   campos, mas o frame NUNCA pode ser descartado: ele prova que a sala está
 *   viva e carrega HP/players/huntId/wave/dead/lootGold. Retornamos
 *   {opcode, frame} para o watchdog/telemetria em vez de null.
 */
export function decodeFrame(raw: Uint8Array | Buffer): DecodedFrame | null {
  if (!raw || raw.length === 0) return null;
  const opcode = raw[0];
  const frame = COLYSEUS_OPCODE[opcode];

  // Opcode 0x0D (13) = ROOM_DATA no Colyseus
  if (opcode !== 0x0d) {
    return { opcode, frame };
  }

  try {
    const reader = new MsgpackReader(raw.subarray(1));
    const type = reader.read();
    const payload = reader.hasMore ? reader.read() : undefined;
    return { opcode, frame: 'ROOM_DATA', type, payload };
  } catch (err) {
    return { opcode, frame: 'ROOM_DATA', type: 'unknown' };
  }
}

/**
 * Codifica um frame ROOM_DATA (0x0D) [type, payload] para envio direto à sala.
 * Mesmo codec do cliente real (msgpack) — paridade com baiak-mitm.user.js
 * `buildDataFrame`. Usado pelo `roomSend()` via `window.__baiak_send` no page:
 * um `room.send("stage",{huntId})` vira exatamente 1 pacote, sem DOM.
 */
export function encodeRoomData(type: string, payload?: any): Uint8Array {
  const out: number[] = [0x0d];
  encodeMsgpackValue(type, out);
  encodeMsgpackValue(payload === undefined ? null : payload, out);
  return Uint8Array.from(out);
}

function encodeMsgpackValue(v: any, out: number[]): void {
  if (v === null || v === undefined) { out.push(0xc0); return; }
  if (v === true) { out.push(0xc3); return; }
  if (v === false) { out.push(0xc2); return; }
  if (typeof v === 'number') {
    if (Number.isInteger(v)) {
      if (v >= 0) {
        if (v < 128) { out.push(v); return; }
        if (v < 256) { out.push(0xcc, v); return; }
        if (v < 65536) { out.push(0xcd, (v >>> 8) & 255, v & 255); return; }
        if (v < 4294967296) { out.push(0xce, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return; }
        const hi = Math.floor(v / 4294967296), lo = v % 4294967296;
        out.push(0xcf, (hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
          (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
        return;
      }
      if (v >= -32) { out.push(256 + v); return; }
      if (v >= -128) { out.push(0xd0, v & 255); return; }
      if (v >= -32768) { out.push(0xd1, (v >> 8) & 255, v & 255); return; }
      if (v >= -2147483648) { out.push(0xd2, (v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255); return; }
      const hi = Math.floor(v / 4294967296), lo = ((v % 4294967296) + 4294967296) % 4294967296;
      out.push(0xd3, (hi >> 24) & 255, (hi >> 16) & 255, (hi >> 8) & 255, hi & 255,
        (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
      return;
    }
    out.push(0xcb);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v, false);
    for (const b of new Uint8Array(buf)) out.push(b);
    return;
  }
  if (typeof v === 'string') {
    const bytes = new TextEncoder().encode(v);
    const l = bytes.length;
    if (l < 32) out.push(0xa0 | l);
    else if (l < 256) out.push(0xd9, l);
    else if (l < 65536) out.push(0xda, (l >> 8) & 255, l & 255);
    else out.push(0xdb, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255);
    for (const b of bytes) out.push(b);
    return;
  }
  if (Array.isArray(v)) {
    const n = v.length;
    if (n < 16) out.push(0x90 | n);
    else if (n < 65536) out.push(0xdc, (n >> 8) & 255, n & 255);
    else out.push(0xdd, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    for (const item of v) encodeMsgpackValue(item, out);
    return;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v);
    const n = entries.length;
    if (n < 16) out.push(0x80 | n);
    else if (n < 65536) out.push(0xde, (n >> 8) & 255, n & 255);
    else out.push(0xdf, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    for (const [k, val] of entries) { encodeMsgpackValue(String(k), out); encodeMsgpackValue(val, out); }
    return;
  }
  out.push(0xc0);
}

/**
 * Varre recursivamente o payload em busca de campos de nível.
 */
export function digLevel(pay: any, depth: number = 0): number | null {
  if (depth > 3 || !pay || typeof pay !== 'object') return null;

  if (typeof pay.level === 'number' && pay.level >= 1 && pay.level <= 3000) return pay.level;
  if (typeof pay.lvl === 'number' && pay.lvl >= 1 && pay.lvl <= 3000) return pay.lvl;
  if (typeof pay.level === 'string' && /^\d+$/.test(pay.level)) {
    const n = parseInt(pay.level, 10);
    if (n >= 1 && n <= 3000) return n;
  }

  for (const nest of ['player', 'account', 'me', 'leader', 'char']) {
    if (pay[nest]) {
      const got = digLevel(pay[nest], depth + 1);
      if (got) return got;
    }
  }

  for (const key of ['players', 'lastPlayers', 'party', 'chars']) {
    const seq = pay[key];
    if (Array.isArray(seq)) {
      const lvls = seq
        .filter((p) => p && typeof p === 'object' && typeof p.level === 'number')
        .map((p) => p.level);
      if (lvls.length > 0) return Math.max(...lvls);
    }
  }

  return null;
}
