import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ar,
  DEFAULT_LOCALE,
  dirFor,
  en,
  formatDate,
  formatHijriDate,
  formatNumber,
  isRTL,
  LOCALE_META,
  LOCALES,
  otherLocale,
  resolveLocale,
} from './index.ts';

/** Every leaf path in a nested catalogue, as dotted keys. */
function leafKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leafKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('catalogue parity', () => {
  test('Arabic and English have exactly the same keys', () => {
    assert.deepEqual(leafKeys(ar).sort(), leafKeys(en).sort());
  });

  test('no Arabic value is left as its English source string', () => {
    const enLeaves = new Map(
      leafKeys(en).map((k) => [
        k,
        k.split('.').reduce<never>((o, p) => (o as never)[p], en as never),
      ]),
    );
    const untranslated = [...enLeaves].filter(([key, value]) => {
      const arValue = key.split('.').reduce<never>((o, p) => (o as never)[p], ar as never);
      // Latin-script brand and file-format names are meant to stay identical.
      const allowed = ['Nasl', 'PDF', 'Excel', 'English'];
      return arValue === value && !allowed.some((a) => String(value).includes(a));
    });
    assert.deepEqual(
      untranslated.map(([k]) => k),
      [],
    );
  });

  test('every value is a non-empty string', () => {
    for (const locale of [ar, en]) {
      for (const key of leafKeys(locale)) {
        const value = key.split('.').reduce<never>((o, p) => (o as never)[p], locale as never);
        assert.equal(typeof value, 'string', `${key} is not a string`);
        assert.ok(String(value).length > 0, `${key} is empty`);
      }
    }
  });

  test('interpolation placeholders match across locales', () => {
    const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const key of leafKeys(en)) {
      const e = String(key.split('.').reduce<never>((o, p) => (o as never)[p], en as never));
      const a = String(key.split('.').reduce<never>((o, p) => (o as never)[p], ar as never));
      assert.deepEqual(placeholders(a), placeholders(e), `placeholders differ at ${key}`);
    }
  });
});

describe('locale resolution', () => {
  test('Arabic is the default', () => {
    assert.equal(DEFAULT_LOCALE, 'ar');
    assert.equal(resolveLocale([]), 'ar');
  });

  test('regional Arabic tags all resolve to Arabic', () => {
    for (const tag of ['ar-SA', 'ar-EG', 'ar-AE', 'AR']) {
      assert.equal(resolveLocale([tag]), 'ar', tag);
    }
  });

  test('an unsupported language falls back to Arabic', () => {
    assert.equal(resolveLocale(['ur-PK', 'fr-FR']), 'ar');
  });

  test('the first supported preference wins', () => {
    assert.equal(resolveLocale(['ur-PK', 'en-GB', 'ar']), 'en');
  });

  test('the switcher toggles between exactly two locales', () => {
    assert.equal(otherLocale('ar'), 'en');
    assert.equal(otherLocale('en'), 'ar');
    assert.equal(LOCALES.length, 2);
  });

  test('every locale names itself in its own script', () => {
    assert.equal(LOCALE_META.ar.nativeLabel, 'العربية');
    assert.equal(LOCALE_META.en.nativeLabel, 'English');
  });

  test('direction is derived, never hard-coded per screen', () => {
    assert.equal(isRTL('ar'), true);
    assert.equal(dirFor('ar'), 'rtl');
    assert.equal(dirFor('en'), 'ltr');
  });
});

describe('formatting', () => {
  const date = new Date('2026-06-06T00:00:00.000Z');

  test('numbers use Western digits by default, even in Arabic', () => {
    assert.equal(formatNumber(147, 'ar'), '147');
    assert.equal(formatNumber(147, 'en'), '147');
  });

  test('Eastern Arabic-Indic digits are opt-in', () => {
    assert.equal(formatNumber(147, 'ar', { easternDigits: true }), '١٤٧');
  });

  test('dates render in both locales', () => {
    assert.match(formatDate(date, 'en'), /2026/);
    assert.match(formatDate(date, 'ar'), /2026/);
  });

  test('the Hijri calendar resolves to a different year than the Gregorian one', () => {
    const hijri = formatHijriDate(date, 'en');
    assert.match(hijri, /144[0-9]|145[0-9]/, `expected a Hijri year, got "${hijri}"`);
  });
});
