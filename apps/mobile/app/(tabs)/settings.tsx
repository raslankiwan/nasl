import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LOCALE_META, type Locale } from '@nasl/i18n';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Card, Screen, Title } from '../../src/components/ui';
import { LanguageToggle } from '../../src/components/LanguageToggle';
import { colors, spacing } from '../../src/theme';

export default function Settings() {
  const { t, i18n } = useTranslation(['common', 'auth', 'roles', 'pens', 'health']);
  const router = useRouter();
  const { me, farmId, signOut } = useAuth();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const role = me?.farms.find((f) => f.farmId === farmId)?.role;

  return (
    <View style={styles.root}>
      <ScrollView>
        <Screen>
          <Title>{t('common:settings')}</Title>

          <Card>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Body>{t('common:language')}</Body>
                <Body muted>{LOCALE_META[locale].nativeLabel}</Body>
              </View>
              <LanguageToggle />
            </View>
          </Card>

          <View style={styles.gap} />

          <Card>
            <Body>{me?.name ?? t('common:unknown')}</Body>
            {role ? <Body muted>{t(`roles:${role}` as 'roles:owner')}</Body> : null}
          </Card>

          <View style={styles.gap} />

          <Button
            label={t('pens:title')}
            variant="secondary"
            onPress={() => router.push('/pens')}
          />

          <View style={styles.gap} />

          <Button
            label={t('health:cabinet')}
            variant="secondary"
            onPress={() => router.push('/health/cabinet')}
          />

          <View style={styles.gap} />

          <Button label={t('auth:signOut')} variant="secondary" onPress={() => void signOut()} />
        </Screen>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  rowText: { flexShrink: 1, gap: 2 },
  gap: { height: spacing.md },
});
