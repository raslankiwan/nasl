import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { pregnancyTimeline, profileFor, type Species } from '@nasl/shared';
import { radius, spacing, type, createThemedStyles } from '../theme';

/**
 * Where a carrying female is in her pregnancy, in calendar months and days, with every date that
 * matters between mating and lambing. Derived from the cached due date alone, so it works offline.
 */
export function PregnancyTimeline({
  dueDate,
  species,
  today,
}: {
  dueDate: string;
  species: Species;
  today: Date;
}) {
  const styles = useStyles();
  const { t, i18n } = useTranslation('breeding');
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const timeline = pregnancyTimeline(dueDate, species, today);
  const hasRange = Boolean(profileFor(species).gestationRangeDays);
  const progress = Math.min(1, Math.max(0, timeline.gestationDay / timeline.gestationDays));

  const day = (date: Date) => formatDate(date, locale);
  const range = (window: { from: Date; to: Date }) => `${day(window.from)} – ${day(window.to)}`;
  const hijriWindow = `${formatHijriDate(timeline.window.from, locale)} – ${formatHijriDate(timeline.window.to, locale)}`;

  const windowStatus =
    timeline.daysToWindowStart > 0
      ? t('daysToWindow', { count: timeline.daysToWindowStart })
      : timeline.daysToWindowEnd > 0
        ? t('daysLeftInWindow', { count: timeline.daysToWindowEnd })
        : timeline.daysToWindowEnd === 0
          ? t('withinWindow')
          : t('pastWindow', { count: -timeline.daysToWindowEnd });

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t('pregnancyTimeline')}</Text>

      <Text style={styles.headline}>
        {t('gestationProgress', { day: timeline.gestationDay, total: timeline.gestationDays })}
      </Text>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: timeline.gestationDays, now: timeline.gestationDay }}
      >
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>

      <Text style={styles.line}>
        {t('sinceMating', { months: timeline.elapsed.months, days: timeline.elapsed.days })}
      </Text>
      <Text style={styles.line}>
        {timeline.daysToDue >= 0
          ? t('leftToDue', { months: timeline.remaining.months, days: timeline.remaining.days })
          : t('overdueBy', { count: -timeline.daysToDue })}
      </Text>
      {timeline.daysToDue >= 0 ? (
        <Text style={styles.line}>{t('dueIn', { count: timeline.daysToDue })}</Text>
      ) : null}
      {hasRange ? <Text style={styles.status}>{windowStatus}</Text> : null}

      <View style={styles.dates}>
        <DateRow label={t('matingDate')} value={day(timeline.matingDate)} />
        <DateRow label={t('scanWindow')} value={range(timeline.scan)} />
        <DateRow label={t('preLambingBooster')} value={range(timeline.booster)} />
        <DateRow label={t('dropPen')} value={day(timeline.dropPenDate)} />
        {hasRange ? (
          <DateRow
            label={t('lambingWindow')}
            value={range(timeline.window)}
            hint={hijriWindow}
          />
        ) : null}
        <DateRow
          label={t('referenceDueDate', { day: timeline.gestationDays })}
          value={day(timeline.dueDate)}
          hint={formatHijriDate(timeline.dueDate, locale)}
        />
      </View>
    </View>
  );
}

function DateRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValue}>
        <Text style={styles.value}>{value}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  container: { gap: spacing.xs, paddingVertical: spacing.md },
  heading: { fontSize: type.label, color: colors.muted, fontWeight: '700' },
  headline: { fontSize: type.heading, color: colors.ink, fontWeight: '700' },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginVertical: spacing.xs,
  },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },
  line: { fontSize: type.body, color: colors.ink },
  status: { fontSize: type.body, color: colors.accent, fontWeight: '600' },
  dates: { marginTop: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowLabel: { fontSize: type.label, color: colors.muted, flexShrink: 1 },
  rowValue: { alignItems: 'flex-end', flexShrink: 1 },
  value: { fontSize: type.body, color: colors.ink, fontWeight: '500', textAlign: 'right' },
  hint: { fontSize: type.caption, color: colors.muted, textAlign: 'right' },
}));
