import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { api } from '../../src/api/client';
import { useAnimal } from '../../src/sync/useFlock';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Card, Notice, Pill, Screen, Title } from '../../src/components/ui';
import { ACTION_LABELS, ACTION_ROUTES } from '../../src/breeding';
import { actionsFor, type ReproState } from '@nasl/shared';
import { colors, spacing, type } from '../../src/theme';

interface WeightHistory {
  current: number | null;
  lifetimeGainPerDay: number | null;
  adjusted90DayWeightKg: number | null;
  entries: Array<{ id: string; date: string; kg: number; gainPerDay: number | null }>;
}

interface TreatmentRow {
  id: string;
  date: string;
  type: string;
  productName: string | null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export default function AnimalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation(['animals', 'breeding', 'health', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;

  // Read from the device first, refresh behind it — the pen is where the signal is not.
  const { animal, loading, stale } = useAnimal(id);
  const [treatments, setTreatments] = useState<TreatmentRow[]>([]);
  const [weights, setWeights] = useState<WeightHistory | null>(null);

  useEffect(() => {
    if (!farmId || !id) return;
    // Treatment history is still network-only; an empty list is the honest offline answer.
    api
      .get<{ events: TreatmentRow[] }>(`/v1/farms/${farmId}/health/animals/${id}`)
      .then((res) => setTreatments(res.events))
      .catch(() => setTreatments([]));

    api
      .get<WeightHistory>(`/v1/farms/${farmId}/weights/${id}`)
      .then(setWeights)
      .catch(() => setWeights(null));
  }, [farmId, id]);

  const dash = '—';
  const actions =
    animal && animal.sex === 'female' && animal.status === 'active'
      ? actionsFor(animal.repro?.state as ReproState | undefined)
      : [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView>
        <Screen>
          <Button label={t('common:back')} variant="secondary" onPress={() => router.back()} />
          <View style={styles.gap} />

          {stale ? <Body muted>{t('common:offline')}</Body> : null}

          {animal ? (
            <>
              <View style={styles.head}>
                <Title>{animal.name ?? animal.tagNumber}</Title>
                {/* Only worth repeating the tag when the title is a name. */}
                {animal.name ? <Text style={styles.tag}>{animal.tagNumber}</Text> : null}
              </View>

              {/*
                Both restrictions, and milk first. For a dairy flock the milk hold is the one that
                bites twice a day; the meat hold only matters on the day she leaves.
              */}
              {animal.withholdMilkUntil ? (
                <Notice tone="danger">
                  {t('health:milkWithholdUntil', {
                    date: formatDate(new Date(animal.withholdMilkUntil), locale),
                  })}
                </Notice>
              ) : null}
              {animal.withholdMeatUntil ? (
                <Notice tone="danger">
                  {t('health:meatWithholdUntil', {
                    date: formatDate(new Date(animal.withholdMeatUntil), locale),
                  })}
                </Notice>
              ) : null}

              <Card>
                <Row
                  label={t('animals:species')}
                  value={t(
                    `animals:speciesValues.${animal.species}` as 'animals:speciesValues.sheep',
                  )}
                />
                <Row
                  label={t('animals:sex')}
                  value={t(`animals:sexValues.${animal.sex}` as 'animals:sexValues.female')}
                />
                <Row
                  label={t('animals:dateOfBirth')}
                  value={
                    animal.dateOfBirth
                      ? `${formatDate(new Date(animal.dateOfBirth), locale)} · ${formatHijriDate(new Date(animal.dateOfBirth), locale)}`
                      : dash
                  }
                />
                <Row
                  label={t('animals:status')}
                  value={t(
                    `animals:statusValues.${animal.status}` as 'animals:statusValues.active',
                  )}
                />
                <Row
                  label={t('animals:weight')}
                  value={animal.lastWeightKg ? `${animal.lastWeightKg} kg` : dash}
                />
              </Card>

              {animal.sex === 'female' && animal.status === 'active' ? (
                <>
                  <View style={styles.gap} />
                  <Card>
                    <Body>{t('breeding:title')}</Body>
                    <View style={styles.gap} />
                    <Pill tone={animal.repro?.state === 'due' ? 'accent' : 'good'}>
                      {t(
                        `breeding:states.${animal.repro?.state ?? 'open'}` as 'breeding:states.open',
                      )}
                    </Pill>
                    {animal.repro?.dueDate ? (
                      <Row
                        label={t('breeding:dueDate')}
                        value={formatDate(new Date(animal.repro.dueDate), locale)}
                      />
                    ) : null}
                  </Card>

                  <View style={styles.gap} />

                  {/*
                    Only the actions her current state actually allows. The list comes from the
                    same state machine the server enforces, so the phone never offers a form that
                    will come back refused.
                  */}
                  {actions.length > 0 ? (
                    actions.map((action) => (
                      <View key={action} style={styles.actionSpacing}>
                        <Button
                          label={t(ACTION_LABELS[action] as 'breeding:recordMating')}
                          variant={action === 'abortion' ? 'secondary' : 'primary'}
                          onPress={() =>
                            router.push({
                              pathname: ACTION_ROUTES[action],
                              params: { damId: animal.id },
                            })
                          }
                        />
                      </View>
                    ))
                  ) : (
                    <Body muted>{t('breeding:nothingToRecord')}</Body>
                  )}
                </>
              ) : null}

              <View style={styles.gap} />
              <Button
                label={t('animals:recordWeight')}
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/animal/weigh', params: { animalId: animal.id } })
                }
              />

              {weights && weights.entries.length > 0 ? (
                <>
                  <View style={styles.gap} />
                  <Card>
                    <Body>{t('animals:weightHistory')}</Body>
                    <View style={styles.gap} />
                    {weights.lifetimeGainPerDay !== null ? (
                      <Row
                        label={t('animals:gainPerDay')}
                        value={`${weights.lifetimeGainPerDay} kg`}
                      />
                    ) : null}
                    {weights.adjusted90DayWeightKg !== null ? (
                      <Row
                        label={t('animals:adjusted90')}
                        value={`${weights.adjusted90DayWeightKg} kg`}
                      />
                    ) : null}
                    {weights.entries
                      .slice(-5)
                      .reverse()
                      .map((entry) => (
                        <Row
                          key={entry.id}
                          label={formatDate(new Date(entry.date), locale)}
                          value={`${entry.kg} kg${entry.gainPerDay !== null ? `  ·  ${entry.gainPerDay}/d` : ''}`}
                        />
                      ))}
                  </Card>
                </>
              ) : null}

              <View style={styles.gap} />
              <Button
                label={t('breeding:pedigree')}
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/animal/pedigree', params: { id: animal.id } })
                }
              />

              {/* Health applies to every animal, not only the breeding females. */}
              {animal.status === 'active' ? (
                <>
                  <View style={styles.gap} />
                  <Button
                    label={t('health:recordTreatment')}
                    variant="secondary"
                    onPress={() =>
                      router.push({ pathname: '/health/treat', params: { animalId: animal.id } })
                    }
                  />
                </>
              ) : null}

              {treatments.length > 0 ? (
                <>
                  <View style={styles.gap} />
                  <Card>
                    <Body>{t('health:history')}</Body>
                    <View style={styles.gap} />
                    {treatments.map((event) => (
                      <Row
                        key={event.id}
                        label={formatDate(new Date(event.date), locale)}
                        value={
                          event.productName ??
                          t(`health:eventTypes.${event.type}` as 'health:eventTypes.treatment')
                        }
                      />
                    ))}
                  </Card>
                </>
              ) : null}
            </>
          ) : loading ? (
            <Body muted>{t('common:loading')}</Body>
          ) : (
            <Body muted>{t('common:empty')}</Body>
          )}
        </Screen>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  head: { marginBottom: spacing.md },
  tag: { fontSize: type.heading, color: colors.muted, fontWeight: '600', writingDirection: 'ltr' },
  gap: { height: spacing.md },
  actionSpacing: { marginBottom: spacing.sm },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  detailLabel: { fontSize: type.label, color: colors.muted },
  detailValue: {
    fontSize: type.body,
    color: colors.ink,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
  },
});
