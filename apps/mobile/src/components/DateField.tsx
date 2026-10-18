import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { startOfDay, toDateString } from '@nasl/shared';
import { calendarDate, calendarDays, changeCalendarMonth, clampCalendarDate } from '../calendar';
import { MIN_TOUCH, radius, spacing, type, createThemedStyles } from '../theme';

/** One offline calendar for every event/expiry field, on web and native. */
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
  const rtl = i18n.dir() === 'rtl';
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const [yearPage, setYearPage] = useState(value.getUTCFullYear() - 6);
  const today = startOfDay(new Date());
  const min = calendarDate(1900, 0);
  const max = allowFuture ? calendarDate(today.getUTCFullYear() + 100, 11, 31) : today;
  const bounded = (date: Date) => clampCalendarDate(date, min, max);
  const year = draft.getUTCFullYear();
  const month = draft.getUTCMonth();
  const monthStart = calendarDate(year, month);
  const dateKey = toDateString(draft);
  const selectMonth = (date: Date) => {
    setDraft(bounded(date));
    setMode('days');
  };
  const close = () => setOpen(false);
  const show = () => {
    setDraft(bounded(startOfDay(value)));
    setMode('days');
    setYearPage(value.getUTCFullYear() - 6);
    setOpen(true);
  };
  const previousDisabled = mode === 'years' ? yearPage <= min.getUTCFullYear() : monthStart <= min;
  const nextDisabled =
    mode === 'years' ? yearPage + 11 >= max.getUTCFullYear() : calendarDate(year, month + 1) > max;
  const navigate = (direction: number) => {
    if (mode === 'years') setYearPage((current) => current + direction * 12);
    else setDraft(bounded(changeCalendarMonth(draft, direction)));
  };

  return (
    <View style={styles.field}>
      <Text style={[styles.label, Platform.OS === 'web' && rtl && { textAlign: 'right' }]}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDate(value, locale)}`}
        accessibilityHint={t('chooseDate')}
        onPress={show}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <View style={styles.value}>
          <Text style={styles.main}>{formatDate(value, locale)}</Text>
          <Text style={styles.muted}>{formatHijriDate(value, locale)}</Text>
        </View>
        <Text style={styles.link}>{t('chooseDate')}</Text>
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View
            style={[styles.dialog, { direction: rtl ? 'rtl' : 'ltr' }]}
            role="dialog"
            aria-modal
            accessibilityLabel={`${t('chooseDate')} — ${label}`}
            accessibilityViewIsModal
          >
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text accessibilityRole="header" style={styles.heading}>
                {label}
              </Text>
              <Text style={styles.preview}>{formatDate(draft, locale, { dateStyle: 'full' })}</Text>
              <Text style={styles.muted}>{formatHijriDate(draft, locale)}</Text>

              <View style={styles.navigation}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(mode === 'years' ? 'previousYears' : 'previousMonth')}
                  disabled={previousDisabled}
                  onPress={() => navigate(-1)}
                  style={[styles.arrow, previousDisabled && styles.disabled]}
                >
                  <Text style={styles.arrowText}>{rtl ? '›' : '‹'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('selectMonth')}
                  onPress={() => setMode(mode === 'months' ? 'days' : 'months')}
                  style={[styles.selector, mode === 'months' && styles.selected]}
                >
                  <Text style={styles.selectorText}>
                    {formatDate(draft, locale, { month: 'long' })} ▾
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('selectYear')}
                  onPress={() => {
                    setYearPage(year - 6);
                    setMode(mode === 'years' ? 'days' : 'years');
                  }}
                  style={[styles.yearSelector, mode === 'years' && styles.selected]}
                >
                  <Text style={styles.selectorText}>{year} ▾</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(mode === 'years' ? 'nextYears' : 'nextMonth')}
                  disabled={nextDisabled}
                  onPress={() => navigate(1)}
                  style={[styles.arrow, nextDisabled && styles.disabled]}
                >
                  <Text style={styles.arrowText}>{rtl ? '‹' : '›'}</Text>
                </Pressable>
              </View>

              {mode === 'days' ? (
                <>
                  <View style={styles.grid}>
                    {Array.from({ length: 7 }, (_, i) => (
                      <Text key={i} style={styles.weekday}>
                        {formatDate(calendarDate(2026, 5, 7 + i), locale, { weekday: 'short' })}
                      </Text>
                    ))}
                  </View>
                  <View style={styles.grid}>
                    {calendarDays(monthStart).map((day, index) => {
                      if (!day) return <View key={`empty-${index}`} style={styles.day} />;
                      const selected = toDateString(day) === dateKey;
                      const disabled = day < min || day > max;
                      return (
                        <Pressable
                          key={toDateString(day)}
                          accessibilityRole="button"
                          accessibilityLabel={formatDate(day, locale, { dateStyle: 'full' })}
                          accessibilityState={{ selected, disabled }}
                          disabled={disabled}
                          onPress={() => setDraft(day)}
                          style={[
                            styles.day,
                            selected && styles.selected,
                            disabled && styles.disabled,
                          ]}
                        >
                          <Text style={[styles.dayText, selected && styles.selectedText]}>
                            {day.getUTCDate()}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.modeLabel}>
                    {mode === 'years' ? `${yearPage} – ${yearPage + 11}` : t('selectMonth')}
                  </Text>
                  <View style={styles.grid}>
                    {Array.from({ length: 12 }, (_, i) => {
                      const candidateYear = mode === 'years' ? yearPage + i : year;
                      const candidateMonth = mode === 'months' ? i : month;
                      const date = calendarDate(candidateYear, candidateMonth, draft.getUTCDate());
                      const disabled =
                        mode === 'years'
                          ? candidateYear < min.getUTCFullYear() ||
                            candidateYear > max.getUTCFullYear()
                          : calendarDate(candidateYear, candidateMonth) > max;
                      const selected = candidateYear === year && candidateMonth === month;
                      return (
                        <Pressable
                          key={i}
                          accessibilityRole="button"
                          accessibilityState={{ selected, disabled }}
                          disabled={disabled}
                          onPress={() => selectMonth(date)}
                          style={[
                            styles.option,
                            selected && styles.selected,
                            disabled && styles.disabled,
                          ]}
                        >
                          <Text style={[styles.dayText, selected && styles.selectedText]}>
                            {mode === 'years'
                              ? candidateYear
                              : formatDate(date, locale, { month: 'long' })}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              <View style={styles.quickDates}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => selectMonth(today)}
                  style={styles.quick}
                >
                  <Text style={styles.link}>{t('today')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => selectMonth(new Date(today.getTime() - 86_400_000))}
                  style={styles.quick}
                >
                  <Text style={styles.link}>{t('yesterday')}</Text>
                </Pressable>
              </View>
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" onPress={close} style={styles.cancel}>
                  <Text style={styles.main}>{t('cancel')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(startOfDay(draft));
                    close();
                  }}
                  style={styles.confirm}
                >
                  <Text style={styles.confirmText}>{t('done')}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  field: { marginBottom: spacing.lg },
  label: { fontSize: type.label, color: colors.muted, fontWeight: '600', marginBottom: spacing.sm },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  value: { flex: 1, gap: spacing.xs },
  main: { color: colors.ink, fontSize: type.body, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: type.caption },
  link: { color: colors.accent, fontSize: type.label, fontWeight: '600' },
  pressed: { opacity: 0.85 },
  backdrop: {
    flex: 1,
    backgroundColor: '#00000080',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.sm,
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '92%',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    overflow: 'hidden',
  },
  content: { padding: spacing.md },
  heading: {
    color: colors.muted,
    fontSize: type.label,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  preview: {
    color: colors.ink,
    fontSize: type.heading,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  navigation: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.md },
  arrow: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowText: { fontSize: 30, color: colors.ink },
  selector: {
    flex: 1,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  yearSelector: {
    minWidth: 72,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  selectorText: { color: colors.ink, fontWeight: '700', fontSize: type.label },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: {
    width: '14.285714%',
    textAlign: 'center',
    color: colors.muted,
    fontSize: 11,
    paddingVertical: spacing.sm,
  },
  day: {
    width: '14.285714%',
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  dayText: { color: colors.ink, fontSize: type.body, textAlign: 'center' },
  selected: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  selectedText: { color: colors.accent, fontWeight: '700' },
  disabled: { opacity: 0.3 },
  option: {
    width: '33.333333%',
    minHeight: 60,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.sm,
    padding: spacing.xs,
  },
  modeLabel: {
    color: colors.muted,
    fontSize: type.label,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  quickDates: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  quick: { minHeight: MIN_TOUCH, minWidth: 80, alignItems: 'center', justifyContent: 'center' },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  cancel: {
    flex: 1,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  confirm: {
    flex: 1,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
  },
  confirmText: { fontSize: type.body, fontWeight: '700', color: colors.onAccent },
}));
