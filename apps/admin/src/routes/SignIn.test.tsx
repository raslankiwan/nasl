import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { ApiError } from '../api/client';
import { SignIn } from './SignIn';

beforeEach(() => initI18n('en'));
afterEach(cleanup);

test('administrator sign-in explains invitation-only access and has no registration control', () => {
  render(<SignIn signIn={vi.fn()} />);
  expect(screen.getByText(/Administrator access is by email invitation only/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Create an account/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
});

test('email or username login retains the form and localizes pending errors', async () => {
  const signIn = vi
    .fn()
    .mockRejectedValue(
      new ApiError(403, { error: { code: 'account_pending', message: 'raw error' } }),
    );
  render(<SignIn signIn={signIn} />);
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
