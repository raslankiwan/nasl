import type { ReactNode } from 'react';
import { I18nManager, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { IconButton } from './ui';

/** Native back gestures and headers, with a way home for direct links without history. */
export function ScreenHeader({ title, action }: { title: string; action?: ReactNode }) {
  const router = useRouter();
  const { t, i18n } = useTranslation('common');
  const rtl = Platform.OS === 'web' ? i18n.dir() === 'rtl' : I18nManager.isRTL;
  return (
    <Stack.Screen
      options={{
        title,
        headerRight: action ? () => action : undefined,
        headerLeft: router.canGoBack()
          ? undefined
          : () => (
              <IconButton
                label={t('back')}
                icon={
                  Platform.OS === 'ios'
                    ? rtl
                      ? 'chevron-right'
                      : 'chevron-left'
                    : rtl
                      ? 'arrow-right'
                      : 'arrow-left'
                }
                onPress={() => router.replace('/(tabs)/flock')}
              />
            ),
      }}
    />
  );
}
