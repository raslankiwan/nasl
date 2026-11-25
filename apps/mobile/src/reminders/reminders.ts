import type { KeyValueStore } from '../sync/storage.ts';

/**
 * The herder's own reminders and notes, beside the alerts the flock generates.
 *
 * Kept on the device, per person and per farm: they are private jottings ("call the vet about
 * the lame ram", "buy mineral licks"), not farm records, so they carry none of the event-sourcing
 * or tenancy machinery and never leave the phone. The trade-off is written down rather than
 * hidden: they do not follow the user to another phone. If that becomes a need, this interface is
 * what a synced implementation replaces.
 */
export interface Reminder {
  id: string;
  text: string;
  /** Calendar date (YYYY-MM-DD) to surface it on, or null for an undated note. */
  dueDate: string | null;
  done: boolean;
  createdAt: string;
}

export const MAX_REMINDER_LENGTH = 500;

export class ReminderStore {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  private key(userId: string, farmId: string): string {
    return `nasl.reminders.${userId}.${farmId}`;
  }

  async list(userId: string, farmId: string): Promise<Reminder[]> {
    const raw = await this.store.get(this.key(userId, farmId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as Reminder[]) : [];
    } catch {
      return [];
    }
  }

  /** Mutations run one at a time: two quick taps must not each read the list before either writes. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Read, change and write the list as one step. `change` returns null to leave it untouched. */
  private mutate(
    userId: string,
    farmId: string,
    change: (current: Reminder[]) => Reminder[] | null,
  ): Promise<Reminder[]> {
    const run = this.queue.then(async () => {
      const current = await this.list(userId, farmId);
      const next = change(current);
      if (!next) return current;
      await this.store.set(this.key(userId, farmId), JSON.stringify(next));
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  add(
    userId: string,
    farmId: string,
    input: { id: string; text: string; dueDate: string | null; now: Date },
  ): Promise<Reminder[]> {
    const text = input.text.trim().slice(0, MAX_REMINDER_LENGTH);
    return this.mutate(userId, farmId, (current) =>
      text
        ? [
            ...current,
            {
              id: input.id,
              text,
              dueDate: input.dueDate,
              done: false,
              createdAt: input.now.toISOString(),
            },
          ]
        : null,
    );
  }

  setDone(userId: string, farmId: string, id: string, done: boolean): Promise<Reminder[]> {
    return this.mutate(userId, farmId, (current) =>
      current.map((reminder) => (reminder.id === id ? { ...reminder, done } : reminder)),
    );
  }

  remove(userId: string, farmId: string, id: string): Promise<Reminder[]> {
    return this.mutate(userId, farmId, (current) =>
      current.filter((reminder) => reminder.id !== id),
    );
  }
}

/**
 * Open reminders in the order the day needs them: dated ones by date (so the late ones lead),
 * then undated notes, newest first.
 */
export function openReminders(reminders: Reminder[]): Reminder[] {
  return reminders
    .filter((reminder) => !reminder.done)
    .sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}
