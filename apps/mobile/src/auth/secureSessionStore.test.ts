import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecureSessionStore } from './secureSessionStore.ts';
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
    async removeItem(key: string) {
      values.delete(key);
    },
  };
}
test('existing native sessions migrate only after a secure write succeeds', async () => {
  const legacy = memory(),
    secure = memory();
  await legacy.setItem('nasl.refreshToken', 'old-session');
  const store = createSecureSessionStore(legacy, secure);
  secure.setItem = async () => {
    throw new Error('Keychain unavailable');
  };
  await assert.rejects(() => store.getItem('nasl.refreshToken'));
  assert.equal(await legacy.getItem('nasl.refreshToken'), 'old-session');
  secure.setItem = async (key, value) => {
    secure.values.set(key, value);
  };
  assert.equal(await store.getItem('nasl.refreshToken'), 'old-session');
  assert.equal(await legacy.getItem('nasl.refreshToken'), null);
  assert.equal(await secure.getItem('nasl.refreshToken'), 'old-session');
});
test('a fresh installation discards surviving Keychain credentials; a normal restart retains them', async () => {
  const legacy = memory(),
    secure = memory();
  await secure.setItem('nasl.refreshToken', 'previous-install');
  const store = createSecureSessionStore(legacy, secure);
  assert.equal(await store.getItem('nasl.refreshToken'), null);
  await store.setItem('nasl.refreshToken', 'current-install');
  assert.equal(
    await createSecureSessionStore(legacy, secure).getItem('nasl.refreshToken'),
    'current-install',
  );
  await store.removeItem('nasl.refreshToken');
  assert.equal(await store.getItem('nasl.refreshToken'), null);
});
