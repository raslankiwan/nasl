import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/auth/AuthProvider';
import { usePens } from '../../src/sync/usePens';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { Choice, DateField, FieldGroup } from '../../src/components/form';
import { Body } from '../../src/components/ui';

export default function MoveAnimal() {
  const { animalId } = useLocalSearchParams<{ animalId: string }>();
  const { t } = useTranslation(['pens', 'common']);
  const { farmId } = useAuth();
  const { pens } = usePens();

  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [toGroupId, setToGroupId] = useState<string>('');

  return (
    <CaptureScreen
      title={t('pens:moveTo')}
      canSave={Boolean(farmId && animalId)}
      path={`/v1/farms/${farmId}/groups/move`}
      buildBody={() => ({
        animalIds: [animalId],
        toGroupId: toGroupId === '' ? null : toGroupId,
        date: date.toISOString().slice(0, 10),
      })}
    >
      <DateField label={t('common:date')} value={date} onChange={setDate} />

      <FieldGroup label={t('pens:title')}>
        {pens.length === 0 ? (
          <Body muted>{t('pens:empty')}</Body>
        ) : (
          <Choice
            columns={2}
            options={['', ...pens.map((p) => p.id)]}
            value={toGroupId}
            onChange={setToGroupId}
            labelFor={(id) =>
              id === '' ? t('pens:noPen') : (pens.find((p) => p.id === id)?.name ?? id)
            }
          />
        )}
      </FieldGroup>
    </CaptureScreen>
  );
}
