import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { Body, Button, Field, Notice } from './ui';

export function VerifyEmail({
  initialEmail,
  initialId,
  deliveryFailed,
  onVerified,
  onBack,
}: {
  initialEmail: string;
  initialId?: string;
  deliveryFailed?: boolean;
  onVerified: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation(['auth', 'common']);
  const [email, setEmail] = useState(initialEmail);
  const [verificationId, setVerificationId] = useState(initialId);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(initialId ? 60 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    deliveryFailed ? t('auth:verificationFailedDelivery') : null,
  );
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const run = async (verify: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (verify) {
        await api.post('/v1/auth/email/verify', { verificationId, code });
        onVerified();
      } else {
        const result = await api.post<{ verificationId: string }>('/v1/auth/email/resend', {
          email,
        });
        setVerificationId(result.verificationId);
        setCode('');
        setCooldown(60);
        setSent(true);
      }
    } catch (error) {
      setError(
        error instanceof ApiError
          ? t(`auth:errors.${error.code}`, { defaultValue: t('common:errorRetry') })
          : t('common:errorRetry'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label={t('auth:email')}
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          setVerificationId(undefined);
          setCode('');
        }}
        keyboardType="email-address"
        autoComplete="email"
        autoCapitalize="none"
        editable={!busy}
        maxLength={254}
      />
      {verificationId ? (
        <>
          <Body muted>{t('auth:verificationHint', { email })}</Body>
          <Field
            label={t('auth:verificationCode')}
            value={code}
            onChangeText={(value) =>
              setCode(
                value.replace(/[٠-٩۰-۹]/g, (digit) =>
                  String(digit.charCodeAt(0) - (digit <= '٩' ? 1632 : 1776)),
                ),
              )
            }
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            editable={!busy}
          />
          <Button
            label={t('auth:verifyCode')}
            busy={busy}
            disabled={!/^\d{6}$/.test(code)}
            onPress={() => void run(true)}
          />
        </>
      ) : null}
      {sent ? <Body muted>{t('auth:resendHint')}</Body> : null}
      <Button
        variant="text"
        label={
          cooldown ? t('auth:verificationCooldown', { seconds: cooldown }) : t('auth:resendCode')
        }
        disabled={busy || cooldown > 0 || !email.includes('@')}
        onPress={() => void run(false)}
      />
      <Button variant="text" label={t('auth:backToSignIn')} disabled={busy} onPress={onBack} />
    </>
  );
}
