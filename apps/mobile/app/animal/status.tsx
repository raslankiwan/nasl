import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { animalLabel } from '@nasl/shared';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAnimal } from '../../src/sync/useFlock';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { Choice, DateField, FieldGroup } from '../../src/components/form';
import { Body, Field } from '../../src/components/ui';

const STATUSES = ['dead', 'lost', 'culled', 'slaughtered'] as const;
export default function ChangeStatus() {
  const { animalId } = useLocalSearchParams<{ animalId: string }>();
  const { farmId } = useAuth();
  const { animal } = useAnimal(animalId);
  const { t } = useTranslation(['animals', 'common']);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('dead');
  const [date, setDate] = useState(() => new Date());
  const [reason, setReason] = useState('');
  return (
    <CaptureScreen
      title={t('animals:changeStatus')}
      subtitle={animal ? animalLabel(animal) : undefined}
      path={`/v1/farms/${farmId}/animals/${animalId}/status`}
      canSave={Boolean(farmId && animal?.status === 'active')}
      buildBody={(id) => ({ id, status, date: date.toISOString().slice(0, 10), reason })}
    >
      <Body>{t('animals:departureHint')}</Body>
      <FieldGroup label={t('animals:status')}>
        <Choice
          columns={2}
          options={STATUSES}
          value={status}
          onChange={setStatus}
          labelFor={(value) => t(`animals:statusValues.${value}`)}
        />
      </FieldGroup>
      <DateField label={t('common:date')} value={date} onChange={setDate} />
      <Field label={t('animals:note')} value={reason} onChangeText={setReason} maxLength={200} />
    </CaptureScreen>
  );
}
