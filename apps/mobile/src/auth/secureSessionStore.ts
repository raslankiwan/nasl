interface Store {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** An iOS Keychain can survive reinstall; a fresh app installation must not inherit a session. */
export function createSecureSessionStore(legacy: Store, secure: Store): Store {
  let initialized: Promise<void> | undefined;
  const initialize = () => {
    initialized ??= (async () => {
      if (await legacy.getItem('nasl.secureSession.initialized')) return;
      for (const key of ['nasl.accessToken', 'nasl.refreshToken', 'nasl.deviceId'])
        await secure.removeItem(key);
      await legacy.setItem('nasl.secureSession.initialized', '1');
    })().catch((error: unknown) => {
      initialized = undefined;
      throw error;
    });
    return initialized;
  };
  return {
    async getItem(key) {
      await initialize();
      const value = await secure.getItem(key);
      if (value !== null) return value;
      const previous = await legacy.getItem(key);
      if (previous !== null) {
        await secure.setItem(key, previous);
        await legacy.removeItem(key);
      }
      return previous;
    },
    async setItem(key, value) {
      await initialize();
      await secure.setItem(key, value);
      await legacy.removeItem(key);
    },
    async removeItem(key) {
      await initialize();
      await secure.removeItem(key);
      await legacy.removeItem(key);
    },
  };
}
