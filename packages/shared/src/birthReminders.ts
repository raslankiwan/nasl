import { daysBetween, toDateString } from './dates.ts';
import { lambingWindow } from './repro.ts';
import type { AlertSubject } from './alerts.ts';
import type { Species } from './species.ts';

export const BIRTH_REMINDER_DAYS = [0, 3, 7] as const;
export const DEFAULT_BIRTH_REMINDER_DAYS: readonly number[] = [0];

/** Old single-choice preferences keep their lead time and gain the first-day reminder. */
export function birthReminderDays(days?: readonly number[], legacyLead?: number): number[] {
  if (days?.length)
    return [...new Set(days)].filter((day) => [0, 3, 7].includes(day)).sort((a, b) => a - b);
  return legacyLead === 3 || legacyLead === 7 ? [0, legacyLead] : [0];
}

export interface BirthReminder {
  animalId: string;
  tagNumber: string;
  windowStart: string;
  windowEnd: string;
  daysUntilWindow: number;
  reminderDays: number;
}

/** The latest selected milestone that has arrived, with catch-up until the next one.
 * Each milestone has its own delivery key. Never send after the first day or for resolved pregnancies.
 */
export function birthReminders(
  animals: readonly AlertSubject[],
  today: Date,
  selectedDays: readonly number[] = DEFAULT_BIRTH_REMINDER_DAYS,
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
      if (days < 0) return [];
      const reminderDays = [...selectedDays].sort((a, b) => a - b).find((day) => days <= day);
      if (reminderDays === undefined) return [];
      return [
        {
          animalId: animal.id,
          tagNumber: animal.tagNumber,
          windowStart: toDateString(window.from),
          windowEnd: toDateString(window.to),
          daysUntilWindow: days,
          reminderDays,
        },
      ];
    })
    .sort(
      (a, b) => a.windowStart.localeCompare(b.windowStart) || a.animalId.localeCompare(b.animalId),
    );
}
