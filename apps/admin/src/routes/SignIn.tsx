import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, type RegistrationInput } from '@nasl/shared';
import { LanguageToggle } from '../components/LanguageToggle';
import { ApiError } from '../api/client';

interface Props {
  signIn: (identifier: string, password: string) => Promise<void>;
  register: (input: RegistrationInput) => Promise<unknown>;
}

export function SignIn({ signIn, register }: Props) {
  const { t, i18n } = useTranslation(['auth', 'common', 'admin']);
  const [registering, setRegistering] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (registering && password !== confirmation) {
      setError(t('auth:passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      if (registering) {
        await register({
          name,
          email,
          username,
          password,
          locale: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
        });
        setIdentifier(email.trim());
        setPassword('');
        setConfirmation('');
        setSubmitted(true);
      } else {
        await signIn(identifier.trim(), password);
      }
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

  const changeMode = (next: boolean) => {
    setRegistering(next);
    setSubmitted(false);
    setError(null);
    setPassword('');
    setConfirmation('');
  };

  return (
    <div className="signin">
      <div className="card">
        <div className="top">
          <div>
            <h1>
              {t(
                submitted
                  ? 'auth:registrationSubmitted'
                  : registering
                    ? 'auth:register'
                    : 'auth:signIn',
              )}
            </h1>
            <p className="sub">{t(registering ? 'auth:registrationHint' : 'admin:staffOnly')}</p>
          </div>
          <LanguageToggle />
        </div>
        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}
        {submitted ? (
          <>
            <div className="notice" role="status">
              {t('auth:pendingApproval')}
            </div>
            <button type="button" onClick={() => changeMode(false)}>
              {t('auth:backToSignIn')}
            </button>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              {registering ? (
                <>
                  <div className="field">
                    <label htmlFor="name">{t('auth:fullName')}</label>
                    <input
                      id="name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={80}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="email">{t('auth:email')}</label>
                    <input
                      id="email"
                      type="email"
                      dir="ltr"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      maxLength={254}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="username">{t('auth:username')}</label>
                    <input
                      id="username"
                      dir="ltr"
                      autoComplete="username"
                      autoCapitalize="none"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}"
                      minLength={3}
                      maxLength={32}
                      required
                    />
                    <span className="hint">{t('auth:usernameHint')}</span>
                  </div>
                </>
              ) : (
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
              )}
              <div className="field">
                <label htmlFor="password">{t('auth:password')}</label>
                <input
                  id="password"
                  type="password"
                  dir="ltr"
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={registering ? PASSWORD_MIN_LENGTH : 1}
                  maxLength={PASSWORD_MAX_LENGTH}
                  required
                />
                {registering ? <span className="hint">{t('auth:passwordHint')}</span> : null}
              </div>
              {registering ? (
                <div className="field">
                  <label htmlFor="confirmation">{t('auth:confirmPassword')}</label>
                  <input
                    id="confirmation"
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    maxLength={PASSWORD_MAX_LENGTH}
                    required
                  />
                </div>
              ) : null}
              <button className="primary" type="submit" disabled={busy}>
                {t(busy ? 'common:loading' : registering ? 'auth:register' : 'auth:signIn')}
              </button>
              <button
                className="cancel-action"
                type="button"
                onClick={() => changeMode(!registering)}
              >
                {t(registering ? 'auth:haveAccount' : 'auth:needAccount')}
              </button>
            </fieldset>
          </form>
        )}
      </div>
    </div>
  );
}
