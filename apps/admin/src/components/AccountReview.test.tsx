import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient, ApiError } from '../api/client';
import { initI18n } from '../i18n';
import { AccountReview } from './AccountReview';

beforeEach(() => initI18n('en'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <AccountReview userId="pending-user" status="pending" isPlatformAdmin={false} />
    </QueryClientProvider>,
  );
  return invalidate;
}
test.each([
  ['Approve account', 'approved'],
  ['Reject registration', 'rejected'],
])('review action %s submits the expected current status', async (label, status) => {
  const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ id: 'pending-user', status });
  const invalidate = mount();
  await userEvent.click(screen.getByRole('button', { name: label }));
  await screen.findByRole('status');
  expect(patch).toHaveBeenCalledExactlyOnceWith('/v1/admin/users/pending-user/approval', {
    status,
    expectedStatus: 'pending',
  });
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin'] }));
});
test('a conflicting review is reported without claiming success', async () => {
  vi.spyOn(apiClient, 'patch').mockRejectedValue(
    new ApiError(409, { error: { code: 'conflict', message: 'Conflict' } }),
  );
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Approve account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/reviewed/);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
