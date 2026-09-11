import { beforeEach, describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LOCALE_STORAGE_KEY } from '@nasl/i18n';
import { LanguageToggle } from './components/LanguageToggle';
import { initI18n, i18next, preferredLocale, setLocale } from './i18n';

/**
 * The language switch is a product requirement, not a nicety: an Arabic-first app that cannot be
 * read in English by a hired shepherd, or vice versa, has failed. These tests hold the contract.
 */

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.lang = '';
  document.documentElement.dir = '';
  await initI18n('ar');
});

describe('locale preference', () => {
  test('Arabic is the default when nothing is stored', () => {
    expect(preferredLocale()).toBe('ar');
  });

  test('an explicit choice wins', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(preferredLocale()).toBe('en');
  });

  test('a stored value that is not a locale is ignored', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    expect(preferredLocale()).toBe('ar');
  });

  test('an English device does not override the Arabic default', () => {
    // jsdom reports en-US. Phones in this market are routinely set to English by people who
    // read Arabic, so device language must not decide this — only an explicit choice does.
    expect(navigator.language.startsWith('en')).toBe(true);
    expect(preferredLocale()).toBe('ar');
  });
});

describe('document direction', () => {
  test('Arabic sets the document to RTL', async () => {
    await setLocale('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  test('English sets the document to LTR', async () => {
    await setLocale('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('the language toggle', () => {
  test('offers the other language, named in its own script', async () => {
    render(<LanguageToggle />);
    expect(screen.getByRole('button')).toHaveTextContent('English');
  });

  test('switching flips the language, the direction and the label', async () => {
    const user = userEvent.setup();
    render(<LanguageToggle />);

    await user.click(screen.getByRole('button'));

    expect(i18next.resolvedLanguage).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.getByRole('button')).toHaveTextContent('العربية');

    await user.click(screen.getByRole('button'));

    expect(i18next.resolvedLanguage).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('button')).toHaveTextContent('English');
  });

  test('the choice is remembered', async () => {
    const user = userEvent.setup();
    render(<LanguageToggle />);
    await user.click(screen.getByRole('button'));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  test('translated copy actually changes', async () => {
    expect(i18next.t('admin:withdrawalWarning')).toContain('فترات الأمان');
    await setLocale('en');
    expect(i18next.t('admin:withdrawalWarning')).toContain('manufacturer datasheets');
  });
});
