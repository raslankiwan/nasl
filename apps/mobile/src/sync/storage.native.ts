import AsyncStorage from '@react-native-async-storage/async-storage';
import { tolerant, type KeyValueStore } from './storage.ts';

/** The device store. Isolated in its own module so nothing testable has to import React Native. */
export const deviceStore: KeyValueStore = tolerant({
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
});
