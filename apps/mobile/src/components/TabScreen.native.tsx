import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-screens/experimental';
import { SyncBanner } from '../sync/SyncBanner';
import { colors } from '../theme';

/** Screen insets include the native tab bar, whose height changes with the OS and device. */
export function TabScreen({ children }: { children: ReactNode }) {
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
