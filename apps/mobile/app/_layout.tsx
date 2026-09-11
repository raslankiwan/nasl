import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { initI18n } from '../src/i18n';
import { SyncProvider } from '../src/sync/SyncProvider';
import { colors } from '../src/theme';

function Loading() {
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

/** Keeps the visible route in step with whether there is a session. */
function AuthGate() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    /**
     * The gate decides on authentication alone, not on which route group you are in. Keying it to
     * `(tabs)` bounced every legitimate route outside that group — the animal detail screen among
     * them — straight back to the home tab.
     */
    const onSignIn = segments[0] === 'sign-in';

    if (status === 'signedOut' && !onSignIn) router.replace('/sign-in');
    else if (status === 'signedIn' && onSignIn) router.replace('/(tabs)');
  }, [status, segments, router]);

  if (status === 'loading') return <Loading />;
  return <Slot />;
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  // Language and layout direction are settled before anything renders, so the app never flips
  // direction in front of the user (scope NFR-06).
  useEffect(() => {
    void initI18n().then(() => setReady(true));
  }, []);

  if (!ready) return <Loading />;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <SyncProvider>
          <AuthGate />
        </SyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
