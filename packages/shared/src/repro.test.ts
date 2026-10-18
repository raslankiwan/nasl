import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionsFor,
  applyReproEvent,
  canApply,
  expectedDueDate,
  gestationDay,
  InvalidReproTransition,
  isInDueWindow,
  lambingWindow,
  preLambingBoosterWindow,
  REPRO_STATES,
  scanWindow,
  type ReproEvent,
  type ReproStatus,
} from './repro.ts';
import { toDateString } from './dates.ts';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const open = (date = d('2026-01-01')): ReproStatus => ({ state: 'open', sinceDate: date });

describe('reproductive state machine', () => {
  test('a mating moves an open ewe to mated and sets the due date', () => {
    const next = applyReproEvent(open(), {
      type: 'mating',
      date: d('2026-01-10'),
      species: 'sheep',
    });
    assert.equal(next.state, 'mated');
    assert.equal(toDateString(next.dueDate!), '2026-06-06'); // 10 Jan + 147 days
  });

  test('goats carry three days longer than sheep', () => {
    const sheep = expectedDueDate(d('2026-01-10'), 'sheep');
    const goat = expectedDueDate(d('2026-01-10'), 'goat');
    assert.equal(toDateString(sheep), '2026-06-06');
    assert.equal(toDateString(goat), '2026-06-09');
  });

  test('a positive scan confirms pregnancy and keeps the due date', () => {
    const mated = applyReproEvent(open(), {
      type: 'mating',
      date: d('2026-01-10'),
      species: 'sheep',
    });
    const next = applyReproEvent(mated, {
      type: 'pregnancyCheck',
      date: d('2026-02-25'),
      result: 'pregnant',
    });
    assert.equal(next.state, 'pregnant');
    assert.equal(toDateString(next.dueDate!), '2026-06-06');
  });

  test('a negative scan returns her to open and clears the due date', () => {
    const mated = applyReproEvent(open(), {
      type: 'mating',
      date: d('2026-01-10'),
      species: 'sheep',
    });
    const next = applyReproEvent(mated, {
      type: 'pregnancyCheck',
      date: d('2026-02-25'),
      result: 'open',
    });
    assert.equal(next.state, 'open');
    assert.equal(next.dueDate, undefined);
  });

  test('an uncertain scan leaves the status untouched', () => {
    const mated = applyReproEvent(open(), {
      type: 'mating',
      date: d('2026-01-10'),
      species: 'sheep',
    });
    const next = applyReproEvent(mated, {
      type: 'pregnancyCheck',
      date: d('2026-02-25'),
      result: 'uncertain',
    });
    assert.deepEqual(next, mated);
  });

  test('a birth is accepted from mated — plenty of ewes are never scanned', () => {
    const mated = applyReproEvent(open(), {
      type: 'mating',
      date: d('2026-01-10'),
      species: 'sheep',
    });
    assert.equal(applyReproEvent(mated, { type: 'birth', date: d('2026-06-05') }).state, 'lambed');
  });

  test('the full cycle returns her to a serviceable state', () => {
    let s = open();
    s = applyReproEvent(s, { type: 'mating', date: d('2026-01-10'), species: 'sheep' });
    s = applyReproEvent(s, { type: 'pregnancyCheck', date: d('2026-02-25'), result: 'pregnant' });
    s = applyReproEvent(s, { type: 'dueWindowReached', date: d('2026-05-23') });
    s = applyReproEvent(s, { type: 'birth', date: d('2026-06-06') });
    s = applyReproEvent(s, { type: 'nursingStarted', date: d('2026-06-06') });
    s = applyReproEvent(s, { type: 'weaning', date: d('2026-08-15') });
    assert.equal(s.state, 'weaned');
    assert.ok(canApply(s, { type: 'mating', date: d('2026-09-01'), species: 'sheep' }));
  });

  test('an abortion returns her to a serviceable state', () => {
    const mated = applyReproEvent(open(), {
      type: 'mating',
      date: d('2026-01-10'),
      species: 'sheep',
    });
    const aborted = applyReproEvent(mated, { type: 'abortion', date: d('2026-03-01') });
    assert.equal(aborted.state, 'aborted');
    assert.ok(canApply(aborted, { type: 'mating', date: d('2026-04-01'), species: 'sheep' }));
  });

  test('a pregnant ewe cannot be mated again', () => {
    const mated = applyReproEvent(open(), {
      type: 'mating',
      date: d('2026-01-10'),
      species: 'sheep',
    });
    assert.throws(
      () => applyReproEvent(mated, { type: 'mating', date: d('2026-02-01'), species: 'sheep' }),
      InvalidReproTransition,
    );
  });

  test('a nursing ewe cannot be marked barren', () => {
    let s = applyReproEvent(open(), { type: 'mating', date: d('2026-01-10'), species: 'sheep' });
    s = applyReproEvent(s, { type: 'birth', date: d('2026-06-06') });
    s = applyReproEvent(s, { type: 'nursingStarted', date: d('2026-06-06') });
    assert.equal(canApply(s, { type: 'markedBarren', date: d('2026-07-01') }), false);
  });

  test('applying an event never mutates the input', () => {
    const before = open();
    const snapshot = { ...before };
    applyReproEvent(before, { type: 'mating', date: d('2026-01-10'), species: 'sheep' });
    assert.deepEqual(before, snapshot);
  });
});

