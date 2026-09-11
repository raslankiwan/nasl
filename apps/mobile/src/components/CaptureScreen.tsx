import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { Button, Notice, Title } from './ui';
import { colors, spacing } from '../theme';

/**
 * The frame every capture form shares: a title, an error slot, the form, and a save that returns
 * the herder to where they came from. Kept in one place so every one of them behaves the same
 * when the network is slow or the server refuses.
 */
export function CaptureScreen({
  title,
  subtitle,
  onSave,
  canSave,
  children,
}: {
  title: string;
  subtitle?: string;
  onSave: () => Promise<unknown>;
  canSave: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave();
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errorRetry'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { paddingTop: insets.top }]}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Title>{title}</Title>
        {subtitle ? <View style={styles.subtitle}>{null}</View> : null}

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {children}

        <Button label={t('save')} onPress={() => void save()} busy={busy} disabled={!canSave} />
        <View style={styles.gap} />
        <Button label={t('cancel')} variant="secondary" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  subtitle: { marginBottom: spacing.sm },
  gap: { height: spacing.sm },
});
