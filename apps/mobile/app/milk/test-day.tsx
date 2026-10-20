import { animalLabel } from '@nasl/shared';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Notice, Screen } from '../../src/components/ui';
import { DateField, NumberField } from '../../src/components/form';
import { MIN_TOUCH, radius, spacing, type, createThemedStyles } from '../../src/theme';

interface Lactation {
  lactationId: string;
  animalId: string;
  tagNumber: string;
  classLabel?: string | null;
  name: string | null;
  daysInMilk: number;
}
interface Result {
  recorded: number;
  withheld: Array<{ tagNumber: string; classLabel?: string | null; until: string }>;
}

/**
 * A test day at the parlour.
 *
 * Every milking ewe on one screen with editable yield and quick adjustments:
 * the ewe is in front of you for a few seconds and the entry has to keep up. Nothing is sent until
 * the session is finished, so a herder can go back and correct before committing.
 */
export default function TestDay() {
  const styles = useStyles();
  const { t } = useTranslation(['milk', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();

  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [ewes, setEwes] = useState<Lactation[]>([]);
  const [yields, setYields] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withheld, setWithheld] = useState<Result['withheld']>([]);

  const load = useCallback(async () => {
    if (!farmId) return setLoading(false);
    try {
      const res = await api.get<{ lactations: Lactation[] }>(`/v1/farms/${farmId}/milk/milking`);
      setEwes(res.lactations);
      setError(null);
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

  const setYield = (animalId: string, value: number | null) =>
    setYields((prev) => {
      if (value === null) {
        const { [animalId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [animalId]: value };
    });

  const entries = Object.entries(yields).map(([animalId, kg]) => ({ animalId, kg }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<Result>(`/v1/farms/${farmId}/milk/test-days`, {
        date: date.toISOString().slice(0, 10),
        entries,
      });
      // Surfaced rather than navigated past: whose milk must not reach the tank is the one thing
      // from this screen that has to be carried back to the parlour.
      if (res.withheld.length > 0) {
        setWithheld(res.withheld);
        setYields({});
        await load();
      } else {
        router.back();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Screen>
          <View style={styles.head}>
            <ScreenHeader title={t('milk:testDay')} />
            <Text style={styles.count}>{t('milk:entered', { count: entries.length })}</Text>
          </View>

          {error ? <Notice tone="danger">{error}</Notice> : null}

          {withheld.length > 0 ? (
            <Notice tone="danger">
              {t('milk:withheldWarning', { count: withheld.length })} ·{' '}
              {withheld.map((w) => animalLabel(w)).join('، ')}
            </Notice>
          ) : null}

          <DateField label={t('common:date')} value={date} onChange={setDate} />

          {ewes.length === 0 && !loading ? <Body muted>{t('milk:noneMilking')}</Body> : null}

          {ewes.map((ewe) => {
            const value = yields[ewe.animalId];
            return (
              <View key={ewe.animalId} style={[styles.row, value !== undefined && styles.rowDone]}>
                <View style={styles.rowMain}>
                  <Text style={styles.tag}>{animalLabel(ewe)}</Text>
                  <Text style={styles.meta}>
                    {ewe.name ? `${ewe.name} · ` : ''}
                    {t('milk:daysInMilk')} {ewe.daysInMilk}
                  </Text>
                </View>

                <NumberField
                  label={`${t('milk:quantity')} · ${animalLabel(ewe)}`}
                  value={value ?? null}
                  onChange={(next) => setYield(ewe.animalId, next)}
                  min={0}
                  max={20}
                  step={0.1}
                  initial={0.1}
                  suffix="kg"
                  optional
                />
              </View>
            );
          })}

          {entries.length > 0 ? (
            <>
              <View style={styles.gap} />
              <Button label={t('common:save')} onPress={() => void save()} busy={busy} />
            </>
          ) : null}
        </Screen>
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: spacing.xxl },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  count: { fontSize: type.label, fontWeight: '600', color: colors.accent },
  gap: { height: spacing.md },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: MIN_TOUCH + 8,
    gap: spacing.sm,
  },
  rowDone: { borderColor: colors.sage, backgroundColor: colors.sageSoft },
  rowMain: { flexShrink: 1, gap: 2 },
  tag: { fontSize: type.heading, fontWeight: '700', color: colors.ink, writingDirection: 'ltr' },
  meta: { fontSize: type.caption, color: colors.muted },
}));
