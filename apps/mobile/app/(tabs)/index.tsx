import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { deriveAlerts, type Alerts } from '@nasl/shared';
import { useFlock } from '../../src/sync/useFlock';
import { Body, Card, Pill, Screen, Title } from '../../src/components/ui';
import { colors, radius, spacing, type } from '../../src/theme';

/**
 * The home screen is a list of what needs doing, not a dashboard (scope FR-ALT-01).
 *
 * It derives its alerts from the flock cached on the device using the same function the server
 * runs, so it works with no signal and cannot disagree with the server about who is due
 * (FR-ALT-05). Overdue comes first, and a milk hold comes before either — milking happens twice a
 * day and a treated ewe contaminates the whole tank.
 */
export default function Today() {
  const { t, i18n } = useTranslation(['tasks', 'breeding', 'health', 'common']);
  const router = useRouter();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const { animals, loading, stale, refresh } = useFlock();
  const today = new Date();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const alerts: Alerts = deriveAlerts(animals, today);

  const Row = ({ row, tone }: { row: Alerts['dueSoon'][number]; tone: 'accent' | 'neutral' }) => (
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
    <View style={styles.root}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
      >
        <Screen>
          <Title>{t('tasks:title')}</Title>

          <Card>
            <Body>{formatDate(today, locale, { dateStyle: 'full' })}</Body>
            {/* Both calendars, always. The customer's year runs on Hijri dates (FR-LOC-01). */}
            <Body muted>{formatHijriDate(today, locale, { dateStyle: 'long' })}</Body>
          </Card>

          <View style={styles.gap} />

          {stale ? <Body muted>{t('common:offline')}</Body> : null}

          {/*
            Milking happens twice a day and a treated ewe's milk contaminates the whole tank, so
            this belongs at the top of the day rather than inside a health screen.
          */}
          {alerts.milkWithheld.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/health/withdrawal')}
              style={({ pressed }) => [styles.warning, pressed && styles.rowPressed]}
            >
              <Text style={styles.warningText}>{t('health:doNotMilk')}</Text>
              <Pill tone="accent">{alerts.milkWithheld.length}</Pill>
            </Pressable>
          ) : null}

          {alerts.overdue.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>{t('tasks:overdue')}</Text>
              {alerts.overdue.map((row) => (
                <Row key={row.animalId} row={row} tone="accent" />
              ))}
              <View style={styles.gap} />
            </>
          ) : null}

          {alerts.dueSoon.length > 0 ? (
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
