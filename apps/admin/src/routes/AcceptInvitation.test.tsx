import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { apiClient, ApiError } from '../api/client';
import { AcceptInvitation } from './AcceptInvitation';

const token = 'a'.repeat(64);
const seeded = {
  email: 'operator@example.test',
  username: 'operator',
  name: 'Operator',
  seeded: true,
  existingAccount: false,
};
beforeEach(async () => {
  await initI18n('en');
  window.history.replaceState({}, '', `/accept-invite#token=${token}`);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

test('seeded identity is prefilled and locked; setup submits only a password and token', async () => {
  const post = vi
    .spyOn(apiClient, 'post')
    .mockResolvedValueOnce(seeded)
    .mockResolvedValueOnce({ status: 'approved' });
  render(<AcceptInvitation />);
  expect(await screen.findByLabelText('Email address')).toHaveValue(seeded.email);
  expect(screen.getByLabelText('Email address')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Username')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Full name')).toHaveValue('Operator');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Password', { exact: true }), 'test-password-123');
  await user.type(screen.getByLabelText('Confirm password'), 'test-password-123');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('status')).toHaveTextContent('You can now sign in');
  expect(post).toHaveBeenLastCalledWith('/v1/auth/admin-invitations/accept', {
    token,
    password: 'test-password-123',
  });
  expect(window.location.hash).toBe('');
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
});

test('existing users must use their current password and see no password reset form', async () => {
  const post = vi
    .spyOn(apiClient, 'post')
    .mockResolvedValueOnce({ ...seeded, seeded: false, existingAccount: true })
    .mockRejectedValueOnce(
      new ApiError(400, { error: { code: 'invitation_existing_password', message: 'raw error' } }),
    );
  render(<AcceptInvitation />);
  await screen.findByLabelText('Email address');
  expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Password'), 'wrong');
  await userEvent.click(screen.getByRole('button', { name: 'Accept administrator invitation' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('current password');
  expect(post).toHaveBeenCalledTimes(2);
  expect(window.location.hash).toContain(token);
});

test('a missing invitation renders no account-creation form and makes no API request', async () => {
  window.history.replaceState({}, '', '/accept-invite');
  const post = vi.spyOn(apiClient, 'post');
  render(<AcceptInvitation />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/);
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  await waitFor(() => expect(post).not.toHaveBeenCalled());
});
