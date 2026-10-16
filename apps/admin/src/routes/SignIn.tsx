import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../components/LanguageToggle';
import { ApiError } from '../api/client';

interface Props {
  requestCode: (phone: string) => Promise<{ challengeId: string; devCode?: string }>;
  verifyCode: (challengeId: string, code: string) => Promise<void>;
}

export function SignIn({ requestCode, verifyCode }: Props) {
  const { t } = useTranslation(['auth', 'common', 'admin']);
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'sign_in_unavailable'
            ? t('auth:signInUnavailable')
            : err.code === 'rate_limited'
              ? t('auth:rateLimited')
              : err.message
          : t('common:errorRetry'),
      );
    } finally {
      setBusy(false);
    }
  };

  const onRequest = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const challenge = await requestCode(phone.trim());
      setChallengeId(challenge.challengeId);
      setDevCode(challenge.devCode ?? null);
    });
  };

  const onVerify = (event: FormEvent) => {
    event.preventDefault();
    void run(() => verifyCode(challengeId!, code.trim()));
  };

  return (
    <div className="signin">
      <div className="card">
        <div className="top">
          <div>
            <h1>{t('auth:signIn')}</h1>
            <p className="sub">{t('admin:staffOnly')}</p>
          </div>
          <LanguageToggle />
        </div>

        {error ? <div className="notice danger">{error}</div> : null}

        {challengeId === null ? (
          <form onSubmit={onRequest}>
            <div className="field">
              <label htmlFor="phone">{t('auth:phoneNumber')}</label>
              <input
                id="phone"
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+966501234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              <span className="hint">{t('auth:phoneHint')}</span>
            </div>
            <button className="primary" type="submit" disabled={busy || phone.trim().length < 6}>
              {busy ? t('common:loading') : t('auth:sendCode')}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerify}>
            <div className="field">
              <label htmlFor="code">{t('auth:verificationCode')}</label>
              <input
                id="code"
                dir="ltr"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
              />
              <span className="hint">{t('auth:codeSentTo', { phone })}</span>
            </div>

            {/* Development only: the API returns the code when SMS delivery is stubbed. */}
            {devCode ? (
              <div className="notice">
                <span className="mono">{devCode}</span>
              </div>
            ) : null}

            <button className="primary" type="submit" disabled={busy || code.length !== 6}>
              {busy ? t('common:loading') : t('auth:signIn')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
