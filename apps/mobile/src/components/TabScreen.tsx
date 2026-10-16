import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SyncBanner } from '../sync/SyncBanner';
import { useTheme } from '../theme';

export function TabScreen({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingBottom: 92 }}>
      <SyncBanner />
      {children}
    </View>
  );
}
