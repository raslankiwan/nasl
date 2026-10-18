import { Animal } from '../src/models/animal.model.ts';
import { AnimalNumber } from '../src/models/animalNumber.model.ts';
import { Farm } from '../src/models/farm.model.ts';
import { AnimalRepository } from '../src/repositories/animal.repository.ts';
import { connectDatabase, disconnectDatabase } from '../src/db.ts';
import { createLogger } from '../src/logger.ts';

// Read-only by default. Never silently renumber historical animals to make an index build pass.
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Load MONGODB_URI securely before running this script.');
try {
  await connectDatabase(uri, createLogger('silent', false), {
    createIndexes: false,
    dbName: process.env.MONGODB_DB_NAME,
  });
  const animals = new AnimalRepository();
  const farms = await Farm.find().select('_id').lean();
  let conflicts = 0;
  for (const farm of farms) {
    const seen = new Set<string>();
    for (const animal of await animals.find(
      farm._id,
      {},
      { includeDeleted: true, projection: { tagNumber: 1 } },
    )) {
      if (seen.has(animal.tagNumber)) conflicts++;
      seen.add(animal.tagNumber);
    }
  }
  if (conflicts)
    throw new Error(
      `${conflicts} historical number conflicts need an explicit correction before deployment.`,
    );
  console.log(`Checked ${farms.length} farms: no historical number conflicts.`);
  if (process.argv.includes('--apply')) {
    await Animal.createIndexes();
    await AnimalNumber.createIndexes();
    console.log(
      'Permanent tag uniqueness and farm-number sequence indexes are ready. Existing numbers are unchanged.',
    );
  }
} finally {
  await disconnectDatabase();
}
