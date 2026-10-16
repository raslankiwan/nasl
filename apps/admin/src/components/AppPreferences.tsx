import { useState, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppearance } from '../appearance';

type InstallWindow = Window & {
  naslInstall?: { installed: boolean; prompt?: () => Promise<void> };
};

export function AppPreferences() {
  const { t } = useTranslation('common');
  const { preference, setPreference } = useAppearance();
  const id = useId();
  const [installed, setInstalled] = useState(false);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    const sync = () => setInstalled(Boolean((window as InstallWindow).naslInstall?.installed));
    sync();
    window.addEventListener('nasl-install-change', sync);
    return () => window.removeEventListener('nasl-install-change', sync);
  }, []);
  const install = async () => {
    const prompt = (window as InstallWindow).naslInstall?.prompt;
    if (prompt) await prompt().catch(() => setHint(true));
    else setHint((value) => !value);
  };
  return (
    <div className="app-preferences">
      <label htmlFor={id}>{t('appearance')}</label>
      <select
        id={id}
        value={preference}
        onChange={(event) => setPreference(event.target.value as typeof preference)}
      >
        <option value="system">{t('themeSystem')}</option>
        <option value="light">{t('themeLight')}</option>
        <option value="dark">{t('themeDark')}</option>
      </select>
      {!installed && (
        <button type="button" onClick={() => void install()}>
          {t('installApp')}
        </button>
      )}
      {hint && (
        <p role="status" className="install-hint">
          {t('installHint')}
        </p>
      )}
    </div>
  );
}
