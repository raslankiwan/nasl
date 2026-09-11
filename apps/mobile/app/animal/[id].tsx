import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatDate, formatHijriDate, type Locale } from '@nasl/i18n';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Card, Notice, Pill, Screen, Title } from '../../src/components/ui';
import { colors, spacing, type } from '../../src/theme';

interface AnimalDetail {
  id: string;
  tagNumber: string;
  name: string | null;
  species: string;
  breedId: string | null;
  sex: string;
  dateOfBirth: string | null;
  status: string;
  repro: { state: string; dueDate: string | null } | null;
  lastWeightKg: number | null;
  withholdMeatUntil: string | null;
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

  const [animal, setAnimal] = useState<AnimalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!farmId || !id) return;
    api
      .get<AnimalDetail>(`/v1/farms/${farmId}/animals/${id}`)
      .then(setAnimal)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('common:errorRetry')));
  }, [farmId, id, t]);

  const dash = '—';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView>
        <Screen>
          <Button label={t('common:back')} variant="secondary" onPress={() => router.back()} />
          <View style={styles.gap} />

          {error ? <Notice tone="danger">{error}</Notice> : null}

          {animal ? (
            <>
              <View style={styles.head}>
                <Title>{animal.name ?? animal.tagNumber}</Title>
                <Text style={styles.tag}>{animal.tagNumber}</Text>
              </View>

              {/* The one thing that must never be missed when deciding to sell (FR-HLT-03). */}
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

              {animal.repro ? (
                <>
                  <View style={styles.gap} />
                  <Card>
                    <Body>{t('breeding:title')}</Body>
                    <View style={styles.gap} />
                    <Pill tone={animal.repro.state === 'due' ? 'accent' : 'good'}>
                      {t(`breeding:states.${animal.repro.state}` as 'breeding:states.open')}
                    </Pill>
                    {animal.repro.dueDate ? (
                      <Row
                        label={t('breeding:dueDate')}
                        value={formatDate(new Date(animal.repro.dueDate), locale)}
                      />
                    ) : null}
                  </Card>
                </>
              ) : null}
            </>
          ) : error ? null : (
            <Body muted>{t('common:loading')}</Body>
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
