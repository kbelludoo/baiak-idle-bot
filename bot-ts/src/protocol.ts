export interface WsFrameInfo {
  opcode: number;
  payloadData: string;
}

export interface DecodedFrame {
  opcode: number;
  type?: unknown;
  payload?: unknown;
}

class MsgpackDecoder {
  private pos = 0;
  constructor(private readonly b: Uint8Array) {}
  get offset() { return this.pos; }
  private need(n: number) { if (this.pos + n > this.b.length) throw new RangeError('msgpack_eof'); }
  private u8() { this.need(1); return this.b[this.pos++]; }
  private i8() { const x = this.u8(); return x > 127 ? x - 256 : x; }
  private u16() { this.need(2); const v = (this.b[this.pos] << 8) | this.b[this.pos + 1]; this.pos += 2; return v; }
  private i16() { const v = this.u16(); return v & 0x8000 ? v - 0x10000 : v; }
  private u32() { this.need(4); const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 4).getUint32(0, false); this.pos += 4; return v; }
  private i32() { this.need(4); const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 4).getInt32(0, false); this.pos += 4; return v; }
  private u64() { this.need(8); const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 8).getBigUint64(0, false); this.pos += 8; return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString(); }
  private i64() { this.need(8); const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 8).getBigInt64(0, false); this.pos += 8; const max = BigInt(Number.MAX_SAFE_INTEGER), min = BigInt(Number.MIN_SAFE_INTEGER); return v <= max && v >= min ? Number(v) : v.toString(); }
  private f32() { this.need(4); const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 4).getFloat32(0, false); this.pos += 4; return v; }
  private f64() { this.need(8); const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 8).getFloat64(0, false); this.pos += 8; return v; }
  private bytes(n: number) { this.need(n); const s = this.b.subarray(this.pos, this.pos + n); this.pos += n; return s; }
  private str(n: number) { return new TextDecoder().decode(this.bytes(n)); }

  read(): unknown {
    const x = this.u8();
    if (x < 0x80) return x;
    if (x <= 0x8f) { const out: Record<string, unknown> = {}; for (let i = 0; i < (x & 0x0f); i++) out[String(this.read())] = this.read(); return out; }
    if (x <= 0x9f) return Array.from({ length: x & 0x0f }, () => this.read());
    if (x <= 0xbf) return this.str(x & 0x1f);
    if (x >= 0xe0) return x - 256;
    switch (x) {
      case 0xc0: return null; case 0xc2: return false; case 0xc3: return true;
      case 0xc4: return this.bytes(this.u8()); case 0xc5: return this.bytes(this.u16()); case 0xc6: return this.bytes(this.u32());
      case 0xca: return this.f32(); case 0xcb: return this.f64(); case 0xcc: return this.u8(); case 0xcd: return this.u16(); case 0xce: return this.u32(); case 0xcf: return this.u64();
      case 0xd0: return this.i8(); case 0xd1: return this.i16(); case 0xd2: return this.i32(); case 0xd3: return this.i64();
      case 0xd9: return this.str(this.u8()); case 0xda: return this.str(this.u16()); case 0xdb: return this.str(this.u32());
      case 0xdc: return Array.from({ length: this.u16() }, () => this.read()); case 0xdd: return Array.from({ length: this.u32() }, () => this.read());
      case 0xde: { const out: Record<string, unknown> = {}; const n = this.u16(); for (let i = 0; i < n; i++) out[String(this.read())] = this.read(); return out; }
      case 0xdf: { const out: Record<string, unknown> = {}; const n = this.u32(); for (let i = 0; i < n; i++) out[String(this.read())] = this.read(); return out; }
      case 0xc7: { const n = this.u8(); this.u8(); this.bytes(n); return { __ext: n }; }
      case 0xc8: { const n = this.u16(); this.u8(); this.bytes(n); return { __ext: n }; }
      case 0xc9: { const n = this.u32(); this.u8(); this.bytes(n); return { __ext: n }; }
      case 0xd4: this.u8(); this.bytes(1); return { __ext: 1 }; case 0xd5: this.u8(); this.bytes(2); return { __ext: 2 }; case 0xd6: this.u8(); this.bytes(4); return { __ext: 4 }; case 0xd7: this.u8(); this.bytes(8); return { __ext: 8 }; case 0xd8: this.u8(); this.bytes(16); return { __ext: 16 };
      default: throw new Error(`msgpack_unsupported_0x${x.toString(16)}`);
    }
  }
}

export function decodeBaiakFrame(frame: WsFrameInfo): DecodedFrame | null {
  try {
    if (frame.opcode === 1) return { opcode: 1, type: 'text', payload: frame.payloadData };
    if (frame.opcode !== 2) return { opcode: frame.opcode };
    const bytes = Uint8Array.from(Buffer.from(frame.payloadData, 'base64'));
    if (!bytes.length) return null;
    const op = bytes[0];
    if (op !== 0x0d) return { opcode: op };
    const dec = new MsgpackDecoder(bytes.subarray(1));
    const type = dec.read();
    const payload = dec.offset < bytes.length - 1 ? dec.read() : null;
    return { opcode: op, type, payload };
  } catch { return null; }
}

export function digLevel(value: unknown, depth = 0): number | null {
  if (depth > 3 || value == null || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  for (const key of ['level', 'lvl']) { const v = obj[key]; const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN; if (Number.isFinite(n) && n >= 1 && n <= 3000) return Math.trunc(n); }
  for (const key of ['player', 'account', 'me', 'leader', 'char']) { const got = digLevel(obj[key], depth + 1); if (got) return got; }
  for (const key of ['players', 'lastPlayers', 'party', 'chars']) { const arr = obj[key]; if (!Array.isArray(arr)) continue; for (const item of arr) { const got = digLevel(item, depth + 1); if (got) return got; } }
  return null;
}
