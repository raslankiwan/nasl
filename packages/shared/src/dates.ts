/** Date helpers. All domain dates are calendar days in UTC; time of day is never significant. */

export const MS_PER_DAY = 86_400_000;

/** Strip time, normalising to UTC midnight. */
export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(startOfDay(date).getTime() + days * MS_PER_DAY);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

export function isWithin(date: Date, start: Date, end: Date): boolean {
  const t = startOfDay(date).getTime();
  return t >= startOfDay(start).getTime() && t <= startOfDay(end).getTime();
}

/** ISO calendar-date string (YYYY-MM-DD) — the wire format for every domain date. */
export function toDateString(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10);
}
