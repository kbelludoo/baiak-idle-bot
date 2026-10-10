import { afterEach, describe, expect, it } from 'bun:test';
import { COLYSEUS_OPCODE, MsgpackReader, decodeFrame, encodeMsgpackPair, encodeRoomData } from '../src/protocol';
import {
  OP_ERROR, OP_JOIN_ROOM, OP_LEAVE_ROOM, OP_ROOM_DATA, OP_ROOM_DATA_SCHEMA,
  OP_ROOM_STATE, OP_ROOM_STATE_PATCH, Room, endpointFromOrigin, matchmake, MatchmakeError,
} from '../src/term/colyseus';
import { classifyJoinError, openHuntOnce } from '../src/term/session';
import { pickHuntForLevel } from '../src/term/hunter';
import { buildExt, buildFingerprint, defaultEnv, newDeviceId, yt } from '../src/term/fingerprint';

const ORIG_WS = (globalThis as any).WebSocket;
const ORIG_FETCH = (globalThis as any).fetch;

class FakeWS {
  static last: FakeWS | null = null;
  binaryType = 'blob';
  sent: Uint8Array[] = [];
  closed = false;
  private listeners: Record<string, Array<(ev: any) => void>> = {};
  constructor(public url: string) {
    FakeWS.last = this;
  }
  addEventListener(type: string, fn: (ev: any) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: any) {
    this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }
  close() {
    this.closed = true;
    this.emit('close', { code: 1000 });
  }
  emit(type: string, ev: any) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  message(bytes: Uint8Array) {
    this.emit('message', { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
}

/** JOIN_ROOM do servidor: [0x0A] [len][token] [len][serializerId] em UTF-8 cru. */
function joinFrame(token: string, serializerId: string): Uint8Array {
  const enc = new TextEncoder();
  const a = enc.encode(token);
  const b = enc.encode(serializerId);
  const out = new Uint8Array(1 + 1 + a.length + 1 + b.length);
  let o = 0;
  out[o++] = 0x0a;
  out[o++] = a.length;
  out.set(a, o); o += a.length;
  out[o++] = b.length;
  out.set(b, o);
  return out;
}

function seat(roomId = 'room-1', processId = 'proc-1') {
  return { roomName: 'hunt', roomId, processId, sessionId: 'sess-1' };
}

afterEach(() => {
  (globalThis as any).WebSocket = ORIG_WS;
  (globalThis as any).fetch = ORIG_FETCH;
  FakeWS.last = null;
});

describe('protocolo msgpack (reutilizado do driver com browser)', () => {
  it('encodeRoomData gera 0x0D + [type, payload] e volta no decodeFrame', () => {
    const frame = encodeRoomData('stage', { huntId: 'glooth-cave' });
    expect(frame[0]).toBe(0x0d);
    const decoded = decodeFrame(frame);
    expect(decoded?.frame).toBe('ROOM_DATA');
    expect(decoded?.type).toBe('stage');
    expect(decoded?.payload).toEqual({ huntId: 'glooth-cave' });
  });

  it('round-trip de tipos usados pelo bot (números, null, arrays, bool)', () => {
    const payload = { slot: 0, below: 60.5, on: true, off: false, name: null, spells: ['exura', 'utana'], n: -7 };
    const decoded = decodeFrame(encodeRoomData('potion', payload));
    expect(decoded?.type).toBe('potion');
    expect(decoded?.payload).toEqual(payload);
  });

  it('frame de ERROR é [0x0B] + msgpack(number, string) — como o SDK lê', () => {
    const frame = Uint8Array.of(0x0b, ...encodeMsgpackPair(4294, 'BOSS_ACTIVE'));
    expect(frame[0]).toBe(0x0b);
    const reader = new MsgpackReader(frame.subarray(1));
    expect(Number(reader.read())).toBe(4294);
    expect(String(reader.read())).toBe('BOSS_ACTIVE');
  });
});

describe('opcodes do driver batem com a tabela do protocolo', () => {
  it('mesmos números para JOIN_ROOM/ERROR/ROOM_DATA/estado', () => {
    expect([
      OP_JOIN_ROOM, OP_ERROR, OP_LEAVE_ROOM, OP_ROOM_DATA,
      OP_ROOM_STATE, OP_ROOM_STATE_PATCH, OP_ROOM_DATA_SCHEMA,
    ]).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect(COLYSEUS_OPCODE[OP_JOIN_ROOM]).toBe('JOIN_ROOM');
    expect(COLYSEUS_OPCODE[OP_ROOM_DATA]).toBe('ROOM_DATA');
    expect(COLYSEUS_OPCODE[OP_ROOM_DATA_SCHEMA]).toBe('ROOM_DATA_SCHEMA');
  });
});

describe('endpoint do jogo', () => {
  it('mapeia a origem para /rt em http e ws', () => {
    const ep = endpointFromOrigin('https://baiakidle.com');
    expect(ep.http).toBe('https://baiakidle.com/rt');
    expect(ep.ws).toBe('wss://baiakidle.com/rt');
    expect(ep.origin).toBe('https://baiakidle.com');
  });

  it('preserva porta quando a origem tem porta explícita', () => {
    expect(endpointFromOrigin('http://localhost:3000').ws).toBe('ws://localhost:3000/rt');
  });
});

describe('matchmake', () => {
  it('POSTa em /rt/matchmake/{metodo}/{sala} e devolve o seat', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push({ url, init });
      return {
        status: 200,
        text: async () => JSON.stringify({
          room: { roomId: 'abc', processId: 'p1', name: 'hunt' },
          sessionId: 's1',
          reconnectionToken: 'abc:r1',
        }),
      } as any;
    };

    const result = await matchmake('joinOrCreate', 'hunt', { token: 'T' }, {
      endpoint: endpointFromOrigin('https://baiakidle.com'),
    });

    expect(calls[0].url).toBe('https://baiakidle.com/rt/matchmake/joinOrCreate/hunt');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body)).toEqual({ token: 'T' });
    expect(result).toEqual({
      roomName: 'hunt', roomId: 'abc', processId: 'p1', sessionId: 's1', reconnectionToken: 'abc:r1',
    });
  });

