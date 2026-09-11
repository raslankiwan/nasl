import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Card, Screen, Title } from '../../src/components/ui';
import { colors, spacing, type } from '../../src/theme';

/**
 * The home screen is a list of what needs doing, not a dashboard (scope FR-ALT-01).
 * The alert sources arrive with breeding in Increment 6; until then it shows the day itself.
 */
export default function Today() {
  const { t, i18n } = useTranslation(['tasks', 'common']);
  const { me } = useAuth();
  const insets = useSafeAreaInsets();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const today = new Date();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Screen>
          <Title>{t('tasks:title')}</Title>

          <Card>
            <Body>{formatDate(today, locale, { dateStyle: 'full' })}</Body>
            {/* Both calendars, always. The customer's year runs on Hijri dates (FR-LOC-01). */}
            <Body muted>{formatHijriDate(today, locale, { dateStyle: 'long' })}</Body>
          </Card>

          <View style={styles.gap} />

          <Card>
            <Body>{t('tasks:allClear')}</Body>
            {me?.name ? <Body muted>{me.name}</Body> : null}
          </Card>
        </Screen>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { flexGrow: 1 },
  gap: { height: spacing.md },
  caption: { fontSize: type.caption },
});
