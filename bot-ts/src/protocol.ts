/**
 * Decodificador de frames Colyseus / MessagePack para o protocolo de WebSocket do Baiak Idle.
 * Suporta opcode 0x0D (ROOM_DATA) e desempacota [type, payload] em estruturas nativas JS.
 */

export interface DecodedFrame {
  opcode: number;
  type?: string;
  payload?: any;
}

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
 */
export function decodeFrame(raw: Uint8Array | Buffer): DecodedFrame | null {
  if (!raw || raw.length === 0) return null;
  const opcode = raw[0];

  // Opcode 0x0D (13) = ROOM_DATA no Colyseus
  if (opcode !== 0x0d) {
    return { opcode };
  }

  try {
    const reader = new MsgpackReader(raw.subarray(1));
    const type = reader.read();
    const payload = reader.hasMore ? reader.read() : undefined;
    return { opcode, type, payload };
  } catch (err) {
    return { opcode, type: 'unknown' };
  }
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
