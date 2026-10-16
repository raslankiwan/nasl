import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Pill, Screen } from '../../src/components/ui';
import { colors, radius, spacing, type } from '../../src/theme';

interface Row {
  animalId: string;
  tagNumber: string;
  name: string | null;
  until: string;
  daysLeft: number;
}
interface Withdrawal {
  meat: Row[];
  milk: Row[];
}

/**
 * Who cannot be milked, and who cannot be sold (FR-HLT-04).
 *
 * Milk comes first. It is asked twice a day at milking, where the meat question only arises on the
 * day an animal leaves — and a treated ewe whose milk reaches the tank contaminates the whole
 * collection, not just her own.
 */
export default function UnderWithdrawal() {
  const { t } = useTranslation(['health', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<Withdrawal | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!farmId) return setLoading(false);
    try {
      setData(await api.get<Withdrawal>(`/v1/farms/${farmId}/health/withdrawal`));
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const Section = ({ label, rows, tone }: { label: string; rows: Row[]; tone: 'milk' | 'meat' }) =>
    rows.length === 0 ? null : (
      <>
        <Text style={styles.sectionLabel}>{label}</Text>
        {rows.map((row) => (
          <Pressable
            key={`${tone}-${row.animalId}`}
            accessibilityRole="button"
            onPress={() => router.push(`/animal/${row.animalId}`)}
            style={({ pressed }) => [
              styles.row,
              tone === 'milk' && styles.rowMilk,
              pressed && styles.pressed,
            ]}
          >
            <View>
              <Text style={styles.tag}>{row.tagNumber}</Text>
              {row.name ? <Text style={styles.name}>{row.name}</Text> : null}
            </View>
            <Pill tone="accent">{t('health:daysLeft', { count: row.daysLeft })}</Pill>
          </Pressable>
        ))}
        <View style={styles.gap} />
      </>
    );

  const empty = data && data.meat.length === 0 && data.milk.length === 0;

  return (
    <View style={styles.root}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      >
        <Screen>
          <ScreenHeader title={t('health:underWithdrawal')} />
          <Section label={t('health:milk')} rows={data?.milk ?? []} tone="milk" />
          <Section label={t('health:meat')} rows={data?.meat ?? []} tone="meat" />
          {empty ? <Body muted>{t('health:noWithdrawal')}</Body> : null}
        </Screen>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
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
    minHeight: 56,
    gap: spacing.md,
  },
  rowMilk: { borderStartWidth: 3, borderStartColor: colors.rust },
  pressed: { opacity: 0.85 },
  tag: { fontSize: type.heading, fontWeight: '700', color: colors.ink, writingDirection: 'ltr' },
  name: { fontSize: type.caption, color: colors.muted },
  gap: { height: spacing.lg },
});
