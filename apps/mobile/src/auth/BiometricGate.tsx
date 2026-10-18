import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthProvider';
import {
  biometricUser,
  authenticateDevice,
  setBiometricUser,
  subscribeBiometrics,
} from './nativeBiometrics';
import { Body, Button, Title } from '../components/ui';
import { useTheme, spacing } from '../theme';

/** Cover the existing screen, preserving unsaved forms while the app is locked. */
export function BiometricGate({ children }: { children: ReactNode }) {
  const { me, status, signOut } = useAuth();
  const { t } = useTranslation('auth');
  const { colors } = useTheme();
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const load = () => {
      void biometricUser()
        .then(setOwner)
        .catch(() => setOwner('unavailable'));
    };
    load();
    return subscribeBiometrics(() => {
      load();
      setUnlocked(true);
    });
  }, []);
  useEffect(() => {
    setUnlocked(false);
  }, [me?.id]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') setUnlocked(false);
    });
    return () => subscription.remove();
  }, []);
  const locked =
    status === 'signedIn' &&
    (owner === undefined || ((owner === me?.id || owner === 'unavailable') && !unlocked));
  const unlock = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (await authenticateDevice(t('unlock'))) setUnlocked(true);
    } catch {
      /* Remain locked. The user can retry or sign out and use their password. */
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1, opacity: locked ? 0 : 1 }}
        pointerEvents={locked ? 'none' : 'auto'}
        accessibilityElementsHidden={locked}
        importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {locked ? (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: colors.paper,
            justifyContent: 'center',
            padding: spacing.lg,
            gap: spacing.lg,
          }}
        >
          {owner === undefined ? (
            <ActivityIndicator />
          ) : (
            <>
              <Title>{t('appLocked')}</Title>
              <Body>{t('biometricHint')}</Body>
              <Button label={t('unlock')} busy={busy} onPress={() => void unlock()} />
              <Button
                label={t('usePassword')}
                variant="text"
                disabled={busy}
                onPress={() =>
                  void (async () => {
                    await signOut();
                    await setBiometricUser(null);
                  })()
                }
              />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}
