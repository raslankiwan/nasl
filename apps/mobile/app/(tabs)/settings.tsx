import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LOCALE_META, type Locale } from '@nasl/i18n';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Card, NavigationRow, RowGroup, Screen, Title } from '../../src/components/ui';
import { TabScreen } from '../../src/components/TabScreen';
import { LanguageToggle } from '../../src/components/LanguageToggle';
import { spacing } from '../../src/theme';

export default function Settings() {
  const { t, i18n } = useTranslation(['common', 'auth', 'roles', 'pens', 'health', 'milk']);
  const router = useRouter();
  const { me, farmId, signOut } = useAuth();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const role = me?.farms.find((f) => f.farmId === farmId)?.role;

  return (
    <TabScreen>
      <ScrollView>
        <Screen>
          <Title>{t('common:settings')}</Title>
          <Card>
            <Body>{me?.name ?? t('common:unknown')}</Body>
            {role ? <Body muted>{t(`roles:${role}` as 'roles:owner')}</Body> : null}
          </Card>
          <View style={styles.gap} />
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
          <RowGroup>
            <NavigationRow
              label={t('pens:title')}
              icon="barn"
              onPress={() => router.push('/pens')}
            />
          </RowGroup>
          <RowGroup>
            <NavigationRow
              label={t('milk:testDay')}
              icon="clipboard-check-outline"
              onPress={() => router.push('/milk/test-day')}
            />
            <NavigationRow
              label={t('milk:collection')}
              icon="pail-outline"
              onPress={() => router.push('/milk/collection')}
            />
            <NavigationRow
              label={t('milk:disposition')}
              icon="truck-outline"
              onPress={() => router.push('/milk/disposition')}
            />
          </RowGroup>
          <RowGroup>
            <NavigationRow
              label={t('health:cabinet')}
              icon="medical-bag"
              onPress={() => router.push('/health/cabinet')}
            />
            <NavigationRow
              label={t('health:schedule')}
              icon="calendar-heart"
              onPress={() => router.push('/health/schedule')}
            />
          </RowGroup>
          <RowGroup>
            <NavigationRow
              label={t('auth:signOut')}
              icon="logout"
              destructive
              onPress={() => void signOut()}
            />
          </RowGroup>
        </Screen>
      </ScrollView>
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  rowText: { flexShrink: 1, gap: 2 },
  gap: { height: spacing.lg },
});
