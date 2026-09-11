import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { colors, MIN_TOUCH, radius, spacing, type } from '../theme';

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  busy?: boolean;
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
        (disabled || busy) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={isPrimary ? colors.onAccent : colors.ink} />
      ) : (
        <Text style={[styles.buttonLabel, isPrimary && styles.buttonLabelPrimary]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.input, props.style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'danger';
}) {
  return (
    <View style={[styles.notice, tone === 'danger' && styles.noticeDanger]}>
      <Text style={[styles.noticeText, tone === 'danger' && styles.noticeTextDanger]}>
        {children}
      </Text>
    </View>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'good';
}) {
  return (
    <View
      style={[
        styles.pill,
        tone === 'accent' && styles.pillAccent,
        tone === 'good' && styles.pillGood,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          tone === 'accent' && styles.pillTextAccent,
          tone === 'good' && styles.pillTextGood,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper, padding: spacing.lg },
  title: { fontSize: type.title, fontWeight: '700', color: colors.ink, marginBottom: spacing.sm },
  body: { fontSize: type.body, color: colors.inkSoft, lineHeight: 24 },
  muted: { color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  button: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
  },
  buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.surface, borderColor: colors.line },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: { fontSize: type.body, fontWeight: '600', color: colors.ink },
  buttonLabelPrimary: { color: colors.onAccent },
  field: { marginBottom: spacing.lg },
  fieldLabel: {
    fontSize: type.label,
    color: colors.muted,
    marginBottom: spacing.xs,
    fontWeight: '500',
    // Labels follow the writing direction rather than a hard-coded side.
    textAlign: 'left',
  },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: type.body,
    color: colors.ink,
    textAlign: 'left',
  },
  hint: { fontSize: type.caption, color: colors.muted, marginTop: spacing.xs, textAlign: 'left' },
  notice: {
    backgroundColor: colors.accentSoft,
    borderStartWidth: 3,
    borderStartColor: colors.accent,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeDanger: { backgroundColor: colors.rustSoft, borderStartColor: colors.rust },
  noticeText: { color: colors.ink, fontSize: type.label },
  noticeTextDanger: { color: colors.rust },
  pill: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  pillAccent: { backgroundColor: colors.accentSoft },
  pillGood: { backgroundColor: colors.sageSoft },
  pillText: { fontSize: type.caption, color: colors.inkSoft, fontWeight: '500' },
  pillTextAccent: { color: colors.accent },
  pillTextGood: { color: colors.sage },
});
