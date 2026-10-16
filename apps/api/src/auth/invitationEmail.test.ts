import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invitationMailer } from './invitationEmail.ts';
import { testConfig } from '../testing/harness.ts';

test('email delivery uses the fixed sender, bound recipient, one-use URL and idempotency key', async (t) => {
  let sent: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.resend.com/emails');
    sent = options;
    return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
  });
  const config = testConfig({
    RESEND_API_KEY: 'test-key',
    ADMIN_INVITE_FROM: 'invites@example.test',
    ADMIN_APP_URL: 'https://admin.example.test',
  });
  await invitationMailer(config)!({
    id: 'invite-1',
    email: 'operator@example.test',
    url: 'https://admin.example.test/accept-invite#token=secret',
    locale: 'en',
  });
  const body = JSON.parse(String(sent?.body));
  assert.equal(body.from, 'Nasl <invites@example.test>');
  assert.deepEqual(body.to, ['operator@example.test']);
  assert.match(body.text, /expires in 24 hours/);
  assert.equal(new Headers(sent?.headers).get('Idempotency-Key'), 'admin-invite/invite-1');
});
test('provider errors never leak email bodies or credentials and missing configuration has no sender', async (t) => {
  assert.equal(invitationMailer(testConfig()), undefined);
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('provider secret and token', { status: 403 }),
  );
  const send = invitationMailer(
    testConfig({
      RESEND_API_KEY: 'test-key',
      ADMIN_INVITE_FROM: 'invites@example.test',
      ADMIN_APP_URL: 'https://admin.example.test',
    }),
  )!;
  await assert.rejects(
    send({
      id: 'invite-1',
      email: 'operator@example.test',
      url: 'https://admin.example.test/accept-invite#token=secret',
      locale: 'ar',
    }),
    (error: { code?: string; message?: string }) =>
      error.code === 'email_delivery_failed' && !error.message?.includes('secret'),
  );
});
