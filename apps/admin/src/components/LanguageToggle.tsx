import { useTranslation } from 'react-i18next';
import { LOCALE_META, otherLocale, type Locale } from '@nasl/i18n';
import { setLocale } from '../i18n';

/**
 * With exactly two locales a switcher is a toggle, not a menu.
 *
 * The button shows the language you would switch *to*, named in its own script — a reader who
 * cannot read the current interface can still find their way out of it.
 */
export function LanguageToggle() {
  const { i18n, t } = useTranslation('common');
  const current = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const next = otherLocale(current);

  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={() => void setLocale(next)}
      aria-label={t('switchLanguage')}
      lang={next}
    >
      {LOCALE_META[next].nativeLabel}
    </button>
  );
}
