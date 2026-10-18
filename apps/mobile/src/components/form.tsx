import { useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
export { DateField } from './DateField';
import { MIN_TOUCH, radius, spacing, type, createThemedStyles } from '../theme';
import { NumberEditor } from './NumberEditor';

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

/** Independent checkboxes for settings that can be combined. */
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="checkbox"
      aria-checked={value}
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={[
        styles.choice,
        value && styles.choiceSelected,
        { flex: 0, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
      ]}
    >
      <Text style={styles.choiceLabel}>{value ? '✓' : '○'}</Text>
      <Text style={[styles.choiceLabel, { flexShrink: 1 }, value && styles.choiceLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Direct numeric entry plus quick adjustments; step size never restricts manual precision.
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
  decimals = 2,
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
  decimals?: number;
}) {
  const styles = useStyles();
  const { t } = useTranslation('common');
  const [editing, setEditing] = useState(false);
  const start = initial ?? min;
  const current = value ?? start;
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Number(next.toFixed(2)))));

  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.dateRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('decreaseNumber', { label })}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ?? '—'}${suffix ? ` ${suffix}` : ''}`}
          accessibilityHint={t('enterNumber')}
          onPress={() => setEditing(true)}
          style={({ pressed }) => [styles.dateValue, pressed && styles.pressed]}
        >
          <Text style={styles.dateMain}>
            {value === null ? '—' : `${value}${suffix ? ` ${suffix}` : ''}`}
          </Text>
          <Text style={styles.editHint}>{t(value === null ? 'enterValue' : 'edit')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('increaseNumber', { label })}
          onPress={() => set(value === null ? start : current + step)}
          style={({ pressed }) => [styles.step, pressed && styles.pressed]}
        >
          <Text style={styles.stepLabel}>＋</Text>
        </Pressable>
      </View>
      {editing ? (
        <NumberEditor
          label={label}
          value={value}
          suffix={suffix}
          min={min}
          max={max}
          decimals={decimals}
          optional={optional}
          onChange={onChange}
          onClose={() => setEditing(false)}
        />
      ) : null}
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
  stepLabel: { fontSize: 24, fontWeight: '600', color: colors.ink },
  dateValue: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  dateMain: { fontSize: type.body, fontWeight: '600', color: colors.ink },
  editHint: { fontSize: type.caption, color: colors.accent, marginTop: spacing.xs },
}));
