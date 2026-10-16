import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

const env = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb://example/nasl',
  JWT_SECRET: 'x'.repeat(40),
};

test('production defaults to no SMS spending and rejects development code exposure', () => {
  assert.equal(loadConfig(env).SMS_PROVIDER, 'disabled');
  assert.equal(loadConfig(env).MONGO_MAX_POOL_SIZE, 5);
  assert.throws(() => loadConfig({ ...env, SMS_PROVIDER: 'log' }), /Development codes/);
});

test('Twilio requires all credentials and CORS requires exact origins', () => {
  assert.throws(() => loadConfig({ ...env, SMS_PROVIDER: 'twilio' }), /Required for Twilio/);
  assert.throws(
    () => loadConfig({ ...env, CORS_ORIGINS: 'https://admin.example/path' }),
    /URL origins/,
  );
  assert.doesNotThrow(() =>
    loadConfig({ ...env, CORS_ORIGINS: 'https://admin.example,https://app.example' }),
  );
});
