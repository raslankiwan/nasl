import { useCallback, useEffect, useState } from 'react';
import { newId } from '@nasl/shared';
import { useAuth } from '../auth/AuthProvider';
import { reminderStore } from '../sync/device';
import type { Reminder } from './reminders';

/** The signed-in person's reminders for the active farm, read from and written to the device. */
export function useReminders() {
  const { me, farmId } = useAuth();
  const userId = me?.id ?? null;
  const [state, setState] = useState<{ key: string; reminders: Reminder[] }>({
    key: '',
    reminders: [],
  });
  const key = userId && farmId ? `${userId}/${farmId}` : '';

  useEffect(() => {
    let active = true;
    if (!userId || !farmId) {
      setState({ key: '', reminders: [] });
      return;
    }
    void reminderStore.list(userId, farmId).then((reminders) => {
      if (active) setState({ key, reminders });
    });
    return () => {
      active = false;
    };
  }, [key, userId, farmId]);

  const apply = useCallback(
    async (change: (user: string, farm: string) => Promise<Reminder[]>) => {
      if (!userId || !farmId) return;
      setState({ key, reminders: await change(userId, farmId) });
    },
    [key, userId, farmId],
  );

  return {
    // A farm switch never shows the previous farm's notes, even for a frame.
    reminders: state.key === key ? state.reminders : [],
    add: (text: string, dueDate: string | null) =>
      apply((user, farm) =>
        reminderStore.add(user, farm, { id: newId(), text, dueDate, now: new Date() }),
      ),
    complete: (id: string) => apply((user, farm) => reminderStore.setDone(user, farm, id, true)),
    remove: (id: string) => apply((user, farm) => reminderStore.remove(user, farm, id)),
  };
}
