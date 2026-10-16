import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

const env = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb://example/nasl',
  JWT_SECRET: 'x'.repeat(40),
};

test('production keeps a small pool and requires exact CORS origins', () => {
  assert.equal(loadConfig(env).MONGO_MAX_POOL_SIZE, 5);
  assert.throws(
    () => loadConfig({ ...env, CORS_ORIGINS: 'https://admin.example/path' }),
    /URL origins/,
  );
  assert.doesNotThrow(() =>
    loadConfig({ ...env, CORS_ORIGINS: 'https://admin.example,https://app.example' }),
  );
});
