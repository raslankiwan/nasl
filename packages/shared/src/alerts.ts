import { isWithdrawalActive } from './health.ts';
import { daysBetween } from './dates.ts';
import { isInDueWindow, lambingWindow } from './repro.ts';
import type { Species } from './species.ts';

/**
 * What needs doing, derived from the flock rather than stored as rows.
 *
 * This lives here, beside the state machine, because the server and the device must reach the same
 * conclusions from the same animals. The phone recomputes it from its local copy when there is no
 * signal (FR-ALT-05); the server computes it from the database. One implementation, so the two can
 * never quietly disagree about whether a ewe is due.
 */

/** The minimum an animal must carry for an alert to be derived from it. */
export interface AlertSubject {
  id: string;
  tagNumber: string;
  classLabel?: string | null;
  name?: string | null;
  species: string;
  classification?: string | null;
  sex: string;
  status: string;
  repro?: { state: string; dueDate?: string | Date | null } | null;
  withholdMeatUntil?: string | Date | null;
  withholdMilkUntil?: string | Date | null;
}

export interface DueAlert {
  animalId: string;
  tagNumber: string;
  classLabel?: string | null;
  dueDate: string;
  windowStart: string;
  windowEnd: string;
  /** Days to the start, zero during the window, negative only after the final day. */
  days: number;
}

export interface WithdrawalAlert {
  animalId: string;
  tagNumber: string;
  classLabel?: string | null;
  until: string;
  daysLeft: number;
}

export interface Alerts {
  dueSoon: DueAlert[];
  overdue: DueAlert[];
  nursing: number;
  milkWithheld: WithdrawalAlert[];
  meatWithheld: WithdrawalAlert[];
}

const CARRYING = new Set(['mated', 'pregnant', 'due']);

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function deriveAlerts(animals: readonly AlertSubject[], today: Date): Alerts {
  const dueSoon: DueAlert[] = [];
  const overdue: DueAlert[] = [];
  const milkWithheld: WithdrawalAlert[] = [];
  const meatWithheld: WithdrawalAlert[] = [];
  let nursing = 0;

  for (const animal of animals) {
    if (animal.status !== 'active') continue;

    if (animal.repro?.state === 'nursing') nursing += 1;

    if (
      animal.sex === 'female' &&
      (!animal.classification || animal.classification === 'mother') &&
      animal.repro &&
      CARRYING.has(animal.repro.state)
    ) {
      const due = asDate(animal.repro.dueDate);
      if (due) {
        const window = lambingWindow(due, animal.species as Species);
        const toStart = daysBetween(today, window.from);
        const toEnd = daysBetween(today, window.to);
        const days = toEnd < 0 ? toEnd : Math.max(0, toStart);
        const entry: DueAlert = {
          animalId: animal.id,
          tagNumber: animal.tagNumber,
          ...(animal.classLabel ? { classLabel: animal.classLabel } : {}),
          dueDate: toDateString(due),
          windowStart: toDateString(window.from),
          windowEnd: toDateString(window.to),
          days,
        };
        if (days < 0) overdue.push(entry);
        else if (isInDueWindow(due, animal.species as Species, today)) dueSoon.push(entry);
      }
    }

    for (const [value, bucket] of [
      [animal.withholdMilkUntil, milkWithheld],
      [animal.withholdMeatUntil, meatWithheld],
    ] as const) {
      const until = asDate(value);
      // The final day of a withholding period is still restricted.
      if (until && isWithdrawalActive(until, today)) {
        bucket.push({
          animalId: animal.id,
          tagNumber: animal.tagNumber,
          ...(animal.classLabel ? { classLabel: animal.classLabel } : {}),
          until: toDateString(until),
          daysLeft: daysBetween(today, until),
        });
      }
    }
  }

  const bySoonest = (a: { days: number }, b: { days: number }) => a.days - b.days;
  const byShortest = (a: { daysLeft: number }, b: { daysLeft: number }) => a.daysLeft - b.daysLeft;

  return {
    dueSoon: dueSoon.sort(bySoonest),
    overdue: overdue.sort(bySoonest),
    nursing,
    milkWithheld: milkWithheld.sort(byShortest),
    meatWithheld: meatWithheld.sort(byShortest),
  };
}
