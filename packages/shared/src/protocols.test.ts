import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultProtocolIds,
  dueProtocolTasks,
  protocolById,
  PROTOCOL_LIBRARY,
  type ProtocolSubject,
} from './protocols.ts';

const TODAY = new Date('2026-06-01T00:00:00.000Z');

const animal = (over: Partial<ProtocolSubject> & { id: string }): ProtocolSubject => ({
  tagNumber: over.id,
  sex: 'female',
  status: 'active',
  ...over,
});

describe('the default library', () => {
  test('routine worm dosing is off unless a farm asks for it', () => {
    assert.ok(!defaultProtocolIds().includes('parasites'));
    assert.equal(protocolById('parasites')!.defaultOn, false);
  });

  test('the campaign vaccines are marked as delivered by the veterinary service', () => {
    for (const id of ['ppr', 'sheep-pox', 'brucellosis', 'fmd']) {
      assert.equal(protocolById(id)!.deliveredBy, 'official', id);
    }
    assert.equal(protocolById('clostridial')!.deliveredBy, 'farm');
  });

  test('Rev-1 is restricted to young females and never repeats', () => {
    const step = protocolById('brucellosis')!.steps[0]!;
    assert.equal(step.appliesTo?.sex, 'female');
    assert.equal(step.appliesTo?.maxAgeDays, 240);
    assert.equal(step.trigger, 'age');
  });

  test('every protocol cites where its schedule came from', () => {
    for (const protocol of PROTOCOL_LIBRARY) {
      assert.ok(protocol.source.length > 20, protocol.id);
    }
  });

  test('every step that follows another names a step that exists', () => {
    const ids = new Set(PROTOCOL_LIBRARY.flatMap((p) => p.steps.map((s) => s.id)));
    for (const protocol of PROTOCOL_LIBRARY) {
      for (const step of protocol.steps) {
        if (step.trigger === 'after-step') assert.ok(step.after, step.id);
        if (step.after) assert.ok(ids.has(step.after), `${step.id} → ${step.after}`);
      }
    }
  });
});

describe('a lamb coming up to its first dose', () => {
  const lamb = animal({ id: 'L1', dateOfBirth: '2026-04-06' });

  test('the first clostridial dose is due at eight weeks and nothing else is asked for yet', () => {
    const tasks = dueProtocolTasks([lamb], defaultProtocolIds(), [], TODAY);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.stepId, 'clostridial-lamb-1');
    assert.equal(tasks[0]!.dueOn, '2026-06-01');
    assert.equal(tasks[0]!.status, 'due');
  });

  test('the second dose is not scheduled until the first has actually been given', () => {
    const after = dueProtocolTasks(
      [lamb],
      defaultProtocolIds(),
      [{ animalId: 'L1', stepId: 'clostridial-lamb-1', date: '2026-06-01' }],
      TODAY,
    );
    assert.deepEqual(
      after.map((t) => t.stepId),
      ['clostridial-lamb-2'],
    );
    assert.equal(after[0]!.dueOn, '2026-06-29');
    assert.equal(after[0]!.status, 'upcoming');
  });

  test('a late first dose moves the second, rather than restarting the course', () => {
    const late = animal({ id: 'L2', sex: 'male', dateOfBirth: '2026-01-01' });
    const tasks = dueProtocolTasks(
      [late],
      ['clostridial'],
      // Due 26 February; actually given on 1 April.
      [{ animalId: 'L2', stepId: 'clostridial-lamb-1', date: '2026-04-01' }],
      TODAY,
    );
    const second = tasks.find((t) => t.stepId === 'clostridial-lamb-2')!;
    assert.equal(second.dueOn, '2026-04-29');
    assert.equal(second.status, 'overdue');
  });
});

