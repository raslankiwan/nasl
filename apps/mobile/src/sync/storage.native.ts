import { isImpersonating } from '../auth/impersonation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type KeyValueStore } from './storage.ts';

/** The device store. Isolated in its own module so nothing testable has to import React Native. */
const supportMemory = new Map<string, string>();
export const deviceStore: KeyValueStore = {
  get: (key) =>
    isImpersonating() ? Promise.resolve(supportMemory.get(key) ?? null) : AsyncStorage.getItem(key),
  set: async (key, value) => {
    if (isImpersonating()) supportMemory.set(key, value);
    else await AsyncStorage.setItem(key, value);
  },
  remove: async (key) => {
    if (isImpersonating()) supportMemory.delete(key);
    else await AsyncStorage.removeItem(key);
  },
};
