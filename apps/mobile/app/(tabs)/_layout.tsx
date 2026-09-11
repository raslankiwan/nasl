import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, type } from '../../src/theme';

export default function TabsLayout() {
  const { t } = useTranslation(['tasks', 'animals', 'common']);

  return (
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
      <Tabs.Screen name="settings" options={{ title: t('common:settings') }} />
    </Tabs>
  );
}
