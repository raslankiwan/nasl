import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { ApiError } from '../api/client';
import { SignIn } from './SignIn';

beforeEach(() => initI18n('en'));
afterEach(cleanup);

test('registration submits credentials and shows pending approval without logging in', async () => {
  const register = vi.fn().mockResolvedValue({ id: 'new-user', status: 'pending' });
  const signIn = vi.fn();
  render(<SignIn register={register} signIn={signIn} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'New to Nasl? Create an account' }));
  await user.type(screen.getByLabelText('Full name'), 'Farmer');
  await user.type(screen.getByLabelText('Email address'), 'farmer@example.test');
  await user.type(screen.getByLabelText('Username'), 'farmer_1');
  await user.type(screen.getByLabelText('Password', { exact: true }), 'test-only-password');
  await user.type(screen.getByLabelText('Confirm password'), 'test-only-password');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByRole('heading', { name: 'Registration received' });
  expect(screen.getByRole('status')).toHaveTextContent(/approve/i);
  expect(register).toHaveBeenCalledExactlyOnceWith({
    name: 'Farmer',
    email: 'farmer@example.test',
    username: 'farmer_1',
    password: 'test-only-password',
    locale: 'en',
  });
  expect(signIn).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(screen.getByLabelText('Password')).toHaveValue('');
});

test('email or username login retains the form and localizes pending errors', async () => {
  const signIn = vi
    .fn()
    .mockRejectedValue(
      new ApiError(403, { error: { code: 'account_pending', message: 'raw error' } }),
    );
  render(<SignIn register={vi.fn()} signIn={signIn} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email or username'), ' farmer_1 ');
  await user.type(screen.getByLabelText('Password'), 'test-only-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() =>
    expect(signIn).toHaveBeenCalledExactlyOnceWith('farmer_1', 'test-only-password'),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(/approval/);
  expect(screen.queryByText('raw error')).not.toBeInTheDocument();
});
