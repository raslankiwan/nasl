import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { useFlock } from '../../src/sync/useFlock';
import { usePens } from '../../src/sync/usePens';
import { Body, Button, Notice, Pill, Screen } from '../../src/components/ui';
import { colors, radius, spacing, type } from '../../src/theme';

/**
 * One pen, and who is in it.
 *
 * The useful action here is moving a group at once — a herder does not move one ewe to the drop
 * pen, they move the five that are close. So animals are selected by tapping and moved together.
 */
export default function PenDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['pens', 'animals', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();
  const { animals, refresh: refreshFlock } = useFlock();
  const { pens, refresh: refreshPens } = usePens();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshFlock();
      void refreshPens();
    }, [refreshFlock, refreshPens]),
  );

  const pen = pens.find((p) => p.id === id) ?? null;
  const occupants = useMemo(() => animals.filter((a) => a.currentGroupId === id), [animals, id]);

  const toggle = (animalId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(animalId)) next.delete(animalId);
      else next.add(animalId);
      return next;
    });

  const moveTo = async (toGroupId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/farms/${farmId}/groups/move`, {
        animalIds: [...selected],
        toGroupId,
      });
      setSelected(new Set());
      await refreshFlock();
      await refreshPens();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView>
        <Screen>
          <ScreenHeader title={pen?.name ?? t('pens:title')} />
          {pen ? <Body muted>{t(`pens:types.${pen.type}` as 'pens:types.pen')}</Body> : null}

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <View style={styles.gap} />

          {occupants.length === 0 ? <Body muted>{t('pens:emptyPen')}</Body> : null}

          {occupants.map((animal) => {
            const isSelected = selected.has(animal.id);
            return (
              <Pressable
                key={animal.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                onPress={() => toggle(animal.id)}
                onLongPress={() => router.push(`/animal/${animal.id}`)}
                style={({ pressed }) => [
                  styles.row,
                  isSelected && styles.rowSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.tag}>{animal.tagNumber}</Text>
                  {animal.name ? <Text style={styles.meta}>{animal.name}</Text> : null}
                </View>
                {animal.repro ? (
                  <Pill tone={animal.repro.state === 'due' ? 'accent' : 'good'}>
                    {t(`breeding:states.${animal.repro.state}` as 'breeding:states.open', {
                      ns: 'breeding',
                    })}
                  </Pill>
                ) : null}
              </Pressable>
            );
          })}

          {selected.size > 0 ? (
            <View style={styles.moveBar}>
              <Text style={styles.moveLabel}>
                {t('pens:moveTo')} · {selected.size}
              </Text>
              {pens
                .filter((p) => p.id !== id)
                .map((p) => (
                  <Button
                    key={p.id}
                    label={p.name}
                    variant="secondary"
                    busy={busy}
                    onPress={() => void moveTo(p.id)}
                  />
                ))}
              <Button
                label={t('pens:noPen')}
                variant="secondary"
                busy={busy}
                onPress={() => void moveTo(null)}
              />
            </View>
          ) : null}
        </Screen>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  gap: { height: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 56,
    gap: spacing.md,
  },
  rowSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  pressed: { opacity: 0.85 },
  rowMain: { flexShrink: 1, gap: 2 },
  tag: { fontSize: type.heading, fontWeight: '700', color: colors.ink, writingDirection: 'ltr' },
  meta: { fontSize: type.caption, color: colors.muted },
  moveBar: { marginTop: spacing.lg, gap: spacing.sm },
  moveLabel: {
    fontSize: type.caption,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
    fontWeight: '700',
  },
});
