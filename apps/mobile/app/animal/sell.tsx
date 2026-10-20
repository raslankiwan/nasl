import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { animalLabel, isWithdrawalActive } from '@nasl/shared';
import { useAuth } from '../../src/auth/AuthProvider';
import { useAnimal } from '../../src/sync/useFlock';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { DateField, NumberField } from '../../src/components/form';
import { Field, Notice } from '../../src/components/ui';

export default function Sell() {
  const { animalId } = useLocalSearchParams<{ animalId: string }>();
  const { farmId } = useAuth();
  const { animal } = useAnimal(animalId);
  const { t } = useTranslation(['animals', 'health', 'common']);
  const [date, setDate] = useState(() => new Date());
  const [amount, setAmount] = useState<number | null>(null);
  const [buyer, setBuyer] = useState('');
  const [note, setNote] = useState('');
  const withheld = isWithdrawalActive(animal?.withholdMeatUntil);
  return (
    <CaptureScreen
      title={t('animals:sell')}
      subtitle={animal ? animalLabel(animal) : undefined}
      path={`/v1/farms/${farmId}/finance/sales`}
      canSave={Boolean(farmId && animal?.status === 'active' && amount !== null && !withheld)}
      buildBody={(id) => ({
        id,
        animalIds: [animalId],
        date: date.toISOString().slice(0, 10),
        amount,
        counterparty: buyer,
        note,
      })}
    >
      {withheld ? <Notice tone="danger">{t('health:doNotSell')}</Notice> : null}
      <DateField label={t('common:date')} value={date} onChange={setDate} />
      <NumberField
        label={t('animals:saleAmount')}
        value={amount}
        onChange={setAmount}
        min={0}
        max={10000000}
        initial={1000}
        step={100}
      />
      <Field label={t('animals:buyer')} value={buyer} onChangeText={setBuyer} maxLength={120} />
      <Field label={t('animals:note')} value={note} onChangeText={setNote} maxLength={300} />
    </CaptureScreen>
  );
}
