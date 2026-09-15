// ==UserScript==
// @name         Baiak Idle — MITM Tamper
// @namespace    local
// @version      1.0.4
// @description  Intercepta o protocolo Colyseus (WebSocket) e o tRPC do Baiak Idle, decodifica os frames e tenta alterar valores reais (não-cosméticos).
// @match        https://baiakidle.com/*
// @match        https://*.baiakidle.com/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// ==/UserScript==

(function () {
  'use strict';

  /* ==========================================================================
   *  API global: window.__baiakHack
   *
   *  __baiakHack.out('buycart', (payload, meta) => { payload.items[0].q = 1; })
   *  __baiakHack.in('mine',      (payload, meta) => { payload.gold = 999999999; })
   *  __baiakHack.out('imbue',    (payload, meta) => { payload.tier = 5; })
   *  __baiakHack.trpcOut(/auction\.bid/, (batch) => { ... })
   *  __baiakHack.trpcIn(/coin\.balances/, (batch) => { ... })
   *  __baiakHack.cfg.in.mineGold.value = 1_000_000
   *  __baiakHack.reconnect()
   * ======================================================================== */

  const PROTO = {
    HANDSHAKE: 9, JOIN_ROOM: 10, ERROR: 11, LEAVE_ROOM: 12,
    ROOM_DATA: 13, ROOM_STATE: 14, ROOM_STATE_PATCH: 15,
    ROOM_DATA_SCHEMA: 16, ROOM_DATA_BYTES: 17, PING: 18, PONG: 19,
  };

  /* --------------------------------------------------------------------------
   *  MessagePack (RFC 8949-subset, classic msgpack) encode/decode
   *  Compatível com o codec `i` (header) e com o msgpackr do payload.
   * ------------------------------------------------------------------------ */
  const u8 = new TextEncoder();
  const tdec = new TextDecoder('utf-8');

  function dv(b0, o0) { return new DataView(b0.buffer, b0.byteOffset + o0); }

  function decodeMsgpack(b, st) {
    const o = st.o;
    if (o >= b.length) throw new Error('msgpack eof');
    const x = b[o];
    st.o = o + 1;
    if (x < 0x80) return x;                                   // positive fixint
    if (x <= 0x8f) {                                          // fixmap
      const m = {}; const n = x & 0x0f;
      for (let i = 0; i < n; i++) { const k = decodeMsgpack(b, st); m[k] = decodeMsgpack(b, st); }
      return m;
    }
    if (x <= 0x9f) {                                          // fixarray
      const a = new Array(x & 0x0f);
      for (let i = 0; i < a.length; i++) a[i] = decodeMsgpack(b, st);
      return a;
    }
    if (x <= 0xbf) {                                          // fixstr
      const l = x & 0x1f; const s = b.subarray(st.o, st.o + l); st.o += l; return tdec.decode(s);
    }
    if (x === 0xc0) return null;
    if (x === 0xc2) return false;
    if (x === 0xc3) return true;
    if (x === 0xc4 || x === 0xc5 || x === 0xc6) {             // bin8/16/32 → round-trip preservado
      let l;
      if (x === 0xc4) l = b[st.o++];
      else if (x === 0xc5) { l = (b[st.o] << 8) | b[st.o + 1]; st.o += 2; }
      else { l = dv(b, st.o).getUint32(0); st.o += 4; }
      const s = b.slice(st.o, st.o + l); st.o += l;
      return { __bin: Array.from(s) };
    }
    if (x === 0xc7 || x === 0xc8 || x === 0xc9) {             // ext8/16/32 → round-trip preservado (type byte incluso)
      let l;
      if (x === 0xc7) l = b[st.o++];
      else if (x === 0xc8) { l = (b[st.o] << 8) | b[st.o + 1]; st.o += 2; }
      else { l = dv(b, st.o).getUint32(0); st.o += 4; }
      const t = b[st.o++];
      const s = b.slice(st.o, st.o + l); st.o += l;
      return { __ext: { t, d: Array.from(s) } };
    }
    if (x === 0xca) { const v = dv(b, st.o).getFloat32(0); st.o += 4; return v; }
    if (x === 0xcb) { const v = dv(b, st.o).getFloat64(0); st.o += 8; return v; }
    if (x === 0xcc) return b[st.o++];
    if (x === 0xcd) { const v = (b[st.o] << 8) | b[st.o + 1]; st.o += 2; return v; }
    if (x === 0xce) { const v = dv(b, st.o).getUint32(0); st.o += 4; return v; }
    if (x === 0xcf) { const v = Number(dv(b, st.o).getBigUint64(0)); st.o += 8; return v; }
    if (x === 0xd0) { const v = (b[st.o] << 24) >> 24; st.o += 1; return v; }
    if (x === 0xd1) { const v = dv(b, st.o).getInt16(0); st.o += 2; return v; }
    if (x === 0xd2) { const v = dv(b, st.o).getInt32(0); st.o += 4; return v; }
    if (x === 0xd3) { const v = Number(dv(b, st.o).getBigInt64(0)); st.o += 8; return v; }
    if (x >= 0xd4 && x <= 0xd8) {                             // fixext → round-trip preservado
      const l = 1 << (x - 0xd4);
      const t = b[st.o++];
      const s = b.slice(st.o, st.o + l); st.o += l;
      return { __ext: { t, d: Array.from(s) } };
    }
    if (x === 0xd9) { const l = b[st.o++]; const s = b.subarray(st.o, st.o + l); st.o += l; return tdec.decode(s); }
    if (x === 0xda) { const l = (b[st.o] << 8) | b[st.o + 1]; st.o += 2; const s = b.subarray(st.o, st.o + l); st.o += l; return tdec.decode(s); }
    if (x === 0xdb) { const l = dv(b, st.o).getUint32(0); st.o += 4; const s = b.subarray(st.o, st.o + l); st.o += l; return tdec.decode(s); }
    if (x === 0xdc) { const n = (b[st.o] << 8) | b[st.o + 1]; st.o += 2; const a = new Array(n); for (let i = 0; i < n; i++) a[i] = decodeMsgpack(b, st); return a; }
    if (x === 0xdd) { const n = dv(b, st.o).getUint32(0); st.o += 4; const a = new Array(n); for (let i = 0; i < n; i++) a[i] = decodeMsgpack(b, st); return a; }
    if (x === 0xde) { const n = (b[st.o] << 8) | b[st.o + 1]; st.o += 2; const m = {}; for (let i = 0; i < n; i++) { const k = decodeMsgpack(b, st); m[k] = decodeMsgpack(b, st); } return m; }
    if (x === 0xdf) { const n = dv(b, st.o).getUint32(0); st.o += 4; const m = {}; for (let i = 0; i < n; i++) { const k = decodeMsgpack(b, st); m[k] = decodeMsgpack(b, st); } return m; }
    if (x >= 0xe0) return x - 256;                            // negative fixint
    if (x === 0xc1) throw new Error('msgpack 0xc1 reserved');
    console.warn('[BAIAK MITM] byte desconhecido 0x' + x.toString(16));
    return undefined;
  }

  function encodeMsgpack(v, out) {
    if (v === null || v === undefined) out.push(0xc0);
    else if (v === true) out.push(0xc3);
    else if (v === false) out.push(0xc2);
    else if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        if (v >= 0) {
          if (v < 128) out.push(v);
          else if (v < 256) out.push(0xcc, v);
          else if (v < 65536) out.push(0xcd, v >>> 8, v & 255);
          else if (v < 4294967296) out.push(0xce, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
          else {
            const hi = Math.floor(v / 4294967296), lo = v % 4294967296;
            out.push(0xcf,
              (hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
              (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
          }
        } else {
          if (v >= -32) out.push(256 + v);
          else if (v >= -128) out.push(0xd0, v & 255);
          else if (v >= -32768) out.push(0xd1, (v >> 8) & 255, v & 255);
          else if (v >= -2147483648) out.push(0xd2, (v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
          else {
            const hi = Math.floor(v / 4294967296), lo = v % 4294967296;
            out.push(0xd3,
              (hi >> 24) & 255, (hi >> 16) & 255, (hi >> 8) & 255, hi & 255,
              (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
          }
        }
      } else { // float64
        out.push(0xcb);
        const at = out.length;
        out.length += 8;
        const tmp = new Uint8Array(out); // copy to encode float, then back
        new DataView(tmp.buffer).setFloat64(tmp.byteOffset + at, v);
        for (let i = 0; i < 8; i++) out[at + i] = tmp[at + i];
      }
    }
    else if (typeof v === 'string') {
      const bytes = u8.encode(v);
      const l = bytes.length;
      if (l < 32) { out.push(0xa0 | l); }
      else if (l < 256) { out.push(0xd9, l); }
      else if (l < 65536) { out.push(0xda, (l >> 8) & 255, l & 255); }
      else { out.push(0xdb, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255); }
      for (let i = 0; i < l; i++) out.push(bytes[i]);
    }
    else if (Array.isArray(v)) {
      const n = v.length;
      if (n < 16) out.push(0x90 | n);
      else if (n < 65536) out.push(0xdc, (n >> 8) & 255, n & 255);
      else out.push(0xdd, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      for (let i = 0; i < n; i++) encodeMsgpack(v[i], out);
    }
    else if (v instanceof Uint8Array) {
      const l = v.length;
      if (l < 256) out.push(0xc4, l);
      else if (l < 65536) out.push(0xc5, (l >> 8) & 255, l & 255);
      else out.push(0xc6, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255);
      for (let i = 0; i < l; i++) out.push(v[i]);
    }
    else if (typeof v === 'object' && v !== null && Array.isArray(v.__bin)) {
      const arr = v.__bin; // round-trip de bin8/16/32 decodificado
      const l = arr.length;
      if (l < 256) out.push(0xc4, l);
      else if (l < 65536) out.push(0xc5, (l >> 8) & 255, l & 255);
      else out.push(0xc6, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255);
      for (let i = 0; i < l; i++) out.push(arr[i] & 255);
    }
    else if (typeof v === 'object' && v !== null && v.__ext && Array.isArray(v.__ext.d)) {
      const t = v.__ext.t & 255, arr = v.__ext.d, l = arr.length; // round-trip de ext
      if (l === 1) out.push(0xd4, t);
      else if (l === 2) out.push(0xd5, t);
      else if (l === 4) out.push(0xd6, t);
      else if (l === 8) out.push(0xd7, t);
      else if (l === 16) out.push(0xd8, t);
      else if (l < 256) out.push(0xc7, l, t);
      else if (l < 65536) out.push(0xc8, (l >> 8) & 255, l & 255, t);
      else out.push(0xc9, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255, t);
      for (let i = 0; i < l; i++) out.push(arr[i] & 255);
    }
    else if (typeof v === 'object') {
      const entries = Object.entries(v);
      const n = entries.length;
      if (n < 16) out.push(0x80 | n);
      else if (n < 65536) out.push(0xde, (n >> 8) & 255, n & 255);
      else out.push(0xdf, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      for (const [k, val] of entries) { encodeMsgpack(String(k), out); encodeMsgpack(val, out); }
    } else {
      throw new Error('msgpack: tipo não suportado ' + (typeof v));
    }
  }

  /* --------------------------------------------------------------------------
   *  Frame Colyseus: [protoByte][msgpack(menssageType)][msgpack(payload)]
   * ------------------------------------------------------------------------ */
  function decodeFrame(u8) {
    if (!u8 || !u8.length) return null;
    const frameType = u8[0];
    if (frameType !== PROTO.ROOM_DATA) return { frameType };
    const st = { o: 1 };
    let msgType, payload;
    try { msgType = decodeMsgpack(u8, st); }
    catch (e) { return { frameType, passthrough: true }; }
    try { if (st.o < u8.length) payload = decodeMsgpack(u8, st); }
    catch (e) { return { frameType, msgType, passthrough: true }; }
    const leftover = st.o < u8.length;
    return { frameType, msgType, payload, passthrough: leftover };
  }

  function buildDataFrame(msgType, payload) {
    const out = [0x0d];
    encodeMsgpack(msgType, out);
    encodeMsgpack(payload, out);
    return new Uint8Array(out);
  }

  function toU8(data) {
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return null;
  }

  /* --------------------------------------------------------------------------
   *  Regras de tamper
   * ------------------------------------------------------------------------ */
  const cfg = {
    log: true,
    logTrpc: true,
    trpcTamper: false,
    in: {
      mineGold:       { enabled: true,  value: 1000000 },
      mineCoins:      { enabled: false, value: 100000 },
      mineStamina:    { enabled: false, value: 42 },
      mineVip:        { enabled: false, value: 0 },   // 0 = +1 ano a partir de agora
      mineAccountLv:  { enabled: false, value: 999 },
      minePartySlots: { enabled: false, value: 5 },
      minePreyCards:  { enabled: false, value: 99 },
      mineGems:       { enabled: false, value: 99 },  // gemsUp/gemsAttr
    },
    out: {
      buycartQty:  { enabled: false, value: 1 },
      buycartPrc:  { enabled: false, value: 1 },
      imbueTier:   { enabled: false, value: 5 },
      houseMonths: { enabled: false, value: 120 },
    },
  };

  const customIn = [];   // {type(string|fn), fn(payload, meta)}
  const customOut = [];  // {type(string|fn), fn(payload, meta)}

  const stats = {
    in: 0, out: 0, tamperedIn: 0, tamperedOut: 0, trpc: 0,
    proto: {},           // contagem por tipo de frame
    passthrough: 0,      // frames ROOM_DATA que não decodificaram (payload fora do msgpack padrão)
    text: 0,             // frames de texto (PING/PONG etc)
    short: 0,            // frames que não eram ArrayBuffer
    blob: 0,             // inbound que chegou como Blob e foi convertido
    stateBytes: 0,       // ROOM_STATE / PATCH / DATA_BYTES (estado binário, não ROOM_DATA)
  };
  const samples = new Map(); // type -> {count, full}

  function countProto(ft) { if (ft === undefined) stats.short++; else if (typeof ft === 'string') stats.text++; else stats.proto[ft] = (stats.proto[ft] || 0) + 1; }
  function countPassthrough() { stats.passthrough++; }

  function jsonSafe(v) {
    try { return JSON.stringify(v); } catch (e) { return null; }
  }

  function snapshot(payload) {
    const s = jsonSafe(payload);
    if (s === null) return '__BIN__';
    return s;
  }

  function recordSample(type, payload, dir) {
    if (!cfg.log) return;
    let s = samples.get(type);
    if (!s) { s = { count: 0, full: undefined }; samples.set(type, s); }
    s.count++;
    if (s.full === undefined) {
      s.full = payload;
      s.dir = dir;
      UI.refreshSamples();
    }
  }

  function applyInRules(frame) {
    const type = frame.msgType;
    if (typeof type !== 'string' && typeof type !== 'number') return { changed: false, payload: frame.payload };
    const key = String(type);

    let orig = null;
    for (const r of customIn) {
      const match = typeof r.type === 'function' ? r.type(type, frame.payload) : r.type === type;
      if (match) {
        if (orig === null) orig = snapshot(frame.payload);
        let np;
        try { np = r.fn(frame.payload, { type, dir: 'in' }); } catch (e) { console.warn('[BAIAK MITM] regra in falhou:', e); continue; }
        // fn pode mutar in-place (retorno undefined) ou retornar novo payload
        const cur = snapshot(frame.payload);
        if (np !== undefined && jsonSafe(np) !== orig) return { changed: true, payload: np };
        if (cur !== orig) return { changed: true, payload: frame.payload };
      }
    }

    if (key === 'mine') {
      const p = frame.payload;
      if (!p || typeof p !== 'object') return { changed: false, payload: p };
      if (orig === null) orig = snapshot(p);
      const I = cfg.in;
      let changed = false;
      const setNum = (field, src) => { if (src.enabled && typeof p[field] === 'number') { p[field] = src.value; changed = true; } };
      setNum('gold', I.mineGold);
      setNum('coins', I.mineCoins);
      setNum('stamina', I.mineStamina);
      setNum('accountLevel', I.mineAccountLv);
      setNum('partySlots', I.minePartySlots);
      setNum('preyCards', I.minePreyCards);
      setNum('gemsUp', I.mineGems);
      setNum('gemsAttr', I.mineGems);
      if (I.mineVip.enabled && typeof p.vipUntil === 'number') { p.vipUntil = I.mineVip.value > 0 ? I.mineVip.value : (Date.now() + 31536000000); changed = true; }
      return { changed: changed || (orig !== null && snapshot(p) !== orig), payload: p };
    }
    return { changed: false, payload: frame.payload };
  }

  const COUNT_KEYS = ['q', 'count', 'n', 'amt', 'amount'];
  const PRICE_KEYS = ['pr', 'price', 'c', 'cost', 'value'];

  function applyOutRules(frame) {
    const type = frame.msgType;
    if (typeof type !== 'string' && typeof type !== 'number') return { changed: false, payload: frame.payload };
    const key = String(type);

    let orig = null;
    for (const r of customOut) {
      const match = typeof r.type === 'function' ? r.type(type, frame.payload) : r.type === type;
      if (match) {
        if (orig === null) orig = snapshot(frame.payload);
        let np;
        try { np = r.fn(frame.payload, { type, dir: 'out' }); } catch (e) { console.warn('[BAIAK MITM] regra out falhou:', e); continue; }
        const cur = snapshot(frame.payload);
        if (np !== undefined && jsonSafe(np) !== orig) return { changed: true, payload: np };
        if (cur !== orig) return { changed: true, payload: frame.payload };
      }
    }

    const p = frame.payload;
    if (!p || typeof p !== 'object') return { changed: false, payload: p };
    if (orig === null) orig = snapshot(p);
    let changed = false;
    const O = cfg.out;

    if (key === 'buycart' && (O.buycartQty.enabled || O.buycartPrc.enabled)) {
      if (Array.isArray(p.items)) for (const it of p.items) {
        if (!it || typeof it !== 'object') continue;
        for (const k of Object.keys(it)) {
          if (typeof it[k] !== 'number') continue;
          if (O.buycartQty.enabled && COUNT_KEYS.includes(k)) { it[k] = O.buycartQty.value; changed = true; }
          if (O.buycartPrc.enabled && PRICE_KEYS.includes(k)) { it[k] = O.buycartPrc.value; changed = true; }
        }
      }
    }
    if (key === 'imbue' && O.imbueTier.enabled && typeof p.tier === 'number') { p.tier = O.imbueTier.value; changed = true; }
    if (key === 'houserent' && O.houseMonths.enabled && typeof p.months === 'number') { p.months = O.houseMonths.value; changed = true; }

    return { changed: changed, payload: p };
  }

  function rebuild(a, frame, res) {
    if (!res.changed) return null;
    try {
      const bytes = buildDataFrame(frame.msgType, res.payload);
      const check = decodeFrame(bytes);
      if (!check || check.passthrough || jsonSafe(check.payload) !== jsonSafe(res.payload)) return null;
      return bytes;
    } catch (e) { return null; }
  }

  /* --------------------------------------------------------------------------
   *  Hooks no WebSocket
   * ------------------------------------------------------------------------ */
  const NativeWebSocket = globalThis.WebSocket;
  const nativeSend = NativeWebSocket && NativeWebSocket.prototype.send;
  const nativeCtor = NativeWebSocket;

  const sockets = new Set();

  function handleOutgoing(ws, data) {
    stats.out++;
    if (typeof data === 'string') {
      countProto('text');
      UI.log('OUT', 'txt', data, data.slice(0, 200));
      return { data, changed: false };
    }
    const u8 = toU8(data);
    if (!u8) { countProto(undefined); return { data, changed: false }; }
    try {
      const frame = decodeFrame(u8);
      countProto(frame.frameType);
      let logFrame = (label, extra) => UI.log('OUT', label, undefined, (extra || (u8.length + ' bytes')));
      if (frame.frameType === PROTO.ROOM_DATA) {
        if (frame.passthrough) {
          countPassthrough();
          logFrame('ROOM_DATA', frame.msgType !== undefined ? (String(frame.msgType) + ' (payload não-decodificado)') : (u8.length + ' bytes'));
          return { data, changed: false };
        }
        recordSample(frame.msgType, frame.payload, 'OUT');
        const res = applyOutRules(frame);
        const bytes = rebuild({}, frame, res);
        if (bytes) {
          stats.tamperedOut++;
          UI.log('OUT', String(frame.msgType) + ' ⚡', res.payload, preview(res.payload), true);
          return { data: bytes, changed: true };
        }
        UI.log('OUT', String(frame.msgType), res.payload, preview(res.payload));
        return { data, changed: false };
      }
      logFrame('proto#' + frame.frameType);
      return { data, changed: false };
    } catch (e) {
      UI.log('OUT', 'frame?', undefined, u8.length + ' bytes (no-decode)');
      return { data, changed: false };
    }
  }

  function handleIncoming(ws, ev) {
    if (typeof ev.data === 'string') { countProto('text'); stats.text++; return ev; }
    if (ev.data instanceof Blob) { stats.blob++; return ev; } // fallback: wrapListener já converte; se cair aqui, só conta
    stats.in++;
    const u8 = toU8(ev.data);
    if (!u8) { countProto(undefined); return ev; }
    try {
      const frame = decodeFrame(u8);
      countProto(frame.frameType);
      if (frame.frameType === PROTO.ROOM_DATA) {
        if (frame.passthrough) {
          countPassthrough();
          UI.log('IN', 'ROOM_DATA-bin', undefined, u8.length + ' bytes (msgpack fora do padrão) hex:' + hexHead(u8));
          return ev;
        }
        recordSample(frame.msgType, frame.payload, 'IN');
        const res = applyInRules(frame);
        const bytes = rebuild({}, frame, res);
        if (bytes) {
          stats.tamperedIn++;
          UI.log('IN', String(frame.msgType) + ' ⚡', res.payload, preview(res.payload), true);
          return createMsgEvent(ev, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        }
        UI.log('IN', String(frame.msgType), res.payload, preview(res.payload));
        return ev;
      }
      if (frame.frameType === PROTO.ROOM_STATE || frame.frameType === PROTO.ROOM_STATE_PATCH ||
          frame.frameType === PROTO.ROOM_DATA_BYTES || frame.frameType === PROTO.ROOM_DATA_SCHEMA) {
        stats.stateBytes++;
        // estado é binário (schema), não msgpack — só logamos tamanho p/ diagnóstico
        if (cfg.log) UI.log('IN', 'proto#' + frame.frameType, undefined, u8.length + ' bytes hex:' + hexHead(u8));
        return ev;
      }
      return ev;
    } catch (e) {
      return ev;
    }
  }

  function createMsgEvent(ev, data) {
    try {
      return new MessageEvent('message', {
        data,
        origin: ev.origin, lastEventId: ev.lastEventId,
        source: ev.source, ports: ev.ports,
        bubbles: ev.bubbles, cancelable: ev.cancelable,
      });
    } catch (e) {
      try {
        const copy = new ev.constructor('message', { data });
        for (const k of ['origin', 'lastEventId', 'source', 'ports']) {
          try { if (ev[k] !== undefined) copy[k] = ev[k]; } catch (_) {}
        }
        return copy;
      } catch (_) {
        const copy = Object.create(Object.getPrototypeOf(ev));
        Object.assign(copy, ev);
        try { Object.defineProperty(copy, 'data', { value: data, configurable: true, writable: true }); }
        catch (__) { copy.data = data; }
        return copy;
      }
    }
  }

  // Wrap de listener que suporta Blob (binaryType default do browser) de forma
  // assíncrona: segura o evento original, converte, aplica tamper e só então
  // chama o listener real com o evento (possivelmente reescrito).
  function wrapListener(fn) {
    if (fn && fn.__baiakWrapped) return fn.__baiakWrapped;
    const wrapped = function (ev) {
      const d = ev && ev.data;
      if (d instanceof Blob) {
        // pausa a entrega: converte primeiro
        try { ev.stopImmediatePropagation && ev.stopImmediatePropagation(); } catch (_) {}
        // impede outros listeners nativos já registrados de verem o Blob cru?
        // (só funciona se o nosso wrapper rodar primeiro — ver hook de prototype)
        d.arrayBuffer().then((ab) => {
          const u8 = new Uint8Array(ab);
          const fake = createMsgEvent(ev, ab);
          // garante toU8 enxergando o buffer convertido
          try { Object.defineProperty(fake, 'data', { value: ab, configurable: true }); } catch (_) {}
          let outEv = fake;
          try { outEv = handleIncoming(this, fake) || fake; } catch (_) {}
          // handleIncoming espera ev.data conversível; se retornou ev fake com
          // ArrayBuffer, entrega. Se houve tamper, já é um novo MessageEvent.
          try { fn.call(this, outEv); } catch (_) {}
        }).catch(() => { try { fn.call(this, ev); } catch (_) {} });
        return;
      }
      let outEv = ev;
      try { outEv = handleIncoming(this, ev) || ev; } catch (_) {}
      try { fn.call(this, outEv); } catch (_) {}
    };
    wrapped.__baiakOrig = fn;
    try { Object.defineProperty(fn, '__baiakWrapped', { value: wrapped, configurable: true }); } catch (_) {}
    return wrapped;
  }

  function hookInstance(ws) {
    if (!ws || ws.__baiakHooked) return;
    try { Object.defineProperty(ws, '__baiakHooked', { value: true, configurable: true }); }
    catch (_) { try { ws.__baiakHooked = true; } catch (__) {} }
    sockets.add(ws);

    // migra handler onmessage já registrado via setter nativo (injeção tardia)
    try {
      const cur = ws.onmessage;
      if (typeof cur === 'function' && !cur.__baiakOrig && !cur.__baiakWrapped) {
        ws.onmessage = wrapListener(cur);
      }
    } catch (_) {}

    // cobre transporte que use addEventListener('message', ...) num WebSocket nativo
    // (instância — para sockets criados antes do patch de prototype)
    try {
      const nativeAddEv = WebSocket.prototype.addEventListener;
      const curAdd = ws.addEventListener;
      const wrapAdd = function (type, fn, opts) {
        if (type === 'message' && typeof fn === 'function') {
          return nativeAddEv.call(this, type, wrapListener(fn), opts);
        }
        return nativeAddEv.call(this, type, fn, opts);
      };
      try { Object.defineProperty(ws, 'addEventListener', { configurable: true, writable: true, value: wrapAdd }); } catch (_) {}
    } catch (_) {}

    try { ws.addEventListener('close', () => sockets.delete(ws), { once: true }); } catch (_) {}
  }

  function HackedWebSocket(url, protocols) {
    const ws = protocols !== undefined ? new nativeCtor(url, protocols) : new nativeCtor(url);
    hookInstance(ws);
    return ws;
  }

  function installWsHooks() {
    if (!NativeWebSocket || !nativeSend) return;
    // Patch no prototype.send: cobre QUALQUER socket, inclusive os já abertos
    // no momento da injeção (o SDK chama this.ws.send via prototype).
    const origSendDesc = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'send');
    NativeWebSocket.prototype.send = function (data) {
      try {
        const r = handleOutgoing(this, data);
        return nativeSend.call(this, r.data);
      } catch (e) {
        return nativeSend.call(this, data);
      }
    };
    try { Object.defineProperty(NativeWebSocket.prototype.send, '__baiakPatched', { value: true }); } catch (_) {}

    // Patch global no addEventListener/removeEventListener do prototype:
    // cobre sockets JÁ ABERTOS antes da injeção (caso do paste no console).
    try {
      const nativeAdd = NativeWebSocket.prototype.addEventListener;
      const nativeRem = NativeWebSocket.prototype.removeEventListener;
      if (nativeAdd && !nativeAdd.__baiakPatched) {
        const patchedAdd = function (type, fn, opts) {
          if (type === 'message' && typeof fn === 'function') {
            return nativeAdd.call(this, type, wrapListener(fn), opts);
          }
          return nativeAdd.call(this, type, fn, opts);
        };
        try { Object.defineProperty(patchedAdd, '__baiakPatched', { value: true }); } catch (_) {}
        NativeWebSocket.prototype.addEventListener = patchedAdd;
      }
      if (nativeRem && !nativeRem.__baiakPatched) {
        const patchedRem = function (type, fn, opts) {
          try {
            if (type === 'message' && typeof fn === 'function') {
              // tenta remover tanto o original quanto o wrapped
              try { nativeRem.call(this, type, fn.__baiakWrapped || fn, opts); } catch (_) {}
              if (fn.__baiakWrapped) try { nativeRem.call(this, type, fn, opts); } catch (_) {}
              // remove wrappers cujo __baiakOrig === fn (caso o listener tenha sido
              // registrado antes e migrado via hookInstance)
              return;
            }
          } catch (_) {}
          return nativeRem.call(this, type, fn, opts);
        };
        try { Object.defineProperty(patchedRem, '__baiakPatched', { value: true }); } catch (_) {}
        NativeWebSocket.prototype.removeEventListener = patchedRem;
      }
    } catch (_) {}

    // Patch global do setter onmessage no prototype: encadeia o getter/setter
    // nativo para não quebrar o SDK, mas passa todo handler por wrapListener.
    try {
      const desc = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'onmessage');
      if (desc && (desc.get || desc.set) && !desc.set.__baiakPatched) {
        const nativeGet = desc.get, nativeSet = desc.set;
        const patchedSet = function (fn) {
          if (typeof fn === 'function') return nativeSet.call(this, wrapListener(fn));
          return nativeSet.call(this, fn);
        };
        try { Object.defineProperty(patchedSet, '__baiakPatched', { value: true }); } catch (_) {}
        Object.defineProperty(NativeWebSocket.prototype, 'onmessage', {
          configurable: true, enumerable: desc.enumerable,
          get: function () { try { return nativeGet.call(this); } catch (_) { return null; } },
          set: patchedSet,
        });
      }
    } catch (_) {}
    HackedWebSocket.prototype = NativeWebSocket.prototype;
    Object.assign(HackedWebSocket, {
      CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    });
    try { globalThis.WebSocket = HackedWebSocket; } catch (e) { /* CSP? */ }
    console.info('[BAIAK MITM] WebSocket hooks instalados https://baiakidle.com');
  }

  /* --------------------------------------------------------------------------
   *  Hook no fetch (tRPC)
   * ------------------------------------------------------------------------ */
  const nativeFetch = globalThis.fetch;

  function applyTrpcIn(batch, url) {
    if (!cfg.trpcTamper) return batch;
    let changed = false;
    for (const item of batch) {
      const path = item && (item.path || (item.json && item.json.query));
      for (const r of customTrpcIn) {
        const name = typeof r.match === 'string' ? r.match : String(path);
        const hit = typeof r.match === 'function' ? r.match(path, item) : (typeof r.match === 'string' ? r.match === path : r.match.test(String(path) || ''));
        if (hit) {
          const before = jsonSafe(item);
          try { r.fn(item, { url }); } catch (e) { console.warn('[BAIAK MITM] trpcIn falhou:', e); }
          if (jsonSafe(item) !== before) changed = true;
        }
      }
    }
    return { batch, changed };
  }

  function fetchIt(url, opts) {
    const r = handleTrpc(url, opts);
    if (r.promise) return r.promise;
    return nativeFetch(r.url, r.opts);
  }

  function isTrpcUrl(url) {
    if (typeof url === 'string') return url.indexOf('/api/trpc') !== -1;
    if (url && url.url) return String(url.url).indexOf('/api/trpc') !== -1;
    return false;
  }

  function handleTrpc(url, opts) {
    if (!isTrpcUrl(url)) return { url, opts, promise: null };
    const bodyStr = opts && typeof opts.body === 'string' ? opts.body : null;
    if (!bodyStr) return { url, opts, promise: null };

    let batch = null;
    try { batch = JSON.parse(bodyStr); } catch (e) { return { url, opts }; }

    stats.trpc++;
    const outRes = applyTrpcIn(batch, url);
    const outBody = outRes.changed ? JSON.stringify(outRes.batch) : bodyStr;

    let nextOpts = opts;
    if (outRes.changed) {
      nextOpts = Object.assign({}, opts, { body: outBody });
      UI.log('TRPC', 'OUT ⚡', outRes.batch, preview(outRes.batch), true);
    } else if (cfg.logTrpc) {
      UI.log('TRPC', 'OUT', batch, preview(batch));
    }

    const p = nativeFetch(typeof url === 'string' ? url : url.url, nextOpts).then(
      (res) => {
        if (!res || !res.ok) return res;
        try {
          return res.clone().text().then(
            (text) => {
              let data;
              try { data = JSON.parse(text); } catch (e) { return res; }
              stats.trpc++;
              if (cfg.trpcTamper) {
                let changed = false;
                const items = Array.isArray(data) ? data : [data];
                for (const item of items) {
                  const path = item && (item.path || (item.json && item.json.query) || (item.result && item.result.data && item.result.data.__path));
                  for (const r of customTrpcResp) {
                    const hit = typeof r.match === 'function' ? r.match(path, item) : (typeof r.match === 'string' ? r.match === path : r.match.test(String(path) || ''));
                    if (hit) {
                      const before = jsonSafe(item);
                      try { r.fn(item, { url }); } catch (e) { console.warn('[BAIAK MITM] trpcResp falhou:', e); }
                      if (jsonSafe(item) !== before) changed = true;
                    }
                  }
                }
                if (changed) {
                  stats.tamperedIn++;
                  UI.log('TRPC', 'IN ⚡', data, preview(data), true);
                  return new Response(JSON.stringify(data), {
                    status: res.status, statusText: res.statusText, headers: res.headers,
                  });
                }
              }
              if (cfg.logTrpc) UI.log('TRPC', 'IN', data, preview(data));
              return res;
            },
            () => res,
          );
        } catch (e) { return res; }
      },
    );
    return { url, opts, promise: p };
  }

  const customTrpcIn = [];
  const customTrpcResp = [];

  function installFetchHooks() {
    if (!nativeFetch) return;
    globalThis.fetch = function (input, init) {
      return fetchIt(input, init);
    };
  }

  /* --------------------------------------------------------------------------
   *  UI
   * ------------------------------------------------------------------------ */
  const LOG_MAX = 250;
  const logBuf = [];
  let logOn = true;

  const UI = {
    root: null,
    body: null,
    logBox: null,
    statsEl: null,
    samplesEl: null,
    minimized: false,
    paused: false,

    init() {
      const style = document.createElement('style');
      style.textContent = `
        #baiak-mitm{position:fixed;right:12px;bottom:12px;width:400px;max-width:96vw;background:#14161a;color:#d7dae0;border:1px solid #2c313a;border-radius:10px;font:12px/1.45 system-ui,sans-serif;z-index:2147483646;box-shadow:0 8px 30px rgba(0,0,0,.55);overflow:hidden}
        #baiak-mitm *{box-sizing:border-box}
        #baiak-mitm .bm-h{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#1b1f26;cursor:pointer;user-select:none;border-bottom:1px solid #2c313a}
        #baiak-mitm .bm-h b{color:#7fb4ff;font-size:12px}
        #baiak-mitm .bm-h .bm-min{margin-left:auto;color:#8a93a6;font-size:14px}
        #baiak-mitm .bm-body{padding:8px;display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto}
        #baiak-mitm .bm-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
        #baiak-mitm .bm-pill{font-size:11px;padding:3px 8px;border-radius:20px;background:#262b34;border:1px solid #333a46;color:#c6cbd4;cursor:pointer;white-space:nowrap}
        #baiak-mitm .bm-pill.on{background:#1f5e30;border-color:#2e8b46;color:#a3f0b8}
        #baiak-mitm .bm-pill.dim{opacity:.55}
        #baiak-mitm .bm-pill.inp{padding:0}
        #baiak-mitm .bm-pill input{width:74px;background:#101318;border:1px solid #333a46;color:#e8ebf0;border-radius:16px;padding:2px 8px;font-size:11px}
        #baiak-mitm .bm-pill input:disabled{opacity:.4}
        #baiak-mitm .bm-sec{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#8a93a6;margin-top:4px}
        #baiak-mitm .bm-log{height:170px;overflow-y:auto;background:#0d0f13;border:1px solid #232833;border-radius:6px;padding:4px;font:10px/1.5 ui-monospace,monospace}
        #baiak-mitm .bm-log div{white-space:pre-wrap;word-break:break-all;border-bottom:1px solid #171b21;padding:1px 2px}
        #baiak-mitm .bm-log .in{color:#9ecbff}.bm-log .out{color:#ffd79a}.bm-log .trpc{color:#c3a6ff}.bm-log .hot{color:#ff7b7b}
        #baiak-mitm .bm-samples{max-height:120px;overflow-y:auto;background:#0d0f13;border:1px solid #232833;border-radius:6px;padding:4px;font:10px/1.5 ui-monospace,monospace}
        #baiak-mitm .bm-samples .samp{cursor:pointer;color:#9ecbff}
        #baiak-mitm .bm-samples .samp:hover{color:#fff}
        #baiak-mitm .bm-samples pre{display:none;color:#c9ced8;background:#0a0c0f;padding:4px;margin:2px 0;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow:auto}
      `;
      document.head.appendChild(style);

      const root = document.createElement('div');
      root.id = 'baiak-mitm';
      root.innerHTML = `
        <div class="bm-h">
          <b>BAIAK MITM</b>
          <span class="bm-stats" style="color:#5a6474;font-size:11px"></span>
          <span class="bm-min">▾</span>
        </div>
        <div class="bm-body">
          <div class="bm-row">
            <button class="bm-pill on" data-p="log">log</button>
            <button class="bm-pill on" data-p="trpc">trpc-log</button>
            <button class="bm-pill" data-p="trpcTamper">trpc-tamper</button>
            <button class="bm-pill" data-p="clear">limpar</button>
            <button class="bm-pill" data-p="conn" title="Fecha o socket e força reconexão pelos hooks">reconectar</button>
          </div>
          <div class="bm-sec">IN de servidor→cliente (ira editar o pacote em memoria)</div>
          <div class="bm-row" id="bm-in"></div>
          <div class="bm-sec">OUT de cliente→servidor (o servidor re-validar — risco de ban)</div>
          <div class="bm-row" id="bm-out"></div>
          <div class="bm-sec">catch-all (custom via __baiakHack.in/out)</div>
          <div class="bm-row">
            <button class="bm-pill dim" data-ex="in">ex. tamper in</button>
            <button class="bm-pill dim" data-ex="out">ex. tamper out</button>
            <button class="bm-pill dim" data-ex="trpc">ex. trpc</button>
            <button class="bm-pill dim" data-ex="copy">copiar JSON da amostra</button>
          </div>
          <div class="bm-log" id="bm-log"></div>
          <div class="bm-sec">Amostras por tipo (clique p/ expandir)</div>
          <div class="bm-samples" id="bm-samples"></div>
        </div>
      `;
      document.body.appendChild(root);

      this.root = root;
      this.logBox = root.querySelector('#bm-log');
      this.statsEl = root.querySelector('.bm-stats');
      this.samplesEl = root.querySelector('#bm-samples');
      this.body = root.querySelector('.bm-body');

      // toggles
      const pill = (label, key, cfgKey, inputVal) => {
        const b = document.createElement('button');
        b.className = 'bm-pill';
        b.textContent = label;
        b.classList.toggle('on', cfgKey.enabled);
        b.onclick = () => { cfgKey.enabled = !cfgKey.enabled; b.classList.toggle('on', cfgKey.enabled); this.renderToggles(); };
        if (inputVal !== undefined) {
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.value = String(inputVal);
          inp.disabled = !cfgKey.enabled;
          inp.onchange = () => { cfgKey.value = parseInt(inp.value, 10) || 0; };
          b.appendChild(inp);
        }
        return b;
      };

      this.inRow = root.querySelector('#bm-in');
      this.outRow = root.querySelector('#bm-out');
      this.renderToggles = () => {
        this.inRow.innerHTML = '';
        this.outRow.innerHTML = '';
        const mk = (label, ck, showVal) => {
          const b = document.createElement('button');
          b.className = 'bm-pill';
          b.textContent = label;
          b.classList.toggle('on', ck.enabled);
          b.onclick = () => { ck.enabled = !ck.enabled; b.classList.toggle('on', ck.enabled); this.renderToggles(); };
          const wr = document.createElement('span');
          wr.appendChild(b);
          if (showVal) {
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.value = String(ck.value);
            inp.disabled = !ck.enabled;
            inp.onchange = () => { ck.value = parseInt(inp.value, 10) || 0; };
            wr.appendChild(inp);
          }
          return wr;
        };
        const I = cfg.in, O = cfg.out;
        this.inRow.appendChild(mk('gold', I.mineGold, true));
        this.inRow.appendChild(mk('coins', I.mineCoins, true));
        this.inRow.appendChild(mk('stamina', I.mineStamina, true));
        this.inRow.appendChild(mk('vip', I.mineVip));
        this.inRow.appendChild(mk('lv.conta', I.mineAccountLv, true));
        this.inRow.appendChild(mk('partySlots', I.minePartySlots, true));
        this.inRow.appendChild(mk('preyCards', I.minePreyCards, true));
        this.inRow.appendChild(mk('gems', I.mineGems, true));
        this.outRow.appendChild(mk('qty buycart', O.buycartQty, true));
        this.outRow.appendChild(mk('preço buycart', O.buycartPrc, true));
        this.outRow.appendChild(mk('imbue tier', O.imbueTier, true));
        this.outRow.appendChild(mk('house meses', O.houseMonths, true));
      };
      this.renderToggles();

      root.querySelector('.bm-h').onclick = (e) => {
        if (e.target.classList.contains('bm-min')) {
          this.minimized = !this.minimized;
          this.body.style.display = this.minimized ? 'none' : 'flex';
          root.querySelector('.bm-min').textContent = this.minimized ? '▸' : '▾';
        }
      };

      root.querySelectorAll('[data-p]').forEach((b) => {
        b.onclick = () => {
          const p = b.dataset.p;
          if (p === 'log') { logOn = !logOn; b.classList.toggle('on', logOn); }
          else if (p === 'clear') { logBuf.length = 0; this.logBox.innerHTML = ''; }
          else if (p === 'conn') { __baiakHack.reconnect(); }
          else if (p === 'trpc') { cfg.logTrpc = !cfg.logTrpc; b.classList.toggle('on', cfg.logTrpc); }
          else if (p === 'trpcTamper') { cfg.trpcTamper = !cfg.trpcTamper; b.classList.toggle('on', cfg.trpcTamper); }
        };
      });

      root.querySelectorAll('[data-ex]').forEach((b) => {
        b.onclick = () => {
          const ex = b.dataset.ex;
          if (ex === 'in') {
            __baiakHack.in('mine', (p) => { p.gold = 999999999; p.coins = 9999; });
            UI.log('API', 'in("mine") registrada', null, 'ajusta gold/coins no pacote mine');
          } else if (ex === 'out') {
            __baiakHack.out(/^buy/, (p) => { if (p && typeof p === 'object') for (const k of Object.keys(p)) if (typeof p[k] === 'number') p[k] = 0; });
            UI.log('API', 'out(/^buy/) registrada', null, 'zera numericos em qualquer buy*');
          } else if (ex === 'trpc') {
            __baiakHack.trpcIn(/market\.checkout|coin\./, (item) => { if (item && item.json && item.json.input && typeof item.json.input.price === 'number') item.json.input.price = 1; });
            UI.log('API', 'trpcIn() registrada', null, 'tenta price=1 no checkout/coin');
          } else if (ex === 'copy') {
            const s = samples.get(lastSampleKey);
            if (s) { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(s.full, null, 2)); UI.log('API', 'copiado', null, String(lastSampleKey)); }
          }
        };
      });

      this.tick();
    },

    log(dir, type, payload, preview, hot) {
      if (!logOn) return;
      logBuf.push({ dir, type, preview: preview || (payload !== undefined ? preview(payload) : ''), hot: !!hot });
      if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX);
    },

    refreshSamples() {
      if (!this.samplesEl) return;
      let html = '';
      let i = 0;
      for (const [k, s] of samples) {
        if (++i > 40) break;
        const pv = preview(s.full);
        html += `<div class="samp" data-k="${k}">${s.dir} ${k} ×${s.count} <span style="color:#5a6474">${pv.slice(0, 60)}</span></div><pre></pre>`;
      }
      this.samplesEl.innerHTML = html;
      this.samplesEl.querySelectorAll('.samp').forEach((el) => {
        el.onclick = () => {
          const k = el.dataset.k;
          lastSampleKey = k;
          const s = samples.get(k);
          const pre = el.nextElementSibling;
          if (pre.style.display === 'block') { pre.style.display = 'none'; return; }
          pre.textContent = JSON.stringify(s.full, null, 2);
          pre.style.display = 'block';
        };
      });
    },

    tick() {
      if (!this.root) return;
      this.statsEl.textContent = `↑${stats.out} ↓${stats.in} ⚡${stats.tamperedOut}/${stats.tamperedIn} t:${stats.trpc}`;
      const frag = document.createDocumentFragment();
      const slice = logBuf.slice(-80);
      for (const e of slice) {
        const div = document.createElement('div');
        div.className = e.dir.toLowerCase().indexOf('trpc') === 0 ? 'trpc' : (e.dir.toLowerCase().startsWith('out') ? 'out' : 'in');
        if (e.hot) div.classList.add('hot');
        div.textContent = `${e.dir} ${e.type}` + (e.preview ? '  ' + e.preview : '');
        frag.appendChild(div);
      }
      if (this.logBox.children.length !== slice.length || true) {
        this.logBox.innerHTML = '';
        this.logBox.appendChild(frag);
        this.logBox.scrollTop = this.logBox.scrollHeight;
      }
      setTimeout(() => this.tick(), 400);
    },
  };

  let lastSampleKey = null;

  function preview(payload) {
    let s;
    try { s = JSON.stringify(payload); } catch (e) { s = String(payload); }
    if (!s) return '';
    return s.length > 1600 ? s.slice(0, 1600) + ' …' : s;
  }

  function hexHead(u8, n) {
    n = n || 24;
    let s = '';
    for (let i = 0; i < Math.min(n, u8.length); i++) {
      s += u8[i].toString(16).padStart(2, '0') + ' ';
    }
    return s.trim();
  }

  let _hb = false;
  function startHeartbeat() {
    if (_hb) return;
    _hb = true;
    setInterval(() => {
      try {
        console.log('[BAIAK MITM]', JSON.stringify({ ...stats, proto: stats.proto, pass: stats.passthrough, samples: samples.size }));
      } catch (e) {}
    }, 10000);
  }

  function initUi() {
    if (document.body) { UI.init(); startHeartbeat(); }
    else {
      const mo = new MutationObserver(() => {
        if (document.body && !UI.root) { UI.init(); mo.disconnect(); startHeartbeat(); }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  /* --------------------------------------------------------------------------
   *  API pública
   * ------------------------------------------------------------------------ */
  const __baiakHack = {
    version: '1.0.4',
    cfg,
    stats,
    samples,
    in(type, fn) { customIn.push({ type, fn }); },
    out(type, fn) { customOut.push({ type, fn }); },
    trpcIn(match, fn) { customTrpcIn.push({ match, fn }); },
    trpcResp(match, fn) { customTrpcResp.push({ match, fn }); },
    log(data) { UI.log('API', 'log', data, preview(data)); },
    reconnect() {
      for (const ws of Array.from(sockets)) { try { ws.close(4000, 'baiak mitm'); } catch (e) {} }
      UI.log('API', 'reconnect()', null, 'socket(s) fechado — reconexão passará pelos hooks');
    },
    // envia um ROOM_DATA (0x0d) com [msgType, payload] em todos os sockets abertos
    send(type, payload) {
      let n = 0;
      let bytes;
      try { bytes = buildDataFrame(type, payload); } catch (e) { return { sent: 0, error: String(e) }; }
      for (const ws of Array.from(sockets)) {
        try { if (ws.readyState === 1) { ws.send(bytes); n++; } } catch (_) {}
      }
      UI.log('API', 'send(' + type + ')', payload, preview(payload));
      return { sent: n };
    },
    socketCount() { return sockets.size; },
    //Dumpa amostras completas (cap 8k por tipo) p/ análise
    dump() {
      const o = {};
      for (const [k, s] of samples) o[k] = { dir: s.dir, count: s.count, full: s.full };
      return o;
    },
    // Audita cada tipo amostrado: re-encoda e confere round-trip.
    // roundtrip:true = suporta tamper no transporte (rebuild funciona).
    audit() {
      const rows = [];
      for (const [type, s] of samples) {
        let enc = 'n/a', rt = false, note = '';
        try {
          const bytes = buildDataFrame(type, s.full);
          enc = bytes.length + 'B';
          const chk = decodeFrame(bytes);
          if (chk.passthrough) note = 'passthrough';
          else {
            rt = jsonSafe(chk.payload) === jsonSafe(s.full);
            if (!rt) note = 'recode-diff';
          }
        } catch (e) { enc = 'ERR'; note = String(e && e.message || e).slice(0, 80); }
        rows.push({ type, dir: s.dir, count: s.count, enc, roundtrip: rt, note });
      }
      return rows;
    },
    // re-engancha sockets criados antes da injeção tardia (paste no console).
    // Não há como enumerar sockets vivos pelo JS, então este método reinstala
    // os patches de prototype e orienta o reload. Retorna diagnóstico.
    rescue() {
      installWsHooks();
      const diag = {
        out: stats.out, in: stats.in, blob: stats.blob,
        stateBytes: stats.stateBytes, passthrough: stats.passthrough,
        samples: samples.size, proto: { ...stats.proto },
        hint: 'Se in=0 e blob=0 após 10s de jogo aberto, o socket foi criado antes do patch e usa listener já registrado: recarregue a página COM o script ativo (document-start) em vez de colar no console.',
      };
      console.info('[BAIAK MITM] rescue:', diag);
      return diag;
    },
    debug() {
      return {
        stats: { ...stats, proto: { ...stats.proto } },
        samples: [...samples.keys()],
        sendPatched: !!(NativeWebSocket.prototype.send && NativeWebSocket.prototype.send.__baiakPatched),
        addEvPatched: !!(NativeWebSocket.prototype.addEventListener && NativeWebSocket.prototype.addEventListener.__baiakPatched),
      };
    },
    protocol: PROTO,
    _core: {
      decodeMsgpack, encodeMsgpack, decodeFrame, buildDataFrame, toU8,
      applyInRules, applyOutRules, rebuild, handleIncoming, handleOutgoing,
    },
  };

  // expõe no escopo global da janela
  try { globalThis.__baiakHack = __baiakHack; } catch (e) {}

  /* --------------------------------------------------------------------------
   *  Boot
   * ------------------------------------------------------------------------ */
  installWsHooks();
  if (nativeFetch) {
    installFetchHooks();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUi);
    } else {
      initUi();
    }
  }

  if (globalThis.__baiakHack === undefined) globalThis.__baiakHack = __baiakHack;
  console.info('%cBAIAK MITM%c ativo. Panel: canto inferior direito. API: window.__baiakHack', 'background:#2e6bd6;color:#fff;padding:2px 8px;border-radius:4px', '');
})();