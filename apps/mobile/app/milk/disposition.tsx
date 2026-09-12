import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { expectedOutputKg, isProcessed, MILK_ROUTES, outputPlausibility } from '@nasl/shared';
import { useAuth } from '../../src/auth/AuthProvider';
import { CaptureScreen } from '../../src/components/CaptureScreen';
import { Choice, DateField, FieldGroup, NumberField } from '../../src/components/form';
import { Body, Notice } from '../../src/components/ui';
import { colors, MIN_TOUCH, radius, spacing, type } from '../../src/theme';

/**
 * What became of a batch of milk (FR-MLK-06).
 *
 * The output weight only appears for cheese and yogurt, and the price disappears for milk kept for
 * the house — a form that asks what it cannot use is a form people stop filling in. An implausible
 * yield is queried here, while the person who weighed it is still standing at the vat, because a
 * slipped decimal is untraceable a month later. It is a question, never a refusal: the entry is
 * the farm's to make.
 */
export default function Disposition() {
  const { t } = useTranslation(['milk', 'common']);
  const { farmId } = useAuth();

  const [date, setDate] = useState(() => new Date(new Date().toISOString().slice(0, 10)));
  const [route, setRoute] = useState<(typeof MILK_ROUTES)[number]>('raw-sale');
  const [milkKg, setMilkKg] = useState<number | null>(null);
  const [outputKg, setOutputKg] = useState<number | null>(null);
  const [revenue, setRevenue] = useState<number | null>(null);
  const [buyer, setBuyer] = useState('');

  const processed = isProcessed(route);
  const kept = route === 'home';
  const expected = milkKg === null ? null : expectedOutputKg(route, milkKg);
  const verdict = milkKg === null ? null : outputPlausibility(route, milkKg, outputKg);

  return (
    <CaptureScreen
      title={t('milk:disposition')}
      canSave={Boolean(farmId) && milkKg !== null}
      path={`/v1/farms/${farmId}/milk/dispositions`}
      buildBody={(id) => ({
        id,
        date: date.toISOString().slice(0, 10),
        route,
        milkKg,
        ...(processed && outputKg !== null ? { outputKg } : {}),
        ...(!kept && revenue !== null ? { revenue } : {}),
        ...(!kept && buyer.trim() ? { buyer: buyer.trim() } : {}),
      })}
    >
      <DateField label={t('common:date')} value={date} onChange={setDate} />

      <FieldGroup label={t('milk:route')}>
        <Choice
          columns={2}
          options={MILK_ROUTES}
          value={route}
          onChange={(next) => {
            setRoute(next);
            // Switching away from cheese must not leave a curd weight attached to a raw sale.
            if (!isProcessed(next)) setOutputKg(null);
            if (next === 'home') {
              setRevenue(null);
              setBuyer('');
            }
          }}
          labelFor={(r) => t(`milk:routes.${r}` as 'milk:routes.cheese')}
        />
      </FieldGroup>

      <NumberField
        label={t('milk:milkUsed')}
        value={milkKg}
        onChange={setMilkKg}
        min={1}
        max={5000}
        step={5}
        initial={40}
        suffix="kg"
        optional
      />

      {processed ? (
        <>
          <NumberField
            label={t('milk:produced')}
            value={outputKg}
            onChange={setOutputKg}
            min={1}
            max={2000}
            step={1}
            initial={expected ?? 10}
            suffix="kg"
            optional
          />
          {expected !== null && outputKg === null ? (
            <Body muted>{t('milk:usuallyAbout', { count: expected })}</Body>
          ) : null}
          {verdict === 'high' || verdict === 'low' ? (
            <Notice tone="warning">
              {t(verdict === 'high' ? 'milk:yieldHigh' : 'milk:yieldLow', { count: milkKg })}
            </Notice>
          ) : null}
        </>
      ) : null}

      {kept ? null : (
        <>
          <NumberField
            label={t('milk:revenue')}
            value={revenue}
            onChange={setRevenue}
            min={0}
            max={100_000}
            step={10}
            initial={200}
            optional
          />

          <FieldGroup label={t('milk:buyer')}>
            <TextInput
              value={buyer}
              onChangeText={setBuyer}
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </FieldGroup>
        </>
      )}
    </CaptureScreen>
  );
}

const styles = StyleSheet.create({
  // A buyer is a person, not a batch code: their name follows the locale rather than being
  // forced left-to-right.
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: type.body,
    color: colors.ink,
    textAlign: 'auto',
  },
});
