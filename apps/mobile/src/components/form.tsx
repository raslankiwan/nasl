import type { ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { MIN_TOUCH, radius, spacing, type, createThemedStyles } from '../theme';

function FieldLabel({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const { i18n } = useTranslation();
  return (
    <Text
      style={[
        styles.label,
        { textAlign: Platform.OS === 'web' && i18n.dir() === 'rtl' ? 'right' : 'left' },
      ]}
    >
      {children}
    </Text>
  );
}

/** A row of mutually exclusive options, sized for a thumb. */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  labelFor,
  columns,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labelFor: (option: T) => string;
  columns?: number;
}) {
  const styles = useStyles();
  const wrap = columns !== undefined && options.length > columns;
  return (
    <View style={[styles.choices, wrap && styles.choicesWrap]}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            aria-checked={selected}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.choice,
              wrap && { flexBasis: `${100 / (columns ?? 2) - 2}%`, flexGrow: 0 },
              selected && styles.choiceSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>
              {labelFor(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A date field built for the pen, not the office.
 *
 * Events are recorded the day they happen or the day after, so a calendar wheel is the wrong
 * instrument — it takes several taps to say "yesterday". This steps a day at a time and shows both
 * calendars.
 *
 * By default it refuses future dates, because a lamb cannot be born tomorrow. `allowFuture` is for
 * the fields where the opposite is true: a medicine's expiry is always ahead of today, and a
 * stepper that stops at the present is useless for it. The step size widens with it, because a
 * date a year out is not reached one day at a time.
 */
export function DateField({
  label,
  value,
  onChange,
  allowFuture = false,
}: {
  label: string;
  value: Date;
  onChange: (next: Date) => void;
  allowFuture?: boolean;
}) {
  const styles = useStyles();
  const { t, i18n } = useTranslation('common');
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;

  const startOfToday = new Date(new Date().toISOString().slice(0, 10));
  const dayOffset = Math.round((value.getTime() - startOfToday.getTime()) / 86_400_000);
  const stepDays = allowFuture ? 30 : 1;
  const shift = (days: number) => onChange(new Date(value.getTime() + days * 86_400_000));

  const relative = dayOffset === 0 ? t('today') : dayOffset === -1 ? t('yesterday') : null;

  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.dateRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="-1"
          onPress={() => shift(-stepDays)}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Text style={styles.stepLabel}>−</Text>
        </Pressable>

        <View style={styles.dateValue}>
          <Text style={styles.dateMain}>{relative ?? formatDate(value, locale)}</Text>
          <Text style={styles.dateSub}>
            {relative ? formatDate(value, locale) : formatHijriDate(value, locale)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="+1"
          onPress={() => shift(stepDays)}
          disabled={!allowFuture && dayOffset >= 0}
          style={({ pressed }) => [
            styles.step,
            !allowFuture && dayOffset >= 0 && styles.stepDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.stepLabel}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * A number stepped rather than typed — weights and scores are small and bounded.
 *
 * `initial` is what the first press jumps to, and it matters more than it looks: a birth weight
 * that starts at the minimum and steps by 0.1 takes thirty-five presses to reach a realistic
 * 4 kg, which in a pen means the field simply does not get filled in. Starting at the typical
 * value makes the common case one press or none.
 */
export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  initial,
  suffix,
  optional,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  initial?: number;
  suffix?: string;
  optional?: boolean;
}) {
  const styles = useStyles();
  const start = initial ?? min;
  const current = value ?? start;
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Number(next.toFixed(2)))));

  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.dateRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="-"
          onPress={() =>
            value === null
              ? set(start)
              : optional && value - step < min
                ? onChange(null)
                : set(value - step)
          }
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Text style={styles.stepLabel}>−</Text>
        </Pressable>
        <View style={styles.dateValue}>
          <Text style={styles.dateMain}>
            {value === null ? '—' : `${value}${suffix ? ` ${suffix}` : ''}`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="+"
          onPress={() => set(value === null ? start : current + step)}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Text style={styles.stepLabel}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  field: { marginBottom: spacing.lg },
  label: {
    fontSize: type.label,
    color: colors.muted,
    fontWeight: '600',
    marginBottom: spacing.sm,
    textAlign: 'left',
  },
  choices: { flexDirection: 'row', gap: spacing.sm },
  choicesWrap: { flexWrap: 'wrap' },
  choice: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  choiceSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  choiceLabel: { fontSize: type.label, color: colors.inkSoft, fontWeight: '500' },
  choiceLabelSelected: { color: colors.accent, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  dateRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  step: {
    width: 56,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  stepDisabled: { opacity: 0.35 },
  stepLabel: { fontSize: 24, fontWeight: '600', color: colors.ink },
  dateValue: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
  },
  dateMain: { fontSize: type.body, fontWeight: '600', color: colors.ink },
  dateSub: { fontSize: type.caption, color: colors.muted },
}));
