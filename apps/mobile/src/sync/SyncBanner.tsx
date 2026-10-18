import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSync } from './SyncProvider';
import { radius, spacing, type, createThemedStyles } from '../theme';

/**
 * What has not reached the server yet.
 *
 * Silence about queued work is the failure mode to avoid: a herder who cannot tell whether a birth
 * was saved will record it again on paper, and then the app has cost them time rather than saved
 * it. So the banner says plainly what is waiting, and offers to try again now.
 */
export function SyncBanner() {
  const styles = useStyles();
  const { t } = useTranslation('common');
  const { pending, stuck, legacy, error, online, flushing, flush, recoverLegacy } = useSync();

  if (pending === 0 && legacy === 0 && !error && online) return null;

  const offline = !online;

  return (
    <View style={[styles.bar, offline && styles.barOffline]}>
      <Text style={[styles.text, offline && styles.textOffline]}>
        {error
          ? t('storageError')
          : legacy
            ? t('legacyWrites', { count: legacy })
            : offline
              ? t('offline')
              : null}
        {offline && pending > 0 ? ' · ' : null}
        {pending > 0 ? t('waitingToSend', { count: pending }) : null}
        {stuck > 0 ? ` · ${t('stuckWrites', { count: stuck })}` : null}
      </Text>

      {pending > 0 || legacy > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void (legacy ? recoverLegacy() : flush())}
          disabled={flushing}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>
            {flushing ? t('syncing') : legacy ? t('recoverWrites') : t('sendNow')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.accentSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  barOffline: { backgroundColor: colors.surfaceAlt, borderBottomColor: colors.line },
  text: { flexShrink: 1, fontSize: type.label, color: colors.accent, fontWeight: '600' },
  textOffline: { color: colors.inkSoft },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  pressed: { opacity: 0.8 },
  actionLabel: { fontSize: type.caption, fontWeight: '700', color: colors.accent },
}));
