import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { lambingWindow, profileFor, type Species } from '@nasl/shared';
import { createThemedStyles, spacing, type } from '../theme';

export function LambingWindow({ dueDate, species }: { dueDate: string | Date; species: Species }) {
  const { t, i18n } = useTranslation('breeding');
  const styles = useStyles();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const window = lambingWindow(new Date(dueDate), species);
  const range = profileFor(species).gestationRangeDays;
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t(range ? 'lambingWindow' : 'dueDate')}</Text>
      <Text style={styles.date}>
        {range
          ? `${formatDate(window.from, locale)} – ${formatDate(window.to, locale)}`
          : formatDate(window.from, locale)}
      </Text>
      <Text style={styles.hint}>
        {range
          ? `${formatHijriDate(window.from, locale)} – ${formatHijriDate(window.to, locale)}`
          : formatHijriDate(window.from, locale)}
      </Text>
      {range ? (
        <Text style={styles.hint}>{t('gestationRange', { from: range[0], to: range[1] })}</Text>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  container: { gap: spacing.xs, paddingVertical: spacing.md },
  label: { fontSize: type.label, color: colors.muted },
  date: { fontSize: type.body, color: colors.ink, fontWeight: '600' },
  hint: { fontSize: type.caption, color: colors.muted },
}));
