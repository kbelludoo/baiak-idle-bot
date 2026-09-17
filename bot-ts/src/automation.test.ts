import { expect, test } from 'bun:test';
import { staminaHasRecovered, staminaIsEmpty } from './automation';

test('stamina low threshold mirrors Python behavior', () => {
  expect(staminaIsEmpty('06:18')).toBe(true);
  expect(staminaIsEmpty('10:00')).toBe(false);
  expect(staminaIsEmpty('15%')).toBe(true);
});

test('stamina recovery threshold mirrors Python behavior', () => {
  expect(staminaHasRecovered('35:42')).toBe(true);
  expect(staminaHasRecovered('20:00')).toBe(false);
  expect(staminaHasRecovered('85%')).toBe(true);
});
