import '../src/polyfills';

import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DefaultTheme, DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { SupportFrame } from '../src/auth/SupportFrame';
import { BiometricGate } from '../src/auth/BiometricGate';
import { initI18n } from '../src/i18n';
import { SyncProvider } from '../src/sync/SyncProvider';
import { AppearanceProvider, useTheme } from '../src/theme';

function Loading() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.paper,
      }}
    >
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

// Deep links keep a root destination underneath detail screens.
export const unstable_settings = { initialRouteName: '(tabs)' };

function AuthGate() {
  const { colors } = useTheme();
  const { status } = useAuth();
  if (status === 'loading') return <Loading />;
  return (
    <Stack
      screenOptions={{
        title: '',
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.paper },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.paper },
      }}
    >
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="notification" options={{ headerShown: false }} />
        <Stack.Screen name="animal/new" />
        <Stack.Screen name="animal/promote" />
        <Stack.Screen name="animal/sell" />
        <Stack.Screen name="animal/status" />
        <Stack.Screen name="animal/[id]" />
        <Stack.Screen name="animal/pedigree" />
        <Stack.Screen name="animal/move" />
        <Stack.Screen name="animal/weigh" />
        <Stack.Screen name="pens/index" />
        <Stack.Screen name="pens/[id]" />
        <Stack.Screen name="health/schedule" />
        <Stack.Screen name="health/cabinet" />
        <Stack.Screen name="health/withdrawal" />
        <Stack.Screen name="health/treat" />
        <Stack.Screen name="milk/test-day" />
        <Stack.Screen name="milk/collection" />
        <Stack.Screen name="milk/disposition" />
        <Stack.Screen name="breeding/mating" />
        <Stack.Screen name="breeding/check" />
        <Stack.Screen name="breeding/birth" />
        <Stack.Screen name="breeding/abortion" />
        <Stack.Screen name="breeding/weaning" />
      </Stack.Protected>
    </Stack>
  );
}

function AppLayout() {
  const { colors, dark, ready: themeReady } = useTheme();
  const [ready, setReady] = useState(false);
  const base = dark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.paper,
      card: colors.paper,
      text: colors.ink,
      border: colors.line,
    },
  };

  // Language and layout direction are settled before anything renders, so the app never flips
  // direction in front of the user (scope NFR-06).
  useEffect(() => {
    void initI18n().then(() => setReady(true));
  }, []);

  if (!ready || !themeReady) return <Loading />;

  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <AuthProvider>
        <SyncProvider>
          <ThemeProvider value={navigationTheme}>
            <SupportFrame>
              <BiometricGate>
                <AuthGate />
              </BiometricGate>
            </SupportFrame>
          </ThemeProvider>
        </SyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <AppearanceProvider>
      <AppLayout />
    </AppearanceProvider>
  );
}
