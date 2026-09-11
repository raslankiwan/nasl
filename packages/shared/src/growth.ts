import { daysBetween } from './dates.ts';

/**
 * Growth arithmetic.
 *
 * Average daily gain is the number a fattening decision rests on, and adjusted weaning weight is
 * how two lambs born five weeks apart are compared fairly. Both live here so the device can show
 * them without a round trip.
 */

export interface WeightPoint {
  date: Date;
  kg: number;
}

/** Average daily gain in kg/day between two weighings. Null when they share a date. */
export function averageDailyGain(from: WeightPoint, to: WeightPoint): number | null {
  const days = daysBetween(from.date, to.date);
  if (days <= 0) return null;
  return Number(((to.kg - from.kg) / days).toFixed(3));
}

/** Gain across a whole series, from the first weighing to the last. */
export function lifetimeGain(points: readonly WeightPoint[]): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  return averageDailyGain(sorted[0]!, sorted.at(-1)!);
}

/**
 * Weight adjusted to a standard age, so lambs born weeks apart compare fairly (FR-WGT-04).
 *
 * The standard adjustment: take the gain from birth to weighing and project it to the target age.
 * A lamb weighed at 70 days and one weighed at 100 both become a 90-day figure.
 */
export function adjustedWeight(
  birthWeightKg: number,
  weighing: WeightPoint,
  dateOfBirth: Date,
  targetAgeDays = 90,
): number | null {
  const ageAtWeighing = daysBetween(dateOfBirth, weighing.date);
  if (ageAtWeighing <= 0) return null;

  const gainPerDay = (weighing.kg - birthWeightKg) / ageAtWeighing;
  return Number((birthWeightKg + gainPerDay * targetAgeDays).toFixed(2));
}

/**
 * Days until an animal reaches a target weight at its current rate.
 * Null when it is not growing — projecting a market date off a falling weight is worse than
 * saying nothing.
 */
export function daysToTarget(
  current: WeightPoint,
  gainPerDay: number,
  targetKg: number,
): number | null {
  if (gainPerDay <= 0) return null;
  if (current.kg >= targetKg) return 0;
  return Math.ceil((targetKg - current.kg) / gainPerDay);
}
