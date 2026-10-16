import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@nasl/shared';
import { apiClient, ApiError } from '../api/client';
import { LanguageToggle } from '../components/LanguageToggle';

interface Invitation {
  email: string;
  name: string;
  username: string;
  existingAccount: boolean;
  seeded: boolean;
}
export function AcceptInvitation() {
  const { t } = useTranslation(['admin', 'auth', 'common']);
  // URL fragments never reach access logs or HTTP Referer headers.
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    let active = true;
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setLoading(false);
      setError('invitation_invalid');
      return;
    }
    void apiClient
      .post<Invitation>('/v1/auth/admin-invitations/inspect', { token })
      .then((data) => {
        if (!active) return;
        setInvitation(data);
        setName(data.name);
        setUsername(data.username);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.code : 'internal');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!invitation || busy) return;
    if (!invitation.existingAccount && password !== confirmation) {
      setError('passwordMismatch');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/v1/auth/admin-invitations/accept', {
        token,
        password,
        ...(!invitation.existingAccount && !invitation.seeded ? { name, username } : {}),
      });
      setPassword('');
      setConfirmation('');
      setComplete(true);
      window.history.replaceState({}, '', '/accept-invite');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'internal');
    } finally {
      setBusy(false);
    }
  };
  const frozen = invitation?.existingAccount || invitation?.seeded;
  return (
    <div className="signin">
      <div className="card">
        <div className="top">
          <h1>
            {t(
              complete
                ? 'admin:inviteComplete'
                : invitation?.seeded
                  ? 'admin:setupAdmin'
                  : 'admin:acceptInvite',
            )}
          </h1>
          <LanguageToggle />
        </div>
        {loading ? <p>{t('common:loading')}</p> : null}
        {error ? (
          <div className="notice danger" role="alert">
            {error === 'passwordMismatch'
              ? t('auth:passwordMismatch')
              : t(`auth:errors.${error}`, { defaultValue: t('common:errorRetry') })}
          </div>
        ) : null}
        {complete ? (
          <div className="notice" role="status">
            {t('admin:inviteCompleteHint')}
          </div>
        ) : invitation ? (
          <form onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              <p className="sub">
                {t(
                  invitation.existingAccount
                    ? 'admin:inviteExistingHint'
                    : invitation.seeded
                      ? 'admin:setupAdminHint'
                      : 'admin:acceptInviteHint',
                )}
              </p>
              <div className="field">
                <label htmlFor="invite-email">{t('auth:email')}</label>
                <input
                  id="invite-email"
                  value={invitation.email}
                  readOnly
                  dir="ltr"
                  autoComplete="email"
                />
              </div>
              <div className="field">
                <label htmlFor="invite-name">{t('auth:fullName')}</label>
                <input
                  id="invite-name"
                  value={name}
                  readOnly={frozen}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="invite-username">{t('auth:username')}</label>
                <input
                  id="invite-username"
                  value={username}
                  readOnly={frozen}
                  onChange={(e) => setUsername(e.target.value)}
                  dir="ltr"
                  autoComplete="username"
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="invite-password">{t('auth:password')}</label>
                <input
                  id="invite-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={invitation.existingAccount ? 'current-password' : 'new-password'}
                  dir="ltr"
                  minLength={invitation.existingAccount ? 1 : PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_MAX_LENGTH}
                  required
                />
                {!invitation.existingAccount ? (
                  <span className="hint">{t('auth:passwordHint')}</span>
                ) : null}
              </div>
              {!invitation.existingAccount ? (
                <div className="field">
                  <label htmlFor="invite-confirm">{t('auth:confirmPassword')}</label>
                  <input
                    id="invite-confirm"
                    type="password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    autoComplete="new-password"
                    dir="ltr"
                    maxLength={PASSWORD_MAX_LENGTH}
                    required
                  />
                </div>
              ) : null}
              <button className="primary" type="submit" disabled={busy}>
                {t(
                  busy
                    ? 'common:loading'
                    : invitation.seeded
                      ? 'admin:savePassword'
                      : 'admin:acceptInvite',
                )}
              </button>
            </fieldset>
          </form>
        ) : null}
        <p>
          <a href="/">{t('auth:backToSignIn')}</a>
        </p>
      </div>
    </div>
  );
}
