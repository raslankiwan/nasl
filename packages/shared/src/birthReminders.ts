import { daysBetween, toDateString } from './dates.ts';
import { lambingWindow } from './repro.ts';
import type { AlertSubject } from './alerts.ts';
import type { Species } from './species.ts';

export const BIRTH_REMINDER_DAYS = [1, 3, 7] as const;
export const DEFAULT_BIRTH_REMINDER_DAYS = 3;

export interface BirthReminder {
  animalId: string;
  tagNumber: string;
  windowStart: string;
  windowEnd: string;
  daysUntilWindow: number;
}

/** Includes the first day as a catch-up, but never a past window or resolved pregnancy. */
export function birthReminders(
  animals: readonly AlertSubject[],
  today: Date,
  leadDays = DEFAULT_BIRTH_REMINDER_DAYS,
): BirthReminder[] {
  return animals
    .flatMap((animal) => {
      if (
        animal.status !== 'active' ||
        animal.sex !== 'female' ||
        !['mated', 'pregnant', 'due'].includes(animal.repro?.state ?? '') ||
        !animal.repro?.dueDate
      )
        return [];
      const due = new Date(animal.repro.dueDate);
      if (!Number.isFinite(due.getTime())) return [];
      const window = lambingWindow(due, animal.species as Species);
      const days = daysBetween(today, window.from);
      if (days < 0 || days > leadDays) return [];
      return [
        {
          animalId: animal.id,
          tagNumber: animal.tagNumber,
          windowStart: toDateString(window.from),
          windowEnd: toDateString(window.to),
          daysUntilWindow: days,
        },
      ];
    })
    .sort(
      (a, b) => a.windowStart.localeCompare(b.windowStart) || a.animalId.localeCompare(b.animalId),
    );
}
