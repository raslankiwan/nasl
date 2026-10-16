import type { ComponentProps, ReactNode } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  I18nManager,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { MIN_TOUCH, radius, spacing, type, useTheme, createThemedStyles } from '../theme';

export function Screen({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
      {children}
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const styles = useStyles();
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  const styles = useStyles();
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
  variant?: 'primary' | 'secondary' | 'text';
  disabled?: boolean;
  busy?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
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
        variant === 'text' && styles.buttonText,
        (disabled || busy) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={isPrimary ? colors.onAccent : colors.ink} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            isPrimary && styles.buttonLabelPrimary,
            variant === 'text' && { color: colors.accent },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  // Native text alignment already follows I18nManager; web follows the active locale.
  const textAlign = Platform.OS === 'web' && i18n.dir() === 'rtl' ? 'right' : 'left';
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { textAlign }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[styles.input, { textAlign }, props.style]}
      />
      {hint ? <Text style={[styles.hint, { textAlign }]}>{hint}</Text> : null}
    </View>
  );
}

/**
 * `warning` is a question — "is that really ten kilos of cheese?" — and is deliberately not
 * coloured like `danger`. Something the herder may well answer "yes, it is" to must not look like
 * something that went wrong, or they learn to dismiss both without reading.
 */
export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'danger';
}) {
  const styles = useStyles();
  return (
    <View
      style={[
        styles.notice,
        tone === 'warning' && styles.noticeWarning,
        tone === 'danger' && styles.noticeDanger,
      ]}
    >
      <Text
        style={[
          styles.noticeText,
          tone === 'warning' && styles.noticeTextWarning,
          tone === 'danger' && styles.noticeTextDanger,
        ]}
      >
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
  const styles = useStyles();
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

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function IconButton({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={24} color={colors.accent} accessible={false} />
    </Pressable>
  );
}

/** Navigation rows disclose destinations; filled buttons commit work. */
export function NavigationRow({
  label,
  icon,
  onPress,
  destructive = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  destructive?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.navigationRow, pressed && styles.buttonPressed]}
    >
      <View style={[styles.navigationIcon, destructive && { backgroundColor: colors.rustSoft }]}>
        <MaterialCommunityIcons
          name={icon}
          size={21}
          color={destructive ? colors.rust : colors.accent}
          accessible={false}
        />
      </View>
      <Text style={[styles.navigationLabel, destructive && { color: colors.rust }]}>{label}</Text>
      {!destructive && (
        <MaterialCommunityIcons
          name={
            (Platform.OS === 'web' ? i18n.dir() === 'rtl' : I18nManager.isRTL)
              ? 'chevron-left'
              : 'chevron-right'
          }
          size={20}
          color={colors.muted}
          accessible={false}
        />
      )}
    </Pressable>
  );
}

export function RowGroup({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <View style={styles.rowGroup}>{children}</View>;
}

export function SearchField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('common');
  return (
    <View style={styles.search}>
      <MaterialCommunityIcons name="magnify" size={22} color={colors.muted} accessible={false} />
      <TextInput
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        maxLength={60}
        autoCorrect={false}
        returnKeyType="search"
        style={[
          styles.searchInput,
          { textAlign: Platform.OS === 'web' && i18n.dir() === 'rtl' ? 'right' : 'left' },
        ]}
      />
      {value ? (
        <IconButton label={t('clearSearch')} icon="close-circle" onPress={() => onChangeText('')} />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  buttonText: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
  },
  iconButton: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  rowGroup: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  navigationRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  navigationIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigationLabel: { flex: 1, fontSize: type.body, color: colors.ink, fontWeight: '500' },
  search: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    paddingStart: spacing.md,
    paddingEnd: spacing.xs,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH,
    fontSize: type.body,
    color: colors.ink,
  },
  screen: { flex: 1, backgroundColor: colors.paper, padding: spacing.lg },
  title: { fontSize: type.display, fontWeight: '700', color: colors.ink, marginBottom: spacing.md },
  body: { fontSize: type.body, color: colors.inkSoft, lineHeight: 24 },
  muted: { color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
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
  noticeWarning: { backgroundColor: colors.accentSoft, borderStartColor: colors.accent },
  noticeDanger: { backgroundColor: colors.rustSoft, borderStartColor: colors.rust },
  noticeText: { color: colors.ink, fontSize: type.label },
  noticeTextWarning: { color: colors.accent },
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
}));
