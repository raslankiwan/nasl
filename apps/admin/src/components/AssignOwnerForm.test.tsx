import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient, ApiError } from '../api/client';
import { initI18n } from '../i18n';
import { AssignOwnerForm } from './AssignOwnerForm';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ params, children }: { params: { userId: string }; children: ReactNode }) => (
    <a href={`/users/${params.userId}`}>{children}</a>
  ),
}));

const original = { id: 'original', name: 'Original owner', phone: '+970590000001' };
const next = { id: 'next', name: 'New owner', phone: '+970590000002' };
const farm = { id: 'farm-1', name: 'North farm', ownerUserId: original.id, owner: original };

beforeEach(async () => {
  await initI18n('ar');
  vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) =>
    path.includes('/farms') ? { farms: [farm], total: 1 } : { users: [original, next], total: 2 },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(side: 'farm' | 'user' = 'farm') {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AssignOwnerForm
        {...(side === 'farm' ? { farm } : { user: next })}
        onDone={onDone}
        onCancel={onCancel}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onDone, onCancel };
}

describe('ownership assignment', () => {
  test('selects an existing owner, explains revoked access, and submits without a reason', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ id: farm.id });
    const { user, onDone } = mount();
    expect(await screen.findByRole('radio', { name: /Original owner/ })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /New owner/ }));
    expect(screen.getByText(/سيُلغى وصول المالك السابق/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New owner' })).toHaveAttribute('href', '/users/next');
    expect(screen.getByLabelText('السبب (اختياري)')).not.toBeRequired();
    await user.click(screen.getByRole('button', { name: 'حفظ الملكية' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(patch).toHaveBeenCalledExactlyOnceWith('/v1/admin/farms/farm-1/owner', {
      expectedOwnerUserId: 'original',
      ownerUserId: 'next',
    });
  });

  test('links an existing farm from a user page using the same ownership endpoint', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ id: farm.id });
    const { user, onDone } = mount('user');
    await user.click(await screen.findByRole('radio', { name: 'North farm' }));
    expect(screen.getByRole('link', { name: 'Original owner' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('السبب (اختياري)'), 'طلب المالك');
    await user.click(screen.getByRole('button', { name: 'حفظ الملكية' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(patch).toHaveBeenCalledExactlyOnceWith('/v1/admin/farms/farm-1/owner', {
      expectedOwnerUserId: 'original',
      ownerUserId: 'next',
      reason: 'طلب المالك',
    });
  });

  test('accepts a phone number for an account that has not signed in yet', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ id: farm.id });
    const { user, onDone } = mount();
    await user.selectOptions(screen.getByLabelText('اختر المالك الجديد'), 'phone');
    await user.type(screen.getByLabelText('رقم جوال المالك'), '+970590000009');
    await user.click(screen.getByRole('button', { name: 'حفظ الملكية' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(patch).toHaveBeenCalledExactlyOnceWith('/v1/admin/farms/farm-1/owner', {
      expectedOwnerUserId: 'original',
      ownerPhone: '+970590000009',
    });
  });

  test('a stale form blocks resubmission and leaves cancellation available', async () => {
    const patch = vi
      .spyOn(apiClient, 'patch')
      .mockRejectedValue(
        new ApiError(409, { error: { code: 'conflict', message: 'Stale owner' } }),
      );
    const { user, onDone, onCancel } = mount();
    await user.click(await screen.findByRole('radio', { name: /New owner/ }));
    await user.click(screen.getByRole('button', { name: 'حفظ الملكية' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('تغيّر المالك');
    expect(screen.getByRole('button', { name: 'حفظ الملكية' })).toBeDisabled();
    expect(onDone).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'إلغاء' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