  it('erro do servidor vira MatchmakeError com code (IP_LIMIT/maintenance)', async () => {
    (globalThis as any).fetch = async () => ({
      status: 200,
      text: async () => JSON.stringify({ error: 'IP_LIMIT', code: 4290 }),
    }) as any;

    expect(
      matchmake('joinOrCreate', 'hunt', {}, { endpoint: endpointFromOrigin() }),
    ).rejects.toBeInstanceOf(MatchmakeError);
  });

  it('resposta sem roomId é tratada como erro, não como sala válida', async () => {
    (globalThis as any).fetch = async () => ({ status: 200, text: async () => '{}' }) as any;
    expect(
      matchmake('joinOrCreate', 'hunt', {}, { endpoint: endpointFromOrigin() }),
    ).rejects.toThrow(/roomId/);
  });
});

describe('sala Colyseus headless', () => {
  it('faz o handshake: responde 0x0A ao JOIN_ROOM e captura serializer', async () => {
    (globalThis as any).WebSocket = FakeWS;
    const opened = Room.open({ seat: seat(), endpoint: endpointFromOrigin(), log: () => {} });

    const ws = FakeWS.last!;
    expect(ws.url).toBe('wss://baiakidle.com/rt/proc-1/room-1?sessionId=sess-1');
    ws.emit('open', {});
    ws.message(joinFrame('tok', 'schema'));

    const room = await opened;
    expect(room.joined).toBe(true);
    expect(room.serializerId).toBe('schema');
    expect(room.reconnectionToken).toBe('room-1:tok');
    expect(Array.from(ws.sent[0])).toEqual([0x0a]);
  });

  it('entrega ROOM_DATA por tipo e conta frames de estado', async () => {
    (globalThis as any).WebSocket = FakeWS;
    const opened = Room.open({ seat: seat(), endpoint: endpointFromOrigin(), log: () => {} });
    const ws = FakeWS.last!;
    ws.emit('open', {});
    ws.message(joinFrame('tok', 'schema'));
    const room = await opened;

    const got: any[] = [];
    room.on('stage', (p: any) => got.push(p));
    room.on('combatlog', () => {});

    ws.message(encodeRoomData('stage', { huntId: 'dragon-lair' }));
    ws.message(encodeRoomData('combatlog', [{ killed: true }]));
    ws.message(Uint8Array.of(0x0e, 0x01, 0x02, 0x03));
    ws.message(Uint8Array.of(0x0f, 0x01));

    expect(got).toEqual([{ huntId: 'dragon-lair' }]);
    expect(room.stats.roomData).toBe(2);
    expect(room.stats.roomState).toBe(2);
    expect(room.lastFrameAt).toBeGreaterThan(0);
  });

  it('send() escreve um único frame ROOM_DATA (igual ao room.send do jogo)', async () => {
    (globalThis as any).WebSocket = FakeWS;
    const opened = Room.open({ seat: seat(), endpoint: endpointFromOrigin(), log: () => {} });
    const ws = FakeWS.last!;
    ws.emit('open', {});
    ws.message(joinFrame('tok', 'schema'));
    const room = await opened;

    expect(room.send('mode', { mode: 'hunt' })).toBe(true);
    expect(room.send('stage', { huntId: 'glooth-cave' })).toBe(true);
    expect(ws.sent).toHaveLength(3); // 0x0A do handshake + 2 pacotes

    const stage = decodeFrame(ws.sent[2]);
    expect(stage?.type).toBe('stage');
    expect(stage?.payload).toEqual({ huntId: 'glooth-cave' });
  });

  it('usa publicAddress do matchmake na URL do socket (senão a reserva falha)', async () => {
    (globalThis as any).WebSocket = FakeWS;
    (globalThis as any).fetch = async () => ({
      status: 200,
      text: async () => JSON.stringify({
        room: {
          roomId: 'abc', processId: 'p1', name: 'hunt',
          publicAddress: 'rt3.baiakidle.com/rt3-59',
        },
        sessionId: 's1',
      }),
    }) as any;

    const got = await matchmake('joinOrCreate', 'hunt', {}, { endpoint: endpointFromOrigin() });
    expect(got.publicAddress).toBe('rt3.baiakidle.com/rt3-59');

    const opened = Room.open({ seat: got, endpoint: endpointFromOrigin(), log: () => {} });
    expect(FakeWS.last!.url).toBe('wss://rt3.baiakidle.com/rt3-59/p1/abc?sessionId=s1');
    FakeWS.last!.emit('open', {});
    FakeWS.last!.message(joinFrame('tok', 'schema'));
    await opened;
  });

  it('sem publicAddress cai no host do endpoint', async () => {
    (globalThis as any).WebSocket = FakeWS;
    const opened = Room.open({ seat: seat(), endpoint: endpointFromOrigin(), log: () => {} });
    expect(FakeWS.last!.url).toBe('wss://baiakidle.com/rt/proc-1/room-1?sessionId=sess-1');
    FakeWS.last!.emit('open', {});
    FakeWS.last!.message(joinFrame('tok', 'schema'));
    await opened;
  });

  it('frame ERROR da sala propaga code e mensagem', async () => {
    (globalThis as any).WebSocket = FakeWS;
    const opened = Room.open({ seat: seat(), endpoint: endpointFromOrigin(), log: () => {} });
    const ws = FakeWS.last!;
    ws.emit('open', {});
    ws.message(joinFrame('tok', 'schema'));
    const room = await opened;

    const errors: any[] = [];
    room.on('__error', (e: any) => errors.push(e));
    ws.message(Uint8Array.of(0x0b, ...encodeMsgpackPair(4294, 'BOSS_ACTIVE')));

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(4294);
    expect(errors[0].message).toBe('BOSS_ACTIVE');
  });

  it('waitFor resolve no primeiro pacote do tipo', async () => {
    (globalThis as any).WebSocket = FakeWS;
    const opened = Room.open({ seat: seat(), endpoint: endpointFromOrigin(), log: () => {} });
    const ws = FakeWS.last!;
    ws.emit('open', {});
    ws.message(joinFrame('tok', 'schema'));
    const room = await opened;

    const pending = room.waitFor<any>('go', 2_000);
    ws.message(encodeRoomData('go', { token: 'admit-123' }));
    expect(await pending).toEqual({ token: 'admit-123' });
  });

  it('waitFor estoura no timeout em vez de ficar pendurado', async () => {
    (globalThis as any).WebSocket = FakeWS;
    const opened = Room.open({ seat: seat(), endpoint: endpointFromOrigin(), log: () => {} });
    const ws = FakeWS.last!;
    ws.emit('open', {});
    ws.message(joinFrame('tok', 'schema'));
    const room = await opened;

    expect(room.waitFor('go', 30)).rejects.toThrow(/timeout/);
  });

  it('reconnect divide "roomId:token" e manda só o token no body', async () => {
    (globalThis as any).WebSocket = FakeWS;
    const calls: Array<{ url: string; init: any }> = [];
    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push({ url, init });
      return {
        status: 200,
        text: async () => JSON.stringify({
          room: { roomId: 'room-1', processId: 'proc-1', name: 'hunt' },
          sessionId: 'sess-2',
          reconnectionToken: 'room-1:tok2',
        }),
      } as any;
    };

    const opened = Room.open({ seat: seat(), endpoint: endpointFromOrigin(), log: () => {} });
    const ws = FakeWS.last!;
    ws.emit('open', {});
    ws.message(joinFrame('tok', 'schema'));
    const room = await opened;

    const back = Room.reconnect(room);
    await new Promise((r) => setTimeout(r, 0)); // deixa o fetch do matchmake resolver
    const ws2 = FakeWS.last!;
    expect(ws2).not.toBe(ws);
    ws2.emit('open', {});
    ws2.message(joinFrame('tok', 'schema'));
    const room2 = await back;

    expect(calls[0].url).toBe('https://baiakidle.com/rt/matchmake/reconnect/room-1');
    expect(JSON.parse(calls[0].init.body)).toEqual({ reconnectionToken: 'tok' });
    expect(room2.roomId).toBe('room-1');
  });
});

