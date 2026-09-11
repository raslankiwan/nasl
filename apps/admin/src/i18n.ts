import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  baseI18nOptions,
  DEFAULT_LOCALE,
  dirFor,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from '@nasl/i18n';

/**
 * Language for the console.
 *
 * Two rules the rest of the app depends on:
 *  - `dir` and `lang` live on <html>, set from the locale, so every layout uses logical properties
 *    and nothing has to know which direction it is in.
 *  - The document is updated *before* React mounts, so the first paint is already correct and the
 *    page never flips direction in front of the user.
 */

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored && isLocale(stored) ? stored : null;
  } catch {
    // Private browsing, or storage disabled. Fall back to the browser's languages.
    return null;
  }
}

function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Not being able to remember the choice is not a reason to refuse to make it.
  }
}

/**
 * The locale to open in.
 *
 * An explicit choice always wins. Absent one we open in Arabic rather than following the device
 * language, which is a deliberate departure from the usual convention: phones in this market are
 * routinely configured in English by people who read Arabic, so device language is a poor proxy
 * for reading preference and following it would hand most of the audience an English-first app.
 * The toggle names the other language in its own script, so an English reader can always leave.
 *
 * `resolveLocale` remains the right helper wherever device detection *is* wanted.
 */
export function preferredLocale(): Locale {
  return readStoredLocale() ?? DEFAULT_LOCALE;
}

export function applyDocumentLocale(locale: Locale): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = dirFor(locale);
}

export async function initI18n(locale: Locale = preferredLocale()) {
  applyDocumentLocale(locale);
  await i18next.use(initReactI18next).init({ ...baseI18nOptions, lng: locale });
  return i18next;
}

export async function setLocale(locale: Locale): Promise<void> {
  persistLocale(locale);
  applyDocumentLocale(locale);
  await i18next.changeLanguage(locale);
}

export { i18next };
