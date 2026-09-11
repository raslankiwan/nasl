import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LOCALE_META, otherLocale, type Locale } from '@nasl/i18n';
import { directionMatches, setLocale } from '../i18n';
import { colors, MIN_TOUCH, radius, spacing, type } from '../theme';

/**
 * With two locales a switcher is a toggle, not a menu. The button shows the language you would
 * switch *to*, named in its own script, so a reader who cannot read the current interface can
 * still find their way out of it.
 *
 * Switching between Arabic and English also flips the native layout direction, and React Native
 * only applies that on restart — so we say so first rather than having the app vanish.
 */
export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation('common');
  const [busy, setBusy] = useState(false);
  const current = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const next = otherLocale(current);

  const switchNow = async () => {
    setBusy(true);
    try {
      await setLocale(next);
    } finally {
      setBusy(false);
    }
  };

  const onPress = () => {
    // Web and same-direction switches apply immediately; only a direction flip needs a restart.
    if (Platform.OS === 'web' || directionMatches(next)) {
      void switchNow();
      return;
    }

    Alert.alert(t('switchLanguage'), t('restartNeeded'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('confirm'), onPress: () => void switchNow() },
    ]);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('switchLanguage')}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.toggle, compact && styles.compact, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{LOCALE_META[next].nativeLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { minHeight: 36, paddingHorizontal: spacing.md },
  pressed: { opacity: 0.8 },
  label: { fontSize: type.label, fontWeight: '600', color: colors.ink },
});
