import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { editNumberEntry, parseNumberEntry } from './numberEntry.ts';

const weight = { min: 0.5, max: 200, decimals: 2 };
describe('manual number entry', () => {
  test('accepts exact decimals independently of the stepper increment', () => {
    for (const text of ['42.35', '٤٢٫٣٥', '۴۲٫۳۵', '42,35', ' 42.35 ']) {
      assert.deepEqual(parseNumberEntry(text, weight), { valid: true, value: 42.35 });
    }
    assert.deepEqual(parseNumberEntry('.5', weight), { valid: true, value: 0.5 });
    assert.deepEqual(parseNumberEntry('42.', weight), { valid: true, value: 42 });
    assert.deepEqual(parseNumberEntry('200', weight), { valid: true, value: 200 });
  });
  test('invalid and out-of-range entries are rejected rather than silently changed', () => {
    for (const text of ['abc', '4kg', '1e2', 'Infinity', '4..2', '1 000', '1,000.50', '.', '-']) {
      assert.equal(parseNumberEntry(text, weight).valid, false, text);
    }
    for (const text of ['0.4', '-42', '200.01', '999999999999999999999999']) {
      assert.deepEqual(parseNumberEntry(text, weight), { valid: false, error: 'numberRange' });
    }
    assert.deepEqual(parseNumberEntry('42.356', weight), {
      valid: false,
      error: 'numberPrecision',
    });
    assert.equal(
      parseNumberEntry('1,000', weight).valid,
      false,
      'ambiguous grouped numbers are not read as 1',
    );
  });
  test('counts require whole numbers and stay within their own bounds', () => {
    const count = { min: 1, max: 4, decimals: 0, optional: true };
    assert.deepEqual(parseNumberEntry('٣', count), { valid: true, value: 3 });
    assert.deepEqual(parseNumberEntry('2.5', count), { valid: false, error: 'numberInteger' });
    assert.deepEqual(parseNumberEntry('5', count), { valid: false, error: 'numberRange' });
  });
  test('clearing an optional number does not turn it into zero', () => {
    assert.deepEqual(parseNumberEntry('', weight), { valid: false, error: 'numberRequired' });
    assert.deepEqual(parseNumberEntry('', { ...weight, optional: true }), {
      valid: true,
      value: null,
    });
    assert.deepEqual(parseNumberEntry('0', { min: 0, max: 100000, decimals: 2 }), {
      valid: true,
      value: 0,
    });
  });
  test('keypad replaces the selected value, inserts at the caret and backspaces a selection', () => {
    assert.deepEqual(editNumberEntry('50', { start: 0, end: 2 }, '4'), {
      text: '4',
      selection: { start: 1, end: 1 },
    });
    assert.deepEqual(editNumberEntry('425', { start: 2, end: 2 }, '.'), {
      text: '42.5',
      selection: { start: 3, end: 3 },
    });
    assert.equal(editNumberEntry('42.5', { start: 4, end: 4 }, 'backspace').text, '42.');
    assert.equal(editNumberEntry('42.5', { start: 0, end: 4 }, 'backspace').text, '');
    assert.equal(editNumberEntry('42.5', { start: 0, end: 0 }, 'backspace').text, '42.5');
  });
});
