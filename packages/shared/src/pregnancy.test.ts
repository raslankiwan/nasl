import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calendarSpan, pregnancyTimeline } from './pregnancy.ts';
import { expectedDueDate } from './repro.ts';
import { toDateString } from './dates.ts';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('calendarSpan', () => {
  test('counts whole calendar months, then the days left over', () => {
    assert.deepEqual(calendarSpan(d('2026-03-10'), d('2026-06-15')), { months: 3, days: 5 });
    assert.deepEqual(calendarSpan(d('2026-03-10'), d('2026-03-10')), { months: 0, days: 0 });
    assert.deepEqual(calendarSpan(d('2026-03-10'), d('2026-04-09')), { months: 0, days: 30 });
    assert.deepEqual(calendarSpan(d('2026-03-10'), d('2026-04-10')), { months: 1, days: 0 });
  });

  test('clamps to the end of a shorter month instead of overshooting it', () => {
    assert.deepEqual(calendarSpan(d('2026-01-31'), d('2026-02-28')), { months: 1, days: 0 });
    assert.deepEqual(calendarSpan(d('2026-01-31'), d('2026-03-01')), { months: 1, days: 1 });
    assert.deepEqual(calendarSpan(d('2028-02-29'), d('2029-02-28')), { months: 12, days: 0 });
  });

  test('crosses a year boundary', () => {
    assert.deepEqual(calendarSpan(d('2026-11-20'), d('2027-02-03')), { months: 2, days: 14 });
  });

  test('is zero, not negative, once the end has passed', () => {
    assert.deepEqual(calendarSpan(d('2026-06-15'), d('2026-03-10')), { months: 0, days: 0 });
  });

  test('ignores the time of day', () => {
    assert.deepEqual(
      calendarSpan(new Date('2026-03-10T23:59:00Z'), new Date('2026-06-15T00:01:00Z')),
      { months: 3, days: 5 },
    );
  });
});

describe('pregnancyTimeline', () => {
  // A ewe served on 1 July 2026: 147 days puts her reference due date on 25 November.
  const mated = d('2026-07-01');
  const due = expectedDueDate(mated, 'sheep');

  test('recovers the mating date exactly from the stored due date', () => {
    assert.equal(toDateString(due), '2026-11-25');
    const timeline = pregnancyTimeline(due, 'sheep', d('2026-10-06'));
    assert.equal(toDateString(timeline.matingDate), '2026-07-01');
  });

  test('reports elapsed and remaining time in calendar months and days', () => {
    const timeline = pregnancyTimeline(toDateString(due), 'sheep', d('2026-10-06'));
    assert.equal(timeline.gestationDay, 97);
    assert.deepEqual(timeline.elapsed, { months: 3, days: 5 });
    assert.deepEqual(timeline.remaining, { months: 1, days: 19 });
    assert.equal(timeline.daysToDue, 50);
    assert.equal(timeline.gestationDay + timeline.daysToDue, 147);
  });

  test('counts down to the 145-152 day lambing window', () => {
    const timeline = pregnancyTimeline(due, 'sheep', d('2026-10-06'));
    assert.equal(toDateString(timeline.window.from), '2026-11-23');
    assert.equal(toDateString(timeline.window.to), '2026-11-30');
    assert.equal(timeline.daysToWindowStart, 48);
    assert.equal(timeline.daysToWindowEnd, 55);
  });

  test('places the scan, booster and drop-pen dates from the mating', () => {
    const timeline = pregnancyTimeline(due, 'sheep', d('2026-10-06'));
    assert.equal(toDateString(timeline.scan.from), '2026-08-15');
    assert.equal(toDateString(timeline.scan.to), '2026-09-09');
    assert.equal(toDateString(timeline.booster.from), '2026-10-14');
    assert.equal(toDateString(timeline.booster.to), '2026-10-28');
    assert.equal(toDateString(timeline.dropPenDate), '2026-11-11');
  });

  test('goes negative past the due date while the remaining span stays at zero', () => {
    const timeline = pregnancyTimeline(due, 'sheep', d('2026-12-01'));
    assert.equal(timeline.daysToDue, -6);
    assert.equal(timeline.daysToWindowEnd, -1);
    assert.deepEqual(timeline.remaining, { months: 0, days: 0 });
  });

  test('uses the goat gestation for a doe', () => {
    const doeDue = expectedDueDate(mated, 'goat');
    const timeline = pregnancyTimeline(doeDue, 'goat', d('2026-07-01'));
    assert.equal(timeline.gestationDays, 150);
    assert.equal(timeline.daysToDue, 150);
    assert.equal(timeline.daysToWindowStart, timeline.daysToWindowEnd);
  });
});
