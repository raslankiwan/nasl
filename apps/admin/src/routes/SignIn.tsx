import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MAX_LENGTH } from '@nasl/shared';
import { passkeysAvailable } from '../auth/passkeys';
import { LanguageToggle } from '../components/LanguageToggle';
import { ApiError } from '../api/client';
import { AppPreferences } from '../components/AppPreferences';

export function SignIn({
  signIn,
  signInWithPasskey,
}: {
  signInWithPasskey?: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<void>;
}) {
  const { t } = useTranslation(['auth', 'common', 'admin']);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    void passkeysAvailable().then(setAvailable);
  }, []);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier.trim(), password);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? t(`auth:errors.${err.code}`, { defaultValue: t('common:errorRetry') })
          : t('common:errorRetry'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="signin">
      <div className="card">
        <div className="top">
          <div>
            <h1>{t('auth:signIn')}</h1>
            <p className="sub">{t('admin:inviteOnly')}</p>
          </div>
          <LanguageToggle />
        </div>
        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            <div className="field">
              <label htmlFor="identifier">{t('auth:identifier')}</label>
              <input
                id="identifier"
                dir="ltr"
                autoComplete="username"
                autoCapitalize="none"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                maxLength={254}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">{t('auth:password')}</label>
              <input
                id="password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={PASSWORD_MAX_LENGTH}
                required
              />
            </div>
            <button className="primary" type="submit" disabled={busy}>
              {t(busy ? 'common:loading' : 'auth:signIn')}
            </button>
          </fieldset>
        </form>
        {available && signInWithPasskey ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void (async () => {
                if (busy) return;
                setBusy(true);
                setError(null);
                try {
                  await signInWithPasskey();
                } catch {
                  setError(t('auth:passkeyError'));
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            {t('auth:passkeySignIn')}
          </button>
        ) : null}
        <AppPreferences />
      </div>
    </div>
  );
}
