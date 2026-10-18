export interface NumberLimits {
  min: number;
  max: number;
  decimals: number;
  optional?: boolean;
}

export type NumberEntry =
  | { valid: true; value: number | null }
  | {
      valid: false;
      error:
        'numberRequired' | 'numberInvalid' | 'numberInteger' | 'numberPrecision' | 'numberRange';
    };

/** Accept local digits/decimal separators without stripping invalid content or rounding it away. */
export function parseNumberEntry(text: string, limits: NumberLimits): NumberEntry {
  const normalized = text
    .trim()
    .replace(/[\u200e\u200f\u061c]/g, '')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/[٫,]/g, '.');
  if (!normalized)
    return limits.optional
      ? { valid: true, value: null }
      : { valid: false, error: 'numberRequired' };
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized))
    return { valid: false, error: 'numberInvalid' };
  const fraction = normalized.split('.')[1] ?? '';
  if (fraction.length > limits.decimals)
    return { valid: false, error: limits.decimals === 0 ? 'numberInteger' : 'numberPrecision' };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { valid: false, error: 'numberInvalid' };
  if (value < limits.min || value > limits.max) return { valid: false, error: 'numberRange' };
  return { valid: true, value };
}

export interface NumberSelection {
  start: number;
  end: number;
}

/** The large keypad respects the same selection/caret as typing or pasting into the text field. */
export function editNumberEntry(
  text: string,
  selection: NumberSelection,
  insert: string | 'backspace',
) {
  let start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  if (insert === 'backspace' && start === end) start = Math.max(0, start - 1);
  const replacement = insert === 'backspace' ? '' : insert;
  const caret = start + replacement.length;
  return {
    text: text.slice(0, start) + replacement + text.slice(end),
    selection: { start: caret, end: caret },
  };
}
