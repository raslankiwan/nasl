import { en, type Catalogue } from './locales/en.ts';
import { ar } from './locales/ar.ts';

export { en, ar };
export type { Catalogue };

// ---------------------------------------------------------------------------
// Locales
// ---------------------------------------------------------------------------

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Arabic leads. The product is Arabic-first; English is the accommodation. */
export const DEFAULT_LOCALE: Locale = 'ar';

export type Direction = 'rtl' | 'ltr';

export interface LocaleMeta {
  /** The language's name in English, for our own tooling. */
  label: string;
  /** The language's name in itself — what a language switcher must show. */
  nativeLabel: string;
  dir: Direction;
  /** BCP-47 tag used for Intl date and number formatting. */
  bcp47: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  ar: { label: 'Arabic', nativeLabel: 'العربية', dir: 'rtl', bcp47: 'ar' },
  en: { label: 'English', nativeLabel: 'English', dir: 'ltr', bcp47: 'en' },
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function isRTL(locale: Locale): boolean {
  return LOCALE_META[locale].dir === 'rtl';
}

export function dirFor(locale: Locale): Direction {
  return LOCALE_META[locale].dir;
}

/**
 * Pick the best supported locale from an ordered list of user preferences
 * (`expo-localization` on device, `navigator.languages` in the browser).
 * Matches on the primary subtag, so `ar-SA`, `ar-EG` and `ar` all resolve to Arabic.
 */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const primary = tag.split('-')[0]?.toLowerCase();
    if (primary && isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/** The other locale — a two-language switcher is a toggle, not a menu. */
export function otherLocale(locale: Locale): Locale {
  return locale === 'ar' ? 'en' : 'ar';
}

// ---------------------------------------------------------------------------
// i18next wiring
// ---------------------------------------------------------------------------

export const NAMESPACES = Object.keys(en) as (keyof Catalogue)[];
export const DEFAULT_NAMESPACE: keyof Catalogue = 'common';

/** Resource bundle in i18next's `{ locale: { namespace: keys } }` shape. */
export const resources = { ar, en } as const;

/**
 * Options shared by both clients. Each app spreads these into its own `i18n.init`, adding only
 * the parts that differ — how it detects the device language and how it persists a change.
 */
export const baseI18nOptions = {
  resources,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: LOCALES,
  ns: NAMESPACES,
  defaultNS: DEFAULT_NAMESPACE,
  // React already escapes. Double-escaping mangles Arabic punctuation.
  interpolation: { escapeValue: false },
  returnNull: false,
} as const;

/** Storage key both apps use to remember an explicit language choice. */
export const LOCALE_STORAGE_KEY = 'nasl.locale';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a number for display. Arabic readers differ on numerals — Gulf users generally expect
 * Western digits for tag numbers and weights — so Eastern Arabic-Indic digits are opt-in (NFR-06).
 */
export function formatNumber(
  value: number,
  locale: Locale,
  options: { easternDigits?: boolean } & Intl.NumberFormatOptions = {},
): string {
  const { easternDigits = false, ...intlOptions } = options;
  const tag =
    locale === 'ar' && easternDigits ? 'ar-u-nu-arab' : `${LOCALE_META[locale].bcp47}-u-nu-latn`;
  return new Intl.NumberFormat(tag, intlOptions).format(value);
}

/** Format a calendar date in the Gregorian calendar. */
export function formatDate(
  date: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(`${LOCALE_META[locale].bcp47}-u-nu-latn`, {
    timeZone: 'UTC',
    ...options,
  }).format(date);
}

/**
 * Format a calendar date in the Umm al-Qura Hijri calendar (scope FR-LOC-01).
 * Every date in the product is available in both calendars; the user chooses which leads.
 */
export function formatHijriDate(
  date: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(`${LOCALE_META[locale].bcp47}-u-ca-islamic-umalqura-nu-latn`, {
    timeZone: 'UTC',
    ...options,
  }).format(date);
}
