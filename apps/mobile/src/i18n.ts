import { I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  baseI18nOptions,
  DEFAULT_LOCALE,
  isLocale,
  isRTL,
  LOCALE_STORAGE_KEY,
  type Locale,
} from '@nasl/i18n';

/**
 * Language on device.
 *
 * React Native lays out `start`/`end` from a single process-wide flag, `I18nManager.isRTL`, which
 * only takes effect after the app restarts. So switching between Arabic and English is not a
 * re-render — it is a restart. Everything here exists to make that restart happen once, cleanly,
 * and never in the middle of a screen.
 */

export async function readStoredLocale(): Promise<Locale | null> {
  try {
    const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
    return stored && isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * The locale to open in.
 *
 * An explicit choice always wins; absent one we open in Arabic rather than following the device
 * language. Phones in this market are routinely configured in English by people who read Arabic,
 * so device language is a poor proxy for reading preference. The settings screen names the other
 * language in its own script, so an English reader can always leave.
 */
export async function preferredLocale(): Promise<Locale> {
  return (await readStoredLocale()) ?? DEFAULT_LOCALE;
}

/** True when the native layout direction already matches the locale. */
export function directionMatches(locale: Locale): boolean {
  return I18nManager.isRTL === isRTL(locale);
}

/**
 * Align the native layout direction with the locale.
 * Returns whether a restart is required for it to take effect.
 */
export function applyDirection(locale: Locale): boolean {
  const wantRTL = isRTL(locale);

  if (Platform.OS === 'web') {
    // react-native-web reads the document, and it applies immediately — no restart needed.
    if (typeof document !== 'undefined') {
      document.documentElement.dir = wantRTL ? 'rtl' : 'ltr';
      document.documentElement.lang = locale;
    }
    return false;
  }

  if (directionMatches(locale)) return false;

  I18nManager.allowRTL(wantRTL);
  I18nManager.forceRTL(wantRTL);
  return true;
}

export async function initI18n(): Promise<Locale> {
  const locale = await preferredLocale();
  applyDirection(locale);
  await i18next.use(initReactI18next).init({ ...baseI18nOptions, lng: locale });
  return locale;
}

/**
 * Switch language.
 *
 * When the direction changes the app must restart for React Native to lay out the other way, so
 * the caller is told to warn the user first rather than having the app vanish under their hands.
 */
export async function setLocale(locale: Locale): Promise<{ restarted: boolean }> {
  try {
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Not being able to remember the choice is no reason to refuse to make it.
  }

  const needsRestart = applyDirection(locale);
  await i18next.changeLanguage(locale);

  if (!needsRestart) return { restarted: false };

  try {
    await Updates.reloadAsync();
    return { restarted: true };
  } catch {
    // reloadAsync is unavailable in Expo Go and in dev; the flag is stored either way, so the
    // next launch comes up in the right direction.
    return { restarted: false };
  }
}

export { i18next };
