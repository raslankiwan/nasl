import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient, ApiError } from '../api/client';
import { initI18n } from '../i18n';
import { CreateFarmForm } from './CreateFarmForm';

beforeEach(async () => {
  await initI18n('ar');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  const onCreated = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CreateFarmForm onCreated={onCreated} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onCreated };
}

describe('farm provisioning form', () => {
  test('submits the chosen owner and species with an optional reason', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ id: 'farm-1' });
    const { user, onCreated } = mount();
    await user.type(screen.getByLabelText('اسم المزرعة'), 'مزرعة الشمال');
    await user.type(screen.getByLabelText('رقم جوال المالك'), '+970592320210');
    await user.selectOptions(screen.getByLabelText('النوع'), 'both');
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeEnabled();
    await user.type(screen.getByLabelText('السبب (اختياري)'), 'طلب المالك');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('farm-1'));
    expect(post).toHaveBeenCalledExactlyOnceWith('/v1/admin/farms', {
      name: 'مزرعة الشمال',
      ownerPhone: '+970592320210',
      species: ['sheep', 'goat'],
      reason: 'طلب المالك',
    });
  });

  test('creates a farm without asking the owner to sign in or requiring a reason', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ id: 'farm-new-owner' });
    const { user, onCreated } = mount();
    await user.type(screen.getByLabelText('اسم المزرعة'), 'مزرعة جديدة');
    await user.type(screen.getByLabelText('رقم جوال المالك'), '+970592320299');
    expect(screen.getByLabelText('السبب (اختياري)')).not.toBeRequired();
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('farm-new-owner'));
    expect(post).toHaveBeenCalledExactlyOnceWith('/v1/admin/farms', {
      name: 'مزرعة جديدة',
      ownerPhone: '+970592320299',
      species: ['sheep'],
    });
  });

  test('explains invalid details in Arabic and retains the form for correction', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiError(400, {
        error: { code: 'bad_request', message: 'Invalid phone number' },
      }),
    );
    const { user, onCreated } = mount();
    await user.type(screen.getByLabelText('اسم المزرعة'), 'مزرعة الشمال');
    await user.type(screen.getByLabelText('رقم جوال المالك'), '592320299');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'أدخل رقم جوال المالك مع رمز الدولة',
    );
    expect(screen.getByLabelText('اسم المزرعة')).toHaveValue('مزرعة الشمال');
    expect(screen.getByLabelText('رقم جوال المالك')).toHaveValue('592320299');
    expect(onCreated).not.toHaveBeenCalled();
  });
});
