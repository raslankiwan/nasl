import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceProvider } from './appearance';
import { AppPreferences } from './components/AppPreferences';
import { initI18n } from './i18n';

beforeEach(async () => {
  localStorage.clear();
  await initI18n('en');
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('manual appearance overrides the system and survives remounting', async () => {
  const user = userEvent.setup();
  const view = render(
    <AppearanceProvider>
      <AppPreferences />
    </AppearanceProvider>,
  );
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.style.colorScheme).toBe('dark');
  await user.selectOptions(screen.getByLabelText('Appearance'), 'light');
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(document.documentElement.style.colorScheme).toBe('light');
  expect(localStorage.getItem('nasl.theme')).toBe('light');
  view.unmount();
  render(
    <AppearanceProvider>
      <AppPreferences />
    </AppearanceProvider>,
  );
  expect(screen.getByLabelText('Appearance')).toHaveValue('light');
  expect(document.documentElement.dataset.theme).toBe('light');
  await user.selectOptions(screen.getByLabelText('Appearance'), 'system');
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('system changes apply only while the system preference is selected', async () => {
  const media = new EventTarget() as EventTarget & { matches: boolean };
  media.matches = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  render(
    <AppearanceProvider>
      <AppPreferences />
    </AppearanceProvider>,
  );
  expect(document.documentElement.dataset.theme).toBe('light');
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(document.documentElement.dataset.theme).toBe('dark');
  await userEvent.setup().selectOptions(screen.getByLabelText('Appearance'), 'light');
  media.dispatchEvent(new Event('change'));
  expect(document.documentElement.dataset.theme).toBe('light');
});

test('unsupported install prompts show device instructions', async () => {
  render(
    <AppearanceProvider>
      <AppPreferences />
    </AppearanceProvider>,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Install app' }));
  expect(screen.getByRole('status')).toHaveTextContent('Add to Home Screen');
});
