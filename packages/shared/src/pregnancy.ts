import { addDays, daysBetween, startOfDay } from './dates.ts';
import { lambingWindow, preLambingBoosterWindow, scanWindow } from './repro.ts';
import { profileFor, type Species } from './species.ts';

/** A span of time in whole calendar months plus the days left over. */
export interface CalendarSpan {
  months: number;
  days: number;
}

/** `date` moved by whole calendar months, clamped to a shorter month's end (31 Jan → 28 Feb). */
function addCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

/**
 * Calendar months and days from `from` to `to`, counted the way a person reads a calendar:
 * 10 March to 15 June is 3 months and 5 days, not "97 days ÷ 30". Zero when `to` is not after
 * `from` — a span is a distance, the caller decides which way it points.
 */
export function calendarSpan(from: Date, to: Date): CalendarSpan {
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (end <= start) return { months: 0, days: 0 };
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (addCalendarMonths(start, months) > end) months -= 1;
  return { months, days: daysBetween(addCalendarMonths(start, months), end) };
}

export interface PregnancyTimeline {
  matingDate: Date;
  dueDate: Date;
  /** Days since the mating; day 0 is the day of service. */
  gestationDay: number;
  gestationDays: number;
  /** Calendar months and days since the mating. */
  elapsed: CalendarSpan;
  /** Calendar months and days until the reference due date; zero once it has passed. */
  remaining: CalendarSpan;
  /** Days until the reference due date. Negative once past it. */
  daysToDue: number;
  window: { from: Date; to: Date };
  /** Days until the lambing window opens and closes. Negative once each has passed. */
  daysToWindowStart: number;
  daysToWindowEnd: number;
  scan: { from: Date; to: Date };
  booster: { from: Date; to: Date };
  /** The day she moves to the drop pen and shows as "due". */
  dropPenDate: Date;
}

/**
 * Every date a carrying female's page needs, from the stored due date alone.
 *
 * The server sets `dueDate = mating + gestationDays` (see `expectedDueDate`), so the mating date
 * is recovered exactly rather than looked up — which keeps this working from the offline cache.
 * The windows reuse the functions the alerts and protocols already use, so the page cannot
 * disagree with the Today list about when a scan or booster is due.
 */
export function pregnancyTimeline(
  dueDate: Date | string,
  species: Species,
  today: Date,
): PregnancyTimeline {
  const profile = profileFor(species);
  const due = startOfDay(new Date(dueDate));
  const now = startOfDay(today);
  const matingDate = addDays(due, -profile.gestationDays);
  const window = lambingWindow(due, species);
  return {
    matingDate,
    dueDate: due,
    gestationDay: daysBetween(matingDate, now),
    gestationDays: profile.gestationDays,
    elapsed: calendarSpan(matingDate, now),
    remaining: calendarSpan(now, due),
    daysToDue: daysBetween(now, due),
    window,
    daysToWindowStart: daysBetween(now, window.from),
    daysToWindowEnd: daysBetween(now, window.to),
    scan: scanWindow(matingDate, species),
    booster: preLambingBoosterWindow(matingDate, species),
    dropPenDate: addDays(due, -profile.dueWindowDays),
  };
}
