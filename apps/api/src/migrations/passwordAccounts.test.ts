import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import mongoose from 'mongoose';
import { startTestMongo, stopTestMongo } from '../testing/mongo.ts';
import { User } from '../models/user.model.ts';
import { preparePasswordAccounts } from './passwordAccounts.ts';

before(() => startTestMongo());
after(stopTestMongo);
test('migration preserves legacy records, removes the phone uniqueness constraint and is repeatable', async () => {
  const raw = mongoose.connection.collection('users');
  await raw.insertOne({ _id: 'legacy', phone: '+970590000000', isPlatformAdmin: true });
  await raw.createIndex({ phone: 1 }, { unique: true });
  await preparePasswordAccounts();
  await preparePasswordAccounts();
  const legacy = await raw.findOne({ _id: 'legacy' });
  assert.equal(legacy?.phone, '+970590000000');
  assert.equal(legacy?.isPlatformAdmin, true);
  assert.equal(legacy?.status, 'pending');
  for (const username of ['one', 'two']) {
    await User.create({ username, email: `${username}@example.test`, passwordHash: 'fixture' });
  }
  assert.equal(await User.countDocuments(), 3);
  assert.ok(!(await raw.indexes()).some((index) => index.key.phone));
  await assert.rejects(
    User.create({ username: 'one', email: 'three@example.test', passwordHash: 'fixture' }),
    { code: 11000 },
  );
});