describe('the booster before lambing', () => {
  const ewe = animal({
    id: 'E1',
    dateOfBirth: '2023-01-01',
    repro: { state: 'pregnant', dueDate: '2026-07-01' },
  });
  const primaryCourse = [
    { animalId: 'E1', stepId: 'clostridial-ewe-primary-1', date: '2023-07-01' },
    { animalId: 'E1', stepId: 'clostridial-ewe-primary-2', date: '2023-08-05' },
  ];

  test('falls four weeks before she is due', () => {
    const tasks = dueProtocolTasks([ewe], ['clostridial'], primaryCourse, TODAY);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.stepId, 'clostridial-prelambing');
    assert.equal(tasks[0]!.dueOn, '2026-06-03');
  });

  test('given for this pregnancy, it stops being asked for', () => {
    const tasks = dueProtocolTasks(
      [ewe],
      ['clostridial'],
      [...primaryCourse, { animalId: 'E1', stepId: 'clostridial-prelambing', date: '2026-06-03' }],
      TODAY,
    );
    assert.equal(tasks.length, 0);
  });

  test("last year's booster does not cover this lamb", () => {
    const tasks = dueProtocolTasks(
      [ewe],
      ['clostridial'],
      [...primaryCourse, { animalId: 'E1', stepId: 'clostridial-prelambing', date: '2025-06-03' }],
      TODAY,
    );
    assert.deepEqual(
      tasks.map((t) => t.stepId),
      ['clostridial-prelambing'],
    );
  });

  test('a ewe who is not carrying is not asked for one', () => {
    const open = animal({ id: 'E2', dateOfBirth: '2023-01-01', repro: { state: 'open' } });
    const tasks = dueProtocolTasks([open], ['clostridial'], [], TODAY);
    assert.ok(!tasks.some((t) => t.stepId === 'clostridial-prelambing'));
  });
});

describe('yearly boosters', () => {
  const ewe = animal({ id: 'E3', dateOfBirth: '2023-01-01' });

  test('an animal with no history owes the first dose, not the first dose and a booster at once', () => {
    const tasks = dueProtocolTasks([ewe], ['ppr'], [], TODAY);
    assert.deepEqual(
      tasks.map((t) => t.stepId),
      ['ppr-first'],
    );
  });

  test('the yearly clock runs from the dose that was actually given', () => {
    const tasks = dueProtocolTasks(
      [ewe],
      ['ppr'],
      [{ animalId: 'E3', stepId: 'ppr-first', date: '2025-05-01' }],
      TODAY,
    );
    assert.deepEqual(
      tasks.map((t) => t.stepId),
      ['ppr-annual'],
    );
    assert.equal(tasks[0]!.dueOn, '2026-05-01');
    assert.equal(tasks[0]!.status, 'due');
  });

  test('the most recent dose wins when a step has been given more than once', () => {
    const tasks = dueProtocolTasks(
      [ewe],
      ['ppr'],
      [
        { animalId: 'E3', stepId: 'ppr-first', date: '2024-05-01' },
        { animalId: 'E3', stepId: 'ppr-annual', date: '2024-05-01' },
        { animalId: 'E3', stepId: 'ppr-annual', date: '2026-05-20' },
      ],
      TODAY,
    );
    assert.equal(tasks.length, 0, 'the next one is a year out, beyond the horizon');
  });
});

describe('what never produces a task', () => {
  test('an animal that has left the flock', () => {
    const sold = animal({ id: 'S1', status: 'sold', dateOfBirth: '2026-04-06' });
    assert.equal(dueProtocolTasks([sold], defaultProtocolIds(), [], TODAY).length, 0);
  });

  test('an unknown date of birth, rather than a guessed one', () => {
    const unknown = animal({ id: 'U1', dateOfBirth: null });
    assert.equal(dueProtocolTasks([unknown], defaultProtocolIds(), [], TODAY).length, 0);
  });

  test('a protocol the farm has switched off', () => {
    const lamb = animal({ id: 'L3', dateOfBirth: '2026-04-06' });
    assert.equal(dueProtocolTasks([lamb], [], [], TODAY).length, 0);
  });
});

describe('the shape of the list', () => {
  test('overdue work is returned however short the horizon, and comes first', () => {
    const flock = [
      animal({ id: 'A', dateOfBirth: '2026-04-06' }),
      animal({ id: 'B', sex: 'male', dateOfBirth: '2025-11-01' }),
    ];
    const tasks = dueProtocolTasks(flock, ['clostridial', 'ppr'], [], TODAY, 0);
    assert.ok(tasks.length > 0);
    for (let i = 1; i < tasks.length; i += 1) {
      assert.ok(tasks[i]!.daysUntilDue >= tasks[i - 1]!.daysUntilDue);
    }
    assert.ok(tasks.some((t) => t.status === 'overdue'));
  });

  test('each task carries both languages and who administers it', () => {
    const lamb = animal({ id: 'L4', tagNumber: '204', dateOfBirth: '2026-04-06' });
    const [task] = dueProtocolTasks([lamb], ['clostridial'], [], TODAY);
    assert.equal(task!.tagNumber, '204');
    assert.ok(task!.nameAr.length > 0);
    assert.ok(task!.nameEn.length > 0);
    assert.equal(task!.deliveredBy, 'farm');
  });
});