describe('body do join da hunt', () => {
  const opts = () => ({
    token: 'T', characterId: 7, fp: 'dev-1234abcd', ext: [], disabled: false,
    endpoint: endpointFromOrigin(), log: () => {},
  });

  it('join direto leva token/characterId/fp/ext/disabled', async () => {
    const calls: any[] = [];
    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push({ url, init });
      throw new Error('parar aqui');
    };

    await expect(openHuntOnce(opts())).rejects.toThrow('parar aqui');
    const body = JSON.parse(calls[0].init.body);
    expect(body).toEqual({ token: 'T', characterId: 7, fp: 'dev-1234abcd', ext: [], disabled: false });
  });

  it('com admitToken o ext some, como no jogo', async () => {
    const calls: any[] = [];
    (globalThis as any).fetch = async (url: string, init: any) => {
      calls.push({ url, init });
      throw new Error('parar aqui');
    };

    await expect(openHuntOnce(opts(), 'adm-9')).rejects.toThrow('parar aqui');
    const body = JSON.parse(calls[0].init.body);
    expect(body).toEqual({ token: 'T', characterId: 7, fp: 'dev-1234abcd', disabled: false, admitToken: 'adm-9' });
    expect(body.ext).toBeUndefined();
  });
});

describe('classificação de erro de join', () => {
  const cases: Array<[number, string, string]> = [
    [4294, 'BOSS_ACTIVE', 'boss'],
    [4290, 'IP_LIMIT', 'ip'],
    [4295, 'EXT_BLOCK', 'maintenance'],
    [401, 'sessão inválida', 'auth'],
    [30736, 'sessão inválida', 'auth'],
    [30736, '', 'auth'],
    [4210, 'MATCHMAKE_NO_HANDLER', 'unknown'],
    [4293, 'PARTY_QUEUE_FULL', 'unknown'],
    [0, 'entrar na fila primeiro', 'queue'],
    [0, 'Aguarde sua vez para entrar na hunt.', 'queue'],
    [0, 'Aguarde sua vez.', 'queue'],
    [0, 'seat reservation expired.', 'seat'],
  ];

  for (const [code, msg, expected] of cases) {
    it(`code=${code} "${msg}" -> ${expected}`, () => {
      expect(classifyJoinError({ code, message: msg })).toBe(expected as any);
    });
  }
});

