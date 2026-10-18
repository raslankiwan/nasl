import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/auth/AuthProvider';
import { useFlock } from '../../src/sync/useFlock';
import { Body, Notice } from '../../src/components/ui';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { Choice, DateField, FieldGroup, NumberField } from '../../src/components/form';
import { MIN_TOUCH, radius, spacing, type, useTheme, createThemedStyles } from '../../src/theme';

const SEXES = ['female', 'male'] as const;
const OUTCOMES = ['live', 'stillborn', 'died24h'] as const;
const DIFFICULTY = ['1', '2', '3', '4'] as const;

interface LambDraft {
  key: string;
  sex: (typeof SEXES)[number];
  outcome: (typeof OUTCOMES)[number];
  birthWeightKg: number | null;
  tagNumber: string;
}

const blankLamb = (): LambDraft => ({
  key: globalThis.crypto.randomUUID(),
  sex: 'female',
  outcome: 'live',
  birthWeightKg: null,
  tagNumber: '',
});

/**
 * Recording a birth is the single most important thing this app does. If it is not captured in the
 * pen, within a day, by whoever was standing there, every report downstream is fiction.
 *
 * So it opens with one lamb already filled in at the commonest values — a live female — and asks
 * for nothing that can be filled in later. An empty tag gets the next unique farm number;
 * the mother is linked through the pedigree, not encoded into the child's number.
 */
export default function RecordBirth() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { damId } = useLocalSearchParams<{ damId: string }>();
  const { t } = useTranslation(['breeding', 'animals', 'common']);
  const { farmId } = useAuth();

  const { allAnimals } = useFlock();
  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTY)[number]>('1');
  const [lambs, setLambs] = useState<LambDraft[]>([blankLamb()]);

  const update = (key: string, patch: Partial<LambDraft>) =>
    setLambs((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const tags = lambs
    .filter((lamb) => lamb.outcome === 'live')
    .map((lamb) => lamb.tagNumber.trim())
    .filter(Boolean);
  const duplicate = tags.find(
    (tag, index) =>
      tags.indexOf(tag) !== index || allAnimals.some((animal) => animal.tagNumber === tag),
  );

  return (
    <CaptureScreen
      title={t('breeding:recordBirth')}
      canSave={Boolean(farmId && damId) && lambs.length > 0 && !duplicate}
      path={`/v1/farms/${farmId}/breeding/births`}
      buildBody={(id) => ({
        id,
        damId,
        date: date.toISOString().slice(0, 10),
        difficulty: Number(difficulty),
        assisted: Number(difficulty) > 1,
        offspring: lambs.map((lamb) => ({
          sex: lamb.sex,
          outcome: lamb.outcome,
          ...(lamb.birthWeightKg !== null ? { birthWeightKg: lamb.birthWeightKg } : {}),
          ...(lamb.tagNumber.trim() ? { tagNumber: lamb.tagNumber.trim() } : {}),
        })),
      })}
    >
      {duplicate ? (
        <Notice tone="danger">{t('animals:duplicateTag', { tag: duplicate })}</Notice>
      ) : null}
      <Body muted>{t('animals:autoNumberHint')}</Body>
      <DateField label={t('breeding:birth')} value={date} onChange={setDate} />

      <FieldGroup label={t('breeding:difficulty')}>
        <Choice
          options={DIFFICULTY}
          value={difficulty}
          onChange={setDifficulty}
          labelFor={(d) => d}
        />
      </FieldGroup>

      {lambs.map((lamb, index) => (
        <View key={lamb.key} style={styles.lamb}>
          <View style={styles.lambHead}>
            <Text style={styles.lambTitle}>
              {t('breeding:lamb')} {index + 1}
            </Text>
            {lambs.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setLambs((prev) => prev.filter((l) => l.key !== lamb.key))}
                style={styles.remove}
              >
                <Text style={styles.removeLabel}>{t('breeding:remove')}</Text>
              </Pressable>
            ) : null}
          </View>

          <FieldGroup label={t('animals:sex')}>
            <Choice
              options={SEXES}
              value={lamb.sex}
              onChange={(sex) => update(lamb.key, { sex })}
              labelFor={(s) => t(`animals:sexValues.${s}` as 'animals:sexValues.female')}
            />
          </FieldGroup>

          <FieldGroup label={t('breeding:outcome')}>
            <Choice
              options={OUTCOMES}
              value={lamb.outcome}
              onChange={(outcome) => update(lamb.key, { outcome })}
              labelFor={(o) => t(`breeding:outcomes.${o}` as 'breeding:outcomes.live')}
            />
          </FieldGroup>

          {/* A stillborn lamb never joins the flock, so it needs neither weight nor tag. */}
          {lamb.outcome === 'live' ? (
            <>
              <NumberField
                label={t('breeding:birthWeight')}
                value={lamb.birthWeightKg}
                onChange={(birthWeightKg) => update(lamb.key, { birthWeightKg })}
                min={1}
                max={12}
                step={0.1}
                // A typical single lamb. Twins run lighter, so the herder steps down from here.
                initial={4}
                suffix="kg"
                optional
              />
              <FieldGroup label={t('animals:tagNumber')}>
                <TextInput
                  accessibilityLabel={t('animals:tagNumber')}
                  maxLength={32}
                  value={lamb.tagNumber}
                  onChangeText={(tagNumber) => update(lamb.key, { tagNumber })}
                  keyboardType="number-pad"
                  placeholder={t('animals:autoNumber')}
                  placeholderTextColor={colors.muted}
                  style={styles.tagInput}
                />
              </FieldGroup>
            </>
          ) : null}
        </View>
      ))}

      {lambs.length < 4 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setLambs((prev) => [...prev, blankLamb()])}
          style={({ pressed }) => [styles.addLamb, pressed && styles.pressed]}
        >
          <Text style={styles.addLambLabel}>＋ {t('breeding:addLamb')}</Text>
        </Pressable>
      ) : null}
    </CaptureScreen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  lamb: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  lambHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  lambTitle: { fontSize: type.heading, fontWeight: '700', color: colors.ink },
  remove: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm },
  removeLabel: { fontSize: type.label, color: colors.rust, textDecorationLine: 'underline' },
  tagInput: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: type.body,
    color: colors.ink,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  addLamb: {
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  addLambLabel: { fontSize: type.body, color: colors.accent, fontWeight: '600' },
  pressed: { opacity: 0.85 },
}));
