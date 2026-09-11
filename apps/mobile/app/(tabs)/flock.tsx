import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Card, Notice, Pill, Title } from '../../src/components/ui';
import { colors, MIN_TOUCH, radius, spacing, type } from '../../src/theme';

interface AnimalRow {
  id: string;
  tagNumber: string;
  name: string | null;
  species: string;
  sex: string;
  status: string;
  repro: { state: string } | null;
  withholdMeatUntil: string | null;
}

export default function Flock() {
  const { t } = useTranslation(['animals', 'breeding', 'common', 'health']);
  const { farmId } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [animals, setAnimals] = useState<AnimalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!farmId) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await api.get<{ animals: AnimalRow[]; total: number }>(
        `/v1/farms/${farmId}/animals?limit=200`,
      );
      setAnimals(res.animals);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    } finally {
      setLoading(false);
    }
  }, [farmId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!farmId) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.padded}>
          <Title>{t('animals:title')}</Title>
          <Card>
            <Body>{t('animals:noFarm')}</Body>
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Title>{t('animals:title')}</Title>
        <Text style={styles.count}>{t('animals:headCount', { count: total })}</Text>
      </View>

      {error ? (
        <View style={styles.padded}>
          <Notice tone="danger">{error}</Notice>
          <Button label={t('common:retry')} variant="secondary" onPress={() => void load()} />
        </View>
      ) : null}

      <FlashList
        data={animals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.padded}>
              <Body muted>{t('animals:emptyFlock')}</Body>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/animal/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowMain}>
              {/*
                A tag number is an identifier, not a quantity: it is never grouped ("1,001"), never
                localised into other digits, and may not be numeric at all. It is printed verbatim,
                left-to-right, in either language.
              */}
              <Text style={styles.tag}>{item.tagNumber}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {item.name ??
                  t(`animals:speciesValues.${item.species}` as 'animals:speciesValues.sheep')}
              </Text>
            </View>

            <View style={styles.rowMeta}>
              {item.withholdMeatUntil ? (
                <Pill tone="accent">{t('health:underWithdrawal')}</Pill>
              ) : item.repro ? (
                <Pill tone={item.repro.state === 'due' ? 'accent' : 'good'}>
                  {t(`breeding:states.${item.repro.state}` as 'breeding:states.open')}
                </Pill>
              ) : (
                <Pill>{t(`animals:sexValues.${item.sex}` as 'animals:sexValues.female')}</Pill>
              )}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  padded: { padding: spacing.lg },
  count: { fontSize: type.label, color: colors.muted, fontWeight: '600' },
  list: { padding: spacing.lg },
  row: {
    minHeight: MIN_TOUCH + 8,
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
  },
  rowPressed: { opacity: 0.85 },
  rowMain: { flexShrink: 1, gap: 2 },
  rowMeta: { flexShrink: 0 },
  tag: { fontSize: type.heading, fontWeight: '700', color: colors.ink, writingDirection: 'ltr' },
  name: { fontSize: type.label, color: colors.muted },
});
