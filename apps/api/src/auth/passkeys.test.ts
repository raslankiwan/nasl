import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { clearDatabase, startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { signIn, testApp, TEST_DEVICE, TEST_PASSWORD, withServer } from '../testing/harness.ts';
import { Passkey, PasskeyChallenge } from '../models/passkey.model.ts';
import { User } from '../models/user.model.ts';
import { RefreshToken } from '../models/refreshToken.model.ts';

before(() => startTestMongo());
after(stopTestMongo);
beforeEach(clearDatabase);
const origin = 'https://app.example.test';
const rpId = 'app.example.test';
const config = { CORS_ORIGINS: `${origin},https://admin.example.test` };
const hash = (input: string | Uint8Array) => createHash('sha256').update(input).digest();
type Challenge = {
  challengeId: string;
  options: {
    challenge: string;
    authenticatorSelection?: { userVerification: string };
    userVerification?: string;
  };
};
function client(url: string, token?: string, requestOrigin = origin) {
  return async <T = unknown>(path: string, body?: unknown, method = 'POST') => {
    const response = await fetch(`${url}/v1/auth/passkeys${path}`, {
      method,
      headers: {
        origin: requestOrigin,
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  };
}
/** Software authenticator signs actual WebAuthn data; verification is never mocked. */
function authenticator(userId: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const id = randomBytes(32);
  const credentialId = id.toString('base64url');
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]),
  );
  const common = {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
  };
  const data = (type: string, challenge: string, at = origin) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: at, crossOrigin: false }));
  return {
    register(challenge: string, verified = true) {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        hash(rpId),
        Buffer.from([verified ? 0x45 : 0x41]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        length,
        id,
        Buffer.from(cose),
      ]);
      const attestation = isoCBOR.encode(
        new Map<string, string | Map<never, never> | Uint8Array>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
      return {
        ...common,
        response: {
          clientDataJSON: data('webauthn.create', challenge).toString('base64url'),
          attestationObject: Buffer.from(attestation).toString('base64url'),
          transports: ['internal'],
        },
      };
    },
    login(challenge: string, counter = 1, verified = true, at = origin) {
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authData = Buffer.concat([hash(rpId), Buffer.from([verified ? 5 : 1]), count]);
      const clientData = data('webauthn.get', challenge, at);
      return {
        ...common,
        response: {
          clientDataJSON: clientData.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: sign(
            'sha256',
            Buffer.concat([authData, hash(clientData)]),
            privateKey,
          ).toString('base64url'),
          userHandle: Buffer.from(userId).toString('base64url'),
        },
      };
    },
  };
}
async function enrolled(url: string) {
  const session = await signIn(url, 'passkey-user');
  const admin = client(url, session.accessToken);
  const auth = authenticator(session.user.id);
  const options = await admin<Challenge>('/register/options', {
    deviceId: TEST_DEVICE,
    password: TEST_PASSWORD,
    name: 'Test device',
  });
  assert.equal(options.status, 200);
  assert.equal(options.body.options.authenticatorSelection?.userVerification, 'required');
  assert.equal(
    (
      await admin('/register/verify', {
        deviceId: TEST_DEVICE,
        challengeId: options.body.challengeId,
        response: auth.register(options.body.options.challenge),
      })
    ).status,
    201,
  );
  return { session, auth, admin };
}
test('platform passkey enrollment and signed login work; replay and another user removing it do not', async () => {
  await withServer(testApp(config), async (url) => {
    const { session, auth, admin } = await enrolled(url);
    const publicClient = client(url);
    const options = await publicClient<Challenge>('/login/options', { deviceId: TEST_DEVICE });
    assert.equal(options.body.options.userVerification, 'required');
    const input = {
      deviceId: TEST_DEVICE,
      challengeId: options.body.challengeId,
      response: auth.login(options.body.options.challenge),
    };
    const logged = await publicClient<{ user: { id: string }; refreshToken: string }>(
      '/login/verify',
      input,
    );
    assert.equal(logged.status, 200);
    assert.equal(logged.body.user.id, session.user.id);
    assert.ok(logged.body.refreshToken);
    assert.equal((await publicClient('/login/verify', input)).status, 400);
    const keys = await admin<{ passkeys: Array<{ id: string; name: string }> }>(
      '/',
      undefined,
      'GET',
    );
    assert.equal(keys.body.passkeys[0]!.name, 'Test device');
    assert.equal(JSON.stringify(keys.body).includes('publicKey'), false);
    const other = await signIn(url, 'other-passkey-user');
    await client(url, other.accessToken)('/remove', { id: keys.body.passkeys[0]!.id });
    assert.equal(await Passkey.countDocuments(), 1);
    await admin('/remove', { id: keys.body.passkeys[0]!.id });
    assert.equal(await Passkey.countDocuments(), 0);
    const next = await publicClient<Challenge>('/login/options', { deviceId: TEST_DEVICE });
    assert.equal(
      (
        await publicClient('/login/verify', {
          deviceId: TEST_DEVICE,
          challengeId: next.body.challengeId,
          response: auth.login(next.body.options.challenge, 2),
        })
      ).status,
      400,
    );
  });
});
test('enrollment needs the account password, a trusted origin and verified user presence', async () => {
  await withServer(testApp(config), async (url) => {
    const session = await signIn(url, 'enroll-checks');
    const owner = client(url, session.accessToken);
    const input = { deviceId: TEST_DEVICE, password: TEST_PASSWORD, name: 'Phone' };
    assert.equal((await client(url)('/register/options', input)).status, 401);
    assert.equal((await owner('/register/options', { ...input, password: 'wrong' })).status, 401);
    assert.equal(
      (
        await client(
          url,
          session.accessToken,
          'https://evil.example.test',
        )('/register/options', input)
      ).status,
      403,
    );
    const challenge = await owner<Challenge>('/register/options', input);
    const response = authenticator(session.user.id).register(
      challenge.body.options.challenge,
      false,
    );
    assert.equal(
      (
        await owner('/register/verify', {
          deviceId: TEST_DEVICE,
          challengeId: challenge.body.challengeId,
          response,
        })
      ).status,
      400,
    );
    assert.equal(await Passkey.countDocuments(), 0);
  });
});
test('expired challenges, wrong device, wrong origin, forged signatures and missing user verification are rejected', async () => {
  await withServer(testApp(config), async (url) => {
    const { auth } = await enrolled(url);
    const send = client(url);
    for (const attack of ['expired', 'device', 'origin', 'signature', 'verification']) {
      const { body } = await send<Challenge>('/login/options', { deviceId: TEST_DEVICE });
      const response = auth.login(
        body.options.challenge,
        1,
        attack !== 'verification',
        attack === 'origin' ? 'https://evil.example.test' : origin,
      );
      if (attack === 'expired')
        await PasskeyChallenge.updateOne(
          { _id: body.challengeId },
          { $set: { expiresAt: new Date(0) } },
        );
      if (attack === 'signature')
        response.response.signature = randomBytes(64).toString('base64url');
      const result = await send('/login/verify', {
        deviceId: attack === 'device' ? 'different-device' : TEST_DEVICE,
        challengeId: body.challengeId,
        response,
      });
      assert.equal(result.status, 400, attack);
    }
    assert.equal(await RefreshToken.countDocuments(), 1);
  });
});
test('passkeys cannot bypass approval or email verification even after enrollment', async () => {
  await withServer(testApp(config), async (url) => {
    const { auth, session } = await enrolled(url);
    const send = client(url);
    for (const patch of [
      { status: 'pending' },
      { status: 'approved', emailVerificationRequired: true, emailVerifiedAt: null },
    ]) {
      await User.updateOne({ _id: session.user.id }, { $set: patch });
      const { body } = await send<Challenge>('/login/options', { deviceId: TEST_DEVICE });
      const result = await send('/login/verify', {
        deviceId: TEST_DEVICE,
        challengeId: body.challengeId,
        response: auth.login(body.options.challenge, patch.status === 'pending' ? 1 : 2),
      });
      assert.equal(result.status, 403);
    }
    assert.equal(await RefreshToken.countDocuments(), 1);
  });
});
