import { useState } from 'react';
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

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    } finally {
      setBusy(false);
    }
  };

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
                placeholder="+966501234567"
                // A phone number reads left-to-right even inside an Arabic interface.
                style={{ textAlign: 'left', writingDirection: 'ltr' }}
              />
              <Button
                label={t('auth:sendCode')}
                busy={busy}
                disabled={phone.trim().length < 6}
                onPress={() =>
                  void run(async () => {
                    const challenge = await requestCode(phone.trim());
                    setChallengeId(challenge.challengeId);
                    setDevCode(challenge.devCode ?? null);
                  })
                }
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
            </>
          )}
        </Card>

        <View style={styles.footer}>
          <Body muted>{t('common:offline')}</Body>
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
});
