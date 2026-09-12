import { addDays, daysBetween } from './dates.ts';

/**
 * Lactation yield from test-day records.
 *
 * Weighing every ewe at every milking is not something a farm does outside a selection programme,
 * so dairy-sheep recording schemes work from periodic *test days*: each ewe's daily yield is
 * measured now and then, and the lactation is estimated between those points.
 *
 * The estimator is the Fleischmann (test-interval) method, which is what ICAR schemes use. It
 * treats yield as changing linearly between consecutive tests, holds the first test's rate back to
 * lambing, and the last test's rate forward to drying off.
 */

export interface TestDay {
  date: Date;
  /** Daily yield in kg — both milkings of that day, not one. */
  kg: number;
}

/** The standard comparison length for dairy sheep. Awassi lactations are quoted at 150 days. */
export const STANDARD_LACTATION_DAYS = 150;

function sorted(testDays: readonly TestDay[]): TestDay[] {
  return [...testDays].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Total yield across a lactation.
 *
 * `end` is the drying-off date, or today for a lactation still running. A single test day yields
 * that rate held across the whole period, which is the best the evidence supports.
 */
export function lactationYield(lambingDate: Date, testDays: readonly TestDay[], end: Date): number {
  const tests = sorted(testDays).filter((t) => daysBetween(lambingDate, t.date) >= 0);
  if (tests.length === 0) return 0;

  const first = tests[0]!;
  // Lambing to the first test, at the first test's rate.
  let total = Math.max(0, daysBetween(lambingDate, first.date)) * first.kg;

  for (let i = 0; i < tests.length - 1; i += 1) {
    const from = tests[i]!;
    const to = tests[i + 1]!;
    const days = daysBetween(from.date, to.date);
    // Yield is taken to change linearly between tests, so the interval runs at their mean.
    total += days * ((from.kg + to.kg) / 2);
  }

  const last = tests.at(-1)!;
  total += Math.max(0, daysBetween(last.date, end)) * last.kg;

  return Number(total.toFixed(1));
}

/**
 * Yield standardised to 150 days, so two ewes that lambed months apart compare.
 *
 * A lactation shorter than the standard is not extrapolated — reporting milk she did not give
 * would flatter a ewe who dried off early, and drying off early is itself the thing worth seeing.
 */
export function standardisedYield(
  lambingDate: Date,
  testDays: readonly TestDay[],
  end: Date,
  days = STANDARD_LACTATION_DAYS,
): number {
  const standardEnd = addDays(lambingDate, days);
  const cutoff = end.getTime() < standardEnd.getTime() ? end : standardEnd;
  const within = sorted(testDays).filter((t) => t.date.getTime() <= cutoff.getTime());
  return lactationYield(lambingDate, within, cutoff);
}

/** Highest measured daily yield — how much she is capable of, as against how long she held it. */
export function peakYield(testDays: readonly TestDay[]): number | null {
  if (testDays.length === 0) return null;
  return Math.max(...testDays.map((t) => t.kg));
}

/** Days she has been milking. */
export function daysInMilk(lambingDate: Date, end: Date): number {
  return Math.max(0, daysBetween(lambingDate, end));
}

/** Average daily yield across the lactation so far. */
export function averageDailyYield(
  lambingDate: Date,
  testDays: readonly TestDay[],
  end: Date,
): number | null {
  const days = daysInMilk(lambingDate, end);
  if (days === 0) return null;
  return Number((lactationYield(lambingDate, testDays, end) / days).toFixed(2));
}
