import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-screens/experimental';
import { SyncBanner } from '../sync/SyncBanner';
import { useTheme } from '../theme';

/** Screen insets include the native tab bar, whose height changes with the OS and device. */
export function TabScreen({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      edges={{ top: true, bottom: true, left: true, right: true }}
      style={{ flex: 1, backgroundColor: colors.paper }}
    >
      <SyncBanner />
      {children}
    </SafeAreaView>
  );
}