describe('escolha de hunt e fingerprint', () => {
  it('pickHuntForLevel usa a maior hunt da tabela que o nível aguenta', () => {
    expect(pickHuntForLevel(1)).toBe('troll-cave');
    expect(pickHuntForLevel(12)).toBe('minotaur');
    expect(pickHuntForLevel(205)).toBe('undeadragon-lair');
    expect(pickHuntForLevel(0)).toBeNull();
  });

  it('yt() é o djb2 de 8 chars do bundle', () => {
    expect(yt('')).toBe('00001505');
    expect(yt('a')).toHaveLength(8);
  });

  it('buildFingerprint tem o formato deviceId-hash do jogo', () => {
    const deviceId = newDeviceId();
    expect(deviceId).toHaveLength(32);
    const env = defaultEnv({ userAgent: 'UA/1.0', screenWidth: 800, screenHeight: 600, colorDepth: 24, timezoneOffsetMin: 0, language: 'pt-BR' });
    const fp = buildFingerprint(deviceId, env);
    expect(fp).toBe(`${deviceId}-${yt('UA/1.0|800|600|24|0|pt-BR')}`);
  });

  it('buildExt normaliza a lista anti-patch (vazia no terminal)', () => {
    expect(buildExt([])).toEqual([]);
    expect(buildExt(['P:WS.CTOR', 'p:fetch', 'p:fetch', 'x'.repeat(50)])).toEqual(['p:fetch', 'p:ws.ctor']);
  });
});