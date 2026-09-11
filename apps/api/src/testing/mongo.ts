import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { applyMongooseSettings } from '../db.ts';

let server: MongoMemoryServer | undefined;

/** Start a throwaway MongoDB and connect mongoose to it. */
export async function startTestMongo(): Promise<string> {
  // The same settings the server runs with, so configuration bugs surface here first.
  applyMongooseSettings();
  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  await mongoose.connect(uri, { dbName: 'nasl-test' });
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
