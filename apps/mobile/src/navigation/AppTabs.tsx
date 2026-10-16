import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { can, type Role } from '@nasl/shared';
import { useAuth } from '../auth/AuthProvider';
import { colors } from '../theme';

export default function TabsLayout() {
  const { t } = useTranslation(['tasks', 'animals', 'reports', 'common']);
  const { me, farmId } = useAuth();

  /**
   * Reports are the owner's, not the shepherd's: recording what happened and deciding which ewes
   * stay are different jobs. Rather than showing a tab that answers 403, the permission matrix
   * from @nasl/shared decides whether it exists at all.
   */
  const role = me?.farms.find((f) => f.farmId === farmId)?.role as Role | undefined;
  const showReports = role !== undefined && can(role, 'reports:read');

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.ink,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 12,
          left: 12,
          right: 12,
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          borderRadius: 34,
          height: 68,
          padding: 6,
          boxShadow: '0 6px 24px rgba(22, 35, 59, 0.12)',
        },
        tabBarActiveBackgroundColor: colors.accentSoft,
        tabBarItemStyle: { borderRadius: 28, marginHorizontal: 2, overflow: 'hidden' },
        tabBarIconStyle: { width: 30, height: 30 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tasks:title'),
          tabBarAccessibilityLabel: t('tasks:title'),
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'calendar-check' : 'calendar-check-outline'}
              size={28}
              color={color}
              accessible={false}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="flock"
        options={{
          title: t('animals:title'),
          tabBarAccessibilityLabel: t('animals:title'),
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="sheep" size={28} color={color} accessible={false} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: t('reports:title'),
          tabBarAccessibilityLabel: t('reports:title'),
          href: showReports ? undefined : null,
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="chart-bar" size={28} color={color} accessible={false} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('common:settings'),
          tabBarAccessibilityLabel: t('common:settings'),
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'cog' : 'cog-outline'}
              size={28}
              color={color}
              accessible={false}
            />
          ),
        }}
      />
    </Tabs>
  );
}
