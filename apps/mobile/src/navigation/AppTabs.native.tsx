import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';
import { can, type Role } from '@nasl/shared';
import { useAuth } from '../auth/AuthProvider';
import { useTheme } from '../theme';

export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation(['tasks', 'animals', 'reports', 'common']);
  const { me, farmId } = useAuth();
  const role = me?.farms.find((f) => f.farmId === farmId)?.role as Role | undefined;
  const showReports = role !== undefined && can(role, 'reports:read');

  // System Liquid Glass on iOS 26+, standard native tabs on earlier iOS, Material 3 on Android.
  // TabScreen handles all insets, including the changing native bar height.
  return (
    <NativeTabs
      backBehavior="history"
      tintColor={colors.accent}
      backgroundColor={colors.surface}
      iconColor={{ default: colors.ink, selected: colors.accent }}
      indicatorColor={colors.accentSoft}
      labelVisibilityMode="unlabeled"
      minimizeBehavior="never"
    >
      <NativeTabs.Trigger
        name="index"
        accessibilityLabel={t('tasks:title')}
        disableAutomaticContentInsets
      >
        <NativeTabs.Trigger.Icon sf="calendar" md="today" />
        <NativeTabs.Trigger.Label hidden>{t('tasks:title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="flock"
        accessibilityLabel={t('animals:title')}
        disableAutomaticContentInsets
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' }}
          md="format_list_bulleted"
        />
        <NativeTabs.Trigger.Label hidden>{t('animals:title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="reports"
        accessibilityLabel={t('reports:title')}
        hidden={!showReports}
        disableAutomaticContentInsets
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }}
          md="bar_chart"
        />
        <NativeTabs.Trigger.Label hidden>{t('reports:title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="settings"
        accessibilityLabel={t('common:settings')}
        disableAutomaticContentInsets
      >
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
        <NativeTabs.Trigger.Label hidden>{t('common:settings')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
