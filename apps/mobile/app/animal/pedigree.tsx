import { animalLabel } from '@nasl/shared';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { findBreed } from '@nasl/shared';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Notice, Screen } from '../../src/components/ui';
import { radius, spacing, type, createThemedStyles } from '../../src/theme';

interface Node {
  id: string;
  tagNumber: string;
  classLabel?: string | null;
  name: string | null;
  sex: string;
  breedId: string | null;
  dateOfBirth: string | null;
  dam: Node | null;
  sire: Node | null;
}

const GENERATIONS = 4;

/**
 * The family tree (FR-PED-01, gap G2).
 *
 * Drawn as an indented list rather than a branching diagram. A phone is 375 points wide; a
 * graphical tree stops being readable at two generations and this needs four, because that is what
 * a buyer of breeding stock asks to see. Indentation runs along the inline axis, so the line
 * descends rightward in Arabic and leftward in English without any mirroring code.
 */
export default function Pedigree() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation(['breeding', 'animals', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();
  const arabic = (i18n.resolvedLanguage ?? 'ar') === 'ar';

  const [tree, setTree] = useState<Node | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!farmId || !id) return;
    api
      .get<Node>(`/v1/farms/${farmId}/animals/${id}/pedigree?generations=${GENERATIONS}`)
      .then(setTree)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('common:errorRetry')));
  }, [farmId, id, t]);

  const breedName = (breedId: string | null) => {
    if (!breedId) return null;
    const breed = findBreed(breedId);
    return breed ? (arabic ? breed.nameAr : breed.nameEn) : breedId;
  };

  const renderNode = (node: Node | null, depth: number, relation: string | null) => {
    if (depth > GENERATIONS) return null;

    if (!node) {
      return (
        <View style={[styles.row, { marginInlineStart: depth * spacing.lg }, styles.rowUnknown]}>
          <Text style={styles.relation}>{relation}</Text>
          <Text style={styles.unknown}>{t('breeding:unknownParent')}</Text>
        </View>
      );
    }

    const breed = breedName(node.breedId);

    return (
      <View key={node.id}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/animal/${node.id}`)}
          style={({ pressed }) => [
            styles.row,
            { marginInlineStart: depth * spacing.lg },
            depth === 0 && styles.rowSubject,
            pressed && styles.pressed,
          ]}
        >
          {relation ? <Text style={styles.relation}>{relation}</Text> : null}
          <View style={styles.rowBody}>
            <Text style={styles.tag}>{animalLabel(node)}</Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[node.name, breed].filter(Boolean).join(' · ') || '—'}
            </Text>
          </View>
        </Pressable>

        {depth < GENERATIONS ? (
          <>
            {renderNode(node.dam, depth + 1, t('animals:dam'))}
            {renderNode(node.sire, depth + 1, t('animals:sire'))}
          </>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Screen>
        <ScreenHeader title={t('breeding:pedigree')} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {!tree && !error ? <Body muted>{t('common:loading')}</Body> : null}

        {tree ? renderNode(tree, 0, null) : null}
      </Screen>
    </ScrollView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: spacing.xxl },
  gap: { height: spacing.md },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
    // The line of descent runs along the inline axis, so it mirrors with the interface.
    borderStartWidth: 3,
    borderStartColor: colors.line,
  },
  rowSubject: { borderStartColor: colors.accent, backgroundColor: colors.accentSoft },
  rowUnknown: { backgroundColor: colors.surfaceAlt, borderStyle: 'dashed' },
  pressed: { opacity: 0.85 },
  relation: { fontSize: 11, color: colors.muted, letterSpacing: 0.5 },
  rowBody: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  tag: { fontSize: type.body, fontWeight: '700', color: colors.ink, writingDirection: 'ltr' },
  meta: { flexShrink: 1, fontSize: type.caption, color: colors.muted },
  unknown: { fontSize: type.caption, color: colors.muted, fontStyle: 'italic' },
}));
