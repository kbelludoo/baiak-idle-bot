import { describe, test, expect } from 'bun:test';
import { decodeFrame, encodeRoomData } from '../src/protocol';
import { normalizeChars } from '../src/trpc';
import { ActionQueue } from '../src/state_machine';
import { TelemetryStore } from '../src/telemetry';

describe('Correções do motor (room-send / queue-flow / lanes)', () => {
  test('encodeRoomData/decodeFrame roundtrip byte-idêntico ao stage-go', () => {
    const bytes = encodeRoomData('stage', { huntId: 'crypt' });
    expect(bytes[0]).toBe(0x0d);
    const fr = decodeFrame(bytes);
    expect(fr?.opcode).toBe(13);
    expect(fr?.frame).toBe('ROOM_DATA');
    expect(fr?.type).toBe('stage');
    expect((fr?.payload as any)?.huntId).toBe('crypt');
  });

  test('ROOM_STATE/PATCH nunca são descartados (watchdog state-aware)', () => {
    expect(decodeFrame(new Uint8Array([14, 1, 2]))?.frame).toBe('ROOM_STATE');
    expect(decodeFrame(new Uint8Array([15, 9]))?.frame).toBe('ROOM_STATE_PATCH');
  });

  test('queue-flow pos/go/joined/toHunt atualiza telemetria', () => {
    const t = new TelemetryStore();
    t.ingestWebSocketFrame('pos', { position: 3 });
    expect(t.queueFlow.pos).toBe(3);
    t.ingestWebSocketFrame('go', { token: 'admit-123' });
    expect(t.queueFlow.admitToken).toBe('admit-123');
    t.ingestWebSocketFrame('joined', { huntId: 'crypt', wave: 5 });
    expect(t.hunt).toBe('crypt');
    t.ingestWebSocketFrame('toHunt', 'crypt');
    expect(t.hunt).toBe('crypt');
  });

  test('party autoritativa expõe HP/MP por slot e aceita level 700', () => {
    const t = new TelemetryStore();
    t.ingestWebSocketFrame('party', {
      players: [{ slot: 0, name: 'A', level: 700, vocation: 'knight', hp: 500, maxHp: 1000, mana: 200, maxMana: 400, alive: true }],
    });
    expect(t.level).toBe(700);
    expect(t.roomPlayers[0]?.hpPct).toBe(50);
    expect(t.roomPlayers[0]?.manaPct).toBe(50);
  });

  test('lanes: spell_picker não canibaliza spell_party nem extras', () => {
    const q = new ActionQueue();
    expect(q.enqueue({ id: 'spell_picker', name: 'spell', priority: 3, timeoutMs: 50, run: async () => {} })).toBe(true);
    expect(q.enqueue({ id: 'spell_party', name: 'spell', priority: 3, timeoutMs: 50, run: async () => {} })).toBe(true);
    expect(q.enqueue({ id: 'extras', name: 'extras', priority: 1, timeoutMs: 50, run: async () => {} })).toBe(true);
    // mesmo (lane,id) ainda dedupa
    expect(q.enqueue({ id: 'extras', name: 'extras', priority: 1, timeoutMs: 50, run: async () => {} })).toBe(false);
    expect(q.pendingByLane.gear).toBe(2);
  });

  test('normalizeChars aceita array plain', () => {
    const out = normalizeChars([{ id: 1, name: 'A', vocation: 'Knight', level: 300 }]);
    expect(out[0]?.vocation).toBe('knight');
    expect(out[0]?.level).toBe(300);
  });
});
