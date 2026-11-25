import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDate, type Locale } from '@nasl/i18n';
import { animalLabel } from '@nasl/shared';
import { api } from '../api/client';
import type { CachedAnimal } from '../sync/cache';
import { Body, Card, NavigationRow } from './ui';
import { spacing, type, createThemedStyles } from '../theme';

interface BirthRow {
  id: string;
  date: string;
  birthType: string;
  born: number;
  live: number;
}

/**
 * A mother's lifetime record: how many times she has lambed, how many she has borne, and every
 * child on file, each one a tap away.
 *
 * The children come from the device's copy of the flock, so they show with no signal. The lambing
 * history is network-only for now, like treatments, and says so instead of showing zeros.
 */
export function MotherRecord({
  farmId,
  animalId,
  childAnimals,
}: {
  farmId: string;
  animalId: string;
  childAnimals: CachedAnimal[];
}) {
  const styles = useStyles();
  const { t, i18n } = useTranslation(['breeding', 'animals']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const router = useRouter();
  const [births, setBirths] = useState<BirthRow[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      api
        .get<{ births: BirthRow[] }>(`/v1/farms/${farmId}/breeding/history/${animalId}`)
        .then((res) => {
          if (active) setBirths(res.births);
        })
        .catch(() => {
          if (active) setBirths(null);
        });
      return () => {
        active = false;
      };
    }, [farmId, animalId]),
  );

  const born = births?.reduce((sum, birth) => sum + birth.born, 0) ?? 0;
  const live = births?.reduce((sum, birth) => sum + birth.live, 0) ?? 0;
  // The history route returns newest first.
  const last = births?.[0];

  return (
    <>
      <Card>
        <Body>{t('breeding:breedingRecord')}</Body>
        <View style={styles.stats}>
          <Stat label={t('breeding:lambings')} value={births ? String(births.length) : '—'} />
          <Stat label={t('breeding:lambsBornTotal')} value={births ? String(born) : '—'} />
          <Stat label={t('breeding:lambsBornAlive')} value={births ? String(live) : '—'} />
          <Stat label={t('breeding:childrenOnRecord')} value={String(childAnimals.length)} />
        </View>
        {last ? (
          <Text style={styles.muted}>
            {t('breeding:lastLambing')}: {formatDate(new Date(last.date), locale)}
          </Text>
        ) : null}
        {births === null ? (
          <Text style={styles.muted}>{t('breeding:historyNeedsConnection')}</Text>
        ) : null}

        {births && births.length > 0 ? (
          <View style={styles.history}>
            <Text style={styles.subheading}>{t('breeding:lambingHistory')}</Text>
            {births.map((birth) => (
              <View key={birth.id} style={styles.row}>
                <Text style={styles.rowLabel}>{formatDate(new Date(birth.date), locale)}</Text>
                <Text style={styles.rowValue}>
                  {t(`breeding:birthTypes.${birth.birthType}` as 'breeding:birthTypes.single')} ·{' '}
                  {t('breeding:lambingSummary', { born: birth.born, live: birth.live })}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <View style={styles.gap} />
      <Text style={styles.subheading}>{t('breeding:offspring')}</Text>
      {childAnimals.length > 0 ? (
        childAnimals.map((child) => (
          <View key={child.id} style={styles.child}>
            <NavigationRow
              icon={child.sex === 'male' ? 'gender-male' : 'gender-female'}
              label={[
                animalLabel(child),
                child.name,
                child.status !== 'active'
                  ? t(`animals:statusValues.${child.status}` as 'animals:statusValues.sold')
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => router.push(`/animal/${child.id}`)}
            />
          </View>
        ))
      ) : (
        <Body muted>{t('breeding:noChildren')}</Body>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginVertical: spacing.md },
  stat: { minWidth: 72, flexGrow: 1, gap: 2 },
  statValue: { fontSize: type.heading, fontWeight: '700', color: colors.ink },
  statLabel: { fontSize: type.caption, color: colors.muted },
  muted: { fontSize: type.label, color: colors.muted },
  history: { marginTop: spacing.md },
  subheading: {
    fontSize: type.caption,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowLabel: { fontSize: type.label, color: colors.muted },
  rowValue: { fontSize: type.body, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  gap: { height: spacing.md },
  child: { marginBottom: spacing.sm },
}));
