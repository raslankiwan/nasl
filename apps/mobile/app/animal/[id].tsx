import { useHeaderHeight } from 'expo-router/react-navigation';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { api } from '../../src/api/client';
import { useAnimal } from '../../src/sync/useFlock';
import { useAuth } from '../../src/auth/AuthProvider';
import {
  Body,
  Button,
  Card,
  IconButton,
  NavigationRow,
  Notice,
  Pill,
  Screen,
  Title,
} from '../../src/components/ui';
import { ACTION_LABELS, ACTION_ROUTES } from '../../src/breeding';
import { actionsFor, can, type Role, type ReproState, type Species } from '@nasl/shared';
import { LambingWindow } from '../../src/components/LambingWindow';
import { AnimalNameEditor } from '../../src/components/AnimalNameEditor';
import { spacing, type, createThemedStyles } from '../../src/theme';

interface LactationRow {
  lactationId: string;
  startDate: string;
  status: string;
  daysInMilk: number;
  testDays: number;
  totalKg: number;
  standardised150Kg: number;
  peakKg: number | null;
}

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
  const styles = useStyles();
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export default function AnimalScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation(['animals', 'breeding', 'health', 'pens', 'milk', 'common']);
  const { farmId, me } = useAuth();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const locale = (i18n.resolvedLanguage ?? 'ar') as Locale;

  // Read from the device first, refresh behind it — the pen is where the signal is not.
  const { animal, loading, stale, refresh } = useAnimal(id);
  const [editingName, setEditingName] = useState(false);
  const role = me?.farms.find((farm) => farm.farmId === farmId)?.role;
  const canEdit = role && can(role as Role, 'animals:write');
  const [treatments, setTreatments] = useState<TreatmentRow[]>([]);
  const [weights, setWeights] = useState<WeightHistory | null>(null);
  const [lactations, setLactations] = useState<LactationRow[]>([]);

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

    api
      .get<{ lactations: LactationRow[] }>(`/v1/farms/${farmId}/milk/animals/${id}`)
      .then((res) => setLactations(res.lactations))
      .catch(() => setLactations([]));
  }, [farmId, id]);

  const dash = '—';
  const actions =
    animal && animal.sex === 'female' && animal.status === 'active'
      ? actionsFor(animal.repro?.state as ReproState | undefined)
      : [];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
      style={styles.root}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <Screen>
          <ScreenHeader
            title={t('animals:animalDetails')}
            action={
              animal && farmId && canEdit && !editingName ? (
                <IconButton
                  label={t('animals:editNameOrLabel')}
                  icon="pencil-outline"
                  onPress={() => setEditingName(true)}
                />
              ) : undefined
            }
          />

          {stale ? <Body muted>{t('common:offline')}</Body> : null}

          {animal ? (
            <>
              <View style={styles.head}>
                <Title>{animal.name || animal.tagNumber}</Title>
                {/* Only worth repeating the tag when the title is a name. */}
                {animal.name ? <Text style={styles.tag}>{animal.tagNumber}</Text> : null}
              </View>

              {farmId && canEdit && editingName ? (
                <View style={styles.actionSpacing}>
                  <AnimalNameEditor
                    key={animal.id}
                    farmId={farmId}
                    animal={animal}
                    onCancel={() => setEditingName(false)}
                    onSaved={() => {
                      setEditingName(false);
                      void refresh();
                    }}
                  />
                </View>
              ) : null}

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
                      <LambingWindow
                        dueDate={animal.repro.dueDate}
                        species={animal.species as Species}
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

              {/* Her litres sit beside her lambs: Awassi is kept for both. */}
              {lactations.length > 0 ? (
                <>
                  <View style={styles.gap} />
                  <Card>
                    <View style={styles.milkHead}>
                      <Body>{t('milk:lactation')}</Body>
                      <Pill tone={lactations[0]!.status === 'milking' ? 'good' : 'neutral'}>
                        {lactations[0]!.status === 'milking' ? t('milk:milking') : t('milk:dried')}
                      </Pill>
                    </View>
                    <Row label={t('milk:daysInMilk')} value={String(lactations[0]!.daysInMilk)} />
                    <Row
                      label={t('milk:standardised')}
                      value={`${lactations[0]!.standardised150Kg} kg`}
                    />
                    {lactations[0]!.peakKg !== null ? (
                      <Row label={t('milk:peak')} value={`${lactations[0]!.peakKg} kg`} />
                    ) : null}
                  </Card>
                </>
              ) : null}

              <View style={styles.gap} />
              <NavigationRow
                label={t('pens:moveTo')}
                icon="home-switch-outline"
                onPress={() =>
                  router.push({ pathname: '/animal/move', params: { animalId: animal.id } })
                }
              />

              <View style={styles.gap} />
              <NavigationRow
                label={t('animals:recordWeight')}
                icon="scale"
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
              <NavigationRow
                label={t('breeding:pedigree')}
                icon="family-tree"
                onPress={() =>
                  router.push({ pathname: '/animal/pedigree', params: { id: animal.id } })
                }
              />

              {/* Health applies to every animal, not only the breeding females. */}
              {animal.status === 'active' ? (
                <>
                  <View style={styles.gap} />
                  <NavigationRow
                    label={t('health:recordTreatment')}
                    icon="medical-bag"
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
    </KeyboardAvoidingView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.paper },
  head: { marginBottom: spacing.md },
  tag: { fontSize: type.heading, color: colors.muted, fontWeight: '600', writingDirection: 'ltr' },
  gap: { height: spacing.md },
  actionSpacing: { marginBottom: spacing.sm },
  milkHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
}));
