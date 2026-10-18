import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { Choice, DateField, FieldGroup, NumberField } from '../../src/components/form';
import { useAuth } from '../../src/auth/AuthProvider';

const METHODS = ['scale', 'tape', 'estimate'] as const;

/**
 * A weighing accepts the exact scale reading; quick adjustments start at a plausible adult weight.
 */
export default function RecordWeight() {
  const { animalId } = useLocalSearchParams<{ animalId: string }>();
  const { t } = useTranslation(['animals', 'common']);
  const { farmId } = useAuth();

  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [kg, setKg] = useState<number | null>(null);
  const [method, setMethod] = useState<(typeof METHODS)[number]>('scale');

  return (
    <CaptureScreen
      title={t('animals:recordWeight')}
      canSave={Boolean(farmId && animalId) && kg !== null}
      path={`/v1/farms/${farmId}/weights`}
      buildBody={(id) => ({
        id,
        animalId,
        date: date.toISOString().slice(0, 10),
        kg,
        method,
      })}
    >
      <DateField label={t('common:date')} value={date} onChange={setDate} />

      <NumberField
        label={t('animals:weight')}
        value={kg}
        onChange={setKg}
        min={0.5}
        max={150}
        step={0.5}
        initial={45}
        suffix="kg"
        optional
      />

      <FieldGroup label={t('common:none')}>
        <Choice
          options={METHODS}
          value={method}
          onChange={setMethod}
          labelFor={(m) => (m === 'scale' ? 'ميزان' : m === 'tape' ? 'شريط' : 'تقدير')}
        />
      </FieldGroup>
    </CaptureScreen>
  );
}
