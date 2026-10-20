import { animalLabel } from '@nasl/shared';
import { TabScreen } from '../../src/components/TabScreen';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatNumber, type Locale } from '@nasl/i18n';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Card, Pill, Screen, Title } from '../../src/components/ui';
import { radius, spacing, type, createThemedStyles } from '../../src/theme';

interface EweRow {
  animalId: string;
  tagNumber: string;
  classLabel?: string | null;
  name: string | null;
  lambings: number;
  lambsBorn: number;
  lambsWeaned: number;
  averageLitterSize: number | null;
  averageLambingIntervalDays: number | null;
  cullSignals: string[];
}
interface Scorecard {
  ewes: EweRow[];
  cullCandidates: number;
}
interface Season {
  lambings: number;
  lambsBorn: number;
  lambsWeaned: number;
  lambingPercentage: number | null;
  weaningRate: number | null;
  lambMortality: number | null;
}

/**
 * The payoff for all the recording (FR-RPT-01).
 *
 * Ordered worst-first by the server, because the question this screen exists to answer is "which
 * ewes should go", and making the herder scan a list for that is making them do the work twice.
 */
export default function Reports() {
  const styles = useStyles();
  const { t, i18n } = useTranslation(['reports', 'breeding', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;

  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!farmId) return setLoading(false);
    try {
      const [ewes, summary] = await Promise.all([
        api.get<Scorecard>(`/v1/farms/${farmId}/reports/ewes`),
        api.get<Season>(`/v1/farms/${farmId}/reports/season`),
      ]);
      setScorecard(ewes);
      setSeason(summary);
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const n = (value: number | null) => (value === null ? '—' : formatNumber(value, locale));

  return (
    <TabScreen>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      >
        <Screen>
          <Title>{t('reports:title')}</Title>

          <Card>
            <Body muted>{t('reports:seasonSummary')}</Body>
            <View style={styles.stats}>
              <Stat
                label={t('reports:lambingPercentage')}
                value={n(season?.lambingPercentage ?? null)}
                suffix="%"
              />
              <Stat
                label={t('reports:weaningRate')}
                value={n(season?.weaningRate ?? null)}
                suffix="%"
              />
              <Stat
                label={t('reports:mortalityRate')}
                value={n(season?.lambMortality ?? null)}
                suffix="%"
              />
            </View>
          </Card>

          <View style={styles.gap} />

          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel}>{t('reports:eweScorecard')}</Text>
            {scorecard && scorecard.cullCandidates > 0 ? (
              <Pill tone="accent">
                {t('reports:cullCandidates', { count: scorecard.cullCandidates })}
              </Pill>
            ) : null}
          </View>

          {scorecard && scorecard.ewes.length === 0 ? (
            <Body muted>{t('reports:noData')}</Body>
          ) : null}

          {scorecard?.ewes.map((ewe) => (
            <Pressable
              key={ewe.animalId}
              accessibilityRole="button"
              onPress={() => router.push(`/animal/${ewe.animalId}`)}
              style={({ pressed }) => [
                styles.row,
                ewe.cullSignals.length > 0 && styles.rowFlagged,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.rowHead}>
                <Text style={styles.tag}>{animalLabel(ewe)}</Text>
                {ewe.name ? <Text style={styles.name}>{ewe.name}</Text> : null}
              </View>

              <View style={styles.figures}>
                <Figure label={t('reports:lambings')} value={n(ewe.lambings)} />
                <Figure label={t('reports:born')} value={n(ewe.lambsBorn)} />
                <Figure label={t('reports:weaned')} value={n(ewe.lambsWeaned)} />
                <Figure label={t('reports:averageLitterSize')} value={n(ewe.averageLitterSize)} />
              </View>

              {ewe.cullSignals.length > 0 ? (
                <View style={styles.signals}>
                  {ewe.cullSignals.map((signal) => (
                    <Pill key={signal} tone="accent">
                      {t(`reports:signals.${signal}` as 'reports:signals.barren')}
                    </Pill>
                  ))}
                </View>
              ) : null}
            </Pressable>
          ))}
        </Screen>
      </ScrollView>
    </TabScreen>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>
        {value}
        {value === '—' ? '' : (suffix ?? '')}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.figure}>
      <Text style={styles.figureValue}>{value}</Text>
      <Text style={styles.figureLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.paper },
  gap: { height: spacing.lg },
  stats: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  stat: { flex: 1 },
  statValue: { fontSize: 24, fontWeight: '700', color: colors.ink },
  statLabel: { fontSize: type.caption, color: colors.muted },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  sectionLabel: {
    fontSize: type.caption,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
    fontWeight: '700',
  },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  rowFlagged: { borderStartWidth: 3, borderStartColor: colors.accent },
  pressed: { opacity: 0.85 },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  tag: { fontSize: type.heading, fontWeight: '700', color: colors.ink, writingDirection: 'ltr' },
  name: { fontSize: type.label, color: colors.muted },
  figures: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  figure: { flex: 1 },
  figureValue: { fontSize: type.heading, fontWeight: '600', color: colors.inkSoft },
  figureLabel: { fontSize: 11, color: colors.muted },
  signals: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
}));
