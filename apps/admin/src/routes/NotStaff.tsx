import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../components/LanguageToggle';

/**
 * A signed-in farm user who reached the console. The API already answers 404 to everything here;
 * this is the human version of the same answer.
 */
export function NotStaff({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useTranslation(['admin', 'auth']);

  return (
    <div className="signin">
      <div className="card">
        <div className="top">
          <h1>{t('admin:title')}</h1>
          <LanguageToggle />
        </div>
        <p className="sub">{t('admin:staffOnly')}</p>
        <button type="button" onClick={onSignOut}>
          {t('auth:signOut')}
        </button>
      </div>
    </div>
  );
}
