import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, calendarDays, changeCalendarMonth, clampCalendarDate } from './calendar.ts';

describe('calendar selection', () => {
  test('changing month or year clamps the day, including leap years', () => {
    assert.equal(
      changeCalendarMonth(new Date('2024-01-31'), 1).toISOString().slice(0, 10),
      '2024-02-29',
    );
    assert.equal(calendarDate(2025, 1, 29).toISOString().slice(0, 10), '2025-02-28');
    assert.equal(
      changeCalendarMonth(new Date('2026-01-31'), -1).toISOString().slice(0, 10),
      '2025-12-31',
    );
    assert.equal(
      changeCalendarMonth(new Date('2026-12-31'), 1).toISOString().slice(0, 10),
      '2027-01-31',
    );
  });

  test('the grid aligns weekdays and contains every day exactly once', () => {
    for (const [year, month, count, first] of [
      [2024, 1, 29, 4],
      [2026, 1, 28, 0],
      [2026, 7, 31, 6],
    ]) {
      const cells = calendarDays(calendarDate(year!, month!));
      assert.equal(cells.length % 7, 0);
      assert.equal(cells.findIndex(Boolean), first);
      assert.deepEqual(
        cells.filter((d) => d !== null).map((d) => d.getUTCDate()),
        Array.from({ length: count! }, (_, i) => i + 1),
      );
    }
  });

  test('future and historical limits are inclusive without changing the requested day', () => {
    const min = new Date('1900-01-01');
    const max = new Date('2026-10-18');
    assert.equal(clampCalendarDate(new Date('2027-01-01'), min, max).getTime(), max.getTime());
    assert.equal(clampCalendarDate(new Date('1899-12-31'), min, max).getTime(), min.getTime());
    assert.equal(
      clampCalendarDate(new Date('2024-02-29'), min, max).toISOString().slice(0, 10),
      '2024-02-29',
    );
  });
});
