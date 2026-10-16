import { useTranslation } from 'react-i18next';
import { Choice, FieldGroup } from './form';
import { useTheme, type ThemePreference } from '../theme';

export function AppearanceChoice() {
  const { t } = useTranslation('common');
  const { preference, setPreference } = useTheme();
  const labels = { system: t('themeSystem'), light: t('themeLight'), dark: t('themeDark') };
  return (
    <FieldGroup label={t('appearance')}>
      <Choice<ThemePreference>
        value={preference}
        onChange={setPreference}
        options={['system', 'light', 'dark']}
        labelFor={(value) => labels[value]}
      />
    </FieldGroup>
  );
}
