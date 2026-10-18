import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

const key = 'nasl.biometric.user';
const listeners = new Set<() => void>();
export const biometricUser = () => AsyncStorage.getItem(key);
export async function biometricSupport() {
  return (
    (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
  );
}
export async function authenticateDevice(promptMessage: string) {
  return (
    await LocalAuthentication.authenticateAsync({
      promptMessage,
      biometricsSecurityLevel: 'strong',
      disableDeviceFallback: false,
    })
  ).success;
}
export async function setBiometricUser(userId: string | null) {
  if (userId) await AsyncStorage.setItem(key, userId);
  else await AsyncStorage.removeItem(key);
  for (const listener of listeners) listener();
}
export function subscribeBiometrics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
