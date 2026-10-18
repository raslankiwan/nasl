import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, ApiError } from '../api/client';
import { addPasskey, passkeysAvailable } from '../auth/passkeys';
import { PageHead } from '../components/Layout';

export function Security() {
  const { t } = useTranslation(['auth', 'common']);
  const [available, setAvailable] = useState(false);
  const [keys, setKeys] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState(t('auth:thisDevice'));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => {
    setKeys((await apiClient.get<{ passkeys: typeof keys }>('/v1/auth/passkeys')).passkeys);
  };
  useEffect(() => {
    void passkeysAvailable().then(setAvailable);
    void load().catch(() => setMessage(t('common:errorRetry')));
  }, [t]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await work();
      await load();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? t(`auth:errors.${error.code}`, { defaultValue: t('auth:passkeyError') })
          : t('auth:passkeyError'),
      );
    } finally {
      setPassword('');
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await addPasskey(password, name.trim());
      setMessage(t('auth:passkeySaved'));
    });
  };
  return (
    <>
      <PageHead title={t('auth:security')} />
      <div className="card">
        <p>{t('auth:session90')}</p>
        <p>{t(available ? 'auth:passkeyHint' : 'auth:passkeyUnsupported')}</p>
        {message ? (
          <p className="notice" role="status">
            {message}
          </p>
        ) : null}
        {available ? (
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <div className="field">
                <label htmlFor="passkey-name">{t('auth:passkeyName')}</label>
                <input
                  id="passkey-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={60}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="passkey-password">{t('auth:password')}</label>
                <input
                  id="passkey-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  maxLength={128}
                  required
                />
                <p className="hint">{t('auth:passkeyPasswordHint')}</p>
              </div>
              <button
                className="primary"
                type="submit"
                disabled={busy || !name.trim() || !password}
              >
                {t('auth:passkeyAdd')}
              </button>
            </fieldset>
          </form>
        ) : null}
        {!keys.length ? (
          <p>{t('auth:passkeyNone')}</p>
        ) : (
          <ul>
            {keys.map((key) => (
              <li key={key.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await apiClient.post('/v1/auth/passkeys/remove', { id: key.id });
                    })
                  }
                >
                  {t('auth:passkeyRemove', { name: key.name })}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
