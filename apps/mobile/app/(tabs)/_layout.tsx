import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { can, type Role } from '@nasl/shared';
import { useAuth } from '../../src/auth/AuthProvider';
import { SyncBanner } from '../../src/sync/SyncBanner';
import { colors, type } from '../../src/theme';

export default function TabsLayout() {
  const { t } = useTranslation(['tasks', 'animals', 'reports', 'common']);
  const { me, farmId } = useAuth();

  /**
   * Reports are the owner's, not the shepherd's: recording what happened and deciding which ewes
   * stay are different jobs. Rather than showing a tab that answers 403, the permission matrix
   * from @nasl/shared decides whether it exists at all.
   */
  const insets = useSafeAreaInsets();
  const role = me?.farms.find((f) => f.farmId === farmId)?.role as Role | undefined;
  const showReports = role !== undefined && can(role, 'reports:read');

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.paper }}>
      <SyncBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
          tabBarLabelStyle: { fontSize: type.caption, fontWeight: '600' },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t('tasks:title') }} />
        <Tabs.Screen name="flock" options={{ title: t('animals:title') }} />
        <Tabs.Screen
          name="reports"
          options={{ title: t('reports:title'), href: showReports ? undefined : null }}
        />
        <Tabs.Screen name="settings" options={{ title: t('common:settings') }} />
      </Tabs>
    </View>
  );
}
