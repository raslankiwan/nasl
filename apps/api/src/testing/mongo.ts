import mongoose from 'mongoose';
import { MongoMemoryServer, MongoMemoryReplSet } from 'mongodb-memory-server';
import { applyMongooseSettings, ensureIndexes } from '../db.ts';

let server: MongoMemoryServer | MongoMemoryReplSet | undefined;

/** Start a throwaway MongoDB and connect mongoose to it. */
export async function startTestMongo(replicaSet = false): Promise<string> {
  // The same settings the server runs with, so configuration bugs surface here first.
  applyMongooseSettings();
  server = replicaSet
    ? await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    : await MongoMemoryServer.create();
  const uri = server.getUri();
  await mongoose.connect(uri, { dbName: 'nasl-test' });
  // Same as the server: no test runs until the unique indexes it relies on actually exist.
  await ensureIndexes();
  return uri;
}

export async function stopTestMongo(): Promise<void> {
  await mongoose.disconnect();
  await server?.stop();
  server = undefined;
}

/** Empty every collection between tests, without dropping indexes. */
export async function clearDatabase(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
