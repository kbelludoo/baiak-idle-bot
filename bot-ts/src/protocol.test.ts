import { expect, test } from 'bun:test';
import { decodeBaiakFrame, digLevel } from './protocol';

test('decodes Baiak 0x0D combatlog msgpack frame', () => {
  const msg = Buffer.concat([
    Buffer.from([0x0d, 0xa9]), Buffer.from('combatlog'),
    Buffer.from([0x81, 0xa6]), Buffer.from('killed'), Buffer.from([0xc3]),
  ]);
  const frame = decodeBaiakFrame({ opcode: 2, payloadData: msg.toString('base64') });
  expect(frame?.type).toBe('combatlog');
  expect((frame?.payload as any).killed).toBe(true);
});

test('finds nested player level', () => {
  expect(digLevel({ player: { level: 52 } })).toBe(52);
});
