import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../src/api/client';
import { useAuth } from '../src/auth/AuthProvider';
import { Body, Button, Card, Field, Notice, Title } from '../src/components/ui';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { colors, spacing } from '../src/theme';

export default function SignIn() {
  const { t } = useTranslation(['auth', 'common']);
  const { requestCode, verifyCode } = useAuth();
  const insets = useSafeAreaInsets();

  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (!resendAt) return;
    const update = () => setResendSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

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

  const sendCode = () =>
    run(async () => {
      const challenge = await requestCode(phone.trim());
      setChallengeId(challenge.challengeId);
      setDevCode(challenge.devCode ?? null);
      setCode('');
      setResendAt(Date.now() + 30_000);
    });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { paddingTop: insets.top + spacing.lg }]}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Title>{t('auth:signIn')}</Title>
          <LanguageToggle compact />
        </View>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        <Card>
          {challengeId === null ? (
            <>
              <Field
                label={t('auth:phoneNumber')}
                hint={t('auth:phoneHint')}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                placeholder="+970590000000"
                // A phone number reads left-to-right even inside an Arabic interface.
                style={{ textAlign: 'left', writingDirection: 'ltr' }}
              />
              <Button
                label={t('auth:sendCode')}
                busy={busy}
                disabled={phone.trim().length < 6}
                onPress={() => void sendCode()}
              />
            </>
          ) : (
            <>
              <Field
                label={t('auth:verificationCode')}
                hint={t('auth:codeSentTo', { phone })}
                value={code}
                onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                style={{ textAlign: 'center', letterSpacing: 8, fontSize: 24 }}
              />

              {/* Development only: the API returns the code when SMS delivery is stubbed. */}
              {devCode ? <Notice>{devCode}</Notice> : null}

              <Button
                label={t('auth:signIn')}
                busy={busy}
                disabled={code.length !== 6}
                onPress={() => void run(() => verifyCode(challengeId, code))}
              />
              <View style={styles.recovery}>
                <Button
                  label={
                    resendSeconds > 0
                      ? t('auth:resendIn', { seconds: resendSeconds })
                      : t('auth:resendCode')
                  }
                  variant="text"
                  disabled={busy || resendSeconds > 0}
                  onPress={() => void sendCode()}
                />
                <Button
                  label={t('auth:changePhone')}
                  variant="text"
                  disabled={busy}
                  onPress={() => {
                    setChallengeId(null);
                    setDevCode(null);
                    setCode('');
                    setError(null);
                  }}
                />
              </View>
            </>
          )}
        </Card>

        <View style={styles.footer}>
          <Body muted>{t('auth:signInOnlineHint')}</Body>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  footer: { marginTop: spacing.xl, alignItems: 'center' },
  recovery: { marginTop: spacing.md, gap: spacing.sm },
});
