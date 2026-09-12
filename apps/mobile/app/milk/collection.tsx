import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/auth/AuthProvider';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { Choice, DateField, FieldGroup, NumberField } from '../../src/components/form';

const SESSIONS = ['morning', 'evening', 'day'] as const;

/** What went into the churn — the flock's milk income line, separate from per-ewe testing. */
export default function Collection() {
  const { t } = useTranslation(['milk', 'common']);
  const { farmId } = useAuth();

  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [session, setSession] = useState<(typeof SESSIONS)[number]>('day');
  const [qtyKg, setQtyKg] = useState<number | null>(null);

  return (
    <CaptureScreen
      title={t('milk:collection')}
      canSave={Boolean(farmId) && qtyKg !== null}
      path={`/v1/farms/${farmId}/milk/collections`}
      buildBody={(id) => ({
        id,
        date: date.toISOString().slice(0, 10),
        session,
        qtyKg,
      })}
    >
      <DateField label={t('common:date')} value={date} onChange={setDate} />

      <FieldGroup label={t('milk:session')}>
        <Choice
          options={SESSIONS}
          value={session}
          onChange={setSession}
          labelFor={(s) => t(`milk:sessions.${s}` as 'milk:sessions.day')}
        />
      </FieldGroup>

      <NumberField
        label={t('milk:quantity')}
        value={qtyKg}
        onChange={setQtyKg}
        min={1}
        max={5000}
        step={5}
        initial={50}
        suffix="kg"
        optional
      />
    </CaptureScreen>
  );
}
