import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@nasl/shared';
import { ApiError } from '../src/api/client';
import { useAuth } from '../src/auth/AuthProvider';
import { Body, Button, Card, Field, Notice, Title } from '../src/components/ui';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { AppearanceChoice } from '../src/components/AppearanceChoice';
import { InstallApp } from '../src/components/InstallApp';
import { spacing, createThemedStyles } from '../src/theme';

export default function SignIn() {
  const styles = useStyles();
  const { t, i18n } = useTranslation(['auth', 'common']);
  const { signIn, register } = useAuth();
  const insets = useSafeAreaInsets();
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
  const valid = registering
    ? Boolean(
        name.trim() &&
        email.trim() &&
        /^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username.trim()) &&
        password.length >= PASSWORD_MIN_LENGTH &&
        confirmation,
      )
    : Boolean(identifier.trim() && password);

  const submit = async () => {
    if (busy || !valid) return;
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.header}>
            <Title>
              {t(
                submitted
                  ? 'auth:registrationSubmitted'
                  : registering
                    ? 'auth:register'
                    : 'auth:signIn',
              )}
            </Title>
            <LanguageToggle compact />
          </View>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Card>
            {submitted ? (
              <>
                <Notice>{t('auth:pendingApproval')}</Notice>
                <Button label={t('auth:backToSignIn')} onPress={() => changeMode(false)} />
              </>
            ) : (
              <>
                {registering ? (
                  <>
                    <View style={styles.intro}>
                      <Body muted>{t('auth:registrationHint')}</Body>
                    </View>
                    <Field
                      label={t('auth:fullName')}
                      value={name}
                      onChangeText={setName}
                      autoComplete="name"
                      maxLength={80}
                      editable={!busy}
                    />
                    <Field
                      label={t('auth:email')}
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect={false}
                      maxLength={254}
                      editable={!busy}
                      style={styles.latin}
                    />
                    <Field
                      label={t('auth:username')}
                      hint={t('auth:usernameHint')}
                      value={username}
                      onChangeText={setUsername}
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect={false}
                      maxLength={32}
                      editable={!busy}
                      style={styles.latin}
                    />
                  </>
                ) : (
                  <Field
                    label={t('auth:identifier')}
                    value={identifier}
                    onChangeText={setIdentifier}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={254}
                    editable={!busy}
                    style={styles.latin}
                  />
                )}
                <Field
                  label={t('auth:password')}
                  hint={registering ? t('auth:passwordHint') : undefined}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={PASSWORD_MAX_LENGTH}
                  editable={!busy}
                  style={styles.latin}
                  onSubmitEditing={() => {
                    if (!registering) void submit();
                  }}
                />
                {registering ? (
                  <Field
                    label={t('auth:confirmPassword')}
                    value={confirmation}
                    onChangeText={setConfirmation}
                    secureTextEntry
                    autoComplete="new-password"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={PASSWORD_MAX_LENGTH}
                    editable={!busy}
                    style={styles.latin}
                    onSubmitEditing={() => void submit()}
                  />
                ) : null}
                <Button
                  label={t(registering ? 'auth:register' : 'auth:signIn')}
                  busy={busy}
                  disabled={!valid}
                  onPress={() => void submit()}
                />
                <Button
                  label={t(registering ? 'auth:haveAccount' : 'auth:needAccount')}
                  variant="text"
                  disabled={busy}
                  onPress={() => changeMode(!registering)}
                />
              </>
            )}
          </Card>
          <View style={styles.footer}>
            <AppearanceChoice />
            <InstallApp />
            <Body muted>{t('auth:signInOnlineHint')}</Body>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: spacing.lg, flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  content: { width: '100%', maxWidth: 480 },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  intro: { marginBottom: spacing.md },
  footer: { marginTop: spacing.lg, gap: spacing.lg },
  latin: { textAlign: 'left', writingDirection: 'ltr' },
}));
