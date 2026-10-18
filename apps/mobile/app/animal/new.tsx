import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SEXES, SPECIES, type Sex, type Species } from '@nasl/shared';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { Body, Button, Card, Field, Notice } from '../../src/components/ui';
import { Toggle } from '../../src/components/form';
import { useFlock } from '../../src/sync/useFlock';
import { Keypad } from '../../src/components/Keypad';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { MIN_TOUCH, radius, spacing, type, createThemedStyles } from '../../src/theme';

/**
 * Quick add (scope FR-REG-03).
 *
 * The battle a flock app loses is the first evening: if registering two hundred head means two
 * hundred trips through a form, the herder stops at animal thirty and never comes back. So the
 * species and sex are chosen once for the session, the tag goes in on a large keypad, and each
 * animal is one tap. A name or distinguishing label is optional and belongs to this animal only.
 */

function Choice<T extends string>({
  options,
  value,
  onChange,
  labelFor,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labelFor: (option: T) => string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.choices}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.choice,
              selected && styles.choiceSelected,
              pressed && styles.choicePressed,
            ]}
          >
            <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>
              {labelFor(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function QuickAdd() {
  const styles = useStyles();
  const { t } = useTranslation(['animals', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [species, setSpecies] = useState<Species>('sheep');
  const [sex, setSex] = useState<Sex>('female');
  const { allAnimals, refresh } = useFlock();
  const [automatic, setAutomatic] = useState(true);
  const recordId = useRef(globalThis.crypto.randomUUID());
  const saving = useRef(false);
  const [tag, setTag] = useState('');
  const [name, setName] = useState('');
  const [added, setAdded] = useState<Array<{ id: string; tagNumber: string; name: string | null }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    if (!farmId || saving.current || (!automatic && !tag.trim())) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string; tagNumber: string; name: string | null }>(
        `/v1/farms/${farmId}/animals`,
        {
          id: recordId.current,
          ...(!automatic ? { tagNumber: tag.trim() } : {}),
          species,
          sex,
          ...(name.trim() ? { name: name.trim() } : {}),
        },
      );
      setAdded((prev) => [created, ...prev]);
      void refresh();
      recordId.current = globalThis.crypto.randomUUID();
      setTag('');
      setName('');
    } catch (err) {
      setError(
        err instanceof ApiError && (err.details as { field?: string })?.field === 'tagNumber'
          ? t('animals:duplicateTag', { tag })
          : err instanceof ApiError
            ? err.message
            : t('common:errorRetry'),
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [farmId, tag, name, species, sex, t, automatic, refresh]);

  const undo = useCallback(
    async (id: string) => {
      if (!farmId) return;
      try {
        await api.post(`/v1/farms/${farmId}/animals/${id}/status`, { status: 'culled' });
      } catch {
        // The list below is a session log, not the source of truth; drop it either way.
      }
      setAdded((prev) => prev.filter((a) => a.id !== id));
    },
    [farmId],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
      keyboardVerticalOffset={headerHeight}
    >
      <ScreenHeader
        title={t('animals:bulkAdd')}
        action={
          <Button
            label={t('common:done')}
            variant="text"
            disabled={busy}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/flock'))}
          />
        }
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, spacing.xl) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.count}>{t('animals:addedThisSession', { count: added.length })}</Text>
        </View>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        <Card>
          <Body muted>{t('animals:sessionDefaults')}</Body>
          <View style={styles.gap} />
          <Choice
            options={SPECIES}
            value={species}
            onChange={setSpecies}
            labelFor={(option) =>
              t(`animals:speciesValues.${option}` as 'animals:speciesValues.sheep')
            }
          />
          <View style={styles.gapSmall} />
          <Choice
            options={SEXES}
            value={sex}
            onChange={setSex}
            labelFor={(option) => t(`animals:sexValues.${option}` as 'animals:sexValues.female')}
          />
        </Card>

        <View style={styles.gap} />

        <Toggle
          label={t('animals:autoNumber')}
          value={automatic}
          onChange={(value) => {
            if (!busy) setAutomatic(value);
          }}
        />
        {automatic ? (
          <Body muted>{t('animals:autoNumberHint')}</Body>
        ) : (
          <>
            <View style={styles.tagDisplay}>
              <Text style={styles.tagLabel}>{t('animals:tagNumberShort')}</Text>
              <TextInput
                accessibilityLabel={t('animals:tagNumber')}
                keyboardType="number-pad"
                value={tag}
                onChangeText={setTag}
                maxLength={32}
                editable={!busy}
                style={[styles.tagValue, { width: '100%', textAlign: 'center' }]}
              />
            </View>
            <Keypad
              onDigit={(digit) => setTag((prev) => (prev.length < 32 ? prev + digit : prev))}
              onBackspace={() => setTag((prev) => prev.slice(0, -1))}
              onClear={() => setTag('')}
              disabled={busy}
            />
            {[...allAnimals, ...added].some((animal) => animal.tagNumber === tag.trim()) ? (
              <Notice tone="danger">{t('animals:duplicateTag', { tag })}</Notice>
            ) : null}
          </>
        )}

        <View style={styles.gap} />
        <Field
          label={t('animals:nameOrLabel')}
          accessibilityLabel={t('animals:nameOrLabel')}
          hint={t('animals:nameOrLabelHint')}
          placeholder={t('animals:nameOrLabelExample')}
          value={name}
          onChangeText={setName}
          maxLength={60}
          editable={!busy}
          returnKeyType="done"
        />
        <Button
          label={t('common:add')}
          onPress={() => void save()}
          disabled={
            !automatic &&
            (!tag.trim() ||
              [...allAnimals, ...added].some((animal) => animal.tagNumber === tag.trim()))
          }
          busy={busy}
        />

        {added.length > 0 ? (
          <View style={styles.log}>
            {added.map((animal) => (
              <View key={animal.id} style={styles.logRow}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.logTag}>{t('animals:added', { tag: animal.tagNumber })}</Text>
                  {animal.name ? <Text style={styles.logName}>{animal.name}</Text> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void undo(animal.id)}
                  style={styles.undo}
                >
                  <Text style={styles.undoLabel}>{t('animals:undo')}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  count: { fontSize: type.label, fontWeight: '600', color: colors.accent },
  gap: { height: spacing.lg },
  gapSmall: { height: spacing.sm },
  choices: { flexDirection: 'row', gap: spacing.sm },
  choice: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  choiceSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  choicePressed: { opacity: 0.85 },
  choiceLabel: { fontSize: type.body, color: colors.inkSoft, fontWeight: '500' },
  choiceLabelSelected: { color: colors.accent, fontWeight: '700' },
  tagDisplay: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  tagLabel: { fontSize: type.caption, color: colors.muted, letterSpacing: 1 },
  tagValue: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: 3,
    writingDirection: 'ltr',
  },
  log: { marginTop: spacing.xl, gap: spacing.sm },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.sageSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  logTag: { fontSize: type.label, color: colors.sage, fontWeight: '600' },
  logName: { fontSize: type.label, color: colors.inkSoft },
  undo: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm },
  undoLabel: { fontSize: type.label, color: colors.muted, textDecorationLine: 'underline' },
}));
