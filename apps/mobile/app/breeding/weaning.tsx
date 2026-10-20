import { useAnimal } from '../../src/sync/useFlock';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/auth/AuthProvider';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { DateField } from '../../src/components/form';
import { Body, Card } from '../../src/components/ui';

export default function RecordWeaning() {
  const { damId } = useLocalSearchParams<{ damId: string }>();
  const { t } = useTranslation(['breeding', 'common']);
  const { farmId } = useAuth();
  const { animal } = useAnimal(damId);
  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));

  return (
    <CaptureScreen
      title={t('breeding:weaning')}
      canSave={Boolean(farmId && animal?.classification === 'mother' && animal.status === 'active')}
      path={`/v1/farms/${farmId}/breeding/weanings`}
      buildBody={(id) => ({ id, damId, date: date.toISOString().slice(0, 10) })}
    >
      <DateField label={t('common:date')} value={date} onChange={setDate} />
      <Card>
        <Body muted>{t('breeding:lambsWeaned')}</Body>
      </Card>
    </CaptureScreen>
  );
}
