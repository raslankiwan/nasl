import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initI18n } from '../i18n';
import { apiClient, ApiError } from '../api/client';
import { AdminInvitations } from './AdminInvitations';

beforeEach(() => initI18n('en'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function mount(configured: boolean) {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ emailConfigured: configured, invitations: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AdminInvitations />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Administrator invitations' }));
  await screen.findByLabelText('Email address');
}
test('no email sender means no invitation can be sent', async () => {
  const post = vi.spyOn(apiClient, 'post');
  await mount(false);
  expect(screen.getByRole('button', { name: 'Send email invitation' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent(/sending address/);
  expect(post).not.toHaveBeenCalled();
});
test('email invitation submits a recipient and locale, and does not expose a setup link', async () => {
  const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ id: 'invite', state: 'sent' });
  await mount(true);
  await userEvent.type(screen.getByLabelText('Email address'), 'invited@example.test');
  await userEvent.click(screen.getByRole('button', { name: 'Send email invitation' }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledExactlyOnceWith('/v1/admin/invitations', {
      email: 'invited@example.test',
      locale: 'en',
    }),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Invitation email sent');
});
test('delivery failure is reported without claiming the email was sent', async () => {
  vi.spyOn(apiClient, 'post').mockRejectedValue(
    new ApiError(503, { error: { code: 'email_delivery_failed', message: 'provider secret' } }),
  );
  await mount(true);
  await userEvent.type(screen.getByLabelText('Email address'), 'invited@example.test');
  await userEvent.click(screen.getByRole('button', { name: 'Send email invitation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be emailed');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
