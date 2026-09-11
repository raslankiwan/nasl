import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthProvider';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { Choice, DateField, FieldGroup } from '../../src/components/form';
import { Body } from '../../src/components/ui';

interface Ram {
  id: string;
  tagNumber: string;
  name: string | null;
}

const METHODS = ['natural', 'ai'] as const;

export default function RecordMating() {
  const { damId } = useLocalSearchParams<{ damId: string }>();
  const { t } = useTranslation(['breeding', 'common']);
  const { farmId } = useAuth();

  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [method, setMethod] = useState<(typeof METHODS)[number]>('natural');
  const [rams, setRams] = useState<Ram[]>([]);
  const [sireId, setSireId] = useState<string>('');

  useEffect(() => {
    if (!farmId) return;
    api
      .get<{ animals: Ram[] }>(`/v1/farms/${farmId}/animals?sex=male&limit=50`)
      .then((res) => setRams(res.animals))
      .catch(() => setRams([]));
  }, [farmId]);

  return (
    <CaptureScreen
      title={t('breeding:recordMating')}
      canSave={Boolean(farmId && damId)}
      path={`/v1/farms/${farmId}/breeding/matings`}
      buildBody={(id) => ({
        id,
        damId,
        ...(sireId ? { sireId } : {}),
        method,
        startDate: date.toISOString().slice(0, 10),
      })}
    >
      <DateField label={t('breeding:matingDate')} value={date} onChange={setDate} />

      <FieldGroup label={t('breeding:sire')}>
        {rams.length === 0 ? (
          <Body muted>{t('breeding:noSire')}</Body>
        ) : (
          <Choice
            columns={2}
            options={['', ...rams.map((r) => r.id)]}
            value={sireId}
            onChange={setSireId}
            labelFor={(id) =>
              id === ''
                ? t('breeding:noSire')
                : (rams.find((r) => r.id === id)?.name ??
                  rams.find((r) => r.id === id)?.tagNumber ??
                  id)
            }
          />
        )}
      </FieldGroup>

      <FieldGroup label={t('breeding:method')}>
        <Choice
          options={METHODS}
          value={method}
          onChange={setMethod}
          labelFor={(m) => t(`breeding:methods.${m}` as 'breeding:methods.natural')}
        />
      </FieldGroup>
    </CaptureScreen>
  );
}
