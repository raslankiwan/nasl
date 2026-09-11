import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Card, Notice, Pill, Screen, Title } from '../../src/components/ui';
import { colors, radius, spacing, type } from '../../src/theme';

interface DueRow {
  animalId: string;
  tagNumber: string;
  dueDate: string;
  days: number;
}
interface Alerts {
  dueSoon: DueRow[];
  overdue: DueRow[];
  nursing: number;
}
interface Withdrawal {
  meat: Array<{ animalId: string }>;
  milk: Array<{ animalId: string }>;
}

/**
 * The home screen is a list of what needs doing, not a dashboard (scope FR-ALT-01).
 * Overdue comes first, because a ewe past her date is the thing that cannot wait.
 */
export default function Today() {
  const { t, i18n } = useTranslation(['tasks', 'breeding', 'health', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;

  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [withdrawal, setWithdrawal] = useState<Withdrawal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = new Date();

  const load = useCallback(async () => {
    if (!farmId) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [nextAlerts, nextWithdrawal] = await Promise.all([
        api.get<Alerts>(`/v1/farms/${farmId}/breeding/alerts`),
        api.get<Withdrawal>(`/v1/farms/${farmId}/health/withdrawal`),
      ]);
      setAlerts(nextAlerts);
      setWithdrawal(nextWithdrawal);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    } finally {
      setLoading(false);
    }
  }, [farmId, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const Row = ({ row, tone }: { row: DueRow; tone: 'accent' | 'neutral' }) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/animal/${row.animalId}`)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={styles.tag}>{row.tagNumber}</Text>
      <Pill tone={tone}>
        {row.days < 0
          ? t('breeding:overdueBy', { count: Math.abs(row.days) })
          : t('breeding:dueIn', { count: row.days })}
      </Pill>
    </Pressable>
  );

  const nothingToDo = alerts && alerts.overdue.length === 0 && alerts.dueSoon.length === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      >
        <Screen>
          <Title>{t('tasks:title')}</Title>

          <Card>
            <Body>{formatDate(today, locale, { dateStyle: 'full' })}</Body>
            {/* Both calendars, always. The customer's year runs on Hijri dates (FR-LOC-01). */}
            <Body muted>{formatHijriDate(today, locale, { dateStyle: 'long' })}</Body>
          </Card>

          <View style={styles.gap} />

          {error ? <Notice tone="danger">{error}</Notice> : null}

          {/*
            Milking happens twice a day and a treated ewe's milk contaminates the whole tank, so
            this belongs at the top of the day rather than inside a health screen.
          */}
          {withdrawal && withdrawal.milk.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/health/withdrawal')}
              style={({ pressed }) => [styles.warning, pressed && styles.rowPressed]}
            >
              <Text style={styles.warningText}>{t('health:doNotMilk')}</Text>
              <Pill tone="accent">{withdrawal.milk.length}</Pill>
            </Pressable>
          ) : null}

          {alerts && alerts.overdue.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>{t('tasks:overdue')}</Text>
              {alerts.overdue.map((row) => (
                <Row key={row.animalId} row={row} tone="accent" />
              ))}
              <View style={styles.gap} />
            </>
          ) : null}

          {alerts && alerts.dueSoon.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>{t('tasks:upcoming')}</Text>
              {alerts.dueSoon.map((row) => (
                <Row key={row.animalId} row={row} tone="neutral" />
              ))}
            </>
          ) : null}

          {nothingToDo ? (
            <Card>
              <Body>{t('tasks:allClear')}</Body>
            </Card>
          ) : null}
        </Screen>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  gap: { height: spacing.lg },
  sectionLabel: {
    fontSize: type.caption,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
    minHeight: 56,
  },
  rowPressed: { opacity: 0.85 },
  tag: { fontSize: type.heading, fontWeight: '700', color: colors.ink, writingDirection: 'ltr' },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.rustSoft,
    borderWidth: 1,
    borderColor: colors.rust,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    minHeight: 56,
    gap: spacing.md,
  },
  warningText: { fontSize: type.body, fontWeight: '700', color: colors.rust },
});
