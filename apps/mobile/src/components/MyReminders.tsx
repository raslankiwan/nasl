import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDate, type Locale } from '@nasl/i18n';
import { daysBetween, startOfDay, toDateString } from '@nasl/shared';
import { MAX_REMINDER_LENGTH, openReminders, type Reminder } from '../reminders/reminders';
import { Body, Button, Field, IconButton, Pill } from './ui';
import { DateField, Toggle } from './form';
import { radius, spacing, type, createThemedStyles } from '../theme';

/**
 * The person's own reminders and notes on the Today screen, under the flock's alerts.
 *
 * Adding one is a single text box; a date is optional because most of these are "don't forget"
 * notes rather than appointments.
 */
export function MyReminders({
  reminders,
  today,
  onAdd,
  onComplete,
  onRemove,
}: {
  reminders: Reminder[];
  today: Date;
  onAdd: (text: string, dueDate: string | null) => Promise<void>;
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const styles = useStyles();
  const { t, i18n } = useTranslation(['tasks', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [hasDate, setHasDate] = useState(false);
  const [date, setDate] = useState(() => startOfDay(today));
  const [saving, setSaving] = useState(false);
  const open = openReminders(reminders);

  const reset = () => {
    setAdding(false);
    setText('');
    setHasDate(false);
    setDate(startOfDay(new Date()));
  };

  const save = async () => {
    setSaving(true);
    try {
      await onAdd(text, hasDate ? toDateString(date) : null);
      reset();
    } finally {
      setSaving(false);
    }
  };

  const when = (reminder: Reminder) => {
    if (!reminder.dueDate) return { label: t('tasks:reminderNote'), tone: 'neutral' as const };
    const days = daysBetween(today, new Date(reminder.dueDate));
    if (days < 0) {
      return { label: t('tasks:reminderLate', { count: -days }), tone: 'accent' as const };
    }
    if (days === 0) return { label: t('tasks:reminderToday'), tone: 'accent' as const };
    return { label: t('tasks:reminderIn', { count: days }), tone: 'neutral' as const };
  };

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.sectionLabel}>{t('tasks:myReminders')}</Text>
        {!adding ? (
          <IconButton label={t('tasks:addReminder')} icon="plus" onPress={() => setAdding(true)} />
        ) : null}
      </View>

      {adding ? (
        <View style={styles.form}>
          <Field
            label={t('tasks:reminderText')}
            value={text}
            onChangeText={setText}
            maxLength={MAX_REMINDER_LENGTH}
            multiline
            autoFocus
          />
          <Toggle label={t('tasks:reminderHasDate')} value={hasDate} onChange={setHasDate} />
          {hasDate ? (
            <DateField
              label={t('tasks:reminderDate')}
              value={date}
              onChange={setDate}
              allowFuture
            />
          ) : null}
          <View style={styles.formActions}>
            <View style={styles.flex}>
              <Button label={t('common:cancel')} variant="secondary" onPress={reset} />
            </View>
            <View style={styles.flex}>
              <Button
                label={t('common:save')}
                onPress={() => void save()}
                disabled={!text.trim()}
                busy={saving}
              />
            </View>
          </View>
        </View>
      ) : null}

      {open.map((reminder) => {
        const status = when(reminder);
        return (
          <View key={reminder.id} style={styles.row}>
            <IconButton
              label={t('tasks:markDone')}
              icon="checkbox-blank-circle-outline"
              onPress={() => onComplete(reminder.id)}
            />
            <View style={styles.rowDetail}>
              <Text style={styles.text}>{reminder.text}</Text>
              <View style={styles.meta}>
                <Pill tone={status.tone}>{status.label}</Pill>
                {reminder.dueDate ? (
                  <Text style={styles.date}>{formatDate(new Date(reminder.dueDate), locale)}</Text>
                ) : null}
              </View>
            </View>
            <IconButton
              label={t('tasks:deleteReminder')}
              icon="trash-can-outline"
              onPress={() => onRemove(reminder.id)}
            />
          </View>
        );
      })}

      {open.length === 0 && !adding ? <Body muted>{t('tasks:remindersEmpty')}</Body> : null}
      <Text style={styles.hint}>{t('tasks:remindersDeviceOnly')}</Text>
    </View>
  );
}

/** True when a reminder is due today or late — the Today screen is not "all clear" then. */
export function hasDueReminder(reminders: Reminder[], today: Date): boolean {
  return openReminders(reminders).some(
    (reminder) => reminder.dueDate && daysBetween(today, new Date(reminder.dueDate)) <= 0,
  );
}

const useStyles = createThemedStyles((colors) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    fontSize: type.caption,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
    fontWeight: '700',
  },
  form: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  formActions: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    minHeight: 56,
  },
  rowDetail: { flex: 1, gap: spacing.xs },
  text: { fontSize: type.body, color: colors.ink },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  date: { fontSize: type.label, color: colors.muted },
  hint: { fontSize: type.caption, color: colors.muted, marginTop: spacing.xs },
}));
