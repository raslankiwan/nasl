/**
 * CSV that Excel will actually open correctly.
 *
 * Two details decide whether an Arabic export is usable or garbage:
 *
 *  - **The byte-order mark.** Without a leading UTF-8 BOM, Excel on Windows reads the file in the
 *    system codepage and every Arabic name becomes mojibake. Nothing else in the file matters if
 *    the herder opens it and sees `Ù†Ø¹Ø¬Ø©`.
 *  - **Formula injection.** A cell starting with `=`, `+`, `-` or `@` is executed as a formula by
 *    Excel. Tag numbers and free-text notes come from users, so every such cell is prefixed with a
 *    tab, which Excel strips on display but will not evaluate.
 */

export const UTF8_BOM = '﻿';

// A tab is in here because the formula guard below inserts one, and a defused cell should be
// quoted so no reader can mistake the guard for content.
const NEEDS_QUOTING = /[",\n\r\t]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);

  // Defuse before quoting, so the guard character ends up inside the quotes.
  if (FORMULA_START.test(text)) text = `\t${text}`;

  if (NEEDS_QUOTING.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsvRow(values: readonly unknown[]): string {
  return values.map(escapeCell).join(',');
}

/**
 * Build a whole CSV document. `\r\n` line endings because that is what Excel expects and what
 * every other reader tolerates.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return UTF8_BOM + [toCsvRow(headers), ...rows.map(toCsvRow)].join('\r\n') + '\r\n';
}
