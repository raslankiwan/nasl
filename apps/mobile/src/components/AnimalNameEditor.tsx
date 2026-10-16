import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { flockCache } from '../sync/device';
import type { CachedAnimal } from '../sync/cache';
import { Button, Card, Field, Notice } from './ui';
import { spacing } from '../theme';

export function AnimalNameEditor({
  farmId,
  animal,
  onSaved,
  onCancel,
}: {
  farmId: string;
  animal: CachedAnimal;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['animals', 'common']);
  const [name, setName] = useState(animal.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<Record<string, unknown>>(
        `/v1/farms/${farmId}/animals/${animal.id}`,
        { name: name.trim() || null },
      );
      await flockCache.storeAnimal(farmId, { ...updated, _id: animal.id });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common:errorRetry'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label={t('animals:nameOrLabel')}
        accessibilityLabel={t('animals:nameOrLabel')}
        hint={t('animals:nameOrLabelHint')}
        placeholder={t('animals:nameOrLabelExample')}
        value={name}
        onChangeText={setName}
        maxLength={60}
        editable={!busy}
        autoFocus
        returnKeyType="done"
      />
      <Button
        label={t('common:save')}
        busy={busy}
        disabled={name.trim() === (animal.name ?? '')}
        onPress={() => void save()}
      />
      <View style={styles.gap} />
      <Button label={t('common:cancel')} variant="secondary" disabled={busy} onPress={onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({ gap: { height: spacing.sm } });
