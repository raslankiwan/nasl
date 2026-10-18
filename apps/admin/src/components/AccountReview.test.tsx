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
function mount(hasFarm = false, emailUnverified = false) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <AccountReview
        userId="pending-user"
        status="pending"
        isPlatformAdmin={false}
        userName="Farmer"
        hasFarm={hasFarm}
        emailUnverified={emailUnverified}
      />
    </QueryClientProvider>,
  );
  return invalidate;
}
test.each([
  ['Approve and create farm', 'approved'],
  ['Reject registration', 'rejected'],
])('review action %s submits the expected current status', async (label, status) => {
  const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ id: 'pending-user', status });
  const invalidate = mount();
  await userEvent.click(screen.getByRole('button', { name: label }));
  await screen.findByRole('status');
  expect(patch).toHaveBeenCalledExactlyOnceWith('/v1/admin/users/pending-user/approval', {
    status,
    expectedStatus: 'pending',
    ...(status === 'approved' ? { farm: { name: 'Farmer’s farm', species: ['sheep'] } } : {}),
  });
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin'] }));
});
test('a conflicting review is reported without claiming success', async () => {
  vi.spyOn(apiClient, 'patch').mockRejectedValue(
    new ApiError(409, { error: { code: 'conflict', message: 'Conflict' } }),
  );
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Approve and create farm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/reviewed/);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('approval can use an edited name and both species', async () => {
  const patch = vi
    .spyOn(apiClient, 'patch')
    .mockResolvedValue({ farm: { id: 'farm1', name: 'New farm' } });
  mount();
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Farm name'));
  expect(screen.getByRole('button', { name: 'Approve and create farm' })).toBeDisabled();
  await user.type(screen.getByLabelText('Farm name'), '  New farm  ');
  await user.selectOptions(screen.getByLabelText('Species'), 'both');
  await user.click(screen.getByRole('button', { name: 'Approve and create farm' }));
  expect(await screen.findByRole('status')).toHaveTextContent('New farm');
  expect(patch).toHaveBeenCalledWith(expect.any(String), {
    status: 'approved',
    expectedStatus: 'pending',
    farm: { name: 'New farm', species: ['sheep', 'goat'] },
  });
});
test('staff can approve without creating a farm', async () => {
  const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({});
  mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Create a farm for this user' }));
  expect(screen.queryByLabelText('Farm name')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Approve account' }));
  await screen.findByRole('status');
  expect(patch).toHaveBeenCalledWith(expect.any(String), {
    status: 'approved',
    expectedStatus: 'pending',
  });
});
test('an existing farm is preserved instead of offering another automatic farm', async () => {
  const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({});
  mount(true);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByText(/already has a farm/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Approve account' }));
  await screen.findByRole('status');
  expect(patch).toHaveBeenCalledWith(expect.any(String), {
    status: 'approved',
    expectedStatus: 'pending',
  });
});

test('an unverified email blocks approval but still permits rejecting registration', async () => {
  const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({});
  mount(false, true);
  expect(screen.getByRole('button', { name: 'Approve and create farm' })).toBeDisabled();
  expect(screen.getByText(/This user must verify/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reject registration' }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith(expect.any(String), {
      status: 'rejected',
      expectedStatus: 'pending',
    }),
  );
});
