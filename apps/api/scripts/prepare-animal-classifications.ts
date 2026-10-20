import { classificationError, type AnimalClass } from '@nasl/shared';
import { randomUUID } from 'node:crypto';
import type { UpdateQuery } from 'mongoose';
import { Animal, type AnimalDoc } from '../src/models/animal.model.ts';
import { Farm } from '../src/models/farm.model.ts';
import { Birth, Mating, type BirthDoc, type MatingDoc } from '../src/models/breeding.model.ts';
import { ImpersonationSession } from '../src/models/impersonationSession.model.ts';
import { AnimalRepository } from '../src/repositories/animal.repository.ts';
import { TenantRepository } from '../src/repositories/tenantRepository.ts';
import { connectDatabase, disconnectDatabase } from '../src/db.ts';
import { createLogger } from '../src/logger.ts';
import { recordAudit } from '../src/models/auditLog.model.ts';

class MigrationAnimals extends AnimalRepository {
  async assign(farmId: string, id: string, update: UpdateQuery<AnimalDoc>) {
    return this.model.updateOne(this.scope(farmId, { _id: id, classLabel: null }, true), update);
  }
}
// Dry run first. Existing permanent numbers, relationships and recorded events are preserved.
if (!process.env.MONGODB_URI) throw new Error('Load MONGODB_URI securely first.');
const apply = process.argv.includes('--apply');
try {
  await connectDatabase(process.env.MONGODB_URI, createLogger('silent', false), {
    createIndexes: false,
    dbName: process.env.MONGODB_DB_NAME,
  });
  const animals = new MigrationAnimals();
  const births = new TenantRepository<BirthDoc>(Birth);
  const matings = new TenantRepository<MatingDoc>(Mating);
  const counts: Record<AnimalClass, number> = { mother: 0, child: 0, male: 0 };
  let missingBirthDate = 0;
  if (apply) {
    await Animal.createIndexes();
    await ImpersonationSession.createIndexes();
  }
  for (const farm of await Farm.find().select('_id').lean()) {
    const [rows, born, mated] = await Promise.all([
      animals.find(farm._id, {}, { includeDeleted: true, sort: { createdAt: 1, _id: 1 } }),
      births.find(farm._id, {}, { includeDeleted: true }),
      matings.find(farm._id, {}, { includeDeleted: true }),
    ]);
    const mothers = new Set([
      ...rows.map((a) => a.damId),
      ...born.map((b) => b.damId),
      ...mated.map((m) => m.damId),
    ]);
    const sires = new Set([
      ...rows.map((a) => a.sireId),
      ...born.map((b) => b.sireId),
      ...mated.map((m) => m.sireId),
    ]);
    for (const animal of rows) {
      if (animal.classification && animal.classLabel) continue;
      const adult = animal.sex === 'female' ? 'mother' : 'male';
      const breedingEvidence =
        adult === 'mother'
          ? mothers.has(animal._id) || Boolean(animal.repro)
          : sires.has(animal._id);
      const classification =
        breedingEvidence || !classificationError(animal, adult) ? adult : 'child';
      counts[classification]++;
      if (classification === 'child' && !animal.dateOfBirth) missingBirthDate++;
      if (!apply) continue;
      const assignment = await animals.classAssignment(farm._id, classification);
      await recordAudit({
        actorId: 'system:classification-migration',
        action: 'animal.classification.migrate',
        targetType: 'farm',
        targetId: farm._id,
        reason: breedingEvidence
          ? 'Historical breeding evidence'
          : animal.dateOfBirth
            ? 'Recorded age'
            : 'Birth date unknown; retained as child',
        before: {
          animalId: animal._id,
          classification: animal.classification ?? null,
          classLabel: animal.classLabel ?? null,
          activeClassLabel: animal.activeClassLabel ?? null,
        },
        after: { animalId: animal._id, ...assignment },
      });
      await animals.assign(farm._id, animal._id, {
        $set: {
          ...assignment,
          ...(['sold', 'dead'].includes(animal.status) ? { activeClassLabel: null } : {}),
        },
        $push: {
          lifecycle: {
            id: randomUUID(),
            kind: 'classification',
            from: 'unclassified',
            to: classification,
            date: new Date(),
            recordedBy: 'system:classification-migration',
            classLabel: assignment.classLabel,
          },
        },
      });
    }
  }
  console.log(
    JSON.stringify({
      applied: apply,
      classifications: counts,
      childrenNeedingBirthDateBeforePromotion: missingBirthDate,
    }),
  );
} finally {
  await disconnectDatabase();
}
