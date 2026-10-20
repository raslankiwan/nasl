import { useAnimal } from '../../src/sync/useFlock';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/auth/AuthProvider';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { Choice, DateField, FieldGroup, NumberField } from '../../src/components/form';

const METHODS = ['ultrasound', 'palpation', 'observation'] as const;
const RESULTS = ['pregnant', 'open', 'uncertain'] as const;

export default function RecordPregnancyCheck() {
  const { damId } = useLocalSearchParams<{ damId: string }>();
  const { t } = useTranslation(['breeding', 'common']);
  const { farmId } = useAuth();
  const { animal } = useAnimal(damId);

  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [method, setMethod] = useState<(typeof METHODS)[number]>('ultrasound');
  const [result, setResult] = useState<(typeof RESULTS)[number]>('pregnant');
  const [fetusCount, setFetusCount] = useState<number | null>(null);

  // Only a scan can count what is in there; the server enforces the same rule.
  const countable = method === 'ultrasound' && result === 'pregnant';

  return (
    <CaptureScreen
      title={t('breeding:pregnancyCheck')}
      canSave={Boolean(farmId && animal?.classification === 'mother' && animal.status === 'active')}
      path={`/v1/farms/${farmId}/breeding/pregnancy-checks`}
      buildBody={(id) => ({
        id,
        damId,
        date: date.toISOString().slice(0, 10),
        method,
        result,
        ...(countable && fetusCount !== null ? { fetusCount } : {}),
      })}
    >
      <DateField label={t('common:date')} value={date} onChange={setDate} />

      <FieldGroup label={t('breeding:method')}>
        <Choice
          options={METHODS}
          value={method}
          onChange={setMethod}
          labelFor={(m) => t(`breeding:checkMethods.${m}` as 'breeding:checkMethods.ultrasound')}
        />
      </FieldGroup>

      <FieldGroup label={t('breeding:result')}>
        <Choice
          options={RESULTS}
          value={result}
          onChange={setResult}
          labelFor={(r) => t(`breeding:checkResults.${r}` as 'breeding:checkResults.pregnant')}
        />
      </FieldGroup>

      {countable ? (
        <NumberField
          label={t('breeding:litterSize')}
          value={fetusCount}
          onChange={setFetusCount}
          min={1}
          max={4}
          decimals={0}
          initial={1}
          optional
        />
      ) : null}
    </CaptureScreen>
  );
}
