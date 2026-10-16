import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FlockCache, toCachedAnimal } from './cache.ts';
import { memoryStore, type KeyValueStore } from './storage.ts';

/**
 * The cache is what a herder reads in a pen with no signal. These cover the merge decisions that
 * determine whether the flock on screen matches the flock in the yard.
 */

let store: KeyValueStore;
let cache: FlockCache;

const FARM = 'farm-1';

const doc = (id: string, over: Record<string, unknown> = {}) => ({
  _id: id,
  tagNumber: id,
  species: 'sheep',
  sex: 'female',
  status: 'active',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

const changes = (
  animals: Partial<{
    created: Record<string, unknown>[];
    updated: Record<string, unknown>[];
    deleted: string[];
  }>,
  timestamp = '2026-06-01T12:00:00.000Z',
) => ({
  timestamp,
  changes: { animals: { created: [], updated: [], deleted: [], ...animals } },
});

beforeEach(() => {
  store = memoryStore();
  cache = new FlockCache(store);
});

describe('folding in a change set', () => {
  test('a confirmed label edit survives restart without skipping other changes in the next pull', async () => {
    await cache.applyChanges(FARM, changes({ created: [doc('0012'), doc('20')] }));
    const cursor = await cache.cursor(FARM);
    await cache.storeAnimal(
      FARM,
      doc('0012', { name: 'ريم', updatedAt: '2026-06-02T00:00:00.000Z' }),
    );
    const restarted = new FlockCache(store);
    assert.equal((await restarted.getAnimal(FARM, '0012'))?.name, 'ريم');
    assert.equal((await restarted.getAnimal(FARM, '0012'))?.tagNumber, '0012');
    assert.equal((await restarted.listAnimals(FARM)).length, 2);
    assert.equal(
      await restarted.cursor(FARM),
      cursor,
      'a single write must not advance past unsynced records',
    );
    assert.equal(await restarted.getAnimal('another-farm', '0012'), null);
    await restarted.storeAnimal(FARM, doc('0012', { name: null }));
    assert.equal((await new FlockCache(store).getAnimal(FARM, '0012'))?.name, null);
  });

  test('created animals are stored and read back sorted by tag', async () => {
    await cache.applyChanges(FARM, changes({ created: [doc('1010'), doc('1002')] }));

    const animals = await cache.listAnimals(FARM);
    assert.deepEqual(
      animals.map((a) => a.tagNumber),
      ['1002', '1010'],
      'numerically, so 1002 precedes 1010',
    );
  });

  test('an update replaces the animal rather than appending it', async () => {
    await cache.applyChanges(FARM, changes({ created: [doc('1001', { name: 'غزال' })] }));
    await cache.applyChanges(FARM, changes({ updated: [doc('1001', { name: 'ريم' })] }));

    const animals = await cache.listAnimals(FARM);
    assert.equal(animals.length, 1);
    assert.equal(animals[0]?.name, 'ريم');
  });

  test('a deletion removes it locally', async () => {
    await cache.applyChanges(FARM, changes({ created: [doc('1001'), doc('1002')] }));
    await cache.applyChanges(FARM, changes({ deleted: ['1001'] }));

    const animals = await cache.listAnimals(FARM);
    assert.deepEqual(
      animals.map((a) => a.tagNumber),
      ['1002'],
    );
  });

  test('sold and dead animals drop out of the roster but stay in the cache', async () => {
    await cache.applyChanges(FARM, changes({ created: [doc('1001', { status: 'sold' })] }));

    assert.equal((await cache.listAnimals(FARM)).length, 0, 'not in the working flock');
    assert.ok(await cache.getAnimal(FARM, '1001'), 'but still findable by id');
  });

  test('the cursor advances so the next pull is incremental', async () => {
    await cache.applyChanges(FARM, changes({ created: [doc('1001')] }, '2026-06-01T12:00:00.000Z'));
    assert.equal(await cache.cursor(FARM), '2026-06-01T12:00:00.000Z');

    await cache.applyChanges(FARM, changes({ created: [doc('1002')] }, '2026-06-02T12:00:00.000Z'));
    assert.equal(await cache.cursor(FARM), '2026-06-02T12:00:00.000Z');
  });

  test('an empty change set still advances the cursor', async () => {
    await cache.applyChanges(FARM, changes({}, '2026-06-05T00:00:00.000Z'));
    assert.equal(await cache.cursor(FARM), '2026-06-05T00:00:00.000Z');
  });

  test('one farm’s cache never leaks into another’s', async () => {
    await cache.applyChanges(FARM, changes({ created: [doc('1001')] }));
    await cache.applyChanges('farm-2', changes({ created: [doc('9001')] }));

    assert.deepEqual(
      (await cache.listAnimals(FARM)).map((a) => a.tagNumber),
      ['1001'],
    );
    assert.deepEqual(
      (await cache.listAnimals('farm-2')).map((a) => a.tagNumber),
      ['9001'],
    );
  });

  test('forgetting a farm takes its flock and its cursor with it', async () => {
    await cache.applyChanges(FARM, changes({ created: [doc('1001')] }));
    await cache.forget(FARM);

    assert.deepEqual(await cache.listAnimals(FARM), []);
    assert.equal(await cache.cursor(FARM), null, 'so the next sign-in pulls the whole farm again');
  });

  test('a corrupt cache costs a re-sync, not a crash', async () => {
    const corrupt = new FlockCache(memoryStore({ 'nasl.cache.farm-1': 'not json' }));
    assert.deepEqual(await corrupt.listAnimals(FARM), []);
    assert.equal(await corrupt.cursor(FARM), null);
  });

  test('the cache survives a restart', async () => {
    await cache.applyChanges(FARM, changes({ created: [doc('1001')] }));
    const afterRestart = new FlockCache(store);
    assert.equal((await afterRestart.listAnimals(FARM)).length, 1);
  });
});

describe('mapping a server document', () => {
  test('the server’s _id becomes the app’s id', () => {
    assert.equal(toCachedAnimal(doc('1001'))?.id, '1001');
  });

  test('a document with no id or tag is rejected rather than stored half-formed', () => {
    assert.equal(toCachedAnimal({ tagNumber: '1001' }), null);
    assert.equal(toCachedAnimal({ _id: 'x' }), null);
  });

  test('timestamps are reduced to calendar dates, because that is what is displayed', () => {
    const animal = toCachedAnimal(
      doc('1001', {
        dateOfBirth: '2024-03-01T00:00:00.000Z',
        withholdMilkUntil: '2026-09-18T00:00:00.000Z',
      }),
    );
    assert.equal(animal?.dateOfBirth, '2024-03-01');
    assert.equal(animal?.withholdMilkUntil, '2026-09-18');
  });

  test('a repro block without its required fields becomes null rather than a broken pill', () => {
    assert.equal(toCachedAnimal(doc('1001', { repro: { state: 'mated' } }))?.repro, null);
    assert.equal(toCachedAnimal(doc('1001', { repro: null }))?.repro, null);
  });

  test('a complete repro block is kept, with its due date as a date', () => {
    const animal = toCachedAnimal(
      doc('1001', {
        repro: {
          state: 'pregnant',
          sinceDate: '2026-02-25T00:00:00.000Z',
          dueDate: '2026-06-06T00:00:00.000Z',
        },
      }),
    );
    assert.equal(animal?.repro?.state, 'pregnant');
    assert.equal(animal?.repro?.dueDate, '2026-06-06');
  });
});