describe('derived windows', () => {
  test('the sheep lambing window is day 145 through day 152, including old due dates', () => {
    const window = lambingWindow(d('2026-06-06'), 'sheep');
    assert.equal(toDateString(window.from), '2026-06-04');
    assert.equal(toDateString(window.to), '2026-06-11');
    const leap = lambingWindow(expectedDueDate(d('2023-10-10'), 'sheep'), 'sheep');
    assert.equal(toDateString(leap.from), '2024-03-03');
    assert.equal(toDateString(leap.to), '2024-03-10');
  });

  test('the goat estimate stays at 150 days', () => {
    const due = expectedDueDate(d('2026-01-10'), 'goat');
    assert.deepEqual(lambingWindow(due, 'goat'), { from: due, to: due });
  });
  test('the scan window opens at day 45 and closes at day 70', () => {
    const w = scanWindow(d('2026-01-10'), 'sheep');
    assert.equal(toDateString(w.from), '2026-02-24');
    assert.equal(toDateString(w.to), '2026-03-21');
  });

  test('the pre-lambing booster lands four to six weeks before the due date', () => {
    const mating = d('2026-01-10');
    const w = preLambingBoosterWindow(mating, 'sheep');
    const due = expectedDueDate(mating, 'sheep');
    const daysBefore = (x: Date) => Math.round((due.getTime() - x.getTime()) / 86_400_000);
    assert.equal(daysBefore(w.to), 28);
    assert.equal(daysBefore(w.from), 42);
  });

  test('the due window opens fourteen days out', () => {
    const due = d('2026-06-06');
    assert.equal(isInDueWindow(due, 'sheep', d('2026-05-22')), false);
    assert.equal(isInDueWindow(due, 'sheep', d('2026-05-23')), true);
    assert.equal(isInDueWindow(due, 'sheep', d('2026-06-10')), true, 'overdue is still due');
  });

  test('gestation day counts from the mating', () => {
    assert.equal(gestationDay(d('2026-01-10'), d('2026-02-24')), 45);
  });
});

describe('what may be recorded next', () => {
  test('an open female can only be mated', () => {
    assert.deepEqual(actionsFor('open'), ['mating']);
    assert.deepEqual(actionsFor(null), ['mating'], 'no history means open');
    assert.deepEqual(actionsFor(undefined), ['mating']);
  });

  test('a mated female can be checked, can lamb, or can lose it', () => {
    assert.deepEqual(actionsFor('mated'), ['check', 'birth', 'abortion']);
  });

  test('a confirmed pregnancy is past checking', () => {
    assert.deepEqual(actionsFor('pregnant'), ['birth', 'abortion']);
    assert.deepEqual(actionsFor('due'), ['birth', 'abortion']);
  });

  test('a nursing female is offered weaning and nothing else', () => {
    assert.deepEqual(actionsFor('nursing'), ['weaning']);
    assert.deepEqual(actionsFor('lambed'), ['weaning']);
  });

  test('every offered action is one the state machine actually accepts', () => {
    const date = d('2026-03-01');
    for (const state of REPRO_STATES) {
      const status: ReproStatus = { state, sinceDate: d('2026-01-01'), matingId: 'm1' };
      for (const action of actionsFor(state)) {
        const event: ReproEvent =
          action === 'mating'
            ? { type: 'mating', date, species: 'sheep' }
            : action === 'check'
              ? { type: 'pregnancyCheck', date, result: 'pregnant' }
              : action === 'birth'
                ? { type: 'birth', date }
                : action === 'abortion'
                  ? { type: 'abortion', date }
                  : { type: 'weaning', date };
        assert.ok(canApply(status, event), `${state} offers "${action}" but cannot apply it`);
      }
    }
  });

  test('every state that can be acted on offers at least one action', () => {
    for (const state of REPRO_STATES) {
      assert.ok(actionsFor(state).length > 0, `${state} offers nothing`);
    }
  });
});
