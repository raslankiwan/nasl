import { I18nManager, Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { radius, spacing, createThemedStyles } from '../theme';

/**
 * A large numeric keypad, used instead of the system keyboard (scope NFR-04).
 *
 * The system number pad puts small keys at the bottom of a tall screen and steals half the view.
 * This is operated one-handed, in a pen, sometimes with gloves — so the keys are large, fixed in
 * place, and laid out left-to-right in both languages, because digits are digits.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export function Keypad({
  onDigit,
  onBackspace,
  onClear,
  onDecimal,
  disabled,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onDecimal?: () => void;
  disabled?: boolean;
}) {
  const styles = useStyles();
  const { t, i18n } = useTranslation('common');
  const rtl = Platform.OS === 'web' ? i18n.dir() === 'rtl' : I18nManager.isRTL;

  /**
   * Digits read 1-2-3 left-to-right in every language, so the visual order must not mirror with
   * the interface. `direction` is not a usable style here — react-native-web rejects it — so the
   * row is reversed instead, which cancels the mirroring Yoga applies under RTL.
   */
  return (
    <View style={[styles.pad, rtl && styles.padRTL]}>
      {KEYS.map((key) => (
        <Key disabled={disabled} key={key} label={key} onPress={() => onDigit(key)} />
      ))}
      <Key
        disabled={disabled}
        label="⌫"
        onPress={onBackspace}
        tone="muted"
        accessibilityLabel={t('backspace')}
      />
      <Key disabled={disabled} label="0" onPress={() => onDigit('0')} />
      {onDecimal ? (
        <Key
          disabled={disabled}
          label="."
          onPress={onDecimal}
          accessibilityLabel={t('decimalPoint')}
        />
      ) : (
        <Key
          disabled={disabled}
          label="✕"
          onPress={onClear}
          tone="muted"
          accessibilityLabel={t('clearValue')}
        />
      )}
    </View>
  );
}

function Key({
  label,
  onPress,
  tone = 'normal',
  accessibilityLabel,
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: 'normal' | 'muted';
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.key,
        tone === 'muted' && styles.keyMuted,
        pressed && styles.keyPressed,
        disabled && styles.keyDisabled,
      ]}
    >
      <Text style={[styles.keyLabel, tone === 'muted' && styles.keyLabelMuted]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  padRTL: { flexDirection: 'row-reverse' },
  key: {
    width: '31%',
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  keyMuted: { backgroundColor: colors.surfaceAlt },
  keyPressed: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  keyDisabled: { opacity: 0.4 },
  keyLabel: { fontSize: 26, fontWeight: '600', color: colors.ink },
  keyLabelMuted: { color: colors.muted, fontSize: 22 },
}));
