import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCell, toCsv, UTF8_BOM } from './csv.ts';

describe('csv cells', () => {
  test('plain values pass through', () => {
    assert.equal(escapeCell('1001'), '1001');
    assert.equal(escapeCell(42), '42');
    assert.equal(escapeCell('غزال'), 'غزال');
  });

  test('empty and missing become an empty cell, not "null"', () => {
    assert.equal(escapeCell(null), '');
    assert.equal(escapeCell(undefined), '');
  });

  test('a comma, quote or newline forces quoting', () => {
    assert.equal(escapeCell('Najdi, Awassi'), '"Najdi, Awassi"');
    assert.equal(escapeCell('say "hello"'), '"say ""hello"""');
    assert.equal(escapeCell('line one\nline two'), '"line one\nline two"');
  });

  test('a cell that Excel would execute as a formula is defused', () => {
    // A tag number entered as "=1001" would otherwise run as a formula on open.
    assert.equal(escapeCell('=1+1'), '"\t=1+1"');
    assert.equal(escapeCell('+SUM(A1)'), '"\t+SUM(A1)"');
    assert.equal(escapeCell('-2'), '"\t-2"');
    assert.equal(escapeCell('@cmd'), '"\t@cmd"');
  });

  test('a date becomes a plain calendar date', () => {
    assert.equal(escapeCell(new Date('2026-06-01T12:00:00.000Z')), '2026-06-01');
  });
});

describe('csv documents', () => {
  test('the file begins with a byte-order mark, or Excel mangles the Arabic', () => {
    const csv = toCsv(['رقم الأذن'], [['1001']]);
    assert.ok(csv.startsWith(UTF8_BOM), 'without this every Arabic name opens as mojibake');
  });

  test('rows are separated by CRLF and the file ends with one', () => {
    const csv = toCsv(
      ['a', 'b'],
      [
        ['1', '2'],
        ['3', '4'],
      ],
    );
    assert.equal(csv, `${UTF8_BOM}a,b\r\n1,2\r\n3,4\r\n`);
  });

  test('an export with no rows is still a valid file with its headers', () => {
    assert.equal(toCsv(['a', 'b'], []), `${UTF8_BOM}a,b\r\n`);
  });
});
