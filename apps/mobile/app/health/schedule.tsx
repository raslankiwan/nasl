import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDate, type Locale } from '@nasl/i18n';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Notice, Pill, Screen } from '../../src/components/ui';
import { MIN_TOUCH, radius, spacing, type, useTheme, createThemedStyles } from '../../src/theme';

interface Group {
  protocolId: string;
  stepId: string;
  nameEn: string;
  nameAr: string;
  noteEn: string | null;
  noteAr: string | null;
  deliveredBy: 'farm' | 'official';
  dueOn: string;
  overdue: number;
  due: number;
  upcoming: number;
  animals: Array<{ animalId: string; tagNumber: string; name: string | null; dueOn: string }>;
}
interface Schedule {
  total: number;
  disclaimer: { en: string; ar: string };
  groups: Group[];
}
interface Protocol {
  id: string;
  nameEn: string;
  nameAr: string;
  deliveredBy: 'farm' | 'official';
  source: { en: string; ar: string };
  enabled: boolean;
}

/**
 * What the flock is owed (FR-HLT-07).
 *
 * One card per dose, not one per animal: eighty rows reading "pre-lambing booster" is a list
 * nobody works through, while "24 ewes, due Thursday" is a morning's job.
 *
 * Campaign vaccines are marked as the veterinary service's to give and carry no record button —
 * Rev-1 is a live zoonotic vaccine and this screen must never read as an instruction to inject
 * one. The disclaimer comes from the server in both languages, so there is one wording to keep
 * right rather than two.
 */
export default function ScheduleScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation(['health', 'common']);
  const { farmId } = useAuth();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;
  const arabic = locale === 'ar';

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!farmId) return setLoading(false);
    try {
      const [tasks, library] = await Promise.all([
        api.get<Schedule>(`/v1/farms/${farmId}/health/protocol-tasks`),
        api.get<{ protocols: Protocol[] }>(`/v1/farms/${farmId}/health/protocols`),
      ]);
      setSchedule(tasks);
      setProtocols(library.protocols);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    } finally {
      setLoading(false);
    }
  }, [farmId, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Records the dose for everyone the step is due for, against the step, so the task closes and
   * the one that follows it is measured from today rather than from a date on a calendar.
   */
  const recordGiven = async (group: Group) => {
    setSaving(group.stepId);
    setError(null);
    try {
      await api.post(`/v1/farms/${farmId}/health/treatments`, {
        animalIds: group.animals.map((a) => a.animalId),
        date: new Date().toISOString().slice(0, 10),
        type: 'vaccination',
        protocolStepId: group.stepId,
        administeredBy: arabic ? group.nameAr : group.nameEn,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    } finally {
      setSaving(null);
    }
  };

  /**
   * A farm outside a campaign area has no use for an FMD reminder, and a farm that dung-samples
   * wants the worm one. Toggling is optimistic and reloads: the schedule changes underneath, so
   * showing it stale would be worse than a moment's wait.
   */
  const toggle = async (protocolId: string, on: boolean) => {
    const next = on
      ? [...protocols.filter((p) => p.enabled).map((p) => p.id), protocolId]
      : protocols.filter((p) => p.enabled && p.id !== protocolId).map((p) => p.id);

    setProtocols((current) =>
      current.map((p) => (p.id === protocolId ? { ...p, enabled: on } : p)),
    );
    try {
      await api.put(`/v1/farms/${farmId}/health/protocols`, { protocolIds: next });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
      await load();
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      >
        <Screen>
          <ScreenHeader title={t('health:schedule')} />

          {error ? <Notice tone="danger">{error}</Notice> : null}

          {schedule ? (
            <Notice>{arabic ? schedule.disclaimer.ar : schedule.disclaimer.en}</Notice>
          ) : null}

          <Button
            label={showSettings ? t('common:done') : t('health:whichProtocols')}
            variant="secondary"
            onPress={() => setShowSettings((v) => !v)}
          />
          <View style={styles.gap} />

          {showSettings
            ? protocols.map((protocol) => (
                <Pressable
                  key={protocol.id}
                  style={styles.toggleRow}
                  onPress={() => void toggle(protocol.id, !protocol.enabled)}
                >
                  <View style={styles.toggleText}>
                    <Text style={styles.name}>{arabic ? protocol.nameAr : protocol.nameEn}</Text>
                    <Text style={styles.source}>
                      {arabic ? protocol.source.ar : protocol.source.en}
                    </Text>
                  </View>
                  <Switch
                    value={protocol.enabled}
                    onValueChange={(on) => void toggle(protocol.id, on)}
                    trackColor={{ true: colors.sage, false: colors.line }}
                  />
                </Pressable>
              ))
            : null}

          {schedule && schedule.groups.length === 0 && !loading ? (
            <Body muted>{t('health:scheduleEmpty')}</Body>
          ) : null}

          {schedule?.groups.map((group) => (
            <View key={group.stepId} style={[styles.card, group.overdue > 0 && styles.cardOverdue]}>
              <Text style={styles.name}>{arabic ? group.nameAr : group.nameEn}</Text>

              <View style={styles.pills}>
                <Pill tone={group.deliveredBy === 'official' ? 'neutral' : 'accent'}>
                  {t(`health:givenBy.${group.deliveredBy}` as 'health:givenBy.farm')}
                </Pill>
                {/* Separate nodes, so an Arabic count and a Latin date do not share a bidi run. */}
                <Pill tone="neutral">{formatDate(new Date(group.dueOn), locale)}</Pill>
              </View>

              <Text style={styles.counts}>
                {[
                  group.overdue > 0 && t('health:animalsOverdue', { count: group.overdue }),
                  group.due > 0 && t('health:animalsDue', { count: group.due }),
                  group.upcoming > 0 && t('health:animalsUpcoming', { count: group.upcoming }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>

              {(arabic ? group.noteAr : group.noteEn) ? (
                <Text style={styles.note}>{arabic ? group.noteAr : group.noteEn}</Text>
              ) : null}

              <Text style={styles.tags} numberOfLines={2}>
                {group.animals.map((a) => a.tagNumber).join('، ')}
              </Text>

              {group.deliveredBy === 'farm' ? (
                <Button
                  label={t('health:markGiven')}
                  variant="secondary"
                  disabled={saving !== null}
                  onPress={() => void recordGiven(group)}
                />
              ) : null}
            </View>
          ))}
        </Screen>
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.paper },
  gap: { height: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardOverdue: { borderStartWidth: 4, borderStartColor: colors.rust },
  name: { fontSize: type.heading, color: colors.ink, fontWeight: '600' },
  pills: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  counts: { fontSize: type.label, color: colors.inkSoft },
  note: { fontSize: type.label, color: colors.muted, lineHeight: 20 },
  toggleRow: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  toggleText: { flex: 1, gap: spacing.xs },
  // The source is here so a farm can see why the app thinks a dose is due, and take it to a vet.
  source: { fontSize: type.caption, color: colors.muted, lineHeight: 17 },
  tags: { fontSize: type.caption, color: colors.muted },
}));
