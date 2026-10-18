import { can, isWithdrawalActive, type Role } from '@nasl/shared';
import { TabScreen } from '../../src/components/TabScreen';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/auth/AuthProvider';
import { useFlock } from '../../src/sync/useFlock';
import { Body, Card, IconButton, Pill, SearchField, Title } from '../../src/components/ui';
import { MIN_TOUCH, radius, spacing, type, createThemedStyles } from '../../src/theme';

/**
 * The flock roster, read from the device.
 *
 * It renders from the local copy first and refreshes behind that, so opening it in a pen with no
 * coverage shows the flock rather than a connection error.
 */
export default function Flock() {
  const styles = useStyles();
  const { t } = useTranslation(['animals', 'breeding', 'common', 'health']);
  const { farmId, me } = useAuth();
  const router = useRouter();
  const role = me?.farms.find((farm) => farm.farmId === farmId)?.role;
  const canWrite = role && can(role as Role, 'animals:write');
  const { animals, loading, stale, refresh } = useFlock();
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const visibleAnimals = animals.filter(
    (animal) =>
      !search ||
      animal.tagNumber.toLocaleLowerCase().includes(search) ||
      animal.name?.toLocaleLowerCase().includes(search),
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (!farmId) {
    return (
      <TabScreen>
        <View style={styles.padded}>
          <Title>{t('animals:title')}</Title>
          <Card>
            <Body>{t('animals:noFarm')}</Body>
          </Card>
        </View>
      </TabScreen>
    );
  }

  return (
    <TabScreen>
      <View style={styles.header}>
        <Title>{t('animals:title')}</Title>
        <View style={styles.headerActions}>
          <Text style={styles.count}>{t('animals:headCount', { count: animals.length })}</Text>
          {canWrite ? (
            <IconButton
              label={t('animals:addAnimal')}
              icon="plus"
              onPress={() => router.push('/animal/new')}
            />
          ) : null}
        </View>
      </View>

      {/* Not an error: it says the list is what was last known, which is still worth reading. */}
      {stale ? <Text style={styles.stale}>{t('common:offline')}</Text> : null}

      <View style={styles.search}>
        <SearchField
          label={t('animals:searchByTagOrLabel')}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <FlashList
        keyboardShouldPersistTaps="handled"
        data={visibleAnimals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.padded}>
              <Body muted>{t(search ? 'animals:noMatchingAnimals' : 'animals:emptyFlock')}</Body>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/animal/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowMain}>
              {/*
                A tag number is an identifier, not a quantity: never grouped, never localised into
                other digits, and not necessarily numeric at all. Printed verbatim, left-to-right.
              */}
              <Text style={styles.tag}>{item.tagNumber}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {item.name ||
                  t(`animals:speciesValues.${item.species}` as 'animals:speciesValues.sheep')}
              </Text>
            </View>

            <View style={styles.rowMeta}>
              {/* A milk hold outranks everything else: it is the question asked at milking. */}
              {isWithdrawalActive(item.withholdMilkUntil) ? (
                <Pill tone="accent">{t('health:doNotMilk')}</Pill>
              ) : isWithdrawalActive(item.withholdMeatUntil) ? (
                <Pill tone="accent">{t('health:doNotSell')}</Pill>
              ) : item.repro ? (
                <Pill tone={item.repro.state === 'due' ? 'accent' : 'good'}>
                  {t(`breeding:states.${item.repro.state}` as 'breeding:states.open')}
                </Pill>
              ) : (
                <Pill>{t(`animals:sexValues.${item.sex}` as 'animals:sexValues.female')}</Pill>
              )}
            </View>
          </Pressable>
        )}
      />
    </TabScreen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  add: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { fontSize: 24, color: colors.onAccent, fontWeight: '700', lineHeight: 28 },
  padded: { padding: spacing.lg },
  search: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  count: { fontSize: type.label, color: colors.muted, fontWeight: '600' },
  stale: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    fontSize: type.caption,
    color: colors.muted,
  },
  list: { padding: spacing.lg },
  row: {
    minHeight: MIN_TOUCH + 8,
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
    gap: spacing.md,
  },
  rowPressed: { opacity: 0.85 },
  rowMain: { flexShrink: 1, gap: 2 },
  rowMeta: { flexShrink: 0 },
  tag: { fontSize: type.heading, fontWeight: '700', color: colors.ink, writingDirection: 'ltr' },
  name: { fontSize: type.label, color: colors.muted },
}));
