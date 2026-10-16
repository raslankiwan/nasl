import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { useSync } from '../sync/SyncProvider';
import { Body, Button, Notice } from './ui';
import { ScreenHeader } from './ScreenHeader';
import { colors, spacing } from '../theme';

/**
 * The frame every capture form shares: a title, an error slot, the form, and a save that returns
 * the herder to where they came from. Kept in one place so every one of them behaves the same
 * when the network is slow or the server refuses.
 */
export function CaptureScreen({
  title,
  subtitle,
  path,
  buildBody,
  canSave,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Where the record goes. Paired with `buildBody` so the write can be queued verbatim. */
  path: string;
  buildBody: (id: string) => unknown;
  canSave: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { send } = useSync();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * These screens are reachable directly — from a deep link, and later from a notification — so
   * there is not always a history to return to. Falling back to the flock beats stranding the
   * herder on a form they have already submitted.
   */
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/flock');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    /**
     * The id is minted here, before anything is attempted, and travels with the record whether it
     * goes over the network now or waits in the outbox for days. That is what makes a retry safe.
     */
    const id = globalThis.crypto.randomUUID();
    try {
      // `send` resolves false when the write was queued rather than delivered; either way the
      // record is safe, so the herder moves on. The banner shows what is still waiting.
      await send(id, path, buildBody(id));
      leave();
    } catch (err) {
      // Only a refusal reaches here — a network failure was queued, not thrown.
      setError(err instanceof ApiError ? err.message : t('errorRetry'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
      keyboardVerticalOffset={headerHeight}
    >
      <ScreenHeader title={title} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, spacing.xl) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {subtitle ? (
          <View style={styles.subtitle}>
            <Body muted>{subtitle}</Body>
          </View>
        ) : null}

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {children}

        <Button label={t('save')} onPress={() => void save()} busy={busy} disabled={!canSave} />
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
