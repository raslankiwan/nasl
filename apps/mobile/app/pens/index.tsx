import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { usePens } from '../../src/sync/usePens';
import { Body, Button, Notice, Pill, Screen, Title } from '../../src/components/ui';
import { Choice, FieldGroup } from '../../src/components/form';
import { colors, MIN_TOUCH, radius, spacing, type } from '../../src/theme';

const TYPES = ['pen', 'drop', 'weaning', 'hospital', 'breeding', 'pasture', 'fattening'] as const;

export default function Pens() {
  const { t } = useTranslation(['pens', 'common']);
  const { farmId } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pens, loading, offline, refresh } = usePens();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [penType, setPenType] = useState<(typeof TYPES)[number]>('pen');
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const create = async () => {
    setError(null);
    try {
      await api.post(`/v1/farms/${farmId}/groups`, { name: name.trim(), type: penType });
      setName('');
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
      >
        <Screen>
          <View style={styles.head}>
            <Title>{t('pens:title')}</Title>
            <Button
              label={adding ? t('common:cancel') : t('pens:addPen')}
              variant="secondary"
              onPress={() => setAdding((v) => !v)}
            />
          </View>

          {offline ? <Body muted>{t('common:offline')}</Body> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}

          {adding ? (
            <View style={styles.form}>
              <FieldGroup label={t('pens:penName')}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  autoFocus
                />
              </FieldGroup>
              <FieldGroup label={t('common:none')}>
                <Choice
                  columns={3}
                  options={TYPES}
                  value={penType}
                  onChange={setPenType}
                  labelFor={(v) => t(`pens:types.${v}` as 'pens:types.pen')}
                />
              </FieldGroup>
              <Button
                label={t('common:save')}
                onPress={() => void create()}
                disabled={name.trim().length === 0}
              />
              <View style={styles.gap} />
            </View>
          ) : null}

          {pens.length === 0 && !loading ? <Body muted>{t('pens:empty')}</Body> : null}

          {pens.map((pen) => (
            <Pressable
              key={pen.id}
              accessibilityRole="button"
              onPress={() => router.push(`/pens/${pen.id}`)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.rowMain}>
                <Text style={styles.name}>{pen.name}</Text>
                <Text style={styles.meta}>{t(`pens:types.${pen.type}` as 'pens:types.pen')}</Text>
              </View>
              <Pill tone={pen.headCount > 0 ? 'good' : 'neutral'}>
                {t('pens:headCount', { count: pen.headCount })}
              </Pill>
            </Pressable>
          ))}
        </Screen>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  form: { marginBottom: spacing.lg },
  gap: { height: spacing.md },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: type.body,
    color: colors.ink,
    textAlign: 'left',
  },
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
  pressed: { opacity: 0.85 },
  rowMain: { flexShrink: 1, gap: 2 },
  name: { fontSize: type.body, fontWeight: '700', color: colors.ink },
  meta: { fontSize: type.caption, color: colors.muted },
});
